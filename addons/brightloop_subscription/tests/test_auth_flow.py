from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

from odoo.tests import HttpCase, new_test_user, tagged

from .common import PASSWORD

DASHBOARD = '/odoo/action-brightloop_subscription.action_bl_dashboard'
AUTH = 'odoo.addons.brightloop_subscription.controllers.auth'


@tagged('post_install', '-at_install')
class TestAuthFlow(HttpCase):
    def _csrf(self):
        html = self.url_open('/web/login').text
        return html.split('name="csrf_token" value="')[1].split('"')[0]

    def _login(self, login):
        return self.url_open('/web/login', allow_redirects=False, data={
            'login': login, 'password': PASSWORD, 'csrf_token': self._csrf()})

    def test_login_page_is_a_plain_professional_form(self):
        html = self.url_open('/web/login').text
        self.assertNotIn('web.user_switch', html)  # no "Choose a user" picker
        self.assertNotIn('bl-demo', html)  # no demo-only UI
        self.assertIn('Sign in', html)
        self.assertIn('Forgot password?', html)
        self.assertIn('Sign up', html)

    def test_admin_lands_on_admin_dashboard(self):
        new_test_user(self.env, login='r_admin@bl.test', password=PASSWORD,
                      groups='base.group_user,brightloop_subscription.group_bl_admin')
        self.assertTrue(self._login('r_admin@bl.test').headers['Location'].endswith(DASHBOARD))

    def test_staff_lands_on_dashboard(self):
        new_test_user(self.env, login='r_staff@bl.test', password=PASSWORD,
                      groups='base.group_user,brightloop_subscription.group_bl_staff')
        self.assertTrue(self._login('r_staff@bl.test').headers['Location'].endswith(DASHBOARD))

    def test_customer_lands_on_portal_and_cannot_open_backend(self):
        new_test_user(self.env, login='r_cust@bl.test', password=PASSWORD, groups='base.group_portal')
        self.assertTrue(self._login('r_cust@bl.test').headers['Location'].endswith('/my'))
        res = self.url_open(DASHBOARD, allow_redirects=False)
        self.assertIn('/my', res.headers.get('Location', ''))

    def test_explicit_redirect_is_kept(self):
        new_test_user(self.env, login='r_admin2@bl.test', password=PASSWORD,
                      groups='base.group_user,brightloop_subscription.group_bl_admin')
        res = self.url_open('/web/login', allow_redirects=False, data={
            'login': 'r_admin2@bl.test', 'password': PASSWORD, 'csrf_token': self._csrf(),
            'redirect': '/odoo/action-account.action_move_out_invoice_type'})
        self.assertTrue(res.headers['Location'].endswith('/odoo/action-account.action_move_out_invoice_type'))


@tagged('post_install', '-at_install')
class TestLinkedIn(HttpCase):
    def setUp(self):
        super().setUp()
        self.provider = self.env.ref('brightloop_subscription.provider_linkedin')
        self.provider.write({'enabled': True, 'client_id': 'li-client', 'bl_client_secret': 'li-secret'})

    def test_button_goes_through_server_side_flow(self):
        html = self.url_open('/web/login').text
        self.assertIn('Continue with LinkedIn', html)
        self.assertIn('/auth_oauth/bl/start/%s' % self.provider.id, html)
        self.assertNotIn('li-secret', html)

    def test_start_redirects_with_code_flow_and_state(self):
        res = self.url_open('/auth_oauth/bl/start/%s' % self.provider.id, allow_redirects=False)
        url = urlparse(res.headers['Location'])
        q = parse_qs(url.query)
        self.assertEqual(url.netloc, 'www.linkedin.com')
        self.assertEqual(q['response_type'], ['code'])
        self.assertEqual(q['client_id'], ['li-client'])
        self.assertTrue(q['state'][0])
        self.assertNotIn('client_secret', q)

    def test_callback_rejects_forged_state(self):
        self.url_open('/auth_oauth/bl/start/%s' % self.provider.id, allow_redirects=False)
        res = self.url_open('/auth_oauth/bl/callback?code=abc&state=forged', allow_redirects=False)
        self.assertIn('/web/login?oauth_error', res.headers['Location'])

    def test_callback_signs_up_and_logs_in_new_customer(self):
        start = self.url_open('/auth_oauth/bl/start/%s' % self.provider.id, allow_redirects=False)
        state = parse_qs(urlparse(start.headers['Location']).query)['state'][0]
        token_resp = MagicMock(status_code=200, **{'json.return_value': {'access_token': 'li-access'}})
        info_resp = MagicMock(status_code=200, **{'json.return_value': {
            'sub': 'li-123', 'email': 'new.customer@li.test', 'email_verified': True, 'name': 'New Customer'}})
        with patch(AUTH + '.requests.post', return_value=token_resp) as post, \
                patch(AUTH + '.requests.get', return_value=info_resp):
            res = self.url_open('/auth_oauth/bl/callback?code=abc&state=%s' % state, allow_redirects=False)
        self.assertEqual(post.call_args.kwargs['data']['client_secret'], 'li-secret')  # secret only server-side
        self.assertTrue(res.headers['Location'].endswith('/my'), res.headers['Location'])
        user = self.env['res.users'].search([('oauth_uid', '=', 'li-123')])
        self.assertEqual(user.login, 'new.customer@li.test')
        self.assertTrue(user.has_group('base.group_portal'))
        self.assertFalse(user._is_internal())
