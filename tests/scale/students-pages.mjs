// 2b-C: list_students_page (pages of 50, put back together) must give exactly what the
// Students page used to compute in the browser from the full list_students list.
// The browser logic below is copied verbatim from src/pages/StudentsPage.jsx (main).
import { execFileSync } from "node:child_process";
const sql = (q) => execFileSync("docker", ["exec", "psslocal-db", "psql", "-U", "postgres", "-d", "postgres", "-tAc", q], { encoding: "utf8" }).trim();
const call = async (body, token) => {
  const r = await fetch("http://127.0.0.1:8010/functions/v1/api", { method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
// ── verbatim from the website ──
function formatDate(value) {
  if (!value) return '—'
  const d = value.length <= 10 ? new Date(value + 'T12:00:00') : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)}`
}
const COLUMNS = [
  { key: 'sNo', label: 'S.No' }, { key: 'name', label: 'Name' }, { key: 'cabin', label: 'Cabin' },
  { key: 'startDate', label: 'Start Date', isDate: true }, { key: 'endDate', label: 'Expiry', isDate: true },
  { key: 'month', label: 'Month' }, { key: 'hours', label: 'Hours' }, { key: 'locker', label: 'Locker' },
  { key: 'lockerDue', label: 'Locker Due', isDate: true }, { key: 'course', label: 'Course' }, { key: 'contact', label: 'Contact' },
]
function cellText(row, col) {
  const raw = row[col?.key]
  if (raw == null || raw === '-') return ''
  if (col?.isDate) return `${formatDate(raw)} ${raw}`
  return String(raw)
}
function oldBranchView(students, { search, statusFilter, courseFilter, filters, sortKey, sortDir }) {
  let rows = [...students]
  if (search.trim()) {
    const s = search.trim().toLowerCase()
    rows = rows.filter(r => r.name.toLowerCase().includes(s) || r.contact.includes(s) || r.cabin.toLowerCase().includes(s))
  }
  rows = rows.filter(r => r.status === statusFilter)
  if (courseFilter) rows = rows.filter(r => r.course === courseFilter)
  Object.entries(filters).forEach(([key, rawVal]) => {
    const val = rawVal.trim().toLowerCase()
    if (!val) return
    const col = COLUMNS.find(c => c.key === key)
    rows = rows.filter(r => cellText(r, col).toLowerCase().includes(val))
  })
  rows.sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    const aBlank = av == null || av === '-' || av === ''
    const bBlank = bv == null || bv === '-' || bv === ''
    if (aBlank || bBlank) return aBlank && bBlank ? 0 : aBlank ? 1 : -1
    let cmp
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv
    } else {
      const an = Number(av)
      const bn = Number(bv)
      cmp = !Number.isNaN(an) && !Number.isNaN(bn) && String(av).trim() !== '' && String(bv).trim() !== ''
        ? an - bn
        : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
    }
    return sortDir === 'asc' ? cmp : -cmp
  })
  return rows
}
function oldCourses(students) { return [...new Set(students.map(s => s.course).filter(c => c && c !== '-'))].sort() }
function groupByBranchName(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = row.branches?.name ?? 'Unknown Branch'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}
function oldCombined(students, { search, statusFilter, branchFilter }) {
  const searched = search.trim()
    ? students.filter(s => { const q = search.trim().toLowerCase(); return s.name.toLowerCase().includes(q) || s.contact.includes(q) || String(s.cabin).toLowerCase().includes(q) })
    : students
  const filtered = statusFilter ? searched.filter(s => s.status === statusFilter) : searched.filter(s => s.status !== 'inactive')
  const allGroups = groupByBranchName(filtered)
  const visibleGroups = branchFilter ? allGroups.filter(([name]) => name === branchFilter) : allGroups
  return { rows: visibleGroups.flatMap(([, rows]) => rows), counts: allGroups.map(([n, r]) => [n, r.length]) }
}
// ── end of the website's logic ──

const token = (await call({ action: "login", username: "owner", password: "local-owner-pass" })).body.token;
const branch = sql("SELECT id FROM branches WHERE is_active ORDER BY name LIMIT 1");
let fails = 0, n = 0;
async function pagesOf(body) {
  const ids = []; let page = 1, first;
  for (;;) {
    const r = await call({ ...body, page, pageSize: 50 }, token);
    if (r.status !== 200) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
    first ??= r.body;
    ids.push(...r.body.rows.map((x) => x.id));
    if (r.body.rows.length > 50) throw new Error("page larger than 50");
    if (page >= r.body.pages) break;
    page++;
  }
  return { ids, first };
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

console.log("-- one branch: every sort column and direction, statuses, searches, course and column filters");
const full = (await call({ action: "list_students", branchId: branch }, token)).body.students;
const combos = [];
for (const col of COLUMNS) for (const dir of ["asc", "desc"]) combos.push({ search: "", statusFilter: "active", courseFilter: "", filters: {}, sortKey: col.key, sortDir: dir });
for (const statusFilter of ["active", "pending", "inactive"]) for (const search of ["", "stud", "90000001", "c1"]) for (const courseFilter of ["", "Course 3"])
  for (const filters of [{}, { endDate: "-11-" }, { cabin: "1" }, { lockerDue: "26" }, { hours: "6", name: "00" }])
    combos.push({ search, statusFilter, courseFilter, filters, sortKey: ["sNo", "name", "endDate", "locker"][combos.length % 4], sortDir: combos.length % 2 ? "asc" : "desc" });
let pagesFetched = 0;
for (const c of combos) {
  const want = oldBranchView(full, c).map((r) => r.id);
  const got = await pagesOf({ action: "list_students_page", branchId: branch, ...c });
  pagesFetched += got.first.pages; n++;
  const ok = same(want, got.ids) && got.first.total === want.length && got.first.totalAll === full.length && JSON.stringify(got.first.courses) === JSON.stringify(oldCourses(full));
  if (!ok) { fails++; console.log(`  FAIL ${JSON.stringify(c)}: want ${want.length}, got ${got.ids.length}`); }
}
console.log(`  ${combos.length} combinations, ${pagesFetched} pages of at most 50: ${fails === 0 ? "all identical to the browser's result (same students, same order, same totals and course list)" : fails + " differ"}`);

const exp = await call({ action: "export_students", branchId: branch, ...combos[0] }, token);
n++; const expOk = same(oldBranchView(full, combos[0]).map((r) => r.id), exp.body.students.map((r) => r.id));
if (!expOk) fails++;
console.log(`  ${expOk ? "PASS" : "FAIL"}  export_students returns exactly the filtered rows (${exp.body.students.length})`);

console.log("\n-- Combined Hall: statuses, searches, branch choice");
const fullAll = (await call({ action: "list_students", allBranches: true }, token)).body.students;
const names = [...new Set(fullAll.map((s) => s.branches?.name))].sort();
let cf = 0, cn = 0;
for (const statusFilter of ["", "active", "pending", "inactive"]) for (const search of ["", "stud", "9000001"]) for (const branchFilter of [null, ...names]) {
  const want = oldCombined(fullAll, { search, statusFilter, branchFilter });
  const got = await pagesOf({ action: "list_students_page", allBranches: true, search, statusFilter, branchName: branchFilter });
  cn++; n++;
  if (!(same(want.rows.map((r) => r.id), got.ids) && JSON.stringify(want.counts) === JSON.stringify(got.first.branchCounts))) { cf++; fails++; console.log(`  FAIL ${statusFilter}/${search}/${branchFilter}`); }
}
console.log(`  ${cn} combinations: ${cf === 0 ? "all identical (same students, same order, same per-branch counts)" : cf + " differ"}`);

console.log("\n-- payload size: one page vs the whole list");
const p1 = await call({ action: "list_students_page", allBranches: true, page: 1 }, token);
console.log(`  one page: ${JSON.stringify(p1.body).length} bytes; whole list: ${JSON.stringify(fullAll).length} bytes (${fullAll.length} students)`);
console.log(`\n${n} checks, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
