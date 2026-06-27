# Start Building — Action Checklist (Today)

**Date:** May 10, 2026  
**Deadline:** May 31, 2026 (production launch)  
**Time remaining:** 21 days

---

## ⚠️ CRITICAL DECISIONS (Due May 13, 72 hours)

These decisions **BLOCK** development. Get answers NOW.

### From Ann Mary Mathew (Therapist)

**Decision 1: Case Notes Storage**
```
Q: Should case notes be logged as:
   A) Existing "Admin" busy-time-type (#55339)
   B) New dedicated "Case noting" busy-time-type

Answer: [ ] A  [ ] B  [ ] Undecided (will use A as default)
Due: May 13
Impact: If undecided, development proceeds with option A (Admin type)
```

**Decision 2: Credential Alert Timing**
```
Q: How many days before expiry should alerts start?
   Default: 30 days
   
Your answer: ___ days
Due: May 15 (non-critical, can use default)
Impact: Affects email frequency for upcoming expiries
```

**Decision 3: Blocking Credentials**
```
Q: Which credentials PREVENT scheduling if expired?
   Examples:
   - AHPRA registration (mandatory for therapy)
   - Working with Children (mandatory)
   - Professional Indemnity Insurance (warning only?)
   
Your blocking credentials:
1. ___________________
2. ___________________
3. ___________________

Due: May 22 (non-critical, can adjust after launch)
Impact: Affects scheduling logic
```

### From Antony Xavier (Manager)

**Decision 4: SMS for Client Reminders**
```
Q: Should client reminders be:
   A) Email only (no extra cost)
   B) SMS preferred, email fallback (cost: ~$0.01/SMS from Twilio)
   C) Skip client reminders in v1 (add Phase 2)

Answer: [ ] A  [ ] B  [ ] C
Due: May 13
Impact: If undecided, development proceeds with A (email-only)
Cost (Option B): ~$30–50/month if 5 clients get daily reminder 48-hour window
```

**Decision 5: Credentials Storage**
```
Q: Where to store credentials?
   A) Local PostgreSQL table (Recommended)
   B) Splose practitioner profile (requires API agreement)

Answer: [ ] A  [ ] B
Due: May 15 (if undecided, default to A)
Impact: Where credential data lives, how to query for expiry checks
```

**Decision 6: Flight Tracking API (Phase 2)**
```
Q: For June flight tracking feature, which API?
   A) FlightAware (recommended, covers most airlines)
   B) Sabre API (enterprise, pricey)
   C) AviationEdge (budget, fewer features)

Answer: [ ] A  [ ] B  [ ] C
Due: May 22 (non-critical, can decide later)
Cost (A): ~$5/month (hobby tier) or $99/month (professional)
Impact: Phase 2 timeline + cost
```

**Decision 7: Which Airlines for Flight Tracking?**
```
Q: Which international airlines should we monitor?
   Default: Qantas (QF), Jetstar (JQ), Virgin (VA)
   
Additional airlines: ___________________

Due: May 22 (non-critical, can start with default)
Impact: Flight tracking coverage
```

---

## 📋 PRE-DEVELOPMENT CHECKLIST (Complete Before Day 1)

### Environment & Access

- [ ] **Splose API key** obtained + tested
  - Get from: [https://dashboard.splose.com/](https://dashboard.splose.com/)
  - Test with: `curl -H "Authorization: Bearer YOUR_KEY" https://api.splose.com/v1/appointments`
  - Should return: Real appointments from Opal Therapy (not error 401)

- [ ] **Google Maps API key** obtained
  - Create project: [https://console.cloud.google.com/](https://console.cloud.google.com/)
  - Enable: Distance Matrix API, Geocoding API
  - Create API key (Application restrictions: none for dev, IP whitelist for prod)
  - Test with: Sample address → distance calculation

- [ ] **SendGrid account** created + API key obtained
  - Sign up: [https://sendgrid.com/](https://sendgrid.com/)
  - Create API key: [https://app.sendgrid.com/settings/api_keys](https://app.sendgrid.com/settings/api_keys)
  - Verify sender domain (opal-therapy.com.au email)
  - Test: Send 1 email to yourself

- [ ] **Twilio account** (optional, if Decision 4 = SMS)
  - Sign up: [https://www.twilio.com/](https://www.twilio.com/)
  - Get Australian phone number
  - Get API key + auth token
  - Test: Send 1 SMS to your phone

- [ ] **GitHub repo** created (for code + CI/CD)
  - Create: [https://github.com/new](https://github.com/new)
  - Repository name: `opal-therapy-scheduler`
  - Visibility: Private (until launch)
  - Initialize with: README.md + .gitignore (Node)

### Team & Roles

- [ ] **Backend developer** assigned (40 hours/week available May 10–31)
  - Name: ________________
  - Email: ________________
  - GitHub username: ________________

- [ ] **Frontend developer** assigned (40 hours/week available May 10–31)
  - Name: ________________
  - Email: ________________
  - GitHub username: ________________

- [ ] **QA/Tester** assigned (20–30 hours/week, focus Week 2–3)
  - Name: ________________
  - Email: ________________

- [ ] **DevOps/Deployment** assigned (10–20 hours/week, focus Week 3)
  - Name: ________________
  - Email: ________________

- [ ] **Product Owner** (Antony) available for decisions
  - Weekly sync: [ ] Monday 9 AM  [ ] Wednesday 3 PM  [ ] Other: ________
  - Decision deadline: May 13, 15 PM (Perth time) ← **HARD STOP**

### Local Development Environment

- [ ] **macOS/Windows/Linux** with Node.js 18+ installed
  - Verify: `node --version` → v18.x or higher
  - Verify: `npm --version` → npm 9+

- [ ] **Docker + Docker Compose** installed
  - Verify: `docker --version` → Docker 20.10+
  - Verify: `docker-compose --version` → 1.29+

- [ ] **PostgreSQL 14+** (or will use Docker)
  - Option A: Install local PostgreSQL 14
  - Option B: Use `docker-compose.yml` to spin up container

- [ ] **Git** configured
  - Verify: `git --version` → git 2.x+
  - Configure: `git config --global user.name "Your Name"`
  - Configure: `git config --global user.email "your@email.com"`

- [ ] **IDE/Editor** ready
  - VS Code (recommended) with extensions:
    - ES7+ React/Redux/React-Native snippets
    - Prettier (code formatter)
    - ESLint (code linter)
  - OR: WebStorm, Sublime Text, etc.

### Documentation Review (1 hour)

- [ ] Read: `ARCHITECTURE_SUMMARY.md` (this repo, one page)
- [ ] Read: `QUICK_START_GUIDE.md` (this repo, week-by-week)
- [ ] Read: `IMPLEMENTATION_MATRIX.md` (this repo, detailed tasks)
- [ ] Read: `PROJECT_HANDOFF.md` (Splose API reference)
- [ ] Skim: `PRODUCTION_ARCHITECTURE.md` (reference during dev)

### Day 1 Prep (May 10)

- [ ] Decisions **collected** from Ann + Antony (by 3 PM Perth time)
- [ ] Team meeting (30 min): discuss architecture, timeline, decisions
- [ ] Assign tasks from IMPLEMENTATION_MATRIX.md (Week 1)
- [ ] Create GitHub repo + add team members
- [ ] Slack channel created: #opal-scheduler-dev

---

## 📅 WEEK 1 CHECKLIST (May 10–17)

### Day 1–2: Setup (May 10–11)

**Backend Dev:**
- [ ] Clone repo, `npm install`
- [ ] Create `.env` from `.env.example`
  - `SPLOSE_API_KEY=<key>`
  - `GOOGLE_MAPS_API_KEY=<key>`
  - `SENDGRID_API_KEY=<key>`
  - `JWT_SECRET=<random-64-char-string>`
  - `DATABASE_URL=postgresql://user:pass@localhost:5432/opal_scheduler`
- [ ] Spin up postgres: `docker-compose up -d postgres`
- [ ] Run migrations: `npm run migrate:latest`
- [ ] Seed test data: `npm run seed`
- [ ] Start server: `npm run dev`
- [ ] Verify: `curl http://localhost:3000/api/health` → 200

**Frontend Dev:**
- [ ] Clone repo (same), `npm install` in `frontend/`
- [ ] Start dev server: `npm run dev`
- [ ] Verify: http://localhost:5173 loads blank page

**DevOps:**
- [ ] Confirm AWS Sydney account OR Azure Australia East account access
- [ ] Review DEPLOYMENT.md (to be written Week 2)

**QA:**
- [ ] Set up test environment
- [ ] Create test plan document (to be expanded Week 2)

**Status Check (EOD May 11):**
```
✅ Backend server running on 3000
✅ Frontend server running on 5173
✅ PostgreSQL accessible (docker-compose)
✅ Migrations passed
✅ Sample test data loaded
✅ All team members can access GitHub repo
```

---

### Day 2–3: Splose API Integration (May 11–12)

**Backend Dev:**
- [ ] Create `backend/config/splose.js` (SploseClient class)
  - [ ] Implement `get()`, `post()`, `put()` methods
  - [ ] Add cache layer (30-min TTL)
  - [ ] Add error handling (400, 401, rate limit, etc.)
- [ ] Create `backend/services/splose.js` (convenience methods)
  - [ ] `getAppointments(practitionerId, startDate, endDate)`
  - [ ] `getPatient(patientId)`
  - [ ] `getCase(caseId)`
  - [ ] `getLocation(locationId)`
  - [ ] `getServices()` (cache service IDs)
  - [ ] `getBusyTimes(practitionerId, startDate, endDate)`
- [ ] Test with real Splose API key
  - [ ] `getAppointments()` → returns real appointments ✅
  - [ ] Verify session type IDs match documented mapping

**Status Check (EOD May 12):**
```
✅ SploseClient class created + tested
✅ Real appointments fetched from Splose
✅ Caching layer working (repeated calls don't hit API)
✅ Error handling tested (simulate 401, 400, rate limit)
✅ Service ID mapping verified with live Splose data
```

---

### Day 3–4: Auth & Database (May 12–13)

**Backend Dev:**
- [ ] Create `users` table (with Ann's test data)
- [ ] Implement JWT middleware (`backend/middleware/auth.js`)
  - [ ] Verify token signature
  - [ ] Verify token expiry (24 hours)
  - [ ] Attach `req.user` to request
- [ ] Create login endpoint (`POST /api/auth/login`)
  - [ ] Accept email + password
  - [ ] Hash password with bcrypt
  - [ ] Return JWT token + user data
- [ ] Create `GET /api/me` endpoint
- [ ] Create logout endpoint (invalidate token)
- [ ] Test with Postman:
  - [ ] `POST /api/auth/login` (email: ann@opalstherapy.com.au, password: temp)
  - [ ] Returns JWT ✅
  - [ ] Token can be used to access `/api/me` ✅
  - [ ] Expired token rejected ✅

**Frontend Dev:**
- [ ] Create login form component (`src/components/Auth/LoginForm.jsx`)
  - [ ] Email + password inputs
  - [ ] Submit button
  - [ ] Error handling
- [ ] Create API client (`src/services/api.js`)
  - [ ] Fetch wrapper with auth headers
  - [ ] Token stored in localStorage
  - [ ] Auto-attach token to all requests
- [ ] Create auth hook (`src/hooks/useAuth.js`)
  - [ ] `login(email, password)` → returns token
  - [ ] `logout()` → clears token
  - [ ] `isAuthenticated()` → checks localStorage
- [ ] Create protected route wrapper
  - [ ] Redirects to login if not authenticated
  - [ ] Checks token on app load

**Status Check (EOD May 13):**
```
✅ Ann can log in (JWT token valid 24 hours)
✅ Protected routes redirect if not authenticated
✅ Token persists on page reload (localStorage)
✅ Logout clears token
✅ API calls include Authorization header
```

---

### Day 4–5: Calendar UI (May 13–14)

**Frontend Dev:**
- [ ] Build `WeekView.jsx` component
  - [ ] 5 columns (Mon–Fri)
  - [ ] 20 rows (08:00–18:00, 30-min intervals)
  - [ ] Grid layout (CSS Grid or Flexbox)
- [ ] Build `SessionBlock.jsx` component
  - [ ] Render appointment with: client name, time, session type
  - [ ] Color-coded by session type (8 colors)
  - [ ] Clickable (opens details modal)
- [ ] Create color legend (8 session types)
  - [ ] Initial (blue), Therapy (green), Assessment (orange), MDT (purple), Travel (cyan), Report (gray), Case noting (yellow), Admin (pink)
- [ ] Fetch appointments on load
  - [ ] `GET /api/appointments?week=2026-W19` (Week 1 is already underway, use current week)
  - [ ] Parse response, render SessionBlocks
- [ ] Add week navigation (prev/next buttons)
- [ ] Add date label (e.g., "Week 19, May 12–16, 2026")
- [ ] Test responsive design (desktop 1920px, tablet 1024px)

**Backend Dev:**
- [ ] Create `GET /api/appointments` endpoint
  - [ ] Accept query: `?week=2026-W##` or `?startDate=YYYY-MM-DD&endDate=...`
  - [ ] Call Splose API (fetch real appointments)
  - [ ] Return array of appointment objects (with client name, time, location, session type)
  - [ ] Protect with JWT middleware (require auth)

**Status Check (EOD May 14):**
```
✅ Calendar displays week view (Mon–Fri)
✅ Real appointments from Splose render on calendar
✅ Session types color-coded correctly
✅ Navigation (prev/next week) works
✅ Responsive on desktop + tablet
✅ No JavaScript errors in console
```

---

### Day 5–7: Smart Scheduler (May 14–17)

**Backend Dev:**
- [ ] Create `computeFreeSlots()` function
  - [ ] Input: practitioner, date range, duration (minutes)
  - [ ] Fetch: practitioner availability (working hours)
  - [ ] Fetch: appointments (subtract from availability)
  - [ ] Fetch: busy-times (subtract from availability)
  - [ ] Output: array of free 30-min slots across 14 days
  - [ ] Test: 14 days of slots returned, no overlap with appointments
- [ ] Create `scoreSlot()` function
  - [ ] Input: slot, client, case, practitioner
  - [ ] Calculate score:
    - [ ] Regional clustering: +40 if same suburb as 2+ clients booked same day
    - [ ] Busy/admin alternation: +20 if follows lighter day
    - [ ] Time preference: +10 if morning (adjust based on client pattern)
    - [ ] Capacity check: +30 if NDIS case has remaining hours
  - [ ] Return: score + reasons (list of factors)
  - [ ] Test: Example: 3 slots returned with scores 95, 78, 62
- [ ] Create `POST /api/appointments/suggest` endpoint
  - [ ] Accept: `client_id`, `case_id`, `duration_minutes`, optional `constraints`
  - [ ] Call: computeFreeSlots + scoreSlot for all slots
  - [ ] Return: top 3 options (score, reasons, start/end times)
  - [ ] Test with Postman: real client → 3 realistic options

**Frontend Dev:**
- [ ] Build scheduler modal component (`src/components/Features/SmartScheduler.jsx`)
  - [ ] Input: client dropdown, case dropdown, duration (default 60 min)
  - [ ] Button: "Get suggestions"
  - [ ] Display: 3 options as cards
    - [ ] Each card: time, date, score, reasons
    - [ ] Select button per option
  - [ ] On select: call `POST /api/appointments` to create
- [ ] Add "New Appointment" button to calendar
  - [ ] Click opens scheduler modal
- [ ] Test with real Splose data (5+ clients)

**QA:**
- [ ] Create test scenarios for scheduler
  - [ ] Test 1: Schedule client with 2+ others in same suburb (clustering bonus)
  - [ ] Test 2: Schedule after heavy day (alternation bonus)
  - [ ] Test 3: Schedule when case has limited capacity (no booking)
  - [ ] Test 4: Schedule with zero free slots (error message)

**Status Check (EOD May 17):**
```
✅ Smart scheduler suggests 3 realistic slots
✅ Top option has score ~90+
✅ Regional clustering detected correctly
✅ Busy/admin alternation working
✅ Capacity check prevents overbooking
✅ New appointment can be created from suggestion
✅ All features tested with real Splose data
✅ Week 1 complete — ready for features (Week 2)
```

---

## 📅 WEEK 2 CHECKLIST (May 17–24)

**Overview:** Implement 4 features (travel logbook, dormant cases, credentials, case notes)

See `QUICK_START_GUIDE.md` for detailed Week 2 breakdown.

**Critical milestones:**
- Day 1: Travel logbook auto-logging works
- Day 2: Travel reports (PDF + CSV) generate correctly
- Day 3: Dormant case detection sends email at 06:00 AWST
- Day 4: Credentials tracked + expiry alerts working
- Day 5: Case notes can be scheduled
- Day 7: All 4 features tested end-to-end

---

## 📅 WEEK 3 CHECKLIST (May 24–31)

**Overview:** Security hardening, deployment, UAT, launch

See `QUICK_START_GUIDE.md` for detailed Week 3 breakdown.

**Critical milestones:**
- Day 1: Security audit passed (CORS, CSRF, rate limiting, input validation)
- Day 2: Deployment infrastructure ready (AWS or Azure, staging environment)
- Day 3: Documentation complete (user guides, API docs, troubleshooting)
- Day 4: UAT dry run complete (Antony uses app 1 day, bugs fixed)
- Day 5: Production deployment successful
- Day 7: 24-hour stability confirmed, all systems monitored

---

## 🚨 BLOCKERS (If These Aren't Done, You're Stuck)

| Blocker | Impact | Mitigation |
|---------|--------|-----------|
| Splose API key not working | Can't fetch appointments | Get from Splose directly (not email) |
| Google Maps API quota exceeded | Travel logging fails | Switch to manual entry until quota resets |
| SendGrid email not sending | Daily alerts fail | Check SendGrid sandbox domain, verify sender |
| Team member unavailable | Schedule slip | Cross-train, adjust scope for Phase 2 |
| Database migration fails | Can't run app | Rollback + check SQL syntax, test on local postgres |
| Scheduler algorithm slow (> 2 sec) | Bad UX | Optimize free-slot caching, add database indexes |

---

## 📞 EMERGENCY CONTACTS

If something breaks during development:

| Issue | Contact | Timeframe |
|-------|---------|-----------|
| Splose API question | Splose support | 24 hours |
| Google Maps quota | Google Cloud support | 24 hours |
| SendGrid email issue | SendGrid support | 2 hours |
| Database corruption | DBA OR rollback to backup | ASAP |
| Code merge conflict | Team lead (pull together) | Immediate |
| Schedule slipping | Antony (May 22 decision point) | Next day |

---

## ✅ LAUNCH SIGN-OFF (May 31)

Before going live, ALL boxes must be checked:

### Development
- [ ] All code reviewed + merged
- [ ] All unit tests passing (`npm test`)
- [ ] All integration tests passing
- [ ] No unhandled JavaScript errors (Sentry: 0 errors)
- [ ] Performance benchmarks met (page load < 3 sec, scheduler < 2 sec)

### QA
- [ ] UAT checklist 100% complete
- [ ] No critical/blocking bugs remaining
- [ ] Edge cases tested (zero slots, capacity exceeded, API errors)
- [ ] Mobile/tablet responsive verified
- [ ] Accessibility tested (keyboard navigation, screen reader)

### Security
- [ ] CORS configured for production domain only
- [ ] CSRF tokens implemented
- [ ] Rate limiting enabled (login: 5 attempts / 15 min)
- [ ] Sensitive data encrypted (API keys, passwords)
- [ ] SQL injection tests passed
- [ ] XSS prevention verified

### Infrastructure
- [ ] Database backups automated + tested restorable
- [ ] Monitoring active (Sentry, CloudWatch, email alerts)
- [ ] SSL certificate valid (HTTPS, no warnings)
- [ ] Domain resolves correctly
- [ ] Staging environment = production configuration

### Documentation
- [ ] User guides ready (Ann + Antony)
- [ ] API documentation complete
- [ ] Deployment runbook written
- [ ] Emergency procedures documented

### Training
- [ ] Ann trained (30-min session)
- [ ] Antony trained (1-hour dry run)
- [ ] Both signed off: "Ready to launch"

### Compliance
- [ ] Australian Privacy Principles reviewed
- [ ] Data residency confirmed (Sydney region)
- [ ] NDIS Practice Standards verified

---

## 🎯 YOU'RE READY

You have:
- ✅ Architecture blueprint (detailed + one-page)
- ✅ Week-by-week checklist (77 + 89.5 + 52.5 = 219 hours)
- ✅ Decision points identified
- ✅ Team roles assigned
- ✅ API endpoints documented
- ✅ Database schema ready
- ✅ Deployment plan
- ✅ Success metrics

**What you need to do right now:**

1. **Collect decisions** from Ann + Antony (by May 13, 3 PM Perth time)
2. **Confirm team** members + their availability (40 hrs/week)
3. **Get API keys** (Splose, Google Maps, SendGrid, Twilio optional)
4. **Create GitHub repo** + invite team
5. **Schedule Day 1 kickoff** (30 min team meeting)
6. **Read:** `QUICK_START_GUIDE.md` (this week)

**Then:** Start Week 1 Day 1 at 9 AM on May 10.

---

**Let's build something amazing.** 🚀

Questions? Read the architecture docs or ask your team. You've got everything you need.

