// P0.4 and P0.9: the action registry. Loads only the metadata (registry.ts), not the handlers.
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { ACTION_META } from '../../supabase/functions/api/registry.ts'

const snapshot: string[] = JSON.parse(readFileSync(new URL('./actions.snapshot.json', import.meta.url), 'utf8'))

// Appendix D, explicit T3 list (docs/plans/PSS-AI-execution-plan.md).
const T3_LIST = ['delete_membership', 'close_membership', 'cancel_early_renewal', 'change_membership_plan', 'change_membership_cabin', 'transfer_student_branch', 'apply_loyalty_discount', 'grant_cashback', 'redeem_cashback_now', 'set_overtime_excluded', 'add_attendance', 'update_attendance', 'fix_membership_dates', 'fix_negative_food_pass_balances', 'update_fee_config', 'update_welcome_template', 'update_branch', 'add_desk', 'remove_desk', 'remove_locker', 'update_locker_due_date', 'update_locker_number', 'create_food_item', 'update_food_item', 'create_staff', 'update_staff', 'assign_staff_override', 'clear_staff_override', 'end_staff_session', 'delete_enquiries', 'rotate_signup_link']
// Appendix D, T2 = money comes in (amounts calculated by code).
const T2_LIST = ['record_payment', 'record_locker_payment', 'add_manual_payment', 'topup_food_pass', 'create_food_bill', 'collect_food_bill_shortfall', 'create_walkin', 'create_membership', 'renew_membership', 'renew_locker', 'add_locker', 'checkout_booking']

describe('action registry (P0.4)', () => {
  test('every action handled today is registered — names match tests/registry/actions.snapshot.json', () => {
    expect(ACTION_META.map((a) => a.name).sort()).toEqual(snapshot)
  })
  test('no action is registered twice', () => {
    const names = ACTION_META.map((a) => a.name)
    expect(new Set(names).size).toBe(names.length)
  })
  test('the four public actions are the only ones open without a login', () => {
    expect(ACTION_META.filter((a) => a.callers.includes('public')).map((a) => a.name).sort())
      .toEqual(['login', 'public_create_enquiry', 'public_signup_info', 'public_signup_submit'])
  })
  test('reads are not mutating; every mutating staff action needs an idempotency key', () => {
    for (const a of ACTION_META) {
      if (/^(list_|get_|lookup_|search_)/.test(a.name) || a.name === 'whoami') expect(a.mutating, a.name).toBe(false)
      if (a.mutating && !a.callers.includes('public')) expect(a.idempotent, a.name).toBe(false)
    }
  })
})

describe('permission tiers (P0.9)', () => {
  test('every registry entry has a tier', () => {
    for (const a of ACTION_META) expect(['T0', 'T1', 'T2', 'T3'], a.name).toContain(a.tier)
  })
  test('the T3 set equals the explicit list in Appendix D', () => {
    expect(ACTION_META.filter((a) => a.tier === 'T3').map((a) => a.name).sort()).toEqual([...T3_LIST].sort())
  })
  test('every action Appendix D names as T2 is T2', () => {
    for (const n of T2_LIST) expect(ACTION_META.find((a) => a.name === n)?.tier, n).toBe('T2')
  })
  test('reads (list_, get_, lookup_, search_, whoami) are T0', () => {
    for (const a of ACTION_META) {
      if (/^(list_|get_|lookup_|search_)/.test(a.name) || a.name === 'whoami') expect(a.tier, a.name).toBe('T0')
    }
  })
})
