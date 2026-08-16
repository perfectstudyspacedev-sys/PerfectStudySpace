# Security Rules

- Never hardcode secrets.
- Treat all external input as untrusted.
- Validate authorization server-side.
- Apply least privilege.
- Review authentication and authorization separately.
- Protect sensitive logs and telemetry.
- Check dependency and supply-chain risk for security-sensitive changes.
- Treat webhooks as untrusted and design for replay/idempotency where applicable.
- Review SSRF, XSS, CSRF, injection, privilege escalation, data leakage, and secret exposure where relevant.
- For AI systems, evaluate prompt injection, tool abuse, data exfiltration and unsafe side effects.
