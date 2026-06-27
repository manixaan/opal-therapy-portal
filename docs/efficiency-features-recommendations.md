# Efficiency Features Recommendations
## Opal Therapy Scheduler — Claude Analysis
*Generated: June 2026*

---

## Summary

Based on a review of the current application design, data flows, and user roles, the following features would provide genuine efficiency and compliance value. Items are grouped by priority.

---

## Implement Now (Low Risk, High Value)

### 1. Today's Schedule Summary Notification
- **Who benefits:** Therapist, Admin, Owner
- **Where it belongs:** Notifications panel (already implemented as live notification)
- **Description:** On first load each day, show a summary of today's appointments, including first appointment time, travel starting point, and any warnings.
- **Privacy risk:** Low — shown only to the logged-in user's own data
- **Implementation complexity:** Low — reads from existing sessions data already loaded
- **Status:** Partially implemented via notification panel

---

### 2. Missing Address Alert (per appointment)
- **Who benefits:** Therapist, Admin
- **Where it belongs:** Notifications panel + Calendar tile warning badge
- **Description:** Any appointment where address resolution fails should generate a warning badge on the calendar tile AND a notification. Currently the address warning exists inline but not as a persistent alert.
- **Privacy risk:** Low
- **Implementation complexity:** Low — extend existing address-resolution logic to emit a notification
- **Implement now:** Yes

---

### 3. Credential Expiry Alert (30/14/7 days)
- **Who benefits:** Therapist (own), Admin/Owner (all staff)
- **Where it belongs:** Notifications panel + Settings → Notification Settings
- **Description:** Alert when AHPRA, WWC, or any other credential is within the configurable warning period (default: 30 days).
- **Privacy risk:** Low
- **Implementation complexity:** Low — backend query on credentials table already exists in app-routes.js
- **Implement now:** Yes (backend logic already wired)

---

### 4. Incomplete Profile Alert
- **Who benefits:** Therapist, Admin/Owner
- **Where it belongs:** Notifications panel
- **Description:** Alert when base work location is not set (blocks travel calculation) or display name is blank.
- **Privacy risk:** Low
- **Implementation complexity:** Low — single DB query
- **Implement now:** Yes (wired in app-routes.js generateLiveNotifications)

---

### 5. Long Travel Time Warning
- **Who benefits:** Therapist, Admin
- **Where it belongs:** Calendar tile + Notifications panel
- **Description:** When a calculated trip exceeds the user's configured threshold (default: 45 min), flag it in the Travel Logbook and surface as a notification.
- **Privacy risk:** Low
- **Implementation complexity:** Low — threshold is already configurable in Travel Settings
- **Implement now:** Yes — add threshold check in travel calculation pipeline

---

### 6. Splose Sync Failure Alert
- **Who benefits:** Admin, Owner
- **Where it belongs:** Notifications panel + header sync pill colour change
- **Description:** If the Splose API call fails (network, auth, rate-limit), change the sync pill from green to red and generate a warning notification.
- **Privacy risk:** Low
- **Implementation complexity:** Low — catch errors in the existing Splose sync loop and emit a notification
- **Implement now:** Yes

---

## Implement Soon (Medium Priority)

### 7. Daily Schedule Summary (auto-dismiss)
- **Who benefits:** Therapist
- **Where it belongs:** Notifications panel + optional email
- **Description:** At the start of each working day, generate a summary: number of clients, total travel km estimate, first appointment time and location. Auto-dismiss after 24 hours.
- **Privacy risk:** Low
- **Implementation complexity:** Medium — requires a scheduled task or on-login trigger
- **Implement soon:** Yes

---

### 8. Calendar Conflict Warning
- **Who benefits:** Therapist, Admin, Owner
- **Where it belongs:** Notifications panel + calendar tile overlap highlight
- **Description:** Detect overlapping appointments (same therapist, overlapping time ranges). Surface a warning notification and highlight the conflict visually on the calendar.
- **Privacy risk:** Low
- **Implementation complexity:** Medium — overlap detection query on calendar_events
- **Implement soon:** Yes

---

### 9. Dormant Case Follow-up Reminder
- **Who benefits:** Admin, Owner
- **Where it belongs:** Notifications panel + Dormant Cases tab badge
- **Description:** When a client has not had an appointment in 6 weeks (configurable), escalate the dormant alert to a notification — not just show it in the Dormant Cases tab.
- **Privacy risk:** Low — no sensitive financial data, just activity status
- **Implementation complexity:** Medium — requires scheduled job or on-load check
- **Implement soon:** Yes

---

### 10. Duplicate Appointment Warning
- **Who benefits:** Therapist, Admin
- **Where it belongs:** Smart Booking wizard → Step 2/3
- **Description:** Before finalising a booking, check if the same client already has an appointment on the same day. Show a warning prompt (not a hard block).
- **Privacy risk:** Low
- **Implementation complexity:** Medium — client-side check in booking wizard
- **Implement soon:** Yes

---

### 11. Unsynced Outlook Event Alert
- **Who benefits:** Therapist, Admin
- **Where it belongs:** Notifications panel
- **Description:** If an Outlook event exists with no matching Splose record and no local DB record, flag it as potentially unsynced. Helps catch cases where appointments were entered directly in Outlook.
- **Privacy risk:** Low
- **Implementation complexity:** Medium — cross-reference in delta sync logic
- **Implement soon:** Yes

---

### 12. Weekly Workload Summary
- **Who benefits:** Therapist, Admin, Owner
- **Where it belongs:** Notifications panel (Friday or Monday) + Dashboard widget
- **Description:** End/start of week summary: sessions completed, total hours, travel distance, pending case notes. For Owner/Admin, shows per-therapist breakdown.
- **Privacy risk:** Low for individual; Medium for cross-therapist (Admin/Owner only)
- **Implementation complexity:** Medium
- **Implement soon:** Yes (Owner/Admin view)

---

### 13. CPD Hours Tracker Alert
- **Who benefits:** Therapist
- **Where it belongs:** Notifications panel + My Profile → CPD section
- **Description:** Alert when the therapist is approaching their annual CPD hours requirement (e.g. OT Australia requires 30 hours/year). Show a progress bar in My Profile.
- **Privacy risk:** Low
- **Implementation complexity:** Medium — requires CPD hours target setting per user
- **Implement soon:** Yes

---

## Future / Higher Complexity

### 14. Billing Readiness Alert
- **Who benefits:** Owner
- **Where it belongs:** Notifications panel + Billing tab
- **Description:** Alert when appointments have been completed but not yet submitted for billing (comparing Splose status vs local records).
- **Privacy risk:** High — financial data; Owner only
- **Implementation complexity:** High — requires Splose billing status integration
- **When:** Future — after billing pipeline is solid

---

### 15. Rural Trip Planning Support
- **Who benefits:** Therapist, Admin (Ann's rural trips)
- **Where it belongs:** Travel & Flights tab + Calendar
- **Description:** For trips that involve driving >2 hours, prompt to create a multi-day travel plan: check-in, clinic sessions, check-out. Suggest optimised client clusters by suburb to minimise total distance.
- **Privacy risk:** Low
- **Implementation complexity:** High — requires multi-day trip model
- **When:** Future

---

### 16. Client Missing Key Information Alert
- **Who benefits:** Admin, Owner
- **Where it belongs:** Contacts tab + Notifications
- **Description:** Flag clients with missing NDIS number, missing address, expired plan, or no phone/email on record.
- **Privacy risk:** Medium — contains client personal information
- **Implementation complexity:** Medium
- **When:** Medium priority — after client data model is solidified

---

### 17. Failed Write-back Alert
- **Who benefits:** Therapist, Admin
- **Where it belongs:** Notifications panel
- **Description:** When Outlook write-back (travel block creation or event creation) fails, generate a notification with a retry button.
- **Privacy risk:** Low
- **Implementation complexity:** Medium — catch write-back failures and persist as notifications
- **When:** Implement soon — write-back is already live

---

### 18. Outlook Token Expiry Warning
- **Who benefits:** Therapist (own), Admin/Owner
- **Where it belongs:** Integration Settings + Notifications
- **Description:** Warn 24–48 hours before the Outlook OAuth token expires (before the nightly delta sync fails). Provide a one-click reconnect button.
- **Privacy risk:** Low
- **Implementation complexity:** Medium — compare token_expires_at with now in background poller
- **When:** Implement soon — avoids silent sync failures

---

## Settings to Implement (Not Yet Wired)

| Setting | Who | Complexity | Notes |
|---------|-----|------------|-------|
| Calendar default view (day/week/month) | All | Low | Save to user_settings, apply on Calendar load |
| Calendar start/end hours | All | Low | Apply to day/week view rendering |
| Show weekends toggle | All | Low | Already has CSS support — wire toggle |
| Default appointment duration | All | Low | Pre-fill Smart Booking wizard |
| km rate (org-wide) | Owner | Low | Apply to Travel Logbook calculations |
| Credential warn days | All | Low | Apply to notification query threshold |
| Travel from/to base toggle | All | Low | Apply to travel calculation logic |

---

## Privacy Risk Classification

| Risk Level | Criteria | Example |
|------------|----------|---------|
| Low | Own data only, no client PII | Missing base location alert |
| Medium | Contains client names/status (not financial) | Dormant client alert |
| High | Financial amounts, billing data, cross-user financial | Billing readiness alert |

---

## Recommended Implementation Order

1. Missing address alert (calendar tile + notification) — **now**
2. Long travel time warning — **now**
3. Splose sync failure alert — **now**
4. Outlook token expiry warning — **soon**
5. Calendar conflict warning — **soon**
6. CPD hours progress + alert — **soon**
7. Weekly workload summary (Owner/Admin) — **soon**
8. Failed write-back alert with retry — **soon**
9. Billing readiness alert — **future (Owner only)**
10. Rural trip planning support — **future**
