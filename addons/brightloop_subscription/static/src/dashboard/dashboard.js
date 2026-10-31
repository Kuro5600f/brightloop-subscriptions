/** @odoo-module **/

import { Component, onWillStart, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

export class BlDashboard extends Component {
    static template = "brightloop_subscription.Dashboard";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.state = useState({ loading: true, error: null, data: null, dateFrom: "", dateTo: "" });
        onWillStart(() => this.load());
    }

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

    money(value) {
        const n = (value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `${this.state.data.currency_symbol} ${n}`;
    }

    clearDates() {
        this.state.dateFrom = "";
        this.state.dateTo = "";
        this.load();
    }

    open(model, id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: model, res_id: id, views: [[false, "form"]] });
    }

    openAction(xmlId) {
        this.action.doAction(xmlId);
    }
}

registry.category("actions").add("bl_dashboard", BlDashboard);
