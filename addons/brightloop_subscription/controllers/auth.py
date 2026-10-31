import json
import logging
import secrets
from urllib.parse import urlencode, urlparse

import requests

from odoo import SUPERUSER_ID, http
from odoo.exceptions import AccessDenied
from odoo.http import request

from odoo.addons.auth_oauth.controllers.main import OAuthController, OAuthLogin

_logger = logging.getLogger(__name__)

DASHBOARD = '/odoo/action-brightloop_subscription.action_bl_dashboard'


def bl_home_url(uid):
    """Landing page from trusted server-side data: the user's groups, never anything the browser sent."""
    user = request.env['res.users'].sudo().browse(uid)
    if not user._is_internal():
        return '/my'  # customer portal: own subscriptions and invoices only
    if user.has_group('brightloop_subscription.group_bl_staff'):  # admins imply staff
        return DASHBOARD
    return None  # other internal users: Odoo's default home


def _local_path(url):
    # only same-site paths are accepted as post-login redirects (no open redirect)
    return url if url and url.startswith('/') and not url.startswith('//') else None


class BlLogin(OAuthLogin):

    def _login_redirect(self, uid, redirect=None):
        # password login: an explicit ?redirect= wins, otherwise land by role
        return super()._login_redirect(uid, redirect=redirect or bl_home_url(uid))

    def list_providers(self):
        providers = super().list_providers()
        for p in providers:
            p.pop('bl_client_secret', None)  # never handed to the template
            if p.get('bl_code_flow'):
                p['auth_link'] = '/auth_oauth/bl/start/%s' % p['id']
        return providers


class BlOAuth(OAuthController):

    @http.route()
    def signin(self, **kw):
        # Google / Facebook (Odoo's flow): same role-based landing as password login
        resp = super().signin(**kw)
        uid = request.session.uid
        if uid and urlparse(resp.location).path in ('/odoo', '/web', '/'):
            resp.location = bl_home_url(uid) or resp.location
        return resp

    @http.route('/auth_oauth/bl/start/<int:provider_id>', type='http', auth='public')
    def bl_start(self, provider_id, redirect=None, **kw):
        provider = request.env['auth.oauth.provider'].sudo().browse(provider_id).exists()
        if not provider or not provider.enabled or not provider.bl_code_flow or not provider.client_id:
            return request.redirect('/web/login?oauth_error=2')
        state = secrets.token_urlsafe(24)
        # one-time state bound to this browser session: blocks CSRF / login-fixation on the callback
        request.session['bl_oauth'] = {'state': state, 'provider': provider.id, 'redirect': _local_path(redirect)}
        params = {
            'response_type': 'code',
            'client_id': provider.client_id,
            'redirect_uri': request.httprequest.url_root + 'auth_oauth/bl/callback',
            'scope': provider.scope,
            'state': state,
        }
        return request.redirect('%s?%s' % (provider.auth_endpoint, urlencode(params)), local=False)

    @http.route('/auth_oauth/bl/callback', type='http', auth='public')
    def bl_callback(self, code=None, state=None, error=None, **kw):
        pending = request.session.pop('bl_oauth', None)
        if error or not code or not pending or not secrets.compare_digest(state or '', pending['state']):
            return request.redirect('/web/login?oauth_error=3')
        provider = request.env['auth.oauth.provider'].sudo().browse(pending['provider'])
        try:
            token = requests.post(provider.bl_token_endpoint, timeout=10, data={
                'grant_type': 'authorization_code',
                'code': code,
                'redirect_uri': request.httprequest.url_root + 'auth_oauth/bl/callback',
                'client_id': provider.client_id,
                'client_secret': provider.bl_client_secret,
            })
            access = token.status_code == 200 and token.json().get('access_token')
            if not access:
                raise AccessDenied()
            info = requests.get(provider.validation_endpoint, timeout=10,
                                headers={'Authorization': 'Bearer %s' % access}).json()
            if not info.get('sub'):
                raise AccessDenied()
            validation = {'user_id': info['sub'], 'name': info.get('name')}
            if info.get('email') and info.get('email_verified', True):
                validation['email'] = info['email']
            # reuse Odoo's OAuth sign-in: finds the linked user, or signs up a new portal customer
            login = request.env['res.users'].with_user(SUPERUSER_ID)._auth_oauth_signin(
                provider.id, validation, {'access_token': access, 'state': json.dumps({})})
            if not login:
                raise AccessDenied()
            request.env.cr.commit()  # make a new user visible to authenticate()'s transaction
            request.session.authenticate(request.db, {'login': login, 'token': access, 'type': 'oauth_token'})
        except AccessDenied:
            return request.redirect('/web/login?oauth_error=3')
        except Exception:  # noqa: BLE001 - provider down / bad answer: show a clean error, keep the details in the log
            _logger.exception("OAuth code flow failed for provider %s", provider.name)
            return request.redirect('/web/login?oauth_error=2')
        return request.redirect(pending.get('redirect') or bl_home_url(request.session.uid) or '/odoo', 303)
