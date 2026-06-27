# Travel Logbook Implementation Guide

**Status:** Complete design & code (ready to integrate)  
**Created:** May 10, 2026  
**Tax compliance:** ATO cents-per-km method (FY2026: $0.66/km)

---

## Quick Overview

Your therapy scheduler now tracks business travel kilometres automatically and generates formal annual logbooks suitable for accountant submission.

**What happens:**
1. When scheduler creates an appointment or travel block, it calculates the distance via Google Maps API
2. Distance logged automatically in travel logbook with client, session type, and date/time
3. At financial year-end (30 June), download professional PDF + CSV report for your accountant
4. Report includes: daily travel details, monthly summaries, regional breakdown, ATO compliance notes

**Value:**
- ✅ Supports $0.66/km ATO deduction (no need to track fuel receipts)
- ✅ Professional format — ready for accountant / tax office
- ✅ Automatic calculation — no manual entry needed
- ✅ ATO-compliant warnings for gaps and anomalies

---

## Files Created

### 1. **TRAVEL_LOGBOOK_FEATURE.md** (14KB)
Comprehensive specification document covering:
- Data model for travel log entries
- Annual logbook summary structure
- Splose integration points
- Google Maps API integration
- Report generation (PDF format)
- ATO compliance requirements
- Implementation phases

**Use this for:** Understanding requirements, architecture decisions, ATO rules.

### 2. **travel_logger.js** (11KB)
Core logging engine. Auto-captures travel when scheduler creates appointments.

**Functions:**
```javascript
logTravelForAppointment(appointmentData)
  // Called after appointment created
  // → Calculates distance via Google Maps
  // → Stores travel log entry

getTravelLogs(startDate, endDate)
  // Retrieve logs for date range
  
getTravelSummary(startDate, endDate)
  // Get summary: total KMs, days, breakdown by client
  
getFinancialYearSummary(year)
  // Full annual summary with monthly breakdown + warnings
```

**How to integrate:**
1. After `POST /appointments` creates new appointment in Splose
2. Call `logTravelForAppointment()` with appointment details
3. Logger auto-calls Google Maps API for distance
4. Entry saved to IndexedDB (local database)

**Storage:** IndexedDB (browser) or SQLite/PostgreSQL (backend)

### 3. **travel_report_generator.js** (10KB)
Creates formal reports for accountant submission.

**Functions:**
```javascript
generateAnnualReport(financialYear, options)
  // Generates PDF or CSV (or both)
  // Returns downloadable file
  
downloadReport(report)
  // Trigger browser download
  
downloadBothReports(financialYear)
  // Download both PDF and CSV
```

**Output examples:**
- `TravelLogbook_FY2026_AnnMaryMathew.pdf` — Professional report with monthly breakdown, daily details, warnings
- `TravelLogbook_FY2026_AnnMaryMathew.csv` — Raw data for import to spreadsheet/accounting software

---

## Integration Checklist

### Phase 1: Frontend (mockup_v2.html)

- [ ] Add travel logger widget to week view (right sidebar)
  - Shows: today's total KMs, week total, FY total
  - Display format: "52.1 km today ($34.39) | Week: 387.5 km ($255.75) | FY: 4,256.5 km ($2,809.29)"

- [ ] Add report generator panel to settings
  - Button: "Download Annual Report"
  - Options: format (PDF/CSV/both), financial year, ATO rate, inclusions

- [ ] Import dependencies:
  - jsPDF: `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js`
  - travel_logger.js (local)
  - travel_report_generator.js (local)

### Phase 2: Backend Integration

- [ ] After `POST /appointments` (create appointment in Splose):
  ```javascript
  const travel = await logTravelForAppointment({
    appointmentId: appointmentData.id,
    clientName: client.name,
    clientId: client.id,
    caseId: case.id,
    sessionType: service.name,  // "Therapy", "Initial", etc.
    sessionDuration: service.duration,
    startTime: appointment.startTime,
    location: location,  // clinic location
    previousLocation: practitionerLastLocation
  });
  ```

- [ ] Database: Create travel_logs table
  ```sql
  CREATE TABLE travel_logs (
    id VARCHAR(20) PRIMARY KEY,
    date DATE NOT NULL,
    datetime TIMESTAMP NOT NULL,
    start_location TEXT,
    end_location TEXT,
    kms DECIMAL(6,1),
    client_id VARCHAR(20),
    case_id VARCHAR(20),
    session_type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_date (date),
    INDEX idx_client (client_id)
  );
  ```

- [ ] REST API endpoints:
  ```
  GET /api/travel-logs?start={{date}}&end={{date}}
    → List of travel entries
  
  GET /api/travel-logs/summary?fy={{year}}
    → Annual summary with monthly breakdown
  
  POST /api/travel-logs/report?fy={{year}}&format={{pdf|csv|both}}
    → Download report
  ```

### Phase 3: Google Maps Setup

- [ ] Already configured from GOOGLE_MAPS_SETUP.md
- [ ] Ensure Routes API enabled in Google Cloud Console
- [ ] Verify API key has been pasted into mockup (or backend proxy is configured)

### Phase 4: Testing

- [ ] Create test appointments with known start/end locations
- [ ] Verify distances match manual Google Maps check (within ±5%)
- [ ] Generate sample FY2025 report (using backfilled test data)
- [ ] Verify PDF formatting and CSV import to Excel/Xero/MYOB

---

## ATO Compliance Checklist

✅ **Logbook must include:**
- [x] Date of each trip
- [x] Destination (start & end locations)
- [x] Business purpose (session type + client name)
- [x] Distance travelled (sourced from Google Maps)
- [ ] Odometer readings (optional, but recommended for verification)

⚠️ **Recommendations for Ann:**
1. **Weekly verification:** Pick one week in June each year → check 2–3 actual odometer readings vs. logged distances (should be within ±5%)
2. **Keep supporting docs:** Print annual logbook + keep appointment calendar for 5 years
3. **ATO correspondence:** If audited, provide this logbook + sample week odometer check

---

## Usage Instructions for Ann

### Daily

Travel logs are created automatically. No action needed. You'll see updated totals in the travel widget on your scheduler.

### Monthly

Optional: Review the travel widget for any gaps or unusual distances. If you spot an error, edit the entry (or mark for manual correction).

### Year-End (30 June)

1. Go to Settings → "Download Annual Report"
2. Select:
   - Financial year: FY 2025–2026
   - Format: PDF + CSV (recommended for accountant)
   - ATO rate: $0.66/km (default; update if changed)
3. Click "Download Report"
4. Send PDF to your accountant with your tax return
5. Keep CSV in your files for 5 years

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Distances seem off | Google Maps API not returning results | Check API key setup, verify locations have valid addresses |
| Gap in logging (12+ days) | Scheduler not running / holidays not logged | Add holiday blocks as busy-times in Splose; check scheduler logs |
| Distance > 2x average | Unusual trip (client moved, long distance) | Right-click entry → "Flag for review" and add note |
| Odometer reading ≠ logged KMs | Natural variation in routes / traffic | Within ±10% is acceptable; >10% = investigate |
| PDF won't open | jsPDF library not loaded | Verify script tag in HTML, check browser console for errors |

---

## Data Examples

### Single Travel Log Entry

```json
{
  "id": "TL-2026-05-10-A2B3C",
  "date": "2026-05-10",
  "dayOfWeek": "Saturday",
  "startTime": "09:00",
  "endTime": "09:35",
  "startLocation": {
    "name": "Willetton clinic",
    "address": "123 Main St, Willetton WA 6155"
  },
  "endLocation": {
    "name": "Client home — Emma Rodriguez",
    "address": "45 Oak Ave, Gosnells WA 6110"
  },
  "purpose": "Therapy session",
  "client": {
    "patientId": "PT-2891",
    "name": "Emma Rodriguez",
    "caseId": "C-4521"
  },
  "travel": {
    "kms": 18.5,
    "source": "google_maps_api"
  }
}
```

### Annual Summary Example (FY2026)

```json
{
  "financialYear": "2025-2026",
  "totalEntries": 247,
  "totalDays": 208,
  "totalKms": 4256.5,
  "averageKmsPerDay": 20.5,
  "totalClaim": 2809.29,
  "warnings": [
    {
      "type": "gap_in_recording",
      "date": "2025-10-15",
      "message": "No travel logged for 12 consecutive business days"
    }
  ]
}
```

---

## Cost & Privacy

### Google Maps API Cost
- Estimated: $0.05–0.10/month for single practitioner
- Included in free $200/month trial credit
- Never charged without explicit opt-in

### Data Privacy
- Travel logs stored locally (IndexedDB) until downloaded
- Passwords/payment info: never collected
- NDIS client details: stored securely, not shared

---

## Future Enhancements

**Phase 2 (next quarter):**
- [ ] Odometer entry UI (manual override if GPS data wrong)
- [ ] Actual expenses method reports (fuel, maintenance, insurance breakdown)
- [ ] Quarterly email summaries to accountant
- [ ] Integration with Xero/MYOB for automated deduction entry

**Phase 3 (future):**
- [ ] Multi-vehicle tracking (if Ann uses different cars)
- [ ] Mileage reimbursement claims (for associate therapists)
- [ ] Vehicle maintenance scheduling tied to KMs
- [ ] Carbon footprint tracking (non-tax purpose)

---

## Support

**Questions?** Check the main feature doc: `TRAVEL_LOGBOOK_FEATURE.md`

**Feedback for accountant?** Download the PDF and share with them before year-end. Their comments will help refine the report format for future years.
