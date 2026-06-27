# Flight Tracking & Travel Time Blocking Feature

**Status:** Design phase  
**Created:** May 10, 2026  
**Scope:** Track business flights, auto-block schedule, monitor delays/cancellations

---

## Feature Overview

When a therapist travels between locations (e.g., weekend workshop in Melbourne, fly to visit distant clients), the scheduler allows adding flight details and auto-blocks calendar time for:
- **Pre-flight:** Travel to airport, check-in, security
- **Flight time:** Departure to arrival
- **Post-flight:** Baggage claim, travel to destination

Real-time monitoring alerts therapist to delays/cancellations and auto-updates blocked times.

**Key requirements:**
- ✅ Manual time blocking (Ann specifies exact buffer times)
- ✅ PNR-based auto-fetch from airline APIs (e.g., FlightAware, AviationEdge)
- ✅ Real-time delay/cancellation alerts
- ✅ Gate & terminal information when available
- ✅ Integration with Splose calendar (blocks appear as busy-times)
- ✅ Travel logbook tracking (KMs airport → destination)

---

## Data Model

### Flight Record

```json
{
  "id": "FLT-20260615-001",
  "travelId": "TRAV-20260615-001",  // links to multi-leg trip
  "flightNumber": "QF123",
  "airline": {
    "code": "QF",
    "name": "Qantas",
    "iataCode": "QF"
  },
  
  "routing": {
    "departure": {
      "airport": {
        "code": "PER",
        "city": "Perth",
        "timezone": "Australia/Perth"
      },
      "scheduledTime": "2026-06-15T14:30:00+08:00",
      "actualTime": null,
      "gate": null,
      "terminal": "1"
    },
    "arrival": {
      "airport": {
        "code": "MEL",
        "city": "Melbourne",
        "timezone": "Australia/Melbourne"
      },
      "scheduledTime": "2026-06-15T16:45:00+10:00",
      "actualTime": null,
      "gate": null,
      "terminal": "2",
      "bagageClaim": "Carousel 5"
    },
    "duration_minutes": 135,
    "distance_km": 703
  },
  
  "booking": {
    "pnr": "ABC123",  // Passenger Name Record (booking reference)
    "confirmationCode": "QF123ABC",
    "bookingDate": "2026-05-10",
    "ticketNumber": "1234567890",
    "passengerName": "Ann Mary Mathew",
    "seat": "12A",
    "seatClass": "Economy",
    "baggage": {
      "checked": 1,
      "carryon": 1,
      "weight_kg": 23
    }
  },
  
  "status": {
    "flightStatus": "scheduled",  // scheduled, ontime, delayed, cancelled, boarding, inflight, landed
    "delayMinutes": 0,
    "delayReason": null,
    "cancellationReason": null,
    "lastUpdated": "2026-06-15T09:00:00Z",
    "dataSource": "flightaware"  // or aviationedge, airline api
  },
  
  "timeBlocks": {
    "preFlightBuffer": {
      "durationMinutes": 120,  // 2 hours before departure
      "travelToAirport": 30,   // minutes
      "checkin": 30,
      "security": 30,
      "buffer": 30
    },
    "postFlightBuffer": {
      "durationMinutes": 90,   // after landing
      "taxiing": 15,
      "bagageClaim": 30,
      "travelFromAirport": 45
    },
    "busyTimes": [
      {
        "id": "BT-PRE-FLT-001",
        "title": "Travel: Perth → Melbourne flight QF123",
        "type": "travel",
        "startTime": "2026-06-15T12:30:00+08:00",
        "endTime": "2026-06-15T17:15:00+10:00",  // includes arrival + buffer
        "sploseBusyTimeId": null  // synced to Splose when created
      }
    ]
  },
  
  "purpose": {
    "reason": "Professional development workshop",  // or "Client visit", "Conference", etc.
    "location": "Melbourne, Victoria",
    "sessionsAffected": [],  // appointments that can't be scheduled during this travel
    "daysUnavailable": 1  // number of calendar days unavailable
  },
  
  "notifications": {
    "alertOnDelay": true,
    "delayThreshold_minutes": 15,
    "alertOnCancellation": true,
    "alertEmail": "ann@opaltherapy.com.au",
    "alertSMS": false
  },
  
  "metadata": {
    "createdAt": "2026-05-10T10:30:00Z",
    "createdBy": "manual_entry",  // or "pnr_auto_fetch"
    "lastSyncedWith API": "2026-06-15T09:00:00Z",
    "syncFrequency": "1 hour",  // or "30 minutes" if within 24h of departure
    "notes": "Return flight MEL→PER on 2026-06-16 at 10:30",
    "archived": false
  }
}
```

### Travel Trip (Multi-leg)

For round-trips or multi-city itineraries:

```json
{
  "id": "TRAV-20260615-001",
  "title": "Melbourne Workshop + Client Visits",
  "startDate": "2026-06-15",
  "endDate": "2026-06-17",
  "legs": [
    {
      "legNumber": 1,
      "flightId": "FLT-20260615-001",
      "flightNumber": "QF123",
      "type": "outbound"
    },
    {
      "legNumber": 2,
      "flightId": "FLT-20260616-001",
      "flightNumber": "QF124",
      "type": "return"
    }
  ],
  "locations": ["Perth", "Melbourne"],
  "sessionsBlocked": 8,  // how many appointments can't be scheduled
  "totalKms": 1406,  // round-trip
  "travelLogEntry": "TLOG-TRAV-20260615-001"
}
```

---

## Workflow: Adding a Flight

### Step 1: Initiate Travel Block

User clicks "Add Travel" on calendar or from Smart Booking panel:

```html
<div class="modal" id="modal-add-flight">
  <h3>Add Business Travel</h3>
  
  <div class="stepper">
    <div class="step active">
      <div class="step-num">1</div>
      <span>Flight Details</span>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <span>Time Blocks</span>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <span>Review & Confirm</span>
    </div>
  </div>

  <!-- Step 1: Flight Details -->
  <div class="step-body">
    <p>How do you want to enter flight details?</p>
    
    <div class="options">
      <label class="option">
        <input type="radio" name="flight-entry" value="pnr" checked>
        <span><strong>Booking Reference (PNR)</strong></span>
        <span style="font-size:12px; color:#666;">Auto-fetch from airline (e.g., "ABC123")</span>
      </label>
      <label class="option">
        <input type="radio" name="flight-entry" value="manual">
        <span><strong>Manual Entry</strong></span>
        <span style="font-size:12px; color:#666;">Enter flight number, date, time manually</span>
      </label>
    </div>

    <div id="pnr-section">
      <div class="form-field">
        <label>Booking Reference (PNR) <span class="req">*</span></label>
        <input type="text" id="pnr-input" placeholder="e.g., ABC123" maxlength="6">
        <div class="hint">Found in your booking confirmation email or airline account</div>
      </div>

      <div class="form-field">
        <label>Airline <span class="req">*</span></label>
        <select id="airline-select">
          <option value="">— Select airline —</option>
          <option value="QF">Qantas Airways (QF)</option>
          <option value="VA">Virgin Australia (VA)</option>
          <option value="JQ">Jetstar (JQ)</option>
          <option value="UA">United Airlines (UA)</option>
          <option value="AA">American Airlines (AA)</option>
          <option value="BA">British Airways (BA)</option>
        </select>
      </div>

      <div class="form-field">
        <label>Last Name <span class="req">*</span></label>
        <input type="text" id="pnr-lastname" placeholder="As it appears on ticket" value="Mathew">
      </div>

      <button class="btn primary" onclick="fetchFlightViaPNR()">🔍 Fetch Flight Details</button>
      <div id="pnr-status" style="display:none; margin-top:10px;"></div>
    </div>

    <div id="manual-section" style="display:none;">
      <div class="form-field">
        <label>Flight Number <span class="req">*</span></label>
        <input type="text" id="flight-number" placeholder="e.g., QF123">
      </div>

      <div class="form-field">
        <label>Departure <span class="req">*</span></label>
        <div style="display:flex; gap:8px;">
          <input type="date" id="departure-date" />
          <input type="time" id="departure-time" />
          <select id="departure-airport">
            <option value="PER">Perth (PER)</option>
            <option value="SYD">Sydney (SYD)</option>
            <option value="MEL">Melbourne (MEL)</option>
          </select>
        </div>
      </div>

      <div class="form-field">
        <label>Arrival <span class="req">*</span></label>
        <div style="display:flex; gap:8px;">
          <input type="time" id="arrival-time" />
          <select id="arrival-airport">
            <option value="">— Select airport —</option>
            <option value="MEL">Melbourne (MEL)</option>
            <option value="SYD">Sydney (SYD)</option>
            <option value="BNE">Brisbane (BNE)</option>
            <option value="ADL">Adelaide (ADL)</option>
          </select>
        </div>
      </div>

      <div class="form-field">
        <label>Booking Reference (PNR) <span style="color:#999;">(optional)</span></label>
        <input type="text" id="pnr-manual" placeholder="For tracking/alerts">
      </div>
    </div>
  </div>
</div>
```

### Step 2: Specify Time Blocks

After flight details fetched/entered:

```html
<div class="step-body">
  <p><strong>QF123: Perth (PER) 14:30 → Melbourne (MEL) 16:45</strong></p>
  
  <h4>Pre-flight: Travel to Airport & Check-in</h4>
  <p style="font-size:12px; color:#666;">How much time before departure do you need?</p>
  
  <div class="form-grid">
    <div class="form-field">
      <label>Travel to airport (minutes)</label>
      <input type="number" id="travel-airport" value="30" min="15" max="120">
    </div>
    <div class="form-field">
      <label>Check-in & security (minutes)</label>
      <input type="number" id="checkin-time" value="60" min="30" max="180">
    </div>
    <div class="form-field">
      <label>Buffer (minutes)</label>
      <input type="number" id="preflight-buffer" value="30" min="0" max="60">
    </div>
  </div>
  
  <div style="background:#f5f5f5; padding:12px; border-radius:6px; margin:12px 0;">
    <strong>Ready to leave:</strong> <span id="ready-time">12:30</span> (2h 0m before departure)
  </div>

  <hr style="margin:16px 0; border:none; border-top:1px solid #ddd;">

  <h4>Post-flight: Baggage & Travel from Airport</h4>
  <p style="font-size:12px; color:#666;">How much time after landing do you need?</p>

  <div class="form-grid">
    <div class="form-field">
      <label>Taxiing & deplaning (minutes)</label>
      <input type="number" id="deplaning-time" value="15" min="10" max="30">
    </div>
    <div class="form-field">
      <label>Baggage claim (minutes)</label>
      <input type="number" id="baggage-time" value="30" min="15" max="60">
    </div>
    <div class="form-field">
      <label>Travel from airport (minutes)</label>
      <input type="number" id="travel-from-airport" value="45" min="15" max="120">
    </div>
  </div>

  <div style="background:#f5f5f5; padding:12px; border-radius:6px; margin:12px 0;">
    <strong>Available again:</strong> <span id="available-time">17:15</span> (1h 30m after landing)
  </div>

  <hr style="margin:16px 0; border:none; border-top:1px solid #ddd;">

  <h4>Calendar Blocking</h4>
  <p style="font-size:12px; color:#666;">This will block all appointments during travel time:</p>
  
  <div style="background:#fff4e0; padding:12px; border-radius:6px; border-left:3px solid #d97706;">
    <strong>📅 Blocked: Mon 15 Jun, 12:30 – Tue 16 Jun, 17:15 (Melbourne, QF123)</strong>
    <div style="font-size:12px; color:#666; margin-top:6px;">
      Conflicts with: <span style="color:#d97706; font-weight:600;">2 sessions</span> (reschedule needed)
    </div>
  </div>
</div>
```

### Step 3: Review & Confirm

```html
<div class="step-body">
  <h4>✅ Review Your Travel Block</h4>

  <div class="review-card">
    <div class="review-row">
      <span class="key">Flight:</span>
      <span class="value">QF123 (Qantas)</span>
    </div>
    <div class="review-row">
      <span class="key">Route:</span>
      <span class="value">Perth (PER) → Melbourne (MEL)</span>
    </div>
    <div class="review-row">
      <span class="key">Departure:</span>
      <span class="value">Mon 15 Jun, 14:30 AWST</span>
    </div>
    <div class="review-row">
      <span class="key">Arrival:</span>
      <span class="value">Mon 15 Jun, 16:45 AEST</span>
    </div>
    <div class="review-row">
      <span class="key">Booking Ref:</span>
      <span class="value">ABC123</span>
    </div>
  </div>

  <div class="review-card" style="margin-top:12px;">
    <div class="review-row">
      <span class="key">Unavailable:</span>
      <span class="value">Mon 12:30 – Mon 17:15</span>
    </div>
    <div class="review-row">
      <span class="key">Duration:</span>
      <span class="value">4h 45m</span>
    </div>
    <div class="review-row" style="background:#fff4e0;">
      <span class="key">⚠️ Conflicts:</span>
      <span class="value" style="color:#d97706; font-weight:600;">2 sessions need rescheduling</span>
    </div>
  </div>

  <div class="notification-settings">
    <h4>Delay & Cancellation Alerts</h4>
    <label class="checkbox">
      <input type="checkbox" id="alert-delay" checked>
      <span>Alert me if flight delayed by <input type="number" value="15" min="5" max="60" style="width:60px;"> minutes</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" id="alert-cancellation" checked>
      <span>Alert me if flight is cancelled</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" id="track-status" checked>
      <span>Continuously monitor flight status (until 24h before departure)</span>
    </label>
  </div>

  <div class="form-actions">
    <button class="btn" onclick="cancelFlight()">Cancel</button>
    <button class="btn primary" onclick="confirmFlight()">✅ Block Travel & Save Flight</button>
  </div>
</div>
```

---

## Real-Time Monitoring & Delay Handling

### Flight Status Polling

**Scheduler runs every 15 minutes** (more frequently as departure approaches):

```javascript
async function monitorFlightStatus(flightId) {
  const flight = await getFlightRecord(flightId);
  
  // Skip if already departed + landed
  if (flight.status.flightStatus === 'landed') return;
  
  // Skip if more than 48h away
  const hoursUntilDeparture = (new Date(flight.routing.departure.scheduledTime) - new Date()) / (1000 * 60 * 60);
  if (hoursUntilDeparture > 48) return;

  // Query flight API
  const liveStatus = await queryFlightAPI(flight.flightNumber, flight.routing.departure.airport.code, flight.routing.departure.scheduledTime);
  
  if (liveStatus.status !== flight.status.flightStatus || liveStatus.delayMinutes !== flight.status.delayMinutes) {
    updateFlightStatus(flightId, liveStatus);
    
    // Check if delay triggered threshold
    if (liveStatus.delayMinutes > flight.notifications.delayThreshold_minutes) {
      alertTherapistOfDelay(flightId, liveStatus);
      updateCalendarBlocks(flightId);  // shift blocked time
    }
    
    // Check if cancelled
    if (liveStatus.flightStatus === 'cancelled') {
      alertTherapistOfCancellation(flightId, liveStatus.cancellationReason);
      flagAllBlockedAppointments(flightId);  // highlight for rescheduling
    }
  }
}
```

### Delay Alert Example

When flight delayed by 30 minutes:

```html
<div class="alert-card" style="border-left:3px solid #d97706;">
  <div class="alert-icon">✈️</div>
  <div class="alert-body">
    <h3>Flight Delayed — QF123</h3>
    <p>Your flight to Melbourne is delayed by 30 minutes.</p>
    
    <div class="alert-details">
      <div><strong>New departure:</strong> 15:00 AWST (was 14:30)</div>
      <div><strong>Updated arrival:</strong> 17:15 AEST (was 16:45)</div>
      <div><strong>Reason:</strong> Aircraft maintenance</div>
      <div><strong>Last updated:</strong> 10 minutes ago</div>
    </div>

    <div class="calendar-impact" style="background:#fff4e0; padding:10px; margin-top:10px; border-radius:6px;">
      <strong>📅 Calendar updated:</strong> Your blocked travel time has been shifted to 12:30–17:45.
      <div style="font-size:12px; margin-top:5px;">
        No appointment conflicts. ✓
      </div>
    </div>

    <div class="actions" style="margin-top:12px;">
      <button class="btn small" onclick="viewUpdatedCalendar()">View Calendar</button>
      <button class="btn small" onclick="dismissAlert()">Dismiss</button>
    </div>
  </div>
</div>
```

---

## Integration Points

### 1. Splose Calendar Blocks

Each flight creates a busy-time in Splose:

```json
POST /busy-times {
  "title": "Travel: Perth → Melbourne flight QF123",
  "description": "Business travel. Flight QF123, PNR: ABC123. Delayed +30 min.",
  "start": "2026-06-15T12:30:00+08:00",
  "end": "2026-06-15T17:45:00+10:00",
  "practitionerIds": ["PR-001"],
  "busyTimeTypeId": "55337",  // "Travel" type
  "note": "Baggage claim, airport transit blocked. Return flight QF124 on 2026-06-16 10:30.",
  "recurringRule": null,
  "flightIntegration": {
    "flightId": "FLT-20260615-001",
    "flightNumber": "QF123",
    "pnr": "ABC123",
    "monitorForUpdates": true
  }
}
```

### 2. Travel Logbook Integration

Distance logged to travel logbook:

```javascript
// After flight confirmed
logTravel({
  type: 'flight',
  flightNumber: 'QF123',
  departureAirport: 'PER',
  arrivalAirport: 'MEL',
  distance_km: 703,  // look up airport pair distance
  date: '2026-06-15',
  purpose: 'Professional development workshop',
  client: null,  // non-client travel
  businessUse: 100
});
```

### 3. Appointment Conflict Resolution

When flight blocks calendar:

```javascript
async function findConflictingAppointments(flightId) {
  const flight = await getFlightRecord(flightId);
  const blockedStart = new Date(flight.timeBlocks.busyTimes[0].startTime);
  const blockedEnd = new Date(flight.timeBlocks.busyTimes[0].endTime);

  const conflicts = await queryAppointments({
    practitionerId: flight.practitioner_id,
    startTime_gt: blockedStart,
    startTime_lt: blockedEnd
  });

  return conflicts.map(appt => ({
    appointmentId: appt.id,
    clientName: appt.client.name,
    time: appt.startTime,
    duration: appt.duration,
    action: 'reschedule_required'
  }));
}
```

---

## Flight Status APIs

### Option 1: FlightAware (Recommended for Australia)

```javascript
const FLIGHTAWARE_API = 'https://api.flightaware.com/v2';

async function fetchFlightStatus(flightNumber, departureAirport, departureDate) {
  const response = await fetch(
    `${FLIGHTAWARE_API}/flight_info`,
    {
      headers: {
        'X-FlightAware-ApiKey': process.env.FLIGHTAWARE_API_KEY
      },
      body: JSON.stringify({
        ident: `${flightNumber}@${departureDate}`,  // QF123@20260615
        howManyFlights: 1
      })
    }
  );

  return response.json();  
  // Returns: { status, estimated_arrival_time, estimated_departure_time, ... }
}
```

**Cost:** ~$0.15 per flight lookup  
**Coverage:** Excellent for Australian domestic (Qantas, Virgin, Jetstar) + international

### Option 2: AviationEdge (Budget alternative)

```javascript
async function fetchFlightStatusAviationEdge(flightNumber, departureDate) {
  const response = await fetch(
    `https://aviation-edge.com/v2/public/flights?flightIata=${flightNumber}&departureDate=${departureDate}&key=${process.env.AVIATION_EDGE_KEY}`
  );
  return response.json();
}
```

**Cost:** ~$0.05 per flight  
**Coverage:** Good, but data slightly delayed (5–15 min)

### Option 3: Airline APIs (Qantas, Virgin, etc.)

Direct airline data via OAuth:

```javascript
// Qantas example
async function fetchViaQantasAPI(pnr, lastName) {
  const response = await fetch('https://api.qantas.com/booking/retrieve', {
    headers: {
      'Authorization': `Bearer ${qantasOAuthToken}`,
      'X-Qantas-Api-Key': process.env.QANTAS_API_KEY
    },
    body: JSON.stringify({ pnr, lastName })
  });

  return response.json();
  // Returns: { flightNumber, status, gate, terminal, boarding, ... }
}
```

**Cost:** Free (if Qantas partner program)  
**Coverage:** Only own airline flights  
**Best for:** Real-time status (gate, boarding, delays)

---

## UI Components for Mockup

### Flight Widget on Week View

```html
<div class="panel flight-widget">
  <h2>Travel Plans <span class="h2-sub">1 flight upcoming</span></h2>
  
  <div class="flight-card">
    <div class="flight-header">
      <span class="flight-number">QF123</span>
      <span class="airline">Qantas</span>
      <span class="status" style="background:#22c55e;">On Time</span>
    </div>

    <div class="flight-route">
      <div class="airport">
        <span class="code">PER</span>
        <span class="time">14:30</span>
      </div>
      <div class="divider">✈️ 135 min</div>
      <div class="airport">
        <span class="code">MEL</span>
        <span class="time">16:45</span>
      </div>
    </div>

    <div class="flight-details">
      <span>Mon 15 Jun • Booking: ABC123</span>
      <span>Seat 12A • Baggage: 1 checked</span>
    </div>

    <div class="flight-calendar-block">
      <strong>📅 Blocked: 12:30–17:15 (unavailable for sessions)</strong>
    </div>

    <div class="flight-actions">
      <button class="btn small" onclick="viewFlightDetails()">Details</button>
      <button class="btn small" onclick="editFlightDates()">Edit</button>
      <button class="btn small" onclick="cancelFlight()">Cancel Travel</button>
    </div>
  </div>

  <div class="flight-upcoming" style="margin-top:12px; font-size:12px; color:#666;">
    Return flight: QF124 on 16 Jun, 10:30 (blocked 08:30–11:45)
  </div>
</div>
```

### Settings Panel for Alerts

```html
<div class="panel">
  <h2>Flight Monitoring & Alerts</h2>

  <div class="form-section">
    <h4>Delay Alerts</h4>

    <div class="form-field">
      <label>Alert me if flight delayed by</label>
      <div style="display:flex; gap:8px; align-items:center;">
        <input type="number" value="15" min="5" max="60" style="width:80px;">
        <span>minutes</span>
      </div>
      <div class="hint">Automatically reschedule calendar blocks if delayed past this threshold</div>
    </div>

    <div class="form-field">
      <label>Notification method</label>
      <div class="checkbox-group">
        <label><input type="checkbox" checked> In-app notification</label>
        <label><input type="checkbox" checked> Email alert</label>
        <label><input type="checkbox"> SMS alert</label>
      </div>
    </div>
  </div>

  <hr style="margin:16px 0;">

  <div class="form-section">
    <h4>Status Monitoring</h4>

    <div class="form-field">
      <label>Continuous monitoring period</label>
      <select>
        <option>24 hours before departure (recommended)</option>
        <option>48 hours before departure</option>
        <option>72 hours before departure</option>
        <option>Until flight lands</option>
      </select>
      <div class="hint">More frequent updates closer to departure. Polling stops after flight lands.</div>
    </div>

    <div class="form-field">
      <label>Data source preference</label>
      <select>
        <option selected>FlightAware (comprehensive, recommended)</option>
        <option>Airline API (real-time gates, boarding)</option>
        <option>AviationEdge (budget, slight delay)</option>
        <option>Auto-select best available</option>
      </select>
    </div>
  </div>

  <div class="form-actions">
    <button class="btn primary">Save Settings</button>
  </div>
</div>
```

---

## Implementation Phases

### Phase 1: Core Flight Entry & Blocking (Week 1–2)
- [ ] Flight entry form (manual + PNR fetch UI)
- [ ] Time block configuration (pre/post flight buffers)
- [ ] Splose busy-time creation
- [ ] Appointment conflict detection & flagging
- [ ] Basic flight widget on week view

### Phase 2: Real-Time Monitoring (Week 3–4)
- [ ] Flight status polling scheduler
- [ ] Delay detection & alerts
- [ ] Calendar block auto-update
- [ ] Notification system (email, in-app)

### Phase 3: API Integration (Week 5)
- [ ] FlightAware API integration
- [ ] Qantas/Virgin/Jetstar OAuth setup
- [ ] PNR auto-fetch (booking lookup)
- [ ] Gate/terminal information display

### Phase 4: Travel Logbook Sync (Week 6)
- [ ] Flight distance lookup (airport pairs)
- [ ] Auto-log to travel logbook
- [ ] Annual report inclusion (separate from business travel)

---

## Example: Full Workflow

**Monday 10 May, 10:00 AM** — Ann plans Melbourne workshop

1. Clicks "Add Travel" on week of 15 June
2. Enters PNR: "ABC123", Airline: "Qantas"
3. System fetches: QF123, Perth→Melbourne, 14:30 departure
4. Ann specifies: 30 min to airport, 60 min check-in, 45 min from Melbourne airport
5. System calculates: blocked 12:30–17:45 (4h 15m)
6. Shows conflict: 2 appointments need rescheduling
7. Ann confirms flight block
8. System creates Splose busy-time + alerts for conflicts

**Friday 14 June, 14:00** — Flight monitoring active

1. Scheduler polls FlightAware every 15 minutes
2. Flight shows: "On time"
3. Gate info updates: "Gate 12" (system shows in widget)

**Monday 15 June, 13:45** — Flight delayed!

1. Scheduler detects: QF123 delayed +30 minutes (new departure 15:00)
2. Sends alert: "Flight delayed 30 min, calendar updated to 12:30–17:45"
3. System shifts Splose busy-time to new times
4. Calendar widget shows: "Delayed +30 min, updated ✓"
5. Ann gets email: "Your QF123 to Melbourne delayed. Calendar adjusted."

**Monday 15 June, 17:20** — Flight landed

1. Scheduler marks flight as "Landed"
2. Stops monitoring
3. Logs distance (703 km) to travel logbook
4. Updates busy-time in Splose: "Completed"

---

## Known Limitations & Future Enhancements

**Current scope:**
- Single flights / round-trips
- Australian domestic + major international airlines
- Alerts & calendar blocking only (no auto-rebooking)

**Future enhancements:**
- [ ] Multi-city itineraries (e.g., MEL→SYD→BNE)
- [ ] Alternative flight suggestions if cancelled
- [ ] Hotel booking integration (block accommodation nights)
- [ ] Per diem expense calculation
- [ ] Travel insurance recommendations
- [ ] Visa/document expiry tracking (for international travel)
- [ ] Travel budget tracking vs. Splose support-activities

---

## Cost Estimate

**API costs (monthly):**
- FlightAware: ~$2–5 (assuming 20–30 flights per month)
- Airline OAuth: Free (if partner program)
- Infrastructure: Negligible (polling runs on existing scheduler)

**Development effort:**
- UI forms + flows: 3–4 days
- Splose integration: 2 days
- API integration: 2–3 days
- Monitoring & alerts: 2 days
- Testing & refinement: 2 days
- **Total: 11–14 days** (2.5–3 weeks)

---

## Files to Create

1. `flight_tracker_feature.md` — This file (complete)
2. `flight_entry_form.html` — UI components for mockup
3. `flight_monitor.js` — Status polling + alert logic
4. `flight_api_client.js` — FlightAware/airline API integration
5. `flight_database_schema.sql` — Storage (flights table + monitoring logs)
