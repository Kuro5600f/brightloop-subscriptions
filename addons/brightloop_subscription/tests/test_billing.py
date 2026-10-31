from unittest.mock import patch

import psycopg2
from dateutil.relativedelta import relativedelta

from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import BlCase


@tagged('post_install', '-at_install')
class TestBilling(BlCase):
    def _active(self, months_ago=0, **vals):
        start = self.today - relativedelta(months=months_ago)
        return self.activate(self.make_sub(date_start=start, **vals))

    def _live_invoices(self, sub):
        return sub.invoice_ids.filtered(lambda m: m.state != 'cancel')

    def test_bills_due_sub(self):
        sub = self._active()
        res = self.Sub._run_billing(today=self.today)
        self.assertEqual(res['invoices'], 1)
        inv = sub.invoice_ids
        self.assertEqual(len(inv), 1)
        self.assertEqual(inv.state, 'draft')
        self.assertEqual(inv.partner_id, self.partner)
        self.assertEqual(inv.invoice_line_ids.product_id, self.product)
        self.assertEqual(inv.invoice_line_ids.quantity, 2)
        self.assertEqual(inv.invoice_line_ids.tax_ids, self.tax15)
        self.assertAlmostEqual(inv.amount_total, 230)
        self.assertEqual(sub.next_invoice_date, self.today + relativedelta(months=1))

    def test_rerun_no_duplicate(self):
        sub = self._active()
        self.Sub._run_billing(today=self.today)
        self.Sub._run_billing(today=self.today)
        self.assertEqual(len(sub.invoice_ids), 1)

    def test_catch_up(self):
        sub = self._active(months_ago=2)
        self.Sub._run_billing(today=self.today)
        self.assertEqual(len(sub.invoice_ids), 3)
        self.assertEqual(len(set(sub.invoice_ids.mapped('bl_period_start'))), 3)

    def test_db_guard(self):
        sub = self._active()
        sub._create_invoice(self.today)
        with mute_logger('odoo.sql_db'), self.assertRaises(psycopg2.errors.UniqueViolation):
            with self.cr.savepoint():
                sub._create_invoice(self.today)
                self.env.flush_all()

    def test_cancel_then_rebill(self):
        sub = self._active()
        self.Sub._run_billing(today=self.today)
        sub.invoice_ids.button_cancel()
        sub.next_invoice_date = self.today
        self.Sub._run_billing(today=self.today)
        live = self._live_invoices(sub)
        self.assertEqual(len(live), 1)
        self.assertEqual(live.bl_period_start, self.today)

    def test_end_date_stops_and_closes(self):
        self.monthly.auto_close = True
        start = self.today - relativedelta(months=2)
        sub = self.activate(self.make_sub(date_start=start, date_end=start + relativedelta(months=1, days=10)))
        self.Sub._run_billing(today=self.today)
        self.assertEqual(len(sub.invoice_ids), 2)
        self.assertEqual(sub.state, 'closed')

    def test_error_visible(self):
        bad, good = self._active(), self._active()
        original = type(self.Sub)._create_invoice

        def boom(rec, period_start):
            if rec == bad:
                raise ValueError('simulated failure')
            return original(rec, period_start)

        with patch.object(type(self.Sub), '_create_invoice', boom), mute_logger(
                'odoo.addons.brightloop_subscription.models.bl_billing'):
            res = self.Sub._run_billing(today=self.today)
        self.assertEqual(res['errors'], 1)
        self.assertIn('simulated failure', bad.billing_error)
        self.assertFalse(bad.invoice_ids)
        self.assertEqual(len(good.invoice_ids), 1)
        self.assertFalse(good.billing_error)

    def test_paused_not_billed(self):
        self.monthly.allow_pause = True
        sub = self._active()
        sub.action_pause()
        self.Sub._run_billing(today=self.today)
        self.assertFalse(sub.invoice_ids)
