/**
 * THERAPY SCHEDULER BACKEND
 *
 * What this does:
 * - Runs a server that listens for requests from your frontend (mockup_v3.html)
 * - Syncs events between: Your App ↔ Splose ↔ Outlook ↔ Teams
 * - Handles user authentication with Microsoft
 * - Stores event data in a database
 * - Sends real-time updates to connected clients
 */

// ===== PIN PROCESS TZ TO UTC =====
// Postgres `TIMESTAMP` columns are timezone-naive: the pg driver constructs
// JS Date objects from them using process.env.TZ. If the server runs in Perth
// local time, a UTC instant stored in Postgres comes back interpreted as a
// Perth wallclock, then the frontend converts it to Perth *again* — events
// end up 8 hours off. Pinning TZ=UTC keeps stored timestamps interpreted as
// UTC end-to-end, so the frontend's Australia/Perth conversion is the only
// timezone shift that ever runs. MUST be set before any other require().
process.env.TZ = 'UTC';

// ===== IMPORTS =====
// These are like loading tools from a toolbox before building

require('dotenv').config(); // Load environment variables from .env file
const express = require('express'); // Web server framework
const helmet  = require('helmet');  // Security headers (HSTS, X-Frame, X-Content-Type, etc.)
const session = require('express-session'); // User login sessions
const cors = require('cors'); // Allow frontend to talk to backend
const PgSessionStore = require('./session-store'); // Persistent session store
// database is required early so PgSessionStore has a pool before session middleware runs.
// Node's module cache means this and the later require('./database') return the same object.
const { pool: dbPool } = require('./database');
const bodyParser = require('body-parser'); // Parse incoming JSON
const http = require('http'); // HTTP server
const socketIO = require('socket.io'); // Real-time communication
const path = require('path'); // File path utilities

// ===== CREATE EXPRESS APP =====
// This is like setting up the main control center

const app = express();
const server = http.createServer(app);
// Socket.IO CORS — mirrors the Express CORS allowlist.
// ALLOWED_ORIGINS is read later but we need it now, so parse it here.
// The const is re-used by the Express CORS middleware below.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5001,http://127.0.0.1:5001').split(',');

const io = socketIO(server, {
  cors: {
    origin: (origin, cb) => {
      // Allow same-origin requests (no Origin header) and explicitly listed origins
      if (!origin || origin === 'null' || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Socket.IO CORS: origin ${origin} not permitted`));
    },
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type'],
  },
});

// ===== MIDDLEWARE SETUP =====
// Middleware = instructions that run on every request
// Think of it as a checklist the server goes through

// Correlation IDs + structured logging (Phase 8). Mounted first so every
// subsequent middleware and route logs under the same X-Request-Id.
const { createLogger, requestContext, requestLogger } = require('./logger');
const telemetry = require('./telemetry');
const log = createLogger('server');

// Azure App Service (and any cloud LB) terminates TLS in front of the app.
// Without trusting that proxy hop, express-session sees req.secure=false and
// REFUSES to set the production secure cookie (nobody could log in), and
// req.ip would be the load balancer, breaking per-IP rate limiting and audit.
app.set('trust proxy', 1);

app.use(requestContext);

// Security headers — applied before every route.
// A practical CSP replaces the previously-disabled one. The frontend is a
// single file with inline scripts, so 'unsafe-inline' is still required for
// script/style until the progressive modularisation (nonces are the follow-up)
// — but this policy already pins every network destination: only same-origin
// plus the Google Maps SDK hosts can be loaded or contacted, object/embed are
// blocked, and the app cannot be framed by other origins.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'blob:', 'https://maps.googleapis.com', 'https://maps.gstatic.com', 'https://*.googleapis.com', 'https://*.ggpht.com'],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https://maps.googleapis.com'],
      workerSrc:  ["'self'", 'blob:'],
      objectSrc:  ["'none'"],
      baseUri:    ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

// CORS — locked to localhost only. Update ALLOWED_ORIGINS in .env before cloud deployment.
// allowedOrigins is defined above (shared with Socket.IO CORS).
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (same-origin file:// loads) or from the allowed list
    if (!origin || origin === 'null' || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not permitted`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// Microsoft Graph webhook notifications MUST be captured raw BEFORE the JSON
// body parser: Graph posts JSON that the receiver re-parses from the raw
// buffer. With json() first, req.body arrived pre-parsed and the receiver's
// Buffer.toString() produced "[object Object]" — every change notification was
// silently dropped in production (handover KNOWN_ISSUES #6).
app.use('/api/webhooks/outlook', express.raw({ type: '*/*' }));

// Document uploads carry base64 file bytes (documented cap: 5 MB binary ≈
// 6.7 MB base64) — that one route gets a larger JSON limit. Everything else
// keeps the small default limit as a request-size defence.
app.use('/api/profile/documents', bodyParser.json({ limit: '8mb' }));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ── Origin / Referer validation (CSRF mitigation) ─────────────────────────
// For state-mutating methods (POST/PUT/PATCH/DELETE) we check that the
// Origin (or Referer) header matches our allowed-origins list.  This stops
// cross-site form submissions and CSRF attacks without requiring a token.
//
// Exemptions (no Origin header expected or safe to allow):
//   - GET / HEAD / OPTIONS — no state changes
//   - /auth/oauth/callback  — Microsoft OAuth redirect (browser navigation, no Origin)
//   - /api/auth/verify-email — email link redirect (no Origin)
//   - Same-origin requests (no Origin header set by the browser)
//
// In production this check is strict.  In development we warn and continue
// so the app can be tested from file:// or non-listed dev tooling.
app.use((req, res, next) => {
  const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  if (!UNSAFE_METHODS.has(req.method)) return next();

  // OAuth callback and email verification link arrive without an Origin header
  const ORIGIN_EXEMPT = ['/auth/oauth/callback', '/api/auth/verify-email'];
  if (ORIGIN_EXEMPT.some(p => req.path.startsWith(p))) return next();

  const origin  = req.get('origin');
  const referer = req.get('referer');

  // No Origin header → same-origin browser request or non-browser client (server-to-server)
  if (!origin) return next();

  // Normalise the Referer to its origin for comparison
  let refOrigin = null;
  if (referer) {
    try { refOrigin = new URL(referer).origin; } catch (_) {}
  }

  const candidate = origin || refOrigin;
  // Allow 'null' (file:// page in development) only in non-production
  if (candidate === 'null' && process.env.NODE_ENV !== 'production') return next();

  if (!allowedOrigins.includes(candidate)) {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      return res.status(403).json({ error: 'Request origin not permitted' });
    }
    console.warn(`⚠️  CSRF check: origin '${candidate}' not in ALLOWED_ORIGINS (dev-mode passthrough)`);
  }
  next();
});

// ── Startup security guards ────────────────────────────────────────────────
// Refuse to start in production with insecure defaults.
// In development (NODE_ENV !== 'production') we warn but keep going so
// developers can run the app without setting every env var first.
(function enforceStartupSecrets() {
  const isProd = process.env.NODE_ENV === 'production';

  const KNOWN_WEAK_SECRETS = new Set([
    '', 'dev-secret-change-in-production', 'thisismyrandomsecret12345',
    'secret', 'change_me', 'changeme', 'password',
  ]);

  const secret = process.env.SESSION_SECRET || '';
  const secretWeak = KNOWN_WEAK_SECRETS.has(secret) || secret.length < 32;

  if (secretWeak) {
    const msg =
      '❌  SESSION_SECRET is missing or too weak (must be ≥32 random characters).\n' +
      '    Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"';
    if (isProd) {
      console.error(msg);
      process.exit(1);
    } else {
      console.warn('⚠️  ' + msg.replace('❌  ', '') + '\n    (continuing in dev mode)');
    }
  }

  // In production, insist that the token encryption key is also set
  if (isProd && !process.env.TOKEN_ENCRYPTION_KEY) {
    console.error(
      '❌  TOKEN_ENCRYPTION_KEY is not set.\n' +
      '    Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
    process.exit(1);
  }
})();

// Full environment validation (env-validation.js): warns in development,
// refuses to boot in production/staging with missing critical configuration.
require('./env-validation').enforceEnvironmentOrExit();

// Session — 8-hour timeout, httpOnly cookie.
// Saved to a variable so it can be shared with Socket.IO middleware below.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const sessionMiddleware = session({
  store: new PgSessionStore(dbPool, SESSION_TTL_MS),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true, // reset timeout on each request
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,   // not accessible via JS
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
  }
});
app.use(sessionMiddleware);

// Structured request log (after session so the internal user id is known).
// Logs path only — never query strings (OAuth codes / reset tokens) or bodies.
app.use(requestLogger(createLogger('http')));

// Share Express session with Socket.IO so we can read req.session.userId
// from the handshake and assign each socket to a per-user room.
// This prevents calendar update events from broadcasting to all connected clients.
io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));

// ===== SERVE FRONTEND FILES =====
// Serve the frontend from the backend to avoid CORS issues with file:// URLs
const frontendPath = path.join(__dirname, '../frontend/current');
console.log(`📁 Serving frontend from: ${frontendPath}`);
app.use(express.static(frontendPath));

// ===== SIMPLE TEST ROUTE =====
// This is just to verify the server is working

// ── Public auth pages (no session required) ───────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(frontendPath, 'login.html'));
});
app.get('/register', (req, res) => {
  res.sendFile(path.join(frontendPath, 'register.html'));
});
app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(frontendPath, 'forgot-password.html'));
});
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(frontendPath, 'reset-password.html'));
});
// Verify-email: accessible with or without session (user may not be logged in)
app.get('/verify-email', (req, res) => {
  res.sendFile(path.join(frontendPath, 'verify-email.html'));
});
// Pending-approval: shown after email verification until owner approves
app.get('/pending-approval', (req, res) => {
  res.sendFile(path.join(frontendPath, 'pending-approval.html'));
});

// ── Helper: look up the logged-in user's account status ───────────────────
async function getSessionUser(userId) {
  try {
    const { rows } = await db.pool.query(
      'SELECT account_status, email_verified, profile_completed FROM users WHERE id = $1',
      [userId]
    );
    return rows[0] || null;
  } catch (_) { return null; }
}

// ── Main app — full account_status guard ──────────────────────────────────
app.get('/', async (req, res) => {
  if (!req.session?.userId) return res.redirect('/login');

  const user = await getSessionUser(req.session.userId);
  if (!user) return res.redirect('/login'); // userId invalid — clear via redirect

  const status = user.account_status || 'active';
  if (status === 'pending_verification') return res.redirect('/verify-email');
  if (status === 'pending_approval')     return res.redirect('/pending-approval');
  if (status === 'suspended')            return res.redirect('/login?reason=suspended');
  if (status === 'deactivated')          return res.redirect('/login?reason=deactivated');

  if (user.profile_completed === false) return res.redirect('/onboarding');
  res.sendFile(path.join(frontendPath, 'mockup_v3.html'));
});

// ── Onboarding — requires active verified account ─────────────────────────
app.get('/onboarding', async (req, res) => {
  if (!req.session?.userId) return res.redirect('/login');

  const user = await getSessionUser(req.session.userId);
  if (!user) return res.redirect('/login');

  const status = user.account_status || 'active';
  if (status === 'pending_verification') return res.redirect('/verify-email');
  if (status === 'pending_approval')     return res.redirect('/pending-approval');
  if (status === 'suspended' || status === 'deactivated') {
    return res.redirect('/login?reason=' + status);
  }
  res.sendFile(path.join(frontendPath, 'onboarding.html'));
});

// ===== HEALTH + READINESS =====
// /health (liveness) + /ready (DB / migrations / config, 503 while draining).
// Extracted to health-routes.js so the integration suite exercises the real
// probes. setDraining(true) is called from the SIGTERM handler below.

const { router: healthRouter, setDraining } = require('./health-routes');
app.use(healthRouter);

// ===== WEBSOCKET CONNECTION =====
// Each authenticated client joins a private room keyed to their user ID so that
// calendar update events are only sent to the user whose data changed, plus any
// owner/admin watching the master calendar.  Unauthenticated sockets receive the
// initial handshake message but no private data events.

io.on('connection', (socket) => {
  const userId = socket.request.session?.userId;
  console.log(`✓ Client connected: ${socket.id}${userId ? ` (user ${userId})` : ' (unauthenticated)'}`);

  // Join user-specific room — only this socket (and server) can emit to it.
  if (userId) socket.join(`user:${userId}`);

  socket.emit('connected', {
    message: 'Connected to Therapy Scheduler Backend',
    clientId: socket.id,
    authenticated: !!userId,
  });

  socket.on('disconnect', () => {
    console.log(`✗ Client disconnected: ${socket.id}`);
  });
});

// ===== ERROR HANDLING =====
// Catch any errors and send a proper response

app.use((err, req, res, next) => {
  // Respect upstream error semantics: body-parser emits 400 (malformed JSON)
  // and 413 (payload too large) — those are client errors, not server faults.
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    log.error('Unhandled request error', {
      error: err,
      path: req.path,
      method: req.method,
      userId: req.session?.userId || null,
    });
    telemetry.trackException(err, { path: req.path, method: req.method });
  } else {
    log.warn('Request rejected', { status, type: err.type, path: req.path, method: req.method });
  }
  res.status(status).json({
    error: status === 413 ? 'Upload too large'
         : status < 500   ? 'Invalid request'
         : 'Server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ===== INITIALIZE DATABASE =====
// Create tables if they don't exist

const db = require('./database');
(async () => {
  const initialized = await db.initializeDatabase();
  if (initialized) {
    console.log('✅ Database initialized successfully');
  } else {
    console.error('⚠️  Database initialization failed - tables may not exist');
  }
})();

// ===== START SERVER =====
// ===== REGISTER ROUTES =====
// Auth routes (login / logout / me) — mounted before main routes so they
// handle /api/auth/* requests without going through requireAuth.
const authRoutes = require('./auth');
app.use('/', authRoutes);

// Main app routes (calendar, sync, Splose, Outlook write-back, etc.)
const routes = require('./routes');
app.use('/', routes);
app.use('/auth', routes);
app.use('/api', routes);

// Multi-therapist calendar routes: therapist profiles + master calendar API
const calendarRoutes = require('./calendar-routes');
app.use('/', calendarRoutes);

// Registration + onboarding routes (invite-only account creation)
const registerRoutes = require('./register-routes');
app.use('/', registerRoutes);

// Invite management routes (Owner/Admin creates invites)
const inviteRoutes = require('./invite-routes');
app.use('/', inviteRoutes);

// My Profile data routes: leave, CPD, PD documents, credentials
const profileRoutes = require('./profile-routes');
app.use('/', profileRoutes);

// App-level routes: notifications, settings, search, user list
const appRoutes = require('./app-routes');
app.use('/', appRoutes);

// Google Maps proxy — keeps the API key server-side, away from browser HTML
const mapsRoutes = require('./maps-routes');
app.use('/', mapsRoutes);

console.log('✅ Routes registered');

// Boot up the server and listen for requests

const PORT = process.env.PORT || 5000;

// Optional Application Insights — no-op locally, enabled by env in Azure.
telemetry.init(createLogger('telemetry'));

// Staged-integration switchboard — logged at boot so every environment's
// posture is visible in its logs (values only, never secrets).
log.info('feature flags', require('./feature-flags').featureFlagState());

// ===== GRACEFUL SHUTDOWN =====
// App Service / container platforms send SIGTERM before recycling. Flip the
// readiness probe first so the load balancer drains us, then close the HTTP
// server and the DB pool. A hard deadline guarantees exit.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  setDraining(true); // /ready now returns 503 so the LB stops routing to us
  log.info(`${signal} received — draining connections`);
  io.close();
  server.close(() => {
    db.pool.end()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
  setTimeout(() => {
    log.warn('shutdown deadline reached — forcing exit');
    process.exit(0);
  }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ===== PROCESS-LEVEL FAILURE BACKSTOPS =====
// A rejected background promise (poller tick, webhook fan-out) must not kill
// the portal — log it, count it, keep serving. A truly uncaught synchronous
// exception is unrecoverable state: log and exit so the platform restarts us.
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason : String(reason),
  });
  telemetry.trackException(reason);
});
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception — exiting for platform restart', { error: err });
  telemetry.trackException(err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║     THERAPY SCHEDULER BACKEND STARTED              ║
╠════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${PORT}        ║
║  Environment: ${process.env.NODE_ENV || 'development'}                    ║
║  Real-time syncing: READY                          ║
║  Database: PostgreSQL (pending connection)         ║
║  OAuth: Microsoft Graph API (pending setup)        ║
╚════════════════════════════════════════════════════╝
  `);
});

// ===== BACKGROUND DELTA SYNC POLLER =====
// Every 5 minutes: ask Microsoft Graph "what changed?" and upsert/delete
// only the events that actually changed. Runs for every authenticated user.

const DELTA_SYNC_INTERVAL_MS = 90 * 1000; // 90 seconds

// Get a valid access token for the user, refreshing if expired.
async function getValidTokenForUser(user) {
  const outlookApi = require('./outlook-oauth');
  const now = new Date();
  const expiresAt = user.token_expires_at ? new Date(user.token_expires_at) : null;
  const isExpired = !expiresAt || (expiresAt - now) < 60 * 1000; // refresh if < 1 min left

  if (!isExpired) return user.access_token;

  if (!user.refresh_token) throw new Error('No refresh token stored — user must re-authenticate');

  console.log(`🔁 Refreshing token for ${user.email}...`);
  const refreshed = await outlookApi.refreshAccessToken(user.refresh_token);
  await db.updateUserTokens(user.id, refreshed.accessToken, refreshed.refreshToken, refreshed.expiresIn);
  console.log(`✅ Token refreshed for ${user.email}`);
  return refreshed.accessToken;
}

const { classifyEventType } = require('./sync-utils');

let deltaRunning = false; // prevent overlapping runs
// Track how many delta-sync cycles have run per user so we can trigger
// periodic full reconciliation without a separate timer.
const _reconcileCounter = {};

async function runDeltaSyncForAllUsers() {
  // Aggregate stats returned to the manual "Sync now" route (and useful in logs).
  const stats = {
    skipped: false, usersProcessed: 0,
    upserted: 0, cancelled: 0, removed: 0,
    blockedDeletions: 0, warnings: [], errors: [],
  };
  if (deltaRunning) {
    console.log('⏭️  Delta sync already running — skipping this tick');
    stats.skipped = true;
    return stats;
  }
  deltaRunning = true;

  try {
    const result = await db.pool.query(
      'SELECT id, email, access_token, refresh_token, token_expires_at FROM users WHERE access_token IS NOT NULL'
    );
    if (result.rows.length === 0) { deltaRunning = false; return stats; }

    const outlookApi = require('./outlook-oauth');

    for (const user of result.rows) {
      try {
        const accessToken = await getValidTokenForUser(user);
        const state = await db.getDeltaState(user.id);
        const storedToken = state ? state.delta_token : null;

        const { changed, deleted, deltaToken: newToken } = await outlookApi.getOutlookCalendarDelta(
          accessToken,
          storedToken
        );

        let upserted = 0, cancelled = 0, removed = 0;

        // Process in batches of 20 to avoid serialising thousands of DB
        // roundtrips (a ±2-year re-bootstrap previously froze the server by
        // awaiting 5,000+ upserts one at a time).
        const BATCH = 20;
        for (let i = 0; i < changed.length; i += BATCH) {
          await Promise.all(changed.slice(i, i + BATCH).map(async ev => {
            if (ev.isCancelled) {
              const g = await db.softDeleteEventByOutlookId(user.id, ev.outlookId);
              if (g) cancelled++;
            } else {
              await db.upsertOutlookEvent(user.id, {
                ...ev,
                eventType: classifyEventType(ev.categories || [], ev.isTeamsMeeting || false),
              });
              upserted++;
            }
          }));
        }
        // ── Deletion-volume guard on the @removed batch ────────────────────
        // A legitimate delta rarely deletes many events at once; a huge batch
        // usually means an upstream anomaly. When blocked we also skip saving
        // the new delta token so the SAME deletions are re-presented next tick
        // (delta tokens are consume-once) — nothing is lost, an owner is
        // notified, and manual cleanup can confirm a genuine mass-change.
        let deltaDeletionsBlocked = false;
        if (deleted.length > 0) {
          const { assessDeletionSafety, recordSafetyBlock } = require('./sync-safety');
          const linked = await db.pool.query(
            `SELECT COUNT(*) AS n FROM events
             WHERE user_id = $1 AND source = 'outlook' AND outlook_id IS NOT NULL
               AND (is_deleted IS NULL OR is_deleted = FALSE)`, [user.id]);
          const verdict = assessDeletionSafety({
            source: 'outlook_delta',
            fetchComplete: !!newToken, // delta paging finished ⇒ Graph returned a deltaLink
            liveCount: Number(linked.rows[0].n) - deleted.length,
            deletionCandidates: deleted.length,
            localLinkedCount: Number(linked.rows[0].n),
          });
          if (!verdict.safe) {
            deltaDeletionsBlocked = true;
            await recordSafetyBlock(
              { db, storeNotification: (...a) => require('./app-routes').storeNotification(...a) },
              { source: 'outlook_delta', reason: verdict.reason, stats: verdict.stats, userId: user.id }
            );
          }
        }
        if (!deltaDeletionsBlocked) {
          for (let i = 0; i < deleted.length; i += BATCH) {
            await Promise.all(deleted.slice(i, i + BATCH).map(async outlookId => {
              const g = await db.softDeleteEventByOutlookId(user.id, outlookId);
              if (g) removed++;
            }));
          }
        }
        if (newToken && !deltaDeletionsBlocked) await db.saveDeltaState(user.id, newToken);

        stats.usersProcessed++;
        stats.upserted += upserted;
        stats.cancelled += cancelled;
        stats.removed += removed;
        if (deltaDeletionsBlocked) {
          stats.blockedDeletions += deleted.length;
          stats.warnings.push({ userId: user.id, warning: 'deletions_blocked_by_safety', count: deleted.length });
        }

        if (upserted > 0 || cancelled > 0 || removed > 0) {
          console.log(`🔄 [Auto delta] ${user.email}: +${upserted} updated, ${cancelled} cancelled, -${removed} removed`);
          // Emit only to the user whose calendar changed (private room) —
          // never broadcast to all connected clients.
          io.to(`user:${user.id}`).emit('calendarUpdated', { upserted, cancelled, removed });
        } else {
          console.log(`✅ [Auto delta] ${user.email}: no changes`);
        }

        // ── Periodic full reconciliation (every 60 cycles ≈ 90 min) ──────────
        // The delta poller only sees changes within the Graph delta window.
        // Events deleted in Outlook outside that window never trigger @removed,
        // so they accumulate as ghost rows. Every 60 cycles we fetch a ±90-day
        // window from Outlook and soft-delete any local rows not in the result.
        _reconcileCounter[user.id] = (_reconcileCounter[user.id] || 0) + 1;
        if (_reconcileCounter[user.id] % 60 === 0) {
          try {
            const outlookApiReconcile = require('./outlook-oauth');
            const now = new Date();
            const recStart = new Date(now.getTime() - 90 * 86400000).toISOString();
            const recEnd   = new Date(now.getTime() + 90 * 86400000).toISOString();
            const liveEvents = await outlookApiReconcile.getOutlookCalendarEvents(accessToken, recStart, recEnd);
            const liveIds = liveEvents.map(e => e.outlookId).filter(Boolean);
            // Threshold-guarded: empty/truncated fetches and abnormal drops
            // block the whole batch, audit, and notify — nothing is deleted.
            const result = await db.reconcileOutlookWindowSafe(user.id, recStart, recEnd, liveIds, {
              fetchComplete: liveEvents._fetchComplete !== false,
              source: 'outlook_reconcile',
            });
            if (result.blocked) {
              const { recordSafetyBlock } = require('./sync-safety');
              await recordSafetyBlock(
                { db, storeNotification: (...a) => require('./app-routes').storeNotification(...a) },
                { source: 'outlook_reconcile', reason: result.reason, stats: result.stats, userId: user.id }
              );
            } else {
              console.log(`🔍 [Auto reconcile] ${user.email}: ±90 days, ${liveIds.length} live, ${result.pruned.length} pruned`);
            }
          } catch (reconErr) {
            console.warn(`⚠️  Auto reconcile error for ${user.email}:`, reconErr.message);
          }
        }
      } catch (userErr) {
        const status = userErr.response?.status;
        if (status === 400 || status === 410) {
          // Stale/invalid delta token — clear it so next run bootstraps fresh
          console.warn(`⚠️  Delta token invalid for ${user.email} (${status}) — clearing token, will re-bootstrap next tick`);
          try { await db.saveDeltaState(user.id, null); } catch (_) {}
          stats.warnings.push({ userId: user.id, warning: 'delta_token_reset' });
        } else {
          console.error(`⚠️  Delta sync failed for ${user.email}:`, userErr.message);
          // userId + message only — never tokens or event content
          stats.errors.push({ userId: user.id, message: userErr.message });
          telemetry.trackException(userErr, { component: 'outlook_delta_sync', userId: user.id });
        }
      }
    }
  } catch (err) {
    console.error('⚠️  Delta poller error:', err.message);
    stats.errors.push({ message: err.message });
    telemetry.trackException(err, { component: 'outlook_delta_poller' });
  } finally {
    deltaRunning = false;
  }
  return stats;
}

// Expose the runner for the manual "Sync now" route (app-routes reads this
// via req.app.get so tests can inject a stub without loading server.js).
app.set('forceSyncRunner', runDeltaSyncForAllUsers);

// Start Outlook delta poller after DB is ready
setTimeout(() => {
  console.log('⏱️  Background Outlook delta sync started (every 90 seconds)');
  setInterval(runDeltaSyncForAllUsers, DELTA_SYNC_INTERVAL_MS);
  runDeltaSyncForAllUsers();
}, 5000);

// ===== SPLOSE BACKGROUND POLLER =====
// Extracted to splose-poller.js (dependency-injected, unit-tested). Detects
// Splose-side cancellations every 15 minutes and converges local + Outlook.
// Deletions run behind sync-safety thresholds — an empty/truncated/anomalous
// Splose response blocks the whole batch, audits, and notifies owners.

const SPLOSE_POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const { createSplosePoller } = require('./splose-poller');
const { runSploseSync } = createSplosePoller({
  db,
  sploseApi: require('./splose-api'),
  outlookApi: require('./outlook-oauth'),
  io,
  getValidTokenForUser,
  storeNotification: (...args) => require('./app-routes').storeNotification(...args),
});

// Start Splose poller 8 seconds after boot to avoid hammering on startup
setTimeout(() => {
  console.log('⏱️  Background Splose cancellation sync started (every 15 minutes)');
  setInterval(runSploseSync, SPLOSE_POLL_INTERVAL_MS);
  runSploseSync();
}, 8000);

// ===== OUTLOOK WEBHOOK INFRASTRUCTURE =====
// When WEBHOOK_BASE_URL is set in .env, the server registers a Microsoft Graph
// change-notification subscription so Outlook pushes calendar changes in real
// time instead of relying solely on the 90-second poll.
//
// Required env vars:
//   WEBHOOK_BASE_URL     e.g. https://your-app.example.com  (no trailing slash)
//   WEBHOOK_CLIENT_STATE A random secret string for request verification
//
// Subscriptions expire after ~3 days; the renewal job below keeps them alive.

// subscriptionId → userId — shared with the receiver via webhook-state.js.
// Also hand our Socket.IO server to the shared module so the webhook receiver
// can emit without require('./server').
const { webhookSubscriptions: _webhookSubscriptions, setIo: _setWebhookIo } = require('./webhook-state');
_setWebhookIo(io);

async function registerOutlookWebhook(userId, accessToken) {
  const webhookUrl    = `${process.env.WEBHOOK_BASE_URL}/api/webhooks/outlook`;
  const clientState   = process.env.WEBHOOK_CLIENT_STATE || 'opal-scheduler-webhook';
  const expiresAt     = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
  try {
    const axios = require('axios');
    const resp  = await axios.post(
      'https://graph.microsoft.com/v1.0/subscriptions',
      {
        changeType:           'created,updated,deleted',
        notificationUrl:      webhookUrl,
        resource:             '/me/calendar/events',
        expirationDateTime:   expiresAt.toISOString(),
        clientState,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const subId = resp.data.id;
    _webhookSubscriptions.set(subId, userId);
    console.log(`🔔 Outlook webhook registered for user ${userId}: ${subId} (expires ${expiresAt.toDateString()})`);
    return subId;
  } catch (err) {
    console.warn('⚠️  Webhook registration failed (non-fatal):', err.response?.data?.error?.message || err.message);
    return null;
  }
}

async function renewOutlookWebhooks() {
  if (!process.env.WEBHOOK_BASE_URL) return;
  const clientState = process.env.WEBHOOK_CLIENT_STATE || 'opal-scheduler-webhook';
  const expiresAt   = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const axios       = require('axios');

  for (const [subId, userId] of _webhookSubscriptions) {
    try {
      const { rows } = await db.pool.query(
        'SELECT access_token, token_expires_at, refresh_token FROM users WHERE id = $1', [userId]
      );
      if (!rows.length) continue;
      const accessToken = await getValidTokenForUser(rows[0]);
      await axios.patch(
        `https://graph.microsoft.com/v1.0/subscriptions/${subId}`,
        { expirationDateTime: expiresAt.toISOString() },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      console.log(`🔔 Webhook subscription renewed: ${subId}`);
    } catch (err) {
      // Subscription may have expired — re-register
      console.warn(`⚠️  Webhook renewal failed for ${subId}, attempting re-registration`);
      _webhookSubscriptions.delete(subId);
      const { rows } = await db.pool.query(
        'SELECT id, access_token, token_expires_at, refresh_token FROM users WHERE id = $1', [userId]
      ).catch(() => ({ rows: [] }));
      if (rows.length) {
        const accessToken = await getValidTokenForUser(rows[0]).catch(() => null);
        if (accessToken) await registerOutlookWebhook(userId, accessToken);
      }
    }
  }
}

// Register webhooks after startup (only when WEBHOOK_BASE_URL is configured)
setTimeout(async () => {
  if (!process.env.WEBHOOK_BASE_URL) {
    console.log('ℹ️  WEBHOOK_BASE_URL not set — using polling only (set it for real-time Outlook sync)');
    return;
  }
  try {
    const { rows } = await db.pool.query(
      `SELECT id, access_token, token_expires_at, refresh_token FROM users
        WHERE access_token IS NOT NULL AND access_token != '' AND is_active = TRUE`
    );
    for (const user of rows) {
      const accessToken = await getValidTokenForUser(user).catch(() => null);
      if (accessToken) await registerOutlookWebhook(user.id, accessToken);
    }
  } catch (err) {
    console.warn('⚠️  Webhook startup registration error:', err.message);
  }
}, 10000);

// Renew subscriptions every 2 days (well before the 3-day expiry)
setInterval(renewOutlookWebhooks, 2 * 24 * 60 * 60 * 1000);

// ===== FRIDAY LOCATION ALARM CRON =====
// Fires every Friday at 16:00 AWST (08:00 UTC, since AWST = UTC+8).
// For each user whose notification_preferences.locationAlarm is not false,
// checks if their next-week work_location_schedule is missing any day and,
// if so, stores a durable notification nudging them to fill it in.

const { storeNotification } = require('./app-routes');

async function runLocationAlarmCheck() {
  const now = new Date();
  // Only fire on Fridays (UTC day 5 = Friday)
  if (now.getUTCDay() !== 5) return;

  console.log('⏰ Friday location alarm check running…');

  // Compute next week's Monday in YYYY-Www format (ISO week key)
  const msPerDay   = 86400000;
  const nextMonUTC = new Date(now);
  // Advance to next Monday (UTC)
  const todayUTCDay = now.getUTCDay(); // 5 = Friday
  nextMonUTC.setUTCDate(now.getUTCDate() + (8 - todayUTCDay)); // +3 days from Fri
  nextMonUTC.setUTCHours(0, 0, 0, 0);

  // ISO week key matching the frontend's weekKeyFor() logic: "YYYY-Www"
  function isoWeekKey(date) {
    // Use the Thursday-based ISO week number
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7; // make Sunday = 7
    d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d - yearStart) / msPerDay) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  const nextWeekKey = isoWeekKey(nextMonUTC);
  const WL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

  try {
    const { rows: users } = await db.pool.query(
      `SELECT id, email, notification_preferences, work_location_schedule
         FROM users
        WHERE is_active = TRUE`
    );

    for (const user of users) {
      const prefs = user.notification_preferences || {};
      // Default is ON — only skip if explicitly disabled
      if (prefs.locationAlarm === false) continue;

      const schedule  = user.work_location_schedule || {};
      const nextWeek  = schedule[nextWeekKey] || {};
      const missingDays = WL_DAYS.filter(d => !nextWeek[d]);

      if (missingDays.length === 0) continue; // all set — no notification needed

      // storeNotification is idempotent by type, so re-running on the same Friday is safe
      if (typeof storeNotification === 'function') {
        await storeNotification(user.id, {
          type:          `location_alarm_${nextWeekKey}`,
          title:         'Set next week\'s work locations',
          message:       `${missingDays.length} day(s) not yet set for the week of ${nextWeekKey.replace('W', 'Week ')}. Open My Profile → Work location to fill them in — the scheduler uses these for travel estimates.`,
          severity:      'warning',
          relatedEntity: 'work_location',
        });
        console.log(`📍 Location alarm sent → ${user.email} (missing: ${missingDays.join(', ')})`);
      }
    }
  } catch (err) {
    console.error('Location alarm check error:', err.message);
  }
}

// Check once an hour — the actual day/time guard is inside the function.
// On startup, delay 10 s so the DB init pool is ready.
setTimeout(() => {
  setInterval(runLocationAlarmCheck, 60 * 60 * 1000);
  // Run immediately on startup so a Friday restart doesn't miss the window
  runLocationAlarmCheck().catch(() => {});
}, 10000);

// ===== GRACEFUL SHUTDOWN =====
// Clean up properly when server stops

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

module.exports = { app, io, _webhookSubscriptions, runDeltaSyncForAllUsers };
