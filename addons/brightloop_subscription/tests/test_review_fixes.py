from dateutil.relativedelta import relativedelta

from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import BlCase


@tagged('post_install', '-at_install')
class TestReviewFixes(BlCase):
    def test_auto_close_when_end_passed_between_periods(self):
        yearly = self.Plan.create({'name': 'Y', 'billing_period': 'year', 'auto_close': True})
        start = self.today - relativedelta(months=3)
        sub = self.activate(self.make_sub(plan=yearly, date_start=start, date_end=self.today - relativedelta(days=1)))
        self.Sub._run_billing(today=start)  # earlier run bills the period; end date not passed yet
        self.assertEqual(sub.state, 'active')
        self.Sub._run_billing(today=self.today)  # next date is 9 months ahead, but end date has passed
        self.assertEqual(len(sub.invoice_ids), 1)
        self.assertEqual(sub.state, 'closed')

    def test_cancel_middle_period_rebilled_automatically(self):
        sub = self.activate(self.make_sub(date_start=self.today - relativedelta(months=2)))
        self.Sub._run_billing(today=self.today)
        middle = sub.invoice_ids.sorted('bl_period_start')[1]
        middle.button_cancel()
        self.assertEqual(sub.next_invoice_date, middle.bl_period_start)
        res = self.Sub._run_billing(today=self.today)
        self.assertEqual(res['errors'], 0)
        live = sub.invoice_ids.filtered(lambda m: m.state != 'cancel')
        self.assertEqual(len(live), 3)
        self.assertFalse(sub.billing_error)
        self.assertEqual(sub.next_invoice_date, self.today + relativedelta(months=1))

    def test_resume_does_not_bill_paused_periods(self):
        self.monthly.allow_pause = True
        sub = self.activate(self.make_sub(date_start=self.today - relativedelta(months=3)))
        sub.action_pause()
        sub.action_resume()
        self.assertGreaterEqual(sub.next_invoice_date, self.today)
        self.Sub._run_billing(today=self.today)
        self.assertLessEqual(len(sub.invoice_ids), 1)

    def test_cannot_delete_active_subscription(self):
        sub = self.activate(self.make_sub())
        with self.assertRaises(UserError):
            sub.with_user(self.staff).unlink()

    def test_can_delete_draft(self):
        self.make_sub().with_user(self.staff).unlink()
