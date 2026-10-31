/* Brightloop login page: theme switch, animated art panel, form validation and feedback. Plain JS, no deps. */
(function () {
    "use strict";

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
            var factory = window.BlLoginAnim && window.BlLoginAnim.topo;
            var layer = document.createElement("div");
            layer.className = "bl-anim";
            art.insertBefore(layer, art.querySelector(".bl-art-copy"));
            var anim = null;
            try {
                // same topo lines in both themes: white on charcoal, walnut (#704730) on warm paper
                anim = factory ? factory(layer, {
                    reducedMotion: reduce,
                    color: theme === "dark" ? [1, 1, 1] : [0.44, 0.28, 0.19],
                }) : null;
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

        /* ---------- forms: login, sign-up and reset share the same helpers ---------- */
        sessionStorage.removeItem("bl-splash"); // back on an auth page: no pending welcome splash
        var form = document.querySelector("form.oe_login_form, form.oe_signup_form, form.oe_reset_password_form");
        if (!form) { return; }
        var isLogin = form.classList.contains("oe_login_form");
        var login = form.querySelector("input[name='login']:not([readonly])");
        var password = form.querySelector("input[name='password']");
        var confirm = form.querySelector("input[name='confirm_password']");
        var submit = form.querySelector("button[type='submit']");
        var DEBOUNCE_MS = 300;

        // message line under a field (created on demand, linked for screen readers)
        function messageFor(input, kind) {
            var id = input.id + "_" + kind;
            var el = document.getElementById(id);
            if (!el) {
                el = document.createElement("p");
                el.id = id;
                el.className = kind === "err" ? "bl-field-error" : "bl-suggest";
                el.setAttribute("aria-live", "polite");
                input.parentNode.appendChild(el);
                input.setAttribute("aria-describedby", ((input.getAttribute("aria-describedby") || "") + " " + id).trim());
            }
            return el;
        }

        function setError(input, message) {
            input.setAttribute("aria-invalid", message ? "true" : "false");
            messageFor(input, "err").textContent = message || "";
            return !message;
        }

        function checkEmail() {
            if (!login) { return true; }
            var r = window.BlEmailCheck ? window.BlEmailCheck.check(login.value) : { error: null, suggestion: null };
            var box = messageFor(login, "hint");
            box.textContent = "";
            if (r.suggestion) {
                var btn = document.createElement("button");
                btn.type = "button";
                btn.className = "bl-suggest-apply";
                btn.textContent = r.suggestion;
                btn.addEventListener("click", function () {
                    login.value = r.suggestion;
                    checkEmail();
                    login.focus();
                });
                box.append("Did you mean ", btn, "?");
            }
            return setError(login, r.error);
        }

        var RULES = [
            [function (p) { return p.length > 8; }, "More than 8 characters"],
            [function (p) { return /[A-Z]/.test(p); }, "An uppercase letter"],
            [function (p) { return /[a-z]/.test(p); }, "A lowercase letter"],
            [function (p) { return /[^A-Za-z0-9]/.test(p); }, "A special character (e.g. # ! @)"],
        ];
        var checklist = null;
        if (confirm && password) {
            // creating a password (sign-up / reset): live checklist matching the server rule
            checklist = document.createElement("ul");
            checklist.className = "bl-pw-rules";
            checklist.id = "bl_pw_rules";
            checklist.setAttribute("aria-label", "Password requirements");
            RULES.forEach(function (r) {
                var li = document.createElement("li");
                li.textContent = r[1];
                checklist.appendChild(li);
            });
            password.parentNode.appendChild(checklist);
            password.setAttribute("aria-describedby", ((password.getAttribute("aria-describedby") || "") + " bl_pw_rules").trim());
        }

        function updateChecklist() {
            var missing = 0;
            RULES.forEach(function (r, i) {
                var met = r[0](password.value);
                checklist.children[i].classList.toggle("bl-met", met);
                missing += met ? 0 : 1;
            });
            return missing;
        }

        function checkPassword() {
            var p = password.value;
            if (!checklist) { return setError(password, p ? "" : "Enter your password."); }
            var missing = updateChecklist();
            return setError(password, !p ? "Choose a password." : missing ? "Your password doesn't meet all the requirements yet." : "");
        }

        function checkConfirm() {
            if (!confirm) { return true; }
            if (!confirm.value) { return setError(confirm, "Repeat your password."); }
            return setError(confirm, confirm.value !== password.value ? "The passwords don't match." : "");
        }

        // touched-field validation: quiet until the user leaves a field once, then live with a short debounce
        function wire(input, fn) {
            if (!input) { return; }
            var timer = null;
            input.addEventListener("blur", function () {
                if (input.value) { input.dataset.blTouched = "1"; fn(); }
            });
            input.addEventListener("input", function () {
                clearTimeout(timer);
                if (input.getAttribute("aria-invalid") === "true") { fn(); return; } // clear errors as soon as fixed
                if (input.dataset.blTouched) { timer = setTimeout(fn, DEBOUNCE_MS); }
            });
        }
        wire(login, checkEmail);
        wire(password, function () { checkPassword(); if (confirm && confirm.dataset.blTouched) { checkConfirm(); } });
        wire(confirm, checkConfirm);
        if (checklist) { password.addEventListener("input", updateChecklist); } // ticks update on every keystroke

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

        // form-level message (offline, slow connection) announced to screen readers
        var formMsg = document.createElement("p");
        formMsg.className = "bl-form-msg";
        formMsg.setAttribute("role", "status");
        formMsg.setAttribute("aria-live", "polite");
        if (submit) { submit.parentNode.insertBefore(formMsg, submit); } else { form.appendChild(formMsg); }

        var slowTimer = null;
        var label = submit && submit.querySelector(".bl-submit-label");
        var idleLabel = label ? label.textContent : "";

        function resetSubmit() {
            clearTimeout(slowTimer);
            if (!submit) { return; }
            submit.disabled = false;
            submit.classList.remove("bl-loading");
            submit.removeAttribute("aria-busy");
            if (label) { label.textContent = idleLabel; }
        }

        form.addEventListener("submit", function (ev) {
            var ok = [checkEmail(), checkPassword(), checkConfirm()].every(Boolean);
            if (!ok) {
                ev.preventDefault();
                var first = form.querySelector("[aria-invalid='true']");
                if (first) { first.focus(); }
                return;
            }
            if (navigator.onLine === false) {
                ev.preventDefault();
                formMsg.textContent = "You're offline. Check your connection and try again.";
                return;
            }
            if (submit && submit.disabled) { ev.preventDefault(); return; } // no double submits
            formMsg.textContent = "";
            if (isLogin || confirm) { sessionStorage.setItem("bl-splash", "1"); } // a flag only, never credentials
            if (submit) {
                submit.classList.add("bl-loading");
                submit.setAttribute("aria-busy", "true");
                if (label) { label.textContent = "Signing in…"; }
                setTimeout(function () { submit.disabled = true; }, 0); // after the browser captured the submit
            }
            slowTimer = setTimeout(function () {
                formMsg.textContent = "Still working… your connection seems slow. Please keep this page open.";
            }, 8000);
            // login posts in the background so server/network failures become inline messages;
            // sign-up/reset and the debug "superuser" button keep the normal post
            if (isLogin && window.fetch && window.AbortController && !(ev.submitter && ev.submitter.name)) {
                ev.preventDefault();
                sendLogin();
            }
        });

        function failLogin(message) {
            sessionStorage.removeItem("bl-splash");
            resetSubmit();
            showAuthError(message);
        }

        function sendLogin() {
            var ctrl = new AbortController();
            var timeout = setTimeout(function () { ctrl.abort(); }, 30000);
            fetch(form.action, { method: "POST", body: new FormData(form), credentials: "same-origin", signal: ctrl.signal })
                .then(function (res) {
                    clearTimeout(timeout);
                    if (res.status >= 500) { throw { server: true }; }
                    if (res.redirected && new URL(res.url).pathname !== "/web/login") {
                        window.location.assign(res.url); // signed in (or 2FA step): follow Odoo's redirect
                        return null;
                    }
                    return res.text().then(function (html) {
                        // Odoo re-rendered the login page: take its error (generic, never says if the account exists)
                        var doc = new DOMParser().parseFromString(html, "text/html");
                        var err = doc.querySelector("form.oe_login_form .alert-danger");
                        failLogin(err ? err.textContent.trim() : "Sign-in didn't complete. Please try again.");
                    });
                })
                .catch(function (e) {
                    clearTimeout(timeout);
                    failLogin(e && e.name === "AbortError" ? "The server took too long to answer. Please try again."
                        : e && e.server ? "The server had a problem signing you in. Please try again in a moment."
                            : "Can't reach the server. Check your connection and try again.");
                });
        }

        // back/forward cache: never come back to a stuck spinner
        window.addEventListener("pageshow", resetSubmit);

        // auth error box above the buttons: clear wording, never reveals whether the account exists
        function showAuthError(text) {
            var box = form.querySelector(".alert-danger");
            if (!box) {
                box = document.createElement("p");
                box.className = "alert alert-danger";
                box.setAttribute("role", "alert");
                var buttons = form.querySelector(".oe_login_buttons");
                form.insertBefore(box, buttons);
            }
            var badCredentials = /wrong login\/password|invalid email or password/i.test(text);
            box.textContent = badCredentials ? "Invalid email or password. Check both and try again." : text;
            formMsg.textContent = "";
            if (!isLogin) { return; }
            if (badCredentials) {
                [login, password].forEach(function (i) { if (i) { i.setAttribute("aria-invalid", "true"); } });
                password.focus();
            }
            form.classList.remove("bl-shake");
            void form.offsetWidth; // restart the shake animation on repeated failures
            form.classList.add("bl-shake");
            // the error goes away as soon as the user edits either field
            [login, password].forEach(function (i) {
                if (!i) { return; }
                i.addEventListener("input", function () {
                    box.remove();
                    i.setAttribute("aria-invalid", "false");
                }, { once: true });
            });
        }

        var serverError = form.querySelector(".alert-danger");
        if (serverError) { showAuthError(serverError.textContent.trim()); }

        // social sign-in returns through the provider: show the welcome splash when it lands
        form.querySelectorAll(".o_auth_oauth_providers a").forEach(function (a) {
            a.addEventListener("click", function () { sessionStorage.setItem("bl-splash", "1"); });
        });
    });
})();
