// PSS-AI Phase 4 — the pure code behind self check-in (D9 location check, overtime from the clock,
// C15 forgotten sessions), seat matching (I4/SP15) and live seats (SP14), food demand and supplier
// drafts (I20/I21), and complaint priority and photo tasks (I22, C17).
import { describe, expect, test } from 'vitest'
import { CHECKIN_RADIUS_M, distanceMetres, forgottenSessionEnd, locationVerdict, newCheckinKey, overtimeMinutesAt, sameKey } from '../../supabase/functions/_shared/checkin.ts'
import { cleanTags, deskUse, freeSeats, rankDesks } from '../../supabase/functions/_shared/seatmatch.ts'
import { forecastDemand, orderLines, supplierDraft } from '../../supabase/functions/_shared/food.ts'
import { needsPhotoByDefault, ticketPriority } from '../../supabase/functions/_shared/tickets.ts'

const HALL = { lat: 11.0168, lng: 76.9558 }
const T0 = Date.parse('2026-10-25T10:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

describe('D9 location check', () => {
  test('distance: 0.001° of latitude is about 111 m', () => {
    expect(Math.round(distanceMetres(HALL, { lat: HALL.lat + 0.001, lng: HALL.lng }))).toBe(111)
    expect(distanceMetres(HALL, HALL)).toBe(0)
  })
  test('inside 100 m with a good fix passes; just outside does not', () => {
    expect(locationVerdict(HALL, { lat: HALL.lat + 0.0008, lng: HALL.lng, accuracy: 25 })).toMatchObject({ ok: true, distance: 89, accuracy: 25 })
    expect(locationVerdict(HALL, { lat: HALL.lat + 0.001, lng: HALL.lng, accuracy: 25 })).toMatchObject({ ok: false, result: 'too_far', distance: 111 })
    expect(CHECKIN_RADIUS_M).toBe(100)
  })
  test('a rough or missing reading is refused, not guessed', () => {
    expect(locationVerdict(HALL, { lat: HALL.lat, lng: HALL.lng, accuracy: 150 })).toMatchObject({ ok: false, result: 'low_accuracy' })
    expect(locationVerdict(HALL, { lat: HALL.lat, lng: HALL.lng, accuracy: undefined })).toMatchObject({ ok: false, result: 'low_accuracy' })
    expect(locationVerdict(HALL, { lat: 'x', lng: 1, accuracy: 5 })).toMatchObject({ ok: false, result: 'no_location', distance: null })
    expect(locationVerdict(HALL, { lat: 91, lng: 1, accuracy: 5 })).toMatchObject({ ok: false, result: 'no_location' })
  })
  test('poster keys are random and compared exactly', () => {
    const a = newCheckinKey(), b = newCheckinKey()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(sameKey(a, a)).toBe(true)
    expect(sameKey(a, b)).toBe(false)
    expect(sameKey(a, a.slice(0, -1))).toBe(false)
  })
})

describe('self checkout and the session watch', () => {
  test('overtime minutes count from the booked end, rounded up, like the staff checkout form', () => {
    expect(overtimeMinutesAt({ end_time: iso(T0) }, T0 - 60e3)).toBe(0)
    expect(overtimeMinutesAt({ end_time: iso(T0) }, T0 + 61e3)).toBe(2)
    expect(overtimeMinutesAt({ end_time: iso(T0) }, T0 + 120 * 60e3)).toBe(120)
  })
  test('a break still in progress is not overtime', () => {
    expect(overtimeMinutesAt({ end_time: iso(T0), is_paused: true, paused_at: iso(T0 - 30 * 60e3) }, T0 + 20 * 60e3)).toBe(0)
  })
  test('C15: a forgotten session closes at its booked end; one still in time is left; a break closes at its start', () => {
    const start = iso(T0 - 8 * 3600e3)
    expect(forgottenSessionEnd({ start_time: start, end_time: iso(T0 - 3600e3) }, T0)).toBe(iso(T0 - 3600e3))
    expect(forgottenSessionEnd({ start_time: start, end_time: iso(T0 + 3600e3) }, T0)).toBeNull()
    // On a break with the booked end still ahead: left alone (booked past 23:30, review #8) …
    expect(forgottenSessionEnd({ start_time: start, end_time: iso(T0 + 3600e3), is_paused: true, paused_at: iso(T0 - 2 * 3600e3) }, T0)).toBeNull()
    // … once the booked end has passed, closed when the break began.
    expect(forgottenSessionEnd({ start_time: start, end_time: iso(T0 - 600e3), is_paused: true, paused_at: iso(T0 - 2 * 3600e3) }, T0)).toBe(iso(T0 - 2 * 3600e3))
    // never before it started
    expect(forgottenSessionEnd({ start_time: iso(T0 - 3600e3), end_time: iso(T0 - 2 * 3600e3) }, T0)).toBe(iso(T0 - 3600e3))
  })
})

describe('I4/SP15 seat matching and SP14 live seats', () => {
  const desks = [
    { id: 'a', label: 'F1', sort_order: 1, tags: [] },
    { id: 'b', label: 'F2', sort_order: 2, tags: ['window'] },
    { id: 'c', label: 'F3', sort_order: 3, tags: ['power', 'quiet'] },
  ]
  test('favourites first, then wanted tags, then history, then desk order', () => {
    expect(rankDesks(desks, { desk_ids: ['c'], tags: ['window'] }, new Map()).map((r) => r.desk.label)).toEqual(['F3', 'F2', 'F1'])
    expect(rankDesks(desks, { tags: ['quiet'] }, new Map([['b', 5]])).map((r) => r.desk.label)).toEqual(['F3', 'F2', 'F1'])
    expect(rankDesks(desks, null, deskUse([{ desk_id: 'b' }, { desk_id: 'b' }, { desk_id: 'a' }, { desk_id: null }])).map((r) => r.desk.label)).toEqual(['F2', 'F1', 'F3'])
    expect(rankDesks(desks, null, new Map())[0]).toMatchObject({ desk: { label: 'F1' }, reason: 'the next free desk' })
  })
  test('unknown tags are dropped', () => {
    expect(cleanTags(['quiet', 'quiet', 'sofa', 3])).toEqual(['quiet'])
    expect(cleanTags('quiet')).toEqual([])
  })
  test('free seats: floating desks minus sessions not in a fixed cabin', () => {
    expect(freeSeats(10, [{ deskSeatType: null }, { deskSeatType: 'floating' }, { deskSeatType: 'fixed' }])).toEqual({ free: 8, total: 10, inUse: 2 })
    expect(freeSeats(1, [{ deskSeatType: null }, { deskSeatType: null }])).toEqual({ free: 0, total: 1, inUse: 2 })
  })
})

describe('I20/I21 food demand and supplier drafts', () => {
  const from = '2026-10-26' // a Monday
  const sales: { date: string; itemId: string; qty: number }[] = []
  for (let i = 1; i <= 28; i++) {
    const d = new Date(Date.parse(`${from}T00:00:00Z`) - i * 86400e3).toISOString().slice(0, 10)
    sales.push({ date: d, itemId: 'tea', qty: new Date(`${d}T00:00:00Z`).getUTCDay() === 1 ? 10 : 3 })
  }
  test('each weekday is its own average over 4 weeks', () => {
    const f = forecastDemand(sales, from, 7)
    expect(f.get('tea')).toEqual([10, 3, 3, 3, 3, 3, 3])
  })
  test('an item never sold on a weekday falls back to its daily average', () => {
    const f = forecastDemand([{ date: '2026-10-21', itemId: 'cake', qty: 14 }], from, 2)
    expect(f.get('cake')).toEqual([0.5, 0.5])
    expect(forecastDemand([{ date: '2026-08-01', itemId: 'old', qty: 9 }], from).has('old')).toBe(false)
  })
  test('the draft covers 3 days × 1.2 of linked use, minus stock', () => {
    const f = forecastDemand(sales, from, 7)
    const lines = supplierDraft([{ id: 'inv', name: 'Tea packets', quantity: 5 }, { id: 'milk', name: 'Milk', quantity: 50 }],
      [{ foodItemId: 'tea', inventoryItemId: 'inv', perUnit: 2 }, { foodItemId: 'tea', inventoryItemId: 'milk', perUnit: 1 }], f)
    // tea: (10 + 3 + 3) × 2 = 32 × 1.2 = 38.4 → 39, minus 5 = 34; milk: 16 × 1.2 → 20 < 50, nothing to order
    expect(lines).toEqual([{ inventoryItemId: 'inv', name: 'Tea packets', have: 5, need: 39, order: 34, supplierPhone: null }])
  })
  test('order lines: whole quantities 1–10, each item once', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    expect(orderLines([{ foodItemId: id, quantity: 2 }])).toEqual([{ foodItemId: id, quantity: 2 }])
    expect(orderLines([])).toHaveProperty('error')
    expect(orderLines([{ foodItemId: id, quantity: 1.5 }])).toHaveProperty('error')
    expect(orderLines([{ foodItemId: 'x; drop table', quantity: 1 }])).toHaveProperty('error')
    expect(orderLines([{ foodItemId: id, quantity: 1 }, { foodItemId: id, quantity: 1 }])).toHaveProperty('error')
  })
})

describe('I22 complaint priority and C17 photo tasks', () => {
  test('urgent words win; Wi-Fi and seat are high; the rest normal', () => {
    expect(ticketPriority('noise', 'Someone stole my bag — theft')).toBe('urgent')
    expect(ticketPriority('cleanliness', 'water leaking near the plug')).toBe('urgent')
    expect(ticketPriority('wifi', 'slow')).toBe('high')
    expect(ticketPriority('seat', 'broken chair')).toBe('high')
    expect(ticketPriority('food', 'cold tea')).toBe('normal')
    // whole words only
    expect(ticketPriority('other', 'the gasket on the door')).toBe('normal')
  })
  test('every daily cleaning task needs a photo; weekly or other tasks do not', () => {
    expect(needsPhotoByDefault({ title: 'Clean washrooms', repeatInterval: 'daily' })).toBe(true)
    expect(needsPhotoByDefault({ title: 'Empty the dustbins', repeatInterval: 'daily' })).toBe(true)
    expect(needsPhotoByDefault({ title: 'Clean washrooms', repeatInterval: 'weekly' })).toBe(false)
    expect(needsPhotoByDefault({ title: 'Count the cash', repeatInterval: 'daily' })).toBe(false)
  })
})
