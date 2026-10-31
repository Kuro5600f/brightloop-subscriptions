// Records a captioned walkthrough of the running app to demo/brightloop-demo.webm.
// Needs: stack up (docker compose up -d), `npm i playwright`, Microsoft Edge installed.
// Run:   node tools/demo_video.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8069';
const PASS = 'Brightloop#2026';
const OUT = path.join(__dirname, '..', 'demo');
const SIZE = { width: 1440, height: 900 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function say(page, text, ms = 3500) {
  await page.evaluate((t) => {
    let el = document.getElementById('demo-cap');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-cap';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;' +
        'max-width:80%;padding:12px 22px;border-radius:12px;background:rgba(15,23,42,.88);color:#fff;' +
        'font:600 20px/1.4 Manrope,system-ui,sans-serif;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
  await wait(ms);
}

async function login(page, email) {
  await page.goto(`${BASE}/web/login`);
  await page.locator('input[name="login"]').pressSequentially(email, { delay: 40 });
  await page.locator('input[name="password"]').pressSequentially(PASS, { delay: 40 });
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/web/login'), { timeout: 30000 });
  await page.waitForLoadState('load');
}

async function go(page, action) {
  await page.goto(`${BASE}/odoo/action-brightloop_subscription.${action}`);
  await page.waitForLoadState('load');
  await wait(2000);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } });
  const page = await ctx.newPage();

  // 1. Login page
  await page.goto(`${BASE}/web/login`);
  await page.waitForLoadState('load');
  await say(page, 'Brightloop: subscriptions, billing and payments in one Odoo 18 module');
  await page.click('.bl-theme-toggle');
  await say(page, 'Light and dark theme, remembered per browser', 2500);
  await page.click('.bl-theme-toggle');

  // 2. Admin dashboard
  await login(page, 'admin@brightloop.test');
  await go(page, 'action_bl_dashboard');
  await say(page, 'Finance dashboard: revenue, outstanding and overdue, live from the database', 4500);
  await page.mouse.wheel(0, 500);
  await say(page, 'Monthly paid / pending / overdue chart and status breakdown');
  await page.mouse.wheel(0, 600);
  await wait(800);
  const row = page.locator('.o_bl_row', { hasText: 'INV/' }).first();
  if (await row.count()) {
    await row.click();
    await say(page, 'Click any invoice for the details drawer');
    await page.keyboard.press('Escape');
    await page.locator('.o_bl_backdrop').click({ timeout: 1000 }).catch(() => {});
  }

  // 3. Configuration (admin only)
  await go(page, 'action_bl_plan');
  await say(page, 'Plans: billing period, minimum seats, pause / renew / close rules');
  await go(page, 'action_bl_quote_template');
  await say(page, 'Quotation templates pre-fill plan, products and taxes');
  await go(page, 'action_bl_discount_rule');
  await say(page, 'Discount rules: admin only, with limits, dates and max uses');

  // 4. Subscriptions and billing
  await go(page, 'action_bl_subscription');
  await say(page, 'Subscriptions move Draft → Quotation → Confirmed → Active');
  const sub = page.locator('.o_data_row').first();
  if (await sub.count()) {
    await sub.click();
    await page.waitForLoadState('load');
    await say(page, 'Status bar shows the stage; wrong-order actions are blocked', 4000);
  }
  await go(page, 'action_bl_invoices');
  await say(page, 'Billing run creates invoices; a DB unique index blocks duplicates');
  await go(page, 'action_bl_overdue');
  await say(page, 'Overdue invoices at a glance');

  // 5. Customer portal
  await page.goto(`${BASE}/web/session/logout`);
  await login(page, 'customer@acme.test');
  await page.goto(`${BASE}/my`);
  await page.waitForLoadState('load');
  await say(page, 'Customer portal: each customer sees only their own subscriptions and invoices', 4500);

  // 6. Simulated email
  await page.goto('http://localhost:8025');
  await page.waitForLoadState('load');
  await say(page, 'Emails (password reset, invoices) land in a local Mailpit inbox', 4000);

  const video = page.video();
  await ctx.close();
  await browser.close();
  const final = path.join(OUT, 'brightloop-demo.webm');
  fs.renameSync(await video.path(), final);
  console.log('Saved', final);
})();
