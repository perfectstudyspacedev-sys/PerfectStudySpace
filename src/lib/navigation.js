// Keep page visibility in one place so desktop and mobile navigation stay identical.
export function staffNavigation({ isOwner = false, flags = {}, pendingSignups = 0 } = {}) {
  const item = (to, label, visible, extra = {}) => visible ? { to, label, ...extra } : null
  return [
    { label: 'Daily work', items: [
      item('/', 'Dashboard', true, { end: true }),
      item('/bookings', 'Live sessions', true),
      item('/membership', 'Memberships', true, { badge: pendingSignups }),
      item('/students', 'Students', true),
      item('/enquiries', 'Enquiries', true),
      item('/food-menu', 'Food & drinks', true),
      item('/food-orders', 'Food orders', flags.foodOrders || (isOwner && flags.foodStock)),
    ] },
    { label: 'Team & reports', items: [
      item('/actions', 'Tasks & actions', true),
      item('/messages', 'Messages', !flags.retireStaffOps),
      item('/tickets', 'Problems', flags.tickets),
      item('/chat-replies', 'Chat replies', flags.portal),
      item('/revenue', 'Revenue', isOwner),
      item('/reports', 'Reports', true),
    ] },
    { label: 'Insights & decisions', items: [
      item('/overview', 'Every branch', isOwner && flags.ownerOverview),
      item('/analyst', 'AI analyst', isOwner && flags.analyst),
      item('/flags', 'Alerts & flags', isOwner && (flags.anomaly || flags.sessionWatch)),
      item('/approvals', 'Approvals', isOwner && (flags.portal || flags.upiPay || flags.exceptionDesk || flags.referralLinks)),
      item('/send-list', 'Send list', isOwner && (flags.collections || flags.winback || flags.nextExam)),
      item('/growth', 'Growth', isOwner && (flags.yieldPricing || flags.hourRelease || flags.overbooking || flags.referralLinks || flags.examRadar || flags.nextExam || flags.winback)),
      item('/learning', 'Learning', isOwner && (flags.policyLearner || flags.digitalTwin || flags.experiments || flags.spaceYield)),
    ] },
    { label: 'Settings', items: [
      item('/settings/branches', 'Branches', isOwner),
      item('/settings/staff', 'Staff', isOwner),
    ] },
  ].map(group => ({ ...group, items: group.items.filter(Boolean) })).filter(group => group.items.length)
}

export function filterNavigation(groups, query) {
  const term = query.trim().toLowerCase()
  if (!term) return groups
  return groups.map(group => ({
    ...group,
    items: group.items.filter(item => `${item.label} ${item.to} ${group.label}`.toLowerCase().includes(term)),
  })).filter(group => group.items.length)
}
