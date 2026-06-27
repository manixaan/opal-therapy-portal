# Step 3: Create Azure App for OAuth - Beginner's Guide

## **What is OAuth?**

Think of it like this:

```
WITHOUT OAuth:
"Hi, I'm a new app. Can you give me your Outlook calendar?"
User: "Sure, here's my password: mypassword123"
❌ DANGEROUS! The app has your password!

WITH OAuth:
"Hi Microsoft, can you ask the user if I can access their calendar?"
Microsoft asks user: "Do you trust this app with your calendar?"
User clicks: "Yes"
Microsoft gives app a token (special pass)
✅ SAFE! User's password never shared!
```

OAuth is the **secure way** to access someone's calendar without knowing their password.

---

## **What We're Creating**

We're creating an "Application Registration" in Azure (Microsoft's cloud service).

This tells Microsoft:
- ✅ "There's an app called 'Therapy Scheduler Backend'"
- ✅ "This app wants to access users' calendars"
- ✅ "Here's the app's ID and secret"
- ✅ "This app is trustworthy"

---

## **Step-by-Step: Create Azure App**

### **Step 1: Go to Azure Portal**

1. Open your browser
2. Go to **https://portal.azure.com**
3. Sign in with your **Microsoft account** (same one with Outlook)
   - If you don't have one, create one first at https://account.microsoft.com

**You should see a dashboard with lots of options**

### **Step 2: Register an Application**

1. In the search bar at the top, type: **"App registrations"**
2. Click on "App registrations" (it will appear in results)
3. Click the blue **"+ New registration"** button

**A form will appear**

### **Step 3: Fill in Registration Details**

Fill in exactly these values:

```
Name:                          Therapy Scheduler Backend
Supported account types:       Accounts in this organizational directory only
Redirect URI:                  Select "Web"
Redirect URI value:            http://localhost:5000/auth/oauth/callback
```

**Explanation:**
- **Name:** What you're calling the app (can be anything)
- **Account types:** "Accounts in organizational directory" = Just your account can use it
- **Redirect URI:** Where Microsoft sends the user AFTER they approve
  - `localhost:5000` = Your computer's server
  - `/auth/oauth/callback` = The exact page that handles the response

### **Step 4: Click "Register"**

Click the blue "Register" button.

**You'll see a success page!**

---

## **Step 5: Save Your Client ID & Secret**

**On the page you just landed:**

You'll see "Application (client) ID" - **COPY THIS!**

It looks like: `a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6`

**Save it somewhere safe.** We'll call it: `MICROSOFT_CLIENT_ID`

### **Get the Client Secret:**

1. On the left sidebar, click **"Certificates & secrets"**
2. Click the tab **"Client secrets"**
3. Click **"+ New client secret"**
4. A dialog appears. Just click **"Add"** (defaults are fine)

**Important: Copy the VALUE column!** (Not the ID)

It looks like: `abc_xyz123ABC~xyz_abc123-ABC-xyz`

⚠️ **Important:** You can only see this once! Copy it now!

**Save this as:** `MICROSOFT_CLIENT_SECRET`

---

## **Step 6: Add API Permissions**

This tells Microsoft what your app is allowed to do.

1. On the left sidebar, click **"API permissions"**
2. Click the blue **"+ Add a permission"** button
3. Click **"Microsoft Graph"**
4. Click **"Delegated permissions"**

**Now you see a list of permissions:**

Search for (one at a time):

1. **"Calendars.ReadWrite"**
   - Check the box
   - Click "Add permissions"

2. **"User.Read"**
   - Check the box
   - Click "Add permissions"

**You should see two permissions now:**
```
✓ Calendars.ReadWrite
✓ User.Read
```

---

## **Step 7: Verify Your Credentials**

You should now have:

```
MICROSOFT_CLIENT_ID = a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6
MICROSOFT_CLIENT_SECRET = abc_xyz123ABC~xyz_abc123-ABC-xyz
MICROSOFT_REDIRECT_URI = http://localhost:5000/auth/oauth/callback
```

**Write these down or copy to a safe place!**

You'll need them in the next step.

---

## **Understanding What You Just Did**

```
Microsoft Azure Portal
└─ Your Application Registration: "Therapy Scheduler Backend"
   ├─ Client ID: a1b2c3d4... (username for your app)
   ├─ Client Secret: abc_xyz... (password for your app)
   ├─ Redirect URI: http://localhost:5000/auth/oauth/callback
   └─ Permissions: 
      ├─ Calendars.ReadWrite (can read/write calendar)
      └─ User.Read (can read user info)
```

---

## **How OAuth Flow Works (For Understanding)**

```
1. User clicks "Login with Microsoft" button in your app
   ↓
2. Your app says: "Microsoft, here's my Client ID and Secret"
   ↓
3. Microsoft redirects to: http://localhost:5000/auth/oauth/callback
   ↓
4. Your backend exchanges Client ID + Secret for an ACCESS TOKEN
   ↓
5. ACCESS TOKEN lets your app access user's calendar
   ↓
6. User is logged in! User's password was never shared!
```

---

## **Test Your Registration**

You don't need to test right now, but here's how you would:

```
In your browser address bar:
https://login.microsoft.com/common/oauth2/v2.0/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:5000/auth/oauth/callback&response_type=code&scope=Calendars.ReadWrite%20User.Read

Replace YOUR_CLIENT_ID with your actual Client ID

This shows the "Microsoft Login" page
```

---

## **Common Issues**

### **"I can't find App registrations"**

**Solution:**
1. Make sure you're signed into https://portal.azure.com
2. Look for the search bar at the very top (magnifying glass)
3. Type "App registrations"
4. Click on it

### **"I can't see the Client Secret"**

**Problem:** You already navigated away

**Solution:**
You can only see the secret once. If you missed it:
1. Go back to "Certificates & secrets"
2. Delete the old secret (click the three dots → Delete)
3. Create a new one
4. Copy it immediately

### **"Redirect URI shows an error"**

**Problem:** Wrong format

**Make sure:**
- It starts with `http://` (not `https://` for localhost)
- It's exactly: `http://localhost:5000/auth/oauth/callback`
- No extra spaces

### **"I don't have a Microsoft account"**

**Solution:**
1. Go to https://account.microsoft.com
2. Click "Create one!"
3. Follow the steps to create an account
4. Use that account to sign into Azure

---

## **You're Done! ✅**

You now have:

✅ Azure app registered
✅ Client ID saved
✅ Client Secret saved
✅ Permissions configured
✅ Redirect URI set up

**Save these three values:**
```
MICROSOFT_CLIENT_ID = your_client_id
MICROSOFT_CLIENT_SECRET = your_client_secret
MICROSOFT_REDIRECT_URI = http://localhost:5000/auth/oauth/callback
```

**Next Step:** Go to STEP_4_ENV_SETUP.md

