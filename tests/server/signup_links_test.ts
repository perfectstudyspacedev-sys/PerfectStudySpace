// Each branch gets its own sign-up code, stable across calls; rotating one leaves the other alone.
// deno-lint-ignore-file no-explicit-any
import { call, insert, reset, tokenFor, check, done } from "./harness.ts";
reset();
const a = insert("branches", { name: "Hopes", is_active: true, signup_code: null });
const b = insert("branches", { name: "Ram Nagar", is_active: true, signup_code: null });
const c = insert("branches", { name: "100 Feet Road", is_active: true, signup_code: null });
const owner = insert("staff", { username: "own", role: "owner", is_active: true, branch_id: null });
const t = await tokenFor(owner);
const codeA = (await call("get_signup_link", { branchId: a.id }, t)).code;
const codeB = (await call("get_signup_link", { branchId: b.id }, t)).code;
const codeC = (await call("get_signup_link", { branchId: c.id }, t)).code;
check(codeA && codeB && codeC && new Set([codeA, codeB, codeC]).size === 3, "every branch gets a different code", { codeA, codeB, codeC });
check((await call("get_signup_link", { branchId: a.id }, t)).code === codeA && (await call("get_signup_link", { branchId: b.id }, t)).code === codeB, "switching back and forth returns each branch's same code");
check((await call("public_signup_info", { code: codeA })).branchName === "Hopes" && (await call("public_signup_info", { code: codeB })).branchName === "Ram Nagar" && (await call("public_signup_info", { code: codeC })).branchName === "100 Feet Road", "each link opens its own branch");
const newB = (await call("rotate_signup_link", { branchId: b.id }, t)).code;
check(newB !== codeB && (await call("get_signup_link", { branchId: a.id }, t)).code === codeA && (await call("get_signup_link", { branchId: c.id }, t)).code === codeC, "Make new link on one branch leaves the others unchanged");
done();
