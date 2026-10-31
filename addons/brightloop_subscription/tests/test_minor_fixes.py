from dateutil.relativedelta import relativedelta

from odoo.tests import HttpCase, new_test_user, tagged

from .common import PASSWORD, BlCase


@tagged('post_install', '-at_install')
class TestMinorFixes(BlCase):
    def test_fixed_discount_exact_cents(self):
        self.env['bl.discount.rule'].create({'name': '100 off', 'discount_type': 'fixed', 'value': 100})
        sub = self.activate(self.make_sub(qty=3))  # untaxed 300
        self.Sub._run_billing(today=self.today)
        self.assertAlmostEqual(sub.invoice_ids.amount_untaxed, 200.00, places=2)

    def test_min_amount_uses_untaxed_for_tax_included_prices(self):
        incl = self.env['account.tax'].create({'name': 'Incl 15', 'amount': 15, 'amount_type': 'percent',
                                               'type_tax_use': 'sale', 'price_include_override': 'tax_included'})
        product = self.env['product.product'].create({'name': 'Gross', 'list_price': 115,
                                                      'taxes_id': [(6, 0, incl.ids)]})
        self.env['bl.discount.rule'].create({'name': 'min 1100', 'discount_type': 'percent', 'value': 10,
                                             'min_amount': 1100})
        sub = self.Sub.create({'partner_id': self.partner.id, 'plan_id': self.monthly.id, 'date_start': self.today,
                               'line_ids': [(0, 0, {'product_id': product.id, 'quantity': 10})]})  # untaxed 1000
        self.activate(sub)
        self.Sub._run_billing(today=self.today)
        self.assertFalse(sub.invoice_ids.invoice_line_ids.filtered('discount'))

    def test_batch_not_starved(self):
        # expired sub without auto-close and a failing sub must not block a good one when batch=1
        self.monthly.auto_close = False
        start = self.today - relativedelta(months=3)
        expired = self.activate(self.make_sub(date_start=start, date_end=start + relativedelta(days=5)))
        self.Sub._run_billing(today=start)  # bills its only period
        good = self.activate(self.make_sub())
        self.Sub._run_billing(today=self.today, batch=1)
        self.assertEqual(len(expired.invoice_ids), 1)
        self.assertEqual(len(good.invoice_ids), 1)

    def test_weak_plaintext_password_does_not_break_upgrade(self):
        user = new_test_user(self.env, login='legacy_pw', password=PASSWORD)
        self.env.cr.execute("UPDATE res_users SET password = 'weak' WHERE id = %s", [user.id])
        self.env['res.users'].init()  # Odoo re-hashes plaintext passwords here


@tagged('post_install', '-at_install')
class TestPortalToken(HttpCase):
    def test_bogus_token_redirects(self):
        env = self.env
        new_test_user(env, login='t_tok', password=PASSWORD, groups='base.group_portal')
        other = env['bl.subscription'].create({
            'partner_id': env['res.partner'].create({'name': 'Tok Other'}).id,
            'plan_id': env['bl.plan'].create({'name': 'P', 'billing_period': 'month'}).id})
        self.authenticate('t_tok', PASSWORD)
        res = self.url_open('/my/subscriptions/%s?access_token=x' % other.id, allow_redirects=False)
        self.assertIn(res.status_code, (302, 303))
