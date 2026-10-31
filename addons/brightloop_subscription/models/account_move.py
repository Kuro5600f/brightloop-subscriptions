from odoo import fields, models


class AccountMove(models.Model):
    _inherit = 'account.move'

    bl_subscription_id = fields.Many2one('bl.subscription', 'Subscription', index=True, readonly=True, copy=False)
    bl_period_start = fields.Date('Billing Period Start', readonly=True, copy=False)

    def init(self):
        super().init()
        # One live invoice per subscription period; cancelled ones free the period for rebilling.
        self.env.cr.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS bl_move_sub_period_uniq
            ON account_move (bl_subscription_id, bl_period_start)
            WHERE state != 'cancel' AND bl_subscription_id IS NOT NULL
        """)


class AccountMoveLine(models.Model):
    _inherit = 'account.move.line'

    bl_discount_rule_id = fields.Many2one('bl.discount.rule', 'Discount Rule', readonly=True, copy=False, index=True)
