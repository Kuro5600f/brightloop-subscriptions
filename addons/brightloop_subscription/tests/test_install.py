from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestInstall(TransactionCase):
    def test_module_installed(self):
        module = self.env['ir.module.module'].search([('name', '=', 'brightloop_subscription')])
        self.assertEqual(module.state, 'installed')
