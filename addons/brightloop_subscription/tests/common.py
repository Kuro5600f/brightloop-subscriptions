from datetime import date

from odoo import fields
from odoo.tests import TransactionCase, new_test_user


class BlCase(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # isolate from seed data: tests bill and discount only their own records
        cls.env['bl.subscription'].search([('state', '=', 'active')]).write({'state': 'closed'})
        cls.env['bl.discount.rule'].search([]).write({'active': False})
        cls.staff = new_test_user(cls.env, login='t_staff', groups='brightloop_subscription.group_bl_staff')
        cls.admin = new_test_user(cls.env, login='t_admin', groups='brightloop_subscription.group_bl_admin')
        cls.Plan = cls.env['bl.plan']
        cls.Sub = cls.env['bl.subscription']
        cls.monthly = cls.Plan.create({'name': 'Monthly', 'billing_period': 'month'})
        cls.today = fields.Date.context_today(cls.env['bl.plan'])
        cls.tax15 = cls.env['account.tax'].create({
            'name': 'BL 15%', 'amount': 15, 'amount_type': 'percent', 'type_tax_use': 'sale'})
        cls.product = cls.env['product.product'].create({
            'name': 'BL CRM', 'list_price': 100, 'taxes_id': [(6, 0, cls.tax15.ids)]})
        cls.product_b = cls.env['product.product'].create({
            'name': 'BL Support', 'list_price': 50, 'taxes_id': [(6, 0, [])]})
        cls.partner = cls.env['res.partner'].create({'name': 'Acme Test', 'email': 'acme@test.test'})

    @classmethod
    def make_sub(cls, qty=2, plan=None, date_start=None, **vals):
        return cls.Sub.create({
            'partner_id': cls.partner.id,
            'plan_id': (plan or cls.monthly).id,
            'date_start': date_start or cls.today,
            'line_ids': [(0, 0, {'product_id': cls.product.id, 'quantity': qty})],
            **vals,
        })

    @classmethod
    def activate(cls, sub):
        sub.action_send_quote()
        sub.action_confirm()
        sub.action_activate()
        return sub
