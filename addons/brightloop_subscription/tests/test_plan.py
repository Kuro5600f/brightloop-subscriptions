from datetime import date

from odoo.tests import tagged

from .common import BlCase


@tagged('post_install', '-at_install')
class TestPlan(BlCase):
    def test_next_date(self):
        P = self.Plan
        self.assertEqual(self.monthly.next_date(date(2026, 1, 31)), date(2026, 2, 28))
        yearly = P.create({'name': 'Y', 'billing_period': 'year'})
        self.assertEqual(yearly.next_date(date(2026, 1, 1)), date(2027, 1, 1))
        weekly = P.create({'name': 'W', 'billing_period': 'week'})
        self.assertEqual(weekly.next_date(date(2026, 1, 1)), date(2026, 1, 8))
        daily = P.create({'name': 'D', 'billing_period': 'day'})
        self.assertEqual(daily.next_date(date(2026, 1, 1)), date(2026, 1, 2))

    def test_is_available(self):
        plan = self.Plan.create({'name': 'Y26', 'billing_period': 'month',
                                 'date_start': date(2026, 1, 1), 'date_end': date(2026, 12, 31)})
        self.assertTrue(plan.is_available(date(2026, 6, 1)))
        self.assertFalse(plan.is_available(date(2027, 1, 1)))
        self.assertTrue(self.monthly.is_available(date(2030, 1, 1)))
