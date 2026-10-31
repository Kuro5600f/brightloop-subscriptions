# Brightloop Subscription Management System

Odoo Hiring Hackathon project. A custom **Odoo 18 Community** module, `brightloop_subscription`, that runs the whole
subscription lifecycle:

**products & plans → quotations → subscriptions → recurring invoices → payments → dashboard**

Odoo Community has no subscription app (it is Enterprise-only), so this module builds the missing pieces — plans,
quotation templates, the subscription lifecycle, the billing run and discount rules — and reuses what Odoo already does
well: products and variants, taxes, payment terms, invoices, payments, PDF printing, email and the customer portal.

## Quick start

Needs Docker Desktop. From the repo root:

```bash
docker compose up -d db mailpit
docker compose run --rm odoo -d brightloop -i brightloop_subscription --stop-after-init --without-demo=all
docker compose up -d
```

| What | Where |
|---|---|
| Odoo | http://localhost:8069 (database `brightloop`) |
| Simulated email inbox (Mailpit) | http://localhost:8025 |
| Customer portal | http://localhost:8069/my/subscriptions |

> Git Bash on Windows: prefix commands with `MSYS_NO_PATHCONV=1` so paths are not rewritten.

### Demo accounts (password for all: `Brightloop#2026`)

| Role | Login | Can do |
|---|---|---|
| Admin | `admin@brightloop.test` | Everything: products, plans, templates, taxes, discount rules, users |
| Staff | `staff@brightloop.test` | Customers, subscriptions, billing run, invoices, payments, dashboard |
| Customer (portal) | `customer@acme.test` | Only Acme Corp's own subscriptions and invoices |

Seed data includes: CRM product with a **Brand** variant (Odoo brand adds 560), Analytics and Support add-ons, an 18%
tax, Monthly / Yearly / Weekly plans, the "CRM Starter" quotation template, two discount rules, and subscriptions in
every state with paid, partially paid and overdue invoices.

## Run the tests

```bash
docker compose run --rm odoo -d bl_test -i brightloop_subscription --test-tags /brightloop_subscription --stop-after-init
```

65 tests cover: an end-to-end billing-day scenario, plan date maths (incl. month ends), lifecycle guards, billing (one invoice per period, rerun creates none, catch-up,
DB-level duplicate guard, cancel then rebill, end date and auto-close, visible errors), discounts (best rule wins,
minimums, expiry, max uses within one run), portal isolation, password policy, dashboard figures, staff cannot create users.

## How it works

### Data model

| Model | Purpose |
|---|---|
| `bl.plan` | Billing period (day/week/month/year), minimum quantity, availability dates, lifecycle flags (auto-close, early close, pause, renew) |
| `bl.quote.template` (+ lines) | Default plan, products and validity period for new quotations |
| `bl.subscription` (+ lines) | Number `SUB/0001`, customer, plan, dates, payment terms, `next_invoice_date`, lines with tax, totals, `billing_error` |
| `bl.discount.rule` | Fixed or %, minimum amount / quantity, dates, max uses, whole subscription or selected products |
| `account.move` (extended) | `bl_subscription_id`, `bl_period_start` + **partial unique index** (one live invoice per period) |
| `account.move.line` (extended) | `bl_discount_rule_id`, so rule usage is counted from real invoices |
| `bl.dashboard` | One RPC returning all KPIs from DB aggregates |

Full design: [`docs/superpowers/specs/2026-10-31-brightloop-design.md`](docs/superpowers/specs/2026-10-31-brightloop-design.md)

### Subscription lifecycle

`Draft → Quotation → Confirmed → Active → Closed`, plus `Paused` and `Renew` when the plan allows them. Every
transition is a button that checks the current state; a wrong-state call raises a clear error. Expired quotations,
unavailable plans and quantities below the plan minimum cannot be confirmed.

### Billing run (cron daily + "Run billing now" button)

For each active subscription with `next_invoice_date <= today`: create a draft invoice for that period, copy lines and
taxes, apply the best discount, move `next_invoice_date` forward, and **loop until caught up** — a subscription missed
for 3 months gets 3 invoices, none skipped. Past its end date with auto-close, it closes. Each subscription runs in its
own savepoint; a failure is written to `billing_error` (red banner and "Billing Errors" filter) and the run continues.

**Duplicate billing is blocked by the database**, not only by Python: a unique index on
`(bl_subscription_id, bl_period_start) WHERE state != 'cancel'`. Cancelling an invoice frees its period for rebilling.

### Plan prices

A plan can set its own price per product per billing period (e.g. CRM Yearly 10,000 per seat instead of 12 × monthly).
Products without a plan price use their sales price. Variant extras (Odoo brand +560) are added on top.

### Discounts

The single most valuable eligible rule is applied (no stacking). A percentage uses Odoo's line `discount %`. A fixed
amount becomes exact negative "Discount" lines, one per tax set, so tax is computed on the discounted base and the
total is correct to the cent. Usage is counted from non-cancelled invoices, so it cannot drift; limited rules are
row-locked and re-checked, so `max_uses` holds within one run and across concurrent runs. The base is the untaxed
amount, also for tax-included prices.

### Customer self-service

Customers sign up themselves at `/web/signup` (one account per email, same password rule) or are invited. In the
portal they see their subscriptions and invoices, and can **pause, resume or close** a subscription — using the same
lifecycle checks and plan rules as staff.

### Payments and invoice status

Odoo's Register Payment (method/journal, amount, date, memo). The invoice list shows **Draft / Confirmed** and
**Not paid / Partial / Paid** badges, plus Overdue, Outstanding, Partially Paid and Paid filters.

### Security

| | Admin | Staff | Customer |
|---|---|---|---|
| Products, plans, templates, taxes, discount rules | full | read | — |
| Customers, subscriptions, invoices, payments | full | full | read own |
| Create users / staff | yes | **no** | no |

Portal record rules limit customers to `partner_id child_of` their company. Passwords must have more than 8
characters, upper and lower case, and a special character — enforced on every password set (create, change, reset).

### Social login (Google, Facebook)

Uses Odoo's built-in OAuth module. Buttons appear on the login page only once a provider is configured — no fake
buttons. To enable:

1. Create an OAuth client — Google: Cloud Console → APIs & Services → Credentials → OAuth client ID (Web);
   Facebook: Meta for Developers → Create app → Facebook Login.
2. Authorized redirect URI: `http://localhost:8069/auth_oauth/signin`
3. In Odoo as admin: Settings → Users & Companies → **OAuth Providers** → Google / Facebook → paste the
   **Client ID**, tick **Allowed**, save.

**LinkedIn** uses a server-side authorization-code flow added by this module (Odoo's OAuth module only does the
browser flow). LinkedIn Developers → create app → product "Sign In with LinkedIn using OpenID Connect" → redirect URL
`http://localhost:8069/auth_oauth/bl/callback`. In Odoo: OAuth Providers → LinkedIn → paste **Client ID** and
**Client Secret** (stored server-side, visible to system admins only), tick **Allowed**. The callback checks a
one-time `state` bound to the browser session, exchanges the code on the server, reads `/v2/userinfo`, then signs in
through Odoo's own OAuth user logic.

New social users get a portal (customer) account.

### Where users land after sign-in (role-based, server-side)

| Role (from the user's groups in the database) | Lands on |
|---|---|
| Brightloop Admin / Staff | Finance dashboard |
| Customer (portal) | `/my` — their subscriptions and invoices |
| Other internal users | Odoo home |

Same rule for password, Google, Facebook and LinkedIn sign-in; an explicit `?redirect=` (e.g. after a session
expired) is honoured if it is a local path. Customers who open a backend URL are sent back to `/my` by Odoo, and
record rules keep them to their own data.

### Simulated services (honest about it)

- **Email**: delivered to Mailpit, a local fake SMTP inbox. Password resets and "Send invoice" emails appear there.
- **Payments**: recorded manually by staff; no payment gateway.

### Performance (measured)

Indexes on subscription `state`, `next_invoice_date`, `partner_id` and on `account_move.bl_subscription_id`. Lists page
at 80 rows (portal: 20). Dashboard numbers are SQL aggregates plus `LIMIT 10` lists, so page cost does not grow with
data size.

[`tools/perf_check.py`](tools/perf_check.py) loads 5,000 subscriptions, bills and confirms them, then times each page
as the staff user (server time, laptop, Docker on Windows):

| Page / query (5,006 subscriptions, 5,017 invoices) | Time |
|---|---|
| Subscription list, page 1 (80 rows + total count) | 0.012 s |
| Subscription list, page 50 | 0.004 s |
| "Due for billing" filter | 0.001 s |
| Invoice list, outstanding filter | 0.015 s |
| Finance dashboard (all KPIs) | 0.017 s |
| Billing run with nothing due (duplicate check) | 0.004 s |
| Billing run creating 5,001 invoices | 457 s (~11 invoices/s, background cron) |

Every page is far under the 2-second target. The billing run is the slow part: it is a background job, and invoice
creation is Odoo's accounting engine (journal entries, taxes). See [`docs/TRADEOFFS.md`](docs/TRADEOFFS.md) for the
scaling path.

## More docs

- [2-minute demo script](docs/DEMO_SCRIPT.md)
- [Trade-offs and future work](docs/TRADEOFFS.md)
- [Likely judge questions](docs/JUDGE_QA.md)
- [Implementation plan](docs/superpowers/plans/2026-10-31-brightloop-subscription.md)

## Team

- [Kuro5600f](https://github.com/Kuro5600f)
- [SoorajNairA](https://github.com/SoorajNairA)
