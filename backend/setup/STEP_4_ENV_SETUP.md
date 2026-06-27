# Step 4: Configure Environment Variables - Beginner's Guide

## **What are Environment Variables?**

Think of them like this:

```
Your server needs to know:
- How to connect to the database
- How to talk to Microsoft
- Secrets/passwords
- Configuration settings

We could hardcode these in the code:
const password = "secret123"  ❌ DANGEROUS! Visible in code!

Instead, we use environment variables:
const password = process.env.DB_PASSWORD  ✅ SAFE! Stored separately!
```

Environment variables are settings stored in a `.env` file (secret file).

---

## **What is the .env File?**

A special file that stores secrets and configuration.

**It looks like:**
```
PORT=5000
DB_PASSWORD=postgres
MICROSOFT_CLIENT_ID=a1b2c3d4...
MICROSOFT_CLIENT_SECRET=abc123...
```

**Important:** `.env` files are NEVER shared or committed to version control (because they contain secrets!)

---

## **Step 1: Navigate to Backend Folder**

Open Terminal (Mac) or Command Prompt (Windows):

**On Mac:**
```bash
# Navigate to your backend folder
cd ~/Documents/Claude/Projects/Therapy\ Scheduling\ Application/backend

# Verify you're in the right folder
pwd
# Should show: /Users/antonyxavier/Documents/Claude/Projects/Therapy Scheduling Application/backend
```

**On Windows:**
```cmd
# Navigate to backend folder
cd C:\Users\antonyxavier\Documents\Claude\Projects\Therapy Scheduling Application\backend

# Verify
cd
# Should show the same path
```

---

## **Step 2: Copy the Template**

The folder already has `.env.example` (a template).

We'll copy it to `.env` and fill it in.

**On Mac:**
```bash
cp .env.example .env

# Verify it was created
ls -la | grep .env
```

**On Windows:**
```cmd
copy .env.example .env

# Verify
dir | findstr .env
```

---

## **Step 3: Open and Edit .env File**

**On Mac:**

```bash
# Open it with nano (built-in text editor)
nano .env

# Or open with your favorite editor:
code .env  # If you have VS Code
```

**On Windows:**

```cmd
# Open with Notepad
notepad .env

# Or with VS Code
code .env
```

**A text editor will open showing the .env file**

---

## **Step 4: Fill in the Values**

You'll see a file with many lines. Edit it to look like this:

```env
# ===== Server Config =====
PORT=5000
NODE_ENV=development

# ===== Database (PostgreSQL) =====
DB_HOST=localhost
DB_PORT=5432
DB_NAME=therapy_scheduler
DB_USER=postgres
DB_PASSWORD=postgres

# ===== Microsoft OAuth =====
MICROSOFT_CLIENT_ID=your_client_id_from_step_3
MICROSOFT_CLIENT_SECRET=your_client_secret_from_step_3
MICROSOFT_REDIRECT_URI=http://localhost:5000/auth/oauth/callback

# ===== Splose API =====
SPLOSE_API_KEY=ask_your_splose_admin
SPLOSE_BASE_URL=https://api.splose.com

# ===== Session Secret =====
SESSION_SECRET=development-secret-12345-change-later

# ===== Frontend URL =====
FRONTEND_URL=http://localhost:3000
```

### **What Each Value Means:**

| Variable | What It Is | Where From |
|----------|-----------|-----------|
| `PORT` | Server's port | Leave as 5000 |
| `NODE_ENV` | Development or production | Leave as development |
| `DB_HOST` | Database location | localhost (your computer) |
| `DB_PORT` | Database port | 5432 (PostgreSQL default) |
| `DB_NAME` | Database name | therapy_scheduler (from Step 2) |
| `DB_USER` | Database user | postgres (PostgreSQL default) |
| `DB_PASSWORD` | Database password | What you set in Step 2 |
| `MICROSOFT_CLIENT_ID` | Your Microsoft app ID | From Step 3 |
| `MICROSOFT_CLIENT_SECRET` | Your Microsoft secret | From Step 3 |
| `MICROSOFT_REDIRECT_URI` | OAuth redirect URL | Keep as-is |
| `SPLOSE_API_KEY` | Your Splose API key | Ask your Splose admin |
| `SPLOSE_BASE_URL` | Splose endpoint | Keep as-is |
| `SESSION_SECRET` | Random secret | Any random string |
| `FRONTEND_URL` | Your app's URL | Leave as localhost:3000 |

### **Step-by-Step Filling In:**

#### **1. Database Password (DB_PASSWORD)**

Change this line:
```env
# FROM:
DB_PASSWORD=your_password_here

# TO:
DB_PASSWORD=postgres
```

Unless you set a different password during PostgreSQL installation.

#### **2. Microsoft Client ID**

Change this:
```env
# FROM:
MICROSOFT_CLIENT_ID=your_client_id_here

# TO:
MICROSOFT_CLIENT_ID=a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6
```

Replace with the actual Client ID from Step 3.

#### **3. Microsoft Client Secret**

Change this:
```env
# FROM:
MICROSOFT_CLIENT_SECRET=your_client_secret_here

# TO:
MICROSOFT_CLIENT_SECRET=abc_xyz123ABC~xyz_abc123-ABC-xyz
```

Replace with the actual Client Secret from Step 3.

#### **4. Splose API Key**

For now, just leave it as-is:
```env
SPLOSE_API_KEY=ask_your_splose_admin
```

You can update this later when your Splose admin gives you the key.

#### **5. Session Secret**

Change this to any random string:
```env
# FROM:
SESSION_SECRET=your_random_secret_here_change_in_production

# TO:
SESSION_SECRET=thisismyrandomsecret12345
```

Can be anything. Just make it random.

---

## **Step 5: Save the File**

**If using nano (Mac):**
```
Press: Ctrl + X
Press: Y (for yes)
Press: Enter (to save)
```

**If using notepad (Windows):**
- Press `Ctrl + S` or click File → Save

**If using VS Code:**
- Press `Ctrl + S` (or `Cmd + S` on Mac)

---

## **Step 6: Verify It Was Saved**

**On Mac:**
```bash
# View the file to confirm
cat .env

# Should show all your values
```

**On Windows:**
```cmd
# View the file
type .env

# Should show all your values
```

---

## **Complete Checklist**

Your `.env` file should have these values filled in:

- [ ] PORT = 5000
- [ ] NODE_ENV = development
- [ ] DB_HOST = localhost
- [ ] DB_PORT = 5432
- [ ] DB_NAME = therapy_scheduler
- [ ] DB_USER = postgres
- [ ] DB_PASSWORD = postgres (or your PostgreSQL password)
- [ ] MICROSOFT_CLIENT_ID = your actual client ID
- [ ] MICROSOFT_CLIENT_SECRET = your actual secret
- [ ] MICROSOFT_REDIRECT_URI = http://localhost:5000/auth/oauth/callback
- [ ] SPLOSE_API_KEY = ask_your_splose_admin (for now)
- [ ] SPLOSE_BASE_URL = https://api.splose.com
- [ ] SESSION_SECRET = some random string
- [ ] FRONTEND_URL = http://localhost:3000

---

## **Understanding What This Does**

When the server starts, it will:

1. Read the `.env` file
2. Load all these variables into `process.env`
3. Use them throughout the application:
   ```javascript
   const dbPassword = process.env.DB_PASSWORD  // Gets "postgres"
   const clientId = process.env.MICROSOFT_CLIENT_ID  // Gets your ID
   ```

This way:
✅ Secrets are NOT in the code
✅ Easy to change settings
✅ Safe to share code with others

---

## **Important Security Notes**

⚠️ **NEVER:**
- Share your `.env` file with anyone
- Commit `.env` to version control (git)
- Post your Client Secret online

✅ **DO:**
- Keep `.env` file secret
- Update it only with real values
- Use different secrets for production

---

## **Troubleshooting**

### **"File not found: .env"**

**Problem:** The file wasn't created

**Solution:**
```bash
# Create it manually
touch .env  # Mac
REM Windows: Just create an empty file named .env in the folder
```

### **"I see garbage characters in nano"**

**Problem:** Nano has weird display

**Solution:**
```bash
# Exit nano: Ctrl + X
# Then use a different editor:
code .env  # VS Code
# Or just use Notepad (Windows)
```

### **"Can't find PostgreSQL password"**

**Problem:** You forgot what you set

**Solution:**
- Reinstall PostgreSQL and set it to "postgres"
- Or if you remember the password, use that

### **"Where do I get Splose API key?"**

**Problem:** You don't have it yet

**Solution:**
- Contact your Splose administrator
- Ask for: "Splose API key for integration"
- For now, leave it as-is in the .env file

---

## **You're Done! ✅**

Your `.env` file is configured with:
✅ Database credentials
✅ Microsoft OAuth secrets
✅ Server settings
✅ API configuration

**Next Step:** Go to STEP_5_NPM_INSTALL.md

