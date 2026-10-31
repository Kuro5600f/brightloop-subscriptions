from dateutil.relativedelta import relativedelta

from odoo import api, fields, models

OPEN_INVOICE = [('move_type', '=', 'out_invoice'), ('state', '=', 'posted'),
                ('payment_state', 'in', ('not_paid', 'partial'))]
CUSTOMER_INVOICES = [('move_type', '=', 'out_invoice'), ('state', '!=', 'cancel')]


class BlDashboard(models.AbstractModel):
    _name = 'bl.dashboard'
    _description = 'Finance Dashboard'

    def _status_domains(self, today):
        """Invoice status -> domain. One source of truth for the filter pills, counts and row labels."""
        overdue = OPEN_INVOICE + [('invoice_date_due', '<', today)]
        return {
            'all': [],
            'paid': [('state', '=', 'posted'), ('payment_state', 'in', ('paid', 'in_payment'))],
            'pending': OPEN_INVOICE + ['|', ('invoice_date_due', '>=', today), ('invoice_date_due', '=', False)],
            'overdue': overdue,
            'draft': [('state', '=', 'draft')],
        }

    def _status_of(self, move, today):
        if move.state == 'draft':
            return 'draft'
        if move.payment_state in ('paid', 'in_payment'):
            return 'paid'
        if move.invoice_date_due and move.invoice_date_due < today:
            return 'overdue'
        return 'partial' if move.payment_state == 'partial' else 'pending'

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
        [(overdue_amount,)] = Move._read_group(overdue_domain, [], ['amount_residual:sum'])
        overdue = Move.search(overdue_domain, order='invoice_date_due', limit=10)
        payments = Payment.search(pay_domain, order='date desc, id desc', limit=10)

        invoiced_domain = [('move_type', '=', 'out_invoice'), ('state', '=', 'posted')]
        if date_from:
            invoiced_domain.append(('invoice_date', '>=', date_from))
        if date_to:
            invoiced_domain.append(('invoice_date', '<=', date_to))
        [(invoiced, invoiced_count)] = Move._read_group(invoiced_domain, [], ['amount_total:sum', '__count'])

        monthly = self._monthly(today)
        return {
            'user_first_name': (self.env.user.name or '').split(' ')[0],
            'active_count': self.env['bl.subscription'].search_count([('state', '=', 'active')]),
            'due_count': self.env['bl.subscription'].search_count(
                [('state', '=', 'active'), ('next_invoice_date', '<=', today)]),
            'invoiced': invoiced or 0.0,
            'invoiced_count': invoiced_count,
            'revenue': revenue or 0.0,
            'outstanding': outstanding or 0.0,
            'overdue_amount': overdue_amount or 0.0,
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
            'monthly': monthly,
            'status_split': {k: sum(m[k] for m in monthly) for k in ('paid', 'pending', 'overdue')},
            'currency_symbol': self.env.company.currency_id.symbol,
        }

    def _monthly(self, today):
        """Last 6 months of posted invoices by invoice month: paid / pending / overdue amounts (3 grouped queries)."""
        Move = self.env['account.move']
        start = today.replace(day=1) - relativedelta(months=5)
        base = [('move_type', '=', 'out_invoice'), ('state', '=', 'posted'), ('invoice_date', '>=', start)]
        totals = dict(Move._read_group(base, ['invoice_date:month'], ['amount_total:sum']))
        residual = dict(Move._read_group(base, ['invoice_date:month'], ['amount_residual:sum']))
        overdue = dict(Move._read_group(base + [('invoice_date_due', '<', today)], ['invoice_date:month'],
                                        ['amount_residual:sum']))
        months = []
        for i in range(6):
            month = start + relativedelta(months=i)
            key = next((k for k in totals if k.year == month.year and k.month == month.month), None)
            total, res = totals.get(key, 0.0), residual.get(key, 0.0)
            late = overdue.get(key, 0.0) if key else 0.0
            months.append({
                'label': month.strftime('%b'), 'year': month.year,
                'paid': round(total - res, 2), 'pending': round(res - late, 2), 'overdue': round(late, 2),
            })
        return months

    @api.model
    def list_invoices(self, status='all', search='', offset=0, limit=8):
        """Customer invoices for the dashboard table: filter pill, search on number/customer, paging, counts."""
        today = fields.Date.context_today(self)
        Move = self.env['account.move']
        domains = self._status_domains(today)
        search_domain = []
        if search:
            search_domain = ['|', ('name', 'ilike', search), ('partner_id.name', 'ilike', search)]
        domain = CUSTOMER_INVOICES + search_domain + domains.get(status, [])
        moves = Move.search(domain, order='invoice_date desc, id desc', offset=offset, limit=limit)
        return {
            'rows': [{
                'id': m.id,
                'name': m.name if m.name and m.name != '/' else 'Draft',
                'partner': m.partner_id.display_name,
                'subscription': m.bl_subscription_id.name or '',
                'invoice_date': fields.Date.to_string(m.invoice_date),
                'due_date': fields.Date.to_string(m.invoice_date_due),
                'amount': m.amount_total,
                'residual': m.amount_residual,
                'status': self._status_of(m, today),
            } for m in moves],
            'total': Move.search_count(domain),
            'counts': {k: Move.search_count(CUSTOMER_INVOICES + search_domain + d) for k, d in domains.items()},
            'currency_symbol': self.env.company.currency_id.symbol,
        }

    @api.model
    def invoice_detail(self, invoice_id):
        """Read through the ORM as the current user: record rules and access rights apply."""
        m = self.env['account.move'].browse(invoice_id).exists()
        if not m or m.move_type != 'out_invoice':
            return False
        today = fields.Date.context_today(self)
        p = m.partner_id
        return {
            'id': m.id,
            'name': m.name if m.name and m.name != '/' else 'Draft',
            'status': self._status_of(m, today),
            'state': m.state,
            'invoice_date': fields.Date.to_string(m.invoice_date),
            'due_date': fields.Date.to_string(m.invoice_date_due),
            'partner': {'id': p.id, 'name': p.display_name, 'email': p.email or '', 'phone': p.phone or '',
                        'address': ', '.join(filter(None, [p.street, p.city, p.country_id.name]))},
            'subscription': m.bl_subscription_id.name or '',
            'subscription_id': m.bl_subscription_id.id,
            'lines': [{'name': l.name, 'quantity': l.quantity, 'price_unit': l.price_unit,
                       'discount': l.discount, 'subtotal': l.price_subtotal}
                      for l in m.invoice_line_ids.filtered(lambda l: l.display_type == 'product')],
            'amount_untaxed': m.amount_untaxed,
            'amount_tax': m.amount_tax,
            'amount_total': m.amount_total,
            'residual': m.amount_residual,
            'currency_symbol': m.currency_id.symbol,
        }
