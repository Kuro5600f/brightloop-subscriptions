from dateutil.relativedelta import relativedelta

from odoo.tests import tagged

from .common import BlCase


@tagged('post_install', '-at_install')
class TestDashboardV2(BlCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Dash = cls.env['bl.dashboard'].with_user(cls.staff)
        cls.env['account.move'].search([('move_type', '=', 'out_invoice')]).filtered(
            lambda m: m.state == 'draft').unlink()  # start without stray drafts from seed
        immediate = cls.env.ref('account.account_payment_term_immediate')
        # paid this month (230), overdue from 2 months ago (115), pending draft (230)
        paid_sub = cls.activate(cls.make_sub(qty=2))
        late_sub = cls.activate(cls.make_sub(qty=1, date_start=cls.today - relativedelta(months=2),
                                             payment_term_id=immediate.id))
        cls.Sub._run_billing(today=cls.today - relativedelta(months=2))
        cls.Sub._run_billing(today=cls.today)
        cls.paid_inv = paid_sub.invoice_ids.filtered(lambda m: m.bl_period_start == cls.today)
        cls.late_inv = late_sub.invoice_ids.filtered(lambda m: m.bl_period_start < cls.today)[:1]
        (cls.paid_inv | cls.late_inv).action_post()
        cls.env['account.payment.register'].with_context(
            active_model='account.move', active_ids=cls.paid_inv.ids).create({}).action_create_payments()
        cls.draft_inv = late_sub.invoice_ids.filtered(lambda m: m.state == 'draft')[:1]

    def test_status_mapping_and_counts(self):
        res = self.Dash.list_invoices('all', '', 0, 50)
        by_id = {r['id']: r for r in res['rows']}
        self.assertEqual(by_id[self.paid_inv.id]['status'], 'paid')
        self.assertEqual(by_id[self.late_inv.id]['status'], 'overdue')
        if self.draft_inv:
            self.assertEqual(by_id[self.draft_inv.id]['status'], 'draft')
        for key in ('all', 'paid', 'pending', 'overdue', 'draft'):
            self.assertIn(key, res['counts'])
        self.assertGreaterEqual(res['counts']['overdue'], 1)

    def test_filter_and_search(self):
        overdue = self.Dash.list_invoices('overdue', '', 0, 50)['rows']
        self.assertTrue(all(r['status'] == 'overdue' for r in overdue))
        self.assertIn(self.late_inv.id, [r['id'] for r in overdue])
        found = self.Dash.list_invoices('all', 'Acme Test', 0, 50)['rows']
        self.assertTrue(found and all(r['partner'] == 'Acme Test' for r in found))
        self.assertFalse(self.Dash.list_invoices('all', 'no-such-client-xyz', 0, 50)['rows'])

    def test_pagination(self):
        page = self.Dash.list_invoices('all', '', 0, 1)
        self.assertEqual(len(page['rows']), 1)
        self.assertGreaterEqual(page['total'], 2)

    def test_invoice_detail(self):
        d = self.Dash.invoice_detail(self.paid_inv.id)
        self.assertEqual(d['name'], self.paid_inv.name)
        self.assertEqual(d['status'], 'paid')
        self.assertEqual(d['partner']['name'], 'Acme Test')
        self.assertEqual(d['lines'][0]['quantity'], 2)
        self.assertAlmostEqual(d['amount_total'], 230)
        self.assertEqual(d['subscription'], self.paid_inv.bl_subscription_id.name)

    def test_monthly_series(self):
        data = self.Dash.get_data(None, None)
        self.assertEqual(len(data['monthly']), 6)
        this_month = data['monthly'][-1]
        self.assertGreaterEqual(this_month['paid'], 230)
        two_ago = data['monthly'][-3]
        self.assertGreaterEqual(two_ago['overdue'], 115)
        for key in ('paid', 'pending', 'overdue'):
            self.assertIn(key, data['status_split'])
        self.assertTrue(data['user_first_name'])
