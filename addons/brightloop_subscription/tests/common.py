from odoo.tests import TransactionCase, new_test_user


class BlCase(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.staff = new_test_user(cls.env, login='t_staff', groups='brightloop_subscription.group_bl_staff')
        cls.admin = new_test_user(cls.env, login='t_admin', groups='brightloop_subscription.group_bl_admin')
        cls.Plan = cls.env['bl.plan']
        cls.monthly = cls.Plan.create({'name': 'Monthly', 'billing_period': 'month'})
