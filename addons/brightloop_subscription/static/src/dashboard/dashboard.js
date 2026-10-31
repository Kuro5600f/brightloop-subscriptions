/** @odoo-module **/

import { Component, onWillStart, onWillUnmount, useEffect, useRef, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

const THEME_KEY = "bl-theme";
const PAGE_SIZE = 8;
const SERIES = [
    { key: "paid", label: "Paid" },
    { key: "pending", label: "Pending" },
    { key: "overdue", label: "Overdue" },
];
const STATUS = {
    paid: { label: "Paid", icon: "fa-check-circle", tone: "positive" },
    pending: { label: "Pending", icon: "fa-clock-o", tone: "warning" },
    partial: { label: "Partial", icon: "fa-adjust", tone: "info" },
    overdue: { label: "Overdue", icon: "fa-exclamation-circle", tone: "danger" },
    draft: { label: "Draft", icon: "fa-pencil", tone: "neutral" },
};
const FILTERS = [
    { key: "all", label: "All" },
    { key: "paid", label: "Paid" },
    { key: "pending", label: "Pending" },
    { key: "overdue", label: "Overdue" },
    { key: "draft", label: "Draft" },
];
const EMPTY_TEXT = {
    all: "No invoices yet. Create a subscription and run billing to issue the first one.",
    paid: "No paid invoices yet.",
    pending: "Nothing pending: every posted invoice is paid or overdue.",
    overdue: "Nothing overdue. Nice work.",
    draft: "No draft invoices.",
};
// chart geometry (SVG user units)
const CH = { w: 640, h: 260, left: 52, right: 12, top: 14, bottom: 30 };

function readTheme() {
    try {
        const saved = window.localStorage.getItem(THEME_KEY);
        if (saved === "dark" || saved === "light") {
            return saved;
        }
    } catch {
        // storage blocked: fall through to the OS preference
    }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function niceMax(value) {
    if (!value || value <= 0) {
        return 100;
    }
    const exp = Math.pow(10, Math.floor(Math.log10(value)));
    const f = value / exp;
    const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return step * exp;
}

export class BlDashboard extends Component {
    static template = "brightloop_subscription.Dashboard";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");
        this.filters = FILTERS;
        this.series = SERIES;
        this.CH = CH;
        this.drawerRef = useRef("drawer");
        this.lastRow = null;
        this.searchTimer = null;
        this.state = useState({
            loading: true,
            error: null,
            data: null,
            dateFrom: "",
            dateTo: "",
            theme: readTheme(),
            billing: false,
            tip: null,
            list: {
                status: "all",
                search: "",
                offset: 0,
                rows: [],
                total: 0,
                counts: { all: 0, paid: 0, pending: 0, overdue: 0, draft: 0 },
                loading: true,
                error: null,
                loaded: false,
            },
            selectedId: null,
            detail: null,
            detailLoading: false,
            detailError: null,
        });
        onWillStart(() => Promise.all([this.load(), this.loadList()]));
        // follow the top-bar theme switch
        const onTheme = (ev) => {
            if (ev.detail === "dark" || ev.detail === "light") {
                this.state.theme = ev.detail;
            }
        };
        window.addEventListener("bl-theme-change", onTheme);
        onWillUnmount(() => {
            clearTimeout(this.searchTimer);
            window.removeEventListener("bl-theme-change", onTheme);
        });
        // move focus into the drawer when it opens
        useEffect(
            (id) => {
                if (id && this.drawerRef.el) {
                    const btn = this.drawerRef.el.querySelector(".o_bl_drawer_close");
                    if (btn) {
                        btn.focus();
                    }
                }
            },
            () => [this.state.selectedId]
        );
    }

    // ---------------------------------------------------------------- data
    async load() {
        this.state.loading = true;
        this.state.error = null;
        try {
            this.state.data = await this.orm.call("bl.dashboard", "get_data", [
                this.state.dateFrom || null,
                this.state.dateTo || null,
            ]);
        } catch (e) {
            this.state.error = e.data?.message || e.message || "Could not load dashboard data.";
        } finally {
            this.state.loading = false;
        }
    }

    async loadList() {
        const list = this.state.list;
        list.loading = true;
        list.error = null;
        try {
            const res = await this.orm.call("bl.dashboard", "list_invoices", [
                list.status,
                list.search,
                list.offset,
                PAGE_SIZE,
            ]);
            list.rows = res.rows;
            list.total = res.total;
            list.counts = res.counts;
            list.currency = res.currency_symbol;
            list.loaded = true;
        } catch (e) {
            list.error = e.data?.message || e.message || "Could not load invoices.";
        } finally {
            list.loading = false;
        }
    }

    reloadAll() {
        return Promise.all([this.load(), this.loadList()]);
    }

    clearDates() {
        this.state.dateFrom = "";
        this.state.dateTo = "";
        this.load();
    }

    // ---------------------------------------------------------------- header
    get greeting() {
        const h = new Date().getHours();
        const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
        const name = this.state.data?.user_first_name;
        return name ? `${part}, ${name}` : part;
    }

    get periodLabel() {
        const { dateFrom, dateTo } = this.state;
        if (!dateFrom && !dateTo) {
            return "All time";
        }
        if (dateFrom && dateTo) {
            return `${this.fmtDate(dateFrom)} – ${this.fmtDate(dateTo)}`;
        }
        return dateFrom ? `Since ${this.fmtDate(dateFrom)}` : `Until ${this.fmtDate(dateTo)}`;
    }

    toggleTheme() {
        this.state.theme = this.state.theme === "dark" ? "light" : "dark";
        try {
            window.localStorage.setItem(THEME_KEY, this.state.theme);
        } catch {
            // not persisted; still applied for this session
        }
    }

    createSubscription() {
        this.action.doAction({
            type: "ir.actions.act_window",
            name: "New Subscription",
            res_model: "bl.subscription",
            views: [[false, "form"]],
            target: "current",
        });
    }

    async runBilling() {
        if (this.state.billing) {
            return;
        }
        this.state.billing = true;
        try {
            const res = await this.orm.call("bl.subscription", "action_run_billing", [[]]);
            const p = res?.params || {};
            this.notification.add(p.message || "Billing run finished.", {
                title: p.title,
                type: p.type || "success",
            });
            await this.reloadAll();
        } catch (e) {
            this.notification.add(e.data?.message || e.message || "Billing run failed.", {
                title: "Billing run failed",
                type: "danger",
            });
        } finally {
            this.state.billing = false;
        }
    }

    // ---------------------------------------------------------------- formatting
    num(value, digits = 2) {
        return (value || 0).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }

    money(value, symbol) {
        const sym = symbol || this.state.data?.currency_symbol || this.state.list.currency || "";
        const n = this.num(Math.abs(value || 0));
        return `${value < 0 ? "-" : ""}${sym}${n}`;
    }

    shortMoney(value) {
        const sym = this.state.data?.currency_symbol || "";
        const v = Math.abs(value);
        if (v >= 1e6) {
            return `${sym}${(value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
        }
        if (v >= 1e3) {
            return `${sym}${(value / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
        }
        return `${sym}${Math.round(value)}`;
    }

    fmtDate(iso) {
        if (!iso) {
            return "—";
        }
        const [y, m, d] = iso.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }

    status(key) {
        return STATUS[key] || STATUS.draft;
    }

    initial(name) {
        return (name || "?").trim().charAt(0).toUpperCase() || "?";
    }

    // ---------------------------------------------------------------- KPIs
    get kpis() {
        const d = this.state.data;
        const months = d.monthly || [];
        return [
            {
                key: "invoiced", label: "Total Invoiced", icon: "fa-file-text-o", value: this.money(d.invoiced),
                sub: `${d.invoiced_count} invoice${d.invoiced_count === 1 ? "" : "s"} · ${this.periodLabel}`,
                spark: months.map((m) => m.paid + m.pending + m.overdue),
            },
            {
                key: "revenue", label: "Revenue Received", icon: "fa-check-circle-o", value: this.money(d.revenue),
                sub: `Payments · ${this.periodLabel}`,
                spark: months.map((m) => m.paid),
            },
            {
                key: "outstanding", label: "Outstanding", icon: "fa-clock-o", value: this.money(d.outstanding),
                sub: "Unpaid balance · as of today",
                spark: months.map((m) => m.pending + m.overdue),
            },
            {
                key: "overdue", label: "Overdue", icon: "fa-exclamation-triangle", value: this.money(d.overdue_amount),
                sub: `${d.overdue_count} invoice${d.overdue_count === 1 ? "" : "s"} past due · as of today`,
                spark: months.map((m) => m.overdue),
            },
        ];
    }

    sparkPoints(values) {
        const w = 72, h = 28;
        const max = Math.max(...values, 0);
        if (!values.length || max <= 0) {
            return `0,${h - 1} ${w},${h - 1}`;
        }
        const step = values.length > 1 ? w / (values.length - 1) : w;
        return values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
    }

    // ---------------------------------------------------------------- bar chart
    get chart() {
        const months = this.state.data.monthly || [];
        const max = niceMax(Math.max(0, ...months.flatMap((m) => [m.paid, m.pending, m.overdue])));
        const plotW = CH.w - CH.left - CH.right;
        const plotH = CH.h - CH.top - CH.bottom;
        const base = CH.top + plotH;
        const ticks = [0, 1, 2, 3, 4].map((i) => {
            const v = (max / 4) * i;
            return { key: i, y: base - (v / max) * plotH, label: this.shortMoney(v) };
        });
        const slot = plotW / Math.max(months.length, 1);
        const barW = Math.min(18, (slot * 0.66) / 3);
        const groups = months.map((m, gi) => {
            const gx = CH.left + gi * slot;
            const start = gx + (slot - barW * 3 - 4) / 2;
            const bars = SERIES.map((s, si) => {
                const h = Math.max(m[s.key] > 0 ? 2 : 0, (m[s.key] / max) * plotH);
                return { key: s.key, x: start + si * (barW + 2), y: base - h, w: barW, h };
            });
            const aria = `${m.label} ${m.year}: ` + SERIES.map((s) => `${s.label} ${this.money(m[s.key])}`).join(", ");
            return { key: `${m.year}-${m.label}`, gi, m, x: gx, w: slot, cx: gx + slot / 2, bars, aria };
        });
        return { ticks, groups, base, plotW };
    }

    get chartEmpty() {
        const s = this.state.data.status_split || {};
        return !(s.paid || s.pending || s.overdue);
    }

    showTip(group) {
        this.state.tip = {
            gi: group.gi,
            left: (group.cx / CH.w) * 100,
            m: group.m,
        };
    }

    hideTip() {
        this.state.tip = null;
    }

    // ---------------------------------------------------------------- donut
    get donut() {
        const s = this.state.data.status_split || { paid: 0, pending: 0, overdue: 0 };
        const total = (s.paid || 0) + (s.pending || 0) + (s.overdue || 0);
        const r = 52;
        const c = 2 * Math.PI * r;
        let acc = 0;
        const segs = SERIES.map((ser) => {
            const v = s[ser.key] || 0;
            const len = total ? (v / total) * c : 0;
            // small gap between segments when more than one is present
            const gap = total && len > 3 ? 2 : 0;
            const seg = {
                key: ser.key, label: ser.label, value: v,
                pct: total ? Math.round((v / total) * 100) : 0,
                dash: `${Math.max(len - gap, 0)} ${c}`,
                offset: -acc,
            };
            acc += len;
            return seg;
        });
        return { r, c, total, segs, paidPct: total ? Math.round(((s.paid || 0) / total) * 100) : 0 };
    }

    // ---------------------------------------------------------------- table
    setFilter(key) {
        if (this.state.list.status === key) {
            return;
        }
        this.state.list.status = key;
        this.state.list.offset = 0;
        this.loadList();
    }

    onSearchInput(ev) {
        this.state.list.search = ev.target.value;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            this.state.list.offset = 0;
            this.loadList();
        }, 300);
    }

    clearSearch() {
        clearTimeout(this.searchTimer);
        this.state.list.search = "";
        this.state.list.offset = 0;
        this.loadList();
    }

    get pageInfo() {
        const { offset, total, rows } = this.state.list;
        if (!total) {
            return "0 of 0";
        }
        return `${offset + 1}–${offset + rows.length} of ${total}`;
    }

    get hasPrev() {
        return this.state.list.offset > 0;
    }

    get hasNext() {
        const l = this.state.list;
        return l.offset + l.rows.length < l.total;
    }

    page(dir) {
        const l = this.state.list;
        l.offset = Math.max(0, l.offset + dir * PAGE_SIZE);
        this.loadList();
    }

    get emptyText() {
        if (this.state.list.search) {
            return `No invoices match “${this.state.list.search}”.`;
        }
        return EMPTY_TEXT[this.state.list.status];
    }

    onRowKey(ev, row) {
        if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            this.openInvoice(row, ev);
        }
    }

    // ---------------------------------------------------------------- drawer
    async openInvoice(row, ev) {
        this.lastRow = ev?.currentTarget || null;
        this.state.selectedId = row.id;
        this.state.detail = null;
        this.state.detailError = null;
        this.state.detailLoading = true;
        try {
            const res = await this.orm.call("bl.dashboard", "invoice_detail", [row.id]);
            if (this.state.selectedId !== row.id) {
                return; // user moved on
            }
            if (!res) {
                this.state.detailError = "This invoice is no longer available.";
            } else {
                this.state.detail = res;
            }
        } catch (e) {
            if (this.state.selectedId === row.id) {
                this.state.detailError = e.data?.message || e.message || "Could not load the invoice.";
            }
        } finally {
            if (this.state.selectedId === row.id) {
                this.state.detailLoading = false;
            }
        }
    }

    closeDrawer() {
        this.state.selectedId = null;
        this.state.detail = null;
        this.state.detailError = null;
        const row = this.lastRow;
        this.lastRow = null;
        if (row && row.isConnected) {
            row.focus();
        }
    }

    onRootKey(ev) {
        if (ev.key === "Escape" && this.state.selectedId) {
            ev.stopPropagation();
            this.closeDrawer();
        }
    }

    openRecord(model, id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: model, res_id: id, views: [[false, "form"]] });
    }
}

registry.category("actions").add("bl_dashboard", BlDashboard);
