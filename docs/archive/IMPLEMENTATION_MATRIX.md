# Implementation Matrix — Detailed Feature Breakdown

**Purpose:** Show exactly what code/tests/docs to write, in what order, with dependencies.

**Format:**
- Phase: Week 1, 2, or 3
- Feature: Name
- Component: Backend / Frontend / Database / Tests / Docs
- Priority: P0 (blocks others) | P1 (important) | P2 (nice-to-have)
- Estimate: Hours
- Owner: Backend Dev | Frontend Dev | QA | DevOps
- Dependencies: What must be done first
- Testing: How to verify completion

---

## PHASE 1: FOUNDATION (Week 1, May 10–17)

### 1.1 Project Setup & Infrastructure

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| DevOps | Initialize Node.js + Express repo | P0 | 1 | Backend Dev | — | `npm install` + `npm run dev` → "Listening on 3000" |
| DevOps | Set up docker-compose (postgres + redis) | P0 | 2 | DevOps | Node.js setup | `docker-compose up` → postgres listening on 5432 |
| DevOps | Create `.env.example` + secrets template | P0 | 0.5 | Backend Dev | Node setup | `.env` created with all keys (SPLOSE_API_KEY, etc.) |
| Database | Create PostgreSQL schema (all 5 tables) | P0 | 3 | Backend Dev | docker-compose running | `psql` → `\dt` shows 5 tables |
| Backend | Set up migrations runner (db-migrate) | P0 | 1 | Backend Dev | PostgreSQL | `npm run migrate:latest` succeeds |
| Frontend | Initialize React + Vite + Tailwind | P0 | 1.5 | Frontend Dev | Node.js setup | `npm run dev` → http://localhost:5173 loads |
| Frontend | Set up API client + fetch wrapper | P1 | 1 | Frontend Dev | React setup | `api.get('/me')` handles auth headers + errors |
| Docs | Create README with quick start | P1 | 1 | Backend Dev | Everything above | New developer can run app in 10 minutes |

**Phase 1.1 Total:** 10.5 hours  
**Completion Criteria:** Both servers running, database accessible, basic fetch working

---

### 1.2 Authentication & User Management

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Database | Create `users` table schema | P0 | 0.5 | Backend Dev | PostgreSQL migrations | Table exists with correct columns |
| Backend | Implement JWT middleware | P0 | 2 | Backend Dev | Express setup | `next(err)` on invalid token |
| Backend | Create login endpoint (`POST /api/auth/login`) | P0 | 1.5 | Backend Dev | JWT middleware | `curl -X POST /api/auth/login` → JWT token |
| Backend | Create logout endpoint | P1 | 0.5 | Backend Dev | JWT middleware | Token invalidated after logout |
| Backend | Create `GET /api/me` endpoint | P0 | 0.5 | Backend Dev | JWT middleware | Returns user + preferences |
| Backend | Add password hashing (bcrypt) | P0 | 0.5 | Backend Dev | Login endpoint | Passwords stored hashed, verified correctly |
| Frontend | Build login form component | P0 | 1.5 | Frontend Dev | React + API client | Form submits to `/api/auth/login`, stores token |
| Frontend | Add auth check on app load | P0 | 1 | Frontend Dev | Login form | Redirects to login if not authenticated |
| Tests | Write auth unit tests (login, token verify) | P1 | 2 | QA | Auth endpoints | `npm test` passes all auth tests |

**Phase 1.2 Total:** 10 hours  
**Completion Criteria:** Ann can log in, JWT token valid for 24 hours, session persists on page reload

---

### 1.3 Splose API Integration

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Backend | Create `SploseClient` class (GET/POST/PUT methods) | P0 | 3 | Backend Dev | Node.js setup | `splose.get('/patients/123')` returns data |
| Backend | Implement caching layer (30-min TTL) | P0 | 2 | Backend Dev | SploseClient | Repeated calls don't hit API within 30 min |
| Backend | Add error handling (400, rate limit, auth) | P0 | 1.5 | Backend Dev | SploseClient | 400 error shows user-friendly message |
| Backend | Create appointments read endpoints | P0 | 2 | Backend Dev | SploseClient | `GET /api/appointments?week=YYYY-W##` returns Splose data |
| Backend | Create patients read endpoint | P0 | 1 | Backend Dev | SploseClient | `GET /api/patients` supports search |
| Backend | Create cases read endpoint | P0 | 1 | Backend Dev | SploseClient | `GET /api/cases` with funding info |
| Backend | Verify all 8 session type service IDs (Splose) | P0 | 1 | Backend Dev | SploseClient | Document mapping: Initial=125821, Therapy=125320, etc. |
| Tests | Write Splose client tests (mocked API) | P1 | 2 | QA | SploseClient | `npm test` passes API mocking |
| Docs | Document Splose API mapping | P1 | 1 | Backend Dev | SploseClient verification | SPLOSE_INTEGRATION.md created with all endpoints |

**Phase 1.3 Total:** 14.5 hours  
**Completion Criteria:** Real Splose appointments display on calendar, session type colors correct, caching works

---

### 1.4 Calendar UI (Basic Week View)

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Frontend | Build `WeekView.jsx` component (Mon-Fri grid) | P0 | 3 | Frontend Dev | React + API client | Calendar grid renders with 5 columns |
| Frontend | Add time axis (08:00–18:00, 30-min intervals) | P0 | 1 | Frontend Dev | WeekView | 20 time rows visible |
| Frontend | Build `SessionBlock.jsx` for appointments | P0 | 2 | Frontend Dev | React | Each appointment renders with color + client name |
| Frontend | Implement color-coded legend (8 session types) | P0 | 1 | Frontend Dev | SessionBlock | Legend shows all 8 types, matches block colors |
| Frontend | Fetch appointments on load + re-render | P0 | 1.5 | Frontend Dev | API client + WeekView | Calendar updates when appointments change |
| Frontend | Add "New Appointment" button (opens modal) | P0 | 1 | Frontend Dev | WeekView | Button click opens empty modal |
| Frontend | Add navigation (previous week / next week) | P1 | 1 | Frontend Dev | WeekView | Arrows change displayed week |
| Frontend | Make responsive (desktop + tablet) | P1 | 1.5 | Frontend Dev | CSS | Works on iPad (1024px) without horizontal scroll |
| Tests | Write component tests (WeekView render) | P1 | 1.5 | QA | Jest + React Testing Library | `npm test` passes UI tests |

**Phase 1.4 Total:** 12.5 hours  
**Completion Criteria:** Real Splose appointments visible on calendar with correct colors and times

---

### 1.5 Smart Scheduler Algorithm

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Backend | Implement `computeFreeSlots()` function | P0 | 3 | Backend Dev | Splose API integration | Returns free 30-min slots across 14 days |
| Backend | Implement `scoreSlot()` with weights | P0 | 3 | Backend Dev | Splose API + patient data | Slots sorted by score (95, 78, 62) |
| Backend | Add regional clustering logic (suburbs) | P0 | 2 | Backend Dev | Location data from Splose | Groups East-side clients on same day |
| Backend | Add busy/admin day alternation | P0 | 2 | Backend Dev | Appointments + busy-times | Heavy days followed by lighter days |
| Backend | Create `/api/appointments/suggest` endpoint | P0 | 1.5 | Backend Dev | All scoring functions | Returns 3 options with reasons |
| Backend | Add capacity check (NDIS funding) | P1 | 2 | Backend Dev | Cases data | Warns if appointment would exceed case hours |
| Frontend | Build scheduler modal UI | P0 | 2 | Frontend Dev | React | Modal shows 3 options, user selects one |
| Frontend | Display scoring reasons (why this slot?) | P1 | 1 | Frontend Dev | Modal | Each option shows ["clusters", "after admin day"] |
| Frontend | Hook "New Appointment" to scheduler | P0 | 1.5 | Frontend Dev | Modal + API | Clicking option creates appointment |
| Tests | Unit test scoring algorithm (10 scenarios) | P1 | 2.5 | QA | Scoring functions | `npm test` covers clustering, alternation, capacity |
| Tests | Integration test (end-to-end suggest + create) | P1 | 2 | QA | Scheduler endpoint | Full flow works with mock Splose data |

**Phase 1.5 Total:** 22 hours  
**Completion Criteria:** Scheduler suggests realistic slots, top option has score 90+, new appointment created successfully

---

### 1.6 Basic Appointment CRUD

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Backend | Create `POST /api/appointments` (write to Splose) | P0 | 2 | Backend Dev | SploseClient + scheduler | Appointment created in Splose + local DB |
| Backend | Create `PUT /api/appointments/:id` (reschedule) | P1 | 1.5 | Backend Dev | SploseClient | Appointment moved in Splose |
| Backend | Create `GET /api/appointments/:id` (single) | P1 | 0.5 | Backend Dev | SploseClient | Returns detailed appointment info |
| Backend | Add error handling (invalid time, no capacity, etc.) | P1 | 1 | Backend Dev | CRUD endpoints | Errors show user-friendly messages |
| Frontend | Add appointment details modal (on click) | P1 | 1.5 | Frontend Dev | SessionBlock | Shows client, time, case, actions |
| Frontend | Add reschedule UI (pick new time) | P1 | 1.5 | Frontend Dev | Details modal | Calls `/api/appointments/{id}` PUT |

**Phase 1.6 Total:** 8 hours  
**Completion Criteria:** Ann can create appointment via scheduler, view details, reschedule it

---

## PHASE 2: MAJOR FEATURES (Week 2, May 17–24)

### 2.1 Travel Logbook (Complete)

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Database | Create `travel_logs` table | P0 | 0.5 | Backend Dev | PostgreSQL | Table with kms, client_id, appointment_id, date |
| Backend | Integrate Google Maps Distance Matrix API | P0 | 1.5 | Backend Dev | Node.js setup | `googleMaps.getDistance(addr1, addr2)` → KM |
| Backend | Create `travelLogger.js` service | P0 | 2 | Backend Dev | Google Maps + Splose API | Auto-logs distance when appointment created |
| Backend | Create `/api/travel/logs` endpoint (GET + POST) | P0 | 1.5 | Backend Dev | Travel logger | Lists all travel entries, allows manual add |
| Backend | Create `/api/travel/calculate-distance` | P0 | 1 | Backend Dev | Google Maps | Takes start/end address, returns KM |
| Frontend | Build travel list view component | P1 | 1.5 | Frontend Dev | React | Shows all travel entries by date |
| Frontend | Add manual travel entry form | P1 | 1 | Frontend Dev | React | Can add retroactive travel (for past appointments) |
| Frontend | Add KM edit feature (allow correction) | P1 | 1 | Frontend Dev | API | Ann can override auto-calculated distance |
| Tests | Test Google Maps integration (real API call) | P1 | 1 | QA | Google Maps setup | 5 real addresses → correct distances |

**Phase 2.1 Subtotal:** 10.5 hours (just backend features, travel reports in 2.2)

---

### 2.2 Travel Reports (PDF + CSV Export)

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Backend | Create `travelReportGenerator.js` service | P0 | 2.5 | Backend Dev | Travel logs | Generates PDF + CSV from DB |
| Backend | Create `/api/travel/reports/annual` endpoint | P0 | 1 | Backend Dev | Report generator | Returns PDF file |
| Backend | Create `/api/travel/reports/csv` endpoint | P0 | 0.5 | Backend Dev | Report generator | Returns CSV file |
| Frontend | Add "Download Annual Report" button | P1 | 1 | Frontend Dev | API endpoint | Button downloads PDF |
| Frontend | Add "Export CSV" button | P1 | 0.5 | Frontend Dev | API endpoint | Button downloads CSV |
| Frontend | Show tax deduction summary (ATO cents-per-km) | P1 | 0.5 | Frontend Dev | React math | Displays "Total: 1,284 km × $0.66 = $847.44" |
| Tests | Test PDF generation (layout correct) | P1 | 1.5 | QA | PDF lib | PDF renders correctly, math accurate |
| Docs | Document report format (for accountant) | P1 | 0.5 | Backend Dev | Report generator | PDF structure documented |

**Phase 2.2 Subtotal:** 7.5 hours

**Phase 2.1 + 2.2 Total (Travel Logbook):** 18 hours  
**Completion Criteria:** Ann can view all travel, download annual PDF + CSV, report ready for accountant

---

### 2.3 Dormant Case Detection

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Database | Create `dormant_case_alerts` table | P0 | 0.5 | Backend Dev | PostgreSQL | Table with case_id, last_activity, weeks_dormant |
| Backend | Create `dormantCaseDetector.js` service | P0 | 2.5 | Backend Dev | Splose API | Finds cases > 6 weeks inactive |
| Backend | Create scheduler task (06:00 AWST daily) | P0 | 1 | Backend Dev | node-cron + detector | Task runs at correct time |
| Backend | Integrate SendGrid email service | P0 | 1.5 | Backend Dev | SendGrid API key | Emails send successfully |
| Backend | Create `/api/dormant-cases` endpoint | P0 | 1 | Backend Dev | Detector | Lists all dormant cases |
| Backend | Create `/api/dormant-cases/check` endpoint | P1 | 0.5 | Backend Dev | Detector | Manual trigger for testing |
| Backend | Create `/api/dormant-cases/:case_id/acknowledge` endpoint | P1 | 0.5 | Backend Dev | Detector | Mark alert as reviewed |
| Frontend | Build dormant cases dashboard widget | P0 | 2 | Frontend Dev | React | Shows table of dormant cases with quick-schedule links |
| Frontend | Display last activity date + NDIS status | P1 | 1 | Frontend Dev | Widget | Each row shows "No activity since April 15" + funding remaining |
| Frontend | Add "Schedule Now" quick-link per case | P1 | 1 | Frontend Dev | Widget + scheduler | Clicking opens scheduler for that client |
| Frontend | Show dormant case count on dashboard | P1 | 0.5 | Frontend Dev | Widget | "3 dormant cases detected" banner |
| Email | Create email template (HTML) | P1 | 1 | Backend Dev | SendGrid | Template shows table + action buttons |
| Tests | Test detector logic (6-week threshold) | P1 | 1.5 | QA | Unit test | Correctly identifies dormant vs. active |
| Tests | Test email delivery (SendGrid webhook) | P1 | 1 | QA | Email service | Email successfully delivered |

**Phase 2.3 Total:** 16 hours  
**Completion Criteria:** Daily email sends at 06:00 AWST with dormant case list, Antony can review dashboard

---

### 2.4 Credentials Tracking

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Database | Create `credentials` table | P0 | 0.5 | Backend Dev | PostgreSQL | Fields: name, type, expiry_date, status, is_blocking |
| Backend | Create credential CRUD endpoints | P0 | 2 | Backend Dev | Express | POST/PUT/DELETE /api/credentials |
| Backend | Create `credentialChecker.js` service | P0 | 2 | Backend Dev | Splose API + credentials | Checks expiry, updates status |
| Backend | Create daily scheduler (06:00 AWST) | P0 | 1 | Backend Dev | node-cron + checker | Runs credential check every day |
| Backend | Implement blocking logic (prevent scheduling if expired) | P1 | 1.5 | Backend Dev | Scheduler | Prevents new appointment if blocking credential expired |
| Backend | Create email alerts (30-day warning + expiry) | P1 | 1.5 | Backend Dev | SendGrid | Sends to Antony + Ann at correct times |
| Frontend | Build credentials list component | P0 | 1.5 | Frontend Dev | React | Shows all credentials with expiry date + status |
| Frontend | Build credential add/edit form | P1 | 1.5 | Frontend Dev | React | Modal form for new credential |
| Frontend | Color-code status (green/yellow/red) | P1 | 0.5 | Frontend Dev | CSS | Valid=green, expires_soon=yellow, expired=red |
| Frontend | Show warning banner on dashboard | P1 | 1 | Frontend Dev | React | "AHPRA expires in 21 days" red banner if urgent |
| Frontend | Add renewal links (to AHPRA, insurance, etc.) | P1 | 0.5 | Frontend Dev | React | Click "Renew" opens external link |
| Tests | Test expiry calculation | P1 | 1 | QA | Unit test | Correctly identifies expires_soon vs. valid |
| Tests | Test blocking logic (prevent scheduling) | P1 | 1.5 | QA | Integration test | Cannot create appointment if credential expired |

**Phase 2.4 Total:** 16.5 hours  
**Completion Criteria:** Ann's credentials visible in profile, expiry alerts send, scheduling prevented if blocking credential expired

---

### 2.5 Case Noting Suggestions

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Database | Create `case_notes` table | P0 | 0.5 | Backend Dev | PostgreSQL | appointment_id, client_id, case_id, scheduled_at, busy_time_id |
| Backend | Create case note suggestion service | P0 | 2 | Backend Dev | Splose API | Suggests 10–15 min block after session |
| Backend | Create `/api/case-notes/suggestions` endpoint | P0 | 1 | Backend Dev | Suggestion service | Returns pending suggestions |
| Backend | Create `/api/case-notes/:id/schedule` endpoint | P0 | 1.5 | Backend Dev | Splose API | Creates busy-time in Splose (or TBC type) |
| Backend | Create `/api/case-notes/:id/complete` endpoint | P1 | 0.5 | Backend Dev | DB update | Marks case note as completed |
| Backend | Implement three scheduling strategies | P0 | 1.5 | Backend Dev | Suggestion service | auto_same_day, manual, todo |
| Frontend | Build case note suggestion modal | P0 | 2 | Frontend Dev | React | Modal appears after appointment created |
| Frontend | Show three scheduling options (auto/manual/todo) | P1 | 1 | Frontend Dev | React | Radio buttons for each strategy |
| Frontend | Auto-schedule finds gap (afternoon preferred) | P1 | 1.5 | Frontend Dev | Scheduler logic | Finds same-day gap, prefers after lunch |
| Frontend | Manual scheduling opens time picker | P1 | 1.5 | Frontend Dev | React | User picks date + time |
| Frontend | To-do option shows flexible list | P1 | 1 | Frontend Dev | React | Case note added to action items |
| Frontend | Show case note history | P1 | 1 | Frontend Dev | React | View past week's case notes |
| Tests | Test suggestion trigger (post-appointment) | P1 | 1 | QA | Integration test | Suggestion appears after appointment created |

**Phase 2.5 Total:** 16.5 hours (pending Ann's decision on storage)  
**Completion Criteria:** Case note suggested after session, Ann can schedule it, appears on calendar

---

### 2.6 Integration Testing & Refinement

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| QA | End-to-end test script (full user flow) | P0 | 2 | QA | All features | `npm run test:e2e` passes |
| QA | Test Splose API error handling | P0 | 2 | QA | Splose integration | App handles downtime gracefully |
| QA | Test edge cases (zero slots, capacity exceeded) | P0 | 2 | QA | Scheduler | Proper error messages shown |
| QA | Performance testing (scheduler < 2 sec) | P1 | 1.5 | QA | Scheduler | Latency benchmarked |
| QA | Mobile/tablet responsiveness | P1 | 1.5 | QA | Frontend | Works on iPad without horizontal scroll |
| QA | Bug fixes from UAT | P0 | 2 | Backend/Frontend | Testing | All UAT issues resolved |
| Docs | API documentation (all endpoints) | P1 | 2 | Backend Dev | All endpoints | API.md complete with examples |
| Docs | Database schema documentation | P1 | 1 | Backend Dev | All tables | SCHEMA.md with ER diagram |
| Docs | Feature guides (user + admin) | P1 | 2 | Backend Dev | All features | USER_GUIDE.md + ADMIN_GUIDE.md ready |

**Phase 2.6 Total:** 15.5 hours  
**Completion Criteria:** All 4 features working end-to-end, zero unhandled errors, documentation complete

---

**PHASE 2 TOTAL:** 18 + 7.5 + 16 + 16.5 + 16.5 + 15.5 = **89.5 hours**

---

## PHASE 3: PRODUCTION (Week 3, May 24–31)

### 3.1 Security Hardening

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Backend | Add rate limiting (5 attempts / 15 min on login) | P0 | 1 | Backend Dev | Express | `npm test` passes rate limit tests |
| Backend | Implement CORS (allow opalstherapy.com.au only) | P0 | 0.5 | Backend Dev | Express | CORS header set correctly |
| Backend | Add CSRF protection on forms | P0 | 1 | Backend Dev | Express | CSRF token required + validated |
| Backend | Encrypt sensitive data in DB (Splose API key) | P0 | 1 | Backend Dev | crypto + DB | Keys stored encrypted, decrypted on read |
| Backend | Sanitize all inputs (prevent SQL injection + XSS) | P0 | 1.5 | Backend Dev | Input validation library | `npm test` passes OWASP tests |
| Backend | Add request logging (who, what, when) | P0 | 1 | Backend Dev | Morgan + logging | Logs stored, sensitive data redacted |
| Backend | Set up error tracking (Sentry) | P0 | 1.5 | Backend Dev | Sentry SDK | Errors logged + email alerts sent |
| Frontend | Add Content Security Policy header | P1 | 0.5 | Frontend Dev | Express | CSP header blocks unsafe scripts |
| Tests | OWASP security tests (SQL injection, XSS) | P0 | 2 | QA | Penetration test tools | All tests pass |

**Phase 3.1 Total:** 10 hours  
**Completion Criteria:** App passes basic security audit, no XSS/SQL injection vulnerabilities

---

### 3.2 Deployment & Infrastructure

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| DevOps | Choose hosting (AWS Sydney OR Azure Australia) | P0 | 1 | DevOps | — | Decision documented |
| DevOps | Create production PostgreSQL database | P0 | 1 | DevOps | Hosting choice | DB accessible, backups automated |
| DevOps | Build Docker image (backend + migrations) | P0 | 1.5 | Backend Dev | Dockerfile | `docker build` succeeds |
| DevOps | Push image to registry (ECR OR ACR) | P0 | 1 | DevOps | Docker image | Image tagged + pushed |
| DevOps | Set up CI/CD pipeline (GitHub Actions) | P0 | 2 | DevOps | Git repo | PR → test → deploy workflow |
| DevOps | Configure environment variables (production) | P0 | 0.5 | DevOps | Hosting | `.env` values set in production |
| DevOps | Set up automated backups (daily, 30-day retention) | P0 | 1 | DevOps | PostgreSQL | Backups verified restorable |
| DevOps | Configure domain (scheduler.opalstherapy.com.au) | P0 | 0.5 | DevOps | Hosting | DNS resolves correctly |
| DevOps | Set up SSL certificate (Let's Encrypt) | P0 | 1 | DevOps | Domain | HTTPS working, no cert warnings |
| DevOps | Deploy to staging (test deployment) | P0 | 1.5 | DevOps | All above | Staging app accessible, all features work |
| DevOps | Set up monitoring (CloudWatch OR AppInsights) | P0 | 1.5 | DevOps | Production DB | Metrics dashboard visible |
| Tests | Health check endpoint (`GET /api/health`) | P1 | 0.5 | Backend Dev | Express | Returns 200 + uptime |

**Phase 3.2 Total:** 12.5 hours  
**Completion Criteria:** App deployed to staging, all features verified, production ready

---

### 3.3 Documentation & User Training

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Docs | Write USER_GUIDE.md (for Ann) | P0 | 2 | Backend Dev | All features | 4-page guide covering login, scheduler, reports |
| Docs | Write ADMIN_GUIDE.md (for Antony) | P0 | 1.5 | Backend Dev | All features | 2-page guide for dashboard, settings, alerts |
| Docs | Write DEPLOYMENT.md (for DevOps) | P0 | 2 | DevOps | Deployment steps | Covers setup, troubleshooting, scaling |
| Docs | Write API documentation (all 15+ endpoints) | P0 | 1.5 | Backend Dev | All endpoints | API.md with request/response examples |
| Docs | Create troubleshooting guide | P1 | 1 | Backend Dev | Common issues | FAQ covering 10+ common problems |
| Docs | Create emergency runbook | P1 | 1 | Backend Dev | Deployment | "What to do if app is down" + rollback steps |
| Training | Schedule training session with Ann (30 min) | P0 | 0.5 | Backend Dev | User guides | Session scheduled, Ann attends |
| Training | Do dry run with Ann (1 hour) | P0 | 1 | Backend Dev | All features | Ann walks through key flows |
| Training | Create video tutorials (optional) | P2 | 2 | Frontend Dev | All features | 3–5 videos (5 min each) demonstrating features |

**Phase 3.3 Total:** 12.5 hours  
**Completion Criteria:** All documentation written + reviewed, Ann trained + confident

---

### 3.4 UAT & Launch

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| QA | UAT dry run (Antony uses app 1 day with real data) | P0 | 4 | QA | All features + staging | All UAT checklist items pass |
| QA | Document bugs found | P0 | 1 | QA | UAT dry run | Bug list created, prioritized |
| Backend | Fix UAT bugs (priority list) | P0 | 2 | Backend Dev | Bug list | All P0/P1 bugs fixed + re-tested |
| QA | Re-test all features | P0 | 1.5 | QA | Bug fixes | Regression testing passes |
| DevOps | Final staging verification | P0 | 1 | DevOps | All fixes | Staging = production configuration exactly |
| DevOps | Deploy to production | P0 | 1 | DevOps | Staging verified | `kubectl apply` OR `az webapp deployment` succeeds |
| Backend | Verify all services running (post-deploy) | P0 | 0.5 | Backend Dev | Production deployed | Backend ✓, postgres ✓, email ✓, monitoring ✓ |
| QA | Quick sanity test (production, 15 min) | P0 | 0.5 | QA | Production deployed | Login → calendar → create appointment → works |
| Ops | Monitor error logs (first 2 hours) | P0 | 2 | Backend Dev | Production deployed | No errors in logs, performance normal |

**Phase 3.4 Total:** 13 hours  
**Completion Criteria:** App live in production, verified working, monitoring active

---

### 3.5 Post-Launch Operations

| Component | Task | Priority | Hours | Owner | Dependencies | Testing |
|-----------|------|----------|-------|-------|--------------|---------|
| Ops | Verify 06:00 AWST dormant case email sends | P0 | 0.5 | Backend Dev | Production deployed | Email received by Antony |
| Ops | Monitor Splose API calls (rate limit status) | P0 | 0.5 | Backend Dev | Production deployed | Rate limit dashboard shows < 60/min |
| Ops | Monitor email delivery (SendGrid) | P0 | 0.5 | Backend Dev | Production deployed | Delivery rates 98%+ (check dashboard) |
| Ops | Collect feedback from Ann + Antony | P1 | 1 | Backend Dev | 24h of live use | Feedback documented |
| Ops | Schedule debrief call (May 31) | P1 | 1 | Backend Dev | 1 week of live use | Call scheduled, notes taken |
| Docs | Document Phase 2 roadmap (flight tracking) | P1 | 1 | Backend Dev | Feedback received | PHASE_2_ROADMAP.md created |

**Phase 3.5 Total:** 4.5 hours  
**Completion Criteria:** App stable 24+ hours, all systems verified, Phase 2 planned

---

**PHASE 3 TOTAL:** 10 + 12.5 + 12.5 + 13 + 4.5 = **52.5 hours**

---

## GRAND TOTAL: All Phases

| Phase | Hours | Week | Owner Focus |
|-------|-------|------|------------|
| **Phase 1: Foundation** | 77 | Week 1 (May 10–17) | Backend setup, auth, Splose, calendar, scheduler |
| **Phase 2: Features** | 89.5 | Week 2 (May 17–24) | Travel logbook, dormant cases, credentials, case notes, testing |
| **Phase 3: Production** | 52.5 | Week 3 (May 24–31) | Security, deployment, documentation, UAT, launch |
| **TOTAL** | **219 hours** | **3 weeks** | — |

---

## Team Capacity

Assuming 40-hour work weeks:

### Option 1: Small Team (1 Backend + 1 Frontend + 1 QA)
- **Phase 1:** 26 hours Backend + 16 hours Frontend + 13 hours QA = 55 hours → 1.4 weeks (overlapping work)
- **Phase 2:** 40 hours Backend + 25 hours Frontend + 15 hours QA = 80 hours → 2 weeks (overlapping)
- **Phase 3:** 30 hours Backend + 5 hours Frontend + 10 hours QA/DevOps = 45 hours → 1.1 weeks
- **Total:** 3 weeks (realistic with overlap + parallelization)

### Option 2: Larger Team (2 Backend + 2 Frontend + 1 QA + 1 DevOps)
- **Phase 1:** Reduce to 1.5 weeks (parallel database + auth + frontend)
- **Phase 2:** Reduce to 1.5 weeks (parallel features)
- **Phase 3:** Reduce to 1 week (parallel deployment + documentation)
- **Total:** 2.5 weeks (tight but doable)

### Option 3: Solo Developer (Not Recommended)
- **Total:** 5–6 weeks (220 hours / 40 hours per week) — misses 3-week target

---

## Critical Path (What Blocks What)

```
Setup (2h)
├─ Postgres + Docker (2h)
│  └─ Migrations (3h)
│     └─ Database tables created
│        ├─ Users table (0.5h)
│        │  └─ Auth middleware (2h)
│        │     └─ Login endpoint (1.5h)
│        │        └─ Frontend login form (1.5h)
│        ├─ Splose API client (3h)
│        │  └─ Caching (2h)
│        │     └─ Appointments endpoint (2h)
│        │        └─ Calendar UI (3h)
│        │           └─ Session blocks (2h)
│        └─ Travel logs table (0.5h)
│           └─ Google Maps integration (1.5h)
│              └─ Travel logger service (2h)
│                 └─ Travel reports (2.5h)

Scheduler algorithm
├─ Free slot computation (3h)
├─ Scoring logic (3h)
└─ Scheduler endpoint (1.5h)
   └─ Scheduler UI modal (2h)
      └─ Full appointment creation flow

Dormant case detection
├─ Detector service (2.5h)
├─ Scheduler task (1h)
└─ Email integration (1.5h)
   └─ Dashboard widget (2h)

Credentials
├─ Credentials table (0.5h)
├─ Checker service (2h)
└─ Scheduler task (1h)
   └─ Dashboard widget (1.5h)

Case notes
├─ Case notes table (0.5h)
├─ Suggestion service (2h)
└─ Suggestion modal (2h)
```

**Longest Path:** Setup → Database → Splose API → Scheduler Algorithm → Appointment Creation → Travel Logging → Reports  
**Estimated:** ~30 hours (must complete before Week 2 features can test end-to-end)

---

## Risk Mitigations (What Could Go Wrong)

| Risk | Mitigation | Hours Buffer |
|------|-----------|--------------|
| Splose API stricter than documented | Test early (Day 2), ask for clarification | +2h (built into Phase 1.3) |
| Google Maps quota exceeded | Batch requests, implement fallback (manual entry) | +1h design, deferred Phase 2 |
| Email delivery unreliable | Set up retry queue, monitor SendGrid | +2h backend, Phase 2 testing |
| Scheduler algorithm slow | Optimize + cache free slots | +2h optimization, Phase 1.5 |
| Credentials feature scope creep | Stick to MVP (add/edit/view), defer Phase 2 enhancements | Dedicate Day 4 Phase 2 only |
| Database migration failures | Test migrations on staging before production | +1h, Phase 3.2 |
| Team member unavailable | Cross-train; Phase 1 tasks can be done by either backend or frontend dev | Plan coverage Day 1 |

**Total Risk Buffer:** 10 hours (can compress schedule by 10h if needed)

---

## Definition of "Done"

### Phase 1
- [ ] App boots (both servers)
- [ ] Database tables created + accessible
- [ ] Login works (JWT token valid 24h)
- [ ] Calendar shows real Splose appointments (color-coded)
- [ ] Smart scheduler returns 3 scored options
- [ ] Appointment creation works end-to-end
- [ ] Zero unhandled errors in console

### Phase 2
- [ ] Travel logging auto-works on all new appointments
- [ ] Annual travel report (PDF + CSV) generates correctly
- [ ] Daily 06:00 AWST dormant case email sends
- [ ] Credentials tracked + expiry alerts send
- [ ] Case notes suggested + can be scheduled
- [ ] All 4 features tested with real Splose data
- [ ] Documentation complete (API + user guides)

### Phase 3
- [ ] App deployed to production (AWS Sydney or Azure Australia East)
- [ ] SSL/TLS configured (HTTPS only)
- [ ] Monitoring + alerting active (errors → Antony)
- [ ] UAT passed (Antony used app 1 day, all features work)
- [ ] User training done (Ann confident)
- [ ] Backups automated (daily, 30-day retention)
- [ ] Go-live checklist passed
- [ ] 24-hour production stability verified

---

## Sign-Off (By May 31)

### From Development Team
- [ ] All code reviewed + merged
- [ ] All tests passing (`npm test`)
- [ ] No critical bugs remaining
- [ ] Documentation complete + reviewed

### From QA
- [ ] All features tested (UAT checklist)
- [ ] Performance benchmarks met
- [ ] Security audit passed
- [ ] Edge cases handled
- [ ] Sign-off: "Ready for production"

### From DevOps
- [ ] Infrastructure configured + tested
- [ ] Backups verified restorable
- [ ] Monitoring + alerting active
- [ ] Deployment runbook written
- [ ] Sign-off: "Ready to deploy"

### From Antony (Product Owner)
- [ ] Feature completeness acceptable
- [ ] UI/UX meets expectations
- [ ] Splose integration works correctly
- [ ] Performance acceptable for daily use
- [ ] Sign-off: "Ready to launch"

### From Ann (Therapist/End User)
- [ ] Training completed
- [ ] Confident using app
- [ ] Ready for daily use
- [ ] Sign-off: "Let's go live"

---

**BUILD WITH CONFIDENCE. THIS SCHEDULE IS REAL.** 🚀

