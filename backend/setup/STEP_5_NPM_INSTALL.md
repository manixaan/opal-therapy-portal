# Step 5: Run npm install - Beginner's Guide

## **What is npm install?**

Remember when we installed Node.js, we also got `npm` (Node Package Manager)?

`npm install` downloads all the code libraries your server needs.

Think of it like this:

```
Backend needs:
- Express (web server framework)
- Axios (tool to make HTTP requests)
- Socket.io (real-time communication)
- PostgreSQL connector
- Microsoft Graph client
- And 30+ more...

Instead of downloading each one manually (tedious!),
we have a list called package.json that says:
"Download all of these for me"

npm install reads package.json and downloads EVERYTHING
```

---

## **What is package.json?**

A file that lists all the libraries (packages) your project needs.

**It's like a grocery list:**
```
✓ Express (web framework)
✓ Axios (HTTP client)
✓ Socket.io (WebSocket)
✓ PostgreSQL driver
✓ Microsoft Graph client
✓ And more...
```

When you run `npm install`, it downloads all of these automatically.

---

## **Step 1: Make Sure You're in the Right Folder**

Open Terminal (Mac) or Command Prompt (Windows):

**On Mac:**
```bash
cd ~/Documents/Claude/Projects/Therapy\ Scheduling\ Application/backend

# Verify
pwd
# Should show: /Users/antonyxavier/Documents/Claude/Projects/Therapy Scheduling Application/backend
```

**On Windows:**
```cmd
cd C:\Users\antonyxavier\Documents\Claude\Projects\Therapy Scheduling Application\backend

# Verify you're in the right place
cd
```

---

## **Step 2: Run npm install**

**On Mac or Windows:**

```bash
npm install
```

Press Enter.

---

## **What Happens Next**

You'll see something like:

```
npm notice created a lockfile as package-lock.json
npm notice 
npm warn optional SKIPPING OPTIONAL DEPENDENCY: fsevents@2.3.2 (node_modules/fsevents):
npm warn optional SKIPPING OPTIONAL DEPENDENCY: fsevents@2.3.2 (node_modules/fsevents):
added 150 packages, and audited 151 packages in 45s

found 0 vulnerabilities
```

**This is normal!** It means:
- ✅ Downloaded 150+ packages
- ✅ Scanned for security issues (none found)
- ✅ Everything is ready to use

**This takes 1-3 minutes** depending on your internet speed.

---

## **What Was Downloaded?**

A folder called `node_modules` was created containing:

```
node_modules/
├─ express/               (web server framework)
├─ axios/                 (HTTP requests)
├─ socket.io/             (real-time updates)
├─ pg/                    (PostgreSQL connector)
├─ @microsoft/microsoft-graph-client/  (Microsoft API)
├─ passport/              (authentication)
├─ cors/                  (cross-origin requests)
├─ dotenv/                (read .env file)
└─ ... and 140+ more folders
```

**Don't edit these!** They're all the code needed to run your server.

---

## **Verify Installation Succeeded**

Check that the installation worked:

**On Mac:**
```bash
# List the folders to see node_modules
ls -la

# You should see "node_modules" in the list
```

**On Windows:**
```cmd
# List the folders
dir

# You should see "node_modules" listed
```

Also check that the file `node_modules` is a folder (not broken):

```bash
# On Mac or Windows:
ls node_modules | head -5

# Should show:
# @microsoft
# @protobufjs
# accepts
# addressparser
# .... and more
```

---

## **Understanding the Process**

```
Step 1: You run "npm install"
        ↓
Step 2: npm reads package.json
        ├─ See: "need express version 4.18"
        ├─ See: "need axios version 1.6"
        └─ See: "need 30+ other packages"
        ↓
Step 3: npm downloads each package
        ├─ express version 4.18
        ├─ axios version 1.6
        ├─ socket.io version 4.6
        ├─ pg version 8.10
        ├─ ... and 140+ more
        ↓
Step 4: npm checks for security issues
        └─ "No vulnerabilities found" ✅
        ↓
Step 5: Creates node_modules folder
        └─ Contains all 150+ packages
```

---

## **Important Files Created**

After running `npm install`, you now have:

```
backend/
├─ node_modules/          (all the packages - 150+ folders)
├─ package.json           (the recipe - what packages we need)
├─ package-lock.json      (the detailed list - exact versions)
├─ .env                   (your secrets - configuration)
├─ server.js              (main server file)
├─ database.js            (database helper)
├─ routes.js              (API endpoints)
├─ outlook-oauth.js       (Microsoft integration)
├─ splose-api.js          (Splose integration)
└─ ... other files
```

---

## **What npm install Does Behind the Scenes**

Each package we downloaded has its own dependencies (packages it depends on):

```
For example:
- Express depends on: "body-parser", "cors", "debug", etc.
- Socket.io depends on: "engine.io", "socket.io-adapter", etc.

npm doesn't just get Express, it also gets all of Express's dependencies
And all of those dependencies' dependencies
Until it has everything needed!
```

This is why there are 150+ packages total (even though we listed much fewer in package.json).

---

## **Troubleshooting**

### **"npm: command not found"**

**Problem:** Node.js/npm not installed

**Solution:**
Go back to STEP_1_NODE_JS.md and install Node.js properly

### **"npm ERR! code ERESOLVE"**

**Problem:** Conflicting package versions (rare)

**Solution:**
```bash
# Force install anyway
npm install --legacy-peer-deps
```

### **"npm ERR! network"**

**Problem:** Internet connection issue

**Solution:**
1. Check your internet connection
2. Wait a minute
3. Try again: `npm install`

### **"permission denied"**

**Problem:** Permission issue on Mac

**Solution:**
```bash
# Try with sudo (if you trust it)
sudo npm install

# Or change permissions:
sudo chown -R $(whoami) /usr/local/lib/node_modules
npm install
```

### **"node_modules folder huge!"**

**Normal!** The folder will be 300MB+ - that's expected.

---

## **After Installation**

You now have everything needed to run the server:

✅ express - to handle web requests
✅ axios - to make API calls
✅ socket.io - for real-time updates
✅ pg - to connect to PostgreSQL
✅ @microsoft/microsoft-graph-client - to access Outlook
✅ And 140+ more packages

---

## **Important Notes**

⚠️ **DON'T:**
- Edit anything in `node_modules` folder
- Delete `node_modules` (unless you want to reinstall)
- Share `node_modules` folder (too big!)

✅ **DO:**
- Keep `package.json` and `package-lock.json` (they tell npm what to download)
- Run `npm install` if you update `package.json`
- Delete `node_modules` and rerun `npm install` if things break

---

## **Storage Space**

The `node_modules` folder takes up **300-500 MB** of space.

That's normal. Don't worry about it.

---

## **You're Done! ✅**

You now have:
✅ npm installed (with Node.js)
✅ .env configured
✅ All 150+ packages downloaded
✅ Everything needed to run the server

**Next Step:** Go to STEP_6_START_SERVER.md

---

## **Quick Reference**

| Command | What It Does |
|---------|--------------|
| `npm install` | Download all packages from package.json |
| `npm install package-name` | Download a single new package |
| `npm update` | Update all packages to newer versions |
| `npm list` | Show all installed packages |

