# Complete Backend Setup Index - Start Here!

Welcome! This is your complete guide to setting up the therapy scheduler backend. Follow the steps in order.

---

## **🎯 What You're Building**

A professional backend server that:
- ✅ Syncs events between your app, Splose, and Outlook
- ✅ Handles secure Microsoft login
- ✅ Provides real-time updates via WebSocket
- ✅ Detects and resolves conflicts
- ✅ Integrates with Teams meetings

---

## **⏱️ Total Time: 60-90 Minutes**

- Step 1 (Node.js): 15 minutes
- Step 2 (PostgreSQL): 15 minutes
- Step 3 (Azure OAuth): 10 minutes
- Step 4 (Environment Setup): 5 minutes
- Step 5 (npm install): 3 minutes
- Step 6 (Start Server): 2 minutes
- Step 7 (Testing): 10 minutes

---

## **📋 Step-by-Step Guide**

### **Step 1: Install Node.js**
📄 **[Read: STEP_1_NODE_JS.md](STEP_1_NODE_JS.md)**

**What:** Install Node.js (JavaScript runtime)
**Time:** 15 minutes
**Outcome:** `node --version` shows v18.x

**Key Concepts:**
- Node.js lets JavaScript run on your computer
- npm is the package manager (downloads code libraries)

---

### **Step 2: Set Up PostgreSQL Database**
📄 **[Read: STEP_2_POSTGRESQL.md](STEP_2_POSTGRESQL.md)**

**What:** Install and configure PostgreSQL database
**Time:** 15 minutes
**Outcome:** Database "therapy_scheduler" exists and is working

**Key Concepts:**
- PostgreSQL stores all your events
- Tables organize data (users, events, sync_log, conflicts)
- Running: `psql -U postgres -d therapy_scheduler`

**Save These Credentials:**
```
Host: localhost
Port: 5432
Database: therapy_scheduler
User: postgres
Password: [what you set]
```

---

### **Step 3: Create Azure OAuth App**
📄 **[Read: STEP_3_AZURE_OAUTH.md](STEP_3_AZURE_OAUTH.md)**

**What:** Create Microsoft app for secure OAuth login
**Time:** 10 minutes
**Outcome:** Have Client ID and Client Secret saved

**Key Concepts:**
- OAuth lets users login with Microsoft account securely
- Client ID = username for your app
- Client Secret = password for your app (keep it secret!)
- Permissions tell Microsoft what your app can do

**Save These Values:**
```
MICROSOFT_CLIENT_ID = [your_client_id]
MICROSOFT_CLIENT_SECRET = [your_client_secret]
MICROSOFT_REDIRECT_URI = http://localhost:5000/auth/oauth/callback
```

---

### **Step 4: Configure Environment Variables**
📄 **[Read: STEP_4_ENV_SETUP.md](STEP_4_ENV_SETUP.md)**

**What:** Create .env file with all configuration
**Time:** 5 minutes
**Outcome:** .env file filled with your values

**Key Concepts:**
- .env stores secrets and configuration
- Never share .env file
- Server reads from .env when it starts

**Files:**
- Copy: `.env.example` → `.env`
- Edit: Fill in your values (Client ID, Secret, Password, etc.)

---

### **Step 5: Install Dependencies**
📄 **[Read: STEP_5_NPM_INSTALL.md](STEP_5_NPM_INSTALL.md)**

**What:** Download all code libraries (packages)
**Time:** 3 minutes
**Outcome:** node_modules folder with 150+ packages

**Key Concepts:**
- npm install reads package.json (the recipe)
- Downloads Express, axios, Socket.io, etc.
- Creates node_modules folder (don't edit!)

**Command:**
```bash
npm install
```

---

### **Step 6: Start the Server**
📄 **[Read: STEP_6_START_SERVER.md](STEP_6_START_SERVER.md)**

**What:** Boot up your backend server
**Time:** 2 minutes
**Outcome:** Server running on http://localhost:5000

**Key Concepts:**
- Server listens for requests
- Connects to PostgreSQL
- Ready to accept connections
- **Keep terminal window open!**

**Command:**
```bash
npm start
```

**Watch for:**
```
╔════════════════════════════════════════════════════╗
║     THERAPY SCHEDULER BACKEND STARTED              ║
║  Server running on: http://localhost:5000          ║
╚════════════════════════════════════════════════════╝
```

---

### **Step 7: Test Everything**
📄 **[Read: STEP_7_TEST_BACKEND.md](STEP_7_TEST_BACKEND.md)**

**What:** Verify all systems are working
**Time:** 10 minutes
**Outcome:** All tests pass ✅

**Tests:**
1. ✅ Server responds at http://localhost:5000
2. ✅ Health check at /health
3. ✅ OAuth configured at /auth/outlook-login
4. ✅ Database tables exist
5. ✅ API endpoints exist
6. ✅ WebSocket connects in browser console

---

## **🔑 Important Credentials Checklist**

Before starting, gather these:

- [ ] PostgreSQL password (what you set during install)
- [ ] Microsoft account (for Azure)
- [ ] MICROSOFT_CLIENT_ID (from Azure)
- [ ] MICROSOFT_CLIENT_SECRET (from Azure)
- [ ] Splose API Key (ask your Splose admin)

---

## **📁 Backend Folder Structure**

After setup:

```
backend/
├── .env                    ← Your secrets (DO NOT SHARE)
├── .env.example            ← Template (reference)
├── package.json            ← List of packages
├── package-lock.json       ← Exact package versions
├── node_modules/           ← All downloaded packages (huge!)
│
├── server.js               ← Main server file
├── database.js             ← Database helper functions
├── routes.js               ← API endpoints
├── outlook-oauth.js        ← Microsoft integration
├── splose-api.js           ← Splose integration
│
├── README.md               ← Full API documentation
├── ARCHITECTURE.md         ← System design explanation
├── SETUP_GUIDE.md          ← Original detailed guide
└── BACKEND_QUICKSTART.md   ← Quick reference
```

---

## **✅ Success Checklist**

After completing all steps, you should have:

### **Installations:**
- [ ] Node.js installed (`node --version` works)
- [ ] npm installed (`npm --version` works)
- [ ] PostgreSQL installed and running
- [ ] Database created: `therapy_scheduler`

### **Configuration:**
- [ ] Azure app created
- [ ] Client ID and Secret saved
- [ ] .env file created with all values
- [ ] Database credentials in .env
- [ ] Microsoft credentials in .env

### **Running:**
- [ ] `npm install` completed successfully
- [ ] `npm start` shows server running
- [ ] Server terminal shows no errors
- [ ] http://localhost:5000 responds

### **Testing:**
- [ ] All 7 tests from STEP_7 pass
- [ ] Server terminal shows activity
- [ ] Browser console shows "Connected to backend"

---

## **🚀 After Setup: What's Next?**

**Keep the server running!** It must stay running for your app to work.

Next steps:
1. Connect your frontend (mockup_v3.html) to the backend
2. Create test events
3. Verify sync to Splose and Outlook
4. Test Outlook changes sync back to your app
5. Test Teams meeting visibility

---

## **❓ Stuck on a Step?**

**Check the right file:**

| Problem | Read |
|---------|------|
| Node.js won't install | STEP_1_NODE_JS.md (troubleshooting) |
| PostgreSQL issues | STEP_2_POSTGRESQL.md (troubleshooting) |
| Azure OAuth problems | STEP_3_AZURE_OAUTH.md (troubleshooting) |
| .env file issues | STEP_4_ENV_SETUP.md (troubleshooting) |
| npm install failing | STEP_5_NPM_INSTALL.md (troubleshooting) |
| Server won't start | STEP_6_START_SERVER.md (troubleshooting) |
| Tests failing | STEP_7_TEST_BACKEND.md (troubleshooting) |
| General questions | README.md or ARCHITECTURE.md |

---

## **🔒 Security Reminders**

⚠️ **NEVER:**
- Share your .env file
- Post your Client Secret online
- Commit .env to version control
- Put secrets in code

✅ **DO:**
- Keep .env secret
- Use different secrets for production
- Rotate secrets regularly
- Use strong passwords

---

## **📊 Quick Reference**

### **Common Commands**

```bash
# Navigate to backend folder
cd ~/Documents/Claude/Projects/Therapy\ Scheduling\ Application/backend

# Install packages
npm install

# Start server
npm start

# Stop server
Ctrl + C

# Restart server
Ctrl + C, then npm start

# Check Node version
node --version

# Check npm version
npm --version

# Check PostgreSQL
psql -U postgres -d therapy_scheduler
```

### **Useful URLs**

```
Server: http://localhost:5000
Health: http://localhost:5000/health
OAuth: http://localhost:5000/auth/outlook-login
Browser console: F12 (for WebSocket tests)
```

---

## **💬 Explaining to Others**

If someone asks what you're doing:

"I'm setting up a backend server for my therapy scheduler. It's written in Node.js, uses PostgreSQL for storage, authenticates with Microsoft OAuth, and syncs events between my app, Splose, and Outlook in real-time."

---

## **🎯 Your Goal**

By the end of these 7 steps, you'll have:

✅ A running Node.js backend server
✅ A PostgreSQL database
✅ Secure OAuth authentication
✅ Real-time WebSocket communication
✅ API endpoints ready to use
✅ Integration with Splose and Outlook
✅ Professional infrastructure

---

## **🚀 Ready to Start?**

Begin with **[STEP_1_NODE_JS.md](STEP_1_NODE_JS.md)**

**Estimated completion time:** 60-90 minutes

**Difficulty:** Beginner-friendly (all steps explained)

**Support:** Each step has troubleshooting section

---

## **Final Words**

You're building enterprise-grade infrastructure for your therapy scheduler. Follow each step in order, don't skip anything, and take your time to understand what's happening.

If you get stuck, **read the troubleshooting section** of that step—it probably has your answer!

**Good luck! You've got this! 💪**

