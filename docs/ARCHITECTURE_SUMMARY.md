# Architecture Summary — One-Page Overview

**Build Timeline:** 3 weeks (May 10–31, 2026)  
**Total Effort:** 219 hours (~5.5 weeks of focused development)  
**Team:** 1 Backend Dev + 1 Frontend Dev + 1 QA (ideal) or solo with longer timeline

---

## What You're Building

**A unified web application for Ann (therapist) at Opal Therapy to:**
1. Smart-schedule appointments (regional clustering, busy-day alternation)
2. Track therapy sessions (read from Splose, write back)
3. Auto-log travel distances (Google Maps)
4. Detect dormant cases (6+ weeks, daily alerts)
5. Track credentials (AHPRA, licenses, insurance, expiry alerts)
6. Suggest case notes (10–15 min blocks post-session)
7. Monitor flights (Phase 2, mid-June)

**Single practitioner (Ann), one location (Willetton WA, Perth metro), Australian compliance (Sydney data center).**

---

## Three-Week Breakdown

### Week 1: Foundation (77 hours)
```
Day 1–2: Setup + Database
  Node.js + Express
  PostgreSQL (docker-compose)
  Auth middleware + JWT
  5 database tables created

Day 2–4: Splose API Integration
  SploseClient class (GET/POST/PUT)
  30-min caching layer
  Error handling + rate limiting
  Fetch real appointments from Splose

Day 4–5: Calendar UI
  Week view (Mon-Fri, 8am–6pm)
  Color-coded session blocks
  Navigation (prev/next week)
  Real-time updates from Splose

Day 5–7: Smart Scheduler Algorithm
  Compute free slots (14-day horizon)
  Score by: regional clustering (+40), busy-day alternation (+20), time preference (+10), capacity check (+30)
  Return top 3 options
  Integration test with mock data

✅ OUTCOME: Calendar shows real appointments, smart scheduler suggests 3 realistic slots
```

### Week 2: Features (89.5 hours)
```
Day 1–2: Travel Logbook
  Google Maps Distance Matrix API
  Auto-log KMs on appointment creation
  Manual entry UI (for past appointments)
  Annual PDF report (ATO cents-per-km compliant)
  CSV export for accountant

Day 2–3: Dormant Case Detection
  Detect cases > 6 weeks inactive
  Daily 06:00 AWST scheduler task
  SendGrid email to Antony + Ann
  Dashboard widget with quick-schedule links

Day 3–4: Credentials Tracking
  Add/edit/delete credentials (AHPRA, insurance, etc.)
  Daily expiry check (06:00 AWST)
  Color-coded status (green/yellow/red)
  Warning emails 30 days before + on expiry
  Block scheduling if critical credential expired

Day 4–5: Case Note Suggestions
  Auto-suggest 10–15 min block after session
  Three scheduling options: auto (finds gap), manual (user picks), to-do (flexible list)
  Store in local DB + Splose busy-time (decision pending from Ann)

Day 5–7: Integration Testing
  End-to-end flow: login → schedule → travel log → view reports
  Splose API error handling
  Edge cases (zero slots, capacity exceeded)
  Performance benchmarking (scheduler < 2 sec)
  Mobile/tablet responsive design

✅ OUTCOME: All 4 features working with real Splose data, zero unhandled errors, docs complete
```

### Week 3: Production (52.5 hours)
```
Day 1–2: Security Hardening
  Rate limiting (login)
  CORS + CSRF protection
  Input sanitization (prevent SQL injection + XSS)
  Encrypt sensitive data (Splose API key)
  Error tracking (Sentry)

Day 2–3: Deployment Infrastructure
  Choose hosting: AWS Sydney or Azure Australia East
  Create production PostgreSQL database
  Build Docker image
  Set up CI/CD (GitHub Actions: test → build → deploy)
  Configure domain + SSL certificate
  Automated backups (daily, 30-day retention)

Day 3–4: Documentation & User Training
  Write user guides (Ann: login, scheduler, reports)
  Write admin guide (Antony: dashboard, settings, alerts)
  Write deployment guide (for DevOps team)
  API documentation (all 15+ endpoints)
  30-min training session with Ann
  1-hour dry run with Antony (real data)

Day 4–5: UAT & Launch
  Antony uses app 1 day (UAT checklist)
  Fix bugs found during UAT
  Staging verification (= production config)
  Deploy to production
  Sanity test (login → schedule → create appointment)
  Monitor errors (first 2 hours)

Day 5–7: Post-Launch Ops
  Verify 06:00 AWST dormant case email
  Monitor Splose API rate limit
  Monitor email delivery
  Collect feedback from Ann + Antony
  Document Phase 2 roadmap (flight tracking)

✅ OUTCOME: App live in production, stable 24+ hours, all systems monitored, Phase 2 planned
```

---

## Technology Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend | Node.js + Express | JavaScript across stack, good async support, easy to iterate |
| Database | PostgreSQL 14+ | JSONB for Splose cache, strong ACID guarantees, Sydney hosting available |
| Frontend | React + Vite | Component reusability, fast dev experience, modern tooling |
| Maps | Google Maps API | Distance Matrix accurate, integrates cleanly with travel logging |
| Email | SendGrid | Reliable delivery, good Australian coverage, webhook support for monitoring |
| SMS (optional) | Twilio | Australian number support, pay-as-you-go |
| Auth | JWT (stateless) | Simple, scalable, suitable for single practitioner |
| Hosting | AWS (Sydney) or Azure (Australia East) | Compliance + data residency, 24/7 support |
| Monitoring | Sentry + CloudWatch | Error tracking, performance insights, alerting |

---

## Database Schema (5 Tables)

```sql
users              -- Ann (single therapist v1)
├─ id, email, splose_practitioner_id, timezone, notification_email
├─ sms_number, preferred_reminder_channel

travel_logs        -- Auto-tracked KMs
├─ date, start_location, end_location, kms, client_id, case_id, appointment_id
├─ Index: date, user_id (query last month quickly)

credentials        -- AHPRA, licenses, insurance
├─ name, type (professional_registration | insurance | background_check)
├─ expiry_date, status (valid | expires_soon | expired)
├─ is_blocking (if true, prevents scheduling when expired)
├─ Index: user_id, expiry_date (daily expiry check)

dormant_case_alerts -- Track detections + emails sent
├─ case_id, last_activity_date, weeks_dormant
├─ alert_sent, alert_sent_at
├─ Unique: (user_id, case_id, DATE(created_at))

case_notes         -- Post-session note tracking
├─ appointment_id, client_id, case_id
├─ suggested_at, scheduled_at, note_time_minutes
├─ busy_time_id (link to Splose), is_completed

scheduler_preferences -- User settings (v1: single user, v2: per-user)
├─ enable_regional_clustering, enable_busy_day_alternation
├─ max_clients_per_day, start_time, end_time
├─ enable_travel_reminders, enable_dormant_case_alerts, etc.

splose_cache       -- Cache Splose API responses (minimize calls)
├─ resource_type (appointments | patients | cases)
├─ resource_id, data (JSONB), cached_at, expires_at
├─ Index: resource_type, resource_id, expires_at
```

---

## API Endpoints (15 Routes)

### Authentication
- `POST /api/auth/login` → JWT token
- `POST /api/auth/logout` → invalidate session
- `GET /api/auth/me` → current user + preferences

### Appointments
- `GET /api/appointments?week=YYYY-W##` → week view
- `POST /api/appointments/suggest` → smart scheduler (3 options)
- `POST /api/appointments` → create (writes to Splose)
- `PUT /api/appointments/:id` → reschedule
- `GET /api/appointments/:id` → details

### Travel
- `GET /api/travel/logs` → all travel entries
- `POST /api/travel/logs` → manual entry
- `POST /api/travel/calculate-distance` → Google Maps call
- `GET /api/travel/reports/annual` → PDF download
- `GET /api/travel/reports/csv` → CSV download

### Credentials
- `GET /api/credentials` → all credentials
- `POST /api/credentials` → add new
- `PUT /api/credentials/:id` → update expiry/status
- `DELETE /api/credentials/:id` → remove

### Dormant Cases
- `GET /api/dormant-cases` → all detected
- `POST /api/dormant-cases/check` → manual trigger
- `PUT /api/dormant-cases/:case_id/acknowledge` → mark as reviewed

### Case Notes
- `GET /api/case-notes/suggestions` → pending suggestions
- `POST /api/case-notes/:id/schedule` → user schedules note
- `PUT /api/case-notes/:id/complete` → mark done

### Flights (Phase 2)
- `GET /api/flights` → all tracked
- `POST /api/flights` → add PNR
- `GET /api/flights/:id/status` → real-time delay

### Settings
- `GET /api/settings` → user + preferences
- `PUT /api/settings` → update preferences

---

## Scheduler Algorithm (The Brain)

```javascript
async function suggestSlots(clientId, caseId, duration, constraints) {
  // 1. Get free slots (14-day window)
  const availability = await fetchUserAvailability();
  const appointments = await fetchAppointments(14);
  const busyTimes = await fetchBusyTimes(14);
  const freeSlots = computeFreeSlots(availability - appointments - busyTimes);

  // 2. Score each slot
  const scored = freeSlots.map(slot => {
    const score = 0
      + (sameSuburbAsOtherClientsOnDay ? 40 : 0)
      + (followsLighterDay ? 20 : 0)
      + (morningPreference ? 10 : 0)
      + (caseHasCapacity ? 30 : 0);
    return {slot, score, reasons: [...]};
  });

  // 3. Return top 3
  return scored.sort((a,b) => b.score - a.score).slice(0, 3);
}
```

**Weights:** Clustering (40) + Alternation (20) + Time (10) + Capacity (30) = max 100  
**Output:** 3 options ranked 95 / 78 / 62 (example scores)

---

## Scheduled Tasks (Run Automatically)

| Task | Frequency | Time (AWST) | Action |
|------|-----------|------------|--------|
| Dormant case detection | Daily | 06:00 | Find 6+ week inactive cases → email Antony |
| Credential expiry check | Daily | 06:00 | Email warnings 30 days before + on expiry day |
| Client reminders | Hourly | 24h before appt | SMS/email to clients (if enabled) |
| Flight delay monitoring | Every 30 min | Real-time | Check FlightAware API (Phase 2) |

---

## Security Checklist

- [ ] SSL/TLS only (HTTPS)
- [ ] JWT token rotation (24-hour expiry)
- [ ] Rate limiting (5 login attempts / 15 min)
- [ ] CORS (opalstherapy.com.au only)
- [ ] CSRF tokens on all forms
- [ ] Input sanitization (prevent SQL injection + XSS)
- [ ] Sensitive data encrypted in DB
- [ ] Error tracking + alerting (Sentry)
- [ ] No passwords in logs
- [ ] Request logging (audit trail)

---

## Deployment (One Command)

### Development
```bash
git clone <repo>
cd scheduler
npm install
docker-compose up -d postgres
npm run migrate:latest
npm run seed
npm run dev  # Backend on 3000
cd frontend && npm run dev  # Frontend on 5173
```

### Production (AWS)
```bash
docker build -t opal-scheduler:latest .
aws ecr push ...
aws ecs update-service --cluster opal-prod
```

### Production (Azure)
```bash
az acr build --registry opal-therapy-acr --image scheduler:latest .
az webapp config container set ...
```

---

## Decision Points (Decide by May 13)

### From Ann
1. **Case notes storage:** Admin busy-time-type (#55339) OR new dedicated type?
2. **Credential alert lead time:** 30 days standard OR custom?
3. **Blocking credentials:** Which prevent scheduling if expired? (AHPRA? All?)

### From Antony
1. **SMS for reminders:** Yes (Twilio) OR email-only OR skip v1?
2. **Credentials storage:** Local PostgreSQL OR Splose profile?
3. **Flight API (Phase 2):** FlightAware OR Sabre OR AviationEdge?

**Impact:** Non-decision = default (Admin type, email-only, local storage, FlightAware)

---

## Success Metrics (By May 31)

| Metric | Target | How to Verify |
|--------|--------|---------------|
| Uptime | 99.5% | CloudWatch dashboard |
| Page load | < 3 sec | Lighthouse audit |
| Scheduler accuracy | 95% realistic slots | Manual review of suggestions |
| Dormant case detection | 100% (6 AM AWST) | Email log |
| Travel auto-logging | 100% (all new appointments) | Database count |
| Zero unhandled errors | 100% | Sentry dashboard (0 errors) |
| User training | 100% (Ann + Antony confident) | Sign-off from both |

---

## Phase 2 & Beyond (June onwards)

### Phase 2: Flight Tracking (Mid-June, 11–14 days)
- Real-time flight monitoring (FlightAware API)
- Auto-calendar blocks for delays
- PNR auto-fetch via email
- Cascade reschedule if flight delayed

### Phase 3: Advanced (July+)
- Multi-practitioner support
- Client-facing booking portal
- Microsoft Teams integration
- BI dashboards (utilization, revenue, etc.)

---

## Key Files Created

| File | Purpose |
|------|---------|
| `PRODUCTION_ARCHITECTURE.md` | Full 500+ line blueprint (schema, endpoints, services) |
| `QUICK_START_GUIDE.md` | Week-by-week checklist + decisions needed |
| `IMPLEMENTATION_MATRIX.md` | Task breakdown (219 hours, dependencies, owners) |
| `ARCHITECTURE_SUMMARY.md` | This file (one-page overview) |

---

## Next Steps (Start Today)

1. **Read:** QUICK_START_GUIDE.md (10 min)
2. **Decide:** Answer decision points above (30 min)
3. **Plan:** Review IMPLEMENTATION_MATRIX.md with team (1 hour)
4. **Build:** Start Week 1 Day 1 tasks (setup + database)
5. **Track:** Use IMPLEMENTATION_MATRIX.md as Gantt chart

---

## Support

- **Architecture questions:** Read PRODUCTION_ARCHITECTURE.md
- **Week-by-week questions:** Read QUICK_START_GUIDE.md
- **Task breakdown questions:** Read IMPLEMENTATION_MATRIX.md
- **API questions:** Read API.md (to be created Week 2)
- **Deployment questions:** Read DEPLOYMENT.md (to be created Week 3)

---

**YOU'VE GOT THIS. Three weeks, one unified app, seven features, production-ready by May 31.** 🚀

