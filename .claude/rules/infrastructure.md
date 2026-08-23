# Rule — infrastructure & deployment (`deploy/**`, `.github/workflows/**`)

- **Do not deploy from a development task.** No `deploy/*.sh`, no `az` mutation, no
  `gh workflow run`, no push to `azure-staging`/`production-pilot` intended to
  trigger a release. Deployment happens only in an explicit RELEASE task the user
  has authorised (`/opal-release`).
- `.github/workflows/ci.yml` is the gate: static `node --check` over every backend
  module, unit tests, integration tests against a real Postgres service container,
  migration validation, audit, package. `deploy-staging.yml` and
  `deploy-production.yml` reuse it via `workflow_call`. If you change the test
  layout, check `ci.yml` still finds it.
- CI uses dummy credentials only. Never add a real secret to a workflow, a script,
  or a committed file; secrets live in GitHub/Azure secret stores.
- Deploy order is fixed everywhere: **deploy code → run migrations → restart app.**
- `deploy/staging-synthetic.local.txt` and `.env.e2e` are local credential files —
  never read, echo, or commit them.
- Editing a provisioning script does not mean running it. Describe the change and
  let the user run it.
