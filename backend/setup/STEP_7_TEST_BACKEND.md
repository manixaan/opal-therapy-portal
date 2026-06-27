# Step 7: Test Your Backend - Beginner's Guide

## **What Are We Testing?**

We're verifying that everything works:

```
✓ Server is running
✓ Database is connected
✓ OAuth is configured
✓ API endpoints respond
✓ WebSocket is connected
✓ Everything is ready for use
```

---

## **Test 1: Server Health Check**

**In your browser, go to:**

```
http://localhost:5001
```

**You should see JSON:**

```json
{
  "message": "Therapy Scheduler Backend is Running ✓",
  "status": "active",
  "version": "1.0.0",
  "endpoints": {
    "auth": "GET /auth/outlook-login",
    "events": "POST /api/events",
    "sync": "POST /api/sync",
    "health": "GET /health"
  }
}
```

**Result:** ✅ Server is responding

---

## **Test 2: Health Endpoint**

Go to:

```
http://localhost:5001/health
```

You should see:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T14:23:45.123Z"
}
```

**Result:** ✅ Server is healthy

---

## **Test 3: OAuth Configuration**

Go to:

```
http://localhost:5001/auth/outlook-login
```

You should see JSON with an `authUrl`. It looks like:

```json
{
  "message": "Redirect to this URL to login with Microsoft",
  "authUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=YOUR_CLIENT_ID&...",
  "instruction": "User should navigate to: https://..."
}
```

**Result:** ✅ OAuth is configured

---

## **Test 4: Database Connection**

**In a NEW terminal window (not the server one):**

```bash
# Connect to database
psql -U postgres -d therapy_scheduler

# You should see the prompt:
# therapy_scheduler=#

# Check tables exist
\dt

# You should see these tables:
#                 List of relations
# Schema |       Name        | Type  | Owner
#--------+-------------------+-------+----------
# public | conflicts         | table | postgres
# public | events            | table | postgres
# public | sync_log          | table | postgres
# public | users             | table | postgres

# Exit
\q
```

**Result:** ✅ Database tables exist

---

## **Test 5: API - Get Events**

**In the browser, go to:**

```
http://localhost:5001/api/events
```

**You might see:**

```json
{
  "error": "Not authenticated"
}
```

**This is OK!** It means:
- ✅ The endpoint exists
- ✅ Authentication is working
- ✅ We're not logged in yet (expected)

---

## **Test 6: WebSocket Connection**

We'll test this from the browser console.

**1. Open your browser's developer console:**
   - Press `F12`
   - Click the "Console" tab

**2. Paste this code:**

```javascript
// Try to connect to backend
const socket = io('http://localhost:5001');

socket.on('connected', (data) => {
  console.log('✅ Connected to backend:', data);
});

socket.on('error', (error) => {
  console.error('❌ Connection error:', error);
});

socket.on('disconnect', () => {
  console.log('⚠️ Disconnected from backend');
});
```

**3. Press Enter**

**You should see in the console:**

```
✅ Connected to backend: {message: "Connected to Therapy Scheduler Backend", clientId: "socket.io-abc123def"}
```

**Result:** ✅ WebSocket is working

---

## **Test 7: Check Server Terminal Output**

**Go back to the terminal where `npm start` is running**

You should see logs like:

```
✓ Client connected: socket.io-abc123def456
Database initialized successfully
Server running on: http://localhost:5000
```

**Result:** ✅ Server is logging activity

---

## **Complete Checklist**

- [ ] Browser shows server running at http://localhost:5001
- [ ] `/health` endpoint responds with status: "healthy"
- [ ] `/auth/outlook-login` shows OAuth URL
- [ ] Database tables exist when checking with psql
- [ ] `/api/events` endpoint exists (shows authentication error is OK)
- [ ] Browser console shows "✅ Connected to backend"
- [ ] Server terminal shows "Client connected"

**If all are checked:** Your backend is working! 🎉

---

## **Understanding the Test Results**

### **"Not authenticated" Error on /api/events**

This is actually good! It means:

```
Request: GET /api/events
↓
Server receives it
↓
Server checks: "Is this user logged in?"
↓
Answer: "No, they're not authenticated"
↓
Response: {"error": "Not authenticated"}
```

This is the expected behavior! It means authentication is working.

---

## **What Each Test Verifies**

| Test | Verifies |
|------|----------|
| Server health | Server is running and responsive |
| Health endpoint | Server can respond to requests |
| OAuth endpoint | OAuth is configured |
| Database tables | PostgreSQL is working and schema is set up |
| API endpoint | Routes are registered |
| WebSocket | Real-time communication is ready |
| Server logs | Activity is being logged |

---

## **Troubleshooting**

### **Test 1 Fails: "Cannot reach http://localhost:5001"**

**Problem:** Server isn't running

**Solution:**
```bash
# Make sure you ran:
npm start

# And the server terminal shows:
# Server running on: http://localhost:5001
```

### **Database Test Fails: "Database does not exist"**

**Problem:** Database wasn't created

**Solution:**
```bash
createdb -U postgres therapy_scheduler
```

Then run Test 4 again.

### **OAuth Test Shows Error**

**Problem:** MICROSOFT_CLIENT_ID is wrong

**Solution:**
1. Go back to STEP_3_AZURE_OAUTH.md
2. Verify your Client ID in Azure Portal
3. Update .env with correct value
4. Restart server: `Ctrl + C` then `npm start`

### **WebSocket Test Shows Error: "GET http://localhost:5001/socket.io/?..."**

**Problem:** Socket.io library missing

**Solution:**
```bash
# Run npm install again
npm install

# Restart server
npm start
```

### **"Cannot POST /api/events"**

**Problem:** Something wrong with routes

**Solution:**
1. Make sure server is running
2. Check server terminal for errors
3. Restart server: `Ctrl + C` then `npm start`

---

## **Success Looks Like This**

When everything works:

**Browser shows:**
```json
{
  "message": "Therapy Scheduler Backend is Running ✓",
  "status": "active"
}
```

**Console shows:**
```
✅ Connected to backend: {clientId: "socket.io-..."}
```

**Server terminal shows:**
```
✓ Client connected: socket.io-...
Server running on: http://localhost:5001
```

**Database works:**
```
therapy_scheduler=# \dt
(4 rows showing tables)
```

---

## **What This Means**

Your backend is fully functional:

✅ Web server running
✅ Database connected
✅ OAuth configured
✅ API endpoints working
✅ Real-time WebSocket ready
✅ Security in place
✅ All systems ready

---

## **You've Successfully Completed Setup! 🎉**

You now have a fully operational backend with:

✅ Node.js and npm
✅ PostgreSQL database
✅ Microsoft OAuth
✅ Environment variables configured
✅ All packages installed
✅ Server running and tested

---

## **What's Next?**

The backend is complete! Next steps:

1. **Connect frontend** to backend (mockup_v3.html)
2. **Create an event** and verify it syncs to all three systems
3. **Test Outlook sync** by editing in Outlook and seeing app update
4. **Test Teams meetings** by checking if they appear in your app

But first, **keep the backend running while you do everything else!**

---

## **Keep Server Running**

Remember: The server must stay running for your app to work.

```
Terminal 1: npm start (keep running)
Terminal 2: Your work and testing
Terminal 3: Optional
```

If the server stops, your app can't communicate with it!

---

## **Congratulations! 🎊**

You've successfully:

1. ✅ Installed Node.js
2. ✅ Set up PostgreSQL database
3. ✅ Created Azure OAuth app
4. ✅ Configured environment variables
5. ✅ Installed all dependencies
6. ✅ Started the server
7. ✅ Tested everything works

**Your therapy scheduler backend is LIVE!**

