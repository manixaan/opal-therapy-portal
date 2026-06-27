# Complete Feature Roadmap — May 2026

**Last updated:** May 10, 2026  
**Scope:** All requested features for therapy scheduler mockup v2

---

## Executive Summary

| Feature | Status | Priority | ETA |
|---------|--------|----------|-----|
| **Dormant Case Reminder** | ✅ COMPLETE | P0 | Ready |
| **Travel Logbook + Accountant Reports** | ✅ COMPLETE | P0 | Ready |
| **Case Noting Suggestions** | ⏳ Designed | P1 | Next sprint |
| **Client Reminders (24h)** | ⏳ Designed | P1 | Next sprint |
| **Flexible Work Hours** | ⏳ Trivial | P2 | This week |
| **Therapist Credentials Tracking** | ⏳ Design phase | P1 | 3-4 weeks |

---

## 🟢 Phase 1: COMPLETE & READY TO DEPLOY

### Feature 1.1: Dormant Case Reminder

**Delivered:** May 10, 2026  
**What it does:** Detects cases with 6+ weeks no activity (no sessions, invoices, case notes). Sends daily email report with NDIS status and suggested actions.

**Files:**
- `DORMANT_CASES_FEATURE.md` — Full specification
- `dormant_cases_scheduler.js` — Backend logic (Cloudflare Worker ready)
- `mockup_v2_dormant_cases_addition.html` — UI components for mockup

**Integration steps:**
1. Copy HTML/CSS from addition file into mockup_v2.html
2. Copy JavaScript into mockup script section
3. Deploy scheduler.js to Cloudflare / backend
4. Configure email service (SendGrid/SES)
5. Test with mock data

**Timeline:** 2–3 hours integration

---

### Feature 1.2: Travel Logbook & Accountant Reports

**Delivered:** May 10, 2026  
**What it does:** Auto-tracks KMs as scheduler creates travel legs. Generates formal annual logbook (PDF + CSV) for accountant submission. Supports ATO cents-per-km method ($0.66/km FY2026).

**Files:**
- `TRAVEL_LOGBOOK_FEATURE.md` — Full specification (14KB)
- `TRAVEL_LOGBOOK_IMPLEMENTATION_GUIDE.md` — Integration guide
- `travel_logger.js` — Auto-logging engine (Google Maps integration)
- `travel_report_generator.js` — PDF + CSV report generation

**How it works:**
1. Appointment created → scheduler calculates distance (Google Maps API)
2. Distance logged with client, session type, date/time
3. Year-end: Ann downloads PDF + CSV from settings
4. PDF is formal enough for accountant / ATO audit

**Integration steps:**
1. Add travel logger widget to mockup week view (right sidebar)
2. Add report generator panel to settings/configuration
3. Link travel_logger.js & travel_report_generator.js
4. Ensure Google Maps API key is configured (from earlier setup)
5. Test report generation with sample FY2025 data

**Database schema:**
```sql
CREATE TABLE travel_logs (
  id VARCHAR(20) PRIMARY KEY,
  date DATE NOT NULL,
  datetime TIMESTAMP NOT NULL,
  start_location TEXT,
  end_location TEXT,
  kms DECIMAL(6,1),
  client_id VARCHAR(20),
  case_id VARCHAR(20),
  session_type VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Timeline:** 4–6 hours integration + testing

---

## 🟡 Phase 2: DESIGNED, AWAITING DECISIONS

### Feature 2.1: Case Noting Suggestions

**Status:** Design complete, awaiting decision from Ann

**What it does:**  
When a therapy session is scheduled, app suggests allocating 10–15 minutes for case notes within the same day. Offers three approaches:
1. Auto-schedule same-day (finds a gap, ideally after 13:00)
2. Manual (user schedules later)
3. Flexible (add to to-do list, not blocking calendar)

**Specification:** See `FEATURE_ADDITIONS_ROADMAP.md` (Phase 2)

**Key decision needed:**  
Should case notes be logged as:
- [ ] "Admin" busy-time-type (existing #55339) — reuse existing
- [ ] New dedicated "Case noting" busy-time-type — cleaner separation

**Timeline:** Once decision made, 3–4 days implementation

---

### Feature 2.2: Client Reminders (24 hours before appointment)

**Status:** Design complete, awaiting SMS gateway decision

**What it does:**  
Automatic SMS or email reminder sent to clients 24 hours before their appointment. Configurable reminder window (4/12/24/48 hours).

**Specification:** See `FEATURE_ADDITIONS_ROADMAP.md` (Phase 3)

**Integration requirements:**
- Splose API needs to expose `patient.mobilePhone` and `patient.preferredReminderChannel` (TBC)
- SMS gateway choice: Twilio? AWS SNS? Vonage?
- Hourly scheduler checking 24h-ahead window

**Key decisions needed:**
- [ ] Which SMS gateway? (Twilio preferred for Australian coverage)
- [ ] Email fallback if no mobile number?
- [ ] What if client opts out of SMS?
- [ ] Confirmation links in message?

**Timeline:** Once decisions made, 4–5 days implementation

---

### Feature 2.3: Flexible Working Hours

**Status:** Simple UI change (no logic change needed)

**What it does:**  
Remove the 9–5 AM greyout in week view. Therapists may need to work early or late to fit their caseload.

**Current behavior:** Calendar greys out hours outside 09:00–17:00  
**Desired behavior:** Show full 24-hour view; let scheduling work anytime within practitioner availability

**Implementation:**
- [ ] Remove `.non-working-hours { opacity: 0.3; }` CSS
- [ ] Update hour labels to show 6 AM – 9 PM (or 24-hour)
- [ ] Adjust grid if needed for readability

**Timeline:** 30 minutes (CSS change only)

---

## 🔴 Phase 3: DESIGN PHASE

### Feature 3.1: Therapist Credentials & License Tracking

**Status:** Requested May 10, 2026

**What it does:**  
Track all therapist credentials with expiry dates:
- Working with Children declaration
- AHPRA registration
- Driver's license
- Insurance cover
- NDIS workers screening (NDIS Clearance)
- Other licenses

Auto-alert when renewal required (email + in-app notification).

**Desired behavior:**
1. Ann's profile page shows all licenses with:
   - Name of credential
   - Credential #
   - Expiry date
   - Status (valid / expires soon / expired)

2. Scheduler monitors expiry dates
   - 30 days before expiry: warning (yellow)
   - On expiry: blocked (red) — cannot schedule until renewed
   - Email alert: 30 days before, on day of expiry

3. Optional: Block scheduling if critical credential is expired

**Data model:**

```json
{
  "practitioner_id": "PR-001",
  "credentials": [
    {
      "id": "CRED-001",
      "name": "AHPRA Occupational Therapist",
      "type": "professional_registration",
      "credentialNumber": "OT 123456",
      "issuedDate": "2021-01-15",
      "expiryDate": "2027-01-14",
      "status": "valid",
      "renewalLeadDays": 30,
      "alertEnabled": true
    },
    {
      "id": "CRED-002",
      "name": "Working with Children",
      "type": "safeguarding_check",
      "credentialNumber": "WWC 987654",
      "issuedDate": "2019-06-01",
      "expiryDate": "2026-12-01",
      "status": "expires_soon",
      "renewalLeadDays": 60,
      "alertEnabled": true
    },
    {
      "id": "CRED-003",
      "name": "NDIS Workers Screening Check",
      "type": "background_check",
      "credentialNumber": "NDIS-CLEARING-789",
      "issuedDate": "2023-03-20",
      "expiryDate": "2026-03-19",
      "status": "expired",
      "renewalLeadDays": 30,
      "alertEnabled": true
    },
    {
      "id": "CRED-004",
      "name": "Professional Indemnity Insurance",
      "type": "insurance",
      "provider": "Professional Indemnity NSW",
      "policyNumber": "PII-OT-456789",
      "issuedDate": "2025-04-01",
      "expiryDate": "2026-03-31",
      "status": "valid",
      "renewalLeadDays": 45,
      "alertEnabled": true,
      "amount": 5000000
    }
  ]
}
```

**Splose integration decision:**
- Option A: Store in Splose practitioner profile (requires API change)
- Option B: Store in separate Opal Therapy credential table (simpler)
- Recommended: Option B (faster to implement, more flexible)

**Scheduler checks:**
1. Before creating appointment: Is AHPRA registration valid?
2. Before creating appointment with children: Is Working with Children valid?
3. Daily check: Any credentials expiring in 30 days?
4. Email schedule: 6:00 AM on day of expiry

**UI additions to mockup:**
1. Practitioner profile → "Professional Licenses" section
   - Table: Credential | Issued | Expires | Status
   - Color-coded: green (valid), yellow (< 30 days), red (expired)
   - "Renew now" button links to external sites (e.g., AHPRA portal)

2. Settings → "Credential Alerts"
   - Configure reminder lead time per credential (default 30 days)
   - Toggle alerts on/off
   - Email destination

3. Dashboard → warning banner if any credential expired
   - "⚠️ Professional Indemnity expires in 21 days. Renew now."

**Estimated effort:**
- Design: 1 day
- Implementation: 4–5 days
- Testing: 1 day

**Timeline:** 1 week (can start once feedback received)

---

## 📊 Summary Table

| # | Feature | Status | Files | Effort | ETA |
|---|---------|--------|-------|--------|-----|
| 1.1 | Dormant Cases | ✅ READY | 3 files | 2–3h | This week |
| 1.2 | Travel Logbook | ✅ READY | 4 files | 4–6h | This week |
| 2.1 | Case Noting | 🔶 Design | 1 file | 3–4d | Next week |
| 2.2 | Client Reminders | 🔶 Design | 1 file | 4–5d | Next week |
| 2.3 | Flex Hours | 🟢 Trivial | — | 0.5h | Today |
| 3.1 | Credentials | 🔴 Design | — | 6–7d | 3–4 wks |

---

## 🚀 Implementation Roadmap (Recommended Order)

### Week 1 (May 10–17)
1. **Today:** Remove 9–5 grayout (15 min)
2. **Integrate Dormant Cases** (2–3 hours)
   - Copy HTML/CSS/JS into mockup_v2.html
   - Test with mock data
3. **Integrate Travel Logbook** (4–6 hours)
   - Add widgets and report generator to mockup
   - Test report generation

### Week 2 (May 17–24)
4. **Get decisions from Ann:**
   - Case noting: Admin vs. dedicated type?
5. **Get decisions from Antony:**
   - SMS gateway: Twilio/AWS SNS/other?
   - Credential storage: Splose vs. local table?

### Week 3–4 (May 24–June 7)
6. Once decisions received: Implement Case Noting + Client Reminders
7. Begin Credentials design if feedback positive

---

## 📝 Decision Points for Antony & Ann

**For Ann (OT):**
1. [ ] Case noting: Should it go under "Admin" busy-time-type or new dedicated type?
2. [ ] How long do you want reminder before credential expiry? (default: 30 days)
3. [ ] Which credentials are mandatory for scheduling (blocking vs. warning)?

**For Antony (Manager):**
1. [ ] SMS gateway preference: Twilio, AWS SNS, or other?
2. [ ] If SMS not available, fallback to email only?
3. [ ] Credentials: Store in Splose or separate local table?
4. [ ] Who approves credential renewal (Ann self-reports or Antony vets)?

---

## 📂 Complete File List (All Features)

**Phase 1 (Ready):**
- ✅ `DORMANT_CASES_FEATURE.md`
- ✅ `dormant_cases_scheduler.js`
- ✅ `mockup_v2_dormant_cases_addition.html`
- ✅ `TRAVEL_LOGBOOK_FEATURE.md`
- ✅ `TRAVEL_LOGBOOK_IMPLEMENTATION_GUIDE.md`
- ✅ `travel_logger.js`
- ✅ `travel_report_generator.js`

**Phase 2 (Designed):**
- ✅ `FEATURE_ADDITIONS_ROADMAP.md` (contains case noting + client reminders specs)

**Phase 3 (To Design):**
- 📝 `THERAPIST_CREDENTIALS_FEATURE.md` (to be created)
- 📝 `credentials_tracker.js` (to be created)
- 📝 `mockup_v2_credentials_widget.html` (to be created)

---

## Next Actions

**Immediate (today):**
1. Antony: Review all completed features (Files 1–7 above)
2. Ann: Review dormant cases workflow
3. Antony: Send feedback on credential storage approach (Splose vs. local)

**This week:**
1. Integrate dormant cases + travel logbook into mockup_v2.html
2. Test both features with sample data
3. Ann & Antony: Answer decision questions above

**Next week:**
1. Implement Case Noting (once decision made)
2. Implement Client Reminders (once decision made)
3. Create Credentials tracking spec (design doc)

---

## Support & Questions

- **Feature docs:** Read the `.md` files first
- **Implementation questions:** Check the `*_IMPLEMENTATION_GUIDE.md` files
- **Customization needs:** Contact Antony or create a new feature request

**All files are in:** `/Users/antonyxavier/Documents/Claude/Projects/Therapy Scheduling Application/`
