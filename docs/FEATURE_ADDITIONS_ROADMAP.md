# Therapy Scheduler — Feature Additions Roadmap (May 10, 2026)

## Overview

Three new features being added to mockup_v2.html:

1. **✅ Dormant Case Reminder** (6+ weeks no interaction) — **DELIVERED**
2. **⏳ Case Noting Suggestions** (10–15 mins after each session) — **DESIGN PHASE**
3. **⏳ Client Reminders** (24h before appointment) — **DESIGN PHASE**

---

## Feature 1: Dormant Case Reminder ✅

**Status:** Implementation complete  
**Files created:**
- `DORMANT_CASES_FEATURE.md` — Full feature documentation
- `dormant_cases_scheduler.js` — Backend scheduler logic
- `mockup_v2_dormant_cases_addition.html` — UI components for integration

### How to integrate into mockup_v2.html:

1. **Add new tab** (line ~1682, after Reschedule Inbox tab):
   ```html
   <button class="tab" data-tab="dormant-cases">
     <span class="tab-icon">⚠</span> Dormant Cases
     <span class="tab-badge" id="dormant-count"></span>
   </button>
   ```

2. **Add new view section** (after line 2830, after `</section>` closing view-inbox):
   - Copy the entire `<section class="view" id="view-dormant-cases">...` from `mockup_v2_dormant_cases_addition.html`

3. **Add CSS styles** (in `<style>` block, before closing `</style>`):
   - Copy all `.dormant-*` class styles from the addition file

4. **Add JavaScript** (in closing `<script>` block, before `</script>`):
   - Copy the entire `Dormant Cases Management` script section

5. **Deploy backend scheduler:**
   - Use `dormant_cases_scheduler.js` in one of:
     - Cloudflare Worker (with cron trigger)
     - AWS Lambda + EventBridge
     - Your own Node.js backend with node-cron or similar

**Configuration:** Users set up in "Dormant Case Reminder Settings" panel:
- Enable/disable daily check
- Check time (default 06:00 AWST)
- Frequency (daily, Mon-Fri, etc.)
- Recipient email
- Inactivity threshold (default 6 weeks)

---

## Feature 2: Case Noting Suggestions ⏳

**Purpose:** When a therapy session is scheduled, the app suggests allocating 10–15 minutes within the same day for case notes, with a defined location.

### Design Specifications

**When triggered:** After a new appointment is created (via Smart Booking or manual addition).

**User flow:**
1. Ann books a session (e.g., Therapy 60 min with Rohan Hayes, Mon 13:00–14:00 at Willetton clinic)
2. App detects: this is billable session → case notes needed
3. Suggest modal appears: "Add case noting time?" with options:
   - **Auto-schedule:** Find a gap same day (e.g., 14:15–14:30) and book as Busy-Time type `Admin` with label "Case notes: Rohan Hayes"
   - **Manual schedule:** User picks time/location themselves
   - **Snooze:** Remind later / skip for now
   - **Flexible:** Checkbox "Flexible — allocate later if sessions overflow this day"

4. If `flexible` checked:
   - Add to a "To-do" list: "Case notes: Rohan Hayes (10–15 min, any time this week)"
   - Don't block calendar time yet
   - App suggests free slots when user goes to schedule more

### Data Model

```js
caseNotingConfig = {
  enabled: true,
  durationMinutes: 12,           // default 10–15, configurable
  suggestSameDay: true,          // propose same-day slot first
  fallbackNextDay: true,         // if same-day full, suggest next morning
  preferredLocation: 'Willetton',  // where case notes are written
  createdBusyTimeType: 'Admin',  // or dedicated 'Case noting' type TBC
  flexible: false                // allow flex scheduling of overflow cases
}
```

### Splose Integration

**Write endpoint:** `POST /busy-times`
```json
{
  "title": "Case notes: {{clientName}}",
  "start": "2026-05-13T14:15:00",
  "end": "2026-05-13T14:30:00",
  "practitionerIds": ["{{practitionerId}}"],
  "busyTimeTypeId": "{{busyTimeTypeId}}",  // e.g., 55339 (Admin) or future dedicated type
  "note": "Followup from appointment {{appointmentId}} with {{clientName}} 13:00–14:00",
  "recurringRule": null  // case notes are one-off per session
}
```

### UI Components

**Modal after session booking:**
```html
<div class="modal" id="modal-case-noting">
  <h3>Case noting — {{clientName}}</h3>
  <p>This billable session requires 10–15 minutes of case noting.</p>

  <div class="options">
    <label class="option">
      <input type="radio" name="case-noting" value="auto" checked>
      <span>Auto-schedule same day ({{suggestedTime}})</span>
    </label>
    <label class="option">
      <input type="radio" name="case-noting" value="manual">
      <span>Manual — I'll schedule later</span>
    </label>
    <label class="option">
      <input type="radio" name="case-noting" value="flexible">
      <span>Flexible — add to to-do list</span>
    </label>
  </div>

  <label class="checkbox">
    <input type="checkbox" id="case-noting-flexible">
    <span>Don't block calendar — flag as flexible task</span>
  </label>

  <div class="modal-actions">
    <button class="btn" onclick="skipCaseNoting()">Skip for now</button>
    <button class="btn primary" onclick="applysCaseNoting()">Allocate time</button>
  </div>
</div>
```

### Algorithm: Smart Slot Finding

```
For same-day case-noting slot:
1. Find gaps in practitioner schedule same day
2. Prefer gaps:
   - After 13:00 (less disruptive to afternoon flow)
   - ≥ 15 min consecutive
   - At therapy location (minimize travel)
3. If no suitable slot:
   - Offer next morning before first appointment
   - Or: add to flexible to-do list

For flexible to-do:
- Create low-priority task in sidebar
- Suggest batch with other admin tasks later in week
- Don't auto-book; let user drag to calendar
```

### Configuration Panel

Add to scheduler settings:
```html
<h4>Case Noting Settings</h4>
<div class="form-field">
  <label>Auto-suggest case noting after sessions</label>
  <div class="toggle">
    <input type="checkbox" id="case-noting-enabled" checked>
    <span class="track"></span>
  </div>
</div>
<div class="form-field">
  <label>Case noting duration (minutes)</label>
  <input type="number" id="case-noting-duration" value="12" min="10" max="30">
</div>
<div class="form-field">
  <label>Preferred location for case notes</label>
  <select id="case-noting-location">
    <option>Willetton (main clinic)</option>
    <option>Home office</option>
    <option>Any location</option>
  </select>
</div>
<div class="form-field">
  <label>Allow flexible scheduling</label>
  <div class="toggle">
    <input type="checkbox" id="case-noting-flexible">
    <span class="track"></span>
  </div>
  <div class="hint">If checked, case notes added to flexible to-do list during busy days</div>
</div>
```

---

## Feature 3: Client Reminders (24 hours before) ⏳

**Purpose:** Automatic SMS/email reminder sent to clients 24 hours before scheduled appointment.

### Design Specifications

**Trigger:** Appointment created in Splose → scheduler detects 24h before appointment time → sends reminder.

**Delivery channels:**
- **SMS** (preferred for immediate visibility)
- **Email** (fallback if no mobile)
- **Both** (configurable per client)

**Message template:**
```
SMS:
"Hi {{clientFirstName}}, reminder: your OT session with Ann is tomorrow at {{time}} AWST at {{location}}. Reply CONFIRM or call {{phone}} if you need to reschedule. —Opal Therapy"

Email:
Subject: "Session reminder — {{date}} at {{time}}"
"Hi {{clientName}},
This is a friendly reminder of your upcoming occupational therapy session:

Date: {{date}}
Time: {{time}} AWST
Location: {{location}} ({{address}})
Duration: {{durationMinutes}} minutes

If you need to reschedule or cancel, please call {{therapistPhone}} or reply to this email.

See you soon!
Opal Therapy"
```

### Data Model

```js
clientReminderConfig = {
  enabled: true,
  reminderHoursBefore: 24,        // configurable: 4, 12, 24, 48
  channels: ['sms', 'email'],     // or just one
  timezone: 'Australia/Perth',
  includeLocation: true,
  includeMapLink: false,           // SMS: shortened link; email: full map embed
  includeRescheduleLink: false,    // TBC — requires token-based link generation
}
```

### Splose Queries Required

```
GET /appointments?start_gt={{tomorrow}}&start_lt={{tomorrow+24h}}
  for each appointment:
    GET /patients/{patientId}  // phone, email
    GET /locations/{locationId}  // address
    GET /services/{serviceId}  // name, duration
```

**Note:** Splose API doesn't expose SMS preferences yet (2026-04-20 knowledge cutoff). Will need:
- `patient.mobilePhone` field
- `patient.preferredReminderChannel` (sms/email/both)
- Or: Opal Therapy maintains a local preference override table

### Scheduled Task

**Runs every hour** (e.g., at :00 past each hour):
```
1. Query appointments for next 24–25 hours
2. Filter to:
   - Status = confirmed (not cancelled)
   - Patient has contact method (SMS or email)
   - Reminder not already sent (track via appointment.reminderSentAt)
3. For each, send reminder via configured channel
4. Mark appointment: reminderSentAt = now
```

**Retry logic:** If send fails, retry at :30 past next hour (up to 3 times).

### Backend Implementation

```js
async function sendClientReminders() {
  const config = await loadReminderConfig();
  if (!config.enabled) return;

  const hoursUntil = config.reminderHoursBefore;
  const startTime = new Date(Date.now() + (hoursUntil - 1) * 60 * 60 * 1000);
  const endTime = new Date(Date.now() + (hoursUntil + 1) * 60 * 60 * 1000);

  const appointments = await queryAppointments({
    start_gt: startTime.toISOString(),
    start_lt: endTime.toISOString(),
    status: 'confirmed'
  });

  for (const appt of appointments) {
    if (appt.reminderSentAt) continue; // already sent

    const patient = await getPatient(appt.patientId);
    const location = await getLocation(appt.locationId);
    const service = await getService(appt.serviceId);

    const message = buildReminderMessage({
      clientName: patient.firstname,
      time: new Date(appt.startTime).toLocaleTimeString('en-AU'),
      location: location.title,
      address: location.address,
      duration: service.duration
    });

    if (config.channels.includes('sms') && patient.mobilePhone) {
      await sendSMS(patient.mobilePhone, message.sms);
    }
    if (config.channels.includes('email') && patient.email) {
      await sendEmail(patient.email, message.emailSubject, message.emailBody);
    }

    // Mark as sent
    await recordReminderSent(appt.id);
  }
}
```

### UI Configuration Panel

```html
<h4>Client Reminder Settings</h4>

<div class="form-field">
  <label>Send appointment reminders to clients</label>
  <div class="toggle">
    <input type="checkbox" id="client-reminder-enabled" checked>
    <span class="track"></span>
  </div>
</div>

<div class="form-field">
  <label>Remind clients how long before appointment</label>
  <select id="client-reminder-hours">
    <option value="4">4 hours before</option>
    <option value="12">12 hours before</option>
    <option value="24" selected>24 hours before</option>
    <option value="48">48 hours before</option>
  </select>
</div>

<div class="form-field">
  <label>Reminder channels</label>
  <div style="display:flex; gap:16px;">
    <label class="checkbox">
      <input type="checkbox" id="client-reminder-sms" checked>
      <span>SMS (mobile)</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" id="client-reminder-email" checked>
      <span>Email</span>
    </label>
  </div>
  <div class="hint">Patients without contact method will be skipped.</div>
</div>

<div class="form-field">
  <label>Include location & address in reminder</label>
  <div class="toggle">
    <input type="checkbox" id="client-reminder-location" checked>
    <span class="track"></span>
  </div>
</div>

<div class="form-actions">
  <button class="btn" onclick="testClientReminder()">Send test message</button>
  <button class="btn primary" onclick="saveClientReminderConfig()">Save settings</button>
</div>
```

---

## Implementation Priority & Timeline

### Phase 1 (Current — May 10)
✅ **Dormant Case Reminder**
- Feature doc: DORMANT_CASES_FEATURE.md
- Backend: dormant_cases_scheduler.js
- UI: mockup_v2_dormant_cases_addition.html
- **Action:** Integrate components into mockup_v2.html, deploy scheduler

### Phase 2 (Next Sprint)
⏳ **Case Noting Suggestions**
- Design: Algorithm for smart slot-finding same-day
- Integration: Modal workflow after session booking
- Splose writes: POST /busy-times with case notes metadata
- **Blocker:** TBC with Ann whether case notes go under "Admin" busy-time-type or separate type

### Phase 3 (Future)
⏳ **Client Reminders**
- Design: SMS vs. email channel priority
- Integration: Hourly scheduler checking 24h-ahead window
- Splose queries: appointment list with patient contact fields
- **Blocker:** Splose API needs `patient.mobilePhone` and `patient.preferredReminderChannel` fields (2026-04-20 not exposed)

---

## Known Blockers & TBCs

| Feature | Blocker | Status | Owner |
|---------|---------|--------|-------|
| Dormant Cases | None | Ready | ✅ Delivered |
| Case Noting | Case notes type in Splose (Admin vs. dedicated?) | Design | TBC with Ann |
| Client Reminders | `patient.mobilePhone`, `patient.preferredReminderChannel` API fields | Design | Splose API team |
| Client Reminders | SMS gateway integration (Twilio? AWS SNS?) | Design | TBC with Antony |

---

## Files to Review/Approve

1. `DORMANT_CASES_FEATURE.md` — Feature detail doc
2. `dormant_cases_scheduler.js` — Backend scheduler (ready to deploy)
3. `mockup_v2_dormant_cases_addition.html` — HTML/CSS/JS chunks (ready to integrate)
4. `FEATURE_ADDITIONS_ROADMAP.md` (this file)

**Next steps for Antony:**
1. Review dormant cases feature
2. Decide case noting preference: "Admin" vs. dedicated "Case noting" busy-time-type in Splose
3. Confirm SMS gateway for client reminders (Twilio, AWS SNS, other?)
4. Schedule integration of dormant cases into live mockup_v2.html
