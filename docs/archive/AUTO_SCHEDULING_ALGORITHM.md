# Auto-Fit Multiple Clients: Scheduling Algorithm

**Version:** 1.0  
**Date:** May 10, 2026  
**Purpose:** Optimize multi-client appointment booking based on availability, clustering, capacity, and travel efficiency

---

## Overview

The Auto-Fit scheduler intelligently places multiple client appointments across the therapist's calendar while optimizing for:
- **Clustering** — Group clients by region to minimize travel
- **Capacity** — Respect therapist's weekly hours and NDIS plan constraints
- **Travel** — Minimize distance/time between appointments
- **Urgency** — Prioritize clients with expiring NDIS plans
- **Preferences** — Honor time slot preferences when possible

---

## Algorithm: Multi-Phase Scheduling

### Phase 1: Constraint Validation
**Goal:** Ensure the booking is feasible before attempting to schedule

```
FOR EACH selected client:
  ✓ Check NDIS plan is active (not expired)
  ✓ Check plan has remaining hours (>= session length)
  ✓ Check client has stated availability
  ✓ Check therapist is qualified for service type
  
IF any constraint fails:
  → Return error with specific constraint + remediation
  
ELSE:
  → Proceed to Phase 2
```

**Outputs:** Feasibility report, blockers (if any)

---

### Phase 2: Available Slot Generation

**Goal:** Create matrix of all possible (therapist time, client) combinations

```
AVAILABLE_SLOTS = []

FOR EACH DAY in scheduling window (default: next 2 weeks):
  FOR EACH HOUR in therapist's work hours on that day:
    FOR EACH 30-min increment in that hour:
      IF slot is not blocked (by busy-times, existing appointments, travel):
        Create slot = {
          date: day,
          time: hour:minute,
          duration: 60 min (default),
          location: therapist's work location for that day,
          available_clients: [] (will populate in Phase 3)
        }
        AVAILABLE_SLOTS.push(slot)

Return all unblocked slots in chronological order
```

**Outputs:** Slot matrix (therapist × time)

---

### Phase 3: Client Availability Intersection

**Goal:** For each slot, identify which selected clients can attend

```
FOR EACH slot in AVAILABLE_SLOTS:
  matching_clients = []
  
  FOR EACH selected client:
    IF client's stated availability includes this time:
      IF client's location == therapist's location for this day:
        (or client prefers remote/online)
        matching_clients.push(client)
  
  slot.available_clients = matching_clients

Return augmented slot matrix with per-client feasibility
```

**Outputs:** Slot matrix + available clients per slot

---

### Phase 4: Regional Clustering (Pre-Scoring)

**Goal:** Group clients by region to identify clustering opportunities

```
REGIONS = {}

FOR EACH selected client:
  region = client.location_region  // e.g., "South", "East", "North"
  IF region not in REGIONS:
    REGIONS[region] = []
  REGIONS[region].push(client)

Identify:
  - "cluster_days" = days where 2+ clients from same region are available
  - "single_client_days" = days with only 1 client available
  - "multi_region_days" = days where clients from different regions can book

Return regional grouping + cluster opportunities
```

**Outputs:** Regional clustering map

---

### Phase 5: Scoring System

**Goal:** Score each (slot, client) combination on multiple dimensions

For each combination of (therapist_slot, client_candidate):

```
score = 0

// 1. CLUSTERING BONUS (0–30 points)
// Reward: grouping clients from same region on same day
IF other_booked_clients_today_same_region > 0:
  clustering_bonus = 10 + (other_booked_clients_today_same_region * 5)
  // Max: 30 points for 3+ clients same region
ELSE:
  clustering_bonus = 0
score += clustering_bonus

// 2. TRAVEL EFFICIENCY (0–25 points)
// Reward: minimize travel time to next appointment
IF next_appointment_today exists:
  travel_time = travel_matrix[slot.location][next_appointment.location]
  travel_score = MAX(0, 25 - (travel_time_minutes / 2))
  // 0 travel = 25 pts, 50 min travel = 0 pts
ELSE:
  travel_score = 20  // Last appointment of day gets bonus
score += travel_score

// 3. CAPACITY URGENCY (0–25 points)
// Reward: prioritize clients whose NDIS plans expire soon
days_until_plan_expiry = (client.plan_expiry_date - today).days
IF days_until_plan_expiry < 14:
  urgency_score = 25  // Critical: expires within 2 weeks
ELSE IF days_until_plan_expiry < 30:
  urgency_score = 15  // High: expires within 1 month
ELSE IF days_until_plan_expiry < 60:
  urgency_score = 5   // Medium: expires within 2 months
ELSE:
  urgency_score = 0   // Low urgency
score += urgency_score

// 4. TIME PREFERENCE MATCH (0–15 points)
// Reward: honor stated time preferences (morning/afternoon/evening)
IF client.preferred_time == this_slot.time_category:
  preference_score = 15
ELSE IF client.preferred_time == null:
  preference_score = 10  // No preference: still good
ELSE:
  preference_score = 0   // Preference conflict
score += preference_score

// 5. LOAD BALANCING (0–5 points)
// Small reward: spread bookings across multiple days
IF therapist_hours_booked_this_day < therapist_hours_booked_other_days:
  load_balance = 5
ELSE:
  load_balance = 0
score += load_balance

// FINAL SCORE
total_score = clustering_bonus + travel_score + urgency_score + preference_score + load_balance

Return {
  slot: slot,
  client: client,
  score: total_score,
  breakdown: {
    clustering: clustering_bonus,
    travel: travel_score,
    urgency: urgency_score,
    preference: preference_score,
    balance: load_balance
  }
}
```

**Outputs:** Scored matrix (slot × client with detailed breakdown)

---

### Phase 6: Greedy Optimization

**Goal:** Select the highest-scoring combination that doesn't create conflicts

```
BOOKED = []

WHILE clients_remaining > 0:
  // 1. Find highest-scoring available combination
  best_score = null
  best_combo = null
  
  FOR EACH (slot, client) in SCORED_MATRIX:
    IF client not in BOOKED AND slot not in BOOKED:
      IF score > best_score:
        best_score = score
        best_combo = (slot, client)
  
  IF best_combo == null:
    // No more feasible combinations
    BREAK
  
  // 2. Lock this booking
  BOOKED.push(best_combo)
  
  // 3. Block this slot from other clients
  // (slot is now taken)
  
  // 4. Recalculate clustering bonuses for remaining slots
  // (because regional grouping has changed)
  RECALCULATE_SCORES(SCORED_MATRIX, BOOKED)

Return BOOKED (final schedule)
```

**Output:** Ordered list of bookings with reasoning

---

### Phase 7: Conflict Resolution & Alternatives

**Goal:** If Phase 6 can't book all clients, generate alternatives

```
unbooked_clients = selected_clients - BOOKED

FOR EACH unbooked_client:
  // Find next best available slot (even if not ideal)
  alternative_slots = []
  
  FOR EACH slot in AVAILABLE_SLOTS:
    IF slot not in BOOKED AND client available at slot:
      score = CALCULATE_SCORE(slot, client)
      alternative_slots.push({slot, score})
  
  IF alternative_slots.length > 0:
    // Sort by score
    alternative_slots.SORT(by score DESC)
    
    // Return top 3 alternatives
    SUGGESTIONS[unbooked_client] = alternative_slots[0:3]
  ELSE:
    // No slots available for this client
    BLOCKERS[unbooked_client] = {
      reason: "No available slots match client availability",
      remediation: [
        "Ask client for additional time preferences",
        "Consider extending scheduling window to 3+ weeks",
        "Check if client's NDIS plan needs renewal"
      ]
    }

Return {
  booked: BOOKED,
  alternatives: SUGGESTIONS,
  blockers: BLOCKERS
}
```

**Outputs:** Final schedule + fallback options + error handling

---

## Example: 3-Client Scenario

**Setup:**
- Therapist: Ann (OT, Perth metro)
- Clients:
  - Jamie (South region, available Mon/Wed/Fri 10–12)
  - Sofia (East region, available Tue/Thu 14–16, plan expires in 3 weeks)
  - Marcus (South region, available Mon–Fri 13–15)

**Week View:**
```
MON  TUE  WED  THU  FRI
9-10: FREE
10-11: FREE
11-12: FREE
12-1: FREE (lunch)
1-2: FREE
2-3: FREE
3-4: FREE
4-5: FREE
```

**Phase 1:** ✓ All clients active, plans valid

**Phase 2:** Generate 40+ slots across Mon–Fri

**Phase 3:** Intersect with availability:
```
MON 10-11: [Jamie, Marcus]       ← Both available
MON 13-14: [Marcus only]
TUE 14-15: [Sofia only]
WED 10-11: [Jamie, Marcus]
WED 13-14: [Marcus only]
THU 14-15: [Sofia only]
FRI 10-11: [Jamie, Marcus]
FRI 13-14: [Marcus only]
```

**Phase 4:** Clustering:
- South region: Jamie + Marcus (can cluster Mon/Wed/Fri mornings)
- East region: Sofia (alone, no clustering benefit)

**Phase 5:** Scoring (example):
```
MON 10-11 + Jamie = 28 pts
  - Clustering: +10 (Marcus coming 13:00)
  - Travel: +8 (after free morning)
  - Urgency: +0 (plan expires >2 months)
  - Preference: +10 (morning preference)
  - Balance: +0

TUE 14-15 + Sofia = 35 pts
  - Clustering: +0 (alone)
  - Travel: +20 (isolated, manageable)
  - Urgency: +15 (plan expires 3 wks)
  - Preference: +0 (no stated preference)
  - Balance: +0

MON 13-14 + Marcus = 22 pts
  - Clustering: +12 (after Jamie @ 10-11)
  - Travel: +5 (consecutive on same day)
  - Urgency: +0
  - Preference: +5 (afternoon preference)
  - Balance: +0
```

**Phase 6:** Greedy booking:
1. Book: TUE 14-15 + Sofia (highest: 35 pts) ✓
2. Book: MON 10-11 + Jamie (next highest: 28 pts) ✓
3. Book: MON 13-14 + Marcus (clustered with Jamie) ✓

**Output:**
```
PROPOSED SCHEDULE:
- Mon 10–11: Jamie (South) → clustering bonus with Marcus
- Mon 13–14: Marcus (South) → same-region clustering
- Tue 14–15: Sofia (East) → urgent (plan expires Jun 1)

RATIONALE:
✓ All 3 clients booked in one pass
✓ South clients clustered (same day, different times)
✓ Sofia prioritized by plan urgency
✓ Minimal travel (no inter-regional movements)
```

---

## Scoring Formula: Weighted Summary

```
Total Score = (Clustering × 0.35) + (Travel × 0.30) + (Urgency × 0.20) + (Preference × 0.10) + (Balance × 0.05)

Weights:
- 35% Clustering (most important for efficiency)
- 30% Travel (business cost)
- 20% Urgency (fairness to clients with expiring plans)
- 10% Time preferences (client satisfaction)
- 5% Load balancing (calendar health)
```

---

## Edge Cases & Handling

| Scenario | Handling |
|----------|----------|
| **No slots match all clients** | Return Phase 7 alternatives + blockers |
| **Client with expiring plan** | Boost urgency score, suggest earliest available |
| **Travel time > 60 min** | Flag as warning, suggest alternative or remote session |
| **Therapist fully booked** | Extend scheduling window OR suggest waitlist |
| **Regional isolation** | Book in available slot, no clustering bonus |
| **Client time preference conflicts** | Show trade-off: prefer time OR prefer region clustering |
| **Multiple equi-scoring bookings** | Break tie by urgency (expiry date) |

---

## Implementation Notes

**Real-time Recalculation:**
- Clustering scores recalculate each iteration (as slots fill)
- Travel times fetch from Google Maps Distance Matrix API
- NDIS plan data reads live from Splose API

**Performance Optimization:**
- Cache travel matrix for same day (calculate once)
- Limit search window to 2 weeks (adjustable)
- Pre-filter impossible slots before scoring

**User Control:**
- Show proposed schedule with reasoning
- Allow manual edits (move client to different slot)
- Recalculate remaining clients after edit

---

## Future Enhancements

1. **Multi-therapist optimization** — Schedule across team, not just single practitioner
2. **Resource constraints** — Room booking, equipment availability
3. **Workflow preferences** — "Block travel Mondays", "No back-to-back over 4 hrs"
4. **ML-based learning** — Learn from past manual overrides to improve weighting
5. **Predictive no-show** — Factor in client no-show history into urgency
6. **Seasonal patterns** — School term dates, public holidays, peak periods
