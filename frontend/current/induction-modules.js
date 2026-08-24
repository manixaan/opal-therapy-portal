/* ═══════════════════════════════════════════════════════════════════════════
   OPAL PORTAL INDUCTION — MODULE DEFINITIONS (pure data, no DOM)

   The single source of truth for the interactive induction: module keys,
   versions, role gates, and every step. Consumed in two places:

     • the browser — loaded before induction.js, published as
       window.OpalInductionModules;
     • the backend — backend/tutorial-routes.js require()s this file directly
       to validate module keys, versions, step counts and role access, so the
       client and server can never disagree about the catalogue.

   Because of that second consumer this file must stay pure data + pure
   functions: no document, no window API calls, no fetch.

   ── Module shape ──────────────────────────────────────────────────────────
   {
     key:          'portal-using-calendar'   // ALSO the Resource Hub slug of
                                             // the matching tutorial resource
     version:      1,                        // bump on MATERIAL step changes;
                                             // completions record the version
     title:        'Using the Calendar',
     minutes:      6,                        // honest estimated duration
     roles:        ['owner','admin','therapist','read_only'],
     description:  'One sentence for cards and the dashboard.',
     thumb:        '/assets/tutorials/portal-using-calendar.png', // card image
     start:        { tab: 'calendar' },      // where the walkthrough begins
     steps:        [ ... ]
   }

   ── Step shape ────────────────────────────────────────────────────────────
   {
     type:    'intro' | 'highlight' | 'action' | 'screenshot' | 'callout'
              | 'warning' | 'quiz' | 'complete',
     title:   'Short heading',
     body:    'Plain text. **bold** and blank-line paragraphs only — the
               engine escapes everything first, exactly like the hub.',
     target:  'cal-view-tabs',      // data-help name, #id, or CSS selector
                                    // (highlight/action steps only)
     route:   { tab: 'calendar' },  // navigate here before resolving target
     menu:    true,                 // target lives inside the "More" menu —
                                    // the engine opens it first
     pad:     6, rounded: '8px',    // spotlight geometry (as HELP_TOURS)
     image:   { src: '/assets/tutorials/x.png', alt: '…' },
                                    // screenshot steps; ALSO the graceful
                                    // fallback when a live target is missing
     advance: 'click',              // action steps: clicking the highlighted
                                    // element moves to the next step
     roles:   ['owner'],            // omit = every role the module allows
     quiz:    { question, options: [..], correctIndex, explain },
     next:    'portal-master-scheduler'  // complete steps: suggested module
   }

   Versioning rule: fixing wording is not a new version. Add/remove/reorder
   steps, or change what a step asks the user to DO → bump `version` and the
   dashboard shows "Updated" on old completions (they stay valid).

   Safety rule: no step may click through a destructive or externally
   visible action (create/delete real events, send invitations, disconnect
   Outlook). Those are explain-only or stop before the final confirmation.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  var ALL_ROLES = ['owner', 'admin', 'therapist', 'read_only'];
  var WRITER_ROLES = ['owner', 'admin', 'therapist'];

  var MODULES = [

    // ── 1. Getting Started ──────────────────────────────────────────────────
    {
      key: 'portal-getting-started',
      version: 1,
      title: 'Getting Started with the Opal Portal',
      minutes: 5,
      roles: ALL_ROLES,
      description: 'First sign-in, the top bar, the main navigation and where everything lives.',
      thumb: '/assets/tutorials/portal-getting-started.png',
      start: { tab: 'calendar' },
      steps: [
        {
          type: 'intro',
          title: 'Welcome to Opal',
          body: 'The Opal Portal is where the practice runs its day: appointments, scheduling, travel records, resources and your own profile.\n\nThis short walkthrough points out the controls you will use every day. You can leave at any time — your place is saved, and you can continue later from the Resource Hub.',
        },
        {
          type: 'highlight',
          target: 'app-header',
          pad: 4, rounded: '0',
          title: 'The top bar',
          body: 'This bar is always visible. From left to right: the sync status pill, global search, the daily snapshot, notifications, help, and your account menu.',
        },
        {
          type: 'highlight',
          target: 'main-nav',
          pad: 2, rounded: '8px',
          title: 'Main navigation',
          body: 'These tabs are the main areas of the portal. What you see here depends on your role — owners see practice management areas that therapists do not, so your tab row may differ from a colleague’s.',
        },
        {
          type: 'highlight',
          target: 'tab-calendar',
          route: { tab: 'calendar' },
          pad: 2, rounded: '8px',
          title: 'Calendar — your home base',
          body: 'You land on the Calendar after signing in. It shows your week as colour-coded blocks: sessions, travel and other commitments.\n\nThe **Using the Calendar** module covers it in detail.',
        },
        {
          type: 'highlight',
          target: 'sync-status',
          pad: 4, rounded: '8px',
          title: 'Outlook sync status',
          body: 'This pill shows whether your Outlook calendar is connected and when it last synced. Click it any time to refresh. If it says "not connected", the **Connecting Outlook** module shows you how to fix that.',
        },
        {
          type: 'highlight',
          target: 'header-search',
          pad: 4, rounded: '8px',
          title: 'Global search',
          body: 'Search across the portal from anywhere. Keyboard shortcut: **Cmd+K** on Mac or **Ctrl+K** on Windows.',
        },
        {
          type: 'highlight',
          target: 'header-report',
          pad: 4, rounded: '8px',
          title: 'Daily and weekly snapshot',
          body: 'A summary of the day or week — a quick morning check before you head out.',
        },
        {
          type: 'highlight',
          target: 'header-notifications',
          pad: 4, rounded: '8px',
          title: 'Notifications',
          body: 'Schedule changes, sync alerts and reminders arrive here. The badge shows how many are unread. The **Notifications** module covers what each type means.',
        },
        {
          type: 'highlight',
          target: '#tab-support-pop',
          pad: 2, rounded: '8px',
          title: 'Support',
          body: 'Something broken, confusing or missing? Open Support to report it — you can attach a screenshot, and the portal records which page you were on automatically.',
        },
        {
          type: 'highlight',
          target: 'header-help',
          pad: 4, rounded: '8px',
          title: 'Help and guided tours',
          body: 'The question mark opens Help: quick guided tours of individual screens, a setup checklist, and a way back to this induction.',
        },
        {
          type: 'highlight',
          target: '#app-user-chip',
          pad: 4, rounded: '8px',
          title: 'Your account',
          body: 'Click your name for the account menu: your profile, reporting an issue, your support tickets, and **Sign out**.',
        },
        {
          type: 'highlight',
          target: '#nav-more-btn',
          menu: false,
          roles: ['owner', 'admin'],
          pad: 2, rounded: '8px',
          title: 'The More menu',
          body: 'Less-frequent areas live under this menu — travel, business and administrative tools. Everything in it works exactly like a normal tab.',
        },
        {
          type: 'quiz',
          title: 'Quick check',
          quiz: {
            question: 'Where do you see today’s appointments after signing in?',
            options: ['The Calendar tab', 'The Support window', 'The account menu'],
            correctIndex: 0,
            explain: 'The Calendar is your home base — the portal lands there after every sign-in.',
          },
        },
        {
          type: 'complete',
          title: 'You know your way around',
          body: 'That’s the shell of the portal: navigation, search, notifications, support and your account.\n\nNext, make sure your details are up to date in **Your Profile and Documents**.',
          next: 'portal-profile-documents',
        },
      ],
    },

    // ── 2. Your Profile and Documents ───────────────────────────────────────
    {
      key: 'portal-profile-documents',
      version: 1,
      title: 'Your Profile and Documents',
      minutes: 5,
      roles: ALL_ROLES,
      description: 'Keep your details, credentials and documents current — and see where they are used.',
      thumb: '/assets/tutorials/portal-profile-documents.png',
      start: { tab: 'profile' },
      steps: [
        {
          "type": "intro",
          "title": "Your profile runs more than you think",
          "body": "My Profile is your own record in the portal: your details, work locations, leave, professional development, documents and credentials.\n\nIt is not just paperwork — the scheduler, travel estimates and compliance reminders all read from what you keep here. This walkthrough shows you around and points out what saves automatically, what needs a save button, and what only the practice owner can change."
        },
        {
          "type": "highlight",
          "target": ".pf-summary",
          "route": {
            "tab": "profile"
          },
          "pad": 6,
          "rounded": "12px",
          "title": "You, at a glance",
          "body": "The top of the tab shows how the portal knows you: your name, your role and your email.\n\nThe chip on the right tracks your account setup — it reads **Setup complete**, or counts the steps remaining. While anything is outstanding, an **Account setup status** card also appears above with the list. Some items there, like the Splose practitioner link for therapists, are set up for you by the practice owner."
        },
        {
          "type": "highlight",
          "target": "#pf-dashboard",
          "pad": 6,
          "rounded": "12px",
          "title": "Seven cards, one profile",
          "body": "Each card opens one section: **Personal Details**, **Work Locations**, **Leave** and **Professional development** (owners and admins see these last two as **Leave approvals** and **CPD approvals**), **Professional Development Documents**, **Credentials** and **Notifications**.\n\n**Work Locations** is where you set which base you work from each weekday — the scheduler uses it for travel estimates. **Notifications** holds your reminder preferences. Leave and CPD submitted here are reviewed by the practice owner."
        },
        {
          "type": "action",
          "target": ".pf-card[onclick*=\"pf-details\"]",
          "advance": "click",
          "pad": 4,
          "rounded": "12px",
          "title": "Open Personal Details",
          "body": "Click the **Personal Details** card to open the first section. Nothing changes until you edit and save — opening a section is always safe."
        },
        {
          "type": "highlight",
          "target": "profile-details",
          "pad": 6,
          "rounded": "10px",
          "title": "What the practice sees",
          "body": "This section shows your full name, display name, email, phone, job title and app role, plus whether your Outlook calendar is connected and whether your profile is complete.\n\nTwo things deliberately live elsewhere: practitioner registration details such as AHPRA and NDIS provider numbers are managed in Splose, and your **email address and app role can only be changed by the practice owner**."
        },
        {
          "type": "highlight",
          "target": "#pf-edit-btn",
          "roles": [
            "owner",
            "admin",
            "therapist"
          ],
          "pad": 4,
          "rounded": "8px",
          "title": "Editing your details",
          "body": "**Edit** opens the form. Display name, job title and phone are yours to change; the email field stays greyed out for the owner to manage.\n\nNothing is stored until you press **Save changes** — a green confirmation banner tells you it worked. If you treat clients, your display name is also your name on the practice calendar, so a change here shows for the whole team straight away."
        },
        {
          "type": "action",
          "target": ".pf-area-bar .btn",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Back to the cards",
          "body": "Click **← My Profile** to return to the cards.\n\nWorth knowing: Personal Details is the only profile form with a save button. Work Locations saves by itself moments after each change, and every section reloads fresh from the server whenever you open this tab."
        },
        {
          "type": "highlight",
          "target": "#pf-nav-leave",
          "roles": [
            "therapist"
          ],
          "pad": 4,
          "rounded": "12px",
          "title": "Requesting leave",
          "body": "The **Leave** card holds your leave requests and their status: Draft, Pending approval, Approved or Rejected.\n\nInside, **Request leave** opens the form — pick the leave type, the dates, add an optional note for the approver, and leave **Save as** on **Submit for approval** (a saved draft cannot be submitted later from the portal yet). Once submitted, a request cannot be edited or withdrawn here, so speak to the practice owner if plans change. When leave is approved, those dates show as unavailable in the practice scheduler — and the owner will tell you the outcome directly, as the portal does not send you a notification yet."
        },
        {
          "type": "highlight",
          "target": "#pf-nav-leave",
          "roles": [
            "owner"
          ],
          "pad": 4,
          "rounded": "12px",
          "title": "Approving leave",
          "body": "For you this card is **Leave approvals**. Inside, requests sit under Pending, Approved and Rejected tabs, and each pending request offers **Reject** and **Approve**.\n\nTake care: **Approve** applies immediately, with no confirmation step, and neither decision can be reversed in the portal. Rejecting asks for an optional reason, which the staff member sees against their request. Approved leave blocks that person’s availability in the Master Scheduler straight away — but the portal does not notify them automatically, so tell them directly. CPD submissions are approved the same way from the **CPD approvals** card."
        },
        {
          "type": "highlight",
          "target": "#pf-nav-cpd",
          "pad": 4,
          "rounded": "12px",
          "title": "Professional development",
          "body": "This card tracks CPD activities. Each one records a title, provider, category, date, hours and cost, with room for a supporting link and a short reflection.\n\nTherapists add activities with **Add CPD activity** — only the title is required — and submit them for the practice owner’s approval, keeping **Save as** on **Submit for approval**. Once activities are approved, their hours are totalled above the list, building the CPD record behind AHPRA registration. If your hours fall well behind pace for the year, the portal nudges you in your notifications."
        },
        {
          "type": "highlight",
          "target": ".pf-card[onclick*=\"pf-pddocs\"]",
          "pad": 4,
          "rounded": "12px",
          "title": "Your document folder",
          "body": "**Professional Development Documents** is where certificates, training records and other PD evidence live. **Upload document** takes a title, a document type, an optional link to one of your CPD activities, and the file itself — click the file box to choose a PNG, JPG or PDF up to 5 MB.\n\nEvery document offers **Download** any time. **Remove** deletes it permanently after a single confirmation, so treat it with respect. Files here are private: only you and the practice owner can open them."
        },
        {
          "type": "highlight",
          "target": ".pf-card[onclick*=\"pf-credentials\"]",
          "pad": 4,
          "rounded": "12px",
          "title": "Credentials and expiry dates",
          "body": "**Credentials** is the practice’s compliance record: AHPRA registration, Working with Children Check, NDIS Worker Screening, police clearance, insurances, first aid and more. Staff record each one with **Add credential** — type and name are required, and the expiry date matters most, because it is what the portal watches.\n\nA credential’s card turns amber once expiry is within 60 days and red once it has passed, and reminders start arriving in your notifications in the months before the date. The practice owner can mark a credential **Verified**. Here too, **Remove** is permanent — keep it for entries added in error."
        },
        {
          "type": "quiz",
          "title": "Quick check",
          "quiz": {
            "question": "Your Working with Children Check expires in six weeks. Where will you notice?",
            "options": [
              "Its card in Credentials turns amber, and reminders arrive in your notifications",
              "Nothing changes in the portal until the day it expires",
              "The portal renews it with the issuing body automatically"
            ],
            "correctIndex": 0,
            "explain": "Credential cards turn amber inside 60 days of expiry and red once expired, and reminder notifications begin well before the date — as long as the expiry date has been recorded on the credential."
          }
        },
        {
          "type": "complete",
          "title": "Your records are in your hands",
          "body": "That’s My Profile: your details, locations, leave, CPD, documents and credentials — with the portal watching the dates so nothing lapses quietly.\n\nIf you use your own Microsoft mailbox, the **Connecting Outlook** module is a good next stop; otherwise head straight to **Using the Calendar**.",
          "next": "portal-using-calendar"
        }
      ],
    },

    // ── 3. Connecting Outlook ───────────────────────────────────────────────
    {
      key: 'portal-connecting-outlook',
      version: 1,
      title: 'Connecting Outlook',
      minutes: 4,
      roles: WRITER_ROLES,
      description: 'Link your own Microsoft mailbox so the calendar mirrors your real day.',
      thumb: '/assets/tutorials/portal-connecting-outlook.png',
      start: { tab: 'calendar' },
      steps: [
        {
          "type": "intro",
          "title": "Why connect Outlook?",
          "body": "The portal calendar is a mirror of your Outlook calendar. Once connected, whatever is in your Outlook calendar shows up here, and the portal checks Outlook for changes about every 90 seconds — so what you see is your real day, not a copy that drifts.\n\nIt works both ways: appointments and travel blocks booked in the portal can be written straight back into your Outlook calendar (whether write-back is switched on depends on how your practice is set up).\n\nThis short module shows you how to connect, how to tell it is working, and what to do if it ever needs reconnecting."
        },
        {
          "type": "action",
          "target": ".settings-nav-item[data-section=\"integration-settings\"]",
          "route": {
            "tab": "settings"
          },
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Open Integrations",
          "body": "Everything about your Outlook connection lives in one place: **Settings → Integrations**.\n\nClick **Integrations** in the settings menu to open it.",
          "roles": [
            "owner"
          ]
        },
        {
          "type": "highlight",
          "route": {
            "tab": "settings",
            "section": "integration-settings"
          },
          "target": "#stg-outlook-status",
          "pad": 6,
          "rounded": "20px",
          "title": "Your connection at a glance",
          "body": "This pill shows the state of your Outlook connection:\n\n**Connected** — sync is running normally.\n\n**Not connected** — the portal is not linked to a mailbox yet.\n\n**Token expired — reconnect** — the connection has lapsed and needs a quick refresh (more on that shortly).\n\nIf it ever says **Status unavailable**, the portal could not check just now — try again in a minute.",
          "roles": [
            "owner"
          ]
        },
        {
          "type": "highlight",
          "target": "#stg-outlook-account",
          "pad": 6,
          "rounded": "8px",
          "title": "Connected as — which mailbox?",
          "body": "When connected, this line shows the **mailbox** the portal is mirroring — for example, \"Connected as reception@yourpractice.com.au\".\n\nIt can be different from the email you use to sign in to the portal — that is fine, and common with shared mailboxes. One rule to remember: a mailbox can only be connected to one portal account at a time.",
          "roles": [
            "owner"
          ]
        },
        {
          "type": "highlight",
          "target": "settings-outlook-connect",
          "pad": 6,
          "rounded": "8px",
          "title": "The Connect Outlook button",
          "body": "Clicking **Connect Outlook** takes you to Microsoft’s own sign-in page — the portal never sees your Microsoft password.\n\nWe will leave the button alone during this walkthrough so we do not leave the portal mid-tour. When you connect for real, the next screen looks like this…",
          "roles": [
            "owner"
          ]
        },
        {
          "type": "highlight",
          "target": "#outlook-connect-banner",
          "route": {
            "tab": "calendar"
          },
          "roles": [
            "admin",
            "therapist"
          ],
          "pad": 6,
          "rounded": "10px",
          "title": "Where you connect",
          "image": {
            "src": "/assets/tutorials/portal-connecting-outlook/connect-banner.png",
            "alt": "The Calendar showing the \"Outlook calendar not connected\" banner with its Connect Outlook button"
          },
          "body": "You connect Outlook during your first-time setup — and any time your account is not connected, the Calendar shows this banner with its own **Connect Outlook** button.\n\nClicking it takes you to Microsoft’s own sign-in page — the portal never sees your Microsoft password. If you are already connected, the banner stays out of the way (which is why you may be seeing a picture of it instead)."
        },
        {
          "type": "screenshot",
          "image": {
            "src": "/assets/tutorials/portal-connecting-outlook/account-picker.png",
            "alt": "Microsoft sign-in page asking which account to use"
          },
          "title": "Choosing your Microsoft account",
          "body": "Microsoft always asks which account to use, even if you are already signed in. Pick your **work account** — the one whose calendar you want mirrored here. Personal Microsoft accounts will not work; only accounts from your organisation can connect.\n\nOnce you have signed in, Microsoft sends you straight back to the portal. The whole trip takes under a minute."
        },
        {
          "type": "callout",
          "title": "What the portal can — and cannot — see",
          "body": "Connecting gives the portal access to exactly three things: reading your calendar, writing to your calendar, and your own name and email address.\n\nIt can never read your mail, your files, your Teams chats, or anyone else’s calendar. Your Microsoft password stays with Microsoft — the portal only holds a secure connection key, which is never shown to anyone."
        },
        {
          "type": "callout",
          "title": "Right after connecting",
          "body": "Back in the portal, the status pill turns **Connected** and the **Connected as** line shows your mailbox.\n\nYour events then start flowing in — give the first load a minute or two. From then on the portal picks up Outlook changes automatically, about every 90 seconds.",
          "roles": [
            "owner"
          ]
        },
        {
          "type": "highlight",
          "target": "sync-status",
          "pad": 6,
          "rounded": "20px",
          "title": "The sync pill in the top bar",
          "body": "You do not need to visit Settings to check on sync. This pill in the top bar shows it wherever you are — for example, **Outlook: synced 2 min ago**.\n\nClick the pill any time to refresh it on the spot. A red dot means something needs attention — head to **Settings → Integrations** to see what."
        },
        {
          "type": "highlight",
          "target": "settings-outlook-disconnect",
          "pad": 6,
          "rounded": "8px",
          "title": "Disconnect — what it does (and does not)",
          "body": "**Please do not click this now** — just know what it does.\n\nDisconnect stops sync for **your account only**. Events already mirrored into the portal stay put, nothing changes in your Outlook calendar itself, and nobody else’s connection is affected.\n\nA confirmation message appears before anything happens, and you can reconnect any time from this same screen.",
          "roles": [
            "owner"
          ]
        },
        {
          "type": "callout",
          "roles": [
            "admin",
            "therapist"
          ],
          "title": "Disconnecting",
          "body": "Disconnecting stops sync for one account only: events already mirrored into the portal stay put, and nothing changes in Outlook itself.\n\nThe disconnect control lives in the practice owner’s settings — if you need your connection removed or refreshed, ask the owner, or raise it through **Support**."
        },
        {
          "type": "callout",
          "title": "If the connection expires",
          "body": "Now and then the connection lapses. You will see **Token expired — reconnect** on the status pill here, or a notification with a **Reconnect Outlook** button that brings you back to this screen.\n\nNothing is lost. Click **Connect Outlook**, sign in to Microsoft again, and sync picks up where it left off.",
          "roles": [
            "owner"
          ]
        },
        {
          "type": "callout",
          "roles": [
            "admin",
            "therapist"
          ],
          "title": "If the connection expires",
          "body": "Now and then a connection lapses. Your early warning is the sync pill in the top bar — it will stop saying \"synced\".\n\nNothing is lost when this happens. Mention it to the practice owner or raise it through **Support**, and once reconnected, sync picks up exactly where it left off."
        },
        {
          "type": "quiz",
          "title": "Quick check",
          "quiz": {
            "question": "You click Disconnect and confirm. What happens to your Outlook calendar itself?",
            "options": [
              "Nothing — only the portal stops syncing your account",
              "Your Outlook events are deleted",
              "Outlook is disconnected for the whole practice"
            ],
            "correctIndex": 0,
            "explain": "Disconnect is local to your portal account: sync stops, events already mirrored stay in the portal, and Outlook itself is untouched. You can reconnect at any time."
          }
        },
        {
          "type": "complete",
          "title": "You’re connected",
          "body": "That is the Outlook connection: link your mailbox once, glance at the sync pill to know it is healthy,, and get it reconnected quickly if it ever lapses.\n\nNext, see what all those mirrored events look like in **Using the Calendar**.",
          "next": "portal-using-calendar"
        }
      ],
    },

    // ── 4. Using the Calendar ───────────────────────────────────────────────
    {
      key: 'portal-using-calendar',
      version: 1,
      title: 'Using the Calendar (Day, Week, Month)',
      minutes: 6,
      roles: ALL_ROLES,
      description: 'Read your week, switch views, open event details and understand the colours.',
      thumb: '/assets/tutorials/portal-using-calendar.png',
      start: { tab: 'calendar' },
      steps: [
        {
          "type": "intro",
          "title": "Your week at a glance",
          "body": "The Calendar is the heart of the portal. It mirrors your Outlook calendar, so what you see here is your real day: client sessions, travel, admin time and meetings, shown as colour-coded blocks.\n\nThis walkthrough shows you how to read the week, switch views, move through time and open the details of any appointment. Nothing you do in it will change a single booking."
        },
        {
          "type": "highlight",
          "target": "cal-view-tabs",
          "route": {
            "tab": "calendar"
          },
          "pad": 4,
          "rounded": "8px",
          "title": "Day, Week and Month",
          "body": "These buttons change how much of your calendar you see at once.\n\n**Week** is the everyday view — it’s where the calendar opens unless you’ve picked a different starting view in Settings. **Day** zooms into a single day in detail, and **Month** gives you the long view for planning ahead."
        },
        {
          "type": "highlight",
          "target": "cal-today",
          "pad": 4,
          "rounded": "8px",
          "title": "Moving through time",
          "body": "**Today** brings you straight back to the current date from wherever you’ve wandered.\n\nThe arrows beside it step backwards or forwards — one day, one week or one month at a time, depending on the view you’re in. The label next to the arrows always tells you exactly what you’re looking at."
        },
        {
          "type": "highlight",
          "target": "calendar-grid",
          "pad": 0,
          "rounded": "0",
          "title": "Reading the grid",
          "body": "Every block is one commitment: a client session, travel, admin time or a meeting. Today’s column is highlighted, and an orange line across it marks the current time.\n\nThe grid covers the full 24 hours — scroll up or down for early starts and evenings. Colours follow your Outlook categories, and the **Legend** button in the toolbar shows what each colour means."
        },
        {
          "type": "action",
          "target": "cal-view-month",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Try Month view",
          "body": "Let’s look at the bigger picture.\n\nClick the highlighted **Month** button. Switching views is always safe — it never changes any of your appointments."
        },
        {
          "type": "action",
          "target": "cal-view-week",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "The long view — and back again",
          "body": "Month view scrolls smoothly from one month into the next. Each day shows its first few events, with **+N more** when a day is busy — clicking any day opens it in Day view.\n\nWhen you’re ready, click **Week** to head back to the everyday view."
        },
        {
          "type": "highlight",
          "target": "#cal-sidebar",
          "pad": 4,
          "rounded": "8px",
          "title": "The mini month and My calendars",
          "body": "The mini month is the quickest way to jump around: in Day or Week view, click any date and the main calendar goes straight there.\n\nUnder **My calendars**, untick a category — Travel, say, or Meetings — to tuck those blocks out of view while you concentrate. Nothing is changed or deleted; it only affects what you see on this screen, and ticking the box brings everything straight back.\n\nOn smaller screens this sidebar tucks itself away — the lines button at the top left of the toolbar opens it."
        },
        {
          "type": "action",
          "target": ".session",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "image": {
            "src": "/assets/tutorials/portal-using-calendar/week-blocks.png",
            "alt": "Week view showing colour-coded appointment blocks"
          },
          "title": "Open an appointment",
          "body": "Click any block on your calendar — a details panel slides in from the right.\n\nLooking is always safe: opening details never changes the appointment."
        },
        {
          "type": "highlight",
          "target": "detail-panel",
          "pad": 4,
          "rounded": "8px",
          "image": {
            "src": "/assets/tutorials/portal-using-calendar/detail-drawer.png",
            "alt": "The session details panel, showing time, billing, patient and location"
          },
          "title": "Session details",
          "body": "The panel shows the session type, day and time, whether it’s billable, and the client’s details when there is one.\n\nThe **Location** section deserves a close look. If an appointment is missing its full street address you’ll see a warning. For accounts that can make changes, start typing in the address box and pick a suggestion — it saves on the spot — or press **Save & recalculate** after typing it yourself. Those address saves are real: they’re stored and synced back to Outlook so travel times can be worked out.\n\n**Navigate** opens the address in Google Maps. Close the panel with **Close**, the × in its top corner, or the Escape key."
        },
        {
          "type": "warning",
          "title": "What saves — and what doesn’t",
          "body": "The calendar mirrors Outlook, and in this version **time changes made here don’t stick**. Dragging a block, resizing its edges or editing the time boxes in the details panel will look like they work, but the calendar snaps back to Outlook’s times at the next refresh.\n\nTo change when something happens, change it in Outlook (or rebook it) and the portal will follow.\n\n**Deleting is different — it’s real.** For accounts that can make changes, **Delete** removes the event from this calendar and from Outlook, along with any linked travel blocks. A confirmation always appears first, and Cmd+Z (Ctrl+Z on Windows) can undo it straight away."
        },
        {
          "type": "highlight",
          "target": "cal-view-master",
          "roles": [
            "owner",
            "admin"
          ],
          "pad": 4,
          "rounded": "8px",
          "title": "The Scheduler view",
          "body": "As an owner or admin you get a fourth view. **Scheduler** lays the whole team out side by side for a single day — who’s free, who’s booked, and where a new appointment would fit best. There’s also an **All therapists (Master view)** link at the bottom of the My calendars list.\n\nThe **Master Scheduler** module walks through it properly."
        },
        {
          "type": "highlight",
          "target": "cal-add-event",
          "roles": [
            "owner",
            "admin",
            "therapist"
          ],
          "pad": 4,
          "rounded": "8px",
          "title": "Adding an appointment",
          "body": "**Add event** opens the New Appointment panel right over the calendar. You can also click any empty space in the grid — or drag across a stretch of time — and the panel opens with that time already filled in.\n\nBooking creates a real appointment in Outlook, so we won’t press it now. The **Booking an Appointment** module covers it end to end."
        },
        {
          "type": "quiz",
          "title": "Quick check",
          "quiz": {
            "question": "You drag a session to a new time, but a few minutes later it jumps back. What happened?",
            "options": [
              "Time changes made on this calendar don’t save in this version — change the time in Outlook instead",
              "Someone else on the team moved it back",
              "The session was cancelled"
            ],
            "correctIndex": 0,
            "explain": "Times on this calendar come from Outlook. Dragging or editing times here doesn’t save yet — update the time in Outlook (or rebook) and the portal follows at the next sync."
          }
        },
        {
          "type": "complete",
          "title": "You can read the week like a pro",
          "body": "Views, moving through time, the colours, session details and the golden rule — times live in Outlook, addresses save here. That’s the calendar covered.\n\nIf your account books appointments, the next module is **Booking an Appointment** — creating a session properly from start to finish.",
          "next": "portal-booking-appointment"
        }
      ],
    },

    // ── 5. The Master Scheduler ─────────────────────────────────────────────
    {
      key: 'portal-master-scheduler',
      version: 1,
      title: 'The Master Scheduler',
      minutes: 6,
      roles: ['owner', 'admin'],
      description: 'The whole-team free/busy matrix: propose a time, weigh recommendations, book.',
      thumb: '/assets/tutorials/portal-master-scheduler.png',
      start: { tab: 'calendar', calendarMode: 'master' },
      steps: [
        {
          "type": "intro",
          "title": "The whole practice on one screen",
          "body": "The Master Scheduler lays every therapist’s day side by side: who is free, who is busy, who is on leave, and where they are working. It is where owners and admins find the right person and the right time for a new appointment.\n\nIt is a **viewing and planning** tool — nothing you do in it changes anyone’s calendar, so feel free to click around as we go."
        },
        {
          "type": "action",
          "target": "cal-view-master",
          "route": {
            "tab": "calendar"
          },
          "advance": "click",
          "pad": 2,
          "rounded": "8px",
          "title": "Open the Scheduler",
          "body": "The Scheduler lives with the calendar views. Alongside **Day**, **Week** and **Month**, owners and admins get a fourth view tab: **Scheduler**.\n\nClick **Scheduler** now to open it."
        },
        {
          "type": "highlight",
          "target": ".sch-toolbar",
          "pad": 4,
          "rounded": "10px",
          "title": "One day at a time",
          "body": "The Scheduler shows a single day — use the **‹ ›** arrows, **Today** or the date picker to change it.\n\n**Start** and **Duration** describe the appointment you are trying to place. You can set them here, though it is usually quicker to click a time in the grid — that is next.\n\n**Working day** trims the view to office hours; switch it to **Full day** to see early or late times."
        },
        {
          "type": "highlight",
          "target": "#sm-scroll",
          "pad": 0,
          "rounded": "10px",
          "image": {
            "src": "/assets/tutorials/portal-master-scheduler/matrix.png",
            "alt": "The Master Scheduler grid: one row per therapist, free time as a pale background, commitments as labelled blocks"
          },
          "title": "Reading the grid",
          "body": "Every row is one therapist. A quiet, pale background means free time. Coloured blocks are commitments, and shaded stretches mean time that cannot be booked: outside working hours, on leave, protected buffer time, or a gap too short to fit an appointment.\n\n**Privacy is built in:** across the team, blocks show only the kind of commitment — **Client session**, **Meeting**, **Busy** — never client names or appointment details.\n\nA **default hours** badge under a name means that therapist has no schedule set up for this week, so standard hours are assumed rather than known."
        },
        {
          "type": "action",
          "target": ".sm-track",
          "advance": "click",
          "pad": 2,
          "rounded": "8px",
          "image": {
            "src": "/assets/tutorials/portal-master-scheduler/matrix.png",
            "alt": "Clicking a clear moment in a therapist row proposes a time"
          },
          "title": "Propose a time",
          "body": "Click a **clear moment** in this top row — empty space, not a block. A dashed band appears at that time in **every** row so you can compare the whole team at once, and the therapist whose row you clicked becomes the pick for the slot.\n\nAfterwards you can drag the band to another time, or drag its right edge to change the length. Nothing is booked by any of this."
        },
        {
          "type": "highlight",
          "target": "#sm-summary",
          "pad": 4,
          "rounded": "8px",
          "title": "The summary bar",
          "body": "This bar sums up your proposal: the time, and how many of the selected therapists are free then — for example **9:00am–10:00am · 4 of 6 selected therapists available**.\n\nThe picked therapist’s name sits here next to the **Schedule** button, and **Clear slot** removes the proposal whenever you want to start again."
        },
        {
          "type": "highlight",
          "target": ".sm-chip",
          "pad": 4,
          "rounded": "8px",
          "image": {
            "src": "/assets/tutorials/portal-master-scheduler/status-chips.png",
            "alt": "Therapist rows with a proposed slot: each row shows a verdict chip such as Available, Busy or On leave"
          },
          "title": "Every row gives its verdict",
          "body": "While a time is proposed, each row carries a chip with that therapist’s verdict for it, such as **Available**, **Busy**, **On leave**, **Outside working hours**, **Buffer time** or **Not enough free time**.\n\nOnce travel has been checked — more on that shortly — chips can sharpen further: **Travel feasible**, **Tight travel**, or **Not practical for this location**."
        },
        {
          "type": "highlight",
          "target": ".sm-check",
          "pad": 6,
          "rounded": "8px",
          "title": "Compare a shortlist",
          "body": "Every therapist starts ticked. Untick anyone you are not considering — their row greys out and drops from the count. **Select all** and **Clear** in the top-left corner reset the list, and the search box there finds a name quickly.\n\nWith two or more ticked, Opal also works out when **everyone** selected is free at the same time: those windows appear in the summary bar as **Common free** and as a soft highlight along the time ruler."
        },
        {
          "type": "highlight",
          "target": ".sch-toggle[data-act=\"recs\"]",
          "pad": 4,
          "rounded": "8px",
          "title": "Ask Opal to recommend",
          "body": "**Recommend** stays greyed out until a time is proposed — pick a moment first.\n\nIt also needs to know where the client will be: type their suburb into **Client suburb** in the toolbar, or tick **Telehealth (no travel)** inside the panel. Opal then ranks the team for the slot — **Best fit**, **Good fit**, **Possible**, **Not ideal** — with plain-language reasons and travel times, and lists who cannot take it and why. Clicking a suggestion picks that therapist and moves the band to the suggested time.\n\nOne quirk to know: the **Discipline** dropdown narrows these recommendations only — it never hides rows in the grid."
        },
        {
          "type": "highlight",
          "target": ".sm-name",
          "pad": 4,
          "rounded": "8px",
          "title": "Zoom in on one therapist",
          "body": "Click any therapist’s **name** to open their day in a side panel: appointment count, clinical and available time, their next free window, and **Open windows** you can turn into a proposal with **+ Add appointment** — it only positions the band; it books nothing.\n\nBecause this looks at one therapist rather than the whole team, the day list here shows full appointment details.\n\nThe **This week** strip at the bottom shows Monday-to-Friday capacity — click a day to jump the Scheduler there."
        },
        {
          "type": "highlight",
          "target": ".sch-toggle[data-act=\"map\"]",
          "pad": 4,
          "rounded": "8px",
          "title": "See the day on a map",
          "body": "**Map** plots the day’s face-to-face client visits, one colour per therapist, so you can see who is working where before you add a travel-heavy booking. Tick **Operating areas** to sketch each therapist’s usual patch.\n\nPins sit at suburb level — never exact addresses — and telehealth sessions are never mapped. If the map cannot load, the rest of the Scheduler keeps working."
        },
        {
          "type": "highlight",
          "target": ".sch-add-btn[data-act=\"add\"]",
          "pad": 4,
          "rounded": "8px",
          "title": "From proposal to booking",
          "body": "When the slot looks right, **+ Appointment** here (or **Schedule** in the summary bar) opens the **New Appointment** panel with your chosen therapist already selected.\n\n**The day and time do not carry across.** The panel always books into the current week, so set the day, start time and duration again under **When & Where** before creating anything.\n\nWe will leave the panel closed for now — the **Booking an Appointment** module walks through it end to end."
        },
        {
          "type": "quiz",
          "title": "Quick check",
          "quiz": {
            "question": "You propose 2:00pm in the Scheduler, pick a therapist and click Schedule. What must you check in the New Appointment panel before creating the booking?",
            "options": [
              "The day and time — the panel does not carry them across",
              "Nothing — the appointment is already created",
              "The client’s suburb — bookings cannot be created without one"
            ],
            "correctIndex": 0,
            "explain": "Schedule carries the therapist across, but not the proposed day or time — and the panel books into the current week. Always set When & Where in the panel before you create. (A suburb only helps with travel-aware recommendations; it is not needed to book.)"
          }
        },
        {
          "type": "complete",
          "title": "You can run the whole board",
          "body": "You can now read the team’s day at a glance, propose a time, compare a shortlist, weigh Opal’s recommendations and check the map — all without touching anyone’s calendar.\n\nNext, follow a booking all the way through in **Booking an Appointment**.",
          "next": "portal-booking-appointment"
        }
      ],
    },

    // ── 6. Booking an Appointment ───────────────────────────────────────────
    {
      key: 'portal-booking-appointment',
      version: 1,
      title: 'Booking an Appointment',
      minutes: 5,
      roles: WRITER_ROLES,
      description: 'The New Appointment panel end to end: type, client, time — and what saving does.',
      thumb: '/assets/tutorials/portal-booking-appointment.png',
      start: { tab: 'calendar' },
      steps: [
        {
          "type": "intro",
          "title": "Booking an Appointment",
          "body": "This module walks the **New Appointment** panel end to end: choosing a booking type, picking the client, setting the day and time, and what actually happens when you save.\n\nWe will open the real panel and look at every part of it — but we will **not** create an appointment. At the end you will close the panel without saving anything."
        },
        {
          "type": "action",
          "target": "cal-add-event",
          "route": {
            "tab": "calendar"
          },
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Open the New Appointment panel",
          "body": "Everything starts here. Click **Add event** to open the panel.\n\nA tip for later: clicking an empty slot in the week view — or dragging across a stretch of one — opens the same panel with that day and time already filled in."
        },
        {
          "route": {
            "tab": "calendar",
            "open": "booking"
          },
          "type": "action",
          "target": ".bk-item[data-leaf=\"therapy\"]",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Choose a booking type",
          "body": "The panel asks for the type first, because the type decides what the rest of the form needs — a client session asks for a client, an email block asks for a title — and each type starts with a sensible duration.\n\nBillable work sits at the top (direct services, requested reports, non-face-to-face), non-billable at the bottom. The **Provider travel** section is there for the billing rules only — there is nothing to book under it, because travel blocks are created automatically between in-person sessions.\n\nClick **Therapy session** to continue."
        },
        {
          "type": "highlight",
          "target": "#cat-client-section",
          "roles": [
            "owner",
            "admin"
          ],
          "pad": 6,
          "rounded": "8px",
          "title": "Pick the client",
          "body": "For a client session, this is where you choose who the appointment is for. The list comes straight from Splose, so it always shows the practice’s current active clients.\n\nSearch by name, suburb or postcode, or narrow the list with the region pills — **East**, **South**, **West**, **Central**. Each card shows the client’s region, NDIS plan and suburb, so you can be sure you have the right person. In a real booking, clicking a card is what selects the client — leave the cards alone today, since we are not booking anyone.\n\nIf the list ever looks empty, a search or region filter is probably still on — clear it and everyone comes back."
        },
        {
          "type": "highlight",
          "target": "#cat-client-section",
          "roles": [
            "therapist"
          ],
          "pad": 6,
          "rounded": "8px",
          "title": "Client bookings are made for you",
          "body": "This is where a client would be chosen — but as a therapist you will see a notice here instead of a client list. The patient directory is only open to the practice owner and admins, so when a client session needs booking, ask them and it will be created on your calendar.\n\nEverything else in this panel is yours to use: reports, case noting, emails, phone calls, professional development, supervision, lunch and the rest need no client at all."
        },
        {
          "type": "highlight",
          "target": "#bsp-day-chips",
          "pad": 6,
          "rounded": "8px",
          "title": "Day — this week only",
          "body": "Down in **When & Where** is where the day gets picked — no need to pick one now. One thing to remember: these chips are always **Monday to Friday of the current week**.\n\nThat holds even if the calendar behind the panel is showing a different week — the appointment still lands in the current week. So before you save a real booking, double-check the day chip says what you think it says.\n\nNo day is pre-selected: if you forget to pick one, the panel asks you to set a time rather than guessing."
        },
        {
          "type": "highlight",
          "target": ".bsp-time-row",
          "pad": 6,
          "rounded": "8px",
          "title": "Start and End",
          "body": "Set the start time and the end time moves with it, keeping the appointment’s length. Adjust the end time instead and the duration updates to match.\n\nTimes move in 15-minute steps, which keeps the calendar tidy."
        },
        {
          "type": "highlight",
          "target": ".bsp-dur-presets",
          "pad": 6,
          "rounded": "8px",
          "title": "Duration",
          "body": "The quickest way to set the length: tap a preset, from **15m** up to **4h**, or drag the slider above them for anything in between.\n\nFour hours is the longest a single appointment can be from this panel. The duration starts at a sensible default for the booking type — an hour for client sessions — until you change it."
        },
        {
          "type": "highlight",
          "target": "#bsp-location",
          "pad": 6,
          "rounded": "8px",
          "title": "Location",
          "body": "This field is optional — and for client sessions you can leave it alone. The appointment is saved with the **client’s own address** from their record, not with whatever is typed here.\n\nIf a session is happening somewhere unusual, create the appointment first, then open it on the calendar and edit the address there — that change is saved properly and synced to Outlook."
        },
        {
          "type": "highlight",
          "target": "#bsp-therapist-strip",
          "roles": [
            "owner",
            "admin"
          ],
          "pad": 6,
          "rounded": "8px",
          "image": {
            "src": "/assets/tutorials/portal-booking-for-strip.png",
            "alt": "The \"Booking for\" strip at the top of the New Appointment panel, showing a chip for each therapist"
          },
          "title": "Booking for whom?",
          "body": "As an owner or admin you can create appointments on any therapist’s calendar. This strip at the top of the panel shows who the booking is for: with one therapist it simply names them, a small team gets a chip each, and a larger team gets a dropdown.\n\nTherapists don’t see this strip — anything they book goes on their own calendar."
        },
        {
          "type": "highlight",
          "target": "#create-booking-btn",
          "pad": 6,
          "rounded": "8px",
          "title": "What Create appointment does",
          "body": "**Don’t click it now** — but here is what happens when you do.\n\nThe appointment is written straight onto the therapist’s real Outlook calendar and into the portal at the same time. There is no confirmation pop-up: you land back on the calendar with the new appointment in view, and a quiet message confirms it was added.\n\nMade a mistake? **Cmd+Z** on Mac or **Ctrl+Z** on Windows undoes the booking for about ten minutes after you create it."
        },
        {
          "type": "warning",
          "title": "The panel does not check for clashes",
          "body": "Creating an appointment does **not** check the therapist’s calendar for conflicts. If the time is already taken, both appointments simply sit on the calendar overlapping — nothing stops a double-booking at save time.\n\nSo make a habit of glancing at the therapist’s day before you book. Owners and admins can also use the **Master Scheduler**, which shows the whole team’s availability at once."
        },
        {
          "type": "action",
          "target": ".bsp-close",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Close without saving",
          "body": "To finish, click the **✕** in the top corner to close the panel. Pressing **Escape** or clicking outside the panel does the same.\n\nOne thing to know: closing throws away everything you have entered, without asking. There is no draft — if you are half-way through a real booking, create it before you step away."
        },
        {
          "type": "quiz",
          "title": "Quick check",
          "quiz": {
            "question": "You need to book a client session for a day next week. What will the New Appointment panel let you do?",
            "options": [
              "Pick any date using the day chips",
              "Only pick a day in the current week — the chips are always this week’s Monday to Friday",
              "Pick next week, as long as the calendar behind the panel is showing next week"
            ],
            "correctIndex": 1,
            "explain": "The day chips always cover the current week only — even when the calendar behind the panel is showing a different week. Always double-check the day chip before you create."
          }
        },
        {
          "type": "complete",
          "title": "You can take a booking end to end",
          "body": "That’s the whole journey: type, client, day and time, then **Create appointment** — straight onto the Outlook calendar with nothing in the way.\n\nEvery in-person session you book also creates travel blocks around it automatically. See how that travel is recorded and checked in **The Travel Logbook**.",
          "next": "portal-travel-logbook"
        }
      ],
    },

    // ── 7. The Travel Logbook ───────────────────────────────────────────────
    {
      key: 'portal-travel-logbook',
      version: 1,
      title: 'The Travel Logbook',
      minutes: 5,
      roles: WRITER_ROLES,
      description: 'How travel between visits is recorded, checked and kept accurate.',
      thumb: '/assets/tutorials/portal-travel-logbook.png',
      start: { tab: 'logbook' },
      steps: [
        {
          "type": "intro",
          "title": "Your travel, recorded for you",
          "body": "The Travel Logbook is the practice’s financial-year record of travel to and from appointments. It builds itself: when provider travel is recorded against an appointment in Splose, the journey appears here — with the minutes, estimated kilometres and a dollar figure.\n\nThere is nothing to fill in day to day. This short walkthrough shows you how to read the logbook, and the one thing you can edit."
        },
        {
          "type": "highlight",
          "target": ".tab[data-tab=\"logbook\"]",
          "menu": true,
          "roles": [
            "owner",
            "admin"
          ],
          "pad": 2,
          "rounded": "8px",
          "title": "Finding the logbook",
          "body": "The Travel Logbook lives in the dropdown at the end of the tab row — labelled **More** for owners and **Menu** for admins — under the **Travel** group.\n\nThe greyed-out **Travel & Flights** item beside it is a placeholder for a planned feature and is not available yet."
        },
        {
          "type": "highlight",
          "target": ".tab[data-tab=\"logbook\"]",
          "roles": [
            "therapist"
          ],
          "pad": 2,
          "rounded": "8px",
          "title": "Your Logbook tab",
          "body": "As a therapist, the **Travel Logbook** sits right in your main tab row — one click from anywhere in the portal."
        },
        {
          "type": "callout",
          "roles": [
            "owner",
            "admin"
          ],
          "title": "You see the whole practice",
          "body": "Owners and admins see every practitioner’s travel together in one list, so the totals cover the whole team for the selected year.\n\nTherapists see only their own journeys when they open the same page."
        },
        {
          "type": "callout",
          "roles": [
            "therapist"
          ],
          "title": "You see your own journeys",
          "body": "Your logbook shows only your own travel — journeys linked to your appointments.\n\nIf you see a note about linking your Splose practitioner profile instead of a list, ask the practice owner to finish setting up your therapist profile. Your logbook appears as soon as that is done."
        },
        {
          "type": "highlight",
          "target": "#logbook-fy",
          "route": {
            "tab": "logbook"
          },
          "pad": 4,
          "rounded": "8px",
          "title": "Pick a financial year",
          "body": "The logbook works in financial years — 1 July to 30 June. This selector opens on **FY 2026–27** and goes back three years; changing it reloads the list.\n\nThe **Refresh** button beside it reloads the logbook, and the small note under the heading shows the time it last updated. The logbook also keeps itself fresh in the background."
        },
        {
          "type": "highlight",
          "target": ".logbook-stats",
          "pad": 6,
          "rounded": "8px",
          "title": "The totals at a glance",
          "body": "Four cards sum up the selected year: **Travel trips**, **Total minutes**, **Est. kilometres** and **Deduction**.\n\nOnce the data loads, the Deduction card also shows the kilometre rate it uses — for example, @$0.88/km."
        },
        {
          "type": "callout",
          "title": "How the numbers are worked out",
          "body": "The travel **minutes** come straight from what was recorded in Splose. The **kilometres** are an estimate: the portal converts those minutes at an average speed of 40 km/h. The **deduction** multiplies the kilometres by the practice kilometre rate, which is set by the practice owner in Business Settings ($0.88 per kilometre unless changed).\n\nTreat these figures as a working estimate for checking travel — the logbook does not produce a tax report or an export."
        },
        {
          "type": "highlight",
          "target": "travel-logbook",
          "pad": 6,
          "rounded": "8px",
          "title": "The journey list",
          "body": "Journeys are grouped by month. Each row shows the trip — **Round trip**, **To** or **From** — with the destination address, the linked appointment, the date and approximate departure and arrival times. On the right: the minutes, estimated kilometres and dollar figure for that trip.\n\nYou never add entries by hand. Journeys appear automatically once provider travel is recorded against appointments in Splose — so if the list is empty for a period, no travel was recorded then."
        },
        {
          "type": "highlight",
          "target": "#lb-detail-side",
          "pad": 6,
          "rounded": "8px",
          "title": "Journey details",
          "body": "Select any journey and its details open in this side panel: the trip type, the date and time, and the addresses.\n\nWhen a journey has a date, an **Open in calendar** button jumps to that week — and the logbook keeps your place, so your selected journey is still highlighted when you come back. On smaller screens the details open in a pop-up window instead."
        },
        {
          "type": "callout",
          "title": "The one thing you can change: addresses",
          "body": "The logbook is a record, not a form — the only edit is tidying a journey’s addresses. In the journey details, correct the **From address** or **To address** and click **Save addresses**. A destination address is required; the From address may be left blank.\n\nFixing an address updates only the logbook record — nothing changes in Splose or Outlook, and the original address is kept behind the scenes. The list refreshes by itself after you save."
        },
        {
          "type": "callout",
          "title": "Not the same as calendar travel",
          "body": "You may also see coloured travel strips between sessions on the calendar. Those are live estimates to help you plan the day — a separate feature from this logbook, which is the record drawn from Splose.\n\nClicking a travel strip opens the Travel Details panel, and its **View Travel Logbook** link brings you back here."
        },
        {
          "type": "quiz",
          "title": "Quick check",
          "quiz": {
            "question": "A journey in the logbook shows the wrong destination address. What happens when you correct it and click Save addresses?",
            "options": [
              "Only the logbook record changes — Splose and Outlook are untouched",
              "The appointment’s address is updated in Splose",
              "A new travel event is added to your Outlook calendar"
            ],
            "correctIndex": 0,
            "explain": "Address fixes are a local tidy-up for the travel record. The practice systems keep their original address — and the logbook quietly remembers it too."
          }
        },
        {
          "type": "complete",
          "title": "You can read the logbook",
          "body": "You know where the Travel Logbook lives, what the totals mean, how the estimates are worked out and how to tidy an address when one is wrong.\n\nNext, find policies, guides and your learning in **Using the Resource Hub**.",
          "next": "portal-resource-hub"
        }
      ],
    },

    // ── 8. Using the Resource Hub ───────────────────────────────────────────
    {
      key: 'portal-resource-hub',
      version: 1,
      title: 'Using the Resource Hub',
      minutes: 4,
      roles: ALL_ROLES,
      description: 'Find policies, guides and learning: collections, search, saving and My Learning.',
      thumb: '/assets/tutorials/portal-resource-hub.png',
      start: { tab: 'resources' },
      steps: [
        {
          "type": "intro",
          "title": "One place for everything you need to know",
          "body": "The Resource Hub is the practice’s shared bookshelf: policies, clinical guides, portal tutorials, professional development and your own learning record, all in one place.\n\nThis walkthrough shows you how to find things fast, keep your favourites handy, and see what the practice needs you to read."
        },
        {
          "type": "highlight",
          "target": ".rh2-nav",
          "route": {
            "tab": "resources"
          },
          "pad": 4,
          "rounded": "8px",
          "title": "The hub menu",
          "body": "The hub lives under the **Resources** tab, and this menu is how you move around inside it: **Home**, **Library**, **Saved**, **My Learning**, **Professional development** and **Assessments**.\n\nOwners and practice administrators also see an **Admin** section on the end. You’re on **Home** now — let’s look around."
        },
        {
          "type": "highlight",
          "target": ".rh2-hero-search",
          "pad": 6,
          "rounded": "10px",
          "title": "When you know what you’re after, search",
          "body": "Type a few words here — a policy name, a topic, “calendar” — and press **Enter** or the **Search** button. Results open in the Library, where you can narrow them further.\n\nSearch covers everything in the hub: policies, guides, tutorials and NDIS guidance alike."
        },
        {
          "type": "action",
          "target": ".rh2-nav .rh2-nav-btn:nth-child(2)",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Open the Library",
          "body": "The Library is the full catalogue — everything approved for staff.\n\nClick **Library** in the hub menu now, and the walkthrough will follow you there."
        },
        {
          "type": "highlight",
          "target": ".rh2-filters",
          "pad": 6,
          "rounded": "10px",
          "title": "Narrowing the list",
          "body": "The search box here works as you type. Beside it, dropdowns narrow the list: **All kinds** separates hosted documents, external links and in-portal guides; **All types** picks a category like policy or tutorial; **All topics** filters by therapy area — with more filters after that.\n\nThe last dropdown changes the order: most relevant, recently updated, A to Z, or most popular. If there’s more than one page, a **Load more** button sits under the grid."
        },
        {
          "type": "action",
          "target": ".rh2-grid button.rh2-cardtile",
          "advance": "click",
          "pad": 6,
          "rounded": "12px",
          "title": "Reading a card — then opening one",
          "body": "Each card tells you what you’re getting before you click: what kind of thing it is, roughly how many minutes it takes, a **Required** chip if the practice expects everyone to read it, a star once you’ve saved it, and often a badge showing who published it.\n\nOpening a resource is always safe — click this card now to see one."
        },
        {
          "type": "highlight",
          "target": ".rh2-article-head .rh2-article-actions:last-of-type",
          "roles": [
            "owner",
            "admin",
            "therapist"
          ],
          "pad": 6,
          "rounded": "8px",
          "title": "Save it, or tick it off",
          "body": "**Save** puts a resource on your personal shortlist — everything you save appears under **Saved** in the hub menu, so the guides you use every week are two clicks away.\n\n**Mark complete** records that you’ve worked through it, and if the resource belongs to a learning path it ticks off there too. Both are toggles: click again to undo."
        },
        {
          "type": "callout",
          "roles": [
            "owner",
            "admin",
            "therapist"
          ],
          "title": "Acknowledgements are the formal one",
          "body": "Some policies carry an **Acknowledge** button as well. That one is different: after you press it, the hub asks you to **Confirm** that you have read and understood the current version, and your confirmation becomes a permanent, version-stamped record the practice relies on.\n\nSo only confirm once you genuinely have read the policy — we won’t do one now. Small wording fixes never ask you again; if a policy changes materially, it returns to **Required for you** on the hub’s Home page until you acknowledge the new version."
        },
        {
          "type": "action",
          "target": ".rh2-nav .rh2-nav-btn:nth-child(4)",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Open My Learning",
          "body": "The hub menu works from anywhere — you don’t need to go back first.\n\nClick **My Learning** now to see your own learning record."
        },
        {
          "type": "highlight",
          "target": ".rh2-path",
          "pad": 6,
          "rounded": "12px",
          "title": "Learning paths",
          "body": "A learning path is a sequence of resources in a sensible order — a progress bar up top, the modules numbered below, and a tick beside each one you’ve completed. The **Continue learning** card on Home brings you straight back to wherever you’re up to.\n\nYour induction lives here too: the **Opal Portal induction** panel at the top of this page tracks every interactive walkthrough — including the one you’re doing right now — so you can pause and pick any module up later."
        },
        {
          "type": "highlight",
          "target": "rh2-cpd",
          "roles": [
            "owner",
            "admin",
            "therapist"
          ],
          "pad": 6,
          "rounded": "12px",
          "title": "Your CPD at a glance",
          "body": "**CPD this registration year** counts the hours you’ve logged, with interactive hours shown separately. **Add CPD entry** opens a short form — a date and the activity are all it needs, with provider, hours and a reflection if you want them.\n\nOne honest caveat, straight from the tracker itself: it’s informational only. Your professional body’s own CPD record remains the authoritative one."
        },
        {
          "type": "highlight",
          "target": "rh2-cpd",
          "roles": [
            "read_only"
          ],
          "pad": 6,
          "rounded": "12px",
          "title": "The CPD tracker",
          "body": "**CPD this registration year** shows continuing-professional-development hours at a glance, with interactive hours counted separately.\n\nIt’s informational only — a professional body’s own CPD record remains the authoritative one."
        },
        {
          "type": "quiz",
          "title": "Quick check",
          "quiz": {
            "question": "You need the practice’s privacy policy but can’t remember where it lives. Quickest way to find it?",
            "options": [
              "Search from the hub’s Home page — results open in the Library",
              "Scroll through the calendar until it turns up",
              "Ask a colleague to email you their copy"
            ],
            "correctIndex": 0,
            "explain": "Search covers everything in the hub — policies, guides and tutorials — and the Library’s filters can narrow it from there. Colleagues’ emailed copies go stale; the hub always shows the current version."
          }
        },
        {
          "type": "complete",
          "title": "The hub is yours",
          "body": "You can now find anything in the Library, keep your regulars under **Saved**, follow a learning path, and see what the practice needs you to read on the Home page.\n\nNext, learn where schedule changes and alerts arrive in **Notifications**.",
          "next": "portal-notifications"
        }
      ],
    },

    // ── 9. Notifications ────────────────────────────────────────────────────
    {
      key: 'portal-notifications',
      version: 1,
      title: 'Notifications',
      minutes: 4,
      roles: ALL_ROLES,
      description: 'Where alerts arrive, what each type means, and how to keep the list clean.',
      thumb: '/assets/tutorials/portal-notifications.png',
      start: { tab: 'calendar' },
      steps: [
        {
          "type": "intro",
          "title": "Where alerts arrive",
          "body": "The portal keeps an eye on your day and lets you know when something needs attention: schedule clashes, expiring credentials, sync trouble, policy updates and more.\n\nEverything arrives in one place — the notifications panel. Alerts appear inside the portal only; they are not emailed to you, so the panel is worth a glance each day. This walkthrough takes a few minutes."
        },
        {
          "type": "action",
          "target": "header-notifications",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "The bell",
          "body": "The bell sits in the top bar on every page. When you have unread alerts, a red badge shows the count — it refreshes about once a minute while the portal is open.\n\n**Click the bell** to open your notifications."
        },
        {
          "route": {
            "open": "notifications"
          },
          "type": "highlight",
          "target": "notif-list",
          "pad": 4,
          "rounded": "8px",
          "title": "What lands here",
          "body": "Day-to-day notices arrive here: a summary of today’s appointments (on days you have any), calendar clashes, appointments missing an address, unusually long travel between visits, sessions still waiting on a case note, and reminders when a credential is close to expiry or CPD hours are behind pace.\n\nThe practice uses it too: you’ll be told when a policy in the Resource Hub changes and needs a fresh acknowledgement, and when a support ticket you reported is updated.\n\nIf there’s nothing to show, you’ll see **You’re all caught up!**"
        },
        {
          "type": "highlight",
          "target": "notif-list",
          "roles": [
            "owner",
            "admin"
          ],
          "pad": 4,
          "rounded": "8px",
          "title": "Practice-level alerts",
          "body": "Because you help run the practice, some extra alerts come your way: clients who haven’t been seen for several weeks, client addresses the portal can’t resolve, and team members whose profiles are incomplete.\n\nOwners also receive billing readiness notices, plus an alert whenever an automatic sync is halted as a safety precaution."
        },
        {
          "type": "screenshot",
          "image": {
            "src": "/assets/tutorials/portal-notifications/sync-writeback.png",
            "alt": "A red sync alert in the notifications panel with a Reconnect Outlook button"
          },
          "title": "Sync trouble",
          "body": "If the portal and Outlook lose touch — the regular sync has stopped moving, or a change couldn’t be written back to your Outlook calendar — a red alert appears here. Nothing is lost, but the two calendars can drift out of step until the connection is sorted, so it’s worth acting on.\n\nSplose connection problems appear the same way, with a **Retry sync** button that re-checks the connection on the spot. Outlook alerts carry a shortcut button — **Reconnect Outlook** or **Open Integrations** — which opens Settings, where the practice owner can re-link the mailbox. That Settings page is owner-only: for everyone else, if your Outlook link has dropped, use the **Connect Outlook** banner that appears at the top of the Calendar, or ask the owner for a hand."
        },
        {
          "type": "highlight",
          "target": "notif-list",
          "pad": 4,
          "rounded": "8px",
          "title": "Read, unread and jumping across",
          "body": "Unread alerts are tinted, with a dot on the right-hand side — the bell badge counts them.\n\nMost alerts are linked to a page: click one and it’s marked as read and the portal takes you there — a calendar clash opens the Calendar, a credential reminder opens My Profile. Many also carry a shortcut button such as **Open Profile** or **View Calendar**. Alerts without a linked page simply mark themselves read when clicked."
        },
        {
          "type": "highlight",
          "target": "notif-mark-all",
          "pad": 4,
          "rounded": "8px",
          "title": "Keeping the list tidy",
          "body": "**Mark all read** clears the badge and the unread tints in one go — the alerts themselves stay in the list.\n\nTo remove an alert, use its **Dismiss** button. One thing to know: if the underlying issue is still there — say two appointments still overlap — the portal raises the alert again on a later check. Fix the issue and it stays gone. The daily schedule summary is the exception — there’s nothing to fix, so dismissing it only hides it until the panel next refreshes, and it returns on any day you have appointments."
        },
        {
          "type": "action",
          "target": "#notif-close-btn",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Close the panel",
          "body": "**Click the close button** in the top corner of the panel. Clicking anywhere outside the panel, or pressing Escape, works too."
        },
        {
          "type": "action",
          "target": ".settings-nav-item[data-section=\"notif-settings\"]",
          "route": {
            "tab": "settings"
          },
          "roles": [
            "owner"
          ],
          "advance": "click",
          "pad": 2,
          "rounded": "8px",
          "title": "Notification settings",
          "body": "As the practice owner you also have a Settings area with a page of notification switches.\n\n**Click Notifications** in the settings menu to open it."
        },
        {
          "route": {
            "tab": "settings",
            "section": "notif-settings"
          },
          "type": "highlight",
          "target": "#settings-notif-settings",
          "roles": [
            "owner"
          ],
          "pad": 6,
          "rounded": "8px",
          "title": "What these switches do",
          "body": "The switches that make a visible difference today are the calendar ones: **Calendar conflict warnings** turns the red conflict badges on calendar tiles on or off, **Missing location alerts** controls the missing-address markers, and the **Dormant Cases** controls set whether dormant-case detection runs and how many quiet weeks count as dormant.\n\nWorth knowing: these switches don’t filter the notifications panel — it always shows every alert raised for you.\n\nIf you change anything, press **Save Notification Settings** and wait for the Saved tick."
        },
        {
          "type": "highlight",
          "target": ".pf-card[onclick=\"pfOpenArea('pf-alerts')\"]",
          "route": {
            "tab": "profile"
          },
          "pad": 4,
          "rounded": "8px",
          "image": {
            "src": "/assets/tutorials/portal-notifications/profile-notifications-card.png",
            "alt": "The Notifications card on the My Profile dashboard"
          },
          "title": "Your personal reminders",
          "body": "Your own reminder preferences live behind this **Notifications** card — the same choices you made on the sign-up checklist. Toggles here save the moment you flip them.\n\nThe one to know is the **work-location reminder**: leave it on and, on Fridays, if next week’s work locations aren’t filled in, a reminder lands in your notifications panel.\n\nAn honest note: the other reminders listed on that page are recorded but not active yet, and nothing on it is emailed — alerts only ever arrive inside the portal."
        },
        {
          "type": "quiz",
          "title": "Quick check",
          "quiz": {
            "question": "You’ve fixed an overlapping appointment, but the clash alert is still sitting in the panel. What clears it out of the list?",
            "options": [
              "Its Dismiss button",
              "Mark all read",
              "Closing and reopening the panel"
            ],
            "correctIndex": 0,
            "explain": "Mark all read only clears the unread highlights — the alert stays in the list. Dismiss removes it, and because the clash is already fixed, it won’t come back."
          }
        },
        {
          "type": "complete",
          "title": "Alerts under control",
          "body": "You know where alerts arrive, what the main types mean, how to jump from an alert to the right page, and how to keep the list tidy with Mark all read and Dismiss.\n\nNext, meet **Opa**, the practice’s AI sidekick — what it can and can’t do, and how to use it well.",
          "next": "portal-opa-assistant"
        }
      ],
    },

    // ── 10. Inviting Therapists (Owner) ─────────────────────────────────────
    {
      key: 'portal-inviting-therapists',
      version: 1,
      title: 'Inviting Therapists',
      minutes: 5,
      roles: ['owner'],
      description: 'Bring a new team member on board: invite, role, approval and first sign-in.',
      thumb: '/assets/tutorials/portal-inviting-therapists.png',
      start: { tab: 'settings' },
      steps: [
        {
          "type": "intro",
          "title": "Growing the team",
          "body": "When someone new joins the practice, they don’t sign themselves up — you invite them. This walkthrough covers the whole journey: sending the invitation, choosing the right role, what the new person sees at their end, and approving their account so they can sign in.\n\nThese controls belong to the practice owner, so only you will see them."
        },
        {
          "type": "action",
          "target": ".settings-nav-item[data-section=\"user-management\"]",
          "route": {
            "tab": "settings"
          },
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Open Users & Roles",
          "body": "Team management lives in **Settings**, in the **Business** group of the side menu.\n\nClick **Users & Roles** to open it."
        },
        {
          "route": {
            "tab": "settings",
            "section": "user-management"
          },
          "type": "highlight",
          "target": "#stg-user-list",
          "pad": 6,
          "rounded": "10px",
          "title": "Team Members",
          "body": "Everyone with an account is listed here with their role and a status badge: **Active**, **Pending email** (they haven’t verified their address yet), **Pending approval** (waiting on you), **Suspended** or **Deactivated**.\n\nSmall flags like **No calendar** or **No location** point out members whose setup isn’t finished. Accounts that need your attention sort to the top."
        },
        {
          "type": "action",
          "target": "settings-invite-user",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Start an invitation",
          "body": "Click **+ Invite team member** to open the invitation form. Opening it sends nothing, so it’s safe to have a look around.\n\nThe first field is their **email address** — the invitation is locked to that exact address, so check the spelling. The name is optional."
        },
        {
          "route": {
            "tab": "settings",
            "section": "user-management",
            "open": "invite-modal"
          },
          "type": "highlight",
          "target": "#invite-role",
          "pad": 6,
          "rounded": "8px",
          "title": "Choose their role",
          "body": "The role decides what they can see and do:\n\n**Therapist** — their own calendar and schedule, and their own travel records.\n\n**Admin** — whole-team scheduling and travel, but no billing, business settings or team management.\n\n**Read-only** — can view calendars and records but can’t change anything.\n\n**Owner** — full control of the practice, including this screen. Hand it out sparingly."
        },
        {
          "type": "highlight",
          "target": "#invite-treating-wrap",
          "pad": 6,
          "rounded": "8px",
          "title": "Treating therapist",
          "body": "Leave this ticked for anyone who sees clients. When they register, their therapist profile is created automatically, so they arrive with a working calendar of their own.\n\nIt only counts when the role is **Therapist** — for other roles the box is simply ignored."
        },
        {
          "type": "highlight",
          "target": "#invite-expires",
          "pad": 6,
          "rounded": "8px",
          "title": "The link has a shelf life",
          "body": "The invitation link works for **3, 7 or 14 days** — 7 is the usual choice. After that it stops working and the invitation shows as expired.\n\nNo drama if that happens: you can simply send them a fresh invitation."
        },
        {
          "type": "action",
          "target": "invite-modal-close",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Don’t send this one",
          "body": "**Send invite** emails the person a registration link straight away. If the practice’s email isn’t set up (or the send fails), the portal never pretends it went out — it shows you the link with a **Copy link** button so you can pass it on yourself, by phone or Teams.\n\nWe’re not inviting anyone today, so click **Cancel** to close the form."
        },
        {
          "type": "screenshot",
          "title": "What your invitee sees",
          "image": {
            "src": "/assets/tutorials/portal-inviting-therapists/register-invited.png",
            "alt": "The registration page showing an invitation confirmed for the invitee, with their role, locked email address, password rules and the Create account button."
          },
          "body": "Their email invites them to the practice with a **Create my account** button. The link opens this registration page: their email address is already filled in and locked, their role is shown, and they choose a password — at least 8 characters with an uppercase letter, a lowercase letter and a number.\n\nAfter **Create account**, the portal emails them a verification link to prove the address is really theirs."
        },
        {
          "type": "highlight",
          "target": "#stg-user-list",
          "pad": 6,
          "rounded": "10px",
          "title": "Approve the new account",
          "body": "Here’s the step people forget: even after verifying their email, a new account **waits for your approval**. If they try to sign in, they see a pending-approval screen — they’re not stuck, they’re waiting for you.\n\nBack here, a banner appears and their row shows **Pending approval** with an **Approve** button. Approve, and they can sign in straight away. Their first sign-in runs a short setup wizard — their details, connecting Outlook, and their work location."
        },
        {
          "type": "highlight",
          "target": "#stg-pending-invites-wrap",
          "pad": 6,
          "rounded": "10px",
          "title": "Keeping track of invitations",
          "body": "Invitations you’ve sent are listed under **Pending Invites** with the role and expiry date.\n\nFor an invitation that’s still open: **Resend** emails the same link again, **Copy link** puts it on your clipboard to share yourself, and **Revoke** kills the link for good — use it if an invitation went out by mistake. Note that **Resend won’t revive an expired link** — for those, send a fresh invitation instead."
        },
        {
          "type": "highlight",
          "target": "#stg-team-setup-wrap",
          "pad": 6,
          "rounded": "10px",
          "title": "Team setup status",
          "body": "This panel tracks each member’s setup at a glance: account, onboarding, and — for therapists — their profile and Splose link, plus whether their **Outlook** mailbox is connected (it shows which address, never any passwords) and whether their travel base is set.\n\nIf something’s missing, a fix-up button appears right here — for example **Create profile** for a therapist without a calendar identity yet."
        },
        {
          "type": "quiz",
          "title": "Quick check",
          "quiz": {
            "question": "A new therapist has registered and verified their email, but says they still can’t sign in. What’s the missing step?",
            "options": [
              "They need to connect Outlook first",
              "You need to approve their account in Users & Roles",
              "They need to be sent a second invite link"
            ],
            "correctIndex": 1,
            "explain": "Every new account waits for the owner’s approval. Open Settings → Users & Roles and press Approve on their row — they can sign in the moment you do."
          }
        },
        {
          "type": "complete",
          "title": "Your team, sorted",
          "body": "You can now invite a new team member, pick the right role, follow their progress from invitation to first sign-in, and approve them when they’re ready.\n\nOne last stop: meet **Opa**, the practice’s assistant.",
          "next": "portal-opa-assistant"
        }
      ],
    },

    // ── 11. Meet Opa (AI assistant) ─────────────────────────────────────────
    {
      key: 'portal-opa-assistant',
      version: 1,
      title: 'Meet Opa, Your Practice Sidekick',
      minutes: 4,
      roles: ALL_ROLES,
      description: 'What the Opa assistant can and cannot do, and how to use it responsibly.',
      thumb: '/assets/tutorials/portal-opa-assistant.png',
      start: { tab: 'calendar', closeOpaPanel: true },
      steps: [
        {
          "type": "intro",
          "title": "Meet Opa",
          "body": "Opa is the Portal’s built-in assistant — a chat helper that explains how things work, right where you’re working.\n\nThis short module shows you where Opa lives, what it can and can’t do, and how to use it safely. Nothing in this walkthrough sends a message or changes anything."
        },
        {
          "type": "highlight",
          "target": "#opa-fab",
          "route": {
            "tab": "calendar"
          },
          "pad": 6,
          "rounded": "50%",
          "title": "The Opa button",
          "body": "Opa lives behind this floating button in the bottom-right corner — it follows you to every page of the Portal.\n\nOne thing to know: the little pebble up in the top bar just says hello. It’s this floating button that opens the actual assistant.",
          "image": {
            "src": "/assets/tutorials/portal-opa/fab.png",
            "alt": "The floating Opa button in the bottom-right corner of the portal"
          }
        },
        {
          "type": "action",
          "target": "#opa-fab",
          "advance": "click",
          "pad": 6,
          "rounded": "50%",
          "title": "Open the panel",
          "body": "Click the button to open Opa’s chat panel. This is completely safe — opening the panel doesn’t send any message."
        },
        {
          "route": {
            "open": "opa"
          },
          "type": "highlight",
          "target": ".opa-head-btns",
          "pad": 4,
          "rounded": "8px",
          "title": "The panel controls",
          "body": "**+** starts a fresh chat, **−** tucks the panel away, **□** grows it to fill most of the screen and **×** closes it. Minimising or closing doesn’t lose your conversation — open Opa again and it’s still there.\n\nOn a computer you can drag the panel by its header to move it, or drag the bottom-right corner to resize it — Opa remembers your preferred spot. Pressing **Escape** while you’re in the panel closes it too."
        },
        {
          "type": "highlight",
          "target": ".opa-suggestions",
          "pad": 6,
          "rounded": "12px",
          "title": "Suggestion prompts",
          "body": "When a chat is empty, Opa offers a few ready-made questions. They change to suit the page you’re on and your role — an owner sees prompts a therapist doesn’t.\n\nClicking one doesn’t send it. It just pops the words into the message box so you can adjust them first, then send when you’re ready.",
          "image": {
            "src": "/assets/tutorials/portal-opa/suggestions.png",
            "alt": "Opa’s empty chat showing the greeting and suggestion prompts"
          }
        },
        {
          "type": "highlight",
          "target": ".opa-composer",
          "roles": [
            "owner",
            "admin",
            "therapist"
          ],
          "pad": 4,
          "rounded": "12px",
          "title": "Asking a question",
          "body": "Type your question in plain English in the **Ask Opa anything...** box. Press **Enter** (or the arrow button) to send; **Shift+Enter** starts a new line.\n\nWhile Opa is thinking you’ll see a **Stop** button if you change your mind. We won’t send a message during this walkthrough — try a question of your own once you finish."
        },
        {
          "type": "callout",
          "roles": [
            "read_only"
          ],
          "title": "A note for read-only accounts",
          "body": "Your account is read-only, so Opa can’t answer messages for you — if you send one, you’ll see an error instead of an answer.\n\nYou can still open the panel and browse the suggestions, and the rest of this module shows what Opa does for your colleagues."
        },
        {
          "type": "screenshot",
          "title": "What a good answer looks like",
          "image": {
            "src": "/assets/tutorials/portal-opa/answer.png",
            "alt": "An Opa answer showing the Based on line, a navigation button and the Copy button"
          },
          "body": "Opa answers questions about how the Portal works: booking, the calendar, Outlook sync, the Resource Hub, your profile and more. Its answers come from a guide the practice writes and keeps up to date — the **Based on:** line under an answer shows which topics it drew from.\n\nAnswers respect your role, so Opa won’t walk you through screens your account can’t open. Sometimes it offers a button that jumps you straight to the right tab, and every answer has a **Copy** button."
        },
        {
          "type": "callout",
          "title": "What Opa can’t do",
          "body": "Opa can’t see live information — it doesn’t read your calendar, appointments, client records or documents. It can’t look up or fetch actual resources either; for those it points you to the Resource Hub.\n\nAnd it never changes anything: no bookings, edits or deletions. The most it can do is jump you to another tab. If Opa isn’t sure something exists in the Portal, it tells you it can’t confirm — that honesty is deliberate."
        },
        {
          "type": "warning",
          "title": "Keep client details out of the chat",
          "body": "Opa never needs a client’s name, address or clinical details to explain how the Portal works — so leave them out of your messages. Opa is built to never repeat identifying details, but the safest detail is the one you never type.\n\nYour chats are stored privately against your own account, and the practice’s records show only that a chat happened — never what was said. All of Opa’s AI processing happens in Australia."
        },
        {
          "type": "callout",
          "title": "When Opa says no",
          "body": "If a question strays outside helping with the Portal, Opa replies: **“I can't help with that one. Try asking about how the Portal works, or check with your practice lead.”** That answer is final — sending the same question again won’t change it, but rewording it so it’s about the Portal usually will.\n\nOther messages are just temporary: if Opa says it couldn’t reach its knowledge service, or asks you to wait a moment after lots of messages in a row, simply try again shortly."
        },
        {
          "type": "callout",
          "title": "Check before you rely on it",
          "body": "Opa is a guide, not the final word — AI answers can occasionally be out of date or simply wrong. For anything important, double-check against the Resource Hub or with your practice lead.\n\nSpotted a wrong or odd answer? Use **Copy** under the answer, then report it through **Support** with the copied text so it can be fixed for everyone."
        },
        {
          "type": "action",
          "target": "opa-close",
          "advance": "click",
          "pad": 4,
          "rounded": "8px",
          "title": "Close the panel",
          "body": "Click the **×** to close Opa — the floating button comes back, ready whenever you need it.\n\nOpa keeps your conversation as you move around the Portal. If you refresh the browser or sign out, your next chat starts fresh."
        },
        {
          "type": "quiz",
          "title": "Quick check",
          "quiz": {
            "question": "You want Opa’s help understanding how to record travel for a client visit. What should your message look like?",
            "options": [
              "Include the client’s name and address so Opa has the full picture",
              "Ask how the Travel Logbook works, without any client details",
              "Ask Opa to open the client’s record for you"
            ],
            "correctIndex": 1,
            "explain": "Opa explains how the Portal works — it never needs client details, and it can’t open records anyway. Keep identifying details out of the chat."
          }
        },
        {
          "type": "complete",
          "title": "You and Opa are acquainted",
          "body": "You know how to open Opa, what it can genuinely help with, what it deliberately won’t do, and the habits that keep client information safe.\n\nThat’s the final module of the induction — well done. Everything you’ve covered lives in the Resource Hub whenever you need a refresher."
        }
      ],
    },
  ];

  // ── Pure helpers ──────────────────────────────────────────────────────────

  function moduleByKey(key) {
    for (var i = 0; i < MODULES.length; i++) {
      if (MODULES[i].key === key) return MODULES[i];
    }
    return null;
  }

  /** Modules a role may take, in induction order. Unknown role → none. */
  function modulesForRole(role) {
    var r = String(role || '');
    return MODULES.filter(function (m) { return m.roles.indexOf(r) !== -1; });
  }

  /** Steps of a module a role actually sees (per-step roles narrow further). */
  function stepsForRole(mod, role) {
    if (!mod) return [];
    var r = String(role || '');
    return (mod.steps || []).filter(function (s) {
      return !s.roles || s.roles.indexOf(r) !== -1;
    });
  }

  /**
   * The dashboard status of one module given its server progress row.
   * Returns: 'not_started' | 'in_progress' | 'completed' | 'updated'
   * ('updated' = completed on an older version — completion stays valid,
   * the card invites a review of what changed.)
   */
  function moduleState(mod, row) {
    if (!row) return 'not_started';
    if (row.status === 'completed') {
      var done = Number(row.completed_version || row.version || 0);
      return done < mod.version ? 'updated' : 'completed';
    }
    return 'in_progress';
  }

  var api = {
    MODULES: MODULES,
    moduleByKey: moduleByKey,
    modulesForRole: modulesForRole,
    stepsForRole: stepsForRole,
    moduleState: moduleState,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.OpalInductionModules = api;

})(typeof window !== 'undefined' ? window : null);
