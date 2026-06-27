# Bespoke Icon System for Opal Therapy Scheduler

**Design Philosophy:** Professional, healthcare-focused, minimal line-style icons with consistent 24px grid

---

## Icon Library

### Primary Navigation Icons

#### Smart Booking
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2c5.5 0 10 4.5 10 10s-4.5 10-10 10S2 17.5 2 12 6.5 2 12 2"/>
  <path d="M12 6v6l4 2"/>
</svg>
```
**Use:** Smart Booking tab

#### Week View
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="18" rx="2"/>
  <path d="M16 2v4M8 2v4M3 10h18"/>
  <path d="M8 14h.01M13 14h.01M18 14h.01M8 18h.01M13 18h.01M18 18h.01"/>
</svg>
```
**Use:** Week View tab

#### Dormant Cases
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2"/>
  <path d="M12 6v6M9 12h6"/>
</svg>
```
**Use:** Dormant Cases tab (alert/warning variant)

#### Travel & Flights
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M22 16.04v-5.1c0-.6-.32-1.12-.84-1.4l-8.8-5.23c-.48-.29-1.24-.29-1.72 0l-8.8 5.23c-.52.28-.84.8-.84 1.4v5.1c0 .6.32 1.12.84 1.4l8.8 5.23c.48.29 1.24.29 1.72 0l8.8-5.23c.52-.28.84-.8.84-1.4z"/>
  <path d="M3.5 9.5l8.5 5v6.5M20.5 9.5l-8.5 5v6.5"/>
</svg>
```
**Use:** Travel & Flights tab

#### Travel Logbook
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="12" y1="11" x2="12" y2="17"/>
  <line x1="9" y1="14" x2="15" y2="14"/>
</svg>
```
**Use:** Travel Logbook tab

#### Settings
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m2.12 2.12l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m2.12-2.12l4.24-4.24M19.78 19.78l-4.24-4.24m-2.12-2.12l-4.24-4.24"/>
</svg>
```
**Use:** Settings tab

#### Auto-fit Clients
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
  <circle cx="9" cy="7" r="4"/>
  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
</svg>
```
**Use:** Auto-fit Clients tab

---

### Feature Icons

#### Profile / User
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
  <circle cx="12" cy="7" r="4"/>
</svg>
```
**Use:** Profile icon, Details section

#### Location
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
  <circle cx="12" cy="10" r="3"/>
</svg>
```
**Use:** Location, Work location, Regional tags

#### Vacation / Leave
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="7" width="20" height="14" rx="2"/>
  <path d="M16 2v3M8 2v3M2 11h20"/>
  <path d="M7 15l2 2 4-4M7 20l2 2 4-4"/>
</svg>
```
**Use:** Leave requests, Vacation icon

#### Education / CPD
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M22 10v6m-2-2h4M2 10v6m2-2H0M12 2L2 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
</svg>
```
**Use:** Professional development, CPD, AHPRA

#### Notifications / Bell
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
</svg>
```
**Use:** Notifications, Alerts section

#### Documents / Credentials
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="9" y1="13" x2="15" y2="13"/>
  <line x1="9" y1="17" x2="15" y2="17"/>
</svg>
```
**Use:** Documents, Credentials, Therapist Documents

#### Alert / Warning
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3.05h16.94a2 2 0 0 0 1.71-3.05L13.71 3.86a2 2 0 0 0-3.42 0z"/>
  <line x1="12" y1="9" x2="12" y2="13"/>
  <line x1="12" y1="17" x2="12.01" y2="17"/>
</svg>
```
**Use:** Alerts, Warnings, Dormant cases

#### Clock / Time
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/>
  <polyline points="12 6 12 12 16 14"/>
</svg>
```
**Use:** Time slots, Duration, Scheduling

#### Check / Approved
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="20 6 9 17 4 12"/>
</svg>
```
**Use:** Approved status, Checkmarks, Confirmed

#### X / Cancel
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>
```
**Use:** Cancel, Close, Rejected

#### Plus / Add
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="5" x2="12" y2="19"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>
```
**Use:** Add, Create new, Plus button

#### Download
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
  <polyline points="7 10 12 15 17 10"/>
  <line x1="12" y1="15" x2="12" y2="3"/>
</svg>
```
**Use:** Download, Export

#### Upload
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
  <polyline points="17 8 12 3 7 8"/>
  <line x1="12" y1="3" x2="12" y2="15"/>
</svg>
```
**Use:** Upload, Import, Attach file

#### Search / Find
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="11" cy="11" r="8"/>
  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
</svg>
```
**Use:** Search, Find, Magnifying glass

#### Refresh / Reload
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="23 4 23 10 17 10"/>
  <path d="M20.49 15a9 9 0 1 1-2-8.83"/>
</svg>
```
**Use:** Refresh, Reload, Recalculate, Reset

#### Robot / Auto
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="2" width="16" height="20" rx="2" ry="2"/>
  <path d="M9 7h.01M15 7h.01M9 13h.01M15 13h.01"/>
  <line x1="9" y1="17" x2="15" y2="17"/>
  <line x1="6" y1="5" x2="6" y2="3"/>
  <line x1="18" y1="5" x2="18" y2="3"/>
</svg>
```
**Use:** Auto-fit, Robot, Automation, AI

#### Medical / Therapy
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M11 4H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h4m6-13v2m-3-2v2m3 6H7m6-6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h4z"/>
</svg>
```
**Use:** Therapy sessions, Medical, Health

#### NDIS / Plan
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <line x1="3" y1="9" x2="21" y2="9"/>
  <line x1="9" y1="3" x2="9" y2="21"/>
  <path d="M9 9h6v6H9z"/>
</svg>
```
**Use:** NDIS plans, Capacity, Grid view

#### Cluster / Group
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="6" cy="6" r="3"/>
  <circle cx="18" cy="6" r="3"/>
  <circle cx="12" cy="14" r="3"/>
  <path d="M6 9l6 5M18 9l-6 5"/>
</svg>
```
**Use:** Clustering, Groups, Regional grouping

---

## Implementation Pattern

### In HTML, use SVG inline:

```html
<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <!-- icon path -->
</svg>
```

### CSS for icons:

```css
.icon {
  width: 20px;
  height: 20px;
  display: inline-block;
  vertical-align: -4px;
  color: inherit;
  flex-shrink: 0;
}

.icon-large {
  width: 24px;
  height: 24px;
  vertical-align: -6px;
}

.tab .icon {
  width: 18px;
  height: 18px;
  margin-right: 6px;
}
```

---

## Color Coding

- **Primary Accent:** `var(--accent)` — Teal (#2d7a7a)
- **Success:** `var(--ok)` — Green (#15803d)
- **Warning:** `var(--warn)` — Amber (#d97706)
- **Danger:** `var(--danger)` — Red (#b91c1c)
- **Neutral:** `var(--muted)` — Gray (#9ca3af)

---

## Icon Usage Map

| Icon | Current Emoji | Use Cases |
|------|------------------|-----------|
| Smart Booking | 🎯 | Smart Booking tab, calendar icon |
| Week View | ▦ | Week View tab, weekly display |
| Dormant Cases | ⚠ | Dormant Cases tab, alerts |
| Travel & Flights | ✈ | Travel tab, flight icon |
| Logbook | 📊 | Logbook tab, reporting |
| Settings | ⚙ | Settings tab, configuration |
| Auto-fit | 🤖 | Auto-fit tab, algorithm |
| Profile | 👤 | Profile section, user details |
| Location | 📍 | Work location, regional info |
| Leave | 🌴 | Leave requests, vacation |
| CPD | 🎓 | Professional development |
| Notifications | 🔔 | Alerts, notifications |
| Documents | 📋 | Credentials, documents |
| Alert | ⚠️ | Warnings, urgent items |
| Time | ⏰ | Time slots, durations |
| Approved | ✓ | Approved status, confirmed |
| Cancel | ✕ | Cancelled, rejected |
| Add | ➕ | New, create, add |
| Download | 📥 | Export, save |
| Upload | 📤 | Import, file input |
| Search | 🔍 | Find, search |
| Refresh | ↻ | Reload, recalculate |
| Therapy | 🏥 | Sessions, health |
| Plan | 📈 | NDIS plan, capacity |
| Cluster | 🔗 | Groups, clustering |

