from dateutil.relativedelta import relativedelta

from odoo.tests import tagged

from .common import BlCase


@tagged('post_install', '-at_install')
class TestEndToEnd(BlCase):
    def test_plan_change_discount_and_renewal_on_the_same_day(self):
        """Admin changes the plan, a discount now applies, and the subscription renews today:
        exactly one invoice with the right amount, discount and tax; payment matched; dashboard updated."""
        admin_env, staff_env = self.env(user=self.admin), self.env(user=self.staff)
        Sub, Dash = staff_env['bl.subscription'], staff_env['bl.dashboard']
        plan = admin_env['bl.plan'].browse(self.monthly.id)
        plan.price_ids = [(0, 0, {'product_tmpl_id': self.product.product_tmpl_id.id, 'price': 100})]

        # Customer signed a month ago at the plan price; first period already billed.
        start = self.today - relativedelta(months=1)
        renewal_day = plan.next_date(start)  # "today" for this scenario (month ends make this != self.today)
        sub = Sub.browse(self.activate(self.make_sub(qty=5, date_start=start)).id)
        self.assertEqual(sub.line_ids.price_unit, 100)
        Sub._run_billing(today=start)
        self.assertEqual(len(sub.invoice_ids), 1)
        self.assertEqual(sub.next_invoice_date, renewal_day)  # renews on billing day

        # Today: admin raises the plan price and creates a volume discount the customer now qualifies for.
        plan.price_ids.price = 120
        rule = admin_env['bl.discount.rule'].create({
            'name': '10% for 5+ seats', 'discount_type': 'percent', 'value': 10, 'min_qty': 5, 'max_uses': 100})
        before = Dash.get_data(None, None)

        # Billing day: the run fires twice (cron + someone clicking "Run billing now").
        first, second = Sub._run_billing(today=renewal_day), Sub._run_billing(today=renewal_day)
        self.assertEqual((first['invoices'], second['invoices']), (1, 0))
        invoice = sub.invoice_ids.filtered(lambda m: m.bl_period_start == renewal_day)
        self.assertEqual(len(invoice), 1, "exactly one invoice for today's period")

        # Agreed contract price (100) is kept; the plan change applies to new quotes only.
        self.assertEqual(invoice.invoice_line_ids.price_unit, 100)
        self.assertEqual(Sub.browse(self.make_sub(qty=1).id).line_ids.price_unit, 120)
        # 5 x 100 = 500, minus 10% = 450, plus 15% tax on the discounted base = 517.50
        self.assertEqual(invoice.invoice_line_ids.bl_discount_rule_id, rule)
        self.assertAlmostEqual(invoice.amount_untaxed, 450.00)
        self.assertAlmostEqual(invoice.amount_tax, 67.50)
        self.assertAlmostEqual(invoice.amount_total, 517.50)
        self.assertEqual(rule.used_count, 1)
        self.assertEqual(sub.next_invoice_date, start + relativedelta(months=2))

        # Staff confirms the invoice and records the customer's payment against it.
        invoice.action_post()
        self.assertAlmostEqual(Dash.get_data(None, None)['outstanding'] - before['outstanding'], 517.50)
        staff_env['account.payment.register'].with_context(
            active_model='account.move', active_ids=invoice.ids,
        ).create({'amount': 517.50, 'communication': 'Bank transfer ref 4411'}).action_create_payments()
        self.assertIn(invoice.payment_state, ('paid', 'in_payment'))
        self.assertAlmostEqual(invoice.amount_residual, 0)

        # Finance dashboard reflects it immediately.
        after = Dash.get_data(None, None)
        self.assertAlmostEqual(after['revenue'] - before['revenue'], 517.50)
        self.assertAlmostEqual(after['outstanding'] - before['outstanding'], 0)
        self.assertTrue(any(p['amount'] == 517.50 for p in after['recent_payments']))
