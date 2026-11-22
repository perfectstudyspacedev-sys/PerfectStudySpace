// Paging lint (npm run test:lint-paging; also step 1 of npm run test:scale).
//
// PostgREST answers at most 1000 rows and cuts the rest off silently, and a long id list in
// .in() makes a URL the gateway refuses (414). So every read of a table that grows with
// the business must be one of:
//   - capped: .single() .maybeSingle() .limit() .range(), or a count (head: true);
//   - paged: inside allRows(), allRowsIn() or fetchAllRows();
//   - about one record: filtered with .eq() on "id" or on another *_id column (not branch_id);
//   - explained: a "// paging-ok: <reason>" comment on the line above the query.
// And an .in() whose list is not written out in the code must run inside allRowsIn().
// Exits 1 and lists the offending lines otherwise.
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "supabase/functions/api/index.ts";
const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const GROWING = new Set(["students", "memberships", "bookings", "transactions", "payouts", "cashbacks", "overtime_sessions",
  "food_bills", "food_bill_items", "alerts", "enquiries", "enquiry_activities", "enquiry_followups", "tasks", "task_completions",
  "food_passes", "waivers", "membership_discounts", "membership_edits", "membership_holds", "membership_plan_changes",
  "messages", "signup_requests", "login_failures", "idempotency_keys", "staff_attendance", "inventory_logs", "revenue_daily"]);
const lineOf = (i) => src.slice(0, i).split("\n").length;
const lines = src.split("\n");

function chainAt(i) {
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth < 0) break; }
    else if (depth === 0 && (c === ";" || c === ",")) break;
    else if (depth === 0 && c === "\n") { const rest = src.slice(j).match(/^\s*(\S)/); if (!rest || rest[1] !== ".") break; }
  }
  return src.slice(i, j);
}
// The call this query sits in: allRows / allRowsIn / fetchAllRows (up to 4 levels out).
function enclosingHelper(i) {
  let d = 0;
  for (let k = i - 1, lv = 0; k >= 0 && lv < 4; k--) {
    const c = src[k];
    if (c === ")" || c === "]" || c === "}") d++;
    else if (c === "(" || c === "[" || c === "{") {
      if (d === 0) {
        lv++;
        const m = src.slice(Math.max(0, k - 400), k).match(/(allRows|allRowsIn|fetchAllRows)(<[^()]*>)?\s*$/);
        if (c === "(" && m) return m[1];
      } else d--;
    }
  }
  return null;
}
const problems = [];
const re = /\bdb\s*\.from\("([a-z_]+)"\)/g;
let m;
while ((m = re.exec(src))) {
  const table = m[1];
  if (!GROWING.has(table)) continue;
  const chain = chainAt(m.index).replace(/\s+/g, " ");
  if (!/\.select\(/.test(chain) || /\.(insert|update|upsert|delete)\(/.test(chain)) continue;
  const line = lineOf(m.index);
  // the comment may sit above the statement the query starts on
  const above = lines.slice(Math.max(0, line - 4), line - 1).join("\n");
  if (/\/\/ paging-ok:/.test(above)) continue;
  const helper = enclosingHelper(m.index);
  const capped = /\.(single|maybeSingle|limit|range)\(/.test(chain) || /head: true/.test(chain);
  const oneRecord = /\.eq\("(id|(?!branch_id)[a-z_]+_id)",/.test(chain);
  const inList = chain.match(/\.in\("[a-z_]+", ([^)]*)\)/);
  const literalIn = inList && /^\[[^\]]*\]$/.test(inList[1].trim());
  if (inList && !literalIn && helper !== "allRowsIn" && !capped && !/branchFilter|branchIds/.test(inList[1])) {
    problems.push(`${file}:${line}  ${table}: .in(${inList[1].trim().slice(0, 40)}) not inside allRowsIn()`);
    continue;
  }
  if (!capped && !helper && !oneRecord) problems.push(`${file}:${line}  ${table}: list read without paging helper`);
}
if (problems.length) {
  console.log(`Paging lint: ${problems.length} problem(s)\n` + problems.map((p) => "  " + p).join("\n"));
  console.log('Fix: wrap in allRows()/allRowsIn(), cap it, or explain with "// paging-ok: <reason>" above it.');
  process.exit(1);
}
console.log(`Paging lint: OK (${file})`);
