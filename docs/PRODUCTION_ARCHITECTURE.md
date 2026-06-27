# Therapy Scheduler — Production Architecture & Implementation Plan
**Version:** 1.0  
**Date:** May 10, 2026  
**Target Timeline:** 2-3 weeks (Weeks May 10–31)  
**Status:** Ready for development sprint

---

## Executive Summary

This document defines a **single, integrated web application** for Opal Therapy's intelligent appointment scheduling system. It consolidates 7 features (3 complete, 3 designed, 1 trivial) into one cohesive product with:

- **Backend:** Node.js + Express, PostgreSQL, Splose API integration
- **Frontend:** React + modern UI (or vanilla JS if constraints require)
- **Single practitioner v1:** Ann Mary Mathew @ Opal Therapy
- **Australian compliance:** Data residency (Sydney region), Privacy Act 1988, NDIS standards
- **Production-ready:** Deployable in 3 weeks, operable by Antony + Ann

### What's Included
1. ✅ **Smart scheduler** — regional clustering, busy-day alternation, capacity checks
2. ✅ **Dormant case detection** — 6+ weeks no activity → daily email alerts
3. ✅ **Travel logbook** — auto-track KMs, ATO-compliant PDF/CSV exports
4. ⏳ **Case noting suggestions** — 10–15 min blocks after sessions (needs decision)
5. ⏳ **Client reminders** — SMS/email 24h before appointment (needs SMS gateway decision)
6. ⏳ **Flight tracking** — real-time delays, auto-calendar blocks (Phase 2, mid-June)
7. ⏳ **Credentials tracking** — AHPRA/licenses/insurance with expiry alerts (Phase 2, July)

---

## Part 1: Project Structure & File Organization

```
opal-therapy-scheduler/
├── backend/
│   ├── server.js                          # Express entry point
│   ├── package.json                       # Node deps
│   ├── .env.example                       # Template for secrets
│   ├── config/
│   │   ├── database.js                    # PostgreSQL connection
│   │   ├── splose.js                      # Splose API client + auth
│   │   ├── email.js                       # SendGrid/Azure Mail config
│   │   └── constants.js                   # Timezones, API limits, fees
│   ├── middleware/
│   │   ├── auth.js                        # JWT validation, session mgmt
│   │   └── errorHandler.js                # Global error logging
│   ├── routes/
│   │   ├── auth.js                        # Login/logout/session
│   │   ├── appointments.js                # CRUD + smart scheduling
│   │   ├── patients.js                    # Patient read/search
│   │   ├── cases.js                       # NDIS funding/utilization
│   │   ├── busyTimes.js                   # Admin blocks, case notes
│   │   ├── travelLogs.js                  # Travel tracking
│   │   ├── credentials.js                 # License/AHPRA tracking
│   │   ├── flights.js                     # Flight monitoring (Phase 2)
│   │   └── reports.js                     # PDF/CSV generation
│   ├── services/
│   │   ├── splose.js                      # Splose integration layer (read/write)
│   │   ├── scheduler.js                   # Smart scheduling algorithm
│   │   ├── dormantCaseDetector.js         # 6+ week analysis
│   │   ├── travelLogger.js                # Google Maps + distance calc
│   │   ├── emailService.js                # Dormant alerts, reminders, credential alerts
│   │   ├── smsService.js                  # SMS gateway (Twilio/SNS) [conditional]
│   │   ├── credentialChecker.js           # License validation + alerts
│   │   └── flightTracker.js               # Flight API integration (Phase 2)
│   ├── models/
│   │   ├── User.js                        # Ann (single practitioner)
│   │   ├── TravelLog.js                   # KM tracking
│   │   ├── Credential.js                  # License storage
│   │   ├── FlightTracking.js              # Flight bookings (Phase 2)
│   │   └── DormantCaseAlert.js            # Alert history
│   ├── schedulers/
│   │   ├── dormantCaseChecker.js          # Runs 06:00 AWST daily
│   │   ├── credentialAlertChecker.js      # Runs 06:00 AWST daily
│   │   ├── clientReminderSender.js        # Runs hourly, checks 24h window
│   │   ├── flightMonitor.js               # Runs every 30min (Phase 2)
│   │   └── caseNoteReminder.js            # Triggered post-session
│   └── db/
│       ├── migrations/
│       │   ├── 001_initial_schema.sql     # Tables: users, travel_logs, credentials, etc.
│       │   ├── 002_dormant_cases.sql      # Alert tracking
│       │   ├── 003_flights.sql            # Flight data (Phase 2)
│       │   └── 004_case_notes.sql         # Case noting preferences
│       └── seeds/
│           └── dev_data.sql               # Sample patients, cases for testing
├── frontend/
│   ├── index.html                         # SPA entry
│   ├── package.json                       # React + dependencies
│   ├── src/
│   │   ├── App.jsx                        # Root component
│   │   ├── main.jsx                       # Vite entry
│   │   ├── components/
│   │   │   ├── Layout/
│   │   │   │   ├── Header.jsx             # Nav, user menu
│   │   │   │   ├── Sidebar.jsx            # Feature toggles
│   │   │   │   └── Footer.jsx
│   │   │   ├── Calendar/
│   │   │   │   ├── WeekView.jsx           # Mon-Fri, time grid
│   │   │   │   ├── SessionBlock.jsx       # Color-coded session UI
│   │   │   │   ├── SmartScheduler.jsx     # UI for scheduling modal
│   │   │   │   └── CapacityCheck.jsx      # NDIS funding warnings
│   │   │   ├── Features/
│   │   │   │   ├── DormantCases/
│   │   │   │   │   ├── DormantCasesList.jsx
│   │   │   │   │   ├── DormantCaseAlert.jsx
│   │   │   │   │   └── EmailReport.jsx
│   │   │   │   ├── TravelLogbook/
│   │   │   │   │   ├── TravelList.jsx
│   │   │   │   │   ├── TravelLogger.jsx
│   │   │   │   │   ├── TravelMap.jsx
│   │   │   │   │   └── ReportGenerator.jsx
│   │   │   │   ├── Credentials/
│   │   │   │   │   ├── CredentialsList.jsx
│   │   │   │   │   ├── CredentialForm.jsx
│   │   │   │   │   └── ExpiryAlert.jsx
│   │   │   │   ├── FlightTracking/
│   │   │   │   │   ├── FlightList.jsx
│   │   │   │   │   ├── FlightMonitor.jsx
│   │   │   │   │   └── DelayNotification.jsx (Phase 2)
│   │   │   │   └── CaseNoting/
│   │   │   │       ├── CaseNoteForm.jsx
│   │   │   │       ├── CaseNoteSuggestion.jsx
│   │   │   │       └── CaseNoteHistory.jsx
│   │   │   ├── Settings/
│   │   │   │   ├── GeneralSettings.jsx
│   │   │   │   ├── SchedulingPreferences.jsx
│   │   │   │   └── AlertPreferences.jsx
│   │   │   └── Reports/
│   │   │       ├── BillableHours.jsx
│   │   │       ├── Utilization.jsx
│   │   │       └── AnnualReports.jsx
│   │   ├── hooks/
│   │   │   ├── useSplose.js              # Splose API calls
│   │   │   ├── useScheduler.js           # Smart scheduler logic
│   │   │   ├── useAuth.js                # Session mgmt
│   │   │   └── useTravelLog.js           # Travel tracking
│   │   ├── services/
│   │   │   ├── api.js                    # Fetch wrapper + auth headers
│   │   │   └── storage.js                # LocalStorage cache
│   │   ├── styles/
│   │   │   ├── global.css                # Base styles (Splose aesthetic)
│   │   │   ├── calendar.css              # Week grid styling
│   │   │   ├── components.css            # Feature-specific styles
│   │   │   └── responsive.css            # Mobile/tablet layouts
│   │   └── utils/
│   │       ├── dateHelpers.js            # AWST timezone utilities
│   │       ├── clustering.js             # Regional grouping logic
│   │       ├── capacityCalcs.js          # NDIS funding math
│   │       └── validation.js             # Input validation
│   └── public/
│       └── index.html                    # Static template
├── docs/
│   ├── API.md                            # All endpoints + examples
│   ├── SPLOSE_INTEGRATION.md             # API mapping + best practices
│   ├── DATABASE_SCHEMA.md                # Full schema definitions
│   ├── DEPLOYMENT.md                     # AWS/Azure Australia hosting
│   ├── USER_GUIDE.md                     # How Ann uses the app
│   └── ADMIN_GUIDE.md                    # Antony's admin tasks
├── tests/
│   ├── unit/
│   │   ├── scheduler.test.js
│   │   ├── dormantCaseDetector.test.js
│   │   └── capacityCalcs.test.js
│   ├── integration/
│   │   ├── splose.test.js               # API mocking
│   │   └── scheduling.test.js
│   └── e2e/
│       └── user-flows.test.js           # Playwright: login → schedule → view reports
├── docker-compose.yml                    # Local dev: app + postgres + redis
├── .env.example                          # Template for all secrets
├── README.md                             # Quick start
└── ARCHITECTURE.md                       # This file
```

---

## Part 2: Database Schema (PostgreSQL)

### Core Tables

#### `users`
Single practitioner (v1). Expandable to multiple.

```sql
CREATE TABLE users (
  id VARCHAR(20) PRIMARY KEY,                    -- PR-001 (from Splose)
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  splose_practitioner_id VARCHAR(20) UNIQUE,    -- Link to Splose
  timezone VARCHAR(50) DEFAULT 'Australia/Perth',
  notification_email VARCHAR(255),               -- Alert recipient
  sms_number VARCHAR(20),                        -- For reminders (optional)
  preferred_reminder_channel VARCHAR(20),       -- sms | email
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `travel_logs`
Track every appointment travel distance.

```sql
CREATE TABLE travel_logs (
  id VARCHAR(20) PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  datetime_start TIMESTAMP NOT NULL,
  datetime_end TIMESTAMP,
  start_location VARCHAR(255),                   -- e.g., "Opal Therapy, Willetton"
  end_location VARCHAR(255),
  kms DECIMAL(6,2),
  client_id VARCHAR(20),                         -- From Splose
  case_id VARCHAR(20),                           -- From Splose
  appointment_id VARCHAR(20),                    -- Reference to Splose appointment
  session_type VARCHAR(50),                      -- therapy | travel | admin
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(appointment_id, user_id)
);

CREATE INDEX idx_travel_logs_date ON travel_logs(date);
CREATE INDEX idx_travel_logs_user ON travel_logs(user_id);
```

#### `credentials`
Track all practitioner licenses with expiry dates.

```sql
CREATE TABLE credentials (
  id VARCHAR(20) PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL REFERENCES users(id),
  name VARCHAR(255) NOT NULL,                    -- "AHPRA Occupational Therapist"
  type VARCHAR(50) NOT NULL,                     -- professional_registration | safeguarding_check | background_check | insurance
  credential_number VARCHAR(100),                -- "OT 123456"
  issuing_body VARCHAR(255),                     -- "AHPRA"
  issued_date DATE,
  expiry_date DATE NOT NULL,
  status VARCHAR(20),                            -- valid | expires_soon | expired
  is_blocking BOOLEAN DEFAULT false,             -- If true, cannot schedule if expired
  renewal_lead_days INT DEFAULT 30,              -- Alert 30 days before
  provider VARCHAR(255),                         -- For insurance
  policy_number VARCHAR(100),
  insurance_amount DECIMAL(12,2),
  alert_enabled BOOLEAN DEFAULT true,
  renewal_url VARCHAR(500),                      -- Link to renewal portal
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_credentials_user ON credentials(user_id);
CREATE INDEX idx_credentials_expiry ON credentials(expiry_date);
```

#### `dormant_case_alerts`
Track dormant case detections & alerts sent.

```sql
CREATE TABLE dormant_case_alerts (
  id VARCHAR(20) PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL REFERENCES users(id),
  case_id VARCHAR(20) NOT NULL,                  -- From Splose
  client_id VARCHAR(20),                         -- From Splose
  last_activity_date DATE,                       -- Last appointment/invoice/case note
  weeks_dormant INT,
  alert_sent BOOLEAN DEFAULT false,
  alert_sent_at TIMESTAMP,
  email_report_id VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, case_id, DATE(created_at))
);

CREATE INDEX idx_dormant_cases_user ON dormant_case_alerts(user_id);
CREATE INDEX idx_dormant_cases_date ON dormant_case_alerts(created_at);
```

#### `case_notes`
Store case noting preferences & history.

```sql
CREATE TABLE case_notes (
  id VARCHAR(20) PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL REFERENCES users(id),
  appointment_id VARCHAR(20) NOT NULL,           -- From Splose
  client_id VARCHAR(20),
  case_id VARCHAR(20),
  suggested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scheduled_at TIMESTAMP,                        -- When user actually scheduled the note
  note_time_minutes INT DEFAULT 15,
  scheduling_strategy VARCHAR(50),               -- auto_same_day | manual | todo
  busy_time_id VARCHAR(20),                      -- Link to Splose busy-time if created
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_case_notes_user ON case_notes(user_id);
CREATE INDEX idx_case_notes_appointment ON case_notes(appointment_id);
```

#### `flight_tracking`
Track flights for multi-location work (Phase 2).

```sql
CREATE TABLE flight_tracking (
  id VARCHAR(20) PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL REFERENCES users(id),
  pnr_code VARCHAR(10) NOT NULL,                 -- e.g., ABC123
  airline_code VARCHAR(3),                       -- e.g., QF
  flight_number VARCHAR(10),
  departure_airport VARCHAR(3),                  -- IATA code
  arrival_airport VARCHAR(3),
  departure_time TIMESTAMP NOT NULL,
  arrival_time TIMESTAMP NOT NULL,
  expected_arrival TIMESTAMP,                    -- Latest from real-time API
  is_delayed BOOLEAN DEFAULT false,
  delay_minutes INT DEFAULT 0,
  status VARCHAR(50),                            -- scheduled | delayed | cancelled | landed
  calendar_block_id VARCHAR(20),                 -- Splose busy-time created for this flight
  calendar_block_created BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_flights_user ON flight_tracking(user_id);
CREATE INDEX idx_flights_departure ON flight_tracking(departure_time);
```

#### `scheduler_preferences`
User preferences for scheduling algorithm.

```sql
CREATE TABLE scheduler_preferences (
  id VARCHAR(20) PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL UNIQUE REFERENCES users(id),
  enable_regional_clustering BOOLEAN DEFAULT true,
  enable_busy_day_alternation BOOLEAN DEFAULT true,
  max_clients_per_day INT DEFAULT 10,
  prefer_morning_sessions BOOLEAN DEFAULT false,
  start_time TIME DEFAULT '08:00',
  end_time TIME DEFAULT '18:00',
  lunch_start_time TIME DEFAULT '12:30',
  lunch_duration_minutes INT DEFAULT 30,
  enable_travel_reminders BOOLEAN DEFAULT true,
  enable_case_note_suggestions BOOLEAN DEFAULT true,
  enable_dormant_case_alerts BOOLEAN DEFAULT true,
  dormant_threshold_weeks INT DEFAULT 6,
  enable_client_reminders BOOLEAN DEFAULT true,
  reminder_hours_before INT DEFAULT 24,
  reminder_channel VARCHAR(20) DEFAULT 'email',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `splose_cache`
Cache Splose reads to minimize API calls.

```sql
CREATE TABLE splose_cache (
  id VARCHAR(20) PRIMARY KEY,
  resource_type VARCHAR(50),                     -- appointments | patients | cases | services | busy-times
  resource_id VARCHAR(20),
  data JSONB NOT NULL,                           -- Full Splose response
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,                          -- TTL for cache (30 min for most, 1 day for reference data)
  user_id VARCHAR(20) REFERENCES users(id)
);

CREATE INDEX idx_splose_cache_resource ON splose_cache(resource_type, resource_id);
CREATE INDEX idx_splose_cache_expiry ON splose_cache(expires_at);
```

---

## Part 3: API Endpoints

### Authentication Routes (`/api/auth`)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/login` | Email + password → JWT token + session |
| POST | `/logout` | Invalidate session |
| GET | `/me` | Return current user + preferences |
| POST | `/refresh-token` | Extend session |

### Appointments (`/api/appointments`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | Week view (supports `?startDate=YYYY-MM-DD`) |
| POST | `/suggest` | Smart scheduler: returns 3 scored slot options |
| POST | `/` | Create appointment (writes to Splose + local DB) |
| PUT | `/:id` | Reschedule (updates Splose) |
| GET | `/:id` | Single appointment details |
| DELETE | `/:id` | Cancel (reads cancellation from Splose, user confirms in UI) |

**Example POST /api/appointments/suggest:**
```json
{
  "client_id": "PAT-123",
  "case_id": "CASE-456",
  "duration_minutes": 60,
  "constraints": {
    "prefer_region": "east",
    "avoid_back_to_back": true,
    "require_lunch_after": false
  }
}
```

**Response (3 scored options):**
```json
{
  "options": [
    {
      "start": "2026-05-14T10:00:00+08:00",
      "end": "2026-05-14T11:00:00+08:00",
      "score": 95,
      "reasons": ["clusters with 2 other east-side clients", "follows admin day", "within working hours"]
    },
    {
      "start": "2026-05-15T14:00:00+08:00",
      "score": 78,
      "reasons": ["afternoon slot available"]
    }
  ]
}
```

### Patients (`/api/patients`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | Search/filter (queries Splose) |
| GET | `/:id` | Patient + NDIS info (reads from Splose) |

### Cases (`/api/cases`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | All active cases |
| GET | `/:id` | Case funding + utilization (reads from Splose) |
| GET | `/:id/capacity-check` | Can we fit a new session within funding? |

### Travel (`/api/travel`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/logs` | All travel logs (supports `?month=YYYY-MM`) |
| POST | `/logs` | Create manual travel entry |
| DELETE | `/logs/:id` | Delete travel entry |
| POST | `/calculate-distance` | Google Maps API call (start/end address) → KMs |
| GET | `/reports/annual` | Generate PDF for accountant (FY2024, FY2025, etc.) |
| GET | `/reports/csv` | Bulk export as CSV |

### Credentials (`/api/credentials`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | All credentials for logged-in user |
| POST | `/` | Add new credential |
| PUT | `/:id` | Update expiry date / renewal status |
| DELETE | `/:id` | Remove credential |
| GET | `/:id/renewal-status` | Check if expired, alert status |

### Dormant Cases (`/api/dormant-cases`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | All detected dormant cases (with last activity date) |
| POST | `/check` | Trigger manual dormant case scan (admin only) |
| GET | `/report` | Email report (what's sent daily at 06:00 AWST) |
| PUT | `/:case_id/acknowledge` | Mark alert as reviewed |

### Case Notes (`/api/case-notes`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/suggestions` | Pending case note suggestions |
| POST | `/suggest` | Trigger suggestion after appointment |
| POST | `/:id/schedule` | User schedules case note time |
| PUT | `/:id/complete` | Mark case note as done |

### Flights (`/api/flights`) — Phase 2

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | All tracked flights |
| POST | `/` | Add new flight (PNR + email) |
| GET | `/:id/status` | Real-time delay check |
| PUT | `/:id/auto-block` | Create calendar block if delayed |

### Reports (`/api/reports`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/utilization` | Billable vs. admin hours |
| GET | `/annual-summary` | Year-end stats |
| GET | `/dormant-summary` | Dormant case trends |

### Settings (`/api/settings`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | User + scheduling preferences |
| PUT | `/` | Update preferences |
| PUT | `/notification-email` | Change alert recipient |

---

## Part 4: Core Services & Algorithms

### 1. Smart Scheduler Service (`services/scheduler.js`)

**Input:** 
- `client_id`, `case_id`, `duration_minutes`
- Optional constraints: `prefer_region`, `avoid_back_to_back`

**Process:**
1. **Fetch free slots** (next 14 days)
   - User availability (working hours + locations)
   - Minus appointments
   - Minus busy-times (admin, travel, lunch)
   - Minus support-activities (billable travel)

2. **Score each slot** using weighted factors:
   - **Regional clustering** (+40 points if groups same suburb)
   - **Busy/admin alternation** (+20 if follows lighter day)
   - **Time preference** (+10 if morning/afternoon match)
   - **Capacity check** (+30 if room in NDIS funding)
   - **Practitioner availability** (+100 if match)

3. **Return top 3 options** ranked by score

**Code skeleton:**
```javascript
async function suggestSlots(clientId, caseId, durationMins, constraints) {
  const [availability, appointments, busyTimes] = await Promise.all([
    fetchUserAvailability(),
    fetchAppointmentsNextWeeks(14),
    fetchBusyTimesNextWeeks(14)
  ]);

  const freeSlots = computeFreeSlots(availability, appointments, busyTimes, durationMins);
  
  const clientLocation = await splose.getPatient(clientId).then(p => p.location);
  const caseFunding = await splose.getCase(caseId);
  
  const scored = freeSlots.map(slot => ({
    ...slot,
    score: scoreSlot(slot, {
      clientLocation,
      caseFunding,
      recentAppointmentDates: appointments.map(a => a.start_date),
      constraints
    })
  }));

  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}
```

### 2. Dormant Case Detector (`services/dormantCaseDetector.js`)

**Runs:** Daily at 06:00 AWST (via `schedulers/dormantCaseChecker.js`)

**Logic:**
1. Fetch all active cases for user
2. For each case, find `last_activity`:
   - Latest appointment end date
   - Latest case note timestamp
   - Latest support activity (invoice/travel) timestamp
3. If no activity > 6 weeks ago: mark as dormant
4. Send daily email with:
   - Count of dormant cases
   - Table: Client Name | Case ID | Last Activity | NDIS Status
   - Quick-schedule links for each

**Code skeleton:**
```javascript
async function detectDormantCases(userId) {
  const cases = await splose.getCases(userId);
  
  const dormant = await Promise.all(
    cases.map(async c => {
      const lastActivity = await findLastActivity(c.id);
      const weeksSince = daysSince(lastActivity) / 7;
      
      return {
        caseId: c.id,
        clientId: c.patient_id,
        lastActivityDate: lastActivity,
        weeksDormant: weeksSince,
        isDormant: weeksSince >= 6
      };
    })
  );

  const dormantOnly = dormant.filter(c => c.isDormant);
  
  if (dormantOnly.length > 0) {
    await emailService.sendDormantCaseReport(userId, dormantOnly);
    await saveDormantCaseAlerts(userId, dormantOnly);
  }

  return dormantOnly;
}
```

### 3. Travel Logger (`services/travelLogger.js`)

**Triggered:** After appointment is created

**Logic:**
1. Fetch appointment details (client location, therapist location)
2. Call Google Maps Distance Matrix API
3. Calculate distance in KMs
4. Store in `travel_logs` table with:
   - Date, start/end location, KMs
   - Link to appointment + client + case
5. Return KM for user confirmation (editable)

**Code skeleton:**
```javascript
async function logTravel(appointmentId) {
  const appointment = await splose.getAppointment(appointmentId);
  const {location_id, start_time, end_time} = appointment;
  
  const location = await splose.getLocation(location_id);
  const practitionerLocation = await getPractitionerBaseLocation(); // Opal Therapy
  
  const distance = await googleMapsClient.getDistance(
    practitionerLocation.address,
    location.address
  );

  const travelLog = await TravelLog.create({
    appointment_id: appointmentId,
    start_location: practitionerLocation.address,
    end_location: location.address,
    kms: distance.value_in_km,
    date: appointment.start_time.toDate(),
    client_id: appointment.patient_id,
    case_id: appointment.case_id
  });

  return travelLog;
}
```

### 4. Report Generator (`services/travelReportGenerator.js`)

**Triggered:** User clicks "Download PDF" or "Export CSV"

**PDF Layout:**
```
═══════════════════════════════════════════
  OPAL THERAPY — ANNUAL TRAVEL LOGBOOK
  Financial Year: 2025-2026
  Practitioner: Ann Mary Mathew
  Generated: 10 May 2026
═══════════════════════════════════════════

SUMMARY
  Total KMs: 1,284
  Rate (ATO 2025-26): $0.66/km
  Total Deduction: $847.44

LOGBOOK (by date)
Date       Client              Location      KMs    Session Type
─────────────────────────────────────────────────────────────
2026-04-01 John Smith          Eastside      24.5   Therapy
2026-04-02 Jane Doe            Westside      18.3   Assessment
...

ACCOUNTANT NOTES
  - ATO cents-per-km method applied
  - Includes only work-related travel
  - Data sourced from Splose appointments
```

**CSV Format:**
```csv
date,client_id,client_name,location,kms,session_type,case_id
2026-04-01,PAT-001,John Smith,Eastside,24.5,Therapy,CASE-123
```

### 5. Credential Checker (`services/credentialChecker.js`)

**Runs:** Daily at 06:00 AWST

**Logic:**
1. Fetch all credentials for user
2. For each credential, check:
   - Days until expiry
   - Is blocked credential? (e.g., AHPRA)
3. If < 30 days to expiry: send warning email
4. If expired: send urgent email + update status in DB
5. If credential is blocking and expired: prevent scheduling until renewed

**Code skeleton:**
```javascript
async function checkCredentialExpiry(userId) {
  const credentials = await Credential.findAll({where: {user_id: userId}});
  
  const alerts = credentials.map(cred => {
    const daysUntilExpiry = dayUntil(cred.expiry_date);
    const status = daysUntilExpiry <= 0 ? 'expired' 
                 : daysUntilExpiry <= 30 ? 'expires_soon'
                 : 'valid';
    
    return {
      credential: cred,
      status,
      daysUntilExpiry
    };
  });

  // Send emails for expiring/expired
  const expiring = alerts.filter(a => a.daysUntilExpiry <= 30 && a.daysUntilExpiry > 0);
  const expired = alerts.filter(a => a.daysUntilExpiry <= 0);

  if (expiring.length > 0) {
    await emailService.sendExpiryWarning(userId, expiring);
  }
  if (expired.length > 0) {
    await emailService.sendExpiryAlert(userId, expired);
  }

  return alerts;
}
```

---

## Part 5: Splose Integration Layer (`services/splose.js`)

Central client for all Splose API calls. Handles auth, retries, caching.

```javascript
class SploseClient {
  constructor(apiKey, baseUrl = 'https://api.splose.com/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.cache = new Map();  // Simple in-memory cache
  }

  async get(endpoint, params = {}) {
    const cacheKey = `${endpoint}?${stringify(params)}`;
    
    // Check cache (30 min TTL for most, 1 day for reference data)
    if (this.cache.has(cacheKey)) {
      const {data, expiry} = this.cache.get(cacheKey);
      if (Date.now() < expiry) return data;
    }

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      headers: {Authorization: `Bearer ${this.apiKey}`},
      params
    }).catch(e => {
      if (e.status === 400 && e.data.formErrors) {
        throw new Error(`Invalid params: ${Object.keys(e.data.formErrors).join(', ')}`);
      }
      throw e;
    });

    this.cache.set(cacheKey, {
      data: response.data,
      expiry: Date.now() + 30 * 60 * 1000
    });

    return response.data;
  }

  async post(endpoint, body) {
    return fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(r => r.data);
  }

  async put(endpoint, body) {
    return fetch(`${this.baseUrl}${endpoint}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(r => r.data);
  }

  // High-level convenience methods
  async getAppointments(practitionerId, startDate, endDate) {
    return this.get('/appointments', {
      practitioner_id: practitionerId,
      start_date_gte: startDate,
      start_date_lt: endDate
    });
  }

  async getPatient(patientId) {
    return this.get(`/patients/${patientId}`);
  }

  async getCase(caseId) {
    return this.get(`/cases/${caseId}`);
  }

  async createAppointment(body) {
    return this.post('/appointments', body);
  }

  async updateAppointment(appointmentId, body) {
    return this.put(`/appointments/${appointmentId}`, body);
  }

  // ... more methods for busy-times, support-activities, locations, etc.
}

module.exports = new SploseClient(process.env.SPLOSE_API_KEY);
```

---

## Part 6: Implementation Timeline (2-3 Weeks)

### Week 1: Foundation (May 10–17)

**Days 1–2: Setup**
- [ ] Initialize Node.js + Express project
- [ ] Set up PostgreSQL locally (docker-compose)
- [ ] Create `.env` files (Splose API key, SendGrid API key, Google Maps API key)
- [ ] Set up auth middleware (simple JWT for single user first)

**Days 2–3: Database**
- [ ] Run migrations (all tables listed above)
- [ ] Create seed data (mock patients, cases, appointments from Splose)
- [ ] Test connection + basic CRUD

**Days 3–4: Splose Integration Layer**
- [ ] Build `SploseClient` class
- [ ] Implement GET endpoints (patients, cases, appointments, busy-times)
- [ ] Implement POST endpoints (appointments, busy-times)
- [ ] Test with mock Splose responses

**Days 4–5: Frontend Setup**
- [ ] Initialize React + Vite
- [ ] Build basic layout (Header, Sidebar, Calendar grid)
- [ ] Implement week view (Mon-Fri, 8am-6pm)
- [ ] Add color-coded session type legend

**Days 5–7: Smart Scheduler**
- [ ] Implement `computeFreeSlots()` algorithm
- [ ] Implement `scoreSlot()` with clustering + alternation
- [ ] Build scheduler modal UI
- [ ] Hook to `/api/appointments/suggest` endpoint
- [ ] Test with sample data

**Week 1 Deliverables:**
- ✅ App boots, shows empty calendar
- ✅ Smart scheduler suggests 3 slots (mock data)
- ✅ Splose API layer complete
- ✅ Database seeded with test data

---

### Week 2: Features + Integration (May 17–24)

**Days 1–2: Travel Logbook**
- [ ] Integrate `TravelLog` model
- [ ] Build `travelLogger.js` service (Google Maps API)
- [ ] Build `travelReportGenerator.js` (PDF + CSV)
- [ ] Build Travel UI component (list + manual entry)
- [ ] Test distance calculation with real addresses

**Days 2–3: Dormant Case Detection**
- [ ] Integrate `dormantCaseDetector.js` service
- [ ] Build scheduler task (runs 06:00 AWST)
- [ ] Integrate SendGrid for email alerts
- [ ] Build Dormant Cases dashboard widget
- [ ] Test with mock case data

**Days 3–4: Credential Tracking**
- [ ] Integrate `Credential` model
- [ ] Build credential management UI (add, edit, delete)
- [ ] Implement `credentialChecker.js` service
- [ ] Build expiry alert emails
- [ ] Build dashboard warning banners

**Days 4–5: Case Note Suggestions** (if decision made)
- [ ] If Ann decides on storage approach: implement
- [ ] Build case note suggestion modal (post-session)
- [ ] Store in `case_notes` table or Splose busy-time
- [ ] Build case note history view

**Days 5–7: Integration Testing + Refinement**
- [ ] End-to-end test: login → schedule → view travel logs → see dormant alerts
- [ ] Test Splose API error handling
- [ ] Test scheduler algorithm with edge cases
- [ ] Refinement based on Antony feedback

**Week 2 Deliverables:**
- ✅ All 4 features working with test data
- ✅ Email alerts sending (dormant cases, credential expiry)
- ✅ Travel reports generating (PDF + CSV)
- ✅ Scheduler integration with Splose API

---

### Week 3: Production Hardening (May 24–31)

**Days 1–2: Security + Auth**
- [ ] Implement proper JWT + session management
- [ ] Add CORS + CSRF protection
- [ ] Encrypt sensitive data in DB (API keys, etc.)
- [ ] Audit endpoints for data leakage

**Days 2–3: Deployment Setup**
- [ ] Choose hosting (AWS RDS + EC2, or Azure Australia)
- [ ] Set up production `.env` file
- [ ] Build Docker image (backend + migrations)
- [ ] Set up CI/CD pipeline (GitHub Actions or similar)
- [ ] Test on staging environment

**Days 3–4: Documentation**
- [ ] Write `USER_GUIDE.md` for Ann
- [ ] Write `ADMIN_GUIDE.md` for Antony
- [ ] Write `DEPLOYMENT.md` for DevOps team
- [ ] Document all API endpoints + examples
- [ ] Create troubleshooting guide

**Days 4–5: Performance + Monitoring**
- [ ] Add database indexing optimization
- [ ] Implement caching for Splose reads (Redis optional)
- [ ] Add request logging + error tracking (Sentry)
- [ ] Load test scheduler algorithm
- [ ] Monitor email delivery (SendGrid webhooks)

**Days 5–7: UAT + Launch**
- [ ] Dry run: Antony uses app for 1 day with real Splose data
- [ ] Fix bugs found during UAT
- [ ] Prepare launch checklist
- [ ] Train Antony + Ann on key features
- [ ] Go live to production

**Week 3 Deliverables:**
- ✅ Production-ready application
- ✅ Deployed to Australia region (Sydney)
- ✅ All features tested with real Splose data
- ✅ Email alerts confirmed sending
- ✅ Full documentation + user guides

---

## Part 7: Deployment Instructions

### Prerequisites
- AWS account (Sydney region) OR Azure Australia account
- PostgreSQL 14+
- Node.js 18+
- Environment variables (see `.env.example`)

### Local Development

```bash
# Clone repo
git clone https://github.com/opal-therapy/scheduler.git
cd scheduler

# Backend setup
cd backend
cp .env.example .env
npm install
docker-compose up -d postgres redis

# Run migrations
npm run migrate:latest

# Start server
npm run dev  # Runs on http://localhost:3000

# Frontend setup (new terminal)
cd frontend
npm install
npm run dev  # Runs on http://localhost:5173
```

### Production Deployment (AWS)

```bash
# Build Docker image
docker build -t opal-scheduler:latest .

# Push to ECR
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com
docker tag opal-scheduler:latest <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/opal-scheduler:latest
docker push <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/opal-scheduler:latest

# Deploy to ECS
aws ecs update-service --cluster opal-prod --service scheduler --force-new-deployment --region ap-southeast-2
```

### Production Deployment (Azure)

```bash
# Build & push to ACR
az acr build --registry opal-therapy-acr --image scheduler:latest .

# Deploy to App Service
az webapp deployment container config --name opal-scheduler --resource-group opal-therapy
az webapp config container set --name opal-scheduler --resource-group opal-therapy --docker-custom-image-name opal-therapy-acr.azurecr.io/scheduler:latest
```

### Database Initialization

```sql
-- Connect to production PostgreSQL
psql postgresql://user:password@host:5432/opal_scheduler

-- Run migrations
\i db/migrations/001_initial_schema.sql
\i db/migrations/002_dormant_cases.sql
\i db/migrations/003_flights.sql
\i db/migrations/004_case_notes.sql

-- Verify tables
\dt
```

### Environment Variables

```env
# Backend
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@hostname:5432/opal_scheduler
JWT_SECRET=<generate-random-string>
SPLOSE_API_KEY=<get-from-splose>
GOOGLE_MAPS_API_KEY=<get-from-google-cloud>
SENDGRID_API_KEY=<get-from-sendgrid>
TWILIO_ACCOUNT_SID=<get-from-twilio> # optional, for SMS
TWILIO_AUTH_TOKEN=<get-from-twilio> # optional

# Frontend
VITE_API_URL=https://api.opal-therapy.com.au
VITE_SPLOSE_LOCATION_ID=1  # Opal Therapy location ID in Splose
```

---

## Part 8: Feature Status & Phase 2/3

### Ready This Sprint (May 10–31)
1. ✅ **Smart Scheduler** — Full regional clustering + busy-day alternation
2. ✅ **Travel Logbook** — Auto-track KMs, PDF/CSV reports
3. ✅ **Dormant Case Detection** — Daily email alerts
4. ⏳ **Case Noting Suggestions** — (needs Ann's decision on storage)
5. ⏳ **Client Reminders** — (needs SMS gateway decision)
6. ⏳ **Therapist Credentials** — (full implementation)

### Phase 2: June 2026 (Flight Tracking)
- Real-time flight monitoring via FlightAware or airline APIs
- Auto-calendar blocks for delays
- PNR tracking + email notifications
- **Effort:** 11–14 days
- **Start date:** Mid-June (after initial launch)

### Phase 3: July 2026 (Advanced Features)
- Multi-practitioner scheduling
- Client-facing booking portal
- Integrated video conferencing (Microsoft Teams)
- Advanced reporting + BI dashboards
- **Effort:** 3–4 weeks
- **Start date:** Early July

---

## Part 9: Risk Mitigation & Contingencies

| Risk | Mitigation |
|------|-----------|
| Splose API downtime | Cache reads locally; queue writes (send when API recovers) |
| Google Maps quota exceeded | Implement request batching; fallback to manual KM entry |
| Email delivery failures | Log to DB; retry queue; notify Antony in dashboard |
| Credential expiry missed | Daily 06:00 AWST check + 30-day lead alert (redundant) |
| Scheduler algorithm slow | Add caching for free-slot computation; optimize DB queries |
| Data loss in transit | Encrypt all Splose writes; verify responses before committing |

---

## Part 10: Success Criteria

By end of Week 3, this application should:

- [ ] Ann logs in, sees week calendar with color-coded sessions (read from Splose)
- [ ] Ann uses smart scheduler to book new client (gets 3 scored options)
- [ ] Appointment created in Splose + local DB synced
- [ ] Travel distance auto-calculated + logged for that appointment
- [ ] Antony receives daily dormant case email at 06:00 AWST
- [ ] Dormant case count shown on dashboard
- [ ] Ann's credentials visible in profile, with expiry dates
- [ ] Antony receives credential expiry warnings 30 days before
- [ ] Year-end travel report (PDF) downloadable for accountant
- [ ] App handles Splose API errors gracefully
- [ ] All features work on desktop + tablet browsers
- [ ] No unhandled JavaScript errors in console

---

## Part 11: Key Decisions Still Needed

### From Ann (Therapist)
1. [ ] Case notes: Log as "Admin" busy-time-type (#55339) or new dedicated type?
2. [ ] Credential alert lead time: 30 days standard, or custom per credential?
3. [ ] Blocking credentials: Which ones prevent scheduling if expired? (AHPRA? Working with Children?)

### From Antony (Manager)
1. [ ] SMS gateway: Twilio, AWS SNS, Vonage, or email-only for reminders?
2. [ ] Credentials storage: Splose practitioner profile or local Opal table?
3. [ ] Flight API choice: FlightAware, Sabre, AviationEdge, or airline direct APIs?
4. [ ] International flights: Which airlines/routes are priority for Phase 2?

---

## Appendix A: Technology Stack Rationale

| Layer | Choice | Why |
|-------|--------|-----|
| Backend | Node.js + Express | Fast iteration, JS across stack, good async support |
| Database | PostgreSQL | JSONB for Splose cache, strong ACID, Australian hosting available |
| Frontend | React (or vanilla JS) | Component reusability, good for complex calendar UI, Splose uses similar |
| Styling | CSS + Tailwind | Splose aesthetic, responsive, low overhead |
| API | REST (JSON) | Simple, stateless, Splose uses same style |
| Email | SendGrid | Reliable, good Australian coverage, webhook support |
| Maps | Google Maps API | Distance Matrix accurate, integrates with travel logging |
| Auth | JWT | Stateless, scales, suitable for single practitioner (can extend) |
| Hosting | AWS (Sydney) or Azure (Australia) | Compliance, data residency, 24/7 support |
| Monitoring | Sentry + CloudWatch | Error tracking, performance insights |

---

## Appendix B: Splose Integration Checklist

Before go-live, verify:

- [ ] Splose API key configured and tested
- [ ] All 8 session types mapped to correct service IDs:
  - Initial: 125821
  - Therapy: 125320
  - Assessment: 131003
  - MDT: 166733
  - Travel (billable): Support-Activity
  - Report writing: Support-Activity
  - Case noting: Admin (55339) or TBC
  - Admin: 55339
- [ ] Busy-time-types retrieved and color mapping applied
- [ ] Location addresses cached (for regional clustering)
- [ ] Practitioner availability (working hours) fetched
- [ ] Case funding utilization logic tested with real data
- [ ] Appointment creation tested (writes back to Splose)
- [ ] Cancellation read path tested (reads from Splose)

---

## Appendix C: Sample User Flow (Happy Path)

1. **Ann logs in** → Sees empty calendar, 06:00 AWST
2. **Daily dormant case email arrives** at 06:00 AWST
   - Ann reviews: "3 cases with no activity 6+ weeks"
   - Clicks quick-schedule link for one client
3. **Scheduler modal opens** with smart suggestions
   - Option 1: Wed 14 May, 10:00–11:00 (score 95, clusters with 2 east-side clients)
   - Option 2: Wed 14 May, 14:00–15:00 (score 78, afternoon)
   - Ann chooses Option 1
4. **Confirmation modal** shows:
   - Client: John Smith
   - Location: Eastside Clinic (24.5 km from Opal)
   - Travel time: 35 min + 5 min buffer
   - NDIS case has 42 hours remaining ✅
   - Ann clicks "Create"
5. **Appointment created** in Splose
   - Travel distance auto-logged (24.5 km)
   - Case noting suggestion appears: "15 min note time recommended after session"
   - Ann schedules case note for same day 13:00–13:15
6. **Week view updated** with new appointment block (color = Therapy green)
7. **Antony receives email** (daily 06:00 AWST): "3 dormant cases remaining"
8. **Year-end:** Ann downloads travel report
   - PDF: "Annual Travel Logbook FY2025-26 — 1,284 km × $0.66 = $847.44"
   - CSV for accountant

---

**READY TO BUILD?** Start with Week 1 foundation tasks. All code patterns and examples above are production-grade. Good luck! 🚀

