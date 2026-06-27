# Backend Setup - Quick Start Checklist

Follow this checklist to get your backend running in 30 minutes.

---

## **Before You Start**
- [ ] You have Node.js installed (check: `node --version`)
- [ ] You have PostgreSQL installed (check: `psql --version`)
- [ ] You have a Microsoft account (for OAuth)
- [ ] You have Splose API credentials

---

## **Phase 1: Setup (15 minutes)**

### **Step 1: PostgreSQL Database**

```bash
# Create the database
createdb -U postgres therapy_scheduler

# Verify it was created
psql -U postgres -d therapy_scheduler
# You should see: therapy_scheduler=#
# Type: \q to exit
```

✅ Database created

---

### **Step 2: Microsoft OAuth (Azure Portal)**

1. Go to **https://portal.azure.com**
2. Sign in with your Microsoft account
3. Search: "App registrations" → Click
4. Click "New registration"
5. Name it: `Therapy Scheduler Backend`
6. Click "Register"
7. **Copy these values:**
   - Application (client) ID → This is your `MICROSOFT_CLIENT_ID`
   - Click "Certificates & secrets"
   - Click "New client secret" 
   - Copy the value → This is your `MICROSOFT_CLIENT_SECRET`
8. Click "API permissions"
9. Click "Add a permission"
10. Select "Microsoft Graph" → "Delegated permissions"
11. Search and add: `Calendars.ReadWrite` and `User.Read`

✅ Azure app created and credentials saved

---

### **Step 3: Configure Backend**

```bash
# Navigate to backend folder
cd ~/Documents/Claude/Projects/Therapy\ Scheduling\ Application/backend

# Copy the template
cp .env.example .env

# Edit .env with your values
# On Mac:
nano .env

# On Windows:
# Open the file in Notepad or Visual Studio Code
```

**Fill in these values:**
```env
# Leave these as-is (local development)
PORT=5000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=therapy_scheduler
DB_USER=postgres
DB_PASSWORD=postgres

# Add your Microsoft credentials (from Azure Portal)
MICROSOFT_CLIENT_ID=paste_your_client_id_here
MICROSOFT_CLIENT_SECRET=paste_your_client_secret_here
MICROSOFT_REDIRECT_URI=http://localhost:5000/auth/oauth/callback

# Add your Splose credentials
SPLOSE_API_KEY=paste_your_splose_api_key
SPLOSE_BASE_URL=https://api.splose.com

# Random string (can be anything in development)
SESSION_SECRET=development-secret-change-later

# Your frontend URL (we'll update this later)
FRONTEND_URL=http://localhost:3000
```

✅ Environment configured

---

### **Step 4: Install Dependencies**

```bash
# Make sure you're in the backend folder
cd ~/Documents/Claude/Projects/Therapy\ Scheduling\ Application/backend

# Install all packages
npm install

# This takes 1-2 minutes
# You'll see: "added XXX packages"
```

✅ Dependencies installed

---

## **Phase 2: Start & Test (10 minutes)**

### **Step 5: Start the Server**

```bash
# In the backend folder
npm start

# You should see:
# ╔════════════════════════════════════════════════════╗
# ║     THERAPY SCHEDULER BACKEND STARTED              ║
# ║  Server running on: http://localhost:5000          ║
# ╚════════════════════════════════════════════════════╝
```

✅ Server running

**Keep this terminal open. If you close it, server stops.**

---

### **Step 6: Test in Browser**

Open a new browser tab and go to:
```
http://localhost:5000
```

You should see:
```json
{
  "message": "Therapy Scheduler Backend is Running ✓",
  "status": "active",
  "version": "1.0.0"
}
```

✅ Server responding

---

### **Step 7: Test OAuth**

Go to:
```
http://localhost:5000/auth/outlook-login
```

You should see a JSON response with an `authUrl`. This means OAuth is configured!

✅ OAuth configured

---

### **Step 8: Verify Database**

Open a new terminal (don't close the server terminal):

```bash
psql -U postgres -d therapy_scheduler

# Type this:
\dt

# You should see these tables:
# users
# events
# sync_log
# conflicts

# Type \q to exit
```

✅ Database tables created

---

## **Phase 3: Connect Frontend (5 minutes)**

### **Step 9: Update mockup_v3.html**

Edit `/Users/antonyxavier/Documents/Claude/Projects/Therapy Scheduling Application/mockup_v3.html`

Add this code in the `<script>` section (after the closing `</style>` tag):

```javascript
// ===== BACKEND CONNECTION =====

const API_BASE_URL = 'http://localhost:5000';

// Real-time connection to backend
const socket = (() => {
  try {
    return io(API_BASE_URL);
  } catch(e) {
    console.log('WebSocket library not available - some features will be limited');
    return null;
  }
})();

if (socket) {
  socket.on('connected', (data) => {
    console.log('✓ Connected to backend:', data);
  });

  socket.on('event_updated', (event) => {
    console.log('Event updated from backend:', event);
    // Refresh calendar when event changes
    if (typeof renderWeekView === 'function') {
      renderWeekView();
    }
  });

  socket.on('disconnect', () => {
    console.log('✗ Disconnected from backend');
  });
}

// ===== API FUNCTIONS =====

async function createEventViaBackend(eventData) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(eventData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Event created:', result);
    return result;
  } catch (error) {
    console.error('Error creating event:', error);
    alert('Error creating event: ' + error.message);
  }
}

async function getEventsFromBackend(startDate, endDate) {
  try {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    
    const response = await fetch(
      `${API_BASE_URL}/api/events?${params}`,
      { credentials: 'include' }
    );
    
    const data = await response.json();
    console.log('Events fetched:', data);
    return data.events || [];
  } catch (error) {
    console.error('Error fetching events:', error);
    return [];
  }
}

async function loginWithOutlook() {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/outlook-login`);
    const data = await response.json();
    console.log('OAuth URL:', data.authUrl);
    window.location.href = data.authUrl;
  } catch (error) {
    console.error('Error initiating login:', error);
    alert('Error logging in: ' + error.message);
  }
}

// ===== END BACKEND CONNECTION =====
```

✅ Frontend connected

---

## **Phase 4: Verify Everything Works**

### **Step 10: Full System Test**

1. **Keep server running** in terminal
2. **Open mockup_v3.html** in browser
3. **Open browser console** (F12 → Console tab)
4. You should see:
   ```
   ✓ Connected to backend: {clientId: "socket.io-xxxxx"}
   ```

✅ Frontend and backend communicating

---

## **Success Checklist**

You're done! Verify all of these:

- [ ] Server running in terminal (npm start)
- [ ] http://localhost:5000 responds with status message
- [ ] http://localhost:5000/auth/outlook-login shows OAuth URL
- [ ] Browser console shows "✓ Connected to backend"
- [ ] Database tables exist (checked via psql)
- [ ] No errors in server terminal

---

## **What's Running Now**

```
Your Computer:
├─ Frontend (mockup_v3.html) at http://localhost:3000
│  └─ Your calendar user interface
│
├─ Backend Server (Node.js) at http://localhost:5000
│  └─ Handles OAuth, syncing, real-time updates
│
├─ PostgreSQL Database on localhost:5432
│  └─ Stores all events and user data
│
└─ Real-time connection (WebSocket)
   └─ Sends instant updates when things change
```

---

## **Next: Actually Use It**

To test the sync in action:

### **Test 1: Create Event via Backend**

Open browser console and run:
```javascript
createEventViaBackend({
  title: "Test Appointment",
  startTime: "2024-01-20T14:00:00",
  endTime: "2024-01-20T15:00:00",
  clientName: "Test Client",
  eventType: "therapy"
});
```

Check:
- ✅ Event appears in your app
- ✅ Splose receives it (check Splose dashboard)
- ✅ Outlook calendar has it (check Outlook)

### **Test 2: Check Sync Status**

```javascript
fetch('http://localhost:5000/api/sync-status', {
  credentials: 'include'
})
.then(r => r.json())
.then(data => console.log('Sync status:', data));
```

---

## **Common Questions**

**Q: Can I close the server terminal?**
A: No, keep it open. When you close it, the server stops.

**Q: How do I stop the server?**
A: Press `Ctrl+C` in the terminal where it's running.

**Q: How do I restart the server?**
A: Press `Ctrl+C`, then run `npm start` again.

**Q: What if something breaks?**
A: Check the error in the server terminal. Google it. Or see SETUP_GUIDE.md troubleshooting section.

**Q: How do I deploy this later?**
A: We'll cover that when you're ready. For now, run locally.

---

## **Helpful Documentation**

- **README.md** - Full feature list and API documentation
- **SETUP_GUIDE.md** - Detailed installation with all concepts explained
- **ARCHITECTURE.md** - How the entire system works together

Read these when you have questions!

---

## **You're All Set! 🎉**

Your bidirectional sync backend is now running with:
- ✅ Real-time calendar syncing
- ✅ Microsoft Outlook integration
- ✅ Splose synchronization
- ✅ Teams meeting support
- ✅ Secure OAuth authentication
- ✅ Conflict detection & resolution
- ✅ Complete audit logging

**Your therapy scheduler app now has enterprise-grade backend infrastructure!**

---

## **Next Phase (When Ready)**

Once you've tested locally:
1. Deploy to production (Heroku, AWS, Azure, etc.)
2. Set up production database
3. Update frontend to use production API URL
4. Enable webhook subscriptions for real-time Outlook sync
5. Add monitoring and error tracking
6. Set up automated backups

We can do all this together when you're ready!

---

**Questions? Stuck? Try the SETUP_GUIDE.md troubleshooting section first!**

Happy scheduling! 🗓️✨
