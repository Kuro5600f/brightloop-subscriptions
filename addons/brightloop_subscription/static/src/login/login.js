/* Brightloop login page: theme switch, animated art panel, form validation and feedback. Plain JS, no deps. */
(function () {
    "use strict";

    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var FADE_MS = 450;

    function ready(fn) {
        if (document.readyState !== "loading") { fn(); } else { document.addEventListener("DOMContentLoaded", fn); }
    }

    ready(function () {
        var root = document.documentElement;
        var art = document.querySelector(".bl-auth-art");
        if (!art) { return; }
        var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        /* ---------- animated art panel ---------- */
        var current = null; // {layer, anim}

        function mountFor(theme) {
            var factory = window.BlLoginAnim && window.BlLoginAnim[theme === "dark" ? "topo" : "day"];
            var layer = document.createElement("div");
            layer.className = "bl-anim";
            art.insertBefore(layer, art.querySelector(".bl-art-copy"));
            var anim = null;
            try {
                anim = factory ? factory(layer, { reducedMotion: reduce }) : null;
                if (anim && !document.hidden) { anim.start(); }
            } catch (e) {
                anim = null; // art panel falls back to its CSS gradient
            }
            requestAnimationFrame(function () { layer.classList.add("bl-anim-active"); });
            return { layer: layer, anim: anim };
        }

        function showAnimation(theme) {
            var old = current;
            current = mountFor(theme);
            if (old) {
                old.layer.classList.remove("bl-anim-active");
                setTimeout(function () {
                    if (old.anim) { old.anim.destroy(); }
                    old.layer.remove();
                }, reduce ? 0 : FADE_MS);
            }
        }

        var placeholder = art.querySelector("[data-bl-anim]");
        if (placeholder) { placeholder.remove(); }
        showAnimation(root.getAttribute("data-bl-theme"));

        document.addEventListener("visibilitychange", function () {
            if (!current || !current.anim) { return; }
            if (document.hidden) { current.anim.stop(); } else { current.anim.start(); }
        });

        /* ---------- theme toggle ---------- */
        var toggle = document.querySelector(".bl-theme-toggle");

        function labelToggle(theme) {
            toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
        }

        if (toggle) {
            labelToggle(root.getAttribute("data-bl-theme"));
            toggle.addEventListener("click", function () {
                var next = root.getAttribute("data-bl-theme") === "dark" ? "light" : "dark";
                root.setAttribute("data-bl-theme", next);
                try { localStorage.setItem("bl-theme", next); } catch (e) { /* private mode: not remembered */ }
                labelToggle(next);
                showAnimation(next);
            });
        }

        /* ---------- form ---------- */
        var form = document.querySelector("form.oe_login_form");
        if (!form) { return; } // sign-up / reset pages: shell only
        var login = form.querySelector("input[name='login']");
        var password = form.querySelector("input[name='password']");
        var submit = form.querySelector(".bl-submit");

        function setError(input, message) {
            var box = document.getElementById(input === login ? "bl_login_err" : "bl_password_err");
            input.setAttribute("aria-invalid", message ? "true" : "false");
            input.closest(".mb-3").classList.toggle("bl-has-error", !!message);
            if (box) { box.textContent = message || ""; }
            return !message;
        }

        function checkLogin() {
            var v = login.value.trim();
            if (!v) { return setError(login, "Enter your email address."); }
            if (!EMAIL_RE.test(v)) { return setError(login, "That doesn't look like an email address, e.g. you@company.com."); }
            return setError(login, "");
        }

        function checkPassword() {
            return setError(password, password.value ? "" : "Enter your password.");
        }

        // validate on blur, then live once the user is correcting an error
        login.addEventListener("blur", function () { if (login.value) { checkLogin(); } });
        password.addEventListener("blur", function () { if (password.value) { checkPassword(); } });
        login.addEventListener("input", function () { if (login.getAttribute("aria-invalid") === "true") { checkLogin(); } });
        password.addEventListener("input", function () { if (password.getAttribute("aria-invalid") === "true") { checkPassword(); } });

        // caps lock hint (error prevention)
        var caps = document.getElementById("bl_caps");
        function capsCheck(ev) {
            if (caps && ev.getModifierState) { caps.hidden = !ev.getModifierState("CapsLock"); }
        }
        password.addEventListener("keyup", capsCheck);
        password.addEventListener("keydown", capsCheck);
        password.addEventListener("blur", function () { if (caps) { caps.hidden = true; } });

        // show / hide password
        var eye = form.querySelector(".bl-pass-toggle");
        if (eye) {
            eye.addEventListener("click", function () {
                var show = password.type === "password";
                password.type = show ? "text" : "password";
                eye.setAttribute("aria-pressed", show ? "true" : "false");
                eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
                eye.querySelector("i").className = show ? "fa fa-eye-slash" : "fa fa-eye";
                password.focus();
            });
        }

        // submit: block invalid input, otherwise show loading until the server answers
        form.addEventListener("submit", function (ev) {
            var ok = checkLogin() & checkPassword();
            if (!ok) {
                ev.preventDefault();
                (login.getAttribute("aria-invalid") === "true" ? login : password).focus();
                return;
            }
            if (submit) {
                submit.classList.add("bl-loading");
                submit.setAttribute("aria-busy", "true");
                submit.querySelector(".bl-submit-label").textContent = "Signing in…";
                // disable after the browser has captured the submission
                setTimeout(function () { submit.disabled = true; }, 0);
            }
        });

        // back/forward cache: never come back to a stuck spinner
        window.addEventListener("pageshow", function () {
            if (!submit) { return; }
            submit.disabled = false;
            submit.classList.remove("bl-loading");
            submit.removeAttribute("aria-busy");
            submit.querySelector(".bl-submit-label").textContent = "Log in";
        });

        // server said wrong login/password: flag both fields and put the cursor back in the password
        if (form.querySelector(".alert-danger")) {
            login.setAttribute("aria-invalid", "true");
            password.setAttribute("aria-invalid", "true");
            form.classList.add("bl-shake");
            password.focus();
        }

        // demo accounts: fill both fields
        document.querySelectorAll(".bl-demo-fill").forEach(function (btn) {
            btn.addEventListener("click", function () {
                login.value = btn.getAttribute("data-login");
                password.value = "Brightloop#2026";
                checkLogin();
                checkPassword();
                submit && submit.focus();
            });
        });
    });
})();
