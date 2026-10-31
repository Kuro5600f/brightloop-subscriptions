from odoo import api, fields, models
from odoo.exceptions import ValidationError


class BlDiscountRule(models.Model):
    _name = 'bl.discount.rule'
    _description = 'Discount Rule'
    _order = 'name'

    name = fields.Char(required=True)
    discount_type = fields.Selection([('percent', 'Percentage'), ('fixed', 'Fixed Amount')],
                                     required=True, default='percent')
    value = fields.Float(required=True)
    min_amount = fields.Float('Minimum Purchase Amount')
    min_qty = fields.Float('Minimum Quantity')
    date_start = fields.Date('Valid From')
    date_end = fields.Date('Valid Until')
    max_uses = fields.Integer('Maximum Uses', help="0 means unlimited.")
    used_count = fields.Integer('Times Used', compute='_compute_used_count')
    apply_on = fields.Selection([('subscription', 'Whole Subscription'), ('products', 'Selected Products')],
                                required=True, default='subscription')
    product_ids = fields.Many2many('product.product', string='Products')
    active = fields.Boolean(default=True)

    @api.constrains('value', 'discount_type', 'date_start', 'date_end')
    def _check_values(self):
        for rule in self:
            if rule.value <= 0:
                raise ValidationError("Discount value must be positive.")
            if rule.discount_type == 'percent' and rule.value > 100:
                raise ValidationError("A percentage discount cannot exceed 100%.")
            if rule.date_start and rule.date_end and rule.date_end < rule.date_start:
                raise ValidationError("Discount end date must be after its start date.")

    def _compute_used_count(self):
        # shortcut: counts via ORM per rule; fine for tens of rules, move to read_group if rules grow large
        Line = self.env['account.move.line']
        for rule in self:
            rule.used_count = len(Line.search([
                ('bl_discount_rule_id', '=', rule.id), ('move_id.state', '!=', 'cancel')]).move_id)

    def _base_lines(self, move):
        self.ensure_one()
        lines = move.invoice_line_ids.filtered(lambda l: l.display_type == 'product')
        if self.apply_on == 'products':
            lines = lines.filtered(lambda l: l.product_id in self.product_ids)
        return lines

    def _base_amount(self, lines):
        # untaxed amount, also correct for tax-included prices (lines are not discounted yet)
        return sum(lines.mapped('price_subtotal'))

    def _value_for(self, move):
        """Money value this rule would take off the move's untaxed amount."""
        self.ensure_one()
        base = self._base_amount(self._base_lines(move))
        if self.discount_type == 'percent':
            return base * self.value / 100
        return min(self.value, base)

    def _eligible(self, move):
        day = move.invoice_date or fields.Date.context_today(self)
        self.invalidate_model(['used_count'])  # see uses made earlier in the same billing run
        rules = self.search([
            '|', ('date_start', '=', False), ('date_start', '<=', day),
            '|', ('date_end', '=', False), ('date_end', '>=', day),
        ])

        def ok(rule):
            lines = rule._base_lines(move)
            base = rule._base_amount(lines)
            return (base > 0
                    and (not rule.max_uses or rule.used_count < rule.max_uses)
                    and base >= rule.min_amount
                    and sum(lines.mapped('quantity')) >= rule.min_qty)
        return rules.filtered(ok)

    def _apply_to(self, move):
        """Percent: line discount %. Fixed: exact negative lines, one per tax set, so tax is on the discounted base."""
        self.ensure_one()
        lines = self._base_lines(move)
        if self.discount_type == 'percent':
            lines.write({'discount': self.value, 'bl_discount_rule_id': self.id})
        else:
            base = self._base_amount(lines)
            total = move.currency_id.round(min(self.value, base))
            groups = {}
            for line in lines:
                groups.setdefault(line.tax_ids, 0.0)
                groups[line.tax_ids] += line.price_subtotal
            new_lines, left = [], total
            for i, (taxes, group_base) in enumerate(groups.items()):
                # split by each tax set's share of the base; the last group takes the rounding remainder
                amount = left if i == len(groups) - 1 else move.currency_id.round(total * group_base / base)
                left -= amount
                new_lines.append((0, 0, {
                    'name': 'Discount: %s' % self.name,
                    'quantity': 1,
                    'price_unit': -amount,
                    'tax_ids': [(6, 0, taxes.ids)],
                    'bl_discount_rule_id': self.id,
                }))
            move.write({'invoice_line_ids': new_lines})
        self.invalidate_recordset(['used_count'])
