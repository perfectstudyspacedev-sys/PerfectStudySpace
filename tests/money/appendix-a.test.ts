// PSS-AI plan, Appendix A part 1 — money regression tests. One named test per case (A1–A33).
// "Pinned" values record what the code returns today; if one ever looks wrong, report it to the
// owner instead of changing the code (ground rule R1).
import { describe, expect, test } from 'vitest'
import { addMonths, endDateForMonths } from '../../supabase/functions/_shared/dates.ts'
import { renewalKind, multiMonthDiscount, membershipTotalDays, unusedDaysRefund, computeStudentStatus } from '../../supabase/functions/_shared/membership.ts'
import { overstayFromLastVisit } from '../../supabase/functions/_shared/overstay.ts'
import { computeOvertimeCharge } from '../../supabase/functions/_shared/overtime.ts'

describe('renewalKind', () => {
  test('A1 end 2026-10-15, today 2026-10-15 → early', () => expect(renewalKind('2026-10-15', '2026-10-15')).toBe('early'))
  test('A2 end 2026-10-15, today 2026-10-16 → grace', () => expect(renewalKind('2026-10-15', '2026-10-16')).toBe('grace'))
  test('A3 end 2026-10-15, today 2026-10-25 → grace (day 10)', () => expect(renewalKind('2026-10-15', '2026-10-25')).toBe('grace'))
  test('A4 end 2026-10-15, today 2026-10-26 → late (day 11)', () => expect(renewalKind('2026-10-15', '2026-10-26')).toBe('late'))
})

describe('addMonths', () => {
  test('A5 2026-01-31 + 1 → 2026-02-28', () => expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'))
  test('A6 2028-01-31 + 1 → 2028-02-29', () => expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'))
})

describe('endDateForMonths', () => {
  test('A7 2026-08-20, 1 → 2026-09-19', () => expect(endDateForMonths('2026-08-20', 1)).toBe('2026-09-19'))
  test('A8 2026-10-01, 1 → 2026-10-31', () => expect(endDateForMonths('2026-10-01', 1)).toBe('2026-10-31'))
  test('A9 2026-01-31, 1 → 2026-02-28 (clamped, no extra day removed)', () => expect(endDateForMonths('2026-01-31', 1)).toBe('2026-02-28'))
  test('A10 2026-09-01, 3 → 2026-11-30', () => expect(endDateForMonths('2026-09-01', 3)).toBe('2026-11-30'))
})

describe('multiMonthDiscount', () => {
  test('A11 1, 2, 3, 5, 6, 12 months → 0, 5, 10, 10, 15, 15 %', () => {
    expect([1, 2, 3, 5, 6, 12].map(multiMonthDiscount)).toEqual([0, 5, 10, 10, 15, 15])
  })
})

describe('membershipTotalDays', () => {
  test('A12 2026-09-01 → 2026-11-30, 3 months → 90', () => {
    expect(membershipTotalDays({ start_date: '2026-09-01', end_date: '2026-11-30', months_paid: 3 })).toBe(90)
  })
  test('A13 2026-09-01 → 2026-09-02, 1 month → 30 (floored at months × 30)', () => {
    expect(membershipTotalDays({ start_date: '2026-09-01', end_date: '2026-09-02', months_paid: 1 })).toBe(30)
  })
})

describe('unusedDaysRefund', () => {
  const plan = { plan_amount: 3375, plan_days: 90, start_date: '2026-09-01', end_date: '2026-11-30', months_paid: 3, monthly_fee: 1250, discount_percent: 10, total_paid: 3375, fee_due: 0 }
  test('A14 ₹3,375 / 90 days, 60 days left on 2026-10-01 → refund 2250 at 37.5/day', () => {
    const r = unusedDaysRefund(plan, '2026-10-01', false)
    expect(r.proratedRefund).toBe(2250)
    expect(r.refundDailyRate).toBe(37.5)
    expect(r.remainingDays).toBe(60)
  })
  test('A15 same as A14 with waive → refund 0', () => {
    expect(unusedDaysRefund(plan, '2026-10-01', true).proratedRefund).toBe(0)
  })
  test('A16 same as A14 with total_paid 1000 → refund 1000 (never more than paid + fee due)', () => {
    expect(unusedDaysRefund({ ...plan, total_paid: 1000 }, '2026-10-01', false).proratedRefund).toBe(1000)
  })
  test('A17 period not started (starts 2026-11-01, today 2026-10-20) → full 1250', () => {
    const r = unusedDaysRefund({ plan_amount: 1250, plan_days: 30, start_date: '2026-11-01', end_date: '2026-11-30', months_paid: 1, monthly_fee: 1250, total_paid: 1250, fee_due: 0 }, '2026-10-20', false)
    expect(r.proratedRefund).toBe(1250)
    expect(r.remainingDays).toBe(30)
  })
  test('A18 legacy row (no plan_amount/plan_days): 1250 × 3 less 10% over 90 days → 2250', () => {
    const r = unusedDaysRefund({ plan_amount: null, plan_days: null, monthly_fee: 1250, months_paid: 3, discount_percent: 10, start_date: '2026-09-01', end_date: '2026-11-30', total_paid: 3375, fee_due: 0 }, '2026-10-01', false)
    expect(r.proratedRefund).toBe(2250)
    expect(r.planAmount).toBe(3375)
    expect(r.totalDays).toBe(90)
  })
})

describe('overstayFromLastVisit', () => {
  const mem = { end_date: '2026-10-15', monthly_fee: 1250 }
  test('A19 last visit 2026-10-22 → 7 days, ₹292 at 41.67/day', () => {
    const r = overstayFromLastVisit(mem, '2026-10-22', '2026-10-30')
    expect(r).toMatchObject({ overstayDays: 7, overstayCharge: 292, overstayDailyRate: 41.67, lastVisitDate: '2026-10-22' })
  })
  test('A20 last visit 2026-11-05 → capped at 10 days, ₹417', () => {
    expect(overstayFromLastVisit(mem, '2026-11-05', '2026-11-10')).toMatchObject({ overstayDays: 10, overstayCharge: 417 })
  })
  test('A21 no visit after expiry → 0 days, ₹0', () => {
    expect(overstayFromLastVisit(mem, null, '2026-10-30')).toMatchObject({ overstayDays: 0, overstayCharge: 0, lastVisitDate: null })
  })
  test('A22 plan ends today or later → 0 days, ₹0', () => {
    expect(overstayFromLastVisit(mem, '2026-10-20', '2026-10-15')).toMatchObject({ overstayDays: 0, overstayCharge: 0 })
    expect(overstayFromLastVisit({ ...mem, end_date: '2026-10-31' }, '2026-10-20', '2026-10-25')).toMatchObject({ overstayDays: 0, overstayCharge: 0 })
  })
})

describe('computeOvertimeCharge', () => {
  test('A23 15 min on a 6 h booking → 0 h, ₹0 (inside grace)', () => expect(computeOvertimeCharge(15, 6, 0, false)).toMatchObject({ overtimeHours: 0, overtimeCharge: 0 }))
  test('A24 16 min, 6 h → 1 h, ₹10', () => expect(computeOvertimeCharge(16, 6, 0, false)).toMatchObject({ overtimeHours: 1, overtimeCharge: 10 }))
  test('A25 76 min, 6 h → 2 h, ₹20', () => expect(computeOvertimeCharge(76, 6, 0, false)).toMatchObject({ overtimeHours: 2, overtimeCharge: 20 }))
  test('A26 30 min on a 3 h walk-in → 1 h, ₹5 (discounted first hour)', () => expect(computeOvertimeCharge(30, 3, 0, true)).toMatchObject({ overtimeHours: 1, overtimeCharge: 5 }))
  test('A27 76 min, 9 h → 2 h, total ₹100, charge ₹100 (pinned: the 10-hour cap)', () => {
    expect(computeOvertimeCharge(76, 9, 0, false)).toEqual({ overtimeHours: 2, overtimeCharge: 100, totalCost: 100 })
  })
})

describe('computeStudentStatus', () => {
  const today = '2026-10-16'
  const clear = { fee_due: 0, end_date: '2026-11-15' }
  test('A28 no membership, no locker → inactive', () => expect(computeStudentStatus(null, null, today)).toBe('inactive'))
  test('A29 no membership, locker due before today → pending', () => expect(computeStudentStatus(null, { locker_due_date: '2026-10-10', fee_due: 0 }, today)).toBe('pending'))
  test('A30 membership with fee_due 100 → pending', () => expect(computeStudentStatus({ fee_due: 100, end_date: '2026-11-15' }, null, today)).toBe('pending'))
  test('A31 membership ended before today → pending', () => expect(computeStudentStatus({ fee_due: 0, end_date: '2026-10-15' }, null, today)).toBe('pending'))
  test('A32 membership clear, locker fee_due > 0 → pending', () => expect(computeStudentStatus(clear, { locker_due_date: '2026-11-01', fee_due: 50 }, today)).toBe('pending'))
  test('A33 membership clear, nothing owed on the locker → active', () => expect(computeStudentStatus(clear, { locker_due_date: '2026-11-01', fee_due: 0 }, today)).toBe('active'))
})
