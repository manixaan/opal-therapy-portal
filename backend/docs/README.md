# Therapy Scheduler Backend - Node.js Bidirectional Sync Engine

A professional, production-ready backend server for syncing therapy scheduling events bidirectionally between your app, Splose, and Microsoft Outlook Calendar with real-time updates.

---

## **What This Is**

Your backend server that handles:
- ✅ **Bidirectional Calendar Sync** - Everything in app ↔ Outlook ↔ Splose
- ✅ **Real-Time Updates** - WebSocket for instant changes (no polling)
- ✅ **Secure OAuth** - Microsoft login without exposing secrets
- ✅ **Conflict Resolution** - Handles simultaneous edits
- ✅ **Teams Meeting Integration** - Shows Teams meetings in your app
- ✅ **NDIS Plan Tracking** - Stores rich therapy metadata
- ✅ **Comprehensive Logging** - Audit trail of all sync actions

---

## **Quick Start**

### **1. Prerequisites**
- Node.js 16+ installed
- PostgreSQL running
- Microsoft Azure account (for OAuth)
- Splose API credentials

### **2. Installation (5 minutes)**

```bash
# Navigate to backend folder
cd ~/Documents/Claude/Projects/Therapy\ Scheduling\ Application/backend

# Copy environment template
cp .env.example .env

# Edit .env with your credentials (see SETUP_GUIDE.md)
nano .env

# Install dependencies
npm install

# Start server
npm start
```

You should see:
```
╔════════════════════════════════════════════════════╗
║     THERAPY SCHEDULER BACKEND STARTED              ║
╠════════════════════════════════════════════════════╣
║  Server running on: http://localhost:5000          ║
║  Environment: development                          ║
║  Real-time syncing: READY                          ║
╚════════════════════════════════════════════════════╝
```

### **3. Test It**

```bash
# In your browser:
http://localhost:5000

# Should show: "Therapy Scheduler Backend is Running ✓"
```

---

## **File Guide**

| File | Purpose | When You Need It |
|------|---------|-----------------|
| **server.js** | Main app boot | Don't edit unless adding new endpoints |
| **database.js** | PostgreSQL operations | Don't edit - it's complete |
| **routes.js** | API endpoints | Main file with sync logic - review it |
| **outlook-oauth.js** | Microsoft integration | Don't edit unless debugging OAuth |
| **splose-api.js** | Splose integration | Might need to adjust based on your Splose version |
| **SETUP_GUIDE.md** | Installation instructions | Read this first! |
| **ARCHITECTURE.md** | System design explanation | Read for understanding |
| **.env** | Your secrets | Create from .env.example |
| **package.json** | Dependencies list | Don't edit |

---

## **API Endpoints**

### **Authentication**
```
GET /auth/outlook-login
  → Initiates Microsoft OAuth
  → Returns: {authUrl: "https://login.microsoft.com/..."}

GET /auth/oauth/callback
  → Microsoft redirects here after user approves
  → Creates session
  → Returns: {user: {id, email}}

GET /auth/logout
  → Ends session
```

### **Events**
```
GET /api/events
  → Get all events for logged-in user
  → Query params: startDate, endDate, eventType
  → Returns: {count: 5, events: [...]}

POST /api/events
  → Create new event
  → Body: {title, startTime, endTime, clientName, ...}
  → Syncs to: Database → Splose → Outlook
  → Returns: {event: {...}, synced: {database, splose, outlook}}

PUT /api/events/:id
  → Update existing event
  → Body: {title, startTime, endTime, ...}
  → Returns: {event: {...}}

DELETE /api/events/:id
  → Delete event from all systems
  → Returns: {deletedId: "..."}
```

### **Sync**
```
POST /api/sync
  → Manually trigger full sync
  → Syncs from: Splose, Outlook, Database
  → Resolves conflicts
  → Returns: {results: {splose_events_synced: 3, ...}}

GET /api/sync-status
  → Check sync status
  → Returns: {total_events: 10, synced: 8, pending: 1, failed: 1}
```

### **Calendar**
```
GET /api/calendar/availability
  → Get therapist's free time slots
  → Query params: startDate, endDate
  → Returns: {blockedTimes: [...], availableSlotsApprox: "20 hours"}
```

---

## **Real-Time WebSocket Events**

```javascript
// In your frontend (mockup_v3.html):

const socket = io('http://localhost:5000');

// Receive real-time updates
socket.on('event_created', (event) => {
  console.log('New event:', event);
});

socket.on('event_updated', (event) => {
  console.log('Event changed:', event);
});

socket.on('event_deleted', (eventId) => {
  console.log('Event removed:', eventId);
});

socket.on('sync_complete', (results) => {
  console.log('Sync done:', results);
});
```

---

## **Architecture**

```
Frontend (mockup_v3.html)
    ↓
    ↓ HTTP + WebSocket
    ↓
Backend (this server)
    ├─ Authentication (OAuth)
    ├─ Event Management (CRUD)
    ├─ Sync Engine
    └─ Real-Time Broadcasting
    ↓
    ├─ PostgreSQL Database
    ├─ Splose API
    ├─ Microsoft Graph API
    └─ Outlook Calendar + Teams
```

---

## **Database Schema**

**Users Table**
- id, email, microsoft_id, access_token, refresh_token, token_expires_at

**Events Table**
- id, user_id, title, description, start_time, end_time, location
- event_type (therapy, leave, cpd, travel, meeting, teams_meeting)
- splose_id, outlook_id, teams_meeting_id (linking IDs)
- client_name, regional_tag, travel_distance, ndis_plan_expiry
- sync_status, last_modified_by, last_modified_at

**Sync Log Table**
- id, event_id, action (created/updated/deleted), source, target, status, error_message

**Conflicts Table**
- id, event_id, conflict_type, resolution

---

## **Key Features Explained**

### **1. Bidirectional Sync**
```
When you add event in your app:
  → Saves to Database
  → Creates in Splose
  → Creates in Outlook
  → All show same event

When you edit in Outlook:
  → Webhook notifies backend
  → Updates Database
  → Updates Splose
  → Your app updates in real-time
```

### **2. Linking**
```
One event = three IDs:
- Local ID: "abc123" (your database)
- Splose ID: "xyz789" (Splose system)
- Outlook ID: "def456" (Outlook calendar)

These are stored together so we know which event is which
```

### **3. Conflict Resolution**
```
If both places change simultaneously:
- Database records the conflict
- Applies "last-write-wins" strategy
- Notifies user
- All systems end up with same data
```

### **4. Teams Meetings**
```
When Teams meeting is on calendar:
- Detected via Outlook API
- Marked as read-only in your app
- Shows as blocked time in auto-fit algorithm
- Includes Teams join link
```

---

## **Environment Variables Explained**

```env
# Server
PORT=5000                                    # Port to run on
NODE_ENV=development                         # dev or production

# Database
DB_HOST=localhost                            # Where PostgreSQL runs
DB_NAME=therapy_scheduler                    # Database name
DB_USER=postgres                             # Database user
DB_PASSWORD=postgres                         # Database password

# Microsoft Azure (OAuth)
MICROSOFT_CLIENT_ID=xxxxx                    # From Azure Portal
MICROSOFT_CLIENT_SECRET=xxxxx                # From Azure Portal
MICROSOFT_REDIRECT_URI=http://localhost:5000/auth/oauth/callback

# Splose
SPLOSE_API_KEY=xxxxx                        # Your Splose API key
SPLOSE_BASE_URL=https://api.splose.com      # Splose endpoint

# Security
SESSION_SECRET=random-string-change-in-prod  # Random secret

# Frontend
FRONTEND_URL=http://localhost:3000           # Where your app runs
```

---

## **How to Connect Frontend**

Update your `mockup_v3.html`:

```javascript
// Add to <script> section:

const API_BASE_URL = 'http://localhost:5000';
const socket = io(API_BASE_URL);

// Create event
async function createEvent(eventData) {
  const response = await fetch(`${API_BASE_URL}/api/events`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify(eventData)
  });
  return response.json();
}

// Get events
async function getEvents() {
  const response = await fetch(`${API_BASE_URL}/api/events`, {
    credentials: 'include'
  });
  return response.json();
}

// Real-time updates
socket.on('event_updated', (event) => {
  // Refresh calendar display
  loadCalendar();
});
```

---

## **Troubleshooting**

| Problem | Solution |
|---------|----------|
| `Cannot find module` | Run `npm install` |
| `Database connection refused` | Start PostgreSQL (`brew services start postgresql@14`) |
| `Port 5000 already in use` | Change PORT in .env or kill other process |
| `Invalid OAuth credentials` | Check MICROSOFT_CLIENT_ID and SECRET |
| `Timeout waiting for connection` | Verify DB_HOST and PostgreSQL is running |

See **SETUP_GUIDE.md** for detailed troubleshooting.

---

## **Development Tips**

### **View Server Logs**
```bash
# Running server shows all requests:
✓ POST /api/events
  └─ User: test@example.com
  └─ Event: "Therapy - Sarah"
  └─ Synced to: database, splose, outlook
```

### **View Database**
```bash
psql -U postgres -d therapy_scheduler

# List events:
SELECT id, title, start_time, sync_status FROM events;

# View sync log:
SELECT * FROM sync_log ORDER BY created_at DESC LIMIT 10;
```

### **Test API Endpoints**
```bash
# Using curl:
curl -X POST http://localhost:5000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Event",
    "startTime": "2024-01-15T14:00:00",
    "endTime": "2024-01-15T15:00:00"
  }'

# Using Postman (GUI tool):
# 1. Download Postman
# 2. Create POST request to http://localhost:5000/api/events
# 3. Add JSON body with event data
# 4. Send!
```

---

## **Next Steps**

1. ✅ **Setup** - Follow SETUP_GUIDE.md
2. ✅ **Start Server** - `npm start`
3. ✅ **Test API** - Visit http://localhost:5000
4. ⏭️ **Connect Frontend** - Update mockup_v3.html with fetch calls
5. ⏭️ **Setup Webhooks** - Enable real-time Outlook sync
6. ⏭️ **Deploy** - Put on Heroku, AWS, or your own server

---

## **Deployment Checklist**

When ready to go live:

```
□ Update .env with production credentials
□ Change NODE_ENV to production
□ Use production database (RDS, Cloud SQL, etc.)
□ Set up HTTPS certificates
□ Configure CORS with production domain
□ Set up webhook verification
□ Enable error logging (Sentry, LogRocket, etc.)
□ Add monitoring (uptime checks, error alerts)
□ Test full sync in production
□ Set up automated backups
```

---

## **Technical Stack**

- **Runtime**: Node.js 18+
- **Framework**: Express.js 4.18
- **Database**: PostgreSQL 14+
- **Real-time**: Socket.io 4.6
- **Auth**: Passport.js + OAuth 2.0
- **API Clients**: axios, @microsoft/microsoft-graph-client
- **HTTP**: CORS, body-parser
- **Session**: express-session

---

## **Support**

### **Documentation**
- **SETUP_GUIDE.md** - Installation & first run
- **ARCHITECTURE.md** - System design deep dive

### **Common Issues**
See Troubleshooting section above

### **Community**
- Node.js docs: https://nodejs.org/docs
- Express guide: https://expressjs.com
- PostgreSQL docs: https://www.postgresql.org/docs
- Microsoft Graph: https://docs.microsoft.com/graph

---

## **License**

MIT - Use freely, modify, distribute

---

**Built with ❤️ for Therapy Scheduler**

Let's sync some calendars! 🚀
