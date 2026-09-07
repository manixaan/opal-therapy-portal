# Payroll & Xero Setup — the onboarding stage that creates the employee in Xero Payroll AU

Shipped locally 7 September 2026 (migration 062). This is the technical reference: what the stage does, exactly which Xero operations it uses, how sensitive data is handled, what to configure, how to operate it, and how to roll it back.

## 1. What it does

After the applicant has accepted their offer and supplied bank, tax and super details through their onboarding forms, the Owner (or a delegate holding `onboarding.payroll`) configures the employment and pay settings, approves the set, and presses **Sync to Xero**. The portal then creates the employee in Xero Payroll AU through a server-side Custom Connection, configures the payroll calendar, ordinary earnings rate, pay template, bank account, tax declaration, super membership and statutory super line, reads the employee back, compares it to the approved set, and checks whether the next regular pay run will pick them up.

It never posts a pay run, files STP, pays wages, produces an ABA file, pays super, or invites the employee to Xero Me. Those remain separate, human actions in Xero.

## 2. Architecture

| Piece | File | Role |
|---|---|---|
| Connection | `backend/xero-payroll-connection.js` | `client_credentials` token for the Custom Connection, cached in memory for its lifetime; tenant id from `GET /connections`. Separate secrets from the accounting app. Fail-closed when unset. |
| API client | `backend/xero-payroll-api.js` | Payroll AU v1 over axios. `Xero-Tenant-Id` on every call, `Idempotency-Key` on every POST, 429 `Retry-After`, bounded backoff with jitter, one 401 retry, `ValidationErrors` parsing (400 and inside 200), concurrency cap of 3. |
| Rules | `backend/xero-payroll-mapping.js` | Pure: state derivation, configuration validation, the approved snapshot, payload builders, super fund matching, duplicate matching, read-back verification, next-pay-run readiness, manual actions. |
| Orchestration | `backend/xero-payroll-sync.js` | The ten resumable steps; records identifiers as they are captured; classifies failures. |
| Data | `backend/xero-payroll-db.js`, `backend/migrations/062_payroll_xero_sync.sql` | `payroll_xero_sync` (one per record) and `payroll_xero_operations` (one per request attempt). |
| Routes | `backend/onboarding-payroll-routes.js` | `/api/onboarding/journey/records/:id/payroll-setup/*` |
| Owner UI | `frontend/current/onboarding-journey.js` (`payrollPanel`) | Configuration form, approved set, Xero state, verification, manual actions, buttons. |
| Applicant UI | `frontend/current/onboarding.js` (`payrollNotice`) | Privacy notice with a required tick on the bank, tax and super forms. |
| Flags | `backend/finance-flags.js` | `ENABLE_XERO_PAYROLL_SYNC` (needs `ENABLE_XERO_WRITE`), `ENABLE_XERO_PAYROLL_SUPERFUND_CREATE`. |

### Sequence of calls on Sync

```
Owner ─ POST …/payroll-setup/sync ─▶ route: permission + role + flag + state checks
                                     audit payroll_xero_sync_started (before the decrypt)
                                     decryptPayrollForExport → secrets (in memory only)
                                     xero-payroll-sync.run(row, { secrets })
   1  validate snapshot (no Xero)
   2  GET /PayrollCalendars, GET /PayItems, GET /Superfunds     re-validate chosen ids
   3  GET /Employees (all pages)                                 duplicate check → POSSIBLE_DUPLICATE stops
   4  [GET /SuperfundProducts?USI=…] [POST /Superfunds]          reuse by USI/ABN; create only if enabled; else MANUAL_XERO_ACTION_REQUIRED
   5  POST /Employees   (Idempotency-Key opal-payroll-<op>-create)            → EmployeeID stored immediately
   6  POST /Employees/{id}  (…-configure-<version>)   calendar, earnings rate, EmploymentType, IncomeType, BankAccounts, TaxDeclaration, SuperMemberships
   7  GET /Employees/{id}                              → SuperMembershipID stored
   8  POST /Employees/{id}  (…-paytemplate-<version>) PayTemplate: EarningsLines, SuperLines (SGC/STATUTORY), LeaveLines
   9  GET /Employees/{id}                              read-back compared with the snapshot → mismatch stops
  10  GET /PayRuns?where=PayrollCalendarID==Guid("…"), GET /PayRuns/{id} for relevant runs → readiness
      SYNCED + next_pay_run_state + manual actions; payroll_profiles.payroll_setup_status = configured; induction task done
                                     audit payroll_xero_sync_result
```

## 3. Xero API contract

- **API**: Payroll AU `https://api.xero.com/payroll.xro/1.0`. Schema: Xero Payroll AU OpenAPI **19.0.0** (`XeroAPI/Xero-OpenAPI/xero-payroll-au.yaml`), verified at implementation time. Field names and enums in `xero-payroll-mapping.js` are taken from it; the mapping unit test pins them.
- **SDK**: none. The repository uses axios; a hand-built six-operation client is smaller to audit than `xero-node`.
- **Auth**: OAuth 2.0 `client_credentials` (Custom Connection). Token endpoint `identity.xero.com/connect/token`, tenant from `api.xero.com/connections`.
- **Scopes requested**: `payroll.employees`, `payroll.settings.read`, `payroll.payruns.read`. `payroll.settings` is added only when `ENABLE_XERO_PAYROLL_SUPERFUND_CREATE=true`. Never `payroll.payruns` or `payroll.payslip` (write).
- **Endpoints used**: `GET /PayrollCalendars`, `GET /PayItems`, `GET /Superfunds`, `GET /SuperfundProducts`, `POST /Superfunds` (optional), `GET /Employees`, `POST /Employees`, `GET /Employees/{id}`, `POST /Employees/{id}`, `GET /PayRuns`, `GET /PayRuns/{id}`.
- **Idempotency**: every POST carries `Idempotency-Key` = `opal-payroll-<operation uuid>-<step>` (≤128 chars). One operation id per approval; retries reuse it. `payroll_xero_operations` records every attempt, and a create that was attempted but not confirmed makes the next run adopt an exact name+DOB match rather than create again.
- **Rate limits**: 429 honours `Retry-After` (capped at 60 s); 5xx/timeouts/network use exponential backoff 1–16 s plus jitter, four attempts; validation and auth errors are not retried. At most three concurrent requests.
- **Not possible through the documented API, and not faked**: adding a new employee to an already-created draft pay run; creating a Xero Me login. Both become manual actions the Owner ticks off in the portal.

## 4. Field mapping

| Portal source | Xero field |
|---|---|
| `employee_personal_details.legal_first_name / middle_name / surname` | `FirstName`, `MiddleNames`, `LastName` |
| `date_of_birth` | `DateOfBirth` (YYYY-MM-DD) |
| `address_line1/2, suburb, state, postcode, country` | `HomeAddress.AddressLine1/2, City, Region (State enum), PostalCode, Country` |
| config `payrollEmail` else `personal_email` | `Email` |
| `mobile` | `Mobile` |
| `employment_profiles.start_date` (else assignment) | `StartDate` |
| config `jobTitle` | `JobTitle` |
| config `employmentBasis` | `TaxDeclaration.EmploymentBasis` (FULLTIME / PARTTIME / CASUAL) |
| config `employmentType` = EMPLOYEE, `incomeType` | `EmploymentType`, `IncomeType` |
| config `payrollCalendarId` (from `GET /PayrollCalendars`) | `PayrollCalendarID` |
| config `earningsRateId` (from `GET /PayItems`) | `OrdinaryEarningsRateID`, `PayTemplate.EarningsLines[].EarningsRateID` |
| annual: `annualSalary`, `unitsPerWeek` | `EarningsLine{CalculationType: ANNUALSALARY, AnnualSalary, NumberOfUnitsPerWeek}` |
| hourly: `hourlyRate`, `unitsPerWeek?` | `EarningsLine{CalculationType: ENTEREARNINGSRATE, RatePerUnit, NumberOfUnitsPerWeek?}` |
| `payroll_profiles.account_holder_name`, decrypted BSB / account number, config `statementText` | `BankAccounts[0]{AccountName, BSB, AccountNumber, StatementText, Remainder: true}` |
| decrypted TFN, or config `tfnExemptionType` | `TaxDeclaration.TaxFileNumber` or `TFNExemptionType` |
| `residency_status` | `ResidencyStatus`, `AustralianResidentForTaxPurposes` |
| config `taxScaleType` | `TaxScaleType` |
| `claims_tax_free_threshold`, `has_study_loan` | `TaxFreeThresholdClaimed`, `HasLoanOrStudentDebt` (STP2 consolidated) |
| config `eligibleToReceiveLeaveLoading`, `upwardVariationTaxWithholdingAmount` | `EligibleToReceiveLeaveLoading`, `UpwardVariationTaxWithholdingAmount` |
| `super_fund_usi` → matched `SuperFundID`; `super_member_number` | `SuperMemberships[0]{SuperFundID, EmployeeNumber}` |
| resolved `SuperMembershipID` | `PayTemplate.SuperLines[0]{SuperMembershipID, ContributionType: SGC, CalculationType: STATUTORY}` |
| config `leaveLines[]` (from `GET /PayItems` LeaveTypes) | `PayTemplate.LeaveLines[]{LeaveTypeID, CalculationType, AnnualNumberOfUnits, FullTimeNumberOfUnitsPerPeriod}` |
| SMSF: `super_fund_abn`, `smsf_esa`, `smsf_bank_account_name`, decrypted SMSF BSB / account | `POST /Superfunds {Type: SMSF, ABN, ElectronicServiceAddress, AccountName, BSB, AccountNumber}` |
| APRA fund not in Xero: USI verified via `GET /SuperfundProducts` | `POST /Superfunds {Type: REGULATED, Name, ABN, USI}` (never SPIN) |

Not sent: award classification, super percentage (Xero applies the statutory rate), anything the Owner did not configure.

## 5. States

`NOT_STARTED → APPLICANT_DRAFT → APPLICANT_SUBMITTED → ADMIN_REVIEW → APPROVED_FOR_XERO → SYNC_IN_PROGRESS → SYNCED`, with `CHANGES_REQUESTED`, `SYNC_FAILED_RETRYABLE`, `SYNC_FAILED_ACTION_REQUIRED`, `POSSIBLE_DUPLICATE`, `MANUAL_XERO_ACTION_REQUIRED`. The first four are derived from the applicant's payroll_profiles statuses and the review set; the rest are stored on `payroll_xero_sync.state`.

`next_pay_run_state` is separate: `READY_FOR_NEXT_PAY_RUN`, `INCLUDED_IN_DRAFT`, `MANUAL_INCLUSION_REQUIRED`, `POSTED_PAY_RUN_REVIEW`. `SYNCED` means the record is verified; the pay-run state says whether payroll will pay them without someone opening Xero.

## 6. Security and privacy

- **Secrets**: TFN, BSB, account number and SMSF bank details live encrypted in `payroll_profiles` (`onboarding-crypto.js`, AES-256-GCM, `ONBOARDING_ENCRYPTION_KEY`). They are decrypted once per sync by `decryptPayrollForExport`, after an audit row is written, held in memory to build two request bodies, and never stored, logged, returned or audited. The snapshot, the verification result, the operation log and every API response carry masked forms only (`•••-•23`, `••••5678`, `*** *** 123`, `••••1234`).
- **Access**: every route requires `onboarding.payroll`. Sync, retry and duplicate resolution additionally require the owner or admin role. The applicant reaches only `/api/onboarding/me/*` (pre-employee path allowlist).
- **Tokens**: the client secret comes from `XERO_PAYROLL_CLIENT_SECRET` (Key Vault reference in Azure). The access token is cached in process memory only. Responses show at most the last six characters of the tenant id.
- **Logging**: the logger's key/value redaction is a backstop; the modules never pass a request or response body to it. Errors surface Xero's own validation messages (safe text) and a code.
- **Audit** (`audit_logs`, via `onboarding-audit.js` allowlist): `payroll_setup_viewed`, `payroll_config_saved`, `payroll_setup_approved`, `payroll_changes_requested`, `payroll_xero_sync_started`, `payroll_xero_sync_retried`, `payroll_xero_sync_result`, `payroll_xero_rechecked`, `payroll_duplicate_resolved`, `payroll_manual_action_completed`, plus the existing `payroll_exported` reveal. Metadata is identifiers, states, steps and codes only.
- **Consent**: the applicant must tick the payroll privacy notice (APP 5 wording in `onboarding.js`) on each payroll form; the server records `privacy_notice_version` and `privacy_notice_accepted_at` on `payroll_profiles` and copies them to the sync row at approval.
- **Retention / minimisation**: no raw Xero request or response bodies are stored. `payroll_xero_sync` keeps Xero identifiers, the masked snapshot and redacted outcomes for the life of the employment record (payroll and tax records must be kept at least five years under Australian law; the onboarding record's own archival rules apply). `payroll_xero_operations` rows are integration audit and should be kept at least one year; a retention job may prune older rows once the record is `SYNCED`. Deleting the onboarding assignment cascades both tables.
- **Incident note**: a suspected compromise of Xero data or credentials is a security incident: rotate `XERO_PAYROLL_CLIENT_SECRET` in Xero and Key Vault, disable `ENABLE_XERO_PAYROLL_SYNC`, escalate to the practice owner immediately, and notify Xero within 24 hours of discovery where the Xero developer terms require it.

## 7. Errors, retries and idempotency

| Situation | State | What the Owner sees |
|---|---|---|
| 429 / 5xx / timeout / network, retries exhausted | `SYNC_FAILED_RETRYABLE`, `retry_after` set (1, 5, 15, 30 min) | "Retry sync" after the delay |
| 400 with `ValidationErrors`, or errors inside a 200 | `SYNC_FAILED_ACTION_REQUIRED` | Xero's messages, verbatim |
| 401 twice, 403 | `SYNC_FAILED_ACTION_REQUIRED` | connection / scope message |
| name+DOB or email match in Xero | `POSSIBLE_DUPLICATE` | candidates; link or create new |
| super fund missing and creation disabled | `MANUAL_XERO_ACTION_REQUIRED` | add the fund in Xero, mark complete, retry |
| read-back differs from the snapshot | `SYNC_FAILED_ACTION_REQUIRED` (`READ_BACK_MISMATCH`) | the failed checks |
| draft pay run exists without the employee | `SYNCED` + `MANUAL_INCLUSION_REQUIRED` | add them in Xero, mark complete, Recheck |
| posted pay run covers the start date | `SYNCED` + `POSTED_PAY_RUN_REVIEW` | escalate to payroll; nothing changed |

Retry reuses the operation id, so Xero receives the same idempotency keys; identifiers already captured (employee, fund, membership) are not re-created. A configuration change after approval clears the snapshot and requires a fresh approval, which starts a new operation.

## 8. Configuration

```
XERO_PAYROLL_CLIENT_ID=            # Custom Connection app (Xero developer portal → Custom connection)
XERO_PAYROLL_CLIENT_SECRET=        # Key Vault reference; never committed
ENABLE_XERO_WRITE=true             # master write gate (existing)
ENABLE_XERO_PAYROLL_SYNC=true      # employee creation in Xero
ENABLE_XERO_PAYROLL_SUPERFUND_CREATE=false   # POST /Superfunds; needs payroll.settings on the app
```

In the Xero developer portal, create a Custom Connection for the Opal Therapy organisation with scopes `payroll.employees payroll.settings.read payroll.payruns.read` (add `payroll.settings` only if fund creation is enabled), and have the Xero payroll admin authorise it. Migration 062 must be applied before the app restarts (deploy code → migrate → restart).

## 9. Owner operating guide

1. Open the onboarding record → **Payroll & Xero Setup**. The lines gathered during onboarding must all be Ready.
2. **Load from Xero**, then confirm the employment and pay configuration: basis, salary or rate, hours, payroll calendar (fortnightly), ordinary earnings rate, tax scale, leave lines, default fund if the employee chose it. **Save configuration.**
3. **Approve for Xero.** The set is frozen; read it in "Approved set".
4. **Sync to Xero.** Wait for the result; it names the precise outcome: *Employee created in Xero → Payroll configuration verified → Ready for next regular pay run / Included in draft pay run / Manual inclusion in existing draft required*.
5. Work through **To do in Xero**: add to the current draft pay run if asked, then **Recheck Xero**; invite to Xero Me from Xero (Payroll → Employees → Invite to Xero Me) using their payroll email if they should see payslips online, then mark it complete.
6. If a **possible duplicate** is shown, decide: link the existing Xero employee (their record is updated with the approved set) or create a new one.
7. **Request changes** sends the bank, tax and super forms back to the employee with your message and withdraws the approval.

## 10. Rollback

- Turn off `ENABLE_XERO_PAYROLL_SYNC` (or `ENABLE_XERO_WRITE`): every sync and retry returns 403; reads and the review screen keep working.
- Unset `XERO_PAYROLL_CLIENT_ID`/`SECRET`: the stage reports "not configured" and the panel falls back to review and approval only.
- Deploying the previous release leaves migration 062's tables in place unused; nothing else reads them. Employees already created in Xero stay in Xero — nothing here deletes from Xero.

## 11. Tests

- `backend/tests/xero-payroll-mapping.test.js` — rules and payloads against the 19.0.0 schema names.
- `backend/tests/xero-payroll-api.test.js` — headers, idempotency, 429/5xx/401/timeout, validation inside 200, redaction.
- `backend/tests/xero-payroll-sync.test.js` — salaried, hourly, fund reuse/creation, SMSF, duplicates, retry after timeout, read-back mismatch, every pay-run outcome.
- `backend/tests/integration/onboarding-payroll-xero.itest.js` — migration 062, the whole stage through the routes with Xero stubbed, guards (permission, role, flag, organisation, applicant notice), no secret in any response, row, log or audit entry.
