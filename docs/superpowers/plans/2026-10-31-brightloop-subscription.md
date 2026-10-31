# Brightloop Subscription Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Odoo 18 Community module that runs subscriptions from plan to paid invoice, with a finance dashboard and customer portal.

**Architecture:** One addon `brightloop_subscription` on top of `account`, `portal`, `auth_signup`. Our models: plans, quote templates, subscriptions, discount rules. Odoo's models: products/variants, taxes, payment terms, invoices, payments. Billing run turns due subscriptions into draft invoices with a DB-level duplicate guard.

**Tech Stack:** Odoo 18.0 (Python 3, ORM, QWeb, OWL), Postgres 16, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-31-brightloop-design.md`

## Global Constraints

- Odoo `18.0` Community only; no Enterprise modules.
- Module path `addons/brightloop_subscription`; model prefix `bl.`; XML id prefix none (module-scoped).
- Depends only on: `account`, `portal`, `auth_signup`, `web`.
- Subscription number sequence `SUB/0001` (prefix `SUB/`, padding 4).
- States: subscription `draft, quotation, confirmed, active, paused, closed`; invoice shown as Draft -> Confirmed -> Paid.
- Billing periods: `day, week, month, year`.
- Password: length > 8 (i.e. >= 9), >= 1 uppercase, >= 1 lowercase, >= 1 special (non-alphanumeric).
- No real SMTP, no payment gateway; email simulation visible in Settings -> Technical -> Emails.
- Commit messages: plain, no Claude co-author trailer.
- Deadline 21:00; tasks 1-5 are the demo path and come first.

## Test command (used by every task)

```bash
docker compose run --rm odoo -d bl_test -i brightloop_subscription --test-tags /brightloop_subscription --stop-after-init
```
Expected on pass: log ends with `0 failed, 0 error(s)` for `brightloop_subscription`. Use `-u` instead of `-i` after the first run on `bl_test`.

## Review Focus

1. Cancelled invoice then billing rerun -> that period is billed again exactly once (partial unique index excludes cancelled). Test in Task 4.
2. Subscription with `date_end` inside a catch-up window -> invoices stop at `date_end`, then closes if `auto_close`. Test in Task 4.
3. Discount with `max_uses = 1` and two due subscriptions in the same run -> only the first invoice gets it (`used_count` must be recomputed inside the run). Test in Task 5.
4. Portal customer reading another customer's subscription -> `AccessError`. Test in Task 7.
5. Staff user creating an internal user -> `AccessError`. Test in Task 2.

---

### Task 1: Docker + empty installable module

**Files:**
- Create: `docker-compose.yml`, `.gitignore`
- Create: `addons/brightloop_subscription/__manifest__.py`, `__init__.py`, `models/__init__.py`, `tests/__init__.py`, `tests/test_install.py`

**Interfaces:**
- Produces: running stack at `http://localhost:8069`, master password `admin`; the test command above works.

- [ ] **Step 1:** `docker-compose.yml`: service `db` (`postgres:16`, `POSTGRES_USER=odoo`, `POSTGRES_PASSWORD=odoo`, `POSTGRES_DB=postgres`, named volume), service `odoo` (`odoo:18.0`, depends_on db, ports `8069:8069`, env `HOST=db USER=odoo PASSWORD=odoo`, volume `./addons:/mnt/extra-addons`, named volume for `/var/lib/odoo`). `.gitignore`: `__pycache__/`, `*.pyc`.
- [ ] **Step 2:** Manifest: name "Brightloop Subscriptions", version `18.0.1.0.0`, license `LGPL-3`, depends per Global Constraints, `application: True`, empty `data` list.
- [ ] **Step 3:** `test_install.py`: `TransactionCase` with `test_module_installed` asserting `self.env['ir.module.module'].search([('name','=','brightloop_subscription')]).state == 'installed'`.
- [ ] **Step 4:** `docker compose up -d db`, then run test command. Expected: PASS.
- [ ] **Step 5:** Commit `Add Docker setup and empty module`.

### Task 2: Security groups, plans, quote templates, menus

**Files:**
- Create: `security/bl_security.xml`, `security/ir.model.access.csv`
- Create: `models/bl_plan.py`, `models/bl_quote_template.py`
- Create: `views/bl_plan_views.xml`, `views/bl_quote_template_views.xml`, `views/bl_menus.xml`
- Test: `tests/test_security.py`, `tests/test_plan.py`

**Interfaces:**
- Produces: groups `brightloop_subscription.group_bl_staff` (implies `account.group_account_invoice`), `brightloop_subscription.group_bl_admin` (implies staff + `account.group_account_manager`); module category `Brightloop`.
- Produces: `bl.plan` fields per spec §4; method `bl.plan.next_date(date) -> date` (adds one `billing_period` via `relativedelta`); method `bl.plan.is_available(date) -> bool`.
- Produces: `bl.quote.template` (`name, plan_id, validity_days=30, line_ids`), `bl.quote.template.line` (`template_id, product_id, quantity=1`).
- Produces: root menu `menu_bl_root` with submenus Subscriptions, Billing, Configuration (Configuration visible to admin group only).

- [ ] **Step 1: Write failing tests**
  - `test_plan.py::test_next_date`: monthly plan `next_date(date(2026,1,31)) == date(2026,2,28)`; yearly `next_date(date(2026,1,1)) == date(2027,1,1)`; weekly +7 days; daily +1.
  - `test_plan.py::test_is_available`: plan with `date_start=2026-01-01, date_end=2026-12-31` -> True for 2026-06-01, False for 2027-01-01; no dates -> True.
  - `test_security.py::test_staff_cannot_create_plan`: staff user `with_user(staff).env['bl.plan'].create(...)` raises `AccessError`.
  - `test_security.py::test_staff_cannot_create_internal_user`: `with_user(staff).env['res.users'].create({'name':'x','login':'x@x.com'})` raises `AccessError`.
- [ ] **Step 2:** Run test command. Expected: FAIL (models missing).
- [ ] **Step 3:** Implement models, groups, access CSV (admin CRUD on plan/template/lines; staff read), list+form views, menus. Add files to manifest `data` in order: security xml, csv, views, menus.
- [ ] **Step 4:** Run test command. Expected: PASS.
- [ ] **Step 5:** Commit `Add roles, plans and quote templates`.

### Task 3: Subscriptions and lifecycle

**Files:**
- Create: `models/bl_subscription.py` (subscription + line), `data/bl_sequence.xml`, `views/bl_subscription_views.xml`
- Modify: `security/ir.model.access.csv` (staff + admin CRUD on subscription and line), `__manifest__.py`
- Test: `tests/test_subscription.py`

**Interfaces:**
- Consumes: `bl.plan.is_available`, `bl.quote.template`.
- Produces: `bl.subscription` fields per spec §4; `bl.subscription.line` with `price_subtotal`, `price_total` computed via `tax_ids.compute_all(price_unit, currency, quantity, product, partner)`.
- Produces button methods (each raises `UserError` when called from a wrong state):
  `action_send_quote()` draft->quotation, `action_confirm()` quotation->confirmed, `action_activate()` confirmed->active and sets `next_invoice_date = date_start`, `action_close()` active/paused->closed (requires `plan.allow_early_close` when `date_end` is in the future), `action_pause()` / `action_resume()` (require `plan.allow_pause`), `action_renew()` closed->new draft copy (requires `plan.allow_renew`), returns form action of the copy.
- Produces: onchange on `template_id` fills `plan_id`, lines, `quote_expiry_date = today + validity_days`.

- [ ] **Step 1: Write failing tests** (`test_subscription.py`):
  - `test_sequence`: two created subscriptions get names starting `SUB/` and differ.
  - `test_happy_lifecycle`: draft -> send -> confirm -> activate gives `state == 'active'` and `next_invoice_date == date_start`.
  - `test_wrong_transition`: `action_activate()` on draft raises `UserError`.
  - `test_expired_quote`: `quote_expiry_date` yesterday -> `action_confirm()` raises `UserError`.
  - `test_min_qty`: plan `min_qty=5`, one line qty 2 -> `action_confirm()` raises `ValidationError` or `UserError`.
  - `test_no_lines`: `action_send_quote()` with no lines raises `UserError`.
  - `test_totals`: one line qty 2, price 100, 15% tax -> `amount_untaxed == 200`, `amount_total == 230`.
  - `test_variant_price`: product with attribute value `price_extra=560`, `lst_price` base 1000 -> new line default `price_unit == 1560`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Form header: buttons per state + `statusbar_visible="draft,quotation,confirmed,active,closed"`; red `alert-danger` banner bound to `billing_error`; smart button to invoices. List view with state badge decorations. `index=True` on `state`, `next_invoice_date`, `partner_id`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `Add subscriptions with lifecycle`.

### Task 4: Billing run and invoices

**Files:**
- Create: `models/account_move.py`, `models/bl_billing.py` (billing methods on `bl.subscription`), `data/bl_cron.xml`
- Modify: `views/bl_subscription_views.xml` (button "Run billing now" on list + server action), `views/bl_menus.xml` (Billing -> Invoices, Overdue invoices), manifest
- Test: `tests/test_billing.py`

**Interfaces:**
- Consumes: subscription fields, `bl.plan.next_date`.
- Produces: `account.move` fields `bl_subscription_id` (index), `bl_period_start`; `account.move.line` field `bl_discount_rule_id`.
- Produces: partial unique index created in `account.move.init()`:
  `CREATE UNIQUE INDEX IF NOT EXISTS bl_move_sub_period_uniq ON account_move (bl_subscription_id, bl_period_start) WHERE state != 'cancel' AND bl_subscription_id IS NOT NULL`
- Produces: `bl.subscription._create_invoice(period_start: date) -> account.move` (draft, `move_type='out_invoice'`, partner, payment term, `invoice_date=period_start`, lines copied with taxes); calls `self._apply_discount(move)` — a no-op stub here, filled in Task 5.
- Produces: `bl.subscription._run_billing(today: date | None = None, batch: int = 500) -> dict` returning `{'invoices': int, 'errors': int}`; `@api.model _cron_run_billing()` calls it; `action_run_billing()` calls it and returns a notification.

- [ ] **Step 1: Write failing tests** (`test_billing.py`, active monthly sub, `date_start = today - 2 months + 1 day` unless stated):
  - `test_bills_due_sub`: run with `today` = date_start -> 1 invoice, lines/qty/taxes/total match subscription, `next_invoice_date` advanced one month.
  - `test_rerun_no_duplicate`: run twice same `today` -> still 1 invoice.
  - `test_catch_up`: `date_start = today - 2 months` -> 3 invoices with distinct `bl_period_start`.
  - `test_db_guard`: calling `_create_invoice(same_period)` twice raises `psycopg2.errors.UniqueViolation` (wrap in `mute_logger('odoo.sql_db')` and `self.cr.savepoint()`).
  - `test_cancel_then_rebill` (Review Focus 1): bill, cancel invoice (`button_cancel`), reset `next_invoice_date` to that period, rerun -> exactly 1 non-cancelled invoice for that period.
  - `test_end_date_stops_and_closes` (Review Focus 2): `date_end` between period 2 and 3, `plan.auto_close=True` -> 2 invoices, `state == 'closed'`.
  - `test_error_visible`: sub whose `_create_invoice` is patched to raise -> `billing_error` set, other sub still billed, result `errors == 1`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement per spec §6 loop. Per-subscription `with self.env.cr.savepoint():`; on exception write `billing_error` outside the savepoint. Cron daily, active. Invoice list: badge column for `payment_state`, filter "Overdue" (`state='posted'`, `payment_state in ('not_paid','partial')`, `invoice_date_due < today`).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `Add billing run with duplicate guard`.

### Task 5: Discount rules

**Files:**
- Create: `models/bl_discount_rule.py`, `views/bl_discount_rule_views.xml`
- Modify: `models/bl_billing.py` (`_apply_discount`), access CSV (admin CRUD, staff read), menus, manifest
- Test: `tests/test_discount.py`

**Interfaces:**
- Produces: `bl.discount.rule` fields per spec §4; `used_count` computed (not stored) = count of distinct `account.move` with a line where `bl_discount_rule_id = rule` and `move.state != 'cancel'`.
- Produces: `bl.discount.rule._eligible(move) -> recordset`; `bl.discount.rule._value_for(move) -> float` (money value on the base).
- Produces: `bl.subscription._apply_discount(move)` picks max `_value_for`, writes `discount` % and `bl_discount_rule_id` on affected lines. Fixed -> `min(100, value / base * 100)`.

- [ ] **Step 1: Write failing tests** (`test_discount.py`, sub untaxed 1000, invoice date in range):
  - `test_percent_whole`: 10% whole rule -> invoice `amount_untaxed == 900`.
  - `test_fixed_products`: fixed 50 on product A (line subtotal 500) -> line A `discount == 10`, other lines 0.
  - `test_best_rule_wins`: 10% and fixed 150 both eligible -> fixed applied, `amount_untaxed == 850`.
  - `test_min_amount`: `min_amount=2000` -> no discount.
  - `test_expired`: `date_end` yesterday -> no discount.
  - `test_max_uses_same_run` (Review Focus 3): `max_uses=1`, two due subs, one run -> exactly one invoice discounted; `used_count == 1`.
  - `test_cancel_frees_use`: cancel the discounted invoice -> `used_count == 0`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. After writing lines call `self.env.flush_all()` and `rule.invalidate_recordset(['used_count'])` so the next sub in the same run sees the use.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `Add discount rules`.

### Task 6: Seed data (demo accounts and demo-path records)

**Files:**
- Create: `data/bl_seed.xml` (`noupdate="1"`)
- Modify: manifest
- Test: `tests/test_seed.py`

**Interfaces:**
- Produces (XML ids): users `user_bl_admin` (`admin@brightloop.test`), `user_bl_staff` (`staff@brightloop.test`), portal `user_bl_customer` (`customer@acme.test`, partner "Acme Corp"); all password `Brightloop#2026`.
- Produces: tax `tax_bl_18` (18% sale); products "Brightloop CRM" (monthly-ish, 1000, variants via attribute "Brand": Generic +0, Odoo +560), "Analytics Add-on" (300), "Priority Support" (200); plans Monthly (allow pause/close/renew), Yearly (auto_close); template "CRM Starter" (Monthly, CRM x1 + Support x1, 30 days); discount "Launch 10%" (percent 10, max_uses 20); 3 extra customers; subscriptions in each state, one active sub overdue for billing.

- [ ] **Step 1: Write failing test** `test_seed_present`: refs above exist; `user_bl_staff` has `group_bl_staff` and not `base.group_erp_manager`; `user_bl_customer` has `base.group_portal`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Write XML. Passwords must satisfy Task 8 policy.
- [ ] **Step 4:** Run. Expected: PASS. Then `docker compose up -d`, create DB `brightloop` from UI with module installed, walk the demo path by hand: product -> plan -> quote from template -> activate -> Run billing now -> confirm invoice -> register payment.
- [ ] **Step 5:** Commit `Add seed data and demo accounts`. Push.

### Task 7: Customer portal subscriptions

**Files:**
- Create: `controllers/__init__.py`, `controllers/portal.py`, `views/bl_portal_templates.xml`, `security/bl_portal_rules.xml`
- Modify: root `__init__.py`, access CSV (portal read on subscription + line), manifest
- Test: `tests/test_portal.py`

**Interfaces:**
- Produces: routes `/my/subscriptions` (list, paginated 20) and `/my/subscriptions/<int:sub_id>` (detail with lines + linked invoices); portal home counter `subscription_count` via `_prepare_home_portal_values`.
- Produces: record rules for `base.group_portal` on `bl.subscription` and `bl.subscription.line`: `[('partner_id','child_of',[user.commercial_partner_id.id])]` (line: `subscription_id.partner_id`).

- [ ] **Step 1: Write failing tests** (`test_portal.py`):
  - `test_portal_sees_own`: portal user `search([])` returns only own subs.
  - `test_portal_cannot_read_other` (Review Focus 4): `with_user(portal).browse(other_sub.id).read(['name'])` raises `AccessError`.
  - `test_portal_cannot_write`: write on own sub raises `AccessError`.
  - `HttpCase test_portal_page`: authenticate as portal, GET `/my/subscriptions` -> 200 and contains own sub name, not other's.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement controller inheriting `portal.controllers.portal.CustomerPortal`; templates extend `portal.portal_my_home` and use `portal.portal_table`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `Add customer portal for subscriptions`.

### Task 8: Password policy and simulated reset email

**Files:**
- Create: `models/res_users.py`
- Modify: `models/__init__.py`, `views/bl_menus.xml` (admin menu "Email outbox (simulated)" -> `mail.mail` list action)
- Test: `tests/test_password.py`

**Interfaces:**
- Produces: `res.users._check_bl_password(password: str) -> None` raising `UserError` with one message listing the rules; `_set_password` override calls it for every user with a non-empty `password` before `super()`.

- [ ] **Step 1: Write failing tests** (`test_password.py`):
  - reject: `"Short#1a"` (8 chars), `"alllowercase#1"`, `"ALLUPPER#123"`, `"NoSpecial123"`.
  - accept: `"Brightloop#2026"`.
  - `test_write_password_enforced`: `user.write({'password': 'weak'})` raises `UserError`.
  - `test_reset_creates_outbox_mail`: `user.action_reset_password()` creates a `mail.mail` to the user's email containing `/web/reset_password`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Regexes: `[A-Z]`, `[a-z]`, `[^A-Za-z0-9]`, `len > 8`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `Add password policy and visible reset email`.

### Task 9: Finance dashboard

**Files:**
- Create: `models/bl_dashboard.py` (AbstractModel `bl.dashboard`), `static/src/dashboard/dashboard.js`, `dashboard.xml`, `dashboard.scss`, `views/bl_dashboard_action.xml`
- Modify: manifest (`assets: {'web.assets_backend': ['brightloop_subscription/static/src/dashboard/*']}`), menus (Dashboard first item under root)
- Test: `tests/test_dashboard.py`

**Interfaces:**
- Produces: `bl.dashboard.get_data(date_from: str | None, date_to: str | None) -> dict` with keys
  `active_count: int`, `revenue: float` (sum of posted inbound customer `account.payment.amount` in range),
  `outstanding: float` (sum `amount_residual` of posted out_invoices not paid), `overdue_count: int`,
  `overdue: list[{id, name, partner, due_date, residual}]` (top 10 by due date), `recent_payments: list[{id, name, partner, date, amount}]` (top 10), `currency_symbol: str`.
- Produces: client action tag `bl_dashboard`; OWL component `BlDashboard` registered in `registry.category("actions")`.

- [ ] **Step 1: Write failing test** `test_get_data`: one active sub, one posted invoice 1180 with payment 500 dated today, one overdue posted invoice -> `active_count >= 1`, `revenue` includes 500, `outstanding` includes 680, overdue list contains the overdue invoice id.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with `read_group` / `_read_group` aggregates, `search(..., limit=10)`. OWL: KPI cards, two tables with row click -> open record via `action` service, date-from/to inputs, loading spinner, empty-state text, error alert on RPC failure. Staff group can access (checks via ORM rights).
- [ ] **Step 4:** Run tests: PASS. Open `http://localhost:8069` -> Brightloop -> Dashboard; numbers match invoice list.
- [ ] **Step 5:** Commit `Add finance dashboard`. Push.

### Task 10: Docs and demo kit

**Files:**
- Modify: `README.md`
- Create: `docs/DEMO_SCRIPT.md`, `docs/TRADEOFFS.md`, `docs/JUDGE_QA.md`

- [ ] **Step 1:** README: what it is, setup (`docker compose up -d`, create DB with module or `docker compose run --rm odoo -d brightloop -i brightloop_subscription --stop-after-init`), demo accounts table, data model summary (link spec), test command, decision notes table.
- [ ] **Step 2:** DEMO_SCRIPT: 2-minute timed walkthrough of the demo path + duplicate-guard rerun + portal view + outbox.
- [ ] **Step 3:** TRADEOFFS: reused account vs custom; draft invoices; best-single discount; no proration; simulated email/payments; scaling story. JUDGE_QA: ~10 questions with answers (double billing, missed cron, discount races, security, scale to 1M subs, why Odoo).
- [ ] **Step 4:** Full test command from clean DB: all PASS.
- [ ] **Step 5:** Commit `Add README and demo docs`. Push.

## Time budget (start ~10:30)
T1 0:20 · T2 0:50 · T3 1:15 · T4 1:30 · T5 1:00 · T6 0:45 → demo path done ~16:30.
T7 0:45 · T8 0:30 · T9 1:15 · T10 0:40 → ~20:15. Buffer 45 min. If behind at 17:30, drop T9 to a list-based dashboard and T7 detail page.
