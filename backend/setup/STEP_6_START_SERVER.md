# Step 6: Start the Server - Beginner's Guide

## **What Does npm start Do?**

`npm start` reads the command in `package.json` and starts your server.

```
npm start
  ↓
package.json says: "start": "node server.js"
  ↓
Runs: node server.js
  ↓
server.js loads and:
- Connects to PostgreSQL
- Sets up Express web server
- Initializes WebSocket
- Starts listening for requests on port 5000
  ↓
Server is ALIVE and waiting for requests!
```

---

## **Step 1: Make Sure Everything is Ready**

Before starting, verify:

**1. PostgreSQL is running**

```bash
# Check it's running
psql -U postgres -d therapy_scheduler

# You should see: therapy_scheduler=#

# Type \q to exit
\q
```

If PostgreSQL isn't running:
- **Mac:** `brew services start postgresql@14`
- **Windows:** PostgreSQL should start automatically

**2. You're in the backend folder**

```bash
# Make sure you're here
cd ~/Documents/Claude/Projects/Therapy\ Scheduling\ Application/backend

# Verify
pwd
# Should show: .../Therapy Scheduling Application/backend
```

**3. .env file exists with your values**

```bash
# Check it exists
cat .env  # On Mac
type .env  # On Windows

# Should show all your settings
```

---

## **Step 2: Start the Server**

**On Mac or Windows:**

```bash
npm start
```

Press Enter.

---

## **What You Should See**

After running `npm start`, you should see:

```
╔════════════════════════════════════════════════════╗
║     THERAPY SCHEDULER BACKEND STARTED              ║
╠════════════════════════════════════════════════════╣
║  Server running on: http://localhost:5000          ║
║  Environment: development                          ║
║  Real-time syncing: READY                          ║
║  Database: PostgreSQL (pending connection)         ║
║  OAuth: Microsoft Graph API (pending setup)        ║
╚════════════════════════════════════════════════════╝
```

**If you see this, your server is RUNNING!** ✅

---

## **Understanding the Output**

```
Server running on: http://localhost:5000
  ↓
Your computer's address is "localhost"
The server is listening on port 5000
You can reach it at: http://localhost:5000

Environment: development
  ↓
You're in development mode (not production)
More verbose error messages (helpful for debugging)

Real-time syncing: READY
  ↓
WebSocket is ready for real-time updates
When something changes, clients will be notified instantly
```

---

## **Keep This Terminal Open!**

⚠️ **Important:** Keep this terminal window open!

```
While server is running:
✅ Can accept requests
✅ Can sync events
✅ Can handle login
✅ Can send real-time updates

If you close the terminal:
❌ Server stops
❌ No requests can be processed
❌ Sync stops working
```

---

## **Step 3: Test the Server in a Browser**

**Open a NEW terminal/command prompt window** (keep the server window open!)

**You don't need to do anything in the new window. Just:**

1. Open your browser
2. Go to: **http://localhost:5000**
3. You should see:

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

**If you see this, the server is working!** ✅

---

## **Check Server Logs**

Go back to the terminal where the server is running.

You should see messages like:

```
Server running on: http://localhost:5000
✓ Client connected: socket.io-xxxxx
Initializing database...
✓ Database initialized successfully
```

These are logs showing what the server is doing. It's good to see them!

---

## **Step 4: Test OAuth**

In your browser, go to: **http://localhost:5000/auth/outlook-login**

You should see:

```json
{
  "message": "Redirect to this URL to login with Microsoft",
  "authUrl": "https://login.microsoft.com/common/oauth2/v2.0/authorize?client_id=YOUR_CLIENT_ID&...",
  "instruction": "User should navigate to: https://..."
}
```

**This means OAuth is configured!** ✅

---

## **Understanding What's Running**

```
Your Computer:
├─ Terminal 1: npm start (server running here)
│  └─ Listening on http://localhost:5000
│
└─ Terminal 2 (browser): Your requests go here
   └─ Sends requests to http://localhost:5000
      └─ Server processes and responds
```

---

## **Server Commands**

Once the server is running, here are useful commands:

**In the server terminal:**

| Key Combo | What It Does |
|-----------|--------------|
| `Ctrl + C` | STOP the server |
| (no commands) | Server just runs and shows logs |

---

## **Stopping the Server**

To stop the server:

1. Go to the terminal where server is running
2. Press: `Ctrl + C`

You should see:
```
^C (this shows what you pressed)
[Finished]
```

The server is now stopped.

---

## **Restarting the Server**

To start it again:

```bash
npm start
```

---

## **Server Output Explained**

When you see messages like:

```
✓ Client connected: socket.io-abc123def456
```

This means a client (your browser) connected via WebSocket for real-time updates.

```
POST /api/events
```

This means someone made a POST request to create an event.

```
Database query executed in 45ms
```

This shows how long a database operation took.

These logs are helpful for debugging!

---

## **Troubleshooting**

### **"listen EADDRINUSE: address already in use :::5000"**

**Problem:** Another program is using port 5000

**Solution:**
```bash
# Find what's using port 5000
lsof -i :5000  # On Mac

# Kill it:
kill -9 <PID>  # Where <PID> is the number shown

# Or change the port in .env:
PORT=5001
```

Then try `npm start` again.

### **"Cannot find module 'express'"**

**Problem:** npm install didn't finish

**Solution:**
```bash
# Run npm install again
npm install

# Then try npm start
npm start
```

### **"database does not exist"**

**Problem:** PostgreSQL database wasn't created

**Solution:**
Go back to STEP_2_POSTGRESQL.md and create the database:
```bash
createdb -U postgres therapy_scheduler
```

### **"Error: connect ECONNREFUSED 127.0.0.1:5432"**

**Problem:** PostgreSQL not running

**Solution:**
```bash
# Mac:
brew services start postgresql@14

# Windows:
# Use Services app or restart computer
```

### **"ENOENT: no such file or directory, open '.env'"**

**Problem:** .env file doesn't exist

**Solution:**
Go back to STEP_4_ENV_SETUP.md and create it:
```bash
cp .env.example .env
# Then fill it in with your values
```

### **Server starts but nothing happens**

**Problem:** Server is running but you're not connecting

**Solution:**
1. Open browser
2. Go to http://localhost:5000
3. Should see the JSON response
4. If not, check server terminal for errors

---

## **Server is Running - What's Next?**

**Keep the server running!**

The server needs to stay running while you:
- Test it
- Connect your frontend
- Create events
- Sync with Outlook

---

## **Important: Keep Server Window Open**

While developing, always keep the server running in the background:

```
Terminal 1: npm start (running)
Terminal 2: Your work (browser, editing code, etc.)
Terminal 3: Optional (for running other commands)
```

---

## **You're Done! ✅**

Your server is running! 

✅ Backend server running on http://localhost:5000
✅ PostgreSQL database connected
✅ OAuth configured
✅ Real-time WebSocket ready
✅ All systems ready for testing

**Next Step:** Go to STEP_7_TEST_BACKEND.md

---

## **Quick Summary**

```
npm start 
  ↓
Server boots up
  ↓
Connects to PostgreSQL
  ↓
Starts listening on port 5000
  ↓
Ready to handle requests!
```

**The server stays running until you press Ctrl + C**

