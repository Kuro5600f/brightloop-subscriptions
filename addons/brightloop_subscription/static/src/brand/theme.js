/* Apply the saved light/dark choice (same key as login + dashboard) to every backend screen, before first paint. */
(function () {
    "use strict";
    var t = null;
    try { t = localStorage.getItem("bl-theme"); } catch (e) { /* storage blocked */ }
    if (t !== "dark" && t !== "light") {
        t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-bl-theme", t);
    // dashboard toggle writes localStorage; mirror it on the whole app
    window.addEventListener("storage", function (e) {
        if (e.key === "bl-theme" && e.newValue) { document.documentElement.setAttribute("data-bl-theme", e.newValue); }
    });
    var setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
        setItem.apply(this, arguments);
        if (k === "bl-theme") {
            document.documentElement.setAttribute("data-bl-theme", v);
            window.dispatchEvent(new CustomEvent("bl-theme-change", { detail: v })); // dashboard follows
        }
    };
})();
