from odoo.exceptions import UserError
from odoo.tests import TransactionCase, new_test_user, tagged

GOOD = 'Brightloop#2026'


@tagged('post_install', '-at_install')
class TestPassword(TransactionCase):
    def test_rejects_weak(self):
        check = self.env['res.users']._check_bl_password
        for bad in ('Short#1a', 'alllowercase#1', 'ALLUPPER#123', 'NoSpecial123'):
            with self.subTest(password=bad), self.assertRaises(UserError):
                check(bad)

    def test_accepts_strong(self):
        self.env['res.users']._check_bl_password(GOOD)

    def test_create_enforced(self):
        with self.assertRaises(UserError):
            new_test_user(self.env, login='weak_user', password='weakpass')

    def test_write_enforced(self):
        user = new_test_user(self.env, login='pw_user', password=GOOD)
        with self.assertRaises(UserError):
            user.write({'password': 'weak'})
        user.write({'password': 'An0ther!Strong'})

    def test_reset_password_prepares_signup(self):
        user = new_test_user(self.env, login='reset@brightloop.test', email='reset@brightloop.test', password=GOOD)
        user.action_reset_password()
        self.assertEqual(user.partner_id.signup_type, 'reset')
        self.assertIn('/web/reset_password', user.partner_id._get_signup_url())
