// P0.4 and P0.9: the action registry. Loads only the metadata (registry.ts), not the handlers.
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { ACTION_META } from '../../supabase/functions/api/registry.ts'

const snapshot: string[] = JSON.parse(readFileSync(new URL('./actions.snapshot.json', import.meta.url), 'utf8'))

// Appendix D, explicit T3 list (docs/plans/PSS-AI-execution-plan.md).
const T3_LIST = ['delete_membership', 'close_membership', 'cancel_early_renewal', 'change_membership_plan', 'change_membership_cabin', 'transfer_student_branch', 'apply_loyalty_discount', 'grant_cashback', 'redeem_cashback_now', 'set_overtime_excluded', 'add_attendance', 'update_attendance', 'fix_membership_dates', 'fix_negative_food_pass_balances', 'update_fee_config', 'update_welcome_template', 'update_branch', 'add_desk', 'remove_desk', 'remove_locker', 'update_locker_due_date', 'update_locker_number', 'create_food_item', 'update_food_item', 'create_staff', 'update_staff', 'assign_staff_override', 'clear_staff_override', 'end_staff_session', 'delete_enquiries', 'rotate_signup_link']
// Appendix D, T2 = money comes in (amounts calculated by code).
const T2_LIST = ['record_payment', 'record_locker_payment', 'add_manual_payment', 'topup_food_pass', 'create_food_bill', 'collect_food_bill_shortfall', 'create_walkin', 'create_membership', 'renew_membership', 'renew_locker', 'add_locker', 'checkout_booking']

// Scheduled jobs added in P0.7/P0.8; run only by the cron function.
const SYSTEM_JOBS = ['cron_expiry_alerts', 'cron_integrity_report', 'cron_purge_idempotency', 'cron_purge_signups', 'cron_resume_holds']
const PEOPLE = ['public', 'staff', 'owner', 'admin']

describe('action registry (P0.4)', () => {
  test('every action is registered — names match tests/registry/actions.snapshot.json (123 from P0.4, plus P0.7–P0.8 and Phase 1)', () => {
    expect(ACTION_META.map((a) => a.name).sort()).toEqual(snapshot)
  })
  test('no action is registered twice', () => {
    const names = ACTION_META.map((a) => a.name)
    expect(new Set(names).size).toBe(names.length)
  })
  test('the public actions are the only ones open without a login (P2.1 adds the portal PIN login and setup)', () => {
    expect(ACTION_META.filter((a) => a.callers.includes('public')).map((a) => a.name).sort())
      .toEqual(['login', 'me_login', 'me_set_pin', 'public_create_enquiry', 'public_signup_info', 'public_signup_submit'])
  })
  test('portal actions (me_*) are for students only, and students reach nothing else (P2.1)', () => {
    for (const a of ACTION_META.filter((x) => x.name.startsWith('me_') && !['me_login', 'me_set_pin'].includes(x.name))) {
      expect(a.callers.filter((c) => c !== 'agent'), a.name).toEqual(['student'])
    }
    for (const a of ACTION_META.filter((x) => x.callers.includes('student'))) expect(a.name, a.name).toMatch(/^me_/)
  })
  test('reads are not mutating; every mutating staff action needs an idempotency key', () => {
    for (const a of ACTION_META) {
      if (/^(list_|get_|lookup_|search_)/.test(a.name) || a.name === 'whoami') expect(a.mutating, a.name).toBe(false)
      // create_portal_setup_code answers with a secret code, which a stored retry answer would keep.
      if (a.mutating && a.callers.some((c) => ['staff', 'owner', 'admin'].includes(c)) && a.name !== 'create_portal_setup_code') expect(a.idempotent, a.name).toBe(false)
    }
  })
  test('agents (P1.8) may call T0 reads, plus save_owner_brief which only agents may call', () => {
    const agentCalls = ACTION_META.filter((a) => a.callers.includes('agent'))
    for (const a of agentCalls.filter((x) => x.name !== 'save_owner_brief')) expect([a.tier, a.mutating], a.name).toEqual(['T0', false])
    expect(ACTION_META.find((a) => a.name === 'save_owner_brief')?.callers).toEqual(['agent'])
  })
  test('system jobs are callable by the system only, and nothing else is', () => {
    expect(ACTION_META.filter((a) => a.callers.includes('system')).map((a) => a.name).sort()).toEqual(SYSTEM_JOBS)
    for (const a of ACTION_META.filter((x) => SYSTEM_JOBS.includes(x.name))) expect(a.callers, a.name).toEqual(['system'])
  })
})

describe('permission tiers (P0.9)', () => {
  test('every registry entry has a tier', () => {
    for (const a of ACTION_META) expect(['T0', 'T1', 'T2', 'T3'], a.name).toContain(a.tier)
  })
  test('the T3 set equals the explicit list in Appendix D (actions people and agents can call)', () => {
    expect(ACTION_META.filter((a) => a.tier === 'T3' && a.callers.some((c) => PEOPLE.includes(c))).map((a) => a.name).sort()).toEqual([...T3_LIST].sort())
  })
  test('system purges destroy records, so they are T3', () => {
    for (const n of ['cron_purge_signups', 'cron_purge_idempotency']) expect(ACTION_META.find((a) => a.name === n)?.tier, n).toBe('T3')
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
