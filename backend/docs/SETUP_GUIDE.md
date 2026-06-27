# Therapy Scheduler Backend - Complete Setup Guide

Welcome! This guide walks you through setting up the bidirectional sync backend. Even if you're new to backend development, we'll explain each step.

---

## **Table of Contents**
1. [What We Built](#what-we-built)
2. [Prerequisites](#prerequisites)
3. [Step 1: Install Node.js](#step-1-install-nodejs)
4. [Step 2: Set Up Database (PostgreSQL)](#step-2-set-up-database-postgresql)
5. [Step 3: Microsoft OAuth Setup](#step-3-microsoft-oauth-setup)
6. [Step 4: Configure Environment Variables](#step-4-configure-environment-variables)
7. [Step 5: Install Dependencies](#step-5-install-dependencies)
8. [Step 6: Start the Server](#step-6-start-the-server)
9. [Step 7: Test the Backend](#step-7-test-the-backend)
10. [Troubleshooting](#troubleshooting)

---

## **What We Built**

Your new backend is a Node.js server that:

```
Frontend (mockup_v3.html)
    ↓
Backend Server (this)
    ├─→ Database (PostgreSQL) - stores events
    ├─→ Splose API - syncs appointments
    ├─→ Outlook API - syncs calendar
    └─→ Teams Meetings - reads availability
```

**What it does:**
- Receives requests from your frontend (create event, update event, etc.)
- Creates/updates/deletes in all three systems simultaneously
- Detects conflicts and resolves them
- Sends real-time updates back to frontend via WebSocket

---

## **Prerequisites**

Before starting, you need:

- **A Mac or Windows computer** (any reasonably modern one)
- **Administrator access** on your computer
- **A Microsoft account** (for Outlook/Teams integration)
- **Splose API credentials** (your existing system)
- **Basic command line comfort** (we'll use Terminal/Command Prompt)

**Total setup time:** ~30-45 minutes

---

## **Step 1: Install Node.js**

Node.js is the "runtime" that lets JavaScript run outside the browser.

### **On Mac:**

```bash
# Download Node.js LTS from https://nodejs.org
# Then open the .dmg file and follow the installer

# Verify installation
node --version    # Should show something like v18.12.0
npm --version     # Should show something like 9.2.0
```

### **On Windows:**

```bash
# Download Node.js LTS from https://nodejs.org
# Run the .msi installer
# Follow the prompts (accept defaults)

# Open Command Prompt and verify
node --version
npm --version
```

**What is `npm`?** 
Node Package Manager - it downloads code libraries (like Express, axios, etc.) from the internet.

---

## **Step 2: Set Up Database (PostgreSQL)**

PostgreSQL is where we'll store event data.

### **On Mac:**

```bash
# Download from https://www.postgresql.org/download/macosx/
# Or use Homebrew (easier):

brew install postgresql@14

# Start PostgreSQL
brew services start postgresql@14

# Create a database for our app
createdb therapy_scheduler

# Verify it works
psql therapy_scheduler
# You should see: therapy_scheduler=#
# Type \q to quit
```

### **On Windows:**

```bash
# Download installer from https://www.postgresql.org/download/windows/
# Run the installer
# When asked for password, use something simple like: postgres
# Remember this password!

# Open Command Prompt and verify
psql --version

# Create database
createdb -U postgres therapy_scheduler
# Enter the password you set during installation

# Verify
psql -U postgres -d therapy_scheduler
# Type \q to quit
```

**Explanation:**
- `createdb` = Create a new database (like a new file folder for data)
- `psql` = Connect to the database (like opening the file folder)
- `therapy_scheduler` = The database name (we made this up)

---

## **Step 3: Microsoft OAuth Setup**

This allows users to login with their Microsoft account and gives your app permission to access their calendar.

### **Create an Azure Application:**

1. Go to **https://portal.azure.com**
2. Sign in with your Microsoft account
3. Search for "App registrations" → Click it
4. Click "New registration"
5. **Register an application:**
   - Name: `Therapy Scheduler Backend`
   - Supported account types: `Accounts in this organizational directory only`
   - Redirect URI: `Web` → `http://localhost:5000/auth/oauth/callback`
   - Click "Register"

6. **Get your Client ID and Secret:**
   - Copy the "Application (client) ID" - this is your `MICROSOFT_CLIENT_ID`
   - Click "Certificates & secrets"
   - Click "New client secret"
   - Copy the secret value - this is your `MICROSOFT_CLIENT_SECRET`
   - ⚠️ **Save these immediately** - you can't see the secret again!

7. **Set API Permissions:**
   - Click "API permissions"
   - Click "Add a permission"
   - Select "Microsoft Graph"
   - Select "Delegated permissions"
   - Search for: `Calendars.ReadWrite`
   - Click it and add
   - Do the same for: `User.Read`

**Explanation:**
- **Client ID** = Username for your app
- **Client Secret** = Password for your app
- **Scopes/Permissions** = What your app is allowed to do (read/write calendar, etc.)

---

## **Step 4: Configure Environment Variables**

Environment variables are settings that change based on your setup (like passwords, API keys).

### **Copy the template:**

```bash
# Navigate to your backend folder
cd ~/Documents/Claude/Projects/Therapy\ Scheduling\ Application/backend

# Copy the template
cp .env.example .env

# Edit the file (use any text editor)
nano .env
# Or open it with Visual Studio Code
```

### **Fill in the values:**

```env
# Server
PORT=5000
NODE_ENV=development

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=therapy_scheduler
DB_USER=postgres
DB_PASSWORD=postgres    # Change if you set a different password

# Microsoft (from Step 3)
MICROSOFT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_SECRET=your_secret_from_azure
MICROSOFT_REDIRECT_URI=http://localhost:5000/auth/oauth/callback

# Splose (ask your Splose account admin for these)
SPLOSE_API_KEY=your_splose_api_key
SPLOSE_BASE_URL=https://api.splose.com

# Session (make this random)
SESSION_SECRET=randomly_generated_secret_12345

# Frontend
FRONTEND_URL=http://localhost:3000
```

**How to find these:**
- `DB_USER` / `DB_PASSWORD`: What you set during PostgreSQL installation
- `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`: From Step 3 (Azure Portal)
- `SPLOSE_API_KEY`: Ask your Splose admin
- `SESSION_SECRET`: Type random characters (e.g., `abc123xyz789`)

---

## **Step 5: Install Dependencies**

Download all the code libraries we need.

```bash
# Make sure you're in the backend folder
cd ~/Documents/Claude/Projects/Therapy\ Scheduling\ Application/backend

# Install all dependencies
npm install

# This will take a minute or two...
# You'll see: "added 500+ packages"
```

**What happened:**
- `npm install` reads `package.json` (the recipe)
- Downloads each library from the npm registry (internet)
- Saves them in a `node_modules` folder

---

## **Step 6: Start the Server**

Time to boot it up!

```bash
# Make sure you're in the backend folder
cd ~/Documents/Claude/Projects/Therapy\ Scheduling\ Application/backend

# Start the server
npm start

# You should see:
# ╔════════════════════════════════════════════════════╗
# ║     THERAPY SCHEDULER BACKEND STARTED              ║
# ╠════════════════════════════════════════════════════╣
# ║  Server running on: http://localhost:5000          ║
# ║  Environment: development                          ║
# ╚════════════════════════════════════════════════════╝
```

**The server is now running!**

Keep this terminal window open. If you close it, the server stops.

---

## **Step 7: Test the Backend**

Verify everything is working.

### **Test 1: Check server is running**

Open your browser and go to:
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

### **Test 2: Start OAuth login**

Open your browser and go to:
```
http://localhost:5000/auth/outlook-login
```

You should see a URL you can click to login with Microsoft.

### **Test 3: Database connection**

Open a new terminal and test the database:

```bash
psql -U postgres -d therapy_scheduler

# You should see: therapy_scheduler=#
# Type this:
\dt
# You should see the tables we created (users, events, sync_log, etc.)
# Type \q to exit
```

---

## **Step 8: Connect Frontend to Backend**

Now update your `mockup_v3.html` to talk to the backend:

```javascript
// Add this to the top of your mockup_v3.html <script> section:

const API_BASE_URL = 'http://localhost:5000';
const socket = io(API_BASE_URL);

// Listen for real-time updates
socket.on('connected', (data) => {
  console.log('Connected to backend:', data);
});

// When creating an event:
async function createEventViaBackend(eventData) {
  const response = await fetch(`${API_BASE_URL}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // Send cookies for authentication
    body: JSON.stringify(eventData)
  });

  return await response.json();
}

// When getting events:
async function getEventsFromBackend() {
  const response = await fetch(`${API_BASE_URL}/api/events`, {
    credentials: 'include'
  });

  const data = await response.json();
  return data.events;
}
```

---

## **Troubleshooting**

### **"Cannot find module 'express'"**
**Problem:** Dependencies not installed
**Solution:**
```bash
npm install
```

### **"Database connection refused"**
**Problem:** PostgreSQL not running
**Solution:**
```bash
# On Mac:
brew services start postgresql@14

# On Windows, use Services app or:
psql -U postgres
```

### **"Unexpected token in JSON"**
**Problem:** `.env` file has syntax errors
**Solution:**
- Make sure each line is `KEY=VALUE` (no spaces around =)
- String values don't need quotes
- Example: `DB_PASSWORD=postgres` (not `DB_PASSWORD="postgres"`)

### **"Client ID is not valid"**
**Problem:** MICROSOFT_CLIENT_ID is wrong
**Solution:**
- Go back to Azure Portal
- Copy the Application ID again carefully
- Make sure no spaces

### **"Port 5000 already in use"**
**Problem:** Another app is using port 5000
**Solution:**
```bash
# Use a different port:
# Edit .env and change PORT=5001
# Or kill the other process (advanced)
```

### **"Timeout waiting for database"**
**Problem:** PostgreSQL database doesn't exist
**Solution:**
```bash
createdb -U postgres therapy_scheduler
```

---

## **Next Steps**

1. ✅ Backend is running locally
2. ⏭️ Connect frontend (mockup_v3.html) to talk to backend
3. ⏭️ Set up webhooks for real-time Outlook sync
4. ⏭️ Deploy to production (Heroku, AWS, or your server)

---

## **Architecture Summary**

```
User opens mockup_v3.html (browser)
        ↓
    [Frontend]
        ↓ (HTTP requests)
    [Backend Server] ← You are here!
        ↓
    ├─ [PostgreSQL Database]
    ├─ [Splose API]
    ├─ [Microsoft Graph API]
    └─ [WebSocket] ← Real-time updates
        ↓
    [User sees changes instantly]
```

---

## **Need Help?**

If something doesn't work:

1. Check the error message in the terminal carefully
2. Google the error (usually works!)
3. Check the Troubleshooting section above
4. Look at the console.log messages in your terminal

---

Congratulations! You now have a professional Node.js backend syncing your therapy scheduler with Outlook and Splose! 🎉
