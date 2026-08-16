# Production Rules

- No production deployment without applicable quality gates.
- Verify environment configuration before deployment.
- Treat database migrations as production code.
- Have a rollback/recovery strategy for risky releases.
- Perform smoke verification after deployment.
- Use canary/observability workflows for meaningful production changes.
- Do not disable security controls simply to make a deployment pass.
- Escalate uncertainty instead of guessing during production operations.
