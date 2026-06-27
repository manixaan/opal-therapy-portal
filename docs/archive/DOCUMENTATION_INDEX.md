# Documentation Index — Complete Reference

**All 25+ Documents for the Therapy Scheduler Project**

> This index helps you navigate all project documentation. Start with "Read First" docs, then refer to others as needed during development.

---

## 📚 READ FIRST (In This Order)

### 1. **START_BUILDING.md** ← START HERE NOW
**Purpose:** Action checklist for TODAY (May 10)  
**Read time:** 15 minutes  
**Contains:**
- Critical decisions due May 13 (Ann + Antony)
- Pre-development checklist (API keys, GitHub, team roles)
- Week 1 detailed checklist (setup, auth, Splose, calendar, scheduler)
- Week 2 overview
- Week 3 overview
- Launch sign-off checklist

**Who:** Everyone (all roles)  
**When:** Before May 10 end of day  
**Action:** Collect decisions, create GitHub repo, assign team members

---

### 2. **ARCHITECTURE_SUMMARY.md**
**Purpose:** One-page overview of entire system  
**Read time:** 10 minutes  
**Contains:**
- Three-week breakdown (foundation, features, production)
- Technology stack rationale
- Database schema (5 tables)
- All API endpoints (15 routes)
- Scheduler algorithm explanation
- Deployment instructions
- Success metrics
- Decisions needed

**Who:** All developers (quick reference)  
**When:** Before starting Week 1 coding  
**Action:** Reference during development, bookmark for quick lookup

---

### 3. **QUICK_START_GUIDE.md**
**Purpose:** Week-by-week implementation roadmap  
**Read time:** 20 minutes  
**Contains:**
- Big picture diagram
- Decision points (from Ann + Antony)
- Week 1 breakdown (foundation: 77 hours)
- Week 2 breakdown (features: 89.5 hours)
- Week 3 breakdown (production: 52.5 hours)
- Team capacity analysis
- Critical path
- Risk mitigations
- Success criteria
- Handoff checklist

**Who:** Project managers, team leads, all developers  
**When:** May 10 team kickoff meeting  
**Action:** Use as Gantt chart throughout 3-week sprint

---

## 🏗️ DETAILED BLUEPRINTS (Reference During Development)

### 4. **PRODUCTION_ARCHITECTURE.md** (Largest Document)
**Purpose:** Complete system design specification  
**Read time:** 45 minutes (skim), 2 hours (deep read)  
**Contains:**
- Part 1: Project structure (full file organization)
- Part 2: Database schema (5 tables with all fields)
- Part 3: API endpoints (15 routes with examples)
- Part 4: Core services (5 major services with code skeletons)
- Part 5: Splose integration layer (client code)
- Part 6: Implementation timeline (detailed 3-week plan)
- Part 7: Deployment instructions
- Part 8: Feature status (ready, designed, Phase 2)
- Part 9: Risk mitigation table
- Part 10: Success criteria
- Appendix A: Tech stack rationale
- Appendix B: Splose checklist
- Appendix C: Happy path user flow

**Who:** All developers (reference during coding)  
**When:** Before starting each component  
**Action:** Read relevant sections before implementing features

---

### 5. **IMPLEMENTATION_MATRIX.md** (Detailed Task Breakdown)
**Purpose:** 219 hours of work broken into manageable tasks  
**Read time:** 30 minutes (skim), 1 hour (detailed)  
**Contains:**
- Phase 1: Foundation (77 hours, 6 sections)
  - 1.1 Project Setup (10.5 hours)
  - 1.2 Authentication (10 hours)
  - 1.3 Splose API Integration (14.5 hours)
  - 1.4 Calendar UI (12.5 hours)
  - 1.5 Smart Scheduler (22 hours)
  - 1.6 Appointment CRUD (8 hours)
- Phase 2: Features (89.5 hours, 6 sections)
  - 2.1 Travel Logbook (10.5 hours)
  - 2.2 Travel Reports (7.5 hours)
  - 2.3 Dormant Cases (16 hours)
  - 2.4 Credentials (16.5 hours)
  - 2.5 Case Notes (16.5 hours)
  - 2.6 Integration Testing (15.5 hours)
- Phase 3: Production (52.5 hours, 5 sections)
  - 3.1 Security Hardening (10 hours)
  - 3.2 Deployment (12.5 hours)
  - 3.3 Documentation (12.5 hours)
  - 3.4 UAT & Launch (13 hours)
  - 3.5 Post-Launch (4.5 hours)
- Each task includes: priority, hours, owner, dependencies, testing
- Team capacity analysis (small/large/solo options)
- Critical path diagram
- Risk mitigations
- Definition of "Done"
- Sign-off checklist

**Who:** Backend dev, frontend dev, QA (daily reference)  
**When:** Week 1 team meeting to assign tasks  
**Action:** Track completion of each task, update status weekly

---

## 📖 REFERENCE DOCUMENTS (Existing, Pre-Project)

### 6. **PROJECT_HANDOFF.md** (From April 20)
**Purpose:** Original Splose API reference + session type mapping  
**Key info:**
- Splose API base URL + auth
- Rate limits (60 calls/min)
- All read endpoints (appointments, patients, cases, services, busy-times, locations)
- Write endpoints (POST appointments, PUT appointments, POST/PUT support-activities)
- Session type → service ID mapping (verified April 20)
- Cancellation path (read-only, nested in appointmentPatients)
- Practitioner color strategy (no color field in Splose, must assign client-side)
- Initial smart scheduler architecture
- What exists in workspace (mockup_v1.html, etc.)

**Who:** Backend developers (API integration)  
**When:** Before writing Splose client code  
**Action:** Verify all endpoint URLs + params match before calling

---

### 7. **COMPLETE_FEATURE_ROADMAP_MAY2026.md** (From May 10)
**Purpose:** Feature status + implementation timeline  
**Contains:**
- Executive summary table
- Phase 1: Dormant case reminder (complete, 3 files)
- Phase 1: Travel logbook (complete, 4 files)
- Phase 2: Case noting (designed, decision needed)
- Phase 2: Client reminders (designed, decision needed)
- Phase 2: Flexible work hours (trivial, 30 min CSS change)
- Phase 3: Credentials tracking (design phase, decisions needed)
- Summary table (6 features with status + effort)
- Implementation calendar (Weeks 1–5 breakdown)
- Decision points for Ann + Antony
- File list (14 files delivered May 10)

**Who:** Product owners (decisions), developers (reference)  
**When:** Review decisions section (May 10–13)  
**Action:** Answer decision questions in this file

---

### 8. **MASTER_FEATURE_STATUS_MAY10.md** (From May 10)
**Purpose:** High-level feature status snapshot  
**Contains:**
- Summary table (7 features, status, priority, files, effort)
- Implementation calendar (Week 1–6)
- Decision points for Ann (case noting type, alert timing, blocking creds)
- Decision points for Antony (SMS gateway, creds storage, flight API)
- File list (14 files total)
- Business value summary
- Next actions (priority order)

**Who:** Stakeholders (executives, managers)  
**When:** Weekly status updates  
**Action:** Reference for executive reporting

---

### 9. **MAY_10_2026_DELIVERY_SUMMARY.md** (From May 10)
**Purpose:** Quick summary of what was delivered May 10  
**Contains:**
- 7 new features delivered (3 complete, 3 designed, 1 trivial)
- Read-first guide (3 files to start)
- Complete & ready features (2: dormant cases, travel logbook)
- Designed features (2: case noting, client reminders)
- Trivial fixes (1: flex hours)
- In design (1: credentials tracking)
- Action items this week
- Quick Q&A

**Who:** Quick reference for team  
**When:** Start of week  
**Action:** None, just reference

---

## 🎯 FEATURE DOCUMENTATION (Pre-May 10 Deliverables)

### 10. **DORMANT_CASES_FEATURE.md**
**Complete:** Dormant case detection  
**Contains:** Full specification, code snippets, testing

### 11. **dormant_cases_scheduler.js**
**Code file:** Backend logic for dormant case detection

### 12. **mockup_v2_dormant_cases_addition.html**
**UI file:** Dashboard widget for dormant cases

---

### 13. **TRAVEL_LOGBOOK_FEATURE.md**
**Complete:** Travel logbook specification  
**Contains:** Full spec, ATO compliance, features

### 14. **TRAVEL_LOGBOOK_IMPLEMENTATION_GUIDE.md**
**Complete:** How to integrate travel logbook  
**Contains:** Step-by-step integration, DB schema, API routes

### 15. **travel_logger.js**
**Code file:** Auto-logging engine (Google Maps + distance calc)

### 16. **travel_report_generator.js**
**Code file:** PDF + CSV report generation

---

### 17. **FLIGHT_TRACKING_FEATURE.md**
**Designed:** Flight tracking specification (Phase 2)  
**Contains:** Complete design for June feature

### 18. **FLIGHT_TRACKING_SUMMARY.md**
**Designed:** Flight tracking summary (Phase 2)  
**Contains:** Quick overview of flight feature

---

### 19. **FEATURE_ADDITIONS_ROADMAP.md**
**Designed:** Case noting + client reminders specifications  
**Contains:** Detailed design for Phase 2 features

---

## 🔧 HTML MOCKUPS (Frontend Reference)

### 20. **mockup_v1.html**
**v1 mockup:** Original static mockup (22KB)  
**Contains:** Week grid, color legend, session blocks

### 21. **mockup_v2.html**
**v2 mockup:** Updated mockup (newer version)

### 22. **mockup_v2_updated.html**
**v2 updated:** Further refinements

### 23. **mockup_v2_dormant_cases_addition.html**
**v2 with feature:** Dormant cases dashboard widget added

---

## 📋 SETUP & CONFIG DOCUMENTS

### 24. **GOOGLE_MAPS_SETUP.md**
**Purpose:** How to set up Google Maps API  
**Contains:** API key creation, Distance Matrix API enablement, testing

---

## 📊 NEW ARCHITECTURE DOCUMENTS (Just Created)

These 4 documents are **NEW** and integrated as ONE unified plan:

### **PRODUCTION_ARCHITECTURE.md** (500+ lines)
- Full system blueprint
- Database schema (5 tables)
- API endpoints (15 routes)
- Services + algorithms
- 3-week implementation plan
- Deployment instructions

### **QUICK_START_GUIDE.md** (300+ lines)
- Week-by-week roadmap
- Daily checklists
- Decision points
- Team capacity analysis
- Risk mitigation
- Success metrics

### **IMPLEMENTATION_MATRIX.md** (400+ lines)
- 219 hours broken into tasks
- Priority + hours per task
- Owner assignment
- Dependencies
- Testing criteria
- Critical path

### **ARCHITECTURE_SUMMARY.md** (150 lines)
- One-page overview
- Tech stack
- Database schema (condensed)
- API endpoints (list)
- Scheduler algorithm
- Phase 2 + 3 roadmap

### **START_BUILDING.md** (250+ lines)
- TODAY's action checklist
- Critical decisions (due May 13)
- Pre-dev checklist
- Week 1–3 checklists
- Blockers + emergency contacts
- Launch sign-off

### **DOCUMENTATION_INDEX.md** (This file)
- Complete reference guide
- What to read first
- When to read each doc
- How docs relate to each other

---

## 🗺️ How to Use These Documents

### Scenario 1: Starting Development (Week 1, May 10)
1. Read: `START_BUILDING.md` (15 min) — collect decisions
2. Read: `ARCHITECTURE_SUMMARY.md` (10 min) — understand system
3. Read: `QUICK_START_GUIDE.md` (20 min) — week-by-week plan
4. Reference: `IMPLEMENTATION_MATRIX.md` — assign tasks
5. Code against: `PRODUCTION_ARCHITECTURE.md` — detailed specs
6. Reference: `PROJECT_HANDOFF.md` — Splose API details

### Scenario 2: Backend Developer (Weeks 1–3)
1. Start: `IMPLEMENTATION_MATRIX.md` Phase 1.1–1.3 (setup, auth, Splose)
2. Code: `PRODUCTION_ARCHITECTURE.md` Part 5 (Splose integration layer)
3. Code: `PRODUCTION_ARCHITECTURE.md` Part 4 (core services)
4. Reference: `PROJECT_HANDOFF.md` (API details)
5. Test: Edge cases in `IMPLEMENTATION_MATRIX.md`

### Scenario 3: Frontend Developer (Weeks 1–3)
1. Start: `IMPLEMENTATION_MATRIX.md` Phase 1.4–1.5 (calendar, scheduler)
2. Reference: `PRODUCTION_ARCHITECTURE.md` Part 1 (file structure)
3. Reference: `mockup_v2*.html` (UI reference)
4. Code: React components based on structure in Part 1
5. Test: Responsive design per `QUICK_START_GUIDE.md`

### Scenario 4: QA/Tester (Weeks 1–3)
1. Start: `IMPLEMENTATION_MATRIX.md` (all testing sections)
2. Reference: `QUICK_START_GUIDE.md` (success criteria per week)
3. Test: Against checklists in `START_BUILDING.md` (Weeks 1–3)
4. UAT: Use checklist in `START_BUILDING.md` Week 3

### Scenario 5: DevOps/Deployment (Week 3)
1. Read: `PRODUCTION_ARCHITECTURE.md` Part 7 (deployment instructions)
2. Read: `QUICK_START_GUIDE.md` Week 3 (production timeline)
3. Reference: `IMPLEMENTATION_MATRIX.md` Phase 3.2 (deployment tasks)
4. Execute: Checklist in `START_BUILDING.md` Week 3

### Scenario 6: Antony (Product Owner)
1. Read: `ARCHITECTURE_SUMMARY.md` (10 min)
2. Read: `START_BUILDING.md` (15 min) — note decision deadlines
3. Answer: 7 decision questions (30 min, due May 13 at 3 PM)
4. Reference: `QUICK_START_GUIDE.md` — weekly progress
5. Reference: `MASTER_FEATURE_STATUS_MAY10.md` — executive reporting

### Scenario 7: Ann (Therapist)
1. Read: `START_BUILDING.md` (just the decision section, 5 min)
2. Answer: 3 decision questions (5 min, due May 13 at 3 PM)
3. Wait: Week 1–3 for app to be built
4. Review: User guide (to be written Week 2)
5. Train: 30-min training session (Week 3)
6. UAT: 1-day dry run (Week 3, May 28)

---

## 📅 Document Usage Timeline

| Week | What to Read | What to Do | Reference |
|------|-------------|-----------|-----------|
| **Pre-Project** | START_BUILDING (decisions section) | Answer 7 decisions | None |
| **Week 1** | QUICK_START_GUIDE, ARCHITECTURE_SUMMARY | Implement foundation (setup, auth, calendar, scheduler) | PRODUCTION_ARCHITECTURE, PROJECT_HANDOFF, IMPLEMENTATION_MATRIX |
| **Week 2** | QUICK_START_GUIDE Week 2 section | Implement features (travel, dormant, creds, case notes) | PRODUCTION_ARCHITECTURE Part 4, IMPLEMENTATION_MATRIX |
| **Week 3** | QUICK_START_GUIDE Week 3 section | Deploy, document, UAT, launch | PRODUCTION_ARCHITECTURE Part 7, IMPLEMENTATION_MATRIX Phase 3 |
| **Post-Launch** | MASTER_FEATURE_STATUS_MAY10 (Phase 2 roadmap) | Plan flight tracking (June) | FLIGHT_TRACKING_FEATURE |

---

## 📊 Document Statistics

| Document | Lines | Format | Purpose | Status |
|----------|-------|--------|---------|--------|
| PRODUCTION_ARCHITECTURE | 700+ | Markdown | System design | ✅ NEW |
| QUICK_START_GUIDE | 400+ | Markdown | Week-by-week roadmap | ✅ NEW |
| IMPLEMENTATION_MATRIX | 600+ | Markdown | Task breakdown (219h) | ✅ NEW |
| START_BUILDING | 350+ | Markdown | Action checklist | ✅ NEW |
| ARCHITECTURE_SUMMARY | 200 | Markdown | One-page overview | ✅ NEW |
| DOCUMENTATION_INDEX | 250 | Markdown | This file | ✅ NEW |
| PROJECT_HANDOFF | 205 | Markdown | Splose API reference | ✅ Existing |
| COMPLETE_FEATURE_ROADMAP | 374 | Markdown | Feature status | ✅ Existing |
| MASTER_FEATURE_STATUS | 220 | Markdown | Feature summary | ✅ Existing |
| MAY_10_2026_DELIVERY | 188 | Markdown | Delivery summary | ✅ Existing |
| DORMANT_CASES_FEATURE | TBD | Markdown | Feature spec | ✅ Existing |
| TRAVEL_LOGBOOK_FEATURE | TBD | Markdown | Feature spec | ✅ Existing |
| FLIGHT_TRACKING_FEATURE | TBD | Markdown | Feature spec | ✅ Existing |
| START_HERE | 188 | Markdown | Quick reference | ✅ Existing |
| FEATURE_ADDITIONS_ROADMAP | TBD | Markdown | Phase 2 design | ✅ Existing |
| GOOGLE_MAPS_SETUP | TBD | Markdown | API setup | ✅ Existing |
| mockup_v1.html | 22KB | HTML | UI reference | ✅ Existing |
| mockup_v2.html | TBD | HTML | UI updated | ✅ Existing |
| dormant_cases_scheduler.js | TBD | JavaScript | Service code | ✅ Existing |
| travel_logger.js | TBD | JavaScript | Service code | ✅ Existing |
| travel_report_generator.js | TBD | JavaScript | Service code | ✅ Existing |

**Total:** 25+ documents, 4,000+ lines of documentation

---

## 🎯 Quick Navigation by Role

### Backend Developer
→ IMPLEMENTATION_MATRIX.md (Phase 1.1–1.3)  
→ PRODUCTION_ARCHITECTURE.md (Part 5: Splose integration)  
→ PRODUCTION_ARCHITECTURE.md (Part 4: Services)  
→ PROJECT_HANDOFF.md (Splose API details)  

### Frontend Developer
→ IMPLEMENTATION_MATRIX.md (Phase 1.4–1.5)  
→ PRODUCTION_ARCHITECTURE.md (Part 1: File structure)  
→ mockup_v2*.html (UI reference)  
→ QUICK_START_GUIDE.md (responsive design requirements)  

### QA/Tester
→ IMPLEMENTATION_MATRIX.md (all testing sections)  
→ START_BUILDING.md (Week 1–3 checklists)  
→ QUICK_START_GUIDE.md (success criteria)  

### DevOps
→ PRODUCTION_ARCHITECTURE.md (Part 7: Deployment)  
→ QUICK_START_GUIDE.md (Week 3)  
→ IMPLEMENTATION_MATRIX.md (Phase 3.2)  

### Product Owner (Antony)
→ ARCHITECTURE_SUMMARY.md  
→ START_BUILDING.md (decisions section)  
→ QUICK_START_GUIDE.md (weekly updates)  
→ MASTER_FEATURE_STATUS_MAY10.md (reporting)  

### End User (Ann)
→ START_BUILDING.md (decisions section, 5 min)  
→ User guide (to be written Week 2)  
→ Training session (Week 3)  

---

## ✅ Checklist: Before You Start

- [ ] **Read** START_BUILDING.md (15 min)
- [ ] **Read** ARCHITECTURE_SUMMARY.md (10 min)
- [ ] **Bookmark** QUICK_START_GUIDE.md (reference this weekly)
- [ ] **Bookmark** IMPLEMENTATION_MATRIX.md (task tracking)
- [ ] **Bookmark** PRODUCTION_ARCHITECTURE.md (detailed specs)
- [ ] **Gather** API keys (Splose, Google Maps, SendGrid)
- [ ] **Create** GitHub repo
- [ ] **Assign** team members (backend, frontend, QA, DevOps)
- [ ] **Collect** decisions from Ann + Antony (by May 13)
- [ ] **Schedule** team kickoff meeting (May 10, 30 min)

Then: Start Week 1 checklist in START_BUILDING.md

---

**YOU'RE READY TO BUILD.** All documentation is in place. Start with START_BUILDING.md right now. 🚀

