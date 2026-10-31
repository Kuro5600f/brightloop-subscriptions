// Run: node tools/test_email_check.js
const assert = require("assert");
const { check } = require("../addons/brightloop_subscription/static/src/login/email_check.js");

const ok = (v) => assert.deepStrictEqual(check(v), { error: null, suggestion: null }, v);
const err = (v, part) => assert.ok((check(v).error || "").includes(part), `${v} -> ${JSON.stringify(check(v))}`);
const sugg = (v, s) => assert.strictEqual(check(v).suggestion, s, v);

ok("ada@brightloop.test");
ok("first.last+tag@acme.co.uk");
ok("customer@acme.test");
err("", "Enter");
err("adabrightloop.test", "@");
err("ada@@acme.com", "one @");
err("ada smith@acme.com", "space");
err("ada<x>@acme.com", "not allowed");
err("ada@", "after the @");
err("@acme.com", "before the @");
err("ada@acme", "domain");
err("ada@acme.c", "domain");
err("ada@ac_me.com", "domain");
err("ada.@acme.com", "dot");
sugg("ada@gamil.com", "ada@gmail.com");
sugg("ada@gmial.com", "ada@gmail.com");
sugg("ada@hotmal.com", "ada@hotmail.com");
sugg("ada@outlok.com", "ada@outlook.com");
sugg("ada@yahooo.com", "ada@yahoo.com");
sugg("ada@gmail.con", "ada@gmail.com");
sugg("ada@gmail.cmo", "ada@gmail.com");
assert.strictEqual(check("ada@gmail.com").suggestion, null);
assert.strictEqual(check("ada@acme.com").suggestion, null); // unknown company domains are left alone
console.log("email_check: all assertions passed");
