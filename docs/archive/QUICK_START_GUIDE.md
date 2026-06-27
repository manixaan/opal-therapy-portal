# Quick Start — Building the Opal Therapy Scheduler (3-Week Sprint)

**TL;DR:** You have 14–21 days to build a production-ready therapy scheduler with 7 features. This guide gives you the exact steps, decisions to make, and hand-offs.

---

## What You're Building (The Big Picture)

```
ANN (Therapist)              ANTONY (Manager)
    ↓                              ↓
┌──────────────────────────────────────────────────────┐
│      OPAL THERAPY SCHEDULER                          │
│  ┌────────────────────────────────────────────────┐  │
│  │  Week Calendar (Mon-Fri)  │  Dormant Cases    │  │
│  │  Color-coded sessions     │  Travel Logbook   │  │
│  │  Smart Booking (3 options)│  Credentials      │  │
│  │  Case notes               │  Flight Tracking  │  │
│  └────────────────────────────────────────────────┘  │
│                      ↓                                │
│         SPLOSE API (read/write)                       │
│         PostgreSQL (local cache)                      │
└──────────────────────────────────────────────────────┘
     ↓                    ↓                    ↓
  Google Maps     SendGrid Email        (Optional: Twilio SMS)
  (distance calc)  (daily alerts)        (client reminders)
```

**One app.** Seven features. Two users. Three weeks.

---

## Decision Points (Decide NOW — blocks development)

### From Ann (by May 13)
1. **Case notes storage?**
   - Option A: Log as existing "Admin" busy-time-type (#55339) ← **Recommended**
   - Option B: Create new dedicated "Case noting" busy-time-type
   - **Impact:** Affects database schema + Splose API calls
   - **Decision needed by:** May 13 (2 days) to stay on schedule

2. **Credentials alert lead time?**
   - How many days before expiry should alerts start? (default: 30 days)
   - **Decision needed by:** May 15 (non-blocking, can proceed with default)

3. **Block scheduling if credential expired?**
   - Example: If AHPRA registration expires, should app prevent booking new sessions?
   - Which credentials are "blocking" (critical)? Which are "warning-only"?
   - **Decision needed by:** May 22 (can code both options)

### From Antony (by May 13)
1. **SMS for client reminders?**
   - Option A: Email-only (simpler, no extra cost)
   - Option B: SMS preferred, email fallback (cost: Twilio ~$0.01/SMS)
   - Option C: Skip client reminders for v1 (add Phase 2)
   - **Impact:** Affects API integration + email service cost
   - **Decision needed by:** May 13 if using SMS, can proceed with email-only

2. **Credentials storage?**
   - Option A: Store locally in Opal PostgreSQL table ← **Recommended**
   - Option B: Store in Splose practitioner profile (requires API agreement)
   - **Impact:** Database schema, API calls
   - **Decision needed by:** May 15

3. **Flight tracking for Phase 2?**
   - Which flight API? (FlightAware, Sabre, AviationEdge)
   - Which airlines? (QF, JQ, VA for Australia-based?)
   - **Impact:** API selection, Phase 2 timeline
   - **Decision needed by:** May 22 (non-blocking for v1)

---

## Week-by-Week Breakdown

### WEEK 1: Foundation (May 10–17)

**Goal:** App boots, shows empty calendar, scheduler works with mock data

#### Day 1–2: Setup (May 10–11)
```bash
# Backend
node backend/server.js → "Listening on 3000" ✅
docker-compose up → postgres running ✅

# Frontend
npm run dev → http://localhost:5173 ✅

# Database
npm run migrate:latest → All 5 tables created ✅
```

**Checklist:**
- [ ] Clone repo, run `npm install` (backend + frontend)
- [ ] Create `.env` from `.env.example` with:
  - `SPLOSE_API_KEY=<your-key>`
  - `GOOGLE_MAPS_API_KEY=<your-key>`
  - `SENDGRID_API_KEY=<your-key>`
  - `JWT_SECRET=<random-string>`
- [ ] Spin up postgres in docker-compose
- [ ] Run all migrations (`npm run migrate:latest`)
- [ ] Seed test data (`npm run seed`)
- [ ] Test: `curl http://localhost:3000/api/me` → error (not logged in) ✅

#### Day 2–3: Splose Integration (May 11–12)
```bash
# Test Splose API connectivity
curl -H "Authorization: Bearer YOUR_KEY" https://api.splose.com/v1/appointments
→ Should return real appointments from Splose ✅
```

**Checklist:**
- [ ] Implement `SploseClient` class (see PRODUCTION_ARCHITECTURE.md)
- [ ] Test `getAppointments()` with real Splose data
- [ ] Implement caching layer (30 min TTL)
- [ ] Add error handling for 400 / rate limit (60/min)
- [ ] Verify all 8 session type service IDs match Splose live data
- [ ] Fetch real locations + format addresses for clustering

**Output:** By EOD May 12, `splose.getAppointments()` returns real data ✅

#### Day 3–4: Database + Auth (May 12–13)
```bash
# Simple JWT auth (single user for v1)
POST /api/auth/login
{
  "email": "ann@opalstherapy.com.au",
  "password": "temp-password"
}
→ {token: "eyJh...", user: {...}} ✅
```

**Checklist:**
- [ ] Create `users` table with Ann's data
- [ ] Implement login endpoint (hashed password, JWT)
- [ ] Add auth middleware (`verify-token`) to all protected routes
- [ ] Create `GET /api/me` endpoint
- [ ] Set JWT expiry to 24 hours
- [ ] Test login flow with Postman

**Output:** By EOD May 13, login returns JWT ✅

#### Day 4–5: Calendar UI (May 13–14)
```
Monday       Tuesday      Wednesday     Thursday      Friday
┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐
│ 08:00│    │ 08:00│    │ 08:00│    │ 08:00│    │ 08:00│
│      │    │      │    │ INIT │    │      │    │      │
│ 09:00│    │ 09:00│    │      │    │ 09:00│    │ 09:00│
│      │    │ THPY │    │ THPY │    │      │    │ ADMI │
│ 10:00│    │      │    │      │    │ 10:00│    │      │
│      │    │      │    │  MDT │    │ ADMI │    │      │
│ 11:00│    │      │    │      │    │      │    │      │
│      │    │      │    │      │    │      │    │      │
│ 12:00│    │      │    │ LUNC │    │      │    │      │
│ LUNC │    │      │    │      │    │ LUNC │    │ LUNC │
└──────┘    └──────┘    └──────┘    └──────┘    └──────┘
```

**Checklist:**
- [ ] Build `WeekView.jsx` (Mon-Fri, 08:00–18:00)
- [ ] Add time grid (30-min intervals)
- [ ] Implement color legend (8 session types)
- [ ] Fetch appointments from backend `/api/appointments?week=YYYY-W##`
- [ ] Render `SessionBlock` components with real Splose data
- [ ] Add "New appointment" button (opens modal)
- [ ] Test responsive design (desktop + tablet)

**Output:** By EOD May 14, calendar shows real appointments from Splose ✅

#### Day 5–7: Smart Scheduler Algorithm (May 14–17)
```
POST /api/appointments/suggest
{
  "client_id": "PAT-123",
  "duration_minutes": 60
}

Response:
{
  "options": [
    {start: "2026-05-20T10:00", score: 95, reasons: ["clusters", "after admin day"]},
    {start: "2026-05-20T14:00", score: 78, reasons: ["afternoon available"]},
    {start: "2026-05-21T10:00", score: 62, reasons: ["follows heavy day"]}
  ]
}
```

**Checklist:**
- [ ] Implement `computeFreeSlots()` — merge availability − appointments − busy-times
- [ ] Implement `scoreSlot()` with weights:
  - Regional clustering: +40 (if same suburb as existing clients on that day)
  - Busy/admin alternation: +20 (if follows lighter day)
  - Time preference: +10 (if morning matches pattern)
  - Capacity check: +30 (if NDIS funding available)
- [ ] Cache busy-times per day (avoid repeated Splose calls)
- [ ] Return top 3 options sorted by score
- [ ] Build modal UI: show 3 options, user selects one
- [ ] Test with 5+ mock clients + real Splose data

**Output:** By EOD May 17, scheduler suggests realistic slots ✅

**Week 1 Deliverables:**
- ✅ Backend server + database running
- ✅ Frontend calendar showing real Splose appointments
- ✅ Smart scheduler algorithm working (3 scored options)
- ✅ Login flow operational
- ✅ Basic error handling in place

**Code completed:** ~40% (foundation)

---

### WEEK 2: Features (May 17–24)

**Goal:** All 4 major features working (travel logbook, dormant cases, case notes, credentials)

#### Day 1: Travel Logbook Setup (May 17)
```javascript
// When appointment created, auto-log distance
POST /api/appointments
{
  "client_id": "PAT-123",
  "location_id": "LOC-456",
  "duration_minutes": 60,
  "start_time": "2026-05-20T10:00:00+08:00"
}

// Triggers:
// 1. Splose API: POST /appointments
// 2. Google Maps: getDistance("Opal Therapy", client_location) → 24.5 km
// 3. Local DB: INSERT travel_logs (kms, client_id, appointment_id, ...)
// 4. Response to Ann: "Appointment created. Travel: 24.5 km"
```

**Checklist:**
- [ ] Integrate Google Maps Distance Matrix API
- [ ] Get real Opal Therapy address (Willetton, WA)
- [ ] Implement `travelLogger.js` service
- [ ] Store travel log with: date, start/end location, KMs, appointment ID
- [ ] Allow Ann to edit KMs if needed (manual correction UI)
- [ ] Test with 10+ real client addresses

**Output:** By EOD May 17, travel logging works on new appointments ✅

#### Day 2: Travel Reports (May 18)
```
GET /api/travel/reports/annual?year=2026

PDF Output:
═════════════════════════════════════════
  OPAL THERAPY — ANNUAL TRAVEL LOGBOOK
  Financial Year: 2025-26
  Practitioner: Ann Mary Mathew
═════════════════════════════════════════

Summary:
  Total KMs: 1,284
  ATO Rate (2025-26): $0.66/km
  Tax Deduction: $847.44

Logbook (by date):
2026-04-01  John Smith    Eastside      24.5 km  Therapy
2026-04-02  Jane Doe      Westside      18.3 km  Assessment
...
```

**Checklist:**
- [ ] Implement PDF generation (use `pdfkit` or `html2pdf`)
- [ ] Implement CSV export
- [ ] Query travel_logs table, group by year
- [ ] Calculate totals (KMs, ATO cents-per-km)
- [ ] Build UI: "Download Annual Report" button
- [ ] Test report layout + math

**Output:** By EOD May 18, Ann can download PDF for accountant ✅

#### Day 2–3: Dormant Case Detection (May 18–19)
```
Scheduler task (runs 06:00 AWST daily):
1. Fetch all cases from Splose
2. For each case, find last_activity (appointment, invoice, case note)
3. If > 6 weeks: mark dormant
4. Send email to Antony with:
   - Count: "3 dormant cases"
   - Table: Client Name | Last Activity | NDIS Status
   - Action buttons: "Schedule appointment"

Email arrives at: antony@opalstherapy.com.au at 06:00 AWST
```

**Checklist:**
- [ ] Implement `dormantCaseDetector.js` service
- [ ] Query Splose for all cases (with last_activity timestamps)
- [ ] Implement scheduler task (node-cron: "0 6 * * *" → 06:00 AWST)
- [ ] Send email via SendGrid with formatted table + quick-schedule links
- [ ] Store alert in `dormant_case_alerts` table
- [ ] Build dashboard widget showing dormant cases
- [ ] Add "Acknowledge" button (mark as reviewed)
- [ ] Test with mock old appointments (> 6 weeks ago)

**Output:** By EOD May 19, daily email sends at 06:00 AWST ✅

#### Day 3–4: Credentials Tracking (May 19–20)
```
Ann's Profile → Professional Licenses

License                          Issued    Expires    Status
──────────────────────────────────────────────────────────────
AHPRA Occupational Therapist    2021-01-15 2027-01-14 ✅ Valid
Working with Children           2019-06-01 2026-12-01 ⚠️ Expires in 214 days
NDIS Workers Screening          2023-03-20 2026-03-19 ❌ EXPIRED (renew now)
Professional Indemnity Insurance 2025-04-01 2026-03-31 ⚠️ Expires in 325 days
```

**Checklist:**
- [ ] Create UI: Add/edit/delete credentials
- [ ] Implement daily 06:00 AWST check for expiry
- [ ] Send warning emails 30 days before + on day of expiry
- [ ] Color-code: green (valid), yellow (< 30 days), red (expired)
- [ ] Show warning banner on dashboard if any expired
- [ ] Add decision points from Ann: which are "blocking"?
- [ ] If blocking: prevent scheduling when expired
- [ ] Test with sample data (some expired, some expiring soon)

**Output:** By EOD May 20, credentials tracked + alerts sending ✅

#### Day 4–5: Case Noting Suggestions (May 20–21)
```
Scenario:
1. Ann schedules therapy session: Mon 10:00–11:00
2. Post-session, app suggests: "15 min case notes?"
3. Options:
   a) Auto-schedule Mon 11:15–11:30 (finds gap)
   b) Manual: let Ann pick time
   c) To-do: add to flexible list
4. Ann picks (a): case note blocked on calendar as "Admin" busy-time
5. Writes to Splose as busy-time (or TBC if new type)

Decision from Ann: Use existing "Admin" type or new type?
```

**Checklist:**
- [ ] Wait for Ann's decision (due May 13, but proceed if not received)
- [ ] Build case note suggestion modal (triggered post-session)
- [ ] Three scheduling options (auto, manual, to-do)
- [ ] If auto: find gap same-day, prefer afternoon
- [ ] If manual: open calendar picker
- [ ] If to-do: add to list, not on calendar
- [ ] Store in `case_notes` table + Splose busy-time
- [ ] Build case note history view (past week)
- [ ] Test with real appointments

**Output:** By EOD May 21, case notes can be scheduled ✅

#### Day 5–7: Integration Testing + Refinement (May 21–24)
```
Test script (Antony runs through):
1. Login → calendar visible ✓
2. Click "New Appointment" → scheduler suggests 3 slots ✓
3. Select slot → appointment created in Splose ✓
4. Travel distance auto-logged ✓
5. Wait for 06:00 AWST (or manually trigger check) ✓
6. Receive dormant case email ✓
7. Check Ann's profile → credentials visible ✓
8. Click "Download Travel Report" → PDF downloads ✓
9. All features work without errors ✓
```

**Checklist:**
- [ ] End-to-end test: login → schedule → view reports
- [ ] Test error handling: Splose API down, network error, invalid params
- [ ] Test edge cases: zero free slots, capacity exceeded, expired credentials
- [ ] Bug fixes from UAT
- [ ] Performance: scheduler < 2 seconds, reports < 5 seconds
- [ ] UI polish: responsive on tablet + mobile
- [ ] Documentation: API endpoints, database schema, feature guides

**Output:** By EOD May 24, all 4 features working with real Splose data ✅

**Week 2 Deliverables:**
- ✅ Travel logbook (auto-tracking + PDF/CSV)
- ✅ Dormant case alerts (daily emails)
- ✅ Credential tracking + expiry alerts
- ✅ Case noting suggestions
- ✅ Full integration with Splose API
- ✅ Error handling + edge cases
- ✅ User guides + API documentation

**Code completed:** ~85% (features)

---

### WEEK 3: Production (May 24–31)

**Goal:** Deploy to production, train users, go live

#### Day 1–2: Security & Hardening (May 24–25)
```bash
# Security checklist
- [ ] SSL/TLS only (HTTPS)
- [ ] JWT token rotation + refresh
- [ ] Rate limiting on auth endpoints (5 attempts / 15 min)
- [ ] CORS configured for opal-therapy.com.au only
- [ ] CSRF tokens on forms
- [ ] Sensitive data encrypted in DB (API keys)
- [ ] No passwords in logs or error messages
- [ ] SQL injection tests (parametrized queries)
- [ ] XSS tests (input validation)
```

**Checklist:**
- [ ] Implement rate limiting middleware
- [ ] Add CORS + CSRF protection
- [ ] Encrypt Splose API key in DB (use `crypto`)
- [ ] Add input validation on all endpoints (sanitize params)
- [ ] Test SQL injection vectors (should fail safely)
- [ ] Test XSS vectors (should escape HTML)
- [ ] Add request logging (who, what, when, where)
- [ ] Set up error tracking (Sentry or CloudWatch)

**Output:** By EOD May 25, app passes basic security audit ✅

#### Day 2–3: Deployment Setup (May 25–26)
```bash
# Option A: AWS (Sydney region)
aws s3 create-bucket --bucket opal-scheduler --region ap-southeast-2
aws rds create-db-instance --db-instance-identifier opal-db --region ap-southeast-2
aws ecs create-cluster --cluster-name opal-prod

# Option B: Azure Australia
az containerregistry create --resource-group opal --name opalsacr --admin-enabled true --location australiaeast
az appservice plan create --name opal-plan --resource-group opal --sku B2 --is-linux
az webapp create --resource-group opal --plan opal-plan --name opal-scheduler
```

**Checklist:**
- [ ] Choose hosting: AWS Sydney or Azure Australia East
- [ ] Create production database (PostgreSQL 14+)
- [ ] Set up automated backups (daily, 30-day retention)
- [ ] Configure environment variables in production `.env`
- [ ] Build Docker image + push to registry
- [ ] Set up CI/CD (GitHub Actions: test → build → deploy)
- [ ] Configure domain: scheduler.opalstherapy.com.au (DNS)
- [ ] Set up SSL certificate (Let's Encrypt or AWS ACM)
- [ ] Test: `curl https://scheduler.opalstherapy.com.au/api/health`

**Output:** By EOD May 26, app deployed to production ✅

#### Day 3–4: Documentation & User Training (May 26–27)
```
User Guides (write + print):
1. "Ann's Guide" (4 pages)
   - How to log in
   - How to book appointment (smart scheduler)
   - How to view travel logbook
   - How to track credentials

2. "Antony's Admin Guide" (2 pages)
   - Dashboard overview
   - Dormant case email
   - Settings + preferences
   - How to add new credentials

3. "Troubleshooting" (1 page)
   - Common errors
   - How to contact support
   - Emergency phone number
```

**Checklist:**
- [ ] Write `USER_GUIDE.md` (for Ann)
- [ ] Write `ADMIN_GUIDE.md` (for Antony)
- [ ] Write `DEPLOYMENT.md` (for DevOps team)
- [ ] Create video tutorials (3–5 min each) [optional]
- [ ] Document all API endpoints in `API.md`
- [ ] Write troubleshooting guide
- [ ] Create emergency runbook (what to do if app goes down)

**Output:** By EOD May 27, user guides ready + training done ✅

#### Day 4–5: UAT & Launch (May 27–28)
```
UAT Dry Run:
Antony uses app for 1 day with real Splose data.

Checklist:
☐ Login works (no weird errors)
☐ Calendar displays all appointments
☐ Smart scheduler suggests realistic slots
☐ Can create new appointment
☐ Travel distance calculated correctly
☐ Dormant case email sent at 06:00 (or manual trigger)
☐ Credential expiry check works
☐ Case note suggestion appears
☐ No JavaScript errors in console
☐ Responsive on tablet + mobile
☐ Performance acceptable (< 3 sec page load)

If issues found: Fix + re-test same day
If all good: ✅ Ready for live
```

**Checklist:**
- [ ] Antony does 8-hour dry run with real data
- [ ] Document any issues + prioritize fixes
- [ ] Re-test fixes
- [ ] Final sign-off from Antony
- [ ] Schedule launch: Friday end-of-day (avoid Monday morning issues)
- [ ] Notify Ann + Antony: app goes live tonight
- [ ] Prepare rollback plan (in case of emergency)

**Output:** By EOD May 28, app ready for live ✅

#### Day 5–7: Live Operations & Monitoring (May 28–31)
```
Live Launch Checklist:
☐ Database snapshot taken (backup before go-live)
☐ Error tracking enabled (Sentry / CloudWatch)
☐ Email alerts configured (errors → Antony)
☐ Performance monitoring enabled (latency dashboard)
☐ Standby support available (first 48 hours)

First Week Live:
Day 1 (May 28): Monitor closely, fix any issues
Day 2 (May 29): Check email delivery, confirm dormant case alert
Day 3 (May 30): Collect feedback from Ann + Antony
Day 4 (May 31): Document lessons learned, plan Phase 2
```

**Checklist:**
- [ ] Deploy to production environment
- [ ] Verify all services running: backend ✓, postgres ✓, email ✓
- [ ] Test: Can login, see calendar, create appointment
- [ ] Monitor error logs (should be quiet)
- [ ] Confirm 06:00 AWST dormant case email sends
- [ ] Monitor email delivery (SendGrid dashboard)
- [ ] Monitor Splose API calls (rate limit status)
- [ ] Collect feedback from Ann + Antony
- [ ] Schedule debrief call (May 31): what went well, what to improve

**Output:** By May 31, app live + operational ✅

**Week 3 Deliverables:**
- ✅ Production deployment complete
- ✅ All security checks passed
- ✅ User documentation ready
- ✅ Monitoring + alerting active
- ✅ 24-hour live validation
- ✅ Phase 2 roadmap documented

**Code completed:** 100% (Phase 1)

---

## Post-Launch: Phase 2 & 3 (June onwards)

### Phase 2: Flight Tracking (Mid-June, 11–14 days)
- Real-time flight monitoring (FlightAware or airline API)
- Auto-calendar blocks for delays
- PNR tracking via email
- Integration: delay notification → auto-reschedule affected clients

### Phase 3: Advanced (July onwards)
- Multi-practitioner support
- Client-facing booking portal
- Microsoft Teams integration
- Advanced reporting + BI dashboards

---

## Success Metrics (By May 31)

| Metric | Target | Actual |
|--------|--------|--------|
| App uptime | 99.5% | |
| Page load time | < 3 sec | |
| Smart scheduler accuracy | 95% (realistic slots) | |
| Daily dormant case emails | 100% (6 AM AWST) | |
| Travel logging | 100% (auto on all appointments) | |
| Zero unhandled errors | 100% | |
| User login time | < 2 sec | |
| Splose API response time | < 1 sec (cached) | |

---

## Common Pitfalls (Avoid These)

1. **"Just build everything at once"** → Waterfall = late delivery. Use weekly milestones instead.
2. **"Splose API is straightforward"** → It has strict param validation (Zod). Test early.
3. **"We'll optimize later"** → Scheduler algorithm slow = bad UX. Benchmark by EOD Week 1.
4. **"User doesn't need training"** → Ann will get confused. Write guide + do dry run.
5. **"Email will always work"** → SendGrid can bounce. Implement retry queue.
6. **"We'll handle errors in Phase 2"** → Users see broken app Week 1 = lose trust. Test error paths.

---

## Handoff (May 31 → June 1)

**To Antony:**
- Production app URL + login credentials
- User guides + troubleshooting docs
- On-call escalation number (your support contact)
- Phase 2 roadmap (flight tracking)
- Decision points for Phase 2 (API choice, airlines, etc.)

**To Ann:**
- Training session (30 min walkthrough)
- User guide (printed + PDF)
- Direct contact for help (phone / email)
- "What to do if something breaks" checklist

**To DevOps/Support:**
- Production deployment runbook
- Database backup schedule
- Monitoring dashboard + alert contacts
- Emergency rollback procedure
- Splose API key + SendGrid key (in secure vault)

---

**READY TO START?** Open a terminal and run:

```bash
git clone https://github.com/opal-therapy/scheduler.git
cd scheduler
npm install
docker-compose up -d postgres
npm run migrate:latest
npm run seed
npm run dev

# In another terminal:
cd frontend
npm run dev

# Open http://localhost:5173
```

Good luck! You've got this. 🚀

