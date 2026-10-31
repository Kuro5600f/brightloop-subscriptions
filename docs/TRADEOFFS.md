# Trade-offs and Future Work

## Decisions

| Decision | Why | Cost |
|---|---|---|
| Build on Odoo `account` for invoices, taxes, payments | Mature, correct tax and payment matching; send/print/portal for free; time spent on what Odoo lacks | Tied to Odoo's invoice states (Draft/Posted) — shown to users as Draft → Confirmed → Paid |
| Billing creates **draft** invoices | A human confirms before money is asked for; mistakes are cheap to fix | One extra click; can be switched to auto-post per plan later |
| Duplicate guard as a **DB partial unique index** | Holds even with two concurrent billing runs or a bug in Python | Needs care in migrations; cancelled invoices are excluded on purpose |
| Catch-up loop instead of "bill today only" | Missed cron runs never silently skip revenue | A long outage creates many invoices at once (visible, reviewable drafts) |
| Per-subscription savepoint + `billing_error` | One bad record cannot stop the batch, and failures are visible | Errors need someone to look at the filter |
| One best discount, no stacking | Predictable, easy to explain to customers and auditors | Can't combine promos yet |
| Discount via line `discount %` | Odoo recomputes taxes correctly | A fixed amount becomes a rounded percentage |
| `used_count` computed from invoices | Can't drift from reality; cancelling frees a use | A query per rule (fine for tens of rules) |
| Mailpit for email | Real emails, visible, no risk of mailing anyone | Not real delivery |
| Manual payment recording | Matches the brief; no gateway credentials needed | No online card payments |
| Docker Compose | Same setup for judges, advisor, and me | Needs Docker installed |

## Out of scope (on purpose)

Proration of mid-period changes, upgrades/downgrades, multi-currency pricing, dunning (automatic reminders), usage-based
billing, real payment gateway, real SMTP, revenue recognition.

## Future work (in order)

1. Proration for quantity or plan changes mid-period.
2. Dunning: reminder emails at +3 / +7 / +14 days overdue (cron + mail template, data already there).
3. Auto-post and auto-send invoices per plan.
4. Payment provider (Stripe via Odoo `payment` module) on the portal invoice page.
5. Discount stacking rules and coupon codes.
6. MRR / churn reporting.

## Scaling path

- **Now**: indexed queries (`state`, `next_invoice_date`, `partner_id`, `bl_subscription_id`), paginated lists,
  dashboard as DB aggregates + `LIMIT 10`, billing in batches of 500.
- **100k+ subscriptions**: cron reports progress and re-triggers itself until no due records remain
  (Odoo 18 `ir.cron._notify_progress`) and commits per batch; dashboard aggregates cached for a few minutes.
- **Millions**: materialized views for revenue reports, read replica for dashboards, billing partitioned by
  `next_invoice_date` across workers — the unique index keeps parallel workers safe.
