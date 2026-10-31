# Brightloop Subscription Management — Design

Date: 2026-10-31 · Deadline: 21:00 same day · Solo · Odoo Hiring Hackathon

## 1. Problem and goal

Brightloop sells subscription software (products, add-ons, variants), billed daily/weekly/monthly/yearly.
Today: spreadsheets, missed renewals, hand-made invoices, hand-matched payments, slow revenue reports.

Goal: a small, working, explainable Odoo module covering
products/plans -> quotations -> subscriptions -> recurring invoices -> payments -> dashboard.
Judged on logic, data integrity, authorization and trade-offs — not completeness.

**Demo path (must work end to end):**
Admin creates product + plan -> staff creates quote from template -> quote becomes Active subscription
-> billing run creates invoice -> staff records payment -> dashboard updates.

## 2. Stack and key decisions

| Decision | Choice | Why |
|---|---|---|
| Platform | Custom Odoo 18 Community module `brightloop_subscription` | Odoo Community has no subscription app (Enterprise only); hackathon is Odoo-focused |
| Runtime | Docker Compose: `odoo:18.0` + `postgres:16` | One command for judges/advisor; no native Python/Postgres on Windows |
| Invoices, taxes, payments, PDF, email outbox | Reuse Odoo `account` (approach A) | Mature and correct; saves ~4h; time goes into what Odoo lacks |
| Products and variants | Native `product.template` + attributes with `price_extra` | "Odoo brand adds 560" is exactly `price_extra` |
| Payment terms | Native `account.payment.term` | Already exists |
| Discount application | Native invoice line `discount` % | Odoo recomputes taxes correctly; no negative-line tax edge cases |

## 3. Scope

**Must-have**
- Roles: Admin, Staff, Customer (portal) with record rules
- Plans, quote templates, subscriptions with lifecycle and visible statusbar
- Billing run (cron + "Run billing now" button), catch-up, duplicate guard, visible errors
- Discount rules auto-applied at billing, usage-limited, date-limited
- Payments via native register-payment; paid / partial / outstanding / overdue visible
- Finance dashboard (OWL client action)
- Customer portal: native `/my/invoices` + new `/my/subscriptions`
- Password policy; password reset via simulated email (Odoo outbox)
- Seed data: demo admin, staff, customer accounts, products, plans, templates, discount, subscriptions
- README, demo script, trade-offs, judge Q&A

**Stretch:** pause / renew / early-close buttons; dashboard filters beyond a date range.

**Out of scope:** real payment gateway, real SMTP delivery, proration, multi-currency, dunning, usage-based billing.

## 4. Data model

### `bl.plan`
`name`, `billing_period` (selection: day, week, month, year), `min_qty` (int, default 1),
`date_start`, `date_end` (availability window), `auto_close`, `allow_pause`, `allow_early_close`, `allow_renew` (bools), `active`.

### `bl.quote.template` / `bl.quote.template.line`
Template: `name`, `plan_id`, `validity_days` (int, default 30), `line_ids`.
Line: `template_id`, `product_id` (product.product), `quantity`.

### `bl.subscription`
| Field | Notes |
|---|---|
| `name` | sequence `SUB/0001`, unique, readonly |
| `partner_id` | customer, required, indexed |
| `plan_id` | required |
| `template_id` | optional; onchange fills plan + lines + quote expiry |
| `state` | draft, quotation, confirmed, active, paused, closed — indexed, statusbar |
| `date_start`, `date_end` | `date_end` optional (open-ended) |
| `quote_expiry_date` | from template validity |
| `payment_term_id` | native |
| `next_invoice_date` | indexed; set to `date_start` on activation |
| `line_ids` | `bl.subscription.line` |
| `amount_untaxed`, `amount_tax`, `amount_total` | computed, stored |
| `invoice_ids` | one2many on `account.move.bl_subscription_id` |
| `billing_error` | text; last billing failure, shown as red banner |
| `user_id` | salesperson |

Constraints: `date_end >= date_start`; total quantity >= `plan.min_qty`; plan available on `date_start`; no lines -> cannot confirm.

### `bl.subscription.line`
`subscription_id`, `product_id`, `quantity`, `price_unit` (default product variant price incl. `price_extra`),
`tax_ids` (default product taxes), `price_subtotal`, `price_total` (computed via `account.tax.compute_all`).

### `account.move` (inherit)
`bl_subscription_id` (indexed), `bl_period_start` (date).
Partial unique index: `(bl_subscription_id, bl_period_start) WHERE state != 'cancel' AND bl_subscription_id IS NOT NULL`.
Cancelling an invoice frees the period so it can be billed again.

### `account.move.line` (inherit)
`bl_discount_rule_id` — which rule discounted this line.

### `bl.discount.rule`
`name`, `discount_type` (fixed, percent), `value`, `min_amount`, `min_qty`, `date_start`, `date_end`,
`max_uses` (0 = unlimited), `apply_on` (subscription, products), `product_ids`, `active`,
`used_count` (computed: distinct non-cancelled invoices with a line referencing the rule).

## 5. Lifecycle

```
draft --send quote--> quotation --customer accepts--> confirmed --start date reached / activate--> active --> closed
                                                                                        active <-> paused (if plan.allow_pause)
active --early close (if plan.allow_early_close)--> closed
active --end date passed and plan.auto_close--> closed (by billing run)
closed --renew (if plan.allow_renew)--> new draft subscription copied from this one
```
Every transition is a button method that checks the current state and raises `UserError` otherwise.
Quotation past `quote_expiry_date` cannot be confirmed.

## 6. Billing run

```
subs = search([state = active, next_invoice_date <= today], order next_invoice_date, limit batch)
for sub in subs:
    with savepoint:
        while sub.next_invoice_date <= today and (not date_end or next_invoice_date <= date_end):
            create invoice (customer, payment term, lines, taxes, period start, invoice_date)
            apply best discount
            next_invoice_date += 1 billing_period
        if date_end passed and plan.auto_close: state = closed
        billing_error = False
    on exception: billing_error = message (visible), continue with next sub
```
- Duplicate protection is at the database level (unique index), not just in Python.
- Catch-up loop: a sub missed for 3 months gets 3 invoices, none skipped.
- Invoices are created in Draft; staff confirms (Odoo "Confirm" = posted). Invoice lifecycle shown: Draft -> Confirmed -> Paid.

### Discount selection
Eligible rule: active, invoice date within [date_start, date_end], `used_count < max_uses` (or unlimited),
base amount >= `min_amount`, total qty >= `min_qty`. Base = whole untaxed subtotal, or subtotal of matching product lines.
Pick the rule with the largest money value; no stacking.
Percent -> set line `discount = value`. Fixed -> convert to percent of the base (capped at 100) on the affected lines.

## 7. Payments
Native `account.payment.register` wizard: method (journal), amount, date, memo.
Odoo's `payment_state` gives not_paid / partial / paid; overdue = posted, not paid, `invoice_date_due < today`.
Invoice list gets badges for these states.

## 8. Roles and permissions

Groups (category "Brightloop"):
- `group_bl_staff` implies `account.group_account_invoice`
- `group_bl_admin` implies `group_bl_staff`, `account.group_account_manager`

| Area | Admin | Staff | Customer (portal) |
|---|---|---|---|
| Plans, templates, discount rules, taxes, products | CRUD | read | — |
| Customers, subscriptions, invoices, payments | CRUD | CRUD | read own |
| Create users / staff | yes (Settings) | no | no |

Portal record rules: `partner_id child_of user.commercial_partner_id` on `bl.subscription` (and lines).
Only admin adds staff: staff lack `base.group_erp_manager`, so they cannot create internal users.

## 9. Auth
- Unique email: Odoo login is unique; login = email.
- Password policy: override `res.users._set_password` (covers signup, reset, admin change):
  length > 8, at least one upper, one lower, one special char -> else `UserError`.
- Reset: native `auth_signup` "Reset Password". No SMTP configured, so the email stays in
  Settings -> Technical -> Emails; demo shows the link there. Stated openly as a simulation.

## 10. Dashboard
OWL client action; one RPC `bl.dashboard.get_data(date_from, date_to)` using `read_group` / SQL aggregates:
active subscription count, revenue received (payments in range), amount outstanding (sum of `amount_residual`),
overdue count + list (top 10, links), recent payments (top 10). Loading, empty and error states.

## 11. Performance
Indexes on `bl.subscription.state`, `next_invoice_date`, `partner_id`, `account.move.bl_subscription_id`.
Lists paginate natively (80 rows). Dashboard does aggregates in the database, so cost does not grow with Python loops.
Billing run processes in batches with per-subscription savepoints.
Scale story: same queries on Postgres with indexes; cron batches; read replicas/materialized views later.

## 12. Testing
Odoo `TransactionCase` tests for: billing creates one invoice per period, rerun creates none (duplicate guard),
catch-up creates N invoices, discount selection + max_uses exhaustion, password policy, state transition guards.
Plus the manual demo path on seeded data.

## 13. Deliverables
Module code, `docker-compose.yml`, seed data (demo accounts), README (setup, accounts, schema), 2-minute demo script,
trade-offs + future work, judge Q&A.
