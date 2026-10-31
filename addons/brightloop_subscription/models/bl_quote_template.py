from odoo import fields, models


class BlQuoteTemplate(models.Model):
    _name = 'bl.quote.template'
    _description = 'Quotation Template'
    _order = 'name'

    name = fields.Char(required=True)
    plan_id = fields.Many2one('bl.plan', required=True)
    validity_days = fields.Integer('Quote Valid For (days)', default=30)
    line_ids = fields.One2many('bl.quote.template.line', 'template_id', 'Products', copy=True)
    active = fields.Boolean(default=True)


class BlQuoteTemplateLine(models.Model):
    _name = 'bl.quote.template.line'
    _description = 'Quotation Template Line'

    template_id = fields.Many2one('bl.quote.template', required=True, ondelete='cascade')
    product_id = fields.Many2one('product.product', required=True, domain=[('sale_ok', '=', True)])
    quantity = fields.Float(default=1.0)
