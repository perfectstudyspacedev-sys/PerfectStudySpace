// PSS-AI Phase 3 — the pure code behind the AI features: yield prices (I3), seat-hour prediction
// (O1, C7), exam families and the ladder (I25, O9), robots.txt, lead scores and duplicate
// candidates (I24), pay-later risk (O3).
import { describe, expect, test } from 'vitest'
import { peakConcurrency, yieldChange, yieldLimits, yieldPrice } from '../../supabase/functions/_shared/yield.ts'
import { freeDayCredit, hourlyUsage, istHour, leftovers, predictWindow, releaseCredit } from '../../supabase/functions/_shared/seats.ts'
import { DEFAULT_LADDER, examFamily, familiesMatch, nextExam, pageText, parseExamPages, parseLadder, robotsAllows } from '../../supabase/functions/_shared/exams.ts'
import { candidatePairs, nameSimilarity, phoneRelation, scoreEnquiry, sourceRates } from '../../supabase/functions/_shared/leads.ts'
import { paylaterAdvice, paylaterRisk } from '../../supabase/functions/_shared/paylater.ts'

describe('I3 yield pricing', () => {
  test('peak concurrency counts overlapping sessions; back-to-back ones do not overlap', () => {
    expect(peakConcurrency([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 10, end: 20 }])).toBe(2)
    expect(peakConcurrency([{ start: 0, end: 10 }, { start: 10, end: 20 }])).toBe(1)
    expect(peakConcurrency([])).toBe(0)
  })
  test('busy days go up, quiet days go down, an exam adds 5%', () => {
    expect(yieldChange(0.95, null).pct).toBe(15)
    expect(yieldChange(0.8, null).pct).toBe(8)
    expect(yieldChange(0.6, null).pct).toBe(0)
    expect(yieldChange(0.4, null).pct).toBe(-8)
    expect(yieldChange(0.2, null).pct).toBe(-15)
    expect(yieldChange(0.95, 'TNPSC Group 4 on 2027-01-10').pct).toBe(20)
    expect(yieldChange(null, null)).toEqual({ pct: 0, reason: 'no history for this weekday yet' })
  })
  test("the owner's floor and ceiling hold, and never beyond ±20% (C8)", () => {
    expect(yieldLimits('-50', '90')).toEqual({ floor: -20, ceiling: 20 })
    expect(yieldLimits('-5', '10')).toEqual({ floor: -5, ceiling: 10 })
    expect(yieldLimits(null, '')).toEqual({ floor: -20, ceiling: 20 })
    const r = yieldChange(0.95, 'exam', yieldLimits('-5', '10'))
    expect(r.pct).toBe(10)
    expect(r.reason).toMatch(/owner's limits/)
    expect(yieldChange(0.1, null, yieldLimits('-5', '10')).pct).toBe(-5)
  })
  test('prices round to ₹5 and stay within ±20% of the base, in the direction of the change', () => {
    expect(yieldPrice(60, 15)).toBe(70)      // 69 → 70
    expect(yieldPrice(60, -15)).toBe(50)     // 51 → 50
    expect(yieldPrice(35, 20)).toBe(40)      // 42 → 40 (45 would be over +20%)
    expect(yieldPrice(35, -20)).toBe(30)     // 28 → 30 (25 would be under −20%)
    expect(yieldPrice(60, 0)).toBe(60)
    expect(yieldPrice(60, 99)).toBe(70)      // clamped to +20% → 72 → 70
    expect(yieldPrice(100, 2)).toBe(100)     // 102 → 100: never below the base on a rise
    for (const base of [35, 60, 80, 100, 137]) for (let p = -20; p <= 20; p++) {
      const price = yieldPrice(base, p)
      expect(price).toBeGreaterThanOrEqual(base * 0.8)
      expect(price).toBeLessThanOrEqual(base * 1.2)
    }
  })
})

describe('O1 seat hours (C7: 20% safety margin)', () => {
  const day = (d: string, from: number, to: number) => ({ start: Date.parse(istHour(d, from)), end: Date.parse(istHour(d, to)) })
  test('hour usage is the share of days each hour was used', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
    const u = hourlyUsage([day(days[0], 9, 13), day(days[1], 9, 13), day(days[2], 14, 18)], days)
    expect(u[9]).toBe(0.5)
    expect(u[14]).toBe(0.25)
    expect(u[20]).toBe(0)
  })
  test('offers floor(expected free × 0.8) contiguous hours, each used on at most 1 day in 4', () => {
    const usage = Array(24).fill(1)
    for (let h = 14; h < 22; h++) usage[h] = 0          // free 14:00–22:00, used 06:00–14:00
    const w = predictWindow(usage, 6, 23)!
    // expected free = 8 (14–22) + 1 (22–23 is used? no: usage[22] = 1) → 8 × 0.8 = 6 hours
    expect(w.end - w.start).toBe(6)
    expect(w.start).toBeGreaterThanOrEqual(14)
    expect(w.end).toBeLessThanOrEqual(22)
    expect(w.probability).toBe(1)
  })
  test('a member who comes most days gets no offer', () => {
    expect(predictWindow(Array(24).fill(0.9), 6, 23)).toBeNull()
    const sometimes = Array(24).fill(0.3)                  // every hour used 30% of days: above the 25% cap
    expect(predictWindow(sometimes, 6, 23)).toBeNull()
  })
  test('too little time left in the day gives no offer', () => {
    expect(predictWindow(Array(24).fill(0), 21, 23)).toBeNull()   // 2 free hours × 0.8 = 1 < 2
  })
  test('credits: 50% of the resale (D7); one free day = one day of the plan', () => {
    expect(releaseCredit(70)).toBe(35)
    expect(releaseCredit(35)).toBe(18)
    expect(freeDayCredit({ plan_amount: 2100, plan_days: 30 })).toBe(70)
    expect(freeDayCredit({ monthly_fee: 2400 })).toBe(80)
  })
  test('the unsold parts of a release go back on sale (an hour or more)', () => {
    const h = 3600e3
    expect(leftovers(0, 8 * h, 2 * h, 5 * h)).toEqual([{ start: 0, end: 2 * h }, { start: 5 * h, end: 8 * h }])
    expect(leftovers(0, 8 * h, 0.5 * h, 8 * h)).toEqual([])
  })
})

describe('I25 / O9 exams', () => {
  test('exam families from names and from what students typed', () => {
    expect(examFamily('TNPSC Group 4 (VAO) 2027')).toBe('tnpsc-group-4')
    expect(examFamily('tnpsc group IV')).toBe('tnpsc-group-4')
    expect(examFamily('TNPSC Group 2/2A')).toBe('tnpsc-group-2')
    expect(examFamily('Group I services', 'tnpsc')).toBe('tnpsc-group-1')
    expect(examFamily('SSC CGL 2026')).toBe('ssc-cgl')
    expect(examFamily('IBPS PO')).toBe('ibps-po')
    expect(examFamily('SBI Clerk (Junior Associates)')).toBe('sbi-clerk')
    expect(examFamily('TNUSRB Police Constable')).toBe('tnusrb-pc')
    expect(examFamily('civil services prelims')).toBe('upsc-prelims')
    expect(examFamily('TNPSC')).toBe('tnpsc')
    expect(examFamily('NEET PG')).toBeNull()
    expect(examFamily('')).toBeNull()
  })
  test('a student who wrote only the board matches any of its exams', () => {
    expect(familiesMatch('tnpsc', 'tnpsc-group-4')).toBe(true)
    expect(familiesMatch('tnpsc-group-2', 'tnpsc-group-4')).toBe(false)
    expect(familiesMatch(null, 'tnpsc')).toBe(false)
  })
  test('the drafted ladder (C11) and a bad setting', () => {
    expect(nextExam('tnpsc-group-4', DEFAULT_LADDER)).toBe('tnpsc-group-2')
    expect(nextExam('tnpsc-group-1', DEFAULT_LADDER)).toBeNull()
    expect(nextExam('ssc-chsl', DEFAULT_LADDER)).toBe('ssc-cgl')
    expect(parseLadder('not json')).toBe(DEFAULT_LADDER)
    expect(parseLadder('[["a-1","a-2"]]')).toEqual([['a-1', 'a-2']])
  })
  test('pages: https only; robots.txt rules for every crawler', () => {
    expect(parseExamPages('[{"source":"tnpsc","url":"http://x.gov.in/"},{"source":"x","url":"https://y"}]').length).toBe(7)
    expect(parseExamPages('[{"source":"tnpsc","url":"https://x.gov.in/n"}]')).toEqual([{ source: 'tnpsc', url: 'https://x.gov.in/n' }])
    const robots = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/public\n'
    expect(robotsAllows(robots, '/notifications')).toBe(true)
    expect(robotsAllows(robots, '/admin/x')).toBe(false)
    expect(robotsAllows(robots, '/admin/public/list')).toBe(true)
    expect(robotsAllows('User-agent: *\nDisallow: /', '/anything')).toBe(false)
    expect(robotsAllows('', '/x')).toBe(true)
  })
  test('page text drops scripts and keeps links', () => {
    const t = pageText('<html><script>evil()</script><p>Group 4 notice</p><a href="https://x/n.pdf">PDF</a></html>')
    expect(t).not.toMatch(/evil/)
    expect(t).toMatch(/Group 4 notice/)
    expect(t).toMatch(/\[link: https:\/\/x\/n\.pdf\]/)
  })
})

describe('I24 lead scores and duplicate candidates', () => {
  const now = Date.parse('2026-10-23T06:00:00Z')
  const e = (id: string, extra: object) => ({ id, branch_id: 'b1', name: 'Ravi Kumar', phone: '9000000001', source: 'instagram', status: 'new', created_at: '2026-10-22T06:00:00Z', ...extra })
  test("rates come from the hall's own history, smoothed for small numbers", () => {
    const hist = [...Array(10)].map((_, i) => ({ source: 'google_search', status: i < 5 ? 'converted' : 'dropped' }))
      .concat([...Array(10)].map(() => ({ source: 'walk_in', status: 'dropped' })))
    const r = sourceRates(hist)
    expect(r.overall).toBe(0.25)
    expect(r.rate('google_search').rate).toBeCloseTo((5 + 5 * 0.25) / 15)
    expect(r.rate('instagram').rate).toBe(0.25)   // none yet → the overall rate
  })
  test('a fresh trial-session enquiry outranks an old untouched one; closed ones get no score', () => {
    const rates = sourceRates([])
    const fresh = scoreEnquiry(e('a', { status: 'trial_session' }), rates, { activities: 1, openFollowup: true, chatMessages: 3 }, now)!
    const old = scoreEnquiry(e('b', { created_at: '2026-08-01T06:00:00Z' }), rates, { activities: 0, openFollowup: false, chatMessages: 0 }, now)!
    expect(fresh.score).toBeGreaterThan(old.score)
    expect(fresh.reason).toMatch(/trial session/)
    expect(scoreEnquiry(e('c', { status: 'converted' }), rates, { activities: 0, openFollowup: false, chatMessages: 0 }, now)).toBeNull()
  })
  test('names and phones', () => {
    expect(nameSimilarity('Ravi K', 'Ravi Kumar')).toBeGreaterThanOrEqual(0.8)
    expect(nameSimilarity('Ravi Kumar', 'Priya Devi')).toBeLessThan(0.4)
    expect(phoneRelation('9000000001', '9000000002')).toBe('one digit apart')
    expect(phoneRelation('9000000012', '9000000021')).toBe('two digits swapped')
    expect(phoneRelation('9000000001', '9000000001')).toBe('same')
  })
  test('candidates skip same-phone pairs (the page groups those), other branches and closed ones', () => {
    const rows = [
      e('1', {}), e('2', { name: 'Ravi K', phone: '9111111111' }), e('3', { phone: '9000000001', name: 'Ravi Kumaar' }),
      e('4', { name: 'Ravi Kumar', branch_id: 'b2', phone: '9222222222' }), e('5', { name: 'Ravi Kumar', phone: '9333333333', status: 'converted' }),
    ]
    const pairs = candidatePairs(rows as any, new Set())
    const ids = pairs.map((p) => `${p.a.id}-${p.b.id}`)
    expect(ids).toContain('1-2')
    expect(ids).toContain('2-3')
    expect(ids).not.toContain('1-3')        // same phone
    expect(ids.some((x) => x.includes('4') || x.includes('5'))).toBe(false)
    expect(candidatePairs(rows as any, new Set(['1:2'])).map((p) => `${p.a.id}-${p.b.id}`)).not.toContain('1-2')
  })
})

describe('O3 pay-later advice (C13)', () => {
  test('a regular payer is low risk; unpaid history and dues raise it', () => {
    const good = paylaterRisk({ pastPlans: 5, pastUnpaid: 0, duesNow: 0, churn: 0.1, renewals: 5 })
    const bad = paylaterRisk({ pastPlans: 2, pastUnpaid: 2, duesNow: 500, churn: 0.7, renewals: 0 })
    expect(good.band).toBe('low')
    expect(bad.band).toBe('high')
    expect(bad.reasons.join(' ')).toMatch(/unpaid/)
  })
  test('advice follows C13: at most 50% for 15 days with the owner', () => {
    expect(paylaterAdvice('low')).toMatchObject({ maxPercent: 50, days: 15 })
    expect(paylaterAdvice('medium').maxPercent).toBe(25)
    expect(paylaterAdvice('high').maxPercent).toBe(0)
  })
})
