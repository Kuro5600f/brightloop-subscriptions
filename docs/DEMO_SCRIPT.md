# 2-Minute Demo Script

Before you start: stack running, fresh `brightloop` DB, three browser tabs —
Odoo as **admin**, Odoo as **staff** (private window), Mailpit (http://localhost:8025).

| Time | Who | Do | Say |
|---|---|---|---|
| 0:00 | — | Show Dashboard | "Brightloop tracked subscriptions in spreadsheets. This is one place for the whole loop: plan, quote, subscription, invoice, payment, report." |
| 0:10 | Admin | Configuration → Products → Brightloop CRM → variants | "Products use Odoo's own variants. The Odoo brand adds 560 to the base price." |
| 0:20 | Admin | Configuration → Plans → Monthly | "Plans set the billing period, minimum quantity, availability and lifecycle rules: auto-close, early close, pause, renew." |
| 0:30 | Admin | Configuration → Discount Rules → Launch 10% | "Only admins create discounts. Minimum amount, dates and max uses; usage is counted from real invoices." |
| 0:40 | Staff | Subscriptions → New → template "CRM Starter", customer Globex | "Staff start from a template: plan, products, taxes and quote expiry fill in. Totals include tax." |
| 0:55 | Staff | Send Quotation → Confirm → Activate | "Status bar shows exactly where it is. Wrong-order actions are blocked." |
| 1:05 | Staff | Subscriptions list → **Run billing now** | "The billing run invoices everything due, including missed periods. The 10% discount applied automatically." |
| 1:15 | Staff | Click **Run billing now** again | "Zero new invoices. Duplicate billing is blocked by a unique index in the database, not just code." |
| 1:25 | Staff | Open invoice → Confirm → Register Payment (part amount) | "Odoo's accounting does tax, posting and payment matching. Status turns Partially Paid." |
| 1:40 | Staff | Dashboard → Refresh | "Revenue, outstanding and overdue update straight from the database." |
| 1:50 | Customer | Log in as customer@acme.test → My Subscriptions | "Customers see only their own subscriptions and invoices — record rules, not hidden buttons." |
| 1:55 | — | Mailpit tab (after "Forgot password" on login page) | "Email is simulated honestly: a local inbox catches the real reset email." |

Backup points if asked: Subscriptions → filter **Billing Errors**; plan Weekly Trial has renew disabled;
Yearly plan needs at least 5 seats (try confirming with fewer).
