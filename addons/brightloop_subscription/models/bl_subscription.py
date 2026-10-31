from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

STATES = [
    ('draft', 'Draft'),
    ('quotation', 'Quotation'),
    ('confirmed', 'Confirmed'),
    ('active', 'Active'),
    ('paused', 'Paused'),
    ('closed', 'Closed'),
]


class BlSubscription(models.Model):
    _name = 'bl.subscription'
    _description = 'Subscription'
    _inherit = ['mail.thread']
    _order = 'id desc'

    name = fields.Char('Number', required=True, readonly=True, copy=False, default='New')
    partner_id = fields.Many2one('res.partner', 'Customer', required=True, index=True, tracking=True)
    plan_id = fields.Many2one('bl.plan', required=True, tracking=True)
    template_id = fields.Many2one('bl.quote.template', 'Quotation Template')
    state = fields.Selection(STATES, default='draft', required=True, index=True, copy=False, tracking=True)
    date_start = fields.Date('Start Date', required=True, default=fields.Date.context_today)
    date_end = fields.Date('Expiry Date')
    quote_expiry_date = fields.Date('Quote Valid Until', copy=False)
    payment_term_id = fields.Many2one('account.payment.term', 'Payment Terms')
    next_invoice_date = fields.Date(index=True, copy=False, tracking=True)
    line_ids = fields.One2many('bl.subscription.line', 'subscription_id', 'Lines', copy=True)
    user_id = fields.Many2one('res.users', 'Salesperson', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company)
    currency_id = fields.Many2one(related='company_id.currency_id')
    amount_untaxed = fields.Monetary(compute='_compute_amounts', store=True)
    amount_tax = fields.Monetary(compute='_compute_amounts', store=True)
    amount_total = fields.Monetary(compute='_compute_amounts', store=True)
    invoice_ids = fields.One2many('account.move', 'bl_subscription_id', 'Invoices')
    invoice_count = fields.Integer(compute='_compute_invoice_count')
    billing_error = fields.Text(copy=False)
    renewed_from_id = fields.Many2one('bl.subscription', 'Renewal Of', copy=False, readonly=True)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('bl.subscription') or 'New'
        return super().create(vals_list)

    @api.depends('line_ids.price_subtotal', 'line_ids.price_total')
    def _compute_amounts(self):
        for sub in self:
            sub.amount_untaxed = sum(sub.line_ids.mapped('price_subtotal'))
            sub.amount_total = sum(sub.line_ids.mapped('price_total'))
            sub.amount_tax = sub.amount_total - sub.amount_untaxed

    def _compute_invoice_count(self):
        for sub in self:
            sub.invoice_count = len(sub.invoice_ids)

    @api.constrains('date_start', 'date_end')
    def _check_dates(self):
        for sub in self:
            if sub.date_end and sub.date_end < sub.date_start:
                raise ValidationError("Expiry date must be after the start date.")

    @api.onchange('template_id')
    def _onchange_template_id(self):
        tmpl = self.template_id
        if not tmpl:
            return
        self.plan_id = tmpl.plan_id
        self.quote_expiry_date = fields.Date.context_today(self) + timedelta(days=tmpl.validity_days)
        self.line_ids = [(5, 0, 0)] + [
            (0, 0, {'product_id': l.product_id.id, 'quantity': l.quantity}) for l in tmpl.line_ids]

    # --- lifecycle -------------------------------------------------------

    def _require_state(self, *states):
        for sub in self:
            if sub.state not in states:
                raise UserError("%s is %s; this action needs state: %s." % (
                    sub.name, dict(STATES)[sub.state], ', '.join(dict(STATES)[s] for s in states)))

    def action_send_quote(self):
        self._require_state('draft')
        for sub in self:
            if not sub.line_ids:
                raise UserError("Add at least one product line before sending the quotation.")
            if not sub.quote_expiry_date:
                sub.quote_expiry_date = fields.Date.context_today(sub) + timedelta(
                    days=sub.template_id.validity_days or 30)
        self.state = 'quotation'

    def action_confirm(self):
        self._require_state('quotation')
        today = fields.Date.context_today(self)
        for sub in self:
            if sub.quote_expiry_date and sub.quote_expiry_date < today:
                raise UserError("Quotation %s expired on %s." % (sub.name, sub.quote_expiry_date))
            if sum(sub.line_ids.mapped('quantity')) < sub.plan_id.min_qty:
                raise UserError("Plan %s needs a total quantity of at least %s." % (
                    sub.plan_id.name, sub.plan_id.min_qty))
            if not sub.plan_id.is_available(sub.date_start):
                raise UserError("Plan %s is not available on %s." % (sub.plan_id.name, sub.date_start))
        self.state = 'confirmed'

    def action_activate(self):
        self._require_state('confirmed')
        for sub in self:
            sub.write({'state': 'active', 'next_invoice_date': sub.date_start})

    def action_pause(self):
        self._require_state('active')
        if self.filtered(lambda s: not s.plan_id.allow_pause):
            raise UserError("This plan does not allow pausing.")
        self.state = 'paused'

    def action_resume(self):
        self._require_state('paused')
        today = fields.Date.context_today(self)
        for sub in self:
            # paused periods are not billed: restart at the first period on or after today
            next_date = sub.next_invoice_date or sub.date_start
            while next_date < today:
                next_date = sub.plan_id.next_date(next_date)
            sub.write({'state': 'active', 'next_invoice_date': next_date})

    def unlink(self):
        if self.filtered(lambda s: s.state not in ('draft', 'quotation')):
            raise UserError("Only draft or quotation subscriptions can be deleted. Close it instead.")
        return super().unlink()

    def action_close(self):
        self._require_state('active', 'paused')
        today = fields.Date.context_today(self)
        for sub in self:
            if sub.date_end and sub.date_end > today and not sub.plan_id.allow_early_close:
                raise UserError("This plan does not allow closing before the expiry date.")
        self.state = 'closed'

    def action_renew(self):
        self.ensure_one()
        self._require_state('closed')
        if not self.plan_id.allow_renew:
            raise UserError("This plan does not allow renewal.")
        start = (self.date_end and self.date_end + timedelta(days=1)) or fields.Date.context_today(self)
        renewal = self.copy({'date_start': start, 'date_end': False, 'renewed_from_id': self.id})
        return {
            'type': 'ir.actions.act_window', 'res_model': 'bl.subscription',
            'res_id': renewal.id, 'view_mode': 'form',
        }

    def action_view_invoices(self):
        self.ensure_one()
        action = self.env['ir.actions.act_window']._for_xml_id('account.action_move_out_invoice_type')
        action['domain'] = [('bl_subscription_id', '=', self.id)]
        action['context'] = {'create': False}
        return action


class BlSubscriptionLine(models.Model):
    _name = 'bl.subscription.line'
    _description = 'Subscription Line'

    subscription_id = fields.Many2one('bl.subscription', required=True, ondelete='cascade', index=True)
    product_id = fields.Many2one('product.product', required=True, domain=[('sale_ok', '=', True)])
    quantity = fields.Float(default=1.0, required=True)
    price_unit = fields.Float('Unit Price', compute='_compute_price_unit', store=True, readonly=False)
    tax_ids = fields.Many2many('account.tax', string='Taxes', compute='_compute_tax_ids', store=True,
                               readonly=False, domain=[('type_tax_use', '=', 'sale')])
    currency_id = fields.Many2one(related='subscription_id.currency_id')
    price_subtotal = fields.Monetary('Subtotal', compute='_compute_totals', store=True)
    price_total = fields.Monetary('Total', compute='_compute_totals', store=True)

    _sql_constraints = [('qty_positive', 'CHECK(quantity > 0)', 'Quantity must be positive.')]

    @api.depends('product_id')
    def _compute_price_unit(self):
        for line in self:
            # lst_price already includes variant price_extra
            line.price_unit = line.product_id.lst_price

    @api.depends('product_id')
    def _compute_tax_ids(self):
        for line in self:
            line.tax_ids = line.product_id.taxes_id.filtered(
                lambda t: t.company_id == line.subscription_id.company_id or not t.company_id)

    @api.depends('quantity', 'price_unit', 'tax_ids')
    def _compute_totals(self):
        for line in self:
            res = line.tax_ids.compute_all(
                line.price_unit, line.currency_id, line.quantity, line.product_id, line.subscription_id.partner_id)
            line.price_subtotal = res['total_excluded']
            line.price_total = res['total_included']
