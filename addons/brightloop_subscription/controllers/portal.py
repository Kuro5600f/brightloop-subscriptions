from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from odoo.addons.portal.controllers.portal import CustomerPortal, pager as portal_pager


class BlPortal(CustomerPortal):

    def _prepare_home_portal_values(self, counters):
        values = super()._prepare_home_portal_values(counters)
        if 'subscription_count' in counters:
            Sub = request.env['bl.subscription']
            values['subscription_count'] = Sub.search_count([]) if Sub.has_access('read') else 0
        return values

    @http.route(['/my/subscriptions', '/my/subscriptions/page/<int:page>'], type='http', auth='user', website=True)
    def portal_my_subscriptions(self, page=1, **kw):
        Sub = request.env['bl.subscription']  # record rules limit this to the user's company
        total = Sub.search_count([])
        pager = portal_pager(url='/my/subscriptions', total=total, page=page, step=20)
        subs = Sub.search([], order='id desc', limit=20, offset=pager['offset'])
        return request.render('brightloop_subscription.portal_my_subscriptions', {
            'subscriptions': subs.sudo(),
            'page_name': 'bl_subscription',
            'pager': pager,
            'default_url': '/my/subscriptions',
        })

    @http.route('/my/subscriptions/<int:sub_id>', type='http', auth='user', website=True)
    def portal_my_subscription(self, sub_id, **kw):
        try:
            # subscriptions have no share tokens: access is by login + record rules only
            sub = self._document_check_access('bl.subscription', sub_id)
        except (AccessError, MissingError):
            return request.redirect('/my')
        return request.render('brightloop_subscription.portal_my_subscription', {
            'sub': sub,
            'invoices': sub.invoice_ids.filtered(lambda m: m.state == 'posted'),
            'page_name': 'bl_subscription',
        })
