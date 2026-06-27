# Step 2: Set Up PostgreSQL Database - Beginner's Guide

## **What is PostgreSQL?**

Think of it like this:

```
Regular file on your computer:
└─ A Word document (one document)

Database (PostgreSQL):
└─ A powerful filing system
   ├─ Table 1: Users (columns: ID, email, name)
   ├─ Table 2: Events (columns: title, date, time)
   └─ Table 3: SyncLog (columns: action, status)
```

**PostgreSQL** = A filing system that stores data in organized tables
We need it to save all your therapy events

---

## **Check If You Already Have It**

**On Mac or Windows:**

1. Open Terminal (Mac) or Command Prompt (Windows)
2. Type:
```bash
psql --version
```

3. Press Enter

**What you might see:**
- ✅ `psql (PostgreSQL) 14.5` or similar → **You have it!** Skip to "Create Database"
- ❌ `command not found` → **Install it below**

---

## **Installation**

### **On Mac - Using Homebrew (Easiest)**

```bash
# Install PostgreSQL
brew install postgresql@14

# Start PostgreSQL (this runs it in the background)
brew services start postgresql@14

# Verify it's running
psql --version
# Should show: psql (PostgreSQL) 14.x
```

**If you don't have Homebrew:**
1. Go to https://brew.sh
2. Copy the install command and paste it in Terminal
3. Follow the steps
4. Then run the commands above

### **On Mac - Using Installer**

1. Go to https://www.postgresql.org/download/macosx/
2. Click "Interactive installer"
3. Download the latest version
4. Double-click the installer
5. Follow the steps (remember the password you set!)
6. Click "Finish" when done

**Start PostgreSQL:**
```bash
brew services start postgresql@14
```

### **On Windows**

1. Go to https://www.postgresql.org/download/windows/
2. Click "Download the installer"
3. Double-click the downloaded file
4. Follow the installer
5. When it asks for a password:
   - **IMPORTANT:** Remember this password (e.g., "postgres")
   - You'll need it later
6. Keep clicking "Next" to accept defaults
7. Click "Finish"

**Verify it's installed:**
```cmd
psql --version
# Should show: psql (PostgreSQL) 14.x
```

---

## **Create Your Database**

This is where we'll store all the events for your therapy scheduler.

**On Mac:**

```bash
# Create a database called "therapy_scheduler"
createdb -U postgres therapy_scheduler

# Verify it was created
psql -U postgres -d therapy_scheduler

# You should see this prompt:
# therapy_scheduler=#

# Type this to see tables (they'll be empty for now):
\dt

# Type this to exit:
\q
```

**On Windows:**

```cmd
# Create database (it will ask for password)
createdb -U postgres therapy_scheduler
# Enter password: (type the password from installation, won't show on screen)

# Verify it was created
psql -U postgres -d therapy_scheduler
# Enter password again

# You should see:
# therapy_scheduler=#

# Type this to see tables:
\dt

# Type this to exit:
\q
```

---

## **Understanding What We Just Did**

```
PostgreSQL server (running on your computer)
└─ Database called "therapy_scheduler"
   └─ Will contain tables like:
      ├─ users (stores user info)
      ├─ events (stores appointments)
      ├─ sync_log (records what synced)
      └─ conflicts (records conflicts)
```

**In simple terms:**
- **PostgreSQL** = The filing system software
- **Database** = A folder inside that filing system
- **Tables** = Organized spreadsheets inside the folder
- **Rows** = Individual records (like one event)

---

## **Database Connection Details (Save These!)**

We'll need these later:

```
Host:     localhost  (your computer)
Port:     5432       (PostgreSQL's door number)
Database: therapy_scheduler
User:     postgres
Password: (what you set during installation)
```

---

## **Verify It's Working**

**On Mac or Windows:**

```bash
# Connect to the database
psql -U postgres -d therapy_scheduler

# You should see the prompt. Type:
SELECT NOW();

# Should show current date and time, like:
#              now
# 2024-01-15 14:23:45.123456+00

# Type \q to exit
\q
```

If you see the date/time, **PostgreSQL is working!** ✅

---

## **Start PostgreSQL on Boot (Optional)**

So you don't have to start it manually each time:

**On Mac:**
```bash
brew services start postgresql@14
```

**On Windows:**
PostgreSQL should start automatically. Check:
1. Open Services (search for "Services")
2. Look for "postgresql-x64-14"
3. It should say "Running"

---

## **Common Issues**

### **"psql: command not found"**

**Problem:** PostgreSQL didn't install

**Solution (Mac):**
```bash
# Try installing again
brew install postgresql@14

# Or download from https://www.postgresql.org/download/macosx/
```

**Solution (Windows):**
- Uninstall PostgreSQL
- Restart computer
- Download and install again from https://www.postgresql.org/download/windows/

### **"Password authentication failed"**

**Problem:** Wrong password

**Solution:**
- Use the password you set during installation
- On Windows, default is often just pressing Enter (no password)
- If you forget, uninstall and reinstall PostgreSQL

### **"Database already exists"**

**Problem:** You already created it

**Solution:**
Just continue. It's fine to reuse the database.

### **"database does not exist"**

**Problem:** Database wasn't created

**Solution:**
```bash
# Create it again
createdb -U postgres therapy_scheduler

# Verify
psql -U postgres -d therapy_scheduler
```

---

## **Useful Commands (For Later)**

```bash
# List all databases
psql -U postgres -l

# Connect to database
psql -U postgres -d therapy_scheduler

# Inside psql prompt:
\dt                 # Show all tables
\d tablename        # Show table structure
SELECT * FROM events;  # Show all events (when we have them)
\q                  # Exit psql
```

---

## **You're Done! ✅**

PostgreSQL is installed and running.

**What you have:**
✅ PostgreSQL server running
✅ A database called "therapy_scheduler"
✅ Database connection details saved

**Next Step:** Go to STEP_3_AZURE_OAUTH.md

