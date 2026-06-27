# Current Status Dashboard — May 10, 2026

**Last Updated:** Today, 08:22 AWST  
**Files Active:** mockup_v3.html (7,235 lines), 14+ supporting docs  
**Status:** 3 features ready, 3 awaiting decisions, 1 quick fix needed

---

## 📊 Feature Completion Matrix

| # | Feature | Status | Ready? | Effort | Blocker | Next Step |
|---|---------|--------|--------|--------|---------|-----------|
| 1 | **Dormant Cases** | ✅ COMPLETE | YES | 2–3h | None | **Integrate into mockup_v3** |
| 2 | **Travel Logbook** | ✅ COMPLETE | YES | 4–6h | None | **Integrate into mockup_v3** |
| 3 | **Flight Tracking** | ✅ DESIGN | YES | 11–14d | API choice | Decide on API → Code |
| 4 | **Case Noting** | 🟡 DESIGN | No | 3–4d | **Ann decision** | Busy-time type? |
| 5 | **Client Reminders** | 🟡 DESIGN | No | 4–5d | **Antony decision** | SMS gateway choice? |
| 6 | **Credentials** | 🟡 DESIGN | No | 6–7d | **Antony decision** | Storage location? |
| 7 | **Flex Hours** | 🟢 TRIVIAL | YES | 15 min | None | **Fix CSS today** |

---

## 🚨 What Needs Fixing NOW

### 1. **Flexible Work Hours** (15 minutes — Do This Today)
**Current issue:** Calendar greys out times outside 9–5 AM  
**Fix:** Remove `.non-working-hours { opacity: 0.3; }` from mockup_v3.html CSS  
**Impact:** Therapist can now book sessions at any time (early starts, evening clinics)

### 2. **Integration of 2 Complete Features** (6–10 hours — Do This This Week)
mockup_v3.html already has the UI tabs/sections but **needs backend logic**:

**Dormant Cases:**
- [ ] Connect to Splose API: fetch cases with `last_invoice_date`, `last_note_date`, `last_appointment_date`
- [ ] Implement 6-week detection algorithm
- [ ] Wire up "Run Check Now" button
- [ ] Show live dormant case count in tab badge
- [ ] Add email alert preview in modal

**Travel Logbook:**
- [ ] Connect to Splose API: fetch all appointments + locations
- [ ] Calculate distances via Google Maps API
- [ ] Display monthly KM breakdown
- [ ] Wire up "Download Report" button (generates PDF)
- [ ] Add year-end summary calculation

### 3. **Decisions Blocking 3 Features** (Required Before Dev)

#### **For Ann (Case Noting):**
- [ ] Should case-note suggestions use existing "Admin" busy-time-type, or create new dedicated type?
  - **If existing:** Code maps to current purple Admin blocks
  - **If new:** Need to create new Splose busy-time-type first

#### **For Antony (Client Reminders):**
- [ ] SMS gateway preference: Twilio, AWS SNS, or MessageBird?
  - Recommendation: **Twilio** (~$0.02/SMS, most reliable for Australia)
  - Fallback: Email only (no SMS cost)
- [ ] Email fallback if no mobile number? (Yes/No)

#### **For Antony (Credentials Tracking):**
- [ ] Store credentials in Splose profile extension or local database table?
  - **Splose:** Simpler, lives in therapist profile
  - **Local DB:** More flexible, easier to add custom fields
- [ ] Block scheduling if credential expired? (Hard block or soft warning?)

#### **For Antony (Flight Tracking):**
- [ ] API choice: FlightAware (recommended), AviationEdge (budget), or airline APIs?
- [ ] Which airlines are priorities for auto-fetch? (Qantas, Virgin, others?)

---

## ✅ What's Ready Now

### **Complete & Documented:**
- ✅ Dormant Cases — scheduler, detection logic, email template
- ✅ Travel Logbook — logger, report generator, ATO compliance
- ✅ Flight Tracking — full spec, API options, time-blocking logic
- ✅ Case Noting — UI flow, scheduling algorithm
- ✅ Client Reminders — SMS/email templates, delivery logic
- ✅ Credentials Tracking — expiry alert rules, email templates

### **Code Available (in workspace):**
- `dormant_cases_scheduler.js` — 12KB, ready to integrate
- `travel_logger.js` — 11KB, ready to integrate
- `travel_report_generator.js` — 10KB, ready to integrate
- `FLIGHT_TRACKING_FEATURE.md` — 14KB full spec, ready to code

### **Mockup Status:**
- `mockup_v3.html` — 7,235 lines with all new tabs + view sections
  - ✅ UI layout for all 4 new tabs (Dormant Cases, Travel & Flights, Logbook, Settings)
  - ✅ Forms for all features (flight entry, manual travel, settings)
  - ✅ Empty data displays (waiting for Splose API integration)
  - ⏳ JavaScript logic needs wiring to actual APIs

---

## 🎯 Recommended Sequence

### **THIS WEEK (May 10–17)**
1. **Today (15 min):** Remove 9–5 greyout → test flexible hours
2. **Mon–Tue (3h):** Connect dormant cases to Splose API → show live data
3. **Wed–Thu (4–5h):** Connect travel logbook to Splose + Google Maps → generate test PDF
4. **Thu:** Collect decisions from Ann & Antony (see decision list above)
5. **Friday:** QA both features, prepare demo

### **NEXT WEEK (May 17–24)** — Depends on Decisions
- If Ann decides → Build case noting (3–4 days)
- If Antony decides on SMS → Build client reminders (4–5 days)
- If Antony decides on flight API → Start flight tracking (11–14 days)

### **LATE JUNE**
- Implement remaining features (credentials + full flight tracking)

---

## 🔧 Known Technical Details

**Splose Integration:**
- Base URL: `https://platform.splose.com/api/v1`
- Auth: Bearer token in header
- Key endpoints: `GET /cases`, `GET /appointments`, `GET /busy-times`
- Filter syntax: `?filter[last_invoice_date][gte]=2026-04-10`

**Google Maps:**
- Routes API for distance calculation (more accurate than distance matrix)
- 3-layer cache: browser → server → Google API
- Production deployment to Sydney region (data residency)

**Splose Busy-Time Types (Current):**
- Travel: #55337 (green)
- CPD: #55338 (blue)
- Admin: #55339 (magenta) ← case notes will nest here or get new type
- Lunch: #55340 (purple)
- Meeting: #55341 (black)

---

## 📋 Files in Project

**Documentation (14 files):**
- START_HERE.md
- MASTER_FEATURE_STATUS_MAY10.md (this status)
- MAY_10_2026_DELIVERY_SUMMARY.md
- COMPLETE_FEATURE_ROADMAP_MAY2026.md
- FLIGHT_TRACKING_FEATURE.md
- FLIGHT_TRACKING_SUMMARY.md
- Plus 8 feature specs + guides

**Code (5 files):**
- mockup_v3.html (7,235 lines — **active version**)
- dormant_cases_scheduler.js (12KB)
- travel_logger.js (11KB)
- travel_report_generator.js (10KB)
- Production architecture docs (Node/Express backend blueprint)

**Previous versions (for reference):**
- mockup_v2.html (original, 310KB)
- mockup_v1.html (first prototype)

---

## 🚀 Next Actions (Pick One)

### **Option A: "I want the trivial fix done NOW"**
→ Remove 9–5 greyout, deploy today (15 min)

### **Option B: "I want working features this week"**
→ Integrate dormant cases + travel logbook (6–8h, needs API decisions)

### **Option C: "I want to decide on the blocked features"**
→ Review decision checklist above, provide Ann & Antony feedback

### **Option D: "I want the full system"**
→ Timeline: Week 1 (flex hours + 2 integrations), Week 2 (case noting + reminders if decisions made), Week 6+ (flight tracking + credentials)

---

## 📞 Support Notes

If you need to:
- **Fix the greyout:** Edit mockup_v3.html, find `.non-working-hours` CSS rule, remove or change `opacity: 0.3` to `opacity: 1`
- **Test dormant cases:** Review `DORMANT_CASES_FEATURE.md` + `dormant_cases_scheduler.js`
- **Understand travel logbook:** Read `TRAVEL_LOGBOOK_IMPLEMENTATION_GUIDE.md` + `travel_logger.js`
- **See flight spec:** Open `FLIGHT_TRACKING_FEATURE.md` (14KB, detailed workflows)
- **Get decisions:** Share this dashboard with Ann & Antony, ask for input on decision list above

---

**Ready to move?** What would you like to tackle first?
