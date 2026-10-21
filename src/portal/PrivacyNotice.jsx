// PSS-AI P2.1 SP8 — the portal's privacy notice, shown before a student sets a PIN and on the
// Privacy page. Drafted in the build; the owner may edit the wording. Names the grievance contact
// when the owner has filled it in (C5).
export default function PrivacyNotice({ businessName = 'Perfect Study Space', grievance }) {
  return (
    <div className="privacy-notice" style={{ fontSize: '0.85rem', lineHeight: 1.55 }}>
      <p><strong>{businessName}</strong> keeps what you need to use the hall: your name, phone number, emergency contact,
        course, plan, payments and receipts, the times you study, any focus ratings you give, and your messages in the portal chat.</p>
      <p>Payment screenshots you upload are kept privately and only the owner sees them. Your PIN is never stored — only a
        scrambled form of it that can't be turned back.</p>
      <p>Portal chat and payment screenshots are read by an AI service (Anthropic&apos;s Claude) to answer you and to check payments.
        It is not used for advertising. Contact details and ID numbers are not sent to it.</p>
      <p>You can ask for a copy of your data or for it to be deleted from the Privacy page. Money records the law requires us to keep
        stay for as long as the law says.</p>
      {grievance?.name && (
        <p>Questions or complaints about your data: {grievance.name}
          {grievance.phone && <> · {grievance.phone}</>}{grievance.email && <> · {grievance.email}</>}</p>
      )}
    </div>
  )
}
