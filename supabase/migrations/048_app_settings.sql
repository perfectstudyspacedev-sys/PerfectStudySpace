-- Small shared key/value store for org-wide settings that every staff member's device
-- should see the same value for — starting with the WhatsApp welcome-message template,
-- which used to live in each browser's localStorage. That meant an owner/admin editing it
-- on one device never reached any other staff member's device; this makes it one shared
-- value, editable by owner/admin, read by everyone.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The edge function talks to this table with the service-role key and enforces
-- owner/admin-only writes in application code, same as every other table here — RLS is
-- enabled defensively with no policies, so a stray anon/authenticated-key client call is
-- denied by default rather than silently reading or writing settings.
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO app_settings (key, value) VALUES (
  'welcome_template',
  $tpl$Hi {name}, welcome to Perfect Study Space! 🎉

Thanks for joining us — we're excited to have you with us. Please take a moment to fill out this form so we can complete your registration:

📝 Fill out the form here:
https://docs.google.com/forms/d/e/1FAIpQLSeolzoVIDAsOq35SZ0MbsJb1qBrBcInBG4VER6As5yc8A0oEA/viewform?usp=header

If you have any questions, feel free to reach out anytime. We're happy to help! 😊$tpl$
);
