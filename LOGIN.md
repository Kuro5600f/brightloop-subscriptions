# How to run and log in

## Start (one command)

Needs Docker Desktop. In the repo folder:

```bash
docker compose up -d
```

First start takes about 1–2 minutes (it creates the database and loads demo data). Then open:

- App / login: **http://localhost:8069**
- Simulated email inbox (password reset, sent invoices): **http://localhost:8025**

## Logins (password for all: `Brightloop#2026`)

| Role | Email | Lands on |
|---|---|---|
| Admin | `admin@brightloop.test` | Finance dashboard, full access incl. Configuration |
| Staff | `staff@brightloop.test` | Finance dashboard; subscriptions, billing, payments |
| Customer | `customer@acme.test` | Customer portal: own subscriptions and invoices |

Theme: sun/moon button on the login page and dashboard (remembered per browser).

## Reset to fresh demo data

```bash
docker compose down -v
docker compose up -d
```
