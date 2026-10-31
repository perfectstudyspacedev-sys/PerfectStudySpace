import { describe, expect, test } from 'vitest'
import { staffNavigation, filterNavigation } from '../../src/lib/navigation.js'

const paths = (groups: ReturnType<typeof staffNavigation>) => groups.flatMap(group => group.items.map(item => item.to))
const features = { analyst: true, portal: true, upiPay: true, anomaly: true, sessionWatch: true, foodOrders: true, foodStock: true, tickets: true, collections: true, referralLinks: true, ownerOverview: true, policyLearner: true, yieldPricing: true }
describe('workspace navigation', () => {
  test('every enabled owner page is reachable once, in a named section', () => {
    const groups = staffNavigation({ isOwner: true, flags: features, pendingSignups: 3 })
    const routes = paths(groups)
    expect(routes).toHaveLength(22)
    expect(new Set(routes).size).toBe(routes.length)
    expect(routes).toEqual(expect.arrayContaining(['/analyst', '/growth', '/learning', '/approvals', '/revenue', '/settings/branches', '/settings/staff']))
    expect(groups.flatMap(group => group.items).find(item => item.to === '/membership')?.badge).toBe(3)
  })
  test('staff never receive owner-only destinations, even when all features are on', () => {
    const routes = paths(staffNavigation({ flags: features }))
    for (const route of ['/analyst', '/flags', '/growth', '/learning', '/approvals', '/revenue', '/overview', '/send-list', '/settings/branches', '/settings/staff']) {
      expect(routes).not.toContain(route)
    }
    expect(routes).toEqual(expect.arrayContaining(['/students', '/reports', '/food-orders', '/tickets', '/chat-replies']))
  })
  test('disabled features and retired messages disappear without hiding core operations', () => {
    const groups = staffNavigation({ isOwner: true, flags: { retireStaffOps: true } })
    const routes = paths(groups)
    for (const route of ['/analyst', '/messages', '/food-orders']) expect(routes).not.toContain(route)
    expect(routes).toEqual(expect.arrayContaining(['/', '/bookings', '/membership', '/students', '/reports']))
    expect(groups.some(group => group.label === 'Insights & decisions')).toBe(false)
  })
  test('stock visibility and food-order visibility retain their different role rules', () => {
    expect(paths(staffNavigation({ isOwner: true, flags: { foodStock: true } }))).toContain('/food-orders')
    expect(paths(staffNavigation({ flags: { foodStock: true } }))).not.toContain('/food-orders')
    expect(paths(staffNavigation({ flags: { foodOrders: true } }))).toContain('/food-orders')
  })
  test('page search finds labels and routes without revealing inaccessible pages', () => {
    const staff = staffNavigation({ flags: features })
    expect(paths(filterNavigation(staff, ' revenue '))).toEqual([])
    expect(paths(filterNavigation(staff, 'session'))).toEqual(['/bookings'])
    expect(paths(filterNavigation(staff, '/membership'))).toEqual(['/membership'])
    expect(filterNavigation(staff, '   ')).toBe(staff)
  })
})
