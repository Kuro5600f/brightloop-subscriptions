from odoo import http
from odoo.tests import HttpCase, new_test_user, tagged

from .common import PASSWORD, BlCase


@tagged('post_install', '-at_install')
class TestPlanPrice(BlCase):
    def test_plan_price_overrides_product_price(self):
        self.monthly.price_ids = [(0, 0, {'product_tmpl_id': self.product.product_tmpl_id.id, 'price': 80})]
        sub = self.make_sub(qty=1)
        self.assertEqual(sub.line_ids.price_unit, 80)

    def test_no_plan_price_uses_product_price(self):
        self.assertEqual(self.make_sub(qty=1).line_ids.price_unit, 100)

    def test_plan_price_keeps_variant_extra(self):
        attr = self.env['product.attribute'].create({
            'name': 'Brand', 'value_ids': [(0, 0, {'name': 'Generic'}), (0, 0, {'name': 'Odoo'})]})
        tmpl = self.env['product.template'].create({
            'name': 'CRM V', 'list_price': 1000,
            'attribute_line_ids': [(0, 0, {'attribute_id': attr.id, 'value_ids': [(6, 0, attr.value_ids.ids)]})]})
        ptav = tmpl.attribute_line_ids.product_template_value_ids.filtered(
            lambda v: v.product_attribute_value_id.name == 'Odoo')
        ptav.price_extra = 560
        variant = tmpl.product_variant_ids.filtered(lambda p: ptav in p.product_template_attribute_value_ids)
        yearly = self.Plan.create({'name': 'Y', 'billing_period': 'year',
                                   'price_ids': [(0, 0, {'product_tmpl_id': tmpl.id, 'price': 10000})]})
        sub = self.Sub.create({'partner_id': self.partner.id, 'plan_id': yearly.id, 'date_start': self.today,
                               'line_ids': [(0, 0, {'product_id': variant.id, 'quantity': 1})]})
        self.assertEqual(sub.line_ids.price_unit, 10560)


@tagged('post_install', '-at_install')
class TestSignupAndPortalManage(HttpCase):
    def test_free_signup_enabled(self):
        self.assertEqual(self.env['ir.config_parameter'].sudo().get_param('auth_signup.invitation_scope'), 'b2c')
        res = self.url_open('/web/signup')
        self.assertEqual(res.status_code, 200)
        self.assertIn('name="password"', res.text)

    def test_portal_customer_can_pause_and_resume(self):
        env = self.env
        env['bl.subscription'].search([('state', '=', 'active')]).write({'state': 'closed'})
        partner = env['res.partner'].create({'name': 'Manage Co'})
        user = new_test_user(env, login='t_manage', password=PASSWORD, groups='base.group_portal')
        user.partner_id.parent_id = partner
        plan = env['bl.plan'].create({'name': 'P', 'billing_period': 'month', 'allow_pause': True})
        product = env['product.product'].create({'name': 'M', 'list_price': 10})
        sub = env['bl.subscription'].create({'partner_id': partner.id, 'plan_id': plan.id,
                                             'line_ids': [(0, 0, {'product_id': product.id})]})
        sub.action_send_quote()
        sub.action_confirm()
        sub.action_activate()
        self.authenticate('t_manage', PASSWORD)
        csrf = http.Request.csrf_token(self)
        self.url_open('/my/subscriptions/%s/pause' % sub.id, data={'csrf_token': csrf})
        self.assertEqual(sub.state, 'paused')
        self.url_open('/my/subscriptions/%s/resume' % sub.id, data={'csrf_token': csrf})
        self.assertEqual(sub.state, 'active')

    def test_portal_cannot_manage_other(self):
        env = self.env
        new_test_user(env, login='t_manage2', password=PASSWORD, groups='base.group_portal')
        plan = env['bl.plan'].create({'name': 'P2', 'billing_period': 'month', 'allow_pause': True})
        product = env['product.product'].create({'name': 'M2', 'list_price': 10})
        other = env['bl.subscription'].create({'partner_id': env['res.partner'].create({'name': 'Z'}).id,
                                               'plan_id': plan.id, 'line_ids': [(0, 0, {'product_id': product.id})]})
        other.action_send_quote()
        other.action_confirm()
        other.action_activate()
        self.authenticate('t_manage2', PASSWORD)
        self.url_open('/my/subscriptions/%s/pause' % other.id, data={'csrf_token': http.Request.csrf_token(self)})
        self.assertEqual(other.state, 'active')
