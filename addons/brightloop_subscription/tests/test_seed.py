from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestSeed(TransactionCase):
    def test_seed_present(self):
        ref = self.env.ref
        admin = ref('brightloop_subscription.user_bl_admin')
        staff = ref('brightloop_subscription.user_bl_staff')
        customer = ref('brightloop_subscription.user_bl_customer')
        self.assertEqual(admin.login, 'admin@brightloop.test')
        self.assertTrue(admin.has_group('brightloop_subscription.group_bl_admin'))
        self.assertTrue(staff.has_group('brightloop_subscription.group_bl_staff'))
        self.assertFalse(staff.has_group('brightloop_subscription.group_bl_admin'))
        self.assertFalse(staff.has_group('base.group_erp_manager'))
        self.assertTrue(customer.has_group('base.group_portal'))
        self.assertEqual(customer.partner_id.commercial_partner_id.name, 'Acme Corp')

    def test_seed_business_data(self):
        ref = self.env.ref
        crm = ref('brightloop_subscription.product_bl_crm')
        odoo_variant = crm.product_variant_ids.filtered(
            lambda p: 'Odoo' in p.product_template_attribute_value_ids.mapped('name'))
        self.assertEqual(odoo_variant.lst_price, crm.list_price + 560)
        self.assertTrue(ref('brightloop_subscription.plan_bl_monthly'))
        self.assertTrue(ref('brightloop_subscription.template_bl_crm_starter').line_ids)
        self.assertTrue(ref('brightloop_subscription.discount_bl_launch'))
        states = set(self.env['bl.subscription'].search([]).mapped('state'))
        self.assertTrue({'draft', 'quotation', 'active', 'closed'} <= states)
        invoices = self.env['account.move'].search([('bl_subscription_id', '!=', False)])
        self.assertIn('paid', invoices.mapped('payment_state'))
        self.assertTrue(invoices.filtered(lambda m: m.state == 'posted' and m.payment_state == 'not_paid'
                                          and m.invoice_date_due < m.invoice_date.today()))
