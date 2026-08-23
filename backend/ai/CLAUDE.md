Read `.claude/rules/ai-gateway.md` before changing anything here.

`ai-gateway.js` is the single door to a model, enforced by
`tests/ai-gateway-boundary.test.js`. Fail-closed everywhere: no default policy, no
fallback provider, no degraded mode. Every change here is CRITICAL level.
