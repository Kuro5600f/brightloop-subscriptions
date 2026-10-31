from dateutil.relativedelta import relativedelta

from odoo.tests import tagged

from .common import BlCase


@tagged('post_install', '-at_install')
class TestDashboard(BlCase):
    def test_get_data(self):
        Dash = self.env['bl.dashboard']
        before = Dash.get_data(None, None)

        paid_sub = self.activate(self.make_sub(qty=2))  # total 230
        self.Sub._run_billing(today=self.today)
        inv = paid_sub.invoice_ids
        inv.action_post()
        self.env['account.payment.register'].with_context(
            active_model='account.move', active_ids=inv.ids).create({'amount': 100}).action_create_payments()

        immediate = self.env.ref('account.account_payment_term_immediate')
        late = self.activate(self.make_sub(qty=1, date_start=self.today - relativedelta(months=2),
                                           payment_term_id=immediate.id))
        self.Sub._run_billing(today=self.today - relativedelta(months=2))
        late.invoice_ids.action_post()

        data = Dash.with_user(self.staff).get_data(None, None)
        self.assertEqual(data['active_count'], before['active_count'] + 2)
        self.assertAlmostEqual(data['revenue'] - before['revenue'], 100)
        self.assertAlmostEqual(data['outstanding'] - before['outstanding'], 130 + 115)
        self.assertIn(late.invoice_ids.id, [o['id'] for o in data['overdue']])
        self.assertEqual(data['overdue_count'], before['overdue_count'] + 1)
        self.assertTrue(any(p['amount'] == 100 for p in data['recent_payments']))
        self.assertTrue(data['currency_symbol'])

    def test_date_filter_excludes_old_payments(self):
        future = (self.today + relativedelta(days=1)).isoformat()
        data = self.env['bl.dashboard'].get_data(future, None)
        self.assertEqual(data['revenue'], 0)
