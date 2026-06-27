# Therapy Scheduler - Complete Project Structure

Welcome! This project contains a therapy scheduling application with Microsoft Outlook integration.

---

## 📂 Folder Organization

### **`backend/`** — Backend Server & Setup
Your Node.js + Express backend for syncing with Outlook and Splose.

- **`setup/`** ← **START HERE** ⭐
  - `SETUP_INDEX.md` — Master guide (read this first!)
  - `STEP_1_NODE_JS.md` through `STEP_7_TEST_BACKEND.md` — Follow in order
  
- **`src/`** — Backend code (after setup)
  - `server.js` — Main Express server
  - `database.js` — PostgreSQL connection & helpers
  - `routes.js` — API endpoints
  - `outlook-oauth.js` — Microsoft integration
  - `splose-api.js` — Splose integration

- **`docs/`** — Backend reference docs
  - `README.md` — API documentation
  - `ARCHITECTURE.md` — System design details
  - `BACKEND_QUICKSTART.md` — Quick reference

- **Config files:**
  - `package.json` — Dependencies list
  - `.env.example` — Template for environment variables

---

### **`frontend/`** — Web Interface
Your therapy scheduler application.

- **`current/`**
  - `mockup_v3.html` — Latest version (use this one)
  
- **`archive/`**
  - Previous versions (for reference)

---

### **`docs/`** — Project Documentation
Project-level guides and reference material.

- **Current status & architecture docs**
- **`archive/`** — Previous features, old implementations (for reference)

---

### **`reference/`** — Helper Code & Utilities
Utility scripts and components from earlier phases.

---

## 🚀 Getting Started

### **Step 1: Set Up Backend** (Takes 60-90 minutes)
1. Open: `backend/setup/SETUP_INDEX.md`
2. Follow the 7 steps in order
3. Each step has Mac/Windows instructions

### **Step 2: Test Everything** 
1. Go to: `backend/setup/STEP_7_TEST_BACKEND.md`
2. Run the 7 verification tests
3. All should pass ✅

### **Step 3: Keep Server Running**
```bash
cd backend
npm start
# Keep this terminal open while working on the app
```

### **Step 4: Use the Frontend**
- Open `frontend/current/mockup_v3.html` in your browser
- Connect to your running backend

---

## 📋 Quick Reference

| What I Need | Where to Find It |
|------------|------------------|
| Setup instructions | `backend/setup/SETUP_INDEX.md` ⭐ |
| Backend documentation | `backend/docs/README.md` |
| Frontend mockup | `frontend/current/mockup_v3.html` |
| API reference | `backend/docs/README.md` |
| System architecture | `backend/docs/ARCHITECTURE.md` |
| Old versions | `frontend/archive/` or `docs/archive/` |

---

## ✅ Before You Start

Make sure you have:
- [ ] A Microsoft account (for Azure OAuth)
- [ ] PostgreSQL installed (or ready to install)
- [ ] A terminal/command prompt open
- [ ] 60-90 minutes for the complete setup

---

## 🎯 Your Goal

By the end of the setup, you'll have:

✅ A Node.js backend server running on `http://localhost:5000`
✅ PostgreSQL database connected
✅ Microsoft OAuth configured
✅ Real-time WebSocket ready
✅ Frontend connected to backend
✅ Outlook ↔ Splose ↔ App sync working

---

## 📖 How to Use This Structure

- **Starting fresh?** → Read `backend/setup/SETUP_INDEX.md`
- **Need API docs?** → Check `backend/docs/README.md`
- **Understanding the system?** → See `backend/docs/ARCHITECTURE.md`
- **Looking for old code?** → Browse `reference/` or `docs/archive/`
- **Using the app?** → Open `frontend/current/mockup_v3.html`

---

## 🔗 Navigation

From any guide, you can jump to:
- **Backend Setup:** `backend/setup/SETUP_INDEX.md`
- **Backend Code:** `backend/src/` (after installation)
- **Frontend:** `frontend/current/mockup_v3.html`

---

**Good luck! You've got this! 💪**

Start with: [`backend/setup/SETUP_INDEX.md`](backend/setup/SETUP_INDEX.md)
