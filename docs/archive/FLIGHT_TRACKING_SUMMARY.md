# Flight Tracking Feature — Summary & Integration

**Created:** May 10, 2026  
**Status:** Design complete, ready for implementation  
**Effort:** 11–14 days development (2.5–3 weeks)

---

## What You Get

A complete flight management system that:

1. **Flight Entry (Manual + PNR Auto-Fetch)**
   - Ann enters booking reference (PNR) like "ABC123"
   - System auto-fetches flight details from airline database
   - Fallback to manual entry (flight number, date, time)

2. **Time Blocking**
   - Ann specifies buffers: travel to airport, check-in, security (pre-flight)
   - App calculates exact blocked time (e.g., 12:30–17:45 for 14:30 departure)
   - Auto-detects appointment conflicts
   - Creates Splose busy-time blocks

3. **Real-Time Monitoring**
   - Queries FlightAware API every 15 minutes
   - Alerts Ann if flight delayed, cancelled, or gate changed
   - Auto-updates calendar blocks if delayed
   - Monitors until flight lands

4. **Integration**
   - Blocks time in Splose calendar
   - Logs distance to travel logbook
   - Flags appointment conflicts for rescheduling
   - Displays flight status + gate/terminal info

---

## How It Works (Example)

**Scenario:** Ann has a therapy workshop in Melbourne on June 15

1. **Add Flight:** Clicks "Add Travel" → enters PNR "ABC123" + airline
2. **System fetches:** QF123, Perth→Melbourne, 14:30 departure
3. **Ann sets buffers:** 
   - Pre-flight: 30 min travel + 60 min check-in = ready to leave 12:30
   - Post-flight: 45 min airport → destination
   - Blocked: 12:30–17:45
4. **System alerts:** "2 appointments conflict, need rescheduling"
5. **Ann confirms:** Flight block saved, Splose busy-time created

**Next day (15 June, 13:45)**
- ✈️ Flight delayed +30 min (new departure 15:00)
- 📧 Email alert: "QF123 delayed, calendar updated to 12:30–17:45"
- 📅 Splose block auto-shifted to new times
- ✓ No appointment conflicts after update

**Landing (17:20)**
- ✓ Flight marked "Landed"
- 📊 Distance (703 km) logged to travel logbook
- ⏹️ Monitoring stops

---

## Key Features

| Feature | Benefit | Example |
|---------|---------|---------|
| **PNR Auto-Fetch** | No manual data entry | Enter "ABC123" → system gets QF123 details |
| **Time Block Config** | Flexible for different traveler types | 30 min to airport for domestic, 90 min for international |
| **Delay Detection** | Never miss schedule changes | Delay +45 min → alert + calendar auto-adjusted |
| **Conflict Flagging** | Know which sessions need rescheduling | "2 sessions on 15 Jun need new time" |
| **Real-Time Status** | Gate/terminal info before departure | "Gate 12, Terminal 1" |
| **Travel Logbook Sync** | Automatic distance tracking | 703 km Perth↔Melbourne auto-logged |

---

## Technical Highlights

**APIs Used:**
- FlightAware (recommended): $0.15 per lookup, excellent Australian coverage
- Airline APIs: Free if partner, real-time gates + boarding
- AviationEdge: $0.05 per lookup, budget alternative

**Status Monitoring:**
- Polling every 15 minutes (more frequent closer to departure)
- Stops after flight lands
- Configurable delay threshold (default: 15 min)
- Email + in-app notifications

**Calendar Integration:**
- Creates Splose busy-time automatically
- Updates existing blocks if flight delayed
- Tracks via `flightIntegration` metadata
- Linked to travel logbook records

---

## Implementation Roadmap

| Phase | Duration | Tasks |
|-------|----------|-------|
| **1** | Week 1–2 | Flight entry form, time blocks, Splose integration, conflict detection |
| **2** | Week 3–4 | Status monitoring, delay alerts, calendar auto-updates |
| **3** | Week 5 | FlightAware/airline API integration, PNR auto-fetch |
| **4** | Week 6 | Travel logbook sync, distance lookup, annual report |

**Start after:** Travel logbook + dormant cases integrated (May 20+)  
**Recommended:** June 2026 implementation

---

## Data Storage

### Flights Table
```sql
CREATE TABLE flights (
  id VARCHAR(20) PRIMARY KEY,
  flight_number VARCHAR(10) NOT NULL,
  pnr VARCHAR(6),
  airline_code VARCHAR(2),
  departure_airport VARCHAR(3),
  arrival_airport VARCHAR(3),
  departure_time TIMESTAMP,
  arrival_time TIMESTAMP,
  actual_departure TIMESTAMP,
  actual_arrival TIMESTAMP,
  status VARCHAR(20),  -- scheduled, ontime, delayed, cancelled, landed
  delay_minutes INT,
  created_at TIMESTAMP,
  splose_busy_time_id VARCHAR(20),
  INDEX (pnr),
  INDEX (departure_time)
);

CREATE TABLE flight_monitoring (
  id INT AUTO_INCREMENT PRIMARY KEY,
  flight_id VARCHAR(20),
  check_timestamp TIMESTAMP,
  status_before VARCHAR(20),
  status_after VARCHAR(20),
  delay_before INT,
  delay_after INT,
  alert_sent BOOLEAN,
  calendar_updated BOOLEAN,
  FOREIGN KEY (flight_id) REFERENCES flights(id)
);
```

---

## Questions & Decisions for Antony

1. **API Preference:**
   - FlightAware (recommended, comprehensive) — costs ~$2–5/month for typical use
   - Airline APIs (free if partner program, but more setup)
   - Budget alternative (AviationEdge, slight delay)

2. **Monitoring Detail Level:**
   - Gate & terminal info display?
   - Real-time boarding status?
   - Baggage carousel info?

3. **Auto-Rebooking:**
   - If flight cancelled, auto-suggest alternatives?
   - (Out of scope for v1, but good to decide)

4. **International Travel:**
   - What airlines are priorities? (Qantas, Virgin, international carriers?)
   - Need visa/documents expiry tracking?

---

## File Delivered

- **[FLIGHT_TRACKING_FEATURE.md](computer:///Users/antonyxavier/Documents/Claude/Projects/Therapy%20Scheduling%20Application/FLIGHT_TRACKING_FEATURE.md)** (14KB)
  - Complete technical specification
  - UI mockups & workflows
  - API integration options
  - Database schema
  - Example scenarios

---

## Next Steps

1. Review `FLIGHT_TRACKING_FEATURE.md`
2. Answer questions above (API choice, monitoring detail, international scope)
3. Schedule implementation after travel logbook is integrated (late June recommended)
4. Once decision made: 11–14 day development cycle

---

## Integration with Other Features

**Synergies:**
- ✅ Works with travel logbook (auto-logs KMs)
- ✅ Uses Google Maps (airport to destination distance)
- ✅ Integrates with Splose calendar (creates busy-times)
- ✅ Flags dormant cases (different region = could reconnect)

**Not blocking any other features:**
- Can be implemented independently
- Doesn't require changes to Splose API
- Runs as optional feature

---

## Cost & Timeline

**Implementation time:** 11–14 days (2.5–3 weeks)  
**API costs:** ~$2–5/month (included in FlightAware plan)  
**Recommended start:** After travel logbook integration (late June 2026)

---

**Ready to proceed?** This feature is a powerful differentiator for multi-location therapists. Let me know when you want to move forward with development!
