# Likely Judge Questions

**How do you stop double billing?**
Two layers. The run only picks subscriptions with `next_invoice_date <= today` and moves the date forward after each
invoice. Underneath, Postgres has a unique index on `(subscription, period_start)` for non-cancelled invoices, so even
two runs at the same moment cannot both insert. The test `test_db_guard` proves it.

**What if the cron doesn't run for a week?**
Nothing is lost. The next run loops each subscription until `next_invoice_date` passes today, creating one invoice per
missed period (`test_catch_up`).

**What if one subscription fails during billing?**
Each subscription bills inside its own savepoint. A failure rolls back only that subscription, writes the error to
`billing_error` (red banner + "Billing Errors" filter), and the run continues (`test_error_visible`).

**Two invoices in the same run both want a discount with 1 use left?**
Usage is counted from real invoice lines and re-read before each invoice, so only the first gets it
(`test_max_uses_same_run`). Cancelling that invoice frees the use.

**Why build on Odoo Accounting instead of your own invoices?**
Tax computation, posting, payment matching, partial payments, PDF and portal are hard to get right and already correct
in Odoo. I spent the time on what Odoo Community doesn't have: plans, subscription lifecycle, billing run, discount rules.

**How is customer data protected?**
Record rules at the ORM level: portal users can only read subscriptions whose partner belongs to their company — even
through RPC, not just the UI (`test_portal_cannot_read_other`). Staff can't create users or edit plans/discounts
(`test_staff_cannot_create_internal_user`, `test_staff_cannot_create_plan`).

**How does it stay under 2 seconds with lots of data?**
Indexed filters, paginated lists, dashboard computed as SQL aggregates and top-10 queries (cost doesn't grow with
rows), billing in batches. Scaling steps are in `TRADEOFFS.md`.

**Why draft invoices instead of posting automatically?**
A person checks before the customer is charged; drafts are free to fix. Auto-post per plan is a small next step.

**How are taxes handled?**
Admin defines taxes; each product has default taxes copied to subscription lines and then to invoice lines, where Odoo
computes them. Discounts use the line discount %, so tax is computed on the discounted amount.

**What's simulated?**
Email goes to Mailpit, a local inbox you can open in the demo. Payments are recorded by staff; no gateway. Both are
stated in the README.

**What would you build next?**
Proration, dunning reminders, auto-post/send per plan, online payment on the portal, MRR and churn reports.

**What was the hardest part?**
Making billing safe under failure and repetition: catch-up, per-record savepoints, and a database-level duplicate guard
that still allows rebilling after a cancelled invoice.
