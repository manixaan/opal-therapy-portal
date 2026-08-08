/**
 * SEED OPA APPLICATION KNOWLEDGE
 *
 * Populates opa_feature_knowledge — the Opa assistant's ONLY source of claims
 * about the Portal. Every record below was written against the REAL app
 * (frontend/current/mockup_v3.html navigation + flows, and the backend route
 * modules: scheduler-routes, resource-hub-r2-routes, resources-routes,
 * accounting-routes, profile-routes, invite-routes, travel-routes,
 * snapshot-routes, ai-drafts-routes, purchases-routes, server.js delta sync).
 * Honesty is the point: partial features carry their caveat in the summary,
 * and nothing planned or aspirational is described as live.
 *
 * Idempotent: upserts ON CONFLICT (module, feature). Safe to re-run after
 * editing records — summaries/instructions/etc are updated in place.
 *
 *   node backend/setup/seed-opa-knowledge.js          # seed / refresh
 *   node backend/setup/seed-opa-knowledge.js --clean  # delete ALL records
 *
 * Requires migration 012_opa_ai.sql to be applied.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'therapy_scheduler',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
});

// ── Records ──────────────────────────────────────────────────────────────────
// Shape: { module, feature, route, summary, status, minimum_role, aliases,
//          instructions, troubleshooting, related_features }
// status defaults to 'live'; minimum_role defaults to null (everyone).

const RECORDS = [

  // ═══ Calendar ══════════════════════════════════════════════════════════════
  {
    module: 'calendar', feature: 'Calendar day, week and month views', route: '/calendar',
    summary: 'The Calendar tab shows your appointments in Day, Week or Month view. Owners and admins can also open the Master view across therapists. Weekends can be shown or hidden from Settings.',
    aliases: ['calendar views', 'week view', 'month view', 'day view'],
    instructions: [
      'Open the Calendar tab in the left navigation.',
      'Use the view switcher at the top of the calendar to change between Day, Week and Month.',
      'Use the arrows next to the date heading to move between days, weeks or months.',
    ],
    troubleshooting: [
      'If Saturday and Sunday are missing from Week view, the Show weekends toggle is off in Settings under Calendar Settings.',
    ],
    related_features: ['Add a calendar event', 'Weekend display'],
  },
  {
    module: 'calendar', feature: 'Add a calendar event', route: '/calendar',
    summary: 'Create an event directly on the calendar (meetings, admin blocks and similar). Client appointments are best created through Smart Booking, which also writes to Splose or Outlook.',
    aliases: ['add event', 'new event', 'create event'],
    instructions: [
      'Open the Calendar tab.',
      'Click an empty time slot on the day you want (or use the add button in the calendar toolbar).',
      'Fill in the event details and save.',
    ],
    troubleshooting: [
      'If Outlook is not connected, the event is added to the app calendar only — connect Outlook from Settings, Integrations to have events written to your Outlook calendar.',
    ],
    related_features: ['Smart Booking appointment creation', 'Connect Outlook'],
  },
  {
    module: 'calendar', feature: 'Weekend display', route: '/calendar',
    summary: 'Week view can include or hide Saturday and Sunday. The toggle lives in Settings, not on the calendar itself.',
    aliases: ['show weekends', 'hide weekends', 'weekend columns'],
    instructions: [
      'Open the Settings tab.',
      'Choose Calendar Settings in the settings navigation.',
      'Turn the Show weekends toggle on or off.',
    ],
    troubleshooting: [],
    related_features: ['Calendar day, week and month views', 'Calendar defaults and working hours'],
  },
  {
    module: 'calendar', feature: 'Splose appointment import', route: '/calendar', status: 'partial',
    summary: 'PARTIAL: Splose data flows one way into the Portal. Appointments are imported read-only and cancellations in Splose are detected by a background poller so the calendars converge. The Portal does not edit existing Splose appointments; the only write toward Splose is creating a new appointment through Smart Booking.',
    aliases: ['splose', 'splose sync', 'splose import'],
    instructions: [
      'No setup is needed — Splose appointments appear on the Calendar automatically once the practice connection is configured by the owner.',
      'To create a new Splose appointment from the Portal, use the Smart Booking tab.',
    ],
    troubleshooting: [
      'If a Splose appointment is missing, check you are on the right week and check the sync status pill in the header for the last successful sync.',
      'Changes made to an appointment inside Splose can take a sync cycle to appear in the Portal.',
    ],
    related_features: ['Smart Booking appointment creation', 'Outlook sync status'],
  },
  {
    module: 'calendar', feature: 'Master Scheduler matrix', route: '/calendar', minimum_role: 'admin',
    summary: 'The Master Scheduler (Scheduler tab inside Calendar, owner/admin only) shows therapists down the left and time across the top for one day. Tick checkboxes to compare selected therapists, then drag on the timeline to place a proposed slot band you can move and resize. Duration, discipline and suburb controls refine the search.',
    aliases: ['master scheduler', 'scheduler', 'availability matrix', 'compare therapists'],
    instructions: [
      'Open the Calendar tab and switch to the Scheduler view (owner and admin roles only).',
      'Pick the day you want to schedule.',
      'Tick the checkboxes next to therapists to compare their availability.',
      'Drag on the timeline to create a proposed slot band; drag its edges to resize, or drag the band to move it.',
      'Adjust the duration, discipline and suburb controls to refine what counts as a workable slot.',
    ],
    troubleshooting: [
      'If the Scheduler view is not visible, your role is not owner or admin — the Master Scheduler is restricted to those roles.',
    ],
    related_features: ['Scheduler candidate recommendations', 'Scheduler inspector'],
  },
  {
    module: 'calendar', feature: 'Scheduler candidate recommendations', route: '/calendar', minimum_role: 'admin',
    summary: 'From a proposed slot, Recommend ranks candidate therapists using their availability and travel feasibility between surrounding appointments, so you can see who genuinely fits the slot rather than who merely has white space.',
    aliases: ['recommend candidates', 'recommendations', 'who can take this client', 'travel feasibility'],
    instructions: [
      'In the Master Scheduler, place a proposed slot band on the timeline.',
      'Set the duration, discipline and client suburb so travel can be assessed.',
      'Choose Recommend to rank candidate therapists for that slot.',
      'Review each candidate’s feasibility notes before booking.',
    ],
    troubleshooting: [
      'Candidates depend on therapist working hours and existing events being up to date — check the therapist’s work schedule if results look wrong.',
    ],
    related_features: ['Master Scheduler matrix', 'Scheduler inspector'],
  },
  {
    module: 'calendar', feature: 'Scheduler inspector', route: '/calendar', minimum_role: 'admin',
    summary: 'A contextual inspector beside the Master Scheduler shows a map of the day’s suburbs and travel context, plus therapist details for whoever you select, so scheduling decisions can weigh geography without leaving the page.',
    aliases: ['map inspector', 'therapist inspector', 'scheduler map'],
    instructions: [
      'Open the Master Scheduler and select therapists or a proposed slot.',
      'Use the inspector panel to switch between the map view and therapist details.',
    ],
    troubleshooting: [],
    related_features: ['Master Scheduler matrix', 'Scheduler candidate recommendations'],
  },
  {
    module: 'calendar', feature: 'Snapshot report and daily tasks', route: '/calendar',
    summary: 'The Snapshot button in the header opens the Daily and Weekly Snapshot: your day at a glance with personal reminders, a daily task list and a work section. Reminders and tasks are private to you — no other role can see them.',
    aliases: ['snapshot', 'daily snapshot', 'reminders', 'daily tasks'],
    instructions: [
      'Click the Snapshot button in the header (calendar icon next to notifications).',
      'Review the work section for your day, then add or tick off reminders and tasks.',
      'Reminders can be completed, dismissed, deferred or reopened; tasks can be reordered.',
    ],
    troubleshooting: [],
    related_features: ['Notifications bell and alerts'],
  },

  // ═══ Smart Booking ═════════════════════════════════════════════════════════
  {
    module: 'book', feature: 'Smart Booking appointment creation', route: '/book',
    summary: 'Smart Booking is a single form for creating an appointment: choose a booking type, pick the patient where relevant, set When & Where, then Create appointment. Depending on the booking type it writes a real Splose appointment or an Outlook calendar block.',
    aliases: ['smart booking', 'create appointment', 'book appointment', 'new booking'],
    instructions: [
      'Open the Smart Booking tab.',
      'Choose a booking type from the grouped options at the top.',
      'Select the patient if the booking type needs one.',
      'In the When & Where section choose the day, start time and location.',
      'Click Create appointment.',
    ],
    troubleshooting: [
      'If Create appointment complains about a missing time, set a day and start time in the When & Where section first.',
      'If Outlook is not connected, Outlook-type blocks are added to the app calendar only.',
    ],
    related_features: ['Booking types', 'Connect Outlook'],
  },
  {
    module: 'book', feature: 'Booking types', route: '/book',
    summary: 'Booking types are grouped categories on the Smart Booking form (client sessions and non-client blocks). The type decides what details are asked for and whether the result is written to Splose as an appointment or to Outlook as a block — there is no separate session-type step.',
    aliases: ['booking types', 'appointment types', 'session type'],
    instructions: [
      'Open the Smart Booking tab.',
      'Read the grouped booking type cards and pick the one that matches your session.',
      'The rest of the form adapts to the chosen type.',
    ],
    troubleshooting: [],
    related_features: ['Smart Booking appointment creation'],
  },

  // ═══ Resource Hub (R2) ═════════════════════════════════════════════════════
  {
    module: 'resources', feature: 'Resource Hub home, search and collections', route: '/resources',
    summary: 'The Resource Hub home page surfaces curated collections (shelves such as Start Here), recents and search across approved resources — articles, policies, tutorials, external links and learning modules. Note: Opa cannot search resources for you yet; use the Hub’s own search.',
    aliases: ['resource hub', 'find a resource', 'search resources', 'collections'],
    instructions: [
      'Open the Resources tab.',
      'Browse the collection shelves on the home page, or type in the search bar to search approved resources.',
      'Open a resource to read its detail page.',
    ],
    troubleshooting: [
      'Only APPROVED resources appear for therapists — a resource still in draft or review is visible to its author and the owner only.',
    ],
    related_features: ['Favourites and completion', 'Learning paths and starter kits'],
  },
  {
    module: 'resources', feature: 'Favourites and completion', route: '/resources',
    summary: 'Any resource can be favourited for quick access, and learning-style resources can be marked complete so your progress is tracked. Favourites and completion are personal to you.',
    aliases: ['favourites', 'save resource', 'mark complete', 'progress'],
    instructions: [
      'Open a resource in the Resource Hub.',
      'Use the favourite (star) control to save it to your favourites.',
      'For learning resources, use Mark complete when you have finished it.',
    ],
    troubleshooting: [],
    related_features: ['Resource Hub home, search and collections', 'CPD tracker'],
  },
  {
    module: 'resources', feature: 'Learning paths and starter kits', route: '/resources',
    summary: 'Learning paths are curated sequences of resources (for example a new-therapist starter kit). Each path lists its items in order with required steps, and your completion is tracked per resource.',
    aliases: ['learning paths', 'starter kit', 'new therapist kit', 'onboarding path'],
    instructions: [
      'Open the Resources tab and find the Learning section.',
      'Choose a learning path to see its ordered items.',
      'Work through the items, marking each complete as you finish.',
    ],
    troubleshooting: [],
    related_features: ['Favourites and completion'],
  },
  {
    module: 'resources', feature: 'Policy acknowledgement', route: '/resources',
    summary: 'Policies in the Resource Hub can require acknowledgement. Acknowledgements are recorded per person per policy version and are never overwritten — when a policy is updated materially, a fresh acknowledgement is requested.',
    aliases: ['acknowledge policy', 'policy sign off', 'policies'],
    instructions: [
      'Open the policy from the Resource Hub.',
      'Read it, then click the acknowledge control on the policy page.',
      'Your acknowledgement is recorded against that version of the policy.',
    ],
    troubleshooting: [
      'If you are asked to acknowledge a policy you have already acknowledged, the policy has likely been updated to a new version.',
    ],
    related_features: ['Resource Hub home, search and collections'],
  },
  {
    module: 'resources', feature: 'CPD tracker', route: '/resources',
    summary: 'A lightweight, practitioner-owned CPD tracker in the Resource Hub: log activities with date, provider, hours (including interactive hours), reflection and competency area, and see a summary of your hours. Informational — it does not submit anything to AHPRA or professional bodies.',
    aliases: ['cpd tracker', 'cpd hours', 'log cpd', 'cpd'],
    instructions: [
      'Open the Resources tab and go to the CPD section.',
      'Add an entry with the activity, date, provider and hours.',
      'Optionally record a reflection and competency area, and check your running summary.',
    ],
    troubleshooting: [],
    related_features: ['PD events directory', 'Profile CPD records'],
  },
  {
    module: 'resources', feature: 'PD events directory', route: '/resources',
    summary: 'A directory of professional development events (online, in person or hybrid) with dates, provider, cost, CPD hours and registration links. Owners and admins maintain the listings.',
    aliases: ['pd events', 'professional development', 'training events', 'pd'],
    instructions: [
      'Open the Resources tab and go to the PD events section.',
      'Browse upcoming events and open the registration link for any that interest you.',
    ],
    troubleshooting: [],
    related_features: ['CPD tracker'],
  },
  {
    module: 'resources', feature: 'Submit a resource for review', route: '/resources',
    summary: 'Therapists can draft a resource and submit it for review; the owner reviews and approves before it becomes visible to everyone. Nothing you draft is published without approval.',
    aliases: ['submit resource', 'draft resource', 'resource review'],
    instructions: [
      'In the Resource Hub, create a new resource — as a therapist it is saved as a draft.',
      'Complete the details, then submit it for review.',
      'The owner reviews it; once approved it appears in the Hub for all staff.',
    ],
    troubleshooting: [
      'Therapists cannot approve resources — approval is an owner function. If your draft is pending, the owner has not reviewed it yet.',
    ],
    related_features: ['Resource Hub admin centre', 'AI Resource Studio drafts'],
  },
  {
    module: 'resources', feature: 'Resource Hub admin centre', route: '/resources', minimum_role: 'admin',
    summary: 'The admin centre manages Resource Hub content: admins can author and edit unapproved resources, manage PD events and quick links, and view aggregate analytics. Approving, publishing, archiving and policy versioning are owner-only.',
    aliases: ['resource admin', 'admin centre', 'manage resources', 'approve resources'],
    instructions: [
      'Open the Resources tab — the admin centre controls appear for owner and admin roles.',
      'Create or edit draft content, manage PD events and quick links.',
      'Owners additionally approve, archive and version policies from here.',
    ],
    troubleshooting: [
      'Admins cannot approve or publish — if a resource needs approval, the owner must do it.',
    ],
    related_features: ['Submit a resource for review'],
  },
  {
    module: 'resources', feature: 'AI Resource Studio drafts', route: '/resources', status: 'partial',
    summary: 'PARTIAL: the AI Resource Studio is a local drafting workspace with a review flow (draft, submit, owner approve/decline). AI generation is NOT enabled — there are no external AI calls; drafts are written by you. Approved drafts publish into the Resource Hub.',
    aliases: ['ai resource studio', 'ai drafts', 'resource studio'],
    instructions: [
      'Open the Resource Studio from the Resources tab.',
      'Create a draft and edit its content yourself.',
      'Submit the draft for review; the owner can approve it into the Hub.',
    ],
    troubleshooting: [
      'There is no generate-with-AI button that produces content — generation is planned behind a disabled flag, and the Studio currently works as a structured drafting tool.',
    ],
    related_features: ['Submit a resource for review'],
  },
  {
    module: 'resources', feature: 'Therapy Store purchase requests', route: '/resources',
    summary: 'A governed request workflow for therapy materials: therapists raise and submit purchase requests, the owner approves or declines, and orders are marked ordered and received. Every status change is recorded.',
    aliases: ['therapy store', 'purchase request', 'order materials', 'buy resources'],
    instructions: [
      'Open the Therapy Store area in the Resources tab.',
      'Create a purchase request with the item details and rationale, then submit it.',
      'Track its status — the owner approves or declines, and marks items ordered and received.',
    ],
    troubleshooting: [
      'Therapists see their own requests only. Admins see approved and later-stage requests for operational handling; approval itself is owner-only.',
    ],
    related_features: [],
  },

  // ═══ Travel ════════════════════════════════════════════════════════════════
  {
    module: 'travel', feature: 'Travel Logbook', route: '/logbook',
    summary: 'The Travel Logbook lists travel entries assembled from Splose appointment data for a selected financial year. Owners and admins see the whole practice; therapists see only their own trips. Read-only toward Splose.',
    aliases: ['travel logbook', 'logbook', 'kilometres', 'trips'],
    instructions: [
      'Open the Logbook tab.',
      'Choose the financial year at the top to set the reporting window.',
      'Review your trips with their addresses and distances.',
    ],
    troubleshooting: [
      'Therapists must be mapped to their Splose practitioner to see trips — if your logbook is unexpectedly empty, ask the owner to check your practitioner mapping.',
    ],
    related_features: ['Trip address overrides'],
  },
  {
    module: 'travel', feature: 'Trip address overrides', route: '/logbook',
    summary: 'Individual logbook entries can have their from/to addresses corrected with local overrides — useful when the Splose record has a wrong or missing address. Overrides live in the Portal only; Splose is never modified.',
    aliases: ['fix trip address', 'address override', 'edit trip'],
    instructions: [
      'Open the Logbook tab and find the trip.',
      'Edit the trip’s addresses to set a corrected from or to address.',
      'The override is saved locally and used for distance reporting.',
    ],
    troubleshooting: [],
    related_features: ['Travel Logbook'],
  },

  // ═══ Accounting (owner-only) ═══════════════════════════════════════════════
  {
    module: 'accounting', feature: 'Accounting dashboard', route: '/accounting', minimum_role: 'owner',
    summary: 'Owner-only finance overview: Xero connection state, sync activity, invoice candidate counts and exceptions needing attention. Admins and therapists have no access to any accounting data.',
    aliases: ['accounting dashboard', 'finance overview', 'accounting'],
    instructions: [
      'Open the Accounting tab (visible to the owner only).',
      'Review the dashboard tiles for connection status, candidates and exceptions.',
    ],
    troubleshooting: [],
    related_features: ['Xero connection', 'Invoice candidates and draft invoices'],
  },
  {
    module: 'accounting', feature: 'Xero connection', route: '/accounting', minimum_role: 'owner',
    summary: 'The Portal connects to Xero via OAuth for the owner. Connection status, token refresh, disconnect and a read sync of contacts, invoices, payments, accounts and items are available. Any write toward Xero is fail-closed behind explicit flags.',
    aliases: ['xero', 'connect xero', 'xero status'],
    instructions: [
      'Open the Accounting tab.',
      'Check the Xero connection status panel.',
      'Use Connect to start the Xero sign-in, or Disconnect to remove the connection.',
      'Run a sync to refresh Xero data in the Portal.',
    ],
    troubleshooting: [
      'If Xero data looks stale, run a sync and check the sync log for errors.',
      'If the connection has expired, disconnect and connect again to re-authorise.',
    ],
    related_features: ['Accounting dashboard', 'Invoice candidates and draft invoices'],
  },
  {
    module: 'accounting', feature: 'Invoice candidates and draft invoices', route: '/accounting', minimum_role: 'owner', status: 'partial',
    summary: 'PARTIAL: the Portal generates invoice candidates from appointment data for owner review (approve, decline, override). Creating an actual DRAFT invoice in Xero is gated behind an explicit flag and only ever happens on a deliberate owner action — by default nothing is written to Xero.',
    aliases: ['invoices', 'invoice candidates', 'draft invoice', 'billing'],
    instructions: [
      'Open the Accounting tab and go to the candidates list.',
      'Generate candidates, then review each one and approve or decline it.',
      'If draft-invoice creation is enabled for the practice, an approved candidate can be pushed to Xero as a draft invoice.',
    ],
    troubleshooting: [
      'If the create-draft-invoice action is unavailable, the write flag is not enabled — candidate review still works.',
    ],
    related_features: ['Xero connection', 'Reconciliation review'],
  },
  {
    module: 'accounting', feature: 'Reconciliation review', route: '/accounting', minimum_role: 'owner', status: 'partial',
    summary: 'PARTIAL: the Portal matches appointments against Xero invoices and payments and presents discrepancies for the owner to decide on. Decisions are recorded in the Portal; reconciliation reads from Xero and does not write back.',
    aliases: ['reconciliation', 'exceptions', 'mismatches'],
    instructions: [
      'Open the Accounting tab and go to the reconciliation or exceptions view.',
      'Refresh to regenerate the current mismatch list.',
      'Work through each item and record a decision.',
    ],
    troubleshooting: [],
    related_features: ['Invoice candidates and draft invoices'],
  },

  // ═══ Profile ═══════════════════════════════════════════════════════════════
  {
    module: 'profile', feature: 'Profile document uploads', route: '/profile',
    summary: 'Upload and manage your own documents (certifications, checks and similar) from My Profile. Files are private, stored securely and downloadable only through authenticated requests.',
    aliases: ['upload documents', 'my documents', 'certificates'],
    instructions: [
      'Open the My Profile tab.',
      'Go to the Documents section.',
      'Upload the file and give it the right document type; download or remove it any time.',
    ],
    troubleshooting: [
      'Uploads are validated by type and size — if an upload is rejected, check the file format and try a smaller file.',
    ],
    related_features: ['Profile credentials and CPD records'],
  },
  {
    module: 'profile', feature: 'Work schedule', route: '/profile',
    summary: 'Your working hours per weekday live in My Profile. The Master Scheduler and availability views respect these hours, so keeping them accurate improves scheduling for everyone.',
    aliases: ['work schedule', 'working hours', 'my hours'],
    instructions: [
      'Open the My Profile tab.',
      'Go to the Work Schedule section.',
      'Set your start and finish times for each working day and save.',
    ],
    troubleshooting: [
      'If the Scheduler shows you unavailable at times you work, your work schedule hours are probably out of date.',
    ],
    related_features: ['Master Scheduler matrix'],
  },
  {
    module: 'profile', feature: 'Leave requests', route: '/profile',
    summary: 'Request leave from My Profile; the owner approves or rejects it. Approved leave blocks out your availability in scheduling views.',
    aliases: ['leave request', 'annual leave', 'time off'],
    instructions: [
      'Open the My Profile tab.',
      'Go to the Leave section and create a request with the dates and type.',
      'Track its status — the owner approves or rejects requests.',
    ],
    troubleshooting: [],
    related_features: ['Work schedule'],
  },
  {
    module: 'profile', feature: 'Profile credentials and CPD records', route: '/profile',
    summary: 'My Profile keeps your professional credentials (with verification by the practice) and formal CPD activity records with an approval flow. This sits alongside the lighter self-tracked CPD tracker in the Resource Hub.',
    aliases: ['credentials', 'registration', 'cpd records'],
    instructions: [
      'Open the My Profile tab.',
      'Add credentials in the Credentials section; the practice can verify them.',
      'Record CPD activities in the CPD section; the owner can approve entries.',
    ],
    troubleshooting: [],
    related_features: ['CPD tracker', 'Profile document uploads'],
  },

  // ═══ Settings & administration ═════════════════════════════════════════════
  {
    module: 'settings', feature: 'Connect Outlook', route: '/settings',
    summary: 'Connect your Microsoft Outlook calendar from Settings, Integrations. After the Microsoft sign-in, the Portal syncs your calendar continuously (delta sync roughly every 90 seconds) and the header sync pill shows the connection and last-sync state.',
    aliases: ['connect outlook', 'microsoft calendar', 'sync my calendar', 'outlook'],
    instructions: [
      'Open the Settings tab.',
      'Choose Integrations in the settings navigation.',
      'Click Connect Outlook and complete the Microsoft sign-in.',
      'Watch the sync pill in the header — it shows connected state and sync activity.',
    ],
    troubleshooting: [
      'If Outlook reports it is already connected or the connection misbehaves, use Disconnect in Settings, Integrations and then Connect Outlook again.',
      'If an appointment is not showing, check you are on the right week and check the sync pill — a delta sync runs about every 90 seconds, so very recent Outlook changes can take a moment.',
    ],
    related_features: ['Calendar day, week and month views', 'Smart Booking appointment creation'],
  },
  {
    module: 'settings', feature: 'Invite a team member', route: '/settings', minimum_role: 'admin',
    summary: 'Owners and admins invite new team members from Settings: an email invitation with a secure link lets the person register into the practice with the right role. Pending invites are listed and can be resent or cancelled.',
    aliases: ['invite therapist', 'invite team member', 'add user', 'new staff'],
    instructions: [
      'Open the Settings tab and go to the Team section.',
      'Click Invite team member.',
      'Enter their email, name and role, then send the invite.',
      'Track it under Pending Invites — resend or cancel from there.',
    ],
    troubleshooting: [
      'Therapists cannot invite other therapists — ask an owner or admin.',
      'If an invite was not received, check the address and use Resend from the Pending Invites list.',
    ],
    related_features: ['User roles and deactivation'],
  },
  {
    module: 'settings', feature: 'User roles and deactivation', route: '/settings', minimum_role: 'owner',
    summary: 'The owner manages team roles (owner, admin, therapist, read-only) and can deactivate accounts. Deactivated users cannot sign in; their historical data remains. Role changes take effect on the user’s next request.',
    aliases: ['change role', 'deactivate user', 'manage users', 'permissions'],
    instructions: [
      'Open the Settings tab and go to the Team section (owner only).',
      'Choose the team member and change their role, or deactivate the account.',
    ],
    troubleshooting: [],
    related_features: ['Invite a team member'],
  },
  {
    module: 'settings', feature: 'Calendar defaults and working hours', route: '/settings',
    summary: 'Settings holds your calendar preferences: default booking type, show-weekends toggle, working-hours display and Snapshot targets. These are per-user preferences, separate from the work schedule the Scheduler uses.',
    aliases: ['calendar settings', 'default booking type', 'preferences'],
    instructions: [
      'Open the Settings tab.',
      'Choose Calendar Settings for view preferences and defaults.',
      'Adjust the options — changes apply immediately to your account.',
    ],
    troubleshooting: [],
    related_features: ['Weekend display', 'Work schedule'],
  },
  {
    module: 'settings', feature: 'Notifications bell and alerts', route: null,
    summary: 'The bell icon in the header shows your alerts; a red badge counts unread items. Open the panel to read alerts, mark individual items read, or Mark all read. Notification preferences live in Settings.',
    aliases: ['notifications', 'alerts', 'bell', 'mark read'],
    instructions: [
      'Click the bell icon in the header to open the Notifications panel.',
      'Click an alert to read it (this marks it read), or use Mark all read to clear the badge.',
      'Tune what you are notified about in Settings under Notification Settings.',
    ],
    troubleshooting: [],
    related_features: ['Snapshot report and daily tasks'],
  },
];

// ── Seeding ──────────────────────────────────────────────────────────────────

async function clean() {
  const { rowCount } = await pool.query('DELETE FROM opa_feature_knowledge');
  console.log(`Deleted ${rowCount} knowledge record(s).`);
}

async function seed() {
  let inserted = 0;
  let updated = 0;
  for (const r of RECORDS) {
    const res = await pool.query(
      `INSERT INTO opa_feature_knowledge
         (module, feature, route, summary, status, minimum_role,
          aliases, instructions, troubleshooting, related_features, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CURRENT_DATE)
       ON CONFLICT (module, feature) DO UPDATE SET
         route            = EXCLUDED.route,
         summary          = EXCLUDED.summary,
         status           = EXCLUDED.status,
         minimum_role     = EXCLUDED.minimum_role,
         aliases          = EXCLUDED.aliases,
         instructions     = EXCLUDED.instructions,
         troubleshooting  = EXCLUDED.troubleshooting,
         related_features = EXCLUDED.related_features,
         version          = opa_feature_knowledge.version + 1,
         reviewed_at      = CURRENT_DATE,
         updated_at       = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        r.module, r.feature, r.route || null, r.summary, r.status || 'live',
        r.minimum_role || null,
        JSON.stringify(r.aliases || []),
        JSON.stringify(r.instructions || []),
        JSON.stringify(r.troubleshooting || []),
        JSON.stringify(r.related_features || []),
      ]
    );
    if (res.rows[0].inserted) inserted++; else updated++;
  }

  const { rows } = await pool.query(
    `SELECT module, COUNT(*)::int AS n FROM opa_feature_knowledge GROUP BY module ORDER BY module`);
  const total = rows.reduce((s, r) => s + r.n, 0);
  console.log(`Seeded Opa knowledge: ${inserted} inserted, ${updated} updated, ${total} total.`);
  for (const r of rows) console.log(`  ${r.module.padEnd(12)} ${r.n}`);
}

(async () => {
  try {
    if (process.argv.includes('--clean')) await clean();
    else await seed();
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
})();
