from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

PERIOD_DELTA = {
    'day': relativedelta(days=1),
    'week': relativedelta(weeks=1),
    'month': relativedelta(months=1),
    'year': relativedelta(years=1),
}


class BlPlan(models.Model):
    _name = 'bl.plan'
    _description = 'Subscription Plan'
    _order = 'name'

    name = fields.Char(required=True)
    billing_period = fields.Selection(
        [('day', 'Daily'), ('week', 'Weekly'), ('month', 'Monthly'), ('year', 'Yearly')],
        required=True, default='month')
    min_qty = fields.Integer('Minimum Quantity', default=1)
    date_start = fields.Date('Available From')
    date_end = fields.Date('Available Until')
    auto_close = fields.Boolean('Close Automatically at End Date', default=True)
    allow_pause = fields.Boolean('Allow Pause')
    allow_early_close = fields.Boolean('Allow Early Closure', default=True)
    allow_renew = fields.Boolean('Allow Renewal', default=True)
    active = fields.Boolean(default=True)
    price_ids = fields.One2many('bl.plan.price', 'plan_id', 'Prices', copy=True)

    @api.constrains('date_start', 'date_end', 'min_qty')
    def _check_values(self):
        for plan in self:
            if plan.date_start and plan.date_end and plan.date_end < plan.date_start:
                raise ValidationError("Plan availability end must be after its start.")
            if plan.min_qty < 1:
                raise ValidationError("Minimum quantity must be at least 1.")

    def next_date(self, date):
        self.ensure_one()
        return date + PERIOD_DELTA[self.billing_period]

    def is_available(self, date):
        self.ensure_one()
        return (not self.date_start or self.date_start <= date) and (not self.date_end or date <= self.date_end)

    def price_for(self, product):
        """Plan price for this product per billing period, plus the variant's extra; None if the plan sets none."""
        self.ensure_one()
        row = self.price_ids.filtered(lambda p: p.product_tmpl_id == product.product_tmpl_id)[:1]
        return row.price + product.price_extra if row else None


class BlPlanPrice(models.Model):
    _name = 'bl.plan.price'
    _description = 'Plan Price'

    plan_id = fields.Many2one('bl.plan', required=True, ondelete='cascade', index=True)
    product_tmpl_id = fields.Many2one('product.template', 'Product', required=True)
    price = fields.Float('Price per Period', required=True, digits='Product Price')

    _sql_constraints = [('plan_product_uniq', 'unique(plan_id, product_tmpl_id)',
                         'A product can only have one price per plan.')]
