/* Welcome splash shown once right after a successful sign-in (flag set by the login form; holds no credentials). */
(function () {
    "use strict";
    var flag;
    try { flag = sessionStorage.getItem("bl-splash"); } catch (e) { return; }
    if (!flag || document.querySelector("form.oe_login_form")) { return; } // still on the login page = login failed
    sessionStorage.removeItem("bl-splash");

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var theme = "light";
    try { theme = localStorage.getItem("bl-theme") || theme; } catch (e) { /* default */ }
    var MIN_MS = reduce ? 500 : 1400;
    var shownAt = Date.now();

    var el = document.createElement("div");
    el.className = "bl-splash bl-splash-" + (theme === "dark" ? "dark" : "light");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = '<div class="bl-splash-inner">' +
        '<span class="bl-splash-mark" aria-hidden="true">b</span>' +
        '<p class="bl-splash-hello">Welcome back<span class="bl-splash-name"></span></p>' +
        '<p class="bl-splash-sub">Getting your workspace ready…</p>' +
        '<span class="bl-splash-bar" aria-hidden="true"><span></span></span></div>';

    function mount() { document.body.appendChild(el); }
    if (document.body) { mount(); } else { document.addEventListener("DOMContentLoaded", mount); }

    // greet by name; harmless if it fails
    fetch("/web/session/get_session_info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: {} }),
        credentials: "same-origin",
    }).then(function (r) { return r.json(); }).then(function (data) {
        var name = data && data.result && data.result.name;
        if (name) { el.querySelector(".bl-splash-name").textContent = ", " + name.split(" ")[0]; }
    }).catch(function () { /* stay generic */ });

    function hide() {
        var wait = Math.max(0, MIN_MS - (Date.now() - shownAt));
        setTimeout(function () {
            el.classList.add("bl-splash-out");
            setTimeout(function () { el.remove(); }, reduce ? 0 : 450);
        }, wait);
    }
    if (document.readyState === "complete") { hide(); } else { window.addEventListener("load", hide); }
    setTimeout(hide, 6000); // never block the app, even if 'load' is slow
})();
