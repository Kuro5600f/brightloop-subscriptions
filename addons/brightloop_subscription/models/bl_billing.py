import logging

from odoo import api, fields, models

_logger = logging.getLogger(__name__)


class BlSubscriptionBilling(models.Model):
    _inherit = 'bl.subscription'

    def _invoice_line_vals(self):
        return [(0, 0, {
            'product_id': line.product_id.id,
            'name': line.product_id.display_name,
            'quantity': line.quantity,
            'price_unit': line.price_unit,
            'tax_ids': [(6, 0, line.tax_ids.ids)],
        }) for line in self.line_ids]

    def _create_invoice(self, period_start):
        """Draft customer invoice for one billing period. The DB unique index blocks a second one."""
        self.ensure_one()
        move = self.env['account.move'].create({
            'move_type': 'out_invoice',
            'partner_id': self.partner_id.id,
            'invoice_date': period_start,
            'invoice_payment_term_id': self.payment_term_id.id,
            'invoice_origin': self.name,
            'company_id': self.company_id.id,
            'bl_subscription_id': self.id,
            'bl_period_start': period_start,
            'invoice_line_ids': self._invoice_line_vals(),
        })
        self._apply_discount(move)
        return move

    def _apply_discount(self, move):
        """Apply the single most valuable eligible rule (no stacking)."""
        Rule = self.env['bl.discount.rule']
        rules = Rule._eligible(move)
        limited = rules.filtered('max_uses')
        if limited:
            # lock, then re-check: two concurrent billing runs cannot both take the last use
            self.env.cr.execute("SELECT id FROM bl_discount_rule WHERE id IN %s FOR UPDATE", [tuple(limited.ids)])
            rules = Rule._eligible(move)
        if rules:
            best = max(rules, key=lambda r: r._value_for(move))
            best._apply_to(move)
            self.env.flush_all()
        return move

    @api.model
    def _run_billing(self, today=None, batch=500):
        today = today or fields.Date.context_today(self)
        domain = [
            ('state', '=', 'active'),
            '|', ('next_invoice_date', '<=', today),
            '&', ('date_end', '<', today), ('plan_id.auto_close', '=', True),  # close even between periods
        ]
        created = errors = 0
        done = []
        while True:
            # each subscription is visited once per run, so failing ones cannot starve the rest
            subs = self.search(domain + [('id', 'not in', done)], order='next_invoice_date, id', limit=batch)
            if not subs:
                break
            done += subs.ids
            for sub in subs:
                try:
                    with self.env.cr.savepoint():
                        count = sub._bill_until(today)
                    created += count
                except Exception as e:  # noqa: BLE001 - one bad subscription must not stop the run
                    errors += 1
                    _logger.exception("Billing failed for %s", sub.name)
                    sub.billing_error = "%s (%s)" % (e, fields.Datetime.now())
        return {'invoices': created, 'errors': errors}

    def _bill_until(self, today):
        """Create every missed period up to today (catch-up), then auto-close if past the end date."""
        self.ensure_one()
        count = 0
        # periods already billed (e.g. after rewinding to a cancelled period); the DB index stays the backstop
        billed = set(self.invoice_ids.filtered(lambda m: m.state != 'cancel').mapped('bl_period_start'))
        while self.next_invoice_date <= today and (not self.date_end or self.next_invoice_date <= self.date_end):
            if self.next_invoice_date not in billed:
                self._create_invoice(self.next_invoice_date)
                count += 1
            self.next_invoice_date = self.plan_id.next_date(self.next_invoice_date)
        self.env.flush_all()  # surface unique-index violations inside the savepoint
        if self.date_end and self.date_end < today and self.next_invoice_date > self.date_end \
                and self.plan_id.auto_close:
            self.state = 'closed'
        self.billing_error = False
        return count

    @api.model
    def _cron_run_billing(self):
        res = self._run_billing()
        _logger.info("Brightloop billing run: %s", res)

    def action_run_billing(self):
        res = self._run_billing()
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Billing run finished',
                'message': '%(invoices)s invoice(s) created, %(errors)s subscription(s) failed.' % res,
                'type': 'danger' if res['errors'] else 'success',
                'next': {'type': 'ir.actions.client', 'tag': 'soft_reload'},
            },
        }
