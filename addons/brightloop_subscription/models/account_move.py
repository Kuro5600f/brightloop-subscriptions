from odoo import fields, models


class AccountMove(models.Model):
    _inherit = 'account.move'

    bl_subscription_id = fields.Many2one('bl.subscription', 'Subscription', index=True, readonly=True, copy=False)
    bl_period_start = fields.Date('Billing Period Start', readonly=True, copy=False)
