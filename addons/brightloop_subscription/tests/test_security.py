from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import BlCase


@tagged('post_install', '-at_install')
class TestSecurity(BlCase):
    def test_staff_cannot_create_plan(self):
        with self.assertRaises(AccessError):
            self.env['bl.plan'].with_user(self.staff).create({'name': 'X', 'billing_period': 'month'})

    def test_admin_can_create_plan(self):
        plan = self.env['bl.plan'].with_user(self.admin).create({'name': 'X', 'billing_period': 'month'})
        self.assertTrue(plan)

    def test_staff_cannot_create_internal_user(self):
        with self.assertRaises(AccessError):
            self.env['res.users'].with_user(self.staff).create({'name': 'x', 'login': 'x@x.com'})
