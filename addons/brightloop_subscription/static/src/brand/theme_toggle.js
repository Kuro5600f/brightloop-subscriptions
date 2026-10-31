/** @odoo-module **/
// Sun/moon switch in Odoo's top bar, on every backend screen. Same "bl-theme" key as login and dashboard.

import { Component, useState, xml } from "@odoo/owl";
import { registry } from "@web/core/registry";

class BlThemeToggle extends Component {
    static template = xml`
        <button type="button" class="o_bl_theme_btn" t-on-click="toggle" t-att-aria-label="label" t-att-title="label">
            <i t-attf-class="fa {{ state.dark ? 'fa-sun-o' : 'fa-moon-o' }}" aria-hidden="true"/>
        </button>`;
    static props = {};

    setup() {
        this.state = useState({ dark: document.documentElement.getAttribute("data-bl-theme") === "dark" });
    }

    get label() {
        return this.state.dark ? "Switch to light mode" : "Switch to dark mode";
    }

    toggle() {
        const next = this.state.dark ? "light" : "dark";
        this.state.dark = !this.state.dark;
        try {
            localStorage.setItem("bl-theme", next); // theme.js applies it to the page and tells the dashboard
        } catch {
            document.documentElement.setAttribute("data-bl-theme", next);
        }
    }
}

registry.category("systray").add("bl_theme_toggle", { Component: BlThemeToggle }, { sequence: 1 });
