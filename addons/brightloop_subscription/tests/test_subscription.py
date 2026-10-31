from datetime import timedelta

from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import BlCase


@tagged('post_install', '-at_install')
class TestSubscription(BlCase):
    def test_sequence(self):
        a, b = self.make_sub(), self.make_sub()
        self.assertTrue(a.name.startswith('SUB/'))
        self.assertNotEqual(a.name, b.name)

    def test_happy_lifecycle(self):
        sub = self.activate(self.make_sub())
        self.assertEqual(sub.state, 'active')
        self.assertEqual(sub.next_invoice_date, sub.date_start)

    def test_wrong_transition(self):
        with self.assertRaises(UserError):
            self.make_sub().action_activate()

    def test_expired_quote(self):
        sub = self.make_sub()
        sub.action_send_quote()
        sub.quote_expiry_date = self.today - timedelta(days=1)
        with self.assertRaises(UserError):
            sub.action_confirm()

    def test_min_qty(self):
        plan = self.Plan.create({'name': 'Min5', 'billing_period': 'month', 'min_qty': 5})
        sub = self.make_sub(qty=2, plan=plan)
        sub.action_send_quote()
        with self.assertRaises(UserError):
            sub.action_confirm()

    def test_no_lines(self):
        sub = self.Sub.create({'partner_id': self.partner.id, 'plan_id': self.monthly.id, 'date_start': self.today})
        with self.assertRaises(UserError):
            sub.action_send_quote()

    def test_totals(self):
        sub = self.make_sub(qty=2)
        self.assertEqual(sub.amount_untaxed, 200)
        self.assertEqual(sub.amount_total, 230)

    def test_variant_price(self):
        attr = self.env['product.attribute'].create({
            'name': 'Brand', 'value_ids': [(0, 0, {'name': 'Generic'}), (0, 0, {'name': 'Odoo'})]})
        tmpl = self.env['product.template'].create({
            'name': 'CRM Variant', 'list_price': 1000,
            'attribute_line_ids': [(0, 0, {'attribute_id': attr.id, 'value_ids': [(6, 0, attr.value_ids.ids)]})]})
        ptav = tmpl.attribute_line_ids.product_template_value_ids.filtered(
            lambda v: v.product_attribute_value_id.name == 'Odoo')
        ptav.price_extra = 560
        variant = tmpl.product_variant_ids.filtered(lambda p: ptav in p.product_template_attribute_value_ids)
        sub = self.Sub.create({
            'partner_id': self.partner.id, 'plan_id': self.monthly.id, 'date_start': self.today,
            'line_ids': [(0, 0, {'product_id': variant.id, 'quantity': 1})]})
        self.assertEqual(sub.line_ids.price_unit, 1560)

    def test_pause_requires_plan_flag(self):
        sub = self.activate(self.make_sub())
        with self.assertRaises(UserError):
            sub.action_pause()
        self.monthly.allow_pause = True
        sub.action_pause()
        self.assertEqual(sub.state, 'paused')
        sub.action_resume()
        self.assertEqual(sub.state, 'active')

    def test_close_and_renew(self):
        sub = self.activate(self.make_sub())
        sub.action_close()
        self.assertEqual(sub.state, 'closed')
        sub.action_renew()
        renewed = self.Sub.search([('renewed_from_id', '=', sub.id)])
        self.assertEqual(renewed.state, 'draft')
        self.assertEqual(len(renewed.line_ids), 1)

    def test_template_onchange(self):
        tmpl = self.env['bl.quote.template'].create({
            'name': 'Starter', 'plan_id': self.monthly.id, 'validity_days': 10,
            'line_ids': [(0, 0, {'product_id': self.product.id, 'quantity': 3})]})
        sub = self.Sub.new({'partner_id': self.partner.id, 'template_id': tmpl.id})
        sub._onchange_template_id()
        self.assertEqual(sub.plan_id, self.monthly)
        self.assertEqual(sub.line_ids.quantity, 3)
        self.assertEqual(sub.quote_expiry_date, self.today + timedelta(days=10))
