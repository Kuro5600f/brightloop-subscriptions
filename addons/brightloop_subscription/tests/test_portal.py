from odoo.exceptions import AccessError
from odoo.tests import HttpCase, new_test_user, tagged

from .common import BlCase


@tagged('post_install', '-at_install')
class TestPortalAccess(BlCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.portal = new_test_user(cls.env, login='t_portal', groups='base.group_portal')
        cls.portal.partner_id.parent_id = cls.partner
        cls.own = cls.make_sub()
        cls.other = cls.Sub.create({
            'partner_id': cls.env['res.partner'].create({'name': 'Other Co'}).id,
            'plan_id': cls.monthly.id,
            'line_ids': [(0, 0, {'product_id': cls.product.id, 'quantity': 1})]})

    def test_portal_sees_own(self):
        found = self.Sub.with_user(self.portal).search([])
        self.assertIn(self.own, found)
        self.assertNotIn(self.other, found)

    def test_portal_cannot_read_other(self):
        with self.assertRaises(AccessError):
            self.Sub.with_user(self.portal).browse(self.other.id).read(['name'])

    def test_portal_cannot_write(self):
        with self.assertRaises(AccessError):
            self.Sub.with_user(self.portal).browse(self.own.id).write({'date_end': self.today})


@tagged('post_install', '-at_install')
class TestPortalPage(HttpCase):
    def test_portal_page(self):
        env = self.env
        env['bl.subscription'].search([('state', '=', 'active')]).write({'state': 'closed'})
        partner = env['res.partner'].create({'name': 'Page Co'})
        user = new_test_user(env, login='t_portal_page', password='Portal#Page2026', groups='base.group_portal')
        user.partner_id.parent_id = partner
        plan = env['bl.plan'].create({'name': 'P', 'billing_period': 'month'})
        product = env['product.product'].create({'name': 'Page Product', 'list_price': 10})
        mine = env['bl.subscription'].create({'partner_id': partner.id, 'plan_id': plan.id,
                                              'line_ids': [(0, 0, {'product_id': product.id})]})
        theirs = env['bl.subscription'].create({'partner_id': env['res.partner'].create({'name': 'X'}).id,
                                                'plan_id': plan.id,
                                                'line_ids': [(0, 0, {'product_id': product.id})]})
        self.authenticate('t_portal_page', 'Portal#Page2026')
        res = self.url_open('/my/subscriptions')
        self.assertEqual(res.status_code, 200)
        self.assertIn(mine.name, res.text)
        self.assertNotIn(theirs.name, res.text)
        detail = self.url_open('/my/subscriptions/%s' % mine.id)
        self.assertEqual(detail.status_code, 200)
        self.assertIn('Page Product', detail.text)
        forbidden = self.url_open('/my/subscriptions/%s' % theirs.id)
        self.assertNotIn(theirs.name, forbidden.text)
