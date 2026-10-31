from odoo import api, fields, models

OPEN_INVOICE = [('move_type', '=', 'out_invoice'), ('state', '=', 'posted'),
                ('payment_state', 'in', ('not_paid', 'partial'))]


class BlDashboard(models.AbstractModel):
    _name = 'bl.dashboard'
    _description = 'Finance Dashboard'

    @api.model
    def get_data(self, date_from=None, date_to=None):
        """All KPIs in one call; every number is a DB aggregate or a LIMIT 10 query, so cost stays flat."""
        today = fields.Date.context_today(self)
        Move, Payment = self.env['account.move'], self.env['account.payment']

        pay_domain = [('payment_type', '=', 'inbound'), ('partner_type', '=', 'customer'),
                      ('state', 'not in', ('draft', 'canceled', 'rejected'))]
        if date_from:
            pay_domain.append(('date', '>=', date_from))
        if date_to:
            pay_domain.append(('date', '<=', date_to))
        [(revenue,)] = Payment._read_group(pay_domain, [], ['amount:sum'])
        [(outstanding,)] = Move._read_group(OPEN_INVOICE, [], ['amount_residual:sum'])

        overdue_domain = OPEN_INVOICE + [('invoice_date_due', '<', today)]
        overdue = Move.search(overdue_domain, order='invoice_date_due', limit=10)
        payments = Payment.search(pay_domain, order='date desc, id desc', limit=10)

        return {
            'active_count': self.env['bl.subscription'].search_count([('state', '=', 'active')]),
            'due_count': self.env['bl.subscription'].search_count(
                [('state', '=', 'active'), ('next_invoice_date', '<=', today)]),
            'revenue': revenue or 0.0,
            'outstanding': outstanding or 0.0,
            'overdue_count': Move.search_count(overdue_domain),
            'overdue': [{
                'id': m.id, 'name': m.name, 'partner': m.partner_id.display_name,
                'due_date': fields.Date.to_string(m.invoice_date_due), 'residual': m.amount_residual,
                'days_late': (today - m.invoice_date_due).days,
            } for m in overdue],
            'recent_payments': [{
                'id': p.id, 'name': p.name, 'partner': p.partner_id.display_name,
                'date': fields.Date.to_string(p.date), 'amount': p.amount,
            } for p in payments],
            'currency_symbol': self.env.company.currency_id.symbol,
        }
