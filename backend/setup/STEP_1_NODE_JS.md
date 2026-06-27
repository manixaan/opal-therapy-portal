# Step 1: Install Node.js - Beginner's Guide

## **What is Node.js?**

Think of it this way:

```
JavaScript normally runs in your browser (inside Chrome, Firefox, Safari)
Node.js lets JavaScript run on your computer like a regular program
It's the engine that powers your backend server
```

Without Node.js: You can't run the server
With Node.js: Your computer becomes a server

---

## **Check If You Already Have It**

**On Mac or Windows:**

1. Open Terminal (Mac) or Command Prompt (Windows)
   - **Mac**: Press `Cmd + Space`, type "terminal", press Enter
   - **Windows**: Press `Windows key`, type "cmd", press Enter

2. Type this command:
```bash
node --version
```

3. Press Enter

**What you might see:**
- ✅ `v18.12.0` or similar → **You already have Node.js!** Skip to Step 2
- ❌ `command not found` → **You need to install it** → Follow below

---

## **Installation (If You Don't Have It)**

### **On Mac - Method 1 (Easiest)**

1. Go to **https://nodejs.org**
2. Click the big green button that says **"LTS"**
   - (LTS = Long Term Support = stable version)
3. A `.dmg` file will download
4. Open the Downloads folder and double-click the file
5. Follow the installer (just click "Continue" and "Install")
6. When done, you'll see "Installation Successful"

**Verify it worked:**
```bash
# Open Terminal again
node --version
# Should show: v18.12.0 (or newer)

npm --version
# Should show: 9.2.0 (or newer)
```

### **On Mac - Method 2 (Using Homebrew)**

If you have Homebrew installed:

```bash
# Install Node.js
brew install node

# Verify
node --version
npm --version
```

### **On Windows**

1. Go to **https://nodejs.org**
2. Click the big green button **"LTS"**
3. A `.msi` file will download
4. Open Downloads folder and double-click the file
5. Click "Next" on each screen (accept all defaults)
6. Click "Install"
7. Click "Finish" when done

**Verify it worked:**

1. Open Command Prompt
   - Press `Windows key`, type "cmd", press Enter
2. Type:
```cmd
node --version
npm --version
```

Both should show version numbers (like `v18.12.0` and `9.2.0`)

---

## **Understanding What You Installed**

When you installed Node.js, you actually got **two things**:

### **1. Node.js (the engine)**
- Lets you run JavaScript on your computer
- Like how your browser runs JavaScript

### **2. npm (Node Package Manager)**
- A tool to download code libraries
- Like an "app store" for programming code
- We'll use it to download packages like "Express" (web server framework)

---

## **Verify Everything is Ready**

**On Mac:**
```bash
# Open Terminal
which node
# Should show: /usr/local/bin/node or similar

which npm
# Should show: /usr/local/bin/npm or similar
```

**On Windows:**
```cmd
# Open Command Prompt
where node
where npm
```

If both commands return a path, you're good to go!

---

## **What This Enables**

Now you can:
✅ Run JavaScript on your computer (not just in browser)
✅ Start a web server
✅ Download code libraries with npm
✅ Run the backend server for your therapy scheduler

---

## **Troubleshooting**

### **"command not found" or "is not recognized"**

**Problem:** Node.js didn't install properly

**Solution:**
1. Uninstall Node.js completely
   - **Mac**: Open `/Applications/Finder` → Applications → Find Node.js → Drag to Trash
   - **Windows**: Settings → Apps → Find "Node.js" → Uninstall
2. Restart your computer
3. Download and install again from https://nodejs.org
4. Test again with `node --version`

### **"Version is old"**

**Problem:** You have Node.js but it's an old version

**Solution:**
1. Go to https://nodejs.org
2. Download the latest LTS version
3. Install it (it will replace the old one)

---

## **You're Done! ✅**

You now have Node.js installed. 

**Next Step:** Go to STEP_2_POSTGRESQL.md

---

## **Quick Reference**

| What | Command |
|------|---------|
| Check Node version | `node --version` |
| Check npm version | `npm --version` |
| Run JavaScript file | `node filename.js` |
| Download a package | `npm install package-name` |

