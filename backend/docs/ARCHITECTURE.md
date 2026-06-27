# Therapy Scheduler Backend Architecture

This document explains how the entire system works together.

---

## **High-Level Flow**

```
┌─────────────────────────────────────────────────────────────┐
│               YOUR BROWSER (mockup_v3.html)                 │
│  User clicks "Add Event" → Fills form → Clicks "Save"       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ POST /api/events
                         │ {title, date, time, client...}
                         ▼
┌─────────────────────────────────────────────────────────────┐
│          BACKEND SERVER (server.js + routes.js)             │
│                                                              │
│  1. Receives the event data                                 │
│  2. Saves to PostgreSQL database                            │
│  3. Sends to Splose API (creates appointment)               │
│  4. Sends to Outlook Calendar (creates calendar event)      │
│  5. Stores linking IDs (which event is which)               │
│  6. Broadcasts update via WebSocket                         │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐ ┌─────────────┐ ┌──────────────┐
│ PostgreSQL   │ │  Splose API │ │ Outlook API  │
│ (Database)   │ │  (existing) │ │ (Microsoft)  │
│ Event stored │ │ Appt made   │ │ Calendar evt │
└──────────────┘ └─────────────┘ └──────────────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
                         │ Real-time update
                         │ (WebSocket)
                         ▼
            ┌──────────────────────────┐
            │  User's browser updates  │
            │  Calendar shows new event│
            │  No page refresh needed! │
            └──────────────────────────┘
```

---

## **File Structure Explained**

```
backend/
├── server.js                 # Main app (listens for requests)
├── database.js               # Database functions (create, read, update)
├── routes.js                 # API endpoints (/api/events, etc.)
├── outlook-oauth.js          # Microsoft OAuth & Calendar API
├── splose-api.js             # Splose integration
├── package.json              # List of dependencies
├── .env                       # Secret keys (not shared)
├── .env.example              # Template for .env
├── SETUP_GUIDE.md            # How to install & run
└── ARCHITECTURE.md           # This file
```

---

## **What Each File Does**

### **1. server.js** - The Control Center
```
Purpose: Start the server and listen for requests
         Set up middleware (security, parsing, etc.)
         Connect all the pieces together

When it starts:
✓ Opens port 5000 (the address where server listens)
✓ Sets up CORS (allows frontend to talk to backend)
✓ Initializes database connection
✓ Starts WebSocket server for real-time updates
✓ Loads all routes
```

### **2. database.js** - The Filing System
```
Purpose: Store and retrieve event data from PostgreSQL

Think of it as a filing cabinet:
- Each table is a file drawer
- Each row is a document
- Each column is information on that document

Functions it provides:
createUser(email) → Stores new user
getEvents(userId) → Retrieves all events for a user
createEvent(data) → Creates new event
updateEvent(id, data) → Updates existing event
deleteEvent(id) → Deletes event
logSync(eventId, action, source) → Records what happened
```

### **3. routes.js** - The Traffic Cop
```
Purpose: Handle incoming API requests
         Coordinate syncing between all systems
         Determine what should happen

Key endpoints:
GET  /auth/outlook-login     → Start Microsoft OAuth
POST /api/events             → Create new event
GET  /api/events             → Get all events
PUT  /api/events/:id         → Update event
DELETE /api/events/:id       → Delete event
POST /api/sync               → Force full sync
GET  /api/calendar/availability → Get free time slots
```

### **4. outlook-oauth.js** - Microsoft Integration
```
Purpose: Handle login with Microsoft
         Read/write Outlook calendar
         Get Teams meeting info

What it does:
1. getAuthorizationUrl()     → Creates Microsoft login URL
2. getAccessToken(code)      → Exchange code for token
3. getMicrosoftUser()        → Get user's name/email
4. getOutlookCalendarEvents()→ Fetch calendar events
5. createOutlookEvent()      → Add event to Outlook
6. updateOutlookEvent()      → Edit Outlook event
7. deleteOutlookEvent()      → Remove from Outlook
```

### **5. splose-api.js** - Therapy System Integration
```
Purpose: Sync with your existing Splose system
         Get/create therapy appointments
         Get client NDIS info
         Manage busy times

What it does:
getAppointments()       → Fetch all appointments
createAppointment()     → Create therapy appointment
updateAppointment()     → Edit appointment
deleteAppointment()     → Cancel appointment
getBusyTimes()          → Get lunch, travel, admin blocks
getClient()             → Get patient information
getNdisPlanData()       → Get NDIS plan expiry info
```

---

## **Data Flow Explained**

### **Scenario: User creates a therapy event**

```
1. USER CREATES EVENT
   mockup_v3.html (browser)
   └─ User fills: title="Therapy - Sarah", time=2-3pm, date=Monday
   └─ Clicks "Save Event"

2. FRONTEND SENDS REQUEST
   POST http://localhost:5000/api/events
   Body: {
     title: "Therapy - Sarah",
     startTime: "2024-01-15T14:00:00",
     endTime: "2024-01-15T15:00:00",
     clientName: "Sarah Smith",
     eventType: "therapy"
   }

3. BACKEND RECEIVES REQUEST (routes.js)
   └─ Validates the data (has required fields?)
   └─ Gets user from session
   └─ Proceeds to Step 4

4. CREATE IN DATABASE (database.js)
   └─ Calls: createEvent(userId, eventData)
   └─ PostgreSQL inserts row in "events" table
   └─ Returns: Event with ID = "abc123"

5. CREATE IN SPLOSE (splose-api.js)
   └─ Calls: sploseApi.createAppointment()
   └─ Sends HTTP POST to Splose API
   └─ Splose creates appointment
   └─ Returns: sploseId = "xyz789"
   └─ Stores sploseId in database (links them)

6. CREATE IN OUTLOOK (outlook-oauth.js)
   └─ Calls: outlookApi.createOutlookEvent()
   └─ Uses user's access token (from OAuth)
   └─ Sends HTTP POST to Microsoft Graph API
   └─ Outlook creates calendar event
   └─ Returns: outlookId = "def456"
   └─ Stores outlookId in database (links them)

7. LOG THE SYNC (database.js)
   └─ Records: "Event abc123 synced to Splose" ✓
   └─ Records: "Event abc123 synced to Outlook" ✓

8. SEND RESPONSE BACK (routes.js)
   Response: {
     message: "Event created successfully",
     event: {
       id: "abc123",
       sploseId: "xyz789",
       outlookId: "def456",
       ...
     },
     synced: {
       database: true,
       splose: true,
       outlook: true
     }
   }

9. REAL-TIME UPDATE (WebSocket)
   └─ Backend broadcasts: "New event created!"
   └─ All connected browsers receive update instantly
   └─ Calendar refreshes showing new event
   └─ No page reload needed!

10. EVENT APPEARS IN THREE PLACES
    ✓ Your app (calendar shows "Therapy - Sarah 2-3pm")
    ✓ Splose (appointment created)
    ✓ Outlook (calendar event created)
```

---

## **Bidirectional Sync Explained**

When you edit something in Outlook, how does your app know?

### **Webhook Flow (Real-time)**

```
1. User edits event in Outlook
   └─ Changes time from 2pm to 3pm

2. Outlook detects the change
   └─ Checks if webhook subscription exists

3. Outlook sends webhook notification
   POST http://your-server.com/webhooks/outlook
   {
     changeType: "updated",
     resourceData: {
       id: "def456",
       subject: "Therapy - Sarah",
       start: { dateTime: "2024-01-15T15:00:00" }
     }
   }

4. Backend webhook handler (routes.js)
   └─ Receives notification
   └─ Verifies it's valid (signature check)
   └─ Finds event in database using outlookId "def456"
   └─ Updates database with new time

5. Backend syncs to Splose
   └─ Updates Splose appointment
   └─ Marks sync status = "synced"

6. Real-time broadcast (WebSocket)
   └─ Tells all connected clients: "Event updated!"
   └─ Your app calendar updates instantly
   └─ No user action needed!
```

---

## **Conflict Resolution**

What if both systems change at the same time?

```
User scenario:
┌─────────────────────┐        ┌──────────────────┐
│  User in your app   │        │ User in Outlook  │
│ Changes 2pm to 3pm  │        │ Changes 2pm to   │
│ Clicks "Save"       │        │ 4pm              │
│ (almost same time)  │        │ Saves             │
└────────┬────────────┘        └────────┬─────────┘
         │                              │
         │ POST /api/events/abc123      │
         │ {time: "3pm"}               │
         │                             │ Webhook notification
         ▼                             ▼
    Backend receives both at nearly the same time

Backend's conflict resolution (database.js):
1. Check timestamps
   - App change: 2:00:15 PM
   - Outlook change: 2:00:18 PM (later)
   
2. Outlook wins (last-write-wins strategy)
   - Update database to 4pm
   - Sync 4pm to Splose
   - Broadcast to app: "Event updated to 4pm"

3. Log the conflict
   INSERT INTO conflicts table:
   - event_id: abc123
   - conflict_type: "simultaneous_edit"
   - resolution: "outlook_wins"
   - created_at: 2024-01-15 14:00:20

4. User sees notification
   "Event updated from Outlook: Time changed to 4:00 PM"
```

---

## **Database Schema (What we store)**

```
USERS TABLE
├─ id               : Unique user ID
├─ email            : User's email
├─ microsoft_id     : Microsoft account ID
├─ access_token     : Token for accessing Outlook
├─ refresh_token    : Token for getting new access_token when expired
└─ created_at       : When user signed up

EVENTS TABLE
├─ id               : Unique event ID
├─ user_id          : Which user owns this event
├─ title            : Event name
├─ start_time       : When it starts
├─ end_time         : When it ends
├─ location         : Where it is
├─ event_type       : therapy, leave, teams_meeting, etc.
├─ splose_id        : ID in Splose system (links them)
├─ outlook_id       : ID in Outlook calendar (links them)
├─ sync_status      : synced, pending, or failed
├─ last_modified_by : app, outlook, or splose
├─ client_name      : Patient/client name
├─ regional_tag     : East, West, South, Central
├─ travel_distance  : km to travel
├─ ndis_plan_expiry : When NDIS plan expires
└─ updated_at       : Last time this was changed

SYNC_LOG TABLE
├─ id        : Log entry ID
├─ event_id  : Which event
├─ action    : created, updated, or deleted
├─ source    : app, outlook, or splose
├─ target    : app, outlook, or splose
├─ status    : success or failed
├─ error     : If failed, why
└─ created_at: When this happened

CONFLICTS TABLE
├─ id          : Conflict ID
├─ event_id    : Which event had conflict
├─ type        : Type of conflict
├─ resolution  : How we resolved it
└─ created_at  : When conflict occurred
```

---

## **Security Considerations**

### **Why the backend is necessary:**

```
WRONG WAY (insecure):
Frontend (browser)
  └─ Stores: MICROSOFT_CLIENT_SECRET
  └─ Problem: Anyone can open DevTools and steal the secret!

RIGHT WAY (secure):
Frontend → Backend → Microsoft
  └─ Backend stores the secret
  └─ Frontend never sees it
  └─ Frontend just says "please create event"
  └─ Backend does the OAuth dance safely
```

### **Token Management:**

```
1. User logs in with Microsoft
   └─ Gets access_token (expires in 1 hour)
   └─ Gets refresh_token (expires in 90 days)

2. Backend stores both securely in database

3. When access_token expires
   └─ Backend uses refresh_token to get new one
   └─ User never has to login again!

4. When refresh_token expires
   └─ User logs in again to get new ones
```

---

## **Real-Time Architecture (WebSocket)**

```
Traditional way (polling):
Backend: "Is there an update?" (every 5 seconds)
Frontend: "No... No... No... Yes!"
└─ Delay: Up to 5 seconds

WebSocket way (real-time):
Backend: "When something changes, I'll tell you"
Frontend: "OK, I'm listening"
...
[User updates Outlook]
Backend: "HEY! Event changed!"
Frontend: "Got it! Updating now"
└─ Delay: ~100 milliseconds

How it works:
1. Frontend connects to WebSocket
   const socket = io('http://localhost:5000')

2. Backend keeps connection open

3. When event is updated anywhere:
   io.emit('event_updated', eventData)

4. ALL connected frontends receive update instantly
   socket.on('event_updated', (event) => {
     updateCalendarDisplay(event)
   })
```

---

## **How to Debug Issues**

### **Check server logs:**
```bash
# Terminal where server is running shows:
✓ Event created: "Therapy - Sarah"
├─ Database: ✓
├─ Splose: ✓
├─ Outlook: ✓
```

### **Check browser console:**
```javascript
// Press F12 in browser, click "Console" tab
// You'll see:
Connected to backend: {clientId: "socket123"}
Received event: {id: "abc123", title: "Therapy - Sarah"}
```

### **Check database directly:**
```bash
psql -U postgres -d therapy_scheduler

# See all events:
SELECT id, title, start_time, sync_status FROM events;

# See all sync logs:
SELECT * FROM sync_log ORDER BY created_at DESC;

# See conflicts:
SELECT * FROM conflicts;
```

---

## **Deployment (When You Go Live)**

```
Local (right now):
├─ Frontend: http://localhost:3000
├─ Backend: http://localhost:5000
├─ Database: localhost:5432

Production (later):
├─ Frontend: https://therapy-scheduler.com
├─ Backend: https://api.therapy-scheduler.com (Heroku, AWS, etc.)
├─ Database: RDS (Amazon), Cloud SQL (Google), etc.
```

---

Congratulations! You now understand the entire architecture! 🎉

