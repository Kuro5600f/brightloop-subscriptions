from datetime import timedelta

from odoo.tests import tagged

from .common import BlCase


@tagged('post_install', '-at_install')
class TestDiscount(BlCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Rule = cls.env['bl.discount.rule']

    def _sub_1000(self):
        """Untaxed 1000: product A 5 x 100 = 500, product B 10 x 50 = 500."""
        sub = self.make_sub(qty=5)
        sub.line_ids = [(0, 0, {'product_id': self.product_b.id, 'quantity': 10})]
        return self.activate(sub)

    def _bill(self):
        self.Sub._run_billing(today=self.today)

    def test_percent_whole(self):
        self.Rule.create({'name': '10%', 'discount_type': 'percent', 'value': 10})
        sub = self._sub_1000()
        self._bill()
        self.assertAlmostEqual(sub.invoice_ids.amount_untaxed, 900)

    def test_fixed_products(self):
        self.Rule.create({'name': '50 off A', 'discount_type': 'fixed', 'value': 50,
                          'apply_on': 'products', 'product_ids': [(6, 0, self.product.ids)]})
        sub = self._sub_1000()
        self._bill()
        inv = sub.invoice_ids
        discount_line = inv.invoice_line_ids.filtered('bl_discount_rule_id')
        self.assertEqual(len(discount_line), 1)
        self.assertAlmostEqual(discount_line.price_subtotal, -50)
        self.assertEqual(discount_line.tax_ids, self.tax15)  # same tax as the discounted product
        self.assertFalse(inv.invoice_line_ids.filtered('discount'))  # no rounded % on product lines
        self.assertAlmostEqual(inv.amount_untaxed, 950)

    def test_fixed_split_by_tax(self):
        """Whole-subscription fixed discount over mixed taxes: tax is computed on the discounted base."""
        self.Rule.create({'name': '100 off', 'discount_type': 'fixed', 'value': 100})
        sub = self._sub_1000()  # 500 taxed 15% + 500 untaxed
        self._bill()
        inv = sub.invoice_ids
        self.assertAlmostEqual(inv.amount_untaxed, 900)
        self.assertAlmostEqual(inv.amount_tax, 67.5)  # 15% of (500 - 50)

    def test_best_rule_wins(self):
        self.Rule.create({'name': '10%', 'discount_type': 'percent', 'value': 10})
        fixed = self.Rule.create({'name': '150 off', 'discount_type': 'fixed', 'value': 150})
        sub = self._sub_1000()
        self._bill()
        self.assertAlmostEqual(sub.invoice_ids.amount_untaxed, 850)
        self.assertEqual(sub.invoice_ids.invoice_line_ids.bl_discount_rule_id, fixed)
        self.assertEqual(fixed.used_count, 1)

    def test_min_amount(self):
        self.Rule.create({'name': 'big', 'discount_type': 'percent', 'value': 10, 'min_amount': 2000})
        sub = self._sub_1000()
        self._bill()
        self.assertAlmostEqual(sub.invoice_ids.amount_untaxed, 1000)

    def test_min_qty(self):
        self.Rule.create({'name': 'bulk', 'discount_type': 'percent', 'value': 10, 'min_qty': 50})
        sub = self._sub_1000()
        self._bill()
        self.assertAlmostEqual(sub.invoice_ids.amount_untaxed, 1000)

    def test_expired(self):
        self.Rule.create({'name': 'old', 'discount_type': 'percent', 'value': 10,
                          'date_end': self.today - timedelta(days=1)})
        sub = self._sub_1000()
        self._bill()
        self.assertAlmostEqual(sub.invoice_ids.amount_untaxed, 1000)

    def test_max_uses_same_run(self):
        rule = self.Rule.create({'name': 'once', 'discount_type': 'percent', 'value': 10, 'max_uses': 1})
        a, b = self._sub_1000(), self._sub_1000()
        self._bill()
        discounted = (a.invoice_ids | b.invoice_ids).filtered(lambda m: m.amount_untaxed < 1000)
        self.assertEqual(len(discounted), 1)
        self.assertEqual(rule.used_count, 1)

    def test_cancel_frees_use(self):
        rule = self.Rule.create({'name': 'once', 'discount_type': 'percent', 'value': 10, 'max_uses': 1})
        sub = self._sub_1000()
        self._bill()
        self.assertEqual(rule.used_count, 1)
        sub.invoice_ids.button_cancel()
        rule.invalidate_recordset(['used_count'])
        self.assertEqual(rule.used_count, 0)

    def test_fixed_capped_at_100(self):
        self.Rule.create({'name': 'huge', 'discount_type': 'fixed', 'value': 5000})
        sub = self._sub_1000()
        self._bill()
        self.assertAlmostEqual(sub.invoice_ids.amount_untaxed, 0)
