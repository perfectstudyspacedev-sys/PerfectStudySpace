// PSS-AI Phases 5 and 6 — the pure code behind the policy learner (I8), the digital twin (I6),
// experiments (O6), space yield (O7), the portal's study pages (SP18–SP21) and certificates (I33).
import { describe, expect, test } from 'vitest'
import { bucketOf, describeRule, learnPolicies, ruleMatches, AUTO_SCOPES } from '../../supabase/functions/_shared/policy.ts'
import { overtimeCharge, simulateHoldLimit, simulateOvertimeGrace, simulateRenewalGrace } from '../../supabase/functions/_shared/twin.ts'
import { computeOvertimeCharge } from '../../supabase/functions/_shared/overtime.ts'
import { abResult, cleanVariants, variantFor } from '../../supabase/functions/_shared/experiments.ts'
import { buddyPairs, certificateText, examCoach, focusProfile, hmacHex, occupancyGrid, spaceSuggestions, windowOf, wrapped } from '../../supabase/functions/_shared/study.ts'

const hold = (days: number, status: string, why = 'longer than 7 days', dues: boolean | null = false) => ({ kind: 'student_request', action: 'hold', payload: { days, why, dues }, status, requested_by_type: 'student' })
// An IST wall-clock time as epoch ms.
const ist = (d: string, hm: string) => Date.parse(`${d}T${hm}:00+05:30`)

describe('I8 policy learner', () => {
  test('hold requests are bucketed by days and by why they needed the owner', () => {
    expect(bucketOf(hold(10, 'approved'))).toEqual({ scope: 'student_request:hold', bucket: 'days:8-14|why:long|dues:no' })
    expect(bucketOf(hold(3, 'approved', 'permanent seat (a hold frees the cabin)')).bucket).toBe('days:1-7|why:permanent|dues:no')
    expect(bucketOf(hold(5, 'approved', 'second hold this month', true)).bucket).toBe('days:1-7|why:second|dues:yes')
    expect(bucketOf(hold(40, 'approved')).bucket).toBe('days:31+|why:long|dues:no')
    // A request from before dues were recorded never matches a newer rule.
    expect(bucketOf(hold(10, 'approved', 'longer than 7 days', null)).bucket).toBe('days:8-14|why:long|dues:?')
  })
  test('cashbacks are bucketed by value and by who asked', () => {
    expect(bucketOf({ kind: 't3_action', action: 'grant_cashback', payload: { cashbackValue: 150 }, status: 'approved', requested_by_type: 'system' }).bucket).toBe('value:101-300|by:system')
  })
  test('6 decisions at 90% or more become a rule; fewer, or a split, do not', () => {
    expect(learnPolicies(Array.from({ length: 5 }, () => hold(10, 'approved')))).toEqual([])
    const six = learnPolicies(Array.from({ length: 6 }, () => hold(10, 'approved')))
    expect(six).toHaveLength(1)
    expect(six[0]).toMatchObject({ outcome: 'approve', support: 6, agreement: 1 })
    const split = [...Array.from({ length: 8 }, () => hold(10, 'approved')), hold(11, 'denied')]
    expect(learnPolicies(split, 6, 0.8)[0]).toMatchObject({ support: 9, agreement: 0.889 }) // 8 of 9 is 89%…
    expect(learnPolicies(split)).toEqual([])                                               // …under 90%, so not proposed
  })
  test('denials make a deny rule; pending decisions are ignored', () => {
    const r = learnPolicies([...Array.from({ length: 6 }, () => hold(3, 'denied', 'permanent seat')), hold(3, 'pending', 'permanent seat')])
    expect(r).toEqual([expect.objectContaining({ outcome: 'deny', support: 6 })])
  })
  test('a rule is described in words', () => {
    expect(describeRule('student_request:hold', 'days:8-14|why:long|dues:no', 'approve', 9, 9)).toBe('Hold requests of 8–14 days (longer than the self-hold limit) with no dues: you approved 9 of 9.')
    expect(describeRule('t3_action:grant_cashback', 'value:1-100|by:system', 'approve', 7, 7)).toBe('Cashbacks of ₹1–100 queued by the system: you approved 7 of 7.')
  })
  test('only hold requests can ever be decided by a rule', () => {
    expect([...AUTO_SCOPES]).toEqual(['student_request:hold'])
    expect(ruleMatches({ scope: 'student_request:hold', bucket: 'days:8-14|why:long|dues:no' }, hold(12, 'pending'))).toBe(true)
    expect(ruleMatches({ scope: 'student_request:hold', bucket: 'days:8-14|why:long|dues:no' }, hold(15, 'pending'))).toBe(false)
    expect(ruleMatches({ scope: 'student_request:hold', bucket: 'days:8-14|why:long|dues:no' }, hold(12, 'pending', 'longer than 7 days', true))).toBe(false)
  })
})

describe('I6 digital twin', () => {
  test('overtimeCharge at the 15-minute grace equals the real rule (R1)', () => {
    for (const min of [0, 14, 15, 16, 60, 75, 76, 600]) {
      for (const [booked, base, w3] of [[3, 50, true], [6, 70, false], [9, 90, false]] as [number, number, boolean][]) {
        const real = computeOvertimeCharge(min, booked, base, w3)
        expect(overtimeCharge(min, booked, base, w3)).toEqual({ overtimeHours: real.overtimeHours, overtimeCharge: real.overtimeCharge })
      }
    }
  })
  test('a longer overtime grace re-prices only the sessions it reaches', () => {
    const cases = [{ minutes: 20, bookedHours: 3, baseFee: 50, walkinThreeHour: true }, { minutes: 50, bookedHours: 4, baseFee: 60, walkinThreeHour: false }]
    expect(simulateOvertimeGrace(cases, 30)).toEqual({ sessions: 2, changed: 1, currentTotal: 15, proposedTotal: 10, difference: -5 })
  })
  test('a shorter renewal grace turns late renewals from charged days into a gap', () => {
    const r = simulateRenewalGrace([{ daysLate: 3, dailyRate: 50 }, { daysLate: 8, dailyRate: 50 }, { daysLate: 0, dailyRate: 50 }], [2, 7, 12], 5, 10)
    expect(r).toEqual({ renewals: 2, changed: 1, difference: -400, checkinsRefused: 1, checkins: 3 })
    expect(simulateRenewalGrace([{ daysLate: 12, dailyRate: 40 }], [], 14, 10)).toMatchObject({ changed: 1, difference: 480, checkinsRefused: 0 })
  })
  test('the self-hold limit splits past requests', () => {
    expect(simulateHoldLimit([3, 5, 9, 12, 20], 10, 7)).toEqual({ requests: 5, autoNow: 2, autoThen: 3, toApprovalThen: 2 })
    // A cabin or a second hold goes to the owner whatever the limit.
    expect(simulateHoldLimit([3, 5, 9, 12, 20], 10, 7, [5, 9])).toEqual({ requests: 5, autoNow: 1, autoThen: 1, toApprovalThen: 4 })
  })
})

describe('O6 experiments', () => {
  test('a student always gets the same variant; both are used', () => {
    const keys = Array.from({ length: 200 }, (_, i) => variantFor('exp-1', `student-${i}`, ['A', 'B']))
    expect(keys).toEqual(Array.from({ length: 200 }, (_, i) => variantFor('exp-1', `student-${i}`, ['A', 'B'])))
    const a = keys.filter((k) => k === 'A').length
    expect(a).toBeGreaterThan(70)
    expect(a).toBeLessThan(130)
  })
  test('a winner needs 20 per variant and p < 0.1', () => {
    expect(abResult([{ key: 'A', n: 10, k: 9 }, { key: 'B', n: 10, k: 1 }])).toMatchObject({ enough: false, winner: null })
    const clear = abResult([{ key: 'A', n: 40, k: 20 }, { key: 'B', n: 40, k: 8 }])
    expect(clear.enough).toBe(true)
    expect(clear.p).toBeLessThan(0.01)
    expect(clear.winner).toBe('A')
    const close = abResult([{ key: 'A', n: 40, k: 10 }, { key: 'B', n: 40, k: 9 }])
    expect(close.p).toBeGreaterThan(0.5)
    expect(close.winner).toBeNull()
  })
  test('variants are checked per kind (C12: offers at most 10%)', () => {
    expect(cleanVariants('winback_offer', [{ value: 5 }, { value: 11 }])).toEqual({ error: 'A win-back offer is 0 to 10% (C12)' })
    expect(cleanVariants('winback_offer', [{ label: 'Five', value: 5 }, { value: 10 }])).toEqual([{ key: 'A', label: 'Five', value: 5 }, { key: 'B', label: 'B', value: 10 }])
    expect(cleanVariants('next_exam_offer', [{ value: 3 }, { value: 4 }])).toHaveProperty('error')
    expect(cleanVariants('menu_feature', [{ value: 'x' }, { value: 'y' }])).toHaveProperty('error')
    expect(cleanVariants('winback_offer', [{ value: 5 }])).toHaveProperty('error')
  })
})

describe('O7 space yield', () => {
  test('occupancy is averaged per IST weekday and hour over the weeks', () => {
    // Two weeks of Fridays, 18:00–19:30 IST, one of two seats.
    const s = [{ start: ist('2026-10-09', '18:00'), end: ist('2026-10-09', '19:30') }, { start: ist('2026-10-16', '18:00'), end: ist('2026-10-16', '19:30') }]
    const g = occupancyGrid(s, 2, 2)
    expect(g[5][18]).toBe(0.5)
    expect(g[5][19]).toBe(0.25)
    expect(g[5][17]).toBe(0)
    expect(occupancyGrid(s, 0, 2)[5][18]).toBe(0)
  })
  test('suggestions follow the thresholds', () => {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const row of grid) { row[18] = 1; row[19] = 1 }
    const kinds = spaceSuggestions({ grid, seats: 10, cabins: 4, cabinUse: 0.2, waitlist: 0 }).map((s) => s.kind)
    expect(kinds).toEqual(['add_seats', 'quiet_hours', 'quiet_day', 'cabins_unused'])
    const calm = Array.from({ length: 7 }, () => Array(24).fill(0.5))
    expect(spaceSuggestions({ grid: calm, seats: 10, cabins: 0, cabinUse: 0, waitlist: 4 }).map((s) => s.kind)).toEqual(['convert_to_cabins'])
  })
})

describe('Portal R4 and the study buddy', () => {
  test('study windows', () => {
    expect([5, 11, 12, 16, 17, 20, 21, 4].map(windowOf)).toEqual(['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night'])
  })
  test('the focus profile needs two ratings in a window to call it the best', () => {
    const p = focusProfile([{ start: ist('2026-10-12', '09:00'), rating: 5 }, { start: ist('2026-10-13', '09:30'), rating: 4 }, { start: ist('2026-10-13', '22:00'), rating: 5 }])
    expect(p.best).toBe('morning')
    expect(p.windows.find((w) => w.window === 'night')).toMatchObject({ average: 5, ratings: 1 })
    expect(p.weekdays[1]).toMatchObject({ weekday: 1, average: 5, ratings: 1 })
  })
  test('Wrapped: minutes after breaks, streaks across month ends, percentile only with 5 others', () => {
    const s = [
      { start: ist('2026-09-29', '09:00'), end: ist('2026-09-29', '12:00'), desk: 'F1' },
      { start: ist('2026-09-30', '09:00'), end: ist('2026-09-30', '12:00'), pauseMinutes: 60, desk: 'F2' },
      { start: ist('2026-10-01', '09:00'), end: ist('2026-10-01', '10:00'), desk: 'F2' },
    ]
    expect(wrapped(s, [4, 5], [10, 20, 30, 40])).toMatchObject({ minutes: 360, days: 3, longestStreak: 3, bestDay: { date: '2026-09-29', minutes: 180 }, favouriteDesk: 'F2', focus: 4.5, percentile: null })
    expect(wrapped(s, [], [10, 20, 30, 400, 500]).percentile).toBe(60)
  })
  test('the exam coach phases', () => {
    const base = { today: '2026-10-16', examLabel: 'TNPSC Group 4', minutesLast14: Array(14).fill(360), planHours: 6 }
    expect(examCoach({ ...base, examDate: '2027-03-01' })).toMatchObject({ phase: 'far', onTrack: true, avgHours: 6, daysStudied: 14 })
    expect(examCoach({ ...base, examDate: '2026-12-01' }).phase).toBe('near')
    expect(examCoach({ ...base, examDate: '2026-10-30' })).toMatchObject({ phase: 'last_month', daysLeft: 14 })
    expect(examCoach({ ...base, examDate: null }).phase).toBe('no_exam')
    expect(examCoach({ ...base, examDate: null, planHours: 0 }).target).toBe(6)
  })
  test('buddies pair within branch, exam and window, never a busy or already-seen pair', () => {
    const p = (id: string, fam: string | null = 'tnpsc-group-4', w = 'evening', b = 'b1') => ({ student_id: id, branch_id: b, exam_family: fam, study_window: w })
    expect(buddyPairs([p('a'), p('b'), p('c'), p('d', 'ssc-cgl'), p('e', null), p('f', 'tnpsc-group-4', 'evening', 'b2')], new Set(), new Set())).toEqual([['a', 'b']])
    expect(buddyPairs([p('a'), p('b'), p('c')], new Set(['a']), new Set())).toEqual([['b', 'c']])
    expect(buddyPairs([p('a'), p('b'), p('c')], new Set(), new Set(['a:b']))).toEqual([['a', 'c']])
  })
})

describe('I33 certificates', () => {
  test('the signed text covers exactly what the check page shows', async () => {
    // Issued 2026-10-25 20:00 UTC = 26 October in IST: the signed date is the IST one.
    const c = { id: 'abc123defg', hall_name: 'Perfect Study Space — Hopes', student_name: 'Asha Rao', date_from: '2026-09-01', date_to: '2026-09-30', hours: 10, days: 3, issued_at: '2026-10-25T20:00:00.000Z' }
    expect(certificateText(c)).toBe('pss-cert:v2|["abc123defg","Perfect Study Space — Hopes","Asha Rao","2026-09-01","2026-09-30","10.00",3,"2026-10-26"]')
    // A "|" in a name can no longer move text from one field into another.
    expect(certificateText({ ...c, hall_name: 'A|B', student_name: 'C' })).not.toBe(certificateText({ ...c, hall_name: 'A', student_name: 'B|C' }))
    // PostgREST's numeric and timestamp forms sign the same.
    expect(certificateText({ ...c, hours: '10.00', issued_at: '2026-10-25T20:00:00+00:00' })).toBe(certificateText(c))
    const sig = await hmacHex('a-long-enough-secret', certificateText(c))
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
    expect(await hmacHex('a-long-enough-secret', certificateText({ ...c, hours: 10.01 }))).not.toBe(sig)
    expect(await hmacHex('another-secret-value', certificateText(c))).not.toBe(sig)
  })
})
