# Dormant Case Reminder Feature

**Added:** May 10, 2026  
**Status:** Integrated into mockup v2 as dashboard widget + scheduled task  
**Trigger:** Daily automated check (configurable)

---

## Feature Overview

Automatically detects therapy cases with **6+ weeks of no interaction** (no invoices, no case notes, no appointments booked, no support activities) and emails a report to the therapist with:

- List of dormant cases with client names and case IDs
- NDIS funding status (hours remaining, budget remaining, plan expiry)
- Suggested next action per case (resume therapy, discharge review, seek extension)
- Quick-schedule links to pre-fill booking a new appointment

---

## How It Works

### Detection Logic

**A case is marked dormant when:**
```
last_activity_date < (today - 42 days)
AND last_activity_date is the MAX of:
  - last appointment end_time (from appointments[])
  - last invoice created_date (from support_activities[] with invoiceId)
  - last case_note created_date (from case_notes[] — if exposed by API; if not, omit)
```

**Non-dormant triggers:** Any of the above within the last 42 days.

### Scheduled Task

**Runs daily at 06:00 AWST** (before Ann's 09:00 clinic start).

1. Query Splose for all active cases (not archived, not discharged)
2. For each case, compute `last_activity_date`
3. Filter to dormant cases (6+ weeks old)
4. If count > 0:
   - Fetch NDIS funding info (hours/budget used, plan expiry)
   - Generate HTML email with formatted table
   - Send to therapist (configured address; default: ann@opaltherapy.com.au)
5. Log run timestamp + count to browser console / optional webhook

### Dashboard Widget

**Location:** New tab "Dormant Cases" in main nav  
**Displays:**
- Count badge (e.g., "3 cases dormant")
- Sortable table: Client name | Region | Last activity | NDIS hours remaining | NDIS days remaining | Action
- Filter by region (East, West, South, etc.)
- "Run check now" button to trigger on-demand
- Last run timestamp + next scheduled run

---

## Splose Queries Required

```
GET /cases?isArchived=false&discharged=false  // all active cases
GET /cases/{id}  // funding info (hours, budget, trackType, utilisationAlert, issueDate, expiryDate)
GET /appointments?caseId={id}&offset=0&limit=100  // last appointment per case
GET /support-activities?caseId={id}&offset=0&limit=100  // last invoice per case
```

**Note:** Case notes are not yet exposed by Splose API (2026-04-20 knowledge cutoff). If they become available in the future, add:
```
GET /case-notes?caseId={id}&offset=0&limit=100
```

---

## Email Template

### Subject
```
Opal Therapy — Dormant case reminder ({{caseCount}} cases, {{checkDate}})
```

### HTML Body
```html
<h2>Dormant Case Report — {{checkDate}}</h2>
<p>{{caseCount}} case(s) have had no interaction in the past 6 weeks.</p>

<table style="width:100%; border-collapse:collapse; margin:20px 0;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="border:1px solid #ddd; padding:10px; text-align:left;">Client Name</th>
      <th style="border:1px solid #ddd; padding:10px; text-align:left;">Case ID</th>
      <th style="border:1px solid #ddd; padding:10px; text-align:left;">Region</th>
      <th style="border:1px solid #ddd; padding:10px; text-align:left;">Last Activity</th>
      <th style="border:1px solid #ddd; padding:10px; text-align:left;">NDIS Hours Used</th>
      <th style="border:1px solid #ddd; padding:10px; text-align:left;">Plan Expires</th>
      <th style="border:1px solid #ddd; padding:10px; text-align:left;">Action</th>
    </tr>
  </thead>
  <tbody>
    {{#cases}}
    <tr>
      <td style="border:1px solid #ddd; padding:10px;">{{clientName}}</td>
      <td style="border:1px solid #ddd; padding:10px;"><code>{{caseId}}</code></td>
      <td style="border:1px solid #ddd; padding:10px;">{{region}}</td>
      <td style="border:1px solid #ddd; padding:10px;">{{lastActivityDate}}</td>
      <td style="border:1px solid #ddd; padding:10px;">{{ndisHoursUsed}} / {{ndisHoursTotal}}</td>
      <td style="border:1px solid #ddd; padding:10px; {{#planUrgent}}color:red;{{/planUrgent}}">{{planExpiryDate}}</td>
      <td style="border:1px solid #ddd; padding:10px;">
        {{#suggestedAction}}
        <strong>{{suggestedAction}}</strong>
        {{/suggestedAction}}
        <br/>
        <a href="{{quickScheduleLink}}">Book session</a>
      </td>
    </tr>
    {{/cases}}
  </tbody>
</table>

<h3>Suggested Actions</h3>
<ul>
  <li><strong>Resume therapy:</strong> Client has adequate funding remaining. Book next session to restart engagement.</li>
  <li><strong>Plan window closing:</strong> Plan expires within 14 days. Book urgently or liaise on extension/discharge.</li>
  <li><strong>Discharge review:</strong> Zero hours remaining or plan already expired. Schedule discharge session or wind-down review.</li>
  <li><strong>Liaise with coordinator:</strong> Nominee or fundholder review required (e.g., plan amendment, appeal).</li>
</ul>

<p style="color:#666; font-size:12px;">
  Dormancy defined as: no appointments, invoices, or case notes in past 6 weeks.<br/>
  Last check run: {{checkDateTime}} AWST<br/>
  Next check: {{nextCheckDateTime}} AWST
</p>
```

---

## Configuration

Settings stored in localStorage (or later, synced to backend):

```js
dormantCaseConfig = {
  enabled: true,
  checkDayOfWeek: 'daily',           // or 'mon', 'wed', etc.
  checkTimeAWST: '06:00',            // 24-hour format
  inactivityThresholdWeeks: 6,       // dormancy = 6 weeks
  recipientEmail: 'ann@opaltherapy.com.au',
  includeRegions: ['East', 'West', 'South', 'Central'], // filter by region
  urgentPlanWindow: 14              // flag if plan expires < 14 days
}
```

---

## mockup_v2.html Integration

**New tab added to nav (line ~1681):**
```html
<button class="tab" data-tab="dormant-cases">
  <span class="tab-icon">⚠</span> Dormant Cases
  <span class="tab-badge" id="dormant-count">0</span>
</button>
```

**New view section (after view-inbox):**
```html
<section class="view" id="view-dormant-cases">
  <div class="dormant-panel">
    <h2>Dormant Cases <span class="h2-sub">6+ weeks no interaction</span></h2>
    
    <div class="dormant-controls">
      <button class="btn primary" onclick="runDormantCheckNow()">🔍 Check now</button>
      <span class="check-status" id="check-status">Last check: {{lastCheck}}</span>
    </div>

    <div class="dormant-table">
      <!-- Populated by JS -->
    </div>
  </div>
</section>
```

**Styles added to <style> block:**
```css
.dormant-panel { padding: 16px; }
.dormant-controls {
  display: flex; align-items: center; gap: 12px; margin-bottom: 16px;
}
.dormant-table {
  overflow-x: auto; border: 1px solid var(--border); border-radius: 8px;
}
.dormant-tbl {
  width: 100%; border-collapse: collapse; font-size: 13px;
}
.dormant-tbl th, .dormant-tbl td {
  padding: 12px; text-align: left; border-bottom: 1px solid var(--border);
}
.dormant-tbl th {
  background: var(--accent-soft); font-weight: 600; color: var(--accent-deep);
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;
}
.dormant-row.urgent { background: var(--warn-soft); }
.dormant-row:hover { background: #f9fafb; }
.dormant-action {
  display: flex; gap: 6px; flex-direction: column;
}
.dormant-action a {
  color: var(--accent); text-decoration: none; font-size: 12px; font-weight: 500;
}
.dormant-action a:hover { text-decoration: underline; }
```

---

## JavaScript Handler

**New function in <script> block:**

```js
async function checkDormantCases() {
  const INACTIVITY_WEEKS = 6;
  const CUTOFF_DATE = new Date();
  CUTOFF_DATE.setDate(CUTOFF_DATE.getDate() - (INACTIVITY_WEEKS * 7));

  try {
    // 1. Fetch all active cases
    const casesResp = await fetch('https://api.splose.com/v1/cases?isArchived=false', {
      headers: { 'Authorization': `Bearer ${SPLOSE_TOKEN}` }
    });
    const cases = await casesResp.json();

    const dormantCases = [];

    // 2. For each case, determine last activity date
    for (const caseObj of cases.data) {
      const lastAppointmentResp = await fetch(
        `https://api.splose.com/v1/appointments?caseId=${caseObj.id}`,
        { headers: { 'Authorization': `Bearer ${SPLOSE_TOKEN}` } }
      );
      const appts = await lastAppointmentResp.json();
      const lastApptDate = appts.data.length > 0 
        ? new Date(appts.data[appts.data.length - 1].endTime)
        : null;

      const lastSupportResp = await fetch(
        `https://api.splose.com/v1/support-activities?caseId=${caseObj.id}`,
        { headers: { 'Authorization': `Bearer ${SPLOSE_TOKEN}` } }
      );
      const supportActivities = await lastSupportResp.json();
      const lastSupportDate = supportActivities.data.length > 0
        ? new Date(supportActivities.data[supportActivities.data.length - 1].createdAt)
        : null;

      // 3. Determine which is the latest activity
      const lastActivity = [lastApptDate, lastSupportDate]
        .filter(d => d !== null)
        .sort((a, b) => b - a)[0];

      // 4. Check if dormant
      if (lastActivity && lastActivity < CUTOFF_DATE) {
        const ndisInfo = caseObj.ndisInfo || {};
        dormantCases.push({
          caseId: caseObj.id,
          clientId: caseObj.patientId,
          lastActivity,
          hoursUsed: ndisInfo.hoursUsed || 0,
          hoursTotal: ndisInfo.hoursTotal || 0,
          budgetUsed: ndisInfo.budgetUsed || 0,
          budgetTotal: ndisInfo.budgetTotal || 0,
          planExpiry: ndisInfo.expiryDate,
          isUrgent: new Date(ndisInfo.expiryDate) < new Date(Date.now() + 14*24*60*60*1000)
        });
      }
    }

    return dormantCases;
  } catch (err) {
    console.error('Error checking dormant cases:', err);
    return [];
  }
}

function renderDormantCases(cases) {
  const tableBody = document.querySelector('.dormant-table');
  if (!tableBody) return;

  let html = `<table class="dormant-tbl">
    <thead>
      <tr>
        <th>Client</th>
        <th>Case ID</th>
        <th>Last Activity</th>
        <th>NDIS Hours</th>
        <th>Plan Expires</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>`;

  for (const c of cases) {
    const urgent = c.isUrgent ? 'urgent' : '';
    html += `
      <tr class="dormant-row ${urgent}">
        <td>${c.clientName || 'Loading...'}</td>
        <td><code>${c.caseId}</code></td>
        <td>${c.lastActivity.toLocaleDateString('en-AU')}</td>
        <td>${c.hoursUsed} / ${c.hoursTotal}</td>
        <td ${c.isUrgent ? 'style="color:var(--danger);"' : ''}>${new Date(c.planExpiry).toLocaleDateString('en-AU')}</td>
        <td>
          <div class="dormant-action">
            <a href="#" onclick="suggestAction('${c.caseId}')">📌 Suggest action</a>
            <a href="#" onclick="quickSchedule('${c.caseId}')">+ Book session</a>
          </div>
        </td>
      </tr>
    `;
  }

  html += `</tbody></table>`;
  tableBody.innerHTML = html;

  // Update badge
  document.getElementById('dormant-count').textContent = cases.length;
  document.getElementById('dormant-count').style.display = cases.length > 0 ? 'inline' : 'none';
}

async function runDormantCheckNow() {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Checking...';

  const cases = await checkDormantCases();
  renderDormantCases(cases);

  // Store last check time
  localStorage.setItem('lastDormantCheck', new Date().toISOString());
  document.getElementById('check-status').textContent = 
    `Last check: ${new Date().toLocaleTimeString('en-AU')}`;

  btn.disabled = false;
  btn.textContent = '🔍 Check now';
}
```

---

## Next Steps

1. **User setup:** Configure recipient email and schedule in Opal Therapy settings
2. **Test:** Run check manually via "Check now" button; verify email sends
3. **Automation:** Deploy scheduled task (Cloudflare Cron, AWS Lambda, or backend service)
4. **Iterate:** Refine suggested actions based on Ann's feedback

---

## Known Limitations

- **Case notes API not yet available** (as of 2026-04-20). If Splose adds `/case-notes` endpoint, update detection logic.
- **Single practitioner scope:** Feature assumes Ann is the sole therapist. Multi-practitioner email routing TBD for future releases.
- **Email delivery:** Currently uses client-side fetch to a backend endpoint. Production deployment requires proper email service (SendGrid, AWS SES, Azure Mail, etc.).
