"""Load N subscriptions and time the pages the brief cares about.

Run against a throwaway DB (never the demo DB), with the stack up:
    docker compose run --rm odoo -d bl_perf -i brightloop_subscription --stop-after-init --without-demo=all
    docker compose cp tools/perf_check.py odoo:/tmp/perf_check.py
    docker compose exec -T odoo sh -c \
        "odoo shell -d bl_perf --db_host db -r odoo -w odoo --no-http --log-level=warn < /tmp/perf_check.py"
Server-side timings only (no network or browser rendering).
"""
import time

from dateutil.relativedelta import relativedelta

from odoo import fields

N = 5000
Sub = env['bl.subscription']
staff = env.ref('brightloop_subscription.user_bl_staff')
today = fields.Date.today()


def timed(label, fn, budget=2.0):
    t = time.perf_counter()
    result = fn()
    took = time.perf_counter() - t
    print('%-48s %7.3fs  %s' % (label, took, 'OK' if took < budget else 'SLOW'))
    return result


monthly = env.ref('brightloop_subscription.plan_bl_monthly')
partners = env['res.partner'].create([{'name': 'Perf Customer %05d' % i, 'is_company': True} for i in range(N // 10)])
products = env.ref('brightloop_subscription.product_bl_crm').product_variant_ids | \
    env.ref('brightloop_subscription.product_bl_support').product_variant_id


def load():
    vals = [{
        'partner_id': partners[i % len(partners)].id,
        'plan_id': monthly.id,
        'date_start': today - relativedelta(days=i % 28),
        'line_ids': [(0, 0, {'product_id': products[i % len(products)].id, 'quantity': 1 + i % 5})],
    } for i in range(N)]
    subs = Sub.create(vals)
    subs.action_send_quote()
    subs.action_confirm()
    subs.action_activate()
    env.cr.commit()
    return subs


timed('create + activate %d subscriptions' % N, load, budget=10 ** 6)
res = timed('billing run (all due, batches of 500)', lambda: Sub._run_billing(), budget=10 ** 6)
print('  -> %s' % res)
timed('confirm all new invoices', lambda: env['account.move'].search(
    [('state', '=', 'draft'), ('bl_subscription_id', '!=', False)]).action_post(), budget=10 ** 6)
env.cr.commit()

S = Sub.with_user(staff)
Move = env['account.move'].with_user(staff)
print('\nData: %d subscriptions, %d invoices' % (Sub.search_count([]), env['account.move'].search_count([])))
timed('subscription list, page 1 (80 rows + count)', lambda: S.web_search_read(
    [], {'name': {}, 'partner_id': {'fields': {'display_name': {}}}, 'plan_id': {'fields': {'display_name': {}}},
         'next_invoice_date': {}, 'amount_total': {}, 'state': {}}, limit=80, count_limit=10001))
timed('subscription list, page 50', lambda: S.web_search_read([], {'name': {}, 'state': {}}, offset=80 * 49, limit=80))
timed('subscriptions due for billing filter', lambda: S.search_count(
    [('state', '=', 'active'), ('next_invoice_date', '<=', today)]))
timed('invoice list, outstanding filter (80 rows)', lambda: Move.web_search_read(
    [('move_type', '=', 'out_invoice'), ('state', '=', 'posted'), ('payment_state', 'in', ('not_paid', 'partial'))],
    {'name': {}, 'partner_id': {'fields': {'display_name': {}}}, 'amount_residual': {}, 'payment_state': {}},
    limit=80))
timed('finance dashboard (all KPIs)', lambda: env['bl.dashboard'].with_user(staff).get_data(None, None))
timed('second billing run (nothing due, duplicate check)', lambda: Sub._run_billing(), budget=10 ** 6)
env.cr.rollback()
