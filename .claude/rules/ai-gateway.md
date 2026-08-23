# Rule — AI (`backend/ai/**` and any feature calling a model)

## The boundary
`backend/ai/ai-gateway.js` is the **only** place that may invoke a model. No
feature may `require` a vendor SDK or hit a provider endpoint directly. This is
enforced by `tests/ai-gateway-boundary.test.js` and
`tests/ai-single-gateway-guards.test.js` — bypassing it fails the build, correctly.

## Adding or changing an AI feature
1. Register the feature in `ai-policy.js` — there is **no default policy**; an
   unknown feature is denied.
2. Use registry model keys from `ai-model-registry.js`, never raw model ids.
3. Declare classification (`ai-classification.js`) and output type
   (`ai-output-type.js`); human-review requirements derive from the output type.
4. Clinical work must source from an approved Australian region. `AWS_REGION` has
   no default.
5. Everything is fail-closed: an unresolved question denies. Do not add a
   fallback provider, a global-profile retry, or a degraded mode.

## Non-negotiables
- Every outcome, denials included, is recorded via `ai-audit.js`.
- Results carry metadata only — never the prompt, never a raw provider response.
- `ai-kill-switch.js` / `AI_GLOBAL_DISABLE` must keep working after your change.
- Never log or echo prompt content containing clinical or employee data.

Any AI change is **CRITICAL** level: run the `tests/ai-*.test.js` set, not just
the file you touched.
