from dateutil.relativedelta import relativedelta

from odoo import api, fields, models

MODULE = 'brightloop_subscription'


class BlSubscriptionSeed(models.Model):
    _inherit = 'bl.subscription'

    @api.model
    def _bl_load_seed(self):
        """Realistic demo data: variant pricing, tax, template and subscriptions in every state with history."""
        ref = lambda x: self.env.ref('%s.%s' % (MODULE, x))  # noqa: E731
        today = fields.Date.context_today(self)
        company = self.env.company
        if not company.chart_template:
            # invoices need journals, accounts and tax groups
            self.env['account.chart.template'].try_loading('generic_coa', company, install_demo=False)

        crm = ref('product_bl_crm')
        odoo_value = crm.attribute_line_ids.product_template_value_ids.filtered(
            lambda v: v.product_attribute_value_id == ref('attr_bl_brand_odoo'))
        odoo_value.price_extra = 560
        crm_odoo = crm.product_variant_ids.filtered(lambda p: odoo_value in p.product_template_attribute_value_ids)
        crm_generic = crm.product_variant_ids - crm_odoo
        analytics = ref('product_bl_analytics').product_variant_id
        support = ref('product_bl_support').product_variant_id

        # own tax group, so invoice totals read "GST 18%" instead of the chart's generic group name
        group = self.env['account.tax.group'].create({'name': 'GST 18%', 'company_id': company.id})
        tax = self.env['account.tax'].create({
            'name': 'GST 18%', 'amount': 18, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'tax_group_id': group.id})
        (crm | ref('product_bl_analytics') | ref('product_bl_support')).taxes_id = [(6, 0, tax.ids)]
        ref('discount_bl_analytics').product_ids = [(6, 0, analytics.ids)]

        monthly, yearly, weekly = ref('plan_bl_monthly'), ref('plan_bl_yearly'), ref('plan_bl_weekly')
        # yearly is cheaper than 12 x monthly: plan-specific price per seat
        yearly.price_ids = [(0, 0, {'product_tmpl_id': crm.id, 'price': 10000})]
        template = self.env['bl.quote.template'].create({
            'name': 'CRM Starter', 'plan_id': monthly.id, 'validity_days': 30,
            'line_ids': [(0, 0, {'product_id': crm_odoo.id, 'quantity': 1}),
                         (0, 0, {'product_id': support.id, 'quantity': 1})]})
        self.env['ir.model.data']._update_xmlids([{
            'xml_id': '%s.template_bl_crm_starter' % MODULE, 'record': template, 'noupdate': True}])

        term_30 = self.env.ref('account.account_payment_term_30days', raise_if_not_found=False)
        immediate = self.env.ref('account.account_payment_term_immediate', raise_if_not_found=False)

        def sub(partner, plan, start, lines, **vals):
            return self.create({
                'partner_id': ref(partner).id, 'plan_id': plan.id, 'date_start': start,
                'line_ids': [(0, 0, {'product_id': p.id, 'quantity': q}) for p, q in lines], **vals})

        def go_active(s):
            s.action_send_quote()
            s.action_confirm()
            s.action_activate()
            return s

        def pay(invoice, amount, day):
            self.env['account.payment.register'].with_context(
                active_model='account.move', active_ids=invoice.ids
            ).create({'amount': amount, 'payment_date': day}).action_create_payments()

        # Acme (portal customer): 2 past months billed, first paid; current month due for the live billing demo.
        acme = go_active(sub('partner_bl_acme', monthly, today - relativedelta(months=2),
                             [(crm_odoo, 1), (support, 1), (analytics, 1)],
                             payment_term_id=term_30 and term_30.id, template_id=template.id))
        acme._bill_until(today - relativedelta(months=1))
        acme.invoice_ids.action_post()
        first = acme.invoice_ids.sorted('bl_period_start')[0]
        pay(first, first.amount_total, first.invoice_date + relativedelta(days=5))

        # Globex: yearly, two invoices, first partially paid, second overdue.
        globex = go_active(sub('partner_bl_globex', yearly, today - relativedelta(months=13),
                               [(crm_generic, 5)], payment_term_id=immediate and immediate.id))
        globex._bill_until(today - relativedelta(months=1))
        globex.invoice_ids.action_post()
        old = globex.invoice_ids.sorted('bl_period_start')[0]
        pay(old, round(old.amount_total / 2, 2), old.invoice_date + relativedelta(days=10))

        # Pipeline and history in the other states.
        quote = sub('partner_bl_initech', monthly, today + relativedelta(days=7),
                    [(crm_odoo, 3), (analytics, 3)], template_id=template.id)
        quote.action_send_quote()
        sub('partner_bl_umbrella', monthly, today, [(crm_generic, 2)])
        closed = go_active(sub('partner_bl_umbrella', weekly, today - relativedelta(months=3),
                               [(crm_generic, 1)], date_end=today - relativedelta(months=2)))
        closed._bill_until(today)
        closed.invoice_ids.action_post()
        for inv in closed.invoice_ids:
            pay(inv, inv.amount_total, inv.invoice_date)
        paused = go_active(sub('partner_bl_initech', monthly, today - relativedelta(days=10), [(support, 2)]))
        paused.action_pause()
