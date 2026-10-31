/* Email format check with friendly messages and typo suggestions (gamil.com -> gmail.com). Plain JS, no deps.
   check(value) -> {error: string|null, suggestion: string|null}. Server-side login is still the real check. */
(function () {
    "use strict";

    var KNOWN = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com", "aol.com",
        "protonmail.com", "proton.me", "mail.com", "gmx.com", "ymail.com", "msn.com"];
    var TLD_TYPOS = { con: "com", cmo: "com", cpm: "com", ocm: "com", vom: "com", xom: "com", comm: "com", cm: "com" };
    var LOCAL_OK = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
    var LABEL_OK = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

    function distance(a, b) {
        var prev = [], cur, i, j;
        for (j = 0; j <= b.length; j++) { prev[j] = j; }
        for (i = 1; i <= a.length; i++) {
            cur = [i];
            for (j = 1; j <= b.length; j++) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            }
            prev = cur;
        }
        return prev[b.length];
    }

    function suggestDomain(domain) {
        var d = domain.toLowerCase();
        if (KNOWN.indexOf(d) !== -1) { return null; }
        var dot = d.lastIndexOf(".");
        var fixed = TLD_TYPOS[d.slice(dot + 1)] ? d.slice(0, dot + 1) + TLD_TYPOS[d.slice(dot + 1)] : d;
        var best = null, bestDist = 3;
        KNOWN.forEach(function (k) {
            var dist = distance(fixed, k);
            if (dist < bestDist) { best = k; bestDist = dist; }
        });
        if (best && d.length >= 5) { return best; }
        return fixed !== d ? fixed : null;
    }

    function check(value) {
        var v = (value || "").trim();
        var res = { error: null, suggestion: null };
        if (!v) { res.error = "Enter your email address."; return res; }
        if (/\s/.test(v)) { res.error = "Remove the space from your email address."; return res; }
        var at = v.split("@").length - 1;
        if (!at) { res.error = "Add an @ between your name and the domain, e.g. you@company.com."; return res; }
        if (at > 1) { res.error = "Use only one @ in your email address."; return res; }
        var local = v.split("@")[0], domain = v.split("@")[1];
        if (!local) { res.error = "Add your name before the @."; return res; }
        if (!domain) { res.error = "Add the domain after the @, e.g. company.com."; return res; }
        if (!LOCAL_OK.test(local)) {
            var bad = local.replace(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]/g, "").charAt(0);
            res.error = "“" + bad + "” is not allowed in an email address.";
            return res;
        }
        if (/^\.|\.$|\.\./.test(local)) { res.error = "The part before the @ can't start or end with a dot, or have two dots in a row."; return res; }
        var labels = domain.split(".");
        if (labels.length < 2 || !labels.every(function (l) { return LABEL_OK.test(l); }) ||
                !/^[A-Za-z]{2,}$/.test(labels[labels.length - 1])) {
            res.error = "Check the domain after the @, e.g. company.com.";
            return res;
        }
        var s = suggestDomain(domain);
        if (s) { res.suggestion = local + "@" + s; }
        return res;
    }

    if (typeof window !== "undefined") { window.BlEmailCheck = { check: check }; }
    if (typeof module !== "undefined") { module.exports = { check: check }; }
})();
