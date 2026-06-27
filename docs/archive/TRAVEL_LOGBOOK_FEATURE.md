# Travel Logbook & Accountant Report Feature

**Status:** Design phase  
**Created:** May 10, 2026  
**Tax method:** ATO Cents-per-kilometre (currently 66¢/km)  
**Reporting:** Annual summary (30 June financial year)

---

## Feature Overview

Automatically tracks business travel kilometres as the scheduler places sessions and calculates travel legs. Generates a formal annual logbook report suitable for submission to accountant and ATO compliance, supporting cents-per-km vehicle expense claims.

**Key requirements:**
- ✅ ATO-compliant logbook format (daily travel details)
- ✅ Annual summary report (downloadable PDF + CSV)
- ✅ Integration with Google Maps API for auto-calculated distances
- ✅ Client/case linkage for allocation tracking
- ✅ Cents-per-km rate calculation (66¢/km = current ATO rate)
- ✅ Year-end warning/verification system

---

## Data Model

### Travel Log Entry

```json
{
  "id": "TL-20260510-001",
  "dateTime": "2026-05-10T09:00:00",
  "date": "2026-05-10",
  "dayOfWeek": "Saturday",
  "startTime": "09:00",
  "endTime": "09:35",
  "duration_minutes": 35,
  
  "startLocation": {
    "name": "Willetton clinic",
    "address": "123 Main St, Willetton WA 6155",
    "latitude": -32.0234,
    "longitude": 115.8456,
    "type": "clinic"  // clinic, home, client_home, other
  },
  
  "endLocation": {
    "name": "Client home — Emma Rodriguez",
    "address": "45 Oak Ave, Gosnells WA 6110",
    "latitude": -32.0654,
    "longitude": 115.7890,
    "type": "client_home"
  },
  
  "purpose": "Therapy session",  // "Therapy session", "Travel home", "Case noting at home office", etc.
  
  "client": {
    "patientId": "PT-2891",
    "name": "Emma Rodriguez",
    "caseId": "C-4521",
    "ndisNumber": "1234567"
  },
  
  "sessionDetails": {
    "appointmentId": "APT-98765",
    "sessionType": "Therapy",
    "duration_minutes": 60,
    "startLocation": "Willetton clinic"
  },
  
  "travel": {
    "kms": 18.5,
    "source": "google_maps_api",  // or "manual_entry", "estimate"
    "route": {
      "points": [[lat1, lng1], [lat2, lng2], ...],
      "distance_meters": 18500,
      "duration_seconds": 1890
    }
  },
  
  "vehicle": {
    "id": "VEH-001",
    "name": "Toyota Corolla (White)",
    "registration": "WA 26 ABC",
    "fuelType": "Unleaded 91",
    "odometer_start": null,
    "odometer_end": null
  },
  
  "businessUse": {
    "isBusinessTravel": true,
    "percentBusiness": 100,  // if mixed use (e.g. errand en route)
    "note": null
  },
  
  "metadata": {
    "createdAt": "2026-05-10T09:35:00",
    "createdBy": "scheduler_auto",  // or "manual_entry"
    "editedAt": null,
    "flaggedForReview": false,
    "reviewNotes": null
  }
}
```

### Annual Logbook Summary

```json
{
  "id": "LOGBOOK-FY2026",
  "financialYear": "2025-2026",
  "periodStart": "2025-07-01",
  "periodEnd": "2026-06-30",
  "practitioner": {
    "name": "Ann Mary Mathew",
    "abr": "50 123 456 789",
    "profession": "Occupational Therapist"
  },
  
  "summary": {
    "totalEntries": 247,
    "totalDays": 208,
    "totalKms": 4256.5,
    "averageKmsPerDay": 20.5,
    "averageKmsPerTrip": 17.2,
    "businessUsePercent": 100
  },
  
  "claimSummary": {
    "method": "cents_per_km",
    "ratePerKm": 0.66,  // ATO rate (changes yearly)
    "totalClaimable": 2809.29,  // 4256.5 * 0.66
    "gstComponent": 255.39,  // if registered for GST
    "netClaim": 2553.90  // after GST
  },
  
  "monthlyBreakdown": [
    {
      "month": "July 2025",
      "kms": 385.2,
      "trips": 19,
      "days": 17,
      "claim": 254.23
    },
    // ... 11 more months
  ],
  
  "byClientType": [
    {
      "category": "Therapy sessions",
      "kms": 3200.5,
      "trips": 156,
      "percentOfTotal": 75.2
    },
    {
      "category": "Travel to home office (case notes)",
      "kms": 820.3,
      "trips": 68,
      "percentOfTotal": 19.3
    },
    {
      "category": "Travel to clinic (setup/admin)",
      "kms": 235.7,
      "trips": 23,
      "percentOfTotal": 5.5
    }
  ],
  
  "regionBreakdown": [
    {
      "region": "East",
      "kms": 1250.0,
      "clients": 8,
      "percentOfTravel": 29.4
    },
    {
      "region": "West",
      "kms": 1100.5,
      "clients": 6,
      "percentOfTravel": 25.9
    },
    {
      "region": "South",
      "kms": 1200.2,
      "clients": 5,
      "percentOfTravel": 28.2
    },
    {
      "region": "Central",
      "kms": 705.8,
      "clients": 3,
      "percentOfTravel": 16.6
    }
  ],
  
  "warnings": [
    {
      "type": "gap_in_recording",
      "date": "2025-10-15",
      "message": "No travel logged for 12 consecutive business days (Oct 15–28). Review for missing entries."
    },
    {
      "type": "unusual_distance",
      "date": "2026-02-03",
      "entry": "TL-20260203-045",
      "kms": 156.3,
      "message": "Distance significantly higher than usual (156 km). Verify Google Maps calculation."
    },
    {
      "type": "missing_odometer",
      "message": "No odometer readings recorded. For actual expenses method, odometer records are required."
    }
  ],
  
  "attestation": {
    "preparedBy": "Opal Therapy Scheduler v2.1",
    "preparedDate": "2026-06-30T17:00:00",
    "attestedBy": "Ann Mary Mathew",
    "attestedDate": null,
    "declaration": "I declare that the above logbook records accurately represent business travel undertaken during the financial year and that all entries are supported by contemporaneous documentation."
  }
}
```

---

## Splose Integration

The scheduler detects travel and logs automatically:

1. **After appointment creation:**
   ```
   Appointment created: Therapy session, 1 hour
   Start location: Willetton clinic
   End location: Client home (Gosnells)
   → Call Google Maps API: route from clinic to Gosnells
   → Create travel log entry with KMs
   ```

2. **After case noting blocks:**
   ```
   Busy-time created: Admin (case notes), 15 min
   Location: Home office
   Previous location: Client home (last session ended there)
   → Calculate travel: client home → home office
   → Log KMs
   ```

3. **Travel home at day end:**
   ```
   Last appointment ends: Willetton clinic, 17:00
   → If no evening admin blocks, assume return home
   → Create travel log: clinic → home address
   ```

**Queries used:**
```
GET /appointments?practitionerId={{id}}&start_gte={{date}}
  → extract startTime location, endTime location, duration

GET /busy-times?practitionerId={{id}}&start_gte={{date}}
  → extract location, duration, type (case noting, admin, travel)

GET /patients/{id}/home_address  (TBC — may not be exposed)
  → fallback to patient primary location address

GET /locations/{id}
  → clinic address, home office address
```

---

## Google Maps Integration

### API Calls

For each travel segment, query Routes API:

```bash
curl -X POST \
  https://routes.googleapis.com/directions/v2:computeRoutes \
  -H "Content-Type: application/json" \
  -d '{
    "origin": {
      "location": {
        "latLng": { "latitude": -32.0234, "longitude": 115.8456 }
      }
    },
    "destination": {
      "location": {
        "latLng": { "latitude": -32.0654, "longitude": 115.7890 }
      }
    },
    "travelMode": "DRIVE",
    "routingPreference": "TRAFFIC_AWARE",
    "computeAlternativeRoutes": false
  }' \
  -H "X-Goog-Api-Key: YOUR_API_KEY"
```

**Response:**
```json
{
  "routes": [
    {
      "legs": [
        {
          "startLocation": { "latLng": {...} },
          "endLocation": { "latLng": {...} },
          "duration": "1890s",           // 31.5 minutes
          "distanceMeters": 18500        // 18.5 km
        }
      ]
    }
  ]
}
```

### Fallback: Manual Entry + Estimate

If API fails:
1. Show user map with start/end points
2. Ask to confirm or manually enter KMs
3. Flag entry as "manual_entry" (not API-sourced)

---

## Report Generation

### Annual PDF Report (ATO Format)

**File:** `TravelLogbook_FY2026_AnnMaryMathew.pdf`

**Structure:**
```
┌─────────────────────────────────────────────┐
│         TRAVEL LOGBOOK REPORT               │
│   FINANCIAL YEAR 1 JULY 2025–30 JUNE 2026   │
│                                             │
│   Practitioner: Ann Mary Mathew             │
│   Profession: Occupational Therapist        │
│   ABR: 50 123 456 789                       │
│                                             │
│   Tax Method: Cents-per-kilometre           │
│   ATO Rate: $0.66/km (FY2026)               │
│   Generated: 30 June 2026                   │
└─────────────────────────────────────────────┘

EXECUTIVE SUMMARY
─────────────────────
Total business kilometres: 4,256.5 km
Total trips logged: 247
Average per day: 20.5 km
Estimated tax deduction: $2,809.29
GST component: $255.39


MONTHLY BREAKDOWN
─────────────────────
[Table: Month | KMs | Trips | Days | Deduction]
July 2025      385.2   19    17    $254.23
August 2025    412.1   21    19    $272.00
...
June 2026      398.7   18    16    $263.15
──────────────────────────────────
TOTAL        4,256.5  247   208  $2,809.29


REGIONAL DISTRIBUTION
─────────────────────
[Chart/Table: Region breakdown of travel]
East (29.4%)    South (28.2%)    West (25.9%)    Central (16.6%)


TRAVEL PURPOSE ANALYSIS
─────────────────────────
Therapy sessions:        3,200.5 km (75.2%)
Home office (case notes):  820.3 km (19.3%)
Clinic/admin travel:       235.7 km (5.5%)


LOGBOOK ENTRIES DETAIL
─────────────────────────
[Full table: Date | Time | From | To | Purpose | Client | KMs]

2025-07-01  09:00  Willetton clinic → Gosnells (Emma Rodriguez)    Therapy  C-4521   18.5
2025-07-01  10:45  Gosnells → Willetton clinic                      Travel   —        18.5
2025-07-01  14:00  Willetton clinic → Mt Lawley (James Wellington)  Therapy  C-4687   12.3
...


WARNINGS & NOTES
─────────────────
⚠ Gap detected: Oct 15–28 (12 consecutive business days with no logging)
  → Action: Review calendar for missed entries or non-working period

⚠ Unusual distance: Feb 3, 2026 (156.3 km)
  → Entry TL-20260203-045: Verified with Google Maps


ACCOUNTANT NOTES
─────────────────
• All entries generated by Opal Therapy Scheduler (v2.1)
• Distances sourced from Google Maps Routes API
• Business use: 100% (no personal commuting included)
• Recommended: Cross-check sample week with odometer readings
• GST: Adjust if business is GST-registered


DECLARATION
─────────────
I declare that the above logbook records accurately represent 
business travel undertaken during the financial year and that 
all entries are supported by contemporaneous documentation.

Prepared by: Opal Therapy Scheduler v2.1
Prepared date: 30 June 2026
Attested by: [Signature] Ann Mary Mathew
Attested date: ________________

```

### CSV Export

**File:** `TravelLogbook_FY2026_AnnMaryMathew.csv`

```csv
Date,Day,Start Time,End Time,From,To,Purpose,Client Name,Case ID,KMs,Google Maps Distance,Verified
2025-07-01,Tuesday,09:00,09:35,Willetton clinic,Gosnells (client home),Therapy,Emma Rodriguez,C-4521,18.5,18500m,Yes
2025-07-01,Tuesday,10:45,11:20,Gosnells,Willetton clinic,Return travel,—,—,18.5,18500m,Yes
2025-07-01,Tuesday,14:00,14:32,Willetton clinic,Mt Lawley (client home),Therapy,James Wellington,C-4687,12.3,12300m,Yes
...
```

---

## Dashboard Integration

### Travel Log Widget (mockup_v2.html)

**Location:** Right sidebar on week view or new "Travel" tab

```html
<div class="panel travel-widget">
  <h2>Today's Travel <span class="h2-sub">{{totalKmsToday}} km logged</span></h2>
  
  <div class="travel-list">
    <div class="travel-entry">
      <span class="time">09:00 – 09:35</span>
      <span class="route">Willetton clinic → Gosnells</span>
      <span class="client">Emma Rodriguez</span>
      <span class="kms">18.5 km</span>
    </div>
    <div class="travel-entry">
      <span class="time">10:45 – 11:20</span>
      <span class="route">Gosnells → Willetton clinic</span>
      <span class="client">—</span>
      <span class="kms">18.5 km</span>
    </div>
    <!-- ... -->
  </div>
  
  <div class="travel-summary">
    <strong>Today total:</strong> 52.1 km ({{ 52.1 * 0.66 | currency }})
    <strong style="margin-left:12px;">Week total:</strong> 387.5 km ({{ 387.5 * 0.66 | currency }})
    <strong style="margin-left:12px;">FY total:</strong> 4,256.5 km ({{ 4256.5 * 0.66 | currency }})
  </div>
</div>
```

### Year-End Report Generator

**Accessible from:** Settings → "Download Annual Report"

```html
<div class="report-generator">
  <h3>Generate Annual Travel Logbook</h3>
  
  <div class="form-field">
    <label>Financial year</label>
    <select id="report-year">
      <option value="2026">FY 2025–2026 (1 Jul 2025 – 30 Jun 2026)</option>
      <option value="2025">FY 2024–2025 (1 Jul 2024 – 30 Jun 2025)</option>
    </select>
  </div>
  
  <div class="form-field">
    <label>Include</label>
    <div class="checkbox-group">
      <label><input type="checkbox" checked> Daily entry details</label>
      <label><input type="checkbox" checked> Monthly summary</label>
      <label><input type="checkbox" checked> Regional breakdown</label>
      <label><input type="checkbox" checked> Warnings & discrepancies</label>
    </div>
  </div>
  
  <div class="form-field">
    <label>Format</label>
    <div class="radio-group">
      <label><input type="radio" name="format" value="pdf" checked> PDF (printable, accountant-ready)</label>
      <label><input type="radio" name="format" value="csv"> CSV (import to spreadsheet)</label>
      <label><input type="radio" name="format" value="both"> Both PDF + CSV</label>
    </div>
  </div>
  
  <div class="form-field">
    <label>ATO Rate per km for FY2026</label>
    <input type="number" id="ato-rate" value="0.66" step="0.01">
    <div class="hint">Update if ATO rate changes. Current: $0.66/km</div>
  </div>
  
  <div class="form-actions">
    <button class="btn" onclick="previewReport()">Preview</button>
    <button class="btn primary" onclick="downloadReport()">📥 Download Report</button>
  </div>
</div>
```

---

## Storage & Backend

### Where travel logs are stored:

**Option A: Local Storage (mockup phase)**
```javascript
localStorage.setItem('travelLogs_FY2026', JSON.stringify(travelLogsArray));
```

**Option B: Backend (production)**
```
POST /api/travel-logs (create entry)
GET /api/travel-logs?month=2026-05 (fetch by month)
GET /api/travel-logs/summary?fy=2026 (fetch annual summary)
POST /api/travel-logs/report (generate and download)
```

### Integration with Splose:

Travel logs are **not stored in Splose** (they're practice management, not appointments). They live in Opal Therapy's own database:
- SQLite (local) or PostgreSQL (production)
- Synced with appointments/busy-times via Splose API polling

---

## ATO Compliance Notes

### Logbook Requirements (ATO Publication 4.2.2)

✅ **Opal Therapy logbook meets these requirements:**

- **Date of travel** — ✅ Recorded in ISO format (YYYY-MM-DD)
- **Destination of each trip** — ✅ Start & end location with address
- **Business purpose** — ✅ "Therapy session", "Case notes", etc.
- **Distance travelled** — ✅ Auto-calculated via Google Maps API
- **Odometer readings** — ⚠️ Optional field; manual entry if needed

### Cents-per-km rate (current FY2026):

- **Rate:** $0.66 per kilometre (updated each financial year by ATO)
- **No need to:** Prove actual fuel costs, maintenance, registration, insurance
- **Must keep:** This logbook + supporting documentation (appointments calendar, clinic location)

### What NOT to claim:

- ❌ Commuting to/from home (unless "home office" is verified work location)
- ❌ Travel for social/personal purposes mixed in
- ❌ Parking fees or tolls (separate expense claim if needed)
- ❌ Meals or accommodation (different category)

### Recommendations:

1. **Sample week odometer verification:** Have Ann record actual odometer for a week in June → compare with logged distances (should be within ±5%)
2. **Monthly reconciliation:** Accountant spot-checks 1–2 entries per month
3. **Documentation retention:** Keep this logbook + appointment calendar + clinic location records for 5 years

---

## Implementation Steps

### Phase 1: Auto-logging (near-term)
1. ✅ Design data model (above)
2. ⏳ Integrate with scheduler: after appointment/busy-time creation, call Google Maps API
3. ⏳ Store logs in local database (SQLite or IndexedDB)
4. ⏳ Display travel widget in mockup_v2 week view

### Phase 2: Annual Reporting (medium-term)
1. ⏳ Build PDF generator (use jsPDF or similar)
2. ⏳ Build CSV exporter
3. ⏳ Add report settings page
4. ⏳ Add ATO compliance warnings & verification system

### Phase 3: Backend Sync (production)
1. ⏳ Create travel-logs REST API
2. ⏳ Sync logs to secure backend
3. ⏳ Archive by financial year
4. ⏳ Integrate with accounting software (Xero, MYOB, etc.)

---

## Files to Create

1. `travel_logbook_data_model.sql` — Database schema for SQLite/PostgreSQL
2. `travel_logger.js` — Auto-logging logic (integrates with scheduler)
3. `travel_report_generator.js` — PDF + CSV generation
4. `mockup_v2_travel_widget.html` — UI additions for mockup
5. `ato_compliance_checker.js` — Warning system for gaps/discrepancies
