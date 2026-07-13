/**
 * OUTLOOK INTEGRATION ROUTES
 *
 * Safe workflow:
 * 1. User clicks "Sync Outlook" button
 * 2. Redirected to Microsoft login
 * 3. User authorizes access
 * 4. Backend fetches all Outlook events
 * 5. Stores them in app database (READ-ONLY initially)
 * 6. Frontend displays the synced events
 * 7. Only AFTER sync, enable bidirectional write access
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const db = require('./database');
const outlookApi = require('./outlook-oauth');
const sploseApi = require('./splose-api');
const { getPermissions, requireRole, requirePermission, hasPermission } = require('./permissions');
const { classifyEventType } = require('./sync-utils');

// Lazy-load the storeNotification helper (app-routes.js registers it after routes.js)
function storeNotificationLazy(userId, payload) {
  try {
    const { storeNotification } = require('./app-routes');
    if (typeof storeNotification === 'function') return storeNotification(userId, payload);
  } catch (e) { /* app-routes not yet loaded — skip */ }
  return Promise.resolve();
}

// Track Splose sync state in-process so the /api/splose/sync-status endpoint
// can report it without a DB round-trip. Reset on successful sync.
const sploSyncState = { ok: true, lastOk: null, lastFail: null, errorMsg: null };
function recordSploSuccess() {
  sploSyncState.ok      = true;
  sploSyncState.lastOk  = new Date().toISOString();
  sploSyncState.errorMsg = null;
}
function recordSploFailure(msg) {
  sploSyncState.ok       = false;
  sploSyncState.lastFail = new Date().toISOString();
  sploSyncState.errorMsg = msg;
}

// classifyEventType is now imported from ./sync-utils (shared with server.js)

// ===== MIDDLEWARE =====

/**
 * requireAuth — verifies the session and attaches the full user record
 * (including role and computed permissions) to req.user.
 *
 * All protected routes use this. Role/permission checks then read from req.user
 * rather than making additional DB calls.
 */
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    // Load user if not already cached on this request
    if (!req.user) {
      const user = await db.getUser(req.session.userId);
      if (!user || user.is_active === false) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: 'Session expired or account inactive' });
      }
      user.permissions = getPermissions(user.role, user.permissions || []);
      req.user = user;
    }
    next();
  } catch (err) {
    console.error('requireAuth error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}


/**
 * Return a valid Microsoft access token for the given user, refreshing it
 * via the stored refresh_token if it has expired (or is about to). Persists
 * the new token back to the DB so subsequent calls hit the cache.
 *
 * Throws if the user has never authenticated OR if the refresh fails (e.g.
 * the refresh token was revoked) — the caller should surface a 401/400 so
 * the frontend can re-trigger the OAuth flow.
 */
async function getValidAccessToken(user) {
  if (!user || !user.access_token) {
    throw new Error('Outlook not connected');
  }

  // Treat token as expired if it lapses within the next 60s (clock skew buffer).
  const expiresAt = user.token_expires_at ? new Date(user.token_expires_at).getTime() : 0;
  const stillValid = expiresAt > Date.now() + 60_000;

  if (stillValid) {
    return user.access_token;
  }

  if (!user.refresh_token) {
    throw new Error('Access token expired and no refresh token on file — user must re-authenticate');
  }

  console.log(`🔁 Access token expired for ${user.email}; refreshing...`);
  const refreshed = await outlookApi.refreshAccessToken(user.refresh_token);

  await db.updateUserTokens(
    user.id,
    refreshed.accessToken,
    refreshed.refreshToken,
    refreshed.expiresIn
  );
  console.log(`✅ Refreshed access token for ${user.email} (expires in ${refreshed.expiresIn}s)`);

  // Mutate the in-memory user so the caller sees the new value too.
  user.access_token = refreshed.accessToken;
  user.refresh_token = refreshed.refreshToken;
  user.token_expires_at = new Date(Date.now() + refreshed.expiresIn * 1000);

  return refreshed.accessToken;
}

// ===== PHASE 1: OUTLOOK LOGIN & TOKEN EXCHANGE =====

/**
 * GET /auth/outlook-login
 * Starts the Microsoft OAuth flow
 * Frontend redirects user here to login
 */
router.get('/auth/outlook-login', (req, res) => {
  try {
    console.log('🔐 OAuth login endpoint called');

    // Get the return URL from the query parameter (where to redirect after auth)
    const returnUrl = req.query.returnUrl || null;
    console.log('Return URL:', returnUrl ? '✓ Provided' : '✗ Not provided');

    // Pass returnUrl into getAuthorizationUrl so it's encoded in the state param
    // and survives the Microsoft redirect round-trip without relying on session
    const authData = outlookApi.getAuthorizationUrl(returnUrl);
    console.log('Auth data received:', authData ? 'Yes' : 'No');

    if (!authData || !authData.url) {
      throw new Error('Invalid auth data returned from getAuthorizationUrl');
    }

    const { url, state } = authData;

    // Also store in session as fallback
    req.session.oauthState = state;
    req.session.outlookReturnUrl = returnUrl;
    req.session.save();

    console.log('✅ OAuth URL generated successfully');

    res.json({
      message: 'Redirect to Microsoft login',
      authUrl: url,
      instruction: 'User should navigate to: ' + url
    });
  } catch (error) {
    console.error('❌ Error initiating OAuth:', error.message);
    res.status(500).json({
      error: 'Failed to initiate Microsoft login',
      details: error.message
    });
  }
});

/**
 * GET /auth/oauth/callback
 * Microsoft redirects here after user approves
 * Exchange code for access token
 */
router.get('/auth/oauth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    console.log('🔐 OAuth callback received');
    console.log('State match:', state === req.session.oauthState ? 'Yes' : 'No (lenient mode - continuing)');

    // For development, we're lenient with state validation
    // In production, this should always match for security
    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // Get token from Microsoft
    const tokenData = await outlookApi.getAccessToken(code);

    // Get user info
    const microsoftUser = await outlookApi.getMicrosoftUser(tokenData.accessToken);

    // Match the Microsoft account to an existing local user by email.
    // If no local account exists yet (legacy / first-run), create one with
    // role='owner' so the first OAuth login still works during development.
    let user = await db.getUserByEmail(microsoftUser.email);
    if (!user) {
      console.warn(`⚠️  No local account found for ${microsoftUser.email} — creating with role=owner (dev mode)`);
      user = await db.createUser(microsoftUser.email, microsoftUser.id);
    } else if (microsoftUser.id && !user.microsoft_id) {
      // Link the Microsoft ID to the existing local account
      await db.pool.query(
        'UPDATE users SET microsoft_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [microsoftUser.id, user.id]
      );
    }

    // Store Outlook OAuth tokens so Graph API calls work
    await db.updateUserTokens(
      user.id,
      tokenData.accessToken,
      tokenData.refreshToken,
      tokenData.expiresIn
    );

    // Create session
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.microsoftId = microsoftUser.id;
    req.session.save();

    console.log(`✅ Outlook connected for: ${user.email} (role: ${user.role || 'owner'})`);

    // Decode returnUrl from state param (format: "<csrf>|<base64(returnUrl)>")
    // Fall back to session if state doesn't contain it
    let returnUrl = null;
    if (state && state.includes('|')) {
      try {
        returnUrl = Buffer.from(state.split('|')[1], 'base64').toString('utf8');
      } catch (e) {
        returnUrl = null;
      }
    }
    if (!returnUrl) {
      returnUrl = req.session.outlookReturnUrl || null;
    }

    const redirectUrl = returnUrl
      ? (returnUrl.includes('?') ? returnUrl + '&auth=complete' : returnUrl + '?auth=complete')
      : null;

    console.log('📍 Return URL for redirect:', redirectUrl ? `✓ ${redirectUrl}` : '✗ Not available');

    // Send HTML page that shows success and provides navigation back
    res.send(`
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f7; }
            .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
            h1 { color: #1e8449; margin-top: 0; font-size: 28px; }
            p { color: #666; line-height: 1.6; }
            .details { background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: left; font-size: 13px; border-left: 4px solid #1e8449; }
            .details strong { display: block; color: #1e8449; margin-bottom: 4px; }
            .button-group { margin-top: 30px; display: flex; gap: 10px; }
            button {
              flex: 1;
              padding: 12px 20px;
              border: none;
              border-radius: 8px;
              font-size: 14px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s;
            }
            .primary-btn {
              background: #1e8449;
              color: white;
            }
            .primary-btn:hover {
              background: #16654f;
              box-shadow: 0 2px 8px rgba(30, 132, 73, 0.3);
            }
            .secondary-btn {
              background: #e8f5e9;
              color: #1e8449;
              border: 1px solid #1e8449;
            }
            .secondary-btn:hover {
              background: #d4edda;
            }
            .status-icon { font-size: 48px; margin-bottom: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="status-icon">✓</div>
            <h1>Authentication Successful!</h1>
            <p>You have successfully authenticated with Microsoft Outlook.</p>

            <div class="details">
              <strong>Email:</strong> ${user.email}
            </div>

            <p style="color: #999; font-size: 13px; margin-top: 20px;">Your session is active and ready to sync your Outlook calendar.</p>

            <div class="button-group">
              <button class="primary-btn" onclick="goBack()">Back to App</button>
              <button class="secondary-btn" onclick="goHome()">Open App Fresh</button>
            </div>

            <p style="font-size: 11px; color: #999; margin-top: 20px;">If buttons don't work, please manually open mockup_v3.html.</p>
          </div>

          <script>
            const returnUrl = ${redirectUrl ? `'${redirectUrl}'` : 'null'};

            function goBack() {
              console.log('Going back...');
              if (returnUrl) {
                console.log('Redirecting to:', returnUrl);
                window.location.href = returnUrl;
              } else {
                console.log('No return URL, trying history');
                window.history.back();
              }
            }

            function goHome() {
              alert('Your authentication is complete! Your session is now active. Please open mockup_v3.html to complete the sync.');
              if (returnUrl) {
                window.location.href = returnUrl;
              } else {
                window.history.back();
              }
            }

            // Auto-redirect if return URL is available
            window.addEventListener('load', () => {
              setTimeout(() => {
                if (returnUrl) {
                  console.log('Auto-redirecting...');
                  goBack();
                }
              }, 1500);
            });
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ OAuth callback error:', error.message);
    console.error('Full error:', error);

    // Send error HTML
    res.send(`
      <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
            h1 { color: #f44336; margin-top: 0; }
            p { color: #666; line-height: 1.6; }
            .error { background: #ffebee; padding: 15px; border-radius: 4px; margin: 20px 0; text-align: left; font-size: 14px; color: #c62828; border-left: 4px solid #f44336; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Authentication Failed</h1>
            <p>There was an error authenticating with Microsoft.</p>

            <div class="error">
              <strong>Error:</strong> ${error.message}
            </div>

            <p>Please go back to your application and try again.</p>
          </div>
        </body>
      </html>
    `);
  }
});

/**
 * GET /auth/user
 * Returns current logged-in user info
 */
router.get('/auth/user', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    res.json({
      id: user.id,
      email: user.email,
      hasOutlookTokens: !!user.access_token
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// ===== PHASE 2: INITIAL OUTLOOK SYNC (READ-ONLY) =====

/**
 * POST /api/sync/outlook-clear
 *
 * Clear all synced events for user
 * Prepares for fresh sync
 */
router.post('/api/sync/outlook-clear', requireAuth, async (req, res) => {
  try {
    console.log('🗑️ Clearing all events for user:', req.session.userId);

    // Only remove Outlook-sourced events — app-created events (source='app') survive.
    // After the backfill migration, source='app' correctly identifies rows with no outlook_id.
    const query = `DELETE FROM events WHERE user_id = $1 AND (source = 'outlook' OR (source != 'app' AND outlook_id IS NOT NULL))`;
    const result = await db.pool.query(query, [req.session.userId]);

    console.log(`✅ Deleted ${result.rowCount} Outlook events`);

    res.json({
      message: 'Outlook events cleared',
      deletedCount: result.rowCount
    });
  } catch (error) {
    console.error('Error clearing events:', error);
    res.status(500).json({ error: 'Failed to clear events', details: error.message });
  }
});

/**
 * POST /api/sync/outlook-initial
 *
 * SAFE INITIAL SYNC - READ-ONLY
 * Fetches all Outlook events and stores them in app database
 * Does NOT write anything back to Outlook
 *
 * Flow:
 * 1. Frontend calls this endpoint
 * 2. Backend fetches all Outlook events
 * 3. Stores them with synced_at timestamp
 * 4. Returns count of synced events
 * 5. Frontend displays them
 */
// Prevent multiple simultaneous full syncs from hammering the Microsoft API
const syncInProgress = new Set();

router.post('/api/sync/outlook-initial', requireAuth, async (req, res) => {
  const userId = req.session.userId;

  if (syncInProgress.has(userId)) {
    console.log(`⏭️  Sync already in progress for ${req.session.userEmail} — ignoring duplicate request`);
    return res.status(409).json({ error: 'Sync already in progress', message: 'Please wait for the current sync to finish.' });
  }
  syncInProgress.add(userId);

  try {
    console.log('📍 /api/sync/outlook-initial (reconciling) called');
    const user = await db.getUser(userId);

    if (!user.access_token) {
      return res.status(400).json({ error: 'Outlook not connected', message: 'User must authenticate with Microsoft first' });
    }

    let accessToken;
    try {
      accessToken = await getValidAccessToken(user);
    } catch (tokenErr) {
      console.error('🔒 Token refresh failed:', tokenErr.message);
      return res.status(401).json({ error: 'Outlook re-authentication required', details: tokenErr.message, action: 'reauthenticate' });
    }

    // ── 1. Fetch latest Outlook events (full window) ──────────────────────────
    const now = new Date();
    const windowStart = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).toISOString();
    const windowEnd   = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()).toISOString();

    console.log(`🔄 Fetching Outlook events for ${user.email} (${windowStart.slice(0,10)} → ${windowEnd.slice(0,10)})…`);
    const outlookEvents = await outlookApi.getOutlookCalendarEvents(accessToken, windowStart, windowEnd);
    console.log(`📥 Outlook returned ${outlookEvents.length} events`);

    // ── 2. Upsert / cancel each returned event ────────────────────────────────
    let upserted = 0, cancelled = 0, errors = 0;
    const knownOutlookIds = [];

    for (const ev of outlookEvents) {
      try {
        const eventData = {
          outlookId:      ev.outlookId || ev.id,
          iCalUId:        ev.iCalUId,
          changeKey:      ev.changeKey,
          lastModifiedAt: ev.lastModifiedAt,
          title:          ev.title || '(No subject)',
          startTime:      ev.startTime,
          endTime:        ev.endTime,
          location:       ev.location || '',
          categories:     ev.categories || [],
          isCancelled:    ev.isCancelled || false,
          eventType:      classifyEventType(ev.categories || [], ev.isTeamsMeeting || false),
        };

        if (eventData.isCancelled) {
          cancelled++;
          await db.upsertOutlookEvent(userId, eventData); // soft-deletes locally
        } else {
          knownOutlookIds.push(eventData.outlookId);
          await db.upsertOutlookEvent(userId, eventData);
          upserted++;
        }
      } catch (err) {
        errors++;
        console.error(`❌ Failed to upsert event ${ev.outlookId || ev.id}:`, err.message);
      }
    }

    // ── 3. Reconcile: soft-delete local Outlook records not in the latest fetch ─
    // Threshold-guarded (Phase 3): empty/truncated fetches or abnormal drops
    // block the deletion batch instead of wiping the window.
    const reconcileResult = await db.reconcileOutlookWindowSafe(userId, windowStart, windowEnd, knownOutlookIds, {
      fetchComplete: outlookEvents._fetchComplete !== false,
      source: 'outlook_reconcile',
    });
    const pruned = reconcileResult.pruned;
    if (reconcileResult.blocked) {
      const { recordSafetyBlock } = require('./sync-safety');
      await recordSafetyBlock({ db, storeNotification: storeNotificationLazy }, {
        source: 'outlook_reconcile', reason: reconcileResult.reason,
        stats: reconcileResult.stats, userId,
      });
      console.warn(`🛑 Initial-sync reconcile blocked (${reconcileResult.reason}) — ${reconcileResult.candidateCount} candidate deletions skipped`);
    } else {
      console.log(`🧹 Reconcile: ${pruned.length} stale Outlook records soft-deleted`);
      pruned.forEach(r => console.log(`   ↳ removed: "${r.title}" (${String(r.start_time).slice(0,10)}) outlook_id=${r.outlook_id}`));
    }

    // ── 4. Deduplicate any surviving duplicates ───────────────────────────────
    const deduped = await db.deduplicateOutlookEvents(userId);
    if (deduped.length > 0) {
      console.log(`🔀 Dedup: ${deduped.length} duplicate Outlook records removed`);
    }

    console.log(`✅ Initial sync done — upserted=${upserted}, cancelled=${cancelled}, pruned=${pruned.length}, dupes=${deduped.length}, errors=${errors}`);

    res.json({
      ok: true,
      message: 'Outlook sync completed (reconciled)',
      eventsFromOutlook: outlookEvents.length,
      upserted,
      cancelled,
      staleRemoved: pruned.length,
      duplicatesRemoved: deduped.length,
      errors,
      safety: reconcileResult.blocked
        ? { blocked: true, reason: reconcileResult.reason, skippedDeletions: reconcileResult.candidateCount }
        : { blocked: false },
    });

  } catch (error) {
    console.error('Outlook sync error:', error);
    res.status(500).json({ error: 'Sync failed', details: error.message });
  } finally {
    syncInProgress.delete(userId);
  }
});

// ===== PHASE 3: GET SYNCED EVENTS =====

/**
 * GET /api/events
 * Returns all events in the app calendar
 * Includes both user-created and Outlook-synced events
 */
router.get('/api/events', requireAuth, async (req, res) => {
  try {
    const events = await db.getEvents(req.session.userId);

    res.json({
      count: events.length,
      events: events,
      message: `Retrieved ${events.length} events`
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get events' });
  }
});

/**
 * GET /api/events/outlook-only
 * Returns only Outlook-synced events
 * Useful for showing sync status
 */
router.get('/api/events/outlook-only', requireAuth, async (req, res) => {
  try {
    const events = await db.getEvents(req.session.userId);
    // Events from Outlook have an outlook_id field set
    const outlookEvents = events.filter(e => e.outlook_id);

    res.json({
      count: outlookEvents.length,
      events: outlookEvents,
      message: `${outlookEvents.length} events synced from Outlook`
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get Outlook events' });
  }
});

// ===== PHASE 4: CREATE EVENTS IN APP (LOCAL ONLY) =====

/**
 * POST /api/events
 * Create a new event in the app
 * Does NOT sync to Outlook yet (user has control)
 */
router.post('/api/events', requireAuth, async (req, res) => {
  try {
    const { title, start, end, description, location } = req.body;

    if (!title || !start || !end) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['title', 'start', 'end']
      });
    }

    const event = await db.createEvent(
      req.session.userId,
      {
        title,
        description,
        startTime: start,
        endTime: end,
        location,
        eventType: 'therapy',
        clientName: ''
      }
    );

    res.json({
      message: 'Event created',
      event: event,
      nextStep: 'Event is now in your calendar. You can sync to Outlook when ready.'
    });

  } catch (error) {
    console.error('Event creation error:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// ===== DELTA SYNC (incremental — only what changed since last run) =====

/**
 * POST /api/sync/outlook-delta
 *
 * Called by the background poller every 5 minutes (and can be triggered
 * manually). Uses the stored deltaToken to ask Graph "what changed?" and
 * upserts / deletes only those events. Much faster than a full re-sync.
 *
 * On first call (no stored token) it bootstraps by running a full delta
 * pass to obtain the initial token — no duplicate imports.
 */
router.post('/api/sync/outlook-delta', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await db.getUser(userId);
    const accessToken = await getValidAccessToken(user);
    const state = await db.getDeltaState(userId);
    const storedToken = state ? state.delta_token : null;

    console.log(`🔄 Delta sync for ${req.session.userEmail} (token: ${storedToken ? 'stored' : 'bootstrap'})`);

    let deltaResult;
    try {
      deltaResult = await outlookApi.getOutlookCalendarDelta(accessToken, storedToken);
    } catch (deltaErr) {
      const status = deltaErr.response?.status;
      if ((status === 400 || status === 410) && storedToken) {
        // Stale / invalid delta token — clear it and bootstrap fresh rather than 500ing
        console.warn(`⚠️  Delta token stale (${status}) — clearing and re-bootstrapping`);
        await db.saveDeltaState(userId, null);
        deltaResult = await outlookApi.getOutlookCalendarDelta(accessToken, null);
      } else {
        throw deltaErr;
      }
    }
    const { changed, deleted, deltaToken: newToken } = deltaResult;

    let upserted = 0, cancelled = 0, removed = 0;

    for (const ev of changed) {
      if (ev.isCancelled) {
        // isCancelled = organizer cancelled the meeting — soft-delete locally.
        const gone = await db.softDeleteEventByOutlookId(userId, ev.outlookId);
        if (gone) { cancelled++; console.log(`🚫 Cancelled: "${ev.title}" (${ev.outlookId})`); }
      } else {
        await db.upsertOutlookEvent(userId, {
          ...ev,
          eventType: classifyEventType(ev.categories || [], ev.isTeamsMeeting || false),
        });
        upserted++;
      }
    }

    // @removed = event hard-deleted in Outlook — behind the deletion-volume
    // guard. When blocked, the delta token is NOT saved so the same deletions
    // are re-presented next sync (nothing is silently lost).
    let safety = { blocked: false };
    if (deleted.length > 0) {
      const { assessDeletionSafety, recordSafetyBlock } = require('./sync-safety');
      const linked = await db.pool.query(
        `SELECT COUNT(*) AS n FROM events
         WHERE user_id = $1 AND source = 'outlook' AND outlook_id IS NOT NULL
           AND (is_deleted IS NULL OR is_deleted = FALSE)`, [userId]);
      const verdict = assessDeletionSafety({
        source: 'outlook_delta',
        fetchComplete: !!newToken,
        liveCount: Number(linked.rows[0].n) - deleted.length,
        deletionCandidates: deleted.length,
        localLinkedCount: Number(linked.rows[0].n),
      });
      if (!verdict.safe) {
        safety = { blocked: true, reason: verdict.reason, skippedDeletions: deleted.length };
        await recordSafetyBlock({ db, storeNotification: storeNotificationLazy }, {
          source: 'outlook_delta', reason: verdict.reason, stats: verdict.stats, userId,
        });
      }
    }
    if (!safety.blocked) {
      for (const outlookId of deleted) {
        const gone = await db.softDeleteEventByOutlookId(userId, outlookId);
        if (gone) {
          removed++;
          console.log(`🗑️  Deleted from Outlook: ${outlookId}`);
        }
      }
    }

    if (newToken && !safety.blocked) {
      await db.saveDeltaState(userId, newToken);
    }

    console.log(`✅ Delta sync done — upserted=${upserted}, cancelled=${cancelled}, removed=${removed}${safety.blocked ? ` (⛔ ${safety.skippedDeletions} deletions blocked: ${safety.reason})` : ''}`);

    res.json({
      ok: true,
      upserted,
      cancelled,
      removed,
      safety,
      message: `Delta sync complete: ${upserted} updated, ${cancelled} cancelled, ${removed} removed`
    });

  } catch (err) {
    console.error('Delta sync error:', err.message);
    res.status(500).json({ error: 'Delta sync failed', details: err.message });
  }
});

// ===== OUTLOOK WEBHOOK ENDPOINT =====
// Receives real-time change notifications from Microsoft Graph.
// Requires WEBHOOK_BASE_URL + WEBHOOK_CLIENT_STATE env vars to be configured
// and a publicly accessible HTTPS URL (not usable on localhost).
//
// Flow:
//   1. On subscription creation, Graph sends a validation POST with ?validationToken
//      — we must echo it back as text/plain within a few seconds.
//   2. For subsequent change notifications, Graph posts a JSON body with
//      subscription details. We verify clientState then run a targeted delta sync.

router.post(
  '/api/webhooks/outlook',
  require('express').raw({ type: '*/*' }),   // raw body — Graph sends JSON as text
  async (req, res) => {
    // Step 1 — subscription validation
    if (req.query.validationToken) {
      return res
        .set('Content-Type', 'text/plain; charset=utf-8')
        .send(req.query.validationToken);
    }

    // Respond 202 immediately — Graph requires < 3 s response time
    res.sendStatus(202);

    // Step 2 — process notification payload asynchronously
    setImmediate(async () => {
      try {
        const body          = JSON.parse(req.body.toString('utf8'));
        const notifications = body.value || [];
        const clientState   = process.env.WEBHOOK_CLIENT_STATE || 'opal-scheduler-webhook';

        for (const notification of notifications) {
          if (notification.clientState !== clientState) continue;

          // Look up the user from the in-memory subscription map (populated in server.js)
          const { _webhookSubscriptions } = require('./server');
          const userId = _webhookSubscriptions?.get(notification.subscriptionId);
          if (!userId) continue;

          // Trigger an immediate delta sync for this user so changes appear at once
          console.log(`🔔 Webhook notification received — triggering delta sync for ${userId}`);
          const { rows } = await db.pool.query(
            'SELECT id, email, access_token, refresh_token, token_expires_at FROM users WHERE id = $1',
            [userId]
          );
          if (!rows.length) continue;

          const outlookApi  = require('./outlook-oauth');
          const state       = await db.getDeltaState(userId);
          let   storedToken = state?.delta_token || null;
          const user        = rows[0];
          let   accessToken;
          try {
            if (!user.access_token) throw new Error('no token');
            const exp = user.token_expires_at ? new Date(user.token_expires_at) : null;
            if (!exp || (exp - Date.now()) < 60000) {
              const refreshed = await outlookApi.refreshAccessToken(user.refresh_token);
              await db.updateUserTokens(userId, refreshed.accessToken, refreshed.refreshToken, refreshed.expiresIn);
              accessToken = refreshed.accessToken;
            } else {
              accessToken = user.access_token;
            }
          } catch (_) { continue; }

          try {
            const { changed, deleted, deltaToken: newToken } =
              await outlookApi.getOutlookCalendarDelta(accessToken, storedToken);

            let upserted = 0, removed = 0;
            const BATCH = 20;
            for (let i = 0; i < changed.length; i += BATCH) {
              await Promise.all(changed.slice(i, i + BATCH).map(async ev => {
                if (ev.isCancelled) { await db.softDeleteEventByOutlookId(userId, ev.outlookId); }
                else                {
                  await db.upsertOutlookEvent(userId, {
                    ...ev,
                    eventType: classifyEventType(ev.categories || [], ev.isTeamsMeeting || false),
                  });
                  upserted++;
                }
              }));
            }
            // Deletion-volume guard (same as the poller): blocked ⇒ skip the
            // batch AND skip the token save so deletions re-present next sync.
            let webhookDeleteBlocked = false;
            if (deleted.length > 0) {
              const { assessDeletionSafety, recordSafetyBlock } = require('./sync-safety');
              const linked = await db.pool.query(
                `SELECT COUNT(*) AS n FROM events
                 WHERE user_id = $1 AND source = 'outlook' AND outlook_id IS NOT NULL
                   AND (is_deleted IS NULL OR is_deleted = FALSE)`, [userId]);
              const verdict = assessDeletionSafety({
                source: 'outlook_delta',
                fetchComplete: !!newToken,
                liveCount: Number(linked.rows[0].n) - deleted.length,
                deletionCandidates: deleted.length,
                localLinkedCount: Number(linked.rows[0].n),
              });
              if (!verdict.safe) {
                webhookDeleteBlocked = true;
                await recordSafetyBlock({ db, storeNotification: storeNotificationLazy }, {
                  source: 'outlook_delta', reason: verdict.reason, stats: verdict.stats, userId,
                });
              }
            }
            if (!webhookDeleteBlocked) {
              for (let i = 0; i < deleted.length; i += BATCH) {
                await Promise.all(deleted.slice(i, i + BATCH).map(async id => {
                  const g = await db.softDeleteEventByOutlookId(userId, id);
                  if (g) removed++;
                }));
              }
            }
            if (newToken && !webhookDeleteBlocked) await db.saveDeltaState(userId, newToken);
            console.log(`✅ Webhook delta sync: +${upserted} updated, -${removed} removed`);

            const { io } = require('./server');
            if (upserted > 0 || removed > 0) {
              io.to(`user:${userId}`).emit('calendarUpdated', { upserted, cancelled: 0, removed });
            }
          } catch (deltaErr) {
            // Stale token — clear so next poll re-bootstraps
            if (deltaErr.response?.status === 400 || deltaErr.response?.status === 410) {
              await db.saveDeltaState(userId, null);
            }
          }
        }
      } catch (err) {
        console.error('⚠️  Webhook processing error:', err.message);
      }
    });
  }
);

// ===== SYNC STATUS =====

/**
 * GET /api/sync-status
 * Check if Outlook is connected and last sync time
 */
router.get('/api/sync-status', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    const events = await db.getEvents(req.session.userId);
    const outlookEvents = events.filter(e => e.outlook_id);

    // Report connected if the caller has a token OR any org member does
    // (owner/admin accounts often have no personal token but manage a connected therapist)
    let outlookConnected = !!user.access_token;
    let connectedEmail   = user.access_token ? user.email : null;
    if (!outlookConnected) {
      const orgId = user.organisation_id;
      const fallback = await db.pool.query(
        `SELECT email FROM users
         WHERE access_token IS NOT NULL AND access_token != ''
           AND is_active = true
           AND (organisation_id IS NOT DISTINCT FROM $1 OR $1 IS NULL)
         ORDER BY created_at LIMIT 1`,
        [orgId]
      );
      if (fallback.rows.length) {
        outlookConnected = true;
        connectedEmail   = fallback.rows[0].email;
      }
    }

    res.json({
      outlookConnected,
      connectedAs:        connectedEmail,
      totalEvents:        events.length,
      outlookSyncedEvents: outlookEvents.length,
      status:  outlookEvents.length > 0 ? 'synced' : 'not_synced',
      message: outlookEvents.length > 0
        ? `${outlookEvents.length} events synced from Outlook`
        : 'No Outlook events synced yet',
    });
  } catch (error) {
    console.error('Sync status error:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

/**
 * GET /api/sync/diagnostics
 *
 * Returns a health snapshot of the local sync state:
 * - Outlook event counts, ghost candidates, possible duplicates
 * - Last 10 sync_log errors
 *
 * Useful for diagnosing sync drift without reading the full DB.
 */
router.get('/api/sync/diagnostics', requireAuth, async (req, res) => {
  try {
    const pool = db.pool;

    // Overall event stats
    const statsResult = await pool.query(`
      SELECT
        COUNT(*)                                                          AS "totalEvents",
        COUNT(*) FILTER (WHERE is_deleted IS NOT TRUE)                   AS "activeEvents",
        COUNT(*) FILTER (WHERE is_deleted = TRUE)                        AS "deletedEvents",
        COUNT(*) FILTER (WHERE outlook_id IS NULL AND is_deleted IS NOT TRUE) AS "eventsWithoutOutlookId",
        COUNT(*) FILTER (WHERE splose_id  IS NULL AND is_deleted IS NOT TRUE) AS "eventsWithoutSploseId"
      FROM events
    `);

    // Possible duplicates — same outlook_id appearing more than once
    const dupResult = await pool.query(`
      SELECT outlook_id, COUNT(*) AS count, ARRAY_AGG(id) AS event_ids
      FROM events
      WHERE outlook_id IS NOT NULL
      GROUP BY outlook_id
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 20
    `);

    // Ghost candidates — active Outlook-sourced events not synced in the last 3 hours
    const ghostResult = await pool.query(`
      SELECT COUNT(*) AS "ghostCandidates"
      FROM events
      WHERE source = 'outlook'
        AND (is_deleted IS NULL OR is_deleted = FALSE)
        AND outlook_id IS NOT NULL
        AND (synced_at IS NULL OR synced_at < NOW() - INTERVAL '3 hours')
    `);

    // Last 10 sync_log errors
    const errResult = await pool.query(`
      SELECT id, event_id, action, source, target, error_message, created_at
      FROM sync_log
      WHERE status = 'error'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // Last delta sync timestamp per user
    const deltaResult = await pool.query(`
      SELECT u.email, d.last_synced_at
      FROM outlook_delta_state d
      JOIN users u ON u.id = d.user_id
      ORDER BY d.last_synced_at DESC NULLS LAST
      LIMIT 1
    `);

    const stats = statsResult.rows[0];
    const { syncSafetyState } = require('./sync-safety');
    res.json({
      syncSafety: syncSafetyState,
      outlookSync: {
        lastSyncAt:             deltaResult.rows[0]?.last_synced_at || null,
        totalEvents:            Number(stats.totalEvents),
        activeEvents:           Number(stats.activeEvents),
        deletedEvents:          Number(stats.deletedEvents),
        eventsWithoutOutlookId: Number(stats.eventsWithoutOutlookId),
        eventsWithoutSploseId:  Number(stats.eventsWithoutSploseId),
      },
      possibleDuplicates: dupResult.rows,
      ghostCandidates:    Number(ghostResult.rows[0]?.ghostCandidates || 0),
      syncErrors:         errResult.rows,
    });
  } catch (err) {
    console.error('Sync diagnostics error:', err.message);
    res.status(500).json({ error: 'Failed to get sync diagnostics', details: err.message });
  }
});

/**
 * GET /api/sync/reconcile?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * DEV TOOL — calendar comparison report.
 * Fetches live Outlook events for the given date range, compares them against
 * the local DB, and returns a structured diff showing matched, missing, stale,
 * duplicate, cancelled, and app-created records.
 * Useful for diagnosing why the app calendar differs from Outlook.
 */
router.get('/api/sync/reconcile', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }

    const user = await db.getUser(userId);
    const accessToken = await getValidAccessToken(user);

    const windowStart = new Date(startDate + 'T00:00:00Z').toISOString();
    const windowEnd   = new Date(endDate   + 'T23:59:59Z').toISOString();

    // 1. Live Outlook events for the window
    const outlookEvents = await outlookApi.getOutlookCalendarEvents(accessToken, windowStart, windowEnd);
    const outlookMap = new Map();
    for (const ev of outlookEvents) {
      outlookMap.set(ev.outlookId || ev.id, ev);
    }

    // 2. Local DB records for the window (including soft-deleted, so we can surface them)
    const allLocal = await db.pool.query(`
      SELECT * FROM events
      WHERE user_id = $1
        AND start_time >= $2 AND start_time <= $3
      ORDER BY start_time ASC
    `, [userId, windowStart, windowEnd]);

    const rows = allLocal.rows;

    // 3. Build the report
    const report = {
      window: { startDate, endDate },
      summary: { outlook: outlookEvents.length, local: rows.length },
      items: [],
    };

    const seenOutlookIds = new Set();

    for (const local of rows) {
      const oid = local.outlook_id;
      const outlookMatch = oid ? outlookMap.get(oid) : null;
      seenOutlookIds.add(oid);

      let status;
      if (local.is_deleted) {
        status = outlookMatch ? 'soft_deleted_but_in_outlook' : 'soft_deleted';
      } else if (local.source === 'app' && !oid) {
        status = 'app_only';
      } else if (local.source === 'app' && oid && !outlookMatch) {
        status = 'app_created_outlook_deleted';
      } else if (!oid) {
        status = 'no_outlook_id';
      } else if (!outlookMatch) {
        status = 'stale_missing_in_outlook';
      } else {
        const titleMatch   = (local.title || '') === (outlookMatch.title || '');
        const startMatch   = String(local.start_time).slice(0,19) === String(outlookMatch.startTime || '').slice(0,19);
        const changedFields = [];
        if (!titleMatch) changedFields.push('title');
        if (!startMatch) changedFields.push('start_time');
        status = changedFields.length > 0 ? 'matched_with_diff' : 'matched';
      }

      report.items.push({
        status,
        local: {
          id:          local.id,
          source:      local.source,
          is_deleted:  local.is_deleted,
          title:       local.title,
          start:       local.start_time,
          end:         local.end_time,
          outlook_id:  local.outlook_id,
          ical_uid:    local.outlook_ical_uid,
          change_key:  local.outlook_change_key,
          synced_at:   local.synced_at,
        },
        outlook: outlookMatch ? {
          id:          outlookMatch.outlookId || outlookMatch.id,
          iCalUId:     outlookMatch.iCalUId,
          changeKey:   outlookMatch.changeKey,
          title:       outlookMatch.title,
          start:       outlookMatch.startTime,
          end:         outlookMatch.endTime,
          isCancelled: outlookMatch.isCancelled,
          showAs:      outlookMatch.showAs,
          type:        outlookMatch.type,
          lastModifiedAt: outlookMatch.lastModifiedAt,
        } : null,
      });
    }

    // 4. Outlook events with no matching local record
    for (const [oid, ev] of outlookMap) {
      if (!seenOutlookIds.has(oid)) {
        report.items.push({
          status: ev.isCancelled ? 'outlook_cancelled_no_local' : 'in_outlook_missing_locally',
          local: null,
          outlook: {
            id:          ev.outlookId || ev.id,
            iCalUId:     ev.iCalUId,
            changeKey:   ev.changeKey,
            title:       ev.title,
            start:       ev.startTime,
            end:         ev.endTime,
            isCancelled: ev.isCancelled,
            showAs:      ev.showAs,
            type:        ev.type,
            lastModifiedAt: ev.lastModifiedAt,
          },
        });
      }
    }

    // Sort by start time
    report.items.sort((a, b) => {
      const ta = a.local?.start || a.outlook?.start || '';
      const tb = b.local?.start || b.outlook?.start || '';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    // Compute summary counts
    const counts = {};
    for (const item of report.items) {
      counts[item.status] = (counts[item.status] || 0) + 1;
    }
    report.summary.byStatus = counts;

    console.log(`🔍 Reconcile (${startDate} → ${endDate}): ${JSON.stringify(counts)}`);
    res.json(report);

  } catch (err) {
    console.error('Reconcile error:', err.message);
    res.status(500).json({ error: 'Reconcile failed', details: err.message });
  }
});

/**
 * POST /api/sync/cleanup
 *
 * ONE-TIME CLEANUP — soft-deletes all local Outlook-sourced records that are
 * not present in the current Outlook calendar (full 4-year window). Preserves
 * app-created events. Safe to run multiple times. Returns a summary log.
 */
router.post('/api/sync/cleanup', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
    const user = await db.getUser(userId);
    const accessToken = await getValidAccessToken(user);

    const now = new Date();
    const windowStart = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).toISOString();
    const windowEnd   = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()).toISOString();

    console.log(`🧹 Running one-time cleanup for ${user.email}${dryRun ? ' (DRY RUN)' : ''}…`);

    // Fetch full Outlook event set
    const outlookEvents = await outlookApi.getOutlookCalendarEvents(accessToken, windowStart, windowEnd);
    const knownIds = outlookEvents
      .filter(ev => !ev.isCancelled)
      .map(ev => ev.outlookId || ev.id);

    // Safety gate: refuse batch deletion on empty/truncated fetches. Cleanup is
    // manual and intentionally allowed to exceed the automatic-cycle volume
    // thresholds, but never on unusable upstream evidence.
    if (outlookEvents._fetchComplete === false || knownIds.length === 0) {
      const { recordSafetyBlock } = require('./sync-safety');
      const reason = knownIds.length === 0 ? 'empty_remote_result' : 'incomplete_fetch';
      await recordSafetyBlock({ db, storeNotification: storeNotificationLazy }, {
        source: 'cleanup', reason,
        stats: { liveCount: knownIds.length, fetchComplete: outlookEvents._fetchComplete !== false, deletionCandidates: null, localLinkedCount: null },
        userId,
      });
      return res.status(409).json({ ok: false, blocked: true, reason,
        message: 'Cleanup refused: Outlook returned an empty or truncated event list. No events were deleted.' });
    }

    // Dry run: report what WOULD be removed, change nothing.
    if (dryRun) {
      const { rows: wouldDelete } = await db.pool.query(`
        SELECT id, title, outlook_id, start_time FROM events
        WHERE user_id = $1 AND source = 'outlook' AND outlook_id IS NOT NULL
          AND (is_deleted IS NULL OR is_deleted = FALSE)
          AND outlook_id != ALL($2::text[])
      `, [userId, knownIds]);
      return res.json({
        ok: true, dryRun: true,
        wouldRemoveStale: wouldDelete.length,
        wouldRemoveCancelled: outlookEvents.filter(e => e.isCancelled).length,
        staleSample: wouldDelete.slice(0, 20).map(r => ({ title: r.title, start: r.start_time })),
      });
    }

    // Mark cancelled Outlook events as deleted locally
    let cancelledCount = 0;
    for (const ev of outlookEvents.filter(e => e.isCancelled)) {
      const r = await db.softDeleteEventByOutlookId(userId, ev.outlookId || ev.id);
      if (r) cancelledCount++;
    }

    // Soft-delete all stale Outlook-sourced local records
    const staleRows = await db.cleanupStaleOutlookEvents(userId, knownIds);

    // Dedup duplicates
    const dupeRows = await db.deduplicateOutlookEvents(userId);

    const log = staleRows.map(r => ({ title: r.title, outlook_id: r.outlook_id, start: r.start_time }));

    console.log(`✅ Cleanup complete: ${staleRows.length} stale, ${cancelledCount} cancelled, ${dupeRows.length} dupes removed`);
    if (log.length > 0) {
      log.forEach(r => console.log(`   ↳ "${r.title}" (${String(r.start).slice(0,10)}) ${r.outlook_id}`));
    }

    res.json({
      ok: true,
      staleRemoved: staleRows.length,
      cancelledRemoved: cancelledCount,
      duplicatesRemoved: dupeRows.length,
      removedEvents: log,
    });

  } catch (err) {
    console.error('Cleanup error:', err.message);
    res.status(500).json({ error: 'Cleanup failed', details: err.message });
  }
});

/**
 * GET /api/outlook/categories
 * Returns the user's Outlook master category list with colour presets.
 * Used to colour-code calendar events using Ann's own Outlook category scheme.
 */
router.get('/api/outlook/categories', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    const accessToken = await getValidAccessToken(user);
    const axios = require('axios');
    const response = await axios.get('https://graph.microsoft.com/v1.0/me/outlook/masterCategories', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });
    res.json({ data: response.data.value || [] });
  } catch (err) {
    console.error('Outlook categories error:', err.message);
    res.status(500).json({ error: 'Failed to fetch Outlook categories', details: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  SPLOSE API ROUTES
//  All routes are auth-guarded and proxy to the Splose v1 API.
//  The frontend never calls Splose directly — all calls go
//  through here so the API key stays server-side.
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/splose/status
 * Quick connection test — confirms key is valid.
 */
router.get('/api/splose/status', requireAuth, async (req, res) => {
  const userId = req.user?.id || req.session?.userId;
  try {
    const result = await sploseApi.testConnection();
    recordSploSuccess();
    res.json({ ...result, syncState: sploSyncState });
  } catch (err) {
    recordSploFailure(err.message);
    if (userId) {
      storeNotificationLazy(userId, {
        type: 'splose_sync_failed',
        title: 'Splose connection failed',
        message: `Could not connect to Splose: ${err.message}. Calendar data may be out of date. Check Settings → Integrations.`,
        severity: 'error',
        relatedEntity: 'integration',
        actionPayload: { action: 'retry_splose_sync', path: '/api/splose/status' },
      }).catch(() => {});
    }
    res.status(500).json({ ok: false, message: err.message, syncState: sploSyncState });
  }
});

/**
 * GET /api/splose/sync-status
 * Returns current in-process Splose sync health without triggering a live call.
 */
router.get('/api/splose/sync-status', requireAuth, (req, res) => {
  res.json(sploSyncState);
});

/**
 * GET /api/splose/services
 * Returns all services (appointment + support-activity types).
 */
router.get('/api/splose/services', requireAuth, async (req, res) => {
  try {
    const services = await sploseApi.getServices();
    res.json({ data: services });
  } catch (err) {
    console.error('Splose services error:', err.message);
    res.status(500).json({ error: 'Failed to fetch services', details: err.message });
  }
});

/**
 * GET /api/splose/practitioners
 */
router.get('/api/splose/practitioners', requireAuth, async (req, res) => {
  try {
    const practitioners = await sploseApi.getPractitioners();
    res.json({ data: practitioners });
  } catch (err) {
    console.error('Splose practitioners error:', err.message);
    res.status(500).json({ error: 'Failed to fetch practitioners', details: err.message });
  }
});

/**
 * GET /api/splose/locations
 */
router.get('/api/splose/locations', requireAuth, async (req, res) => {
  try {
    const locations = await sploseApi.getLocations();
    res.json({ data: locations });
  } catch (err) {
    console.error('Splose locations error:', err.message);
    res.status(500).json({ error: 'Failed to fetch locations', details: err.message });
  }
});

/**
 * Build a formatted address string from an object that may have address components
 * under several possible field names (Splose has changed these across versions).
 * Returns null if not enough information is present.
 */
function buildFormattedAddress(obj) {
  if (!obj) return null;

  // Try a pre-built formatted address first
  if (obj.formattedAddress && obj.formattedAddress.trim()) return obj.formattedAddress.trim();

  // Gather components, trying every possible field name
  const street = obj.addressL1 || obj.address || obj.streetAddress || obj.addressLine1 || obj.street || null;
  const suburb = obj.suburb    || obj.city    || obj.town          || null;
  const state  = obj.state     || obj.province || null;
  const post   = obj.postalCode|| obj.postcode || obj.zip          || null;

  const parts = [street, suburb, state, post].filter(Boolean);
  if (parts.length === 0) return null;

  return parts.join(', ');
}

/**
 * Determine whether a formatted address string is suitable for Google Maps routing.
 * A valid routing address needs at least a street name and suburb/city.
 * We deliberately do NOT require a postcode, state abbreviation, or house number —
 * "Smith Street, Willetton" is good enough for Maps to geocode.
 */
function isRoutableAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const clean = addr.trim();
  if (clean.length < 6) return false;                 // too short to be meaningful
  if (/^(unknown|n\/a|none|tbc|tbd|-+)$/i.test(clean)) return false;
  // Must contain at least one comma (street, suburb) OR two or more words
  return clean.includes(',') || clean.split(/\s+/).length >= 3;
}

/**
 * GET /api/splose/appointments?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&practitionerId=...
 */
router.get('/api/splose/appointments', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, practitionerId } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }

    // Fetch appointments first (required), everything else in parallel (non-fatal for enrichment)
    const appointments = await sploseApi.getAppointments(startDate, endDate, practitionerId || null);
    let patients = [], suppItems = [], locations = [];
    await Promise.allSettled([
      sploseApi.getPatients().then(r => { patients  = r; }).catch(e => console.warn('patients fetch (non-fatal):', e.message)),
      sploseApi.getSupportItems().then(r => { suppItems = r; }).catch(() => {}),
      sploseApi.getLocations().then(r => { locations = r; }).catch(() => {}),
    ]);

    // Build lookup maps
    const patientMap = {};
    patients.forEach(p => { patientMap[p.id] = p; });

    // locationId → { title, address, suburb, state, postalCode }
    const locationMap = {};
    locations.forEach(l => { locationMap[l.id] = l; });

    // Map appointmentId → appointmentAddress from support items (Splose billing address)
    // Support items sometimes carry the actual visit address on NDIS claims.
    const travelAddressMap = {};
    suppItems.forEach(s => {
      // Try every plausible field name for the appointment-level address
      const addr = s.appointmentAddress || s.serviceAddress || s.visitAddress || s.travelAddress || null;
      const apptId = s.appointmentId || s.appointment_id || null;
      if (apptId && addr) travelAddressMap[String(apptId)] = addr;
    });

    // Enrich each appointment
    const enriched = appointments.map(appt => {
      const patientId = appt.patients?.[0]?.patientId;
      const patient   = patientId ? patientMap[patientId] : null;
      const location  = appt.locationId ? locationMap[appt.locationId] : null;

      // ── Splose venue/clinic location ──────────────────────────────────────
      // This is WHERE the session is booked (e.g. the clinic room), NOT necessarily
      // where Ann needs to drive. For mobile visits this may be a "Mobile" type
      // location with no useful address.
      const locationAddress = location ? buildFormattedAddress(location) : null;
      const locationIsMobile = location &&
        /\b(mobile|home visit|community|client.?s?\s*home|client\s*address)\b/i.test(location.title || '');

      // ── Patient home address ──────────────────────────────────────────────
      // Built from every possible Splose patient address field.
      const patientAddress = patient ? buildFormattedAddress(patient) : null;

      // Log what we found for diagnosis (only on first call to avoid log spam)
      if (patient && !patientAddress) {
        console.warn(`[location-debug] Patient ${patient.id} (${patient.firstname} ${patient.lastname}) — no address found. Raw fields:`, patient._rawAddressFields);
      }

      // ── Billing/travel address from support items ─────────────────────────
      const travelAddress = travelAddressMap[String(appt.id)] || null;

      // ── Best routing address (priority order) ─────────────────────────────
      // 1. Splose billing/travel address (recorded on NDIS claim — most accurate)
      // 2. Patient home address (where mobile visits go)
      // 3. Venue/clinic location — ONLY if it's not a mobile/generic placeholder
      const routingAddress = travelAddress
        || patientAddress
        || (!locationIsMobile ? locationAddress : null)
        || null;

      // Address source label for the frontend
      const addressSource = travelAddress   ? 'splose_billing'
        : patientAddress   ? 'patient_record'
        : locationAddress && !locationIsMobile ? 'splose_location'
        : 'none';

      // Routing validity
      const isRoutable = isRoutableAddress(routingAddress);

      // Missing reason (shown in the detail panel)
      const missingReason = isRoutable ? null
        : travelAddress   ? 'Splose billing address present but not routable'
        : patientAddress  ? 'Patient address present but incomplete (no street address?)'
        : locationIsMobile ? 'Splose location is Mobile — patient address needed'
        : locationAddress  ? 'Splose venue address found but patient-home address unavailable'
        : !patient         ? 'No patient linked to this appointment'
        : 'No address found in Splose (check patient profile)';

      return {
        ...appt,
        patientName:      patient ? `${patient.firstname} ${patient.lastname}` : null,
        // Structured address components
        patientAddress:   patientAddress  || null,
        patientAddressComponents: patient ? {
          street:   patient.addressL1  || null,
          suburb:   patient.suburb     || null,
          state:    patient.state      || null,
          postcode: patient.postalCode || null,
        } : null,
        suburb:           patient?.suburb     || location?.suburb     || null,
        postalCode:       patient?.postalCode || location?.postalCode || null,
        state:            patient?.state      || location?.state      || null,
        // Splose venue context
        locationName:     location?.title     || null,
        locationAddress:  locationAddress     || null,
        locationSuburb:   location?.suburb    || null,
        locationIsMobile: locationIsMobile    || false,
        // Routing fields
        travelAddress,
        routingAddress,
        addressSource,
        isRoutable,
        missingReason:    isRoutable ? null : missingReason,
        // Diagnostic: raw address fields from patient record
        _patientRawAddress: process.env.NODE_ENV !== 'production' ? patient?._rawAddressFields : undefined,
      };
    });

    recordSploSuccess();
    res.json({ data: enriched, count: enriched.length });
  } catch (err) {
    console.error('Splose appointments error:', err.message);
    recordSploFailure(err.message);
    const userId = req.user?.id || req.session?.userId;
    if (userId) {
      storeNotificationLazy(userId, {
        type: 'splose_sync_failed',
        title: 'Splose appointment sync failed',
        message: `Calendar data could not be loaded from Splose: ${err.message}. You may be viewing stale data.`,
        severity: 'error',
        relatedEntity: 'integration',
        actionPayload: { action: 'retry_splose_sync' },
      }).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to fetch appointments', details: err.message });
  }
});

/**
 * GET /api/splose/debug/raw-appointment/:id
 * Returns the completely unmodified Splose API response for one appointment.
 * Use this to see exactly what fields Splose sends without any app mapping.
 * Dev/diagnostic only — requires auth.
 */
router.get('/api/splose/debug/raw-appointment/:id', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const c = sploseApi._client ? sploseApi._client() : null;
    if (!c) {
      // Fallback: use axios directly with the same config
      const axios = require('axios');
      const response = await axios.get(
        `${(process.env.SPLOSE_BASE_URL || 'https://api.splose.com')}/v1/appointments/${req.params.id}`,
        { headers: { Authorization: `Bearer ${process.env.SPLOSE_API_KEY}` } }
      );
      return res.json({ raw: response.data, source: 'direct-axios' });
    }
    const response = await c.get(`/appointments/${req.params.id}`);
    res.json({ raw: response.data, source: 'splose-client' });
  } catch (err) {
    res.status(500).json({ error: err.message, status: err.response?.status });
  }
});

/**
 * GET /api/splose/debug/raw-patient/:id
 * Returns the completely unmodified Splose API response for one patient.
 * This is the primary diagnostic for seeing which address fields Splose actually sends.
 */
router.get('/api/splose/debug/raw-patient/:id', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get(
      `${(process.env.SPLOSE_BASE_URL || 'https://api.splose.com')}/v1/patients/${req.params.id}`,
      { headers: { Authorization: `Bearer ${process.env.SPLOSE_API_KEY}` } }
    );
    const raw = response.data;
    // Highlight all address-related fields so it's easy to spot in the response
    const addressFields = {};
    const addressKeys = ['address', 'addressL1', 'addressL2', 'addressLine1', 'addressLine2',
      'streetAddress', 'street', 'suburb', 'city', 'town', 'state', 'province',
      'postalCode', 'postcode', 'zip', 'country', 'formattedAddress',
      'homeAddress', 'serviceAddress', 'billingAddress', 'primaryAddress',
      'location', 'locationText'];
    addressKeys.forEach(k => { if (raw[k] !== undefined) addressFields[k] = raw[k]; });

    res.json({
      patientId: req.params.id,
      addressFieldsFound: addressFields,
      allFields: Object.keys(raw),
      raw,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, status: err.response?.status });
  }
});

/**
 * GET /api/splose/debug/location-report?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Returns a full location diagnostic table for every appointment in the date range.
 * Shows exactly why each appointment is or isn't routable.
 */
router.get('/api/splose/debug/location-report', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

    const appointments = await sploseApi.getAppointments(startDate, endDate, null);
    let patients = [], locations = [], suppItems = [];
    await Promise.allSettled([
      sploseApi.getPatients().then(r => { patients  = r; }).catch(() => {}),
      sploseApi.getLocations().then(r => { locations = r; }).catch(() => {}),
      sploseApi.getSupportItems().then(r => { suppItems = r; }).catch(() => {}),
    ]);

    const patientMap  = Object.fromEntries(patients.map(p => [p.id, p]));
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
    const travelMap   = {};
    suppItems.forEach(s => {
      const addr = s.appointmentAddress || s.serviceAddress || s.visitAddress || null;
      const id   = s.appointmentId || s.appointment_id;
      if (id && addr) travelMap[String(id)] = addr;
    });

    const report = appointments.map(appt => {
      const patient  = patientMap[appt.patients?.[0]?.patientId] || null;
      const location = locationMap[appt.locationId] || null;
      const patientAddr   = patient  ? buildFormattedAddress(patient)  : null;
      const locationAddr  = location ? buildFormattedAddress(location) : null;
      const travelAddr    = travelMap[String(appt.id)] || null;
      const routingAddr   = travelAddr || patientAddr || locationAddr || null;

      return {
        appointmentId:      appt.id,
        start:              appt.start,
        patientName:        patient ? `${patient.firstname} ${patient.lastname}` : '(no patient)',
        patientId:          patient?.id || null,
        sploselLocationName: location?.title || null,
        sploselLocationId:   appt.locationId || null,
        // What Splose actually has
        rawPatientAddressFields: patient?._rawAddressFields || null,
        // What we built
        patientFormattedAddress: patientAddr,
        locationFormattedAddress: locationAddr,
        travelAddressFromBilling: travelAddr,
        resolvedRoutingAddress:   routingAddr,
        addressSource: travelAddr ? 'splose_billing' : patientAddr ? 'patient_record' : locationAddr ? 'splose_location' : 'none',
        isRoutable:   isRoutableAddress(routingAddr),
        missingReason: isRoutableAddress(routingAddr) ? null : (
          !patient ? 'no patient linked' :
          !patientAddr && !patient?._rawAddressFields?.suburb ? 'patient has no address in Splose' :
          patientAddr ? 'partial address (no street?)' :
          patient?._rawAddressFields?.suburb ? 'suburb only — no street address in Splose' :
          'unknown'
        ),
      };
    });

    res.json({ count: report.length, report });
  } catch (err) {
    console.error('location-report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/splose/appointments/:id
 */
router.get('/api/splose/appointments/:id', requireAuth, async (req, res) => {
  try {
    const appointment = await sploseApi.getAppointment(req.params.id);
    res.json(appointment);
  } catch (err) {
    console.error('Splose appointment error:', err.message);
    res.status(500).json({ error: 'Failed to fetch appointment', details: err.message });
  }
});

/**
 * POST /api/splose/appointments
 * Create a new appointment in Splose.
 * Body: { start, end, serviceId, locationId, practitionerId, patientId, caseId, note? }
 */
router.post('/api/splose/appointments', requireAuth, async (req, res) => {
  try {
    const { start, end, serviceId, locationId, practitionerId, patientId, caseId, note } = req.body;
    if (!start || !end || !serviceId || !locationId || !practitionerId || !patientId || !caseId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['start', 'end', 'serviceId', 'locationId', 'practitionerId', 'patientId', 'caseId'],
      });
    }
    const appointment = await sploseApi.createAppointment(req.body);
    console.log(`✅ Appointment created in Splose: ${appointment.id}`);
    res.status(201).json(appointment);
  } catch (err) {
    console.error('Splose create appointment error:', err.message);
    res.status(500).json({ error: 'Failed to create appointment in Splose', details: err.message });
  }
});

/**
 * PUT /api/splose/appointments/:id
 * Update (reschedule) an appointment.
 */
router.put('/api/splose/appointments/:id', requireAuth, async (req, res) => {
  try {
    const appointment = await sploseApi.updateAppointment(req.params.id, req.body);
    res.json(appointment);
  } catch (err) {
    console.error('Splose update appointment error:', err.message);
    res.status(500).json({ error: 'Failed to update appointment', details: err.message });
  }
});

/**
 * GET /api/splose/busy-time-types
 * Returns the list of busy-time type objects { id, title, colour } from Splose.
 * These IDs are required when creating busy-time blocks — they are NOT the same
 * as service IDs used for client appointments.
 */
router.get('/api/splose/busy-time-types', requireAuth, async (req, res) => {
  try {
    const types = await sploseApi.getBusyTimeTypes();
    res.json({ data: types });
  } catch (err) {
    console.error('Splose busy-time-types error:', err.message);
    res.status(500).json({ error: 'Failed to fetch busy-time types', details: err.message });
  }
});

/**
 * GET /api/splose/busy-times?startDate=...&endDate=...&practitionerId=...
 */
router.get('/api/splose/busy-times', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, practitionerId } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const busyTimes = await sploseApi.getBusyTimes(startDate, endDate, practitionerId || null);
    const types = await sploseApi.getBusyTimeTypes();
    res.json({ data: busyTimes, types });
  } catch (err) {
    console.error('Splose busy-times error:', err.message);
    res.status(500).json({ error: 'Failed to fetch busy times', details: err.message });
  }
});

/**
 * POST /api/splose/busy-times
 * Create a busy-time block (travel, admin, lunch, etc.)
 */
router.post('/api/splose/busy-times', requireAuth, async (req, res) => {
  try {
    const result = await sploseApi.createBusyTime(req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('Splose create busy-time error:', err.message);
    res.status(500).json({ error: 'Failed to create busy time', details: err.message });
  }
});

/**
 * GET /api/splose/patients
 * Full patient list for the patient picker.
 */
router.get('/api/splose/patients', requireAuth, async (req, res) => {
  try {
    const patients = await sploseApi.getPatients();
    res.json({ data: patients, count: patients.length });
  } catch (err) {
    console.error('Splose patients error:', err.message);
    res.status(500).json({ error: 'Failed to fetch patients', details: err.message });
  }
});

/**
 * POST /api/splose/patients
 */
router.post('/api/splose/patients', requireAuth, async (req, res) => {
  try {
    const c = require('./splose-api');
    // splose-api doesn't have createPatient yet — call directly
    const axios = require('axios');
    const BASE = (process.env.SPLOSE_BASE_URL || 'https://api.splose.com') + '/v1';
    const response = await axios.post(`${BASE}/patients`, req.body, {
      headers: { Authorization: `Bearer ${process.env.SPLOSE_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.status(201).json(response.data);
  } catch (err) {
    console.error('Splose create patient error:', err.message);
    res.status(500).json({ error: 'Failed to create patient', details: err.response?.data || err.message });
  }
});

/**
 * GET /api/splose/patients/:id
 */
router.get('/api/splose/patients/:id', requireAuth, async (req, res) => {
  try {
    const patient = await sploseApi.getPatient(req.params.id);
    res.json(patient);
  } catch (err) {
    console.error('Splose patient error:', err.message);
    res.status(500).json({ error: 'Failed to fetch patient', details: err.message });
  }
});

/**
 * GET /api/splose/cases?patientId=...
 * Returns active cases for a patient — needed to get caseId for appointment write.
 */
router.get('/api/splose/cases', requireAuth, async (req, res) => {
  try {
    const { patientId } = req.query;
    // Splose /cases uses cursor-only pagination — no patientId filter param accepted.
    // Fetch all cases and filter in Node.
    const allCases = await sploseApi.fetchAllCases();
    let cases = allCases.filter(c => !c.archived && !c.deletedAt);
    if (patientId) cases = cases.filter(c => String(c.patientId) === String(patientId));
    res.json({ data: cases });
  } catch (err) {
    console.error('Splose cases error:', err.message, err.response?.data);
    res.status(500).json({ error: 'Failed to fetch cases', details: err.response?.data || err.message });
  }
});

/**
 * GET /api/splose/contacts
 * Returns all contacts (plan managers, referrers, GPs, etc.)
 */
router.get('/api/splose/contacts', requireAuth, async (req, res) => {
  try {
    const contacts = await sploseApi.getContacts();
    res.json({ data: contacts.filter(c => !c.archived) });
  } catch (err) {
    console.error('Splose contacts error:', err.message);
    res.status(500).json({ error: 'Failed to fetch contacts', details: err.message });
  }
});

/**
 * GET /api/splose/invoices?patientId=...
 * Returns invoices, optionally filtered by patient.
 */
router.get('/api/splose/invoices', requireAuth, async (req, res) => {
  try {
    const { patientId, startDate, endDate } = req.query;
    const params = {};
    if (patientId) params.patientId = patientId;
    if (startDate) params.startDate = startDate;
    if (endDate)   params.endDate   = endDate;
    const invoices = await sploseApi.getInvoices(params);
    res.json({ data: invoices.filter(i => !i.isArchived) });
  } catch (err) {
    console.error('Splose invoices error:', err.message);
    res.status(500).json({ error: 'Failed to fetch invoices', details: err.message });
  }
});

/**
 * GET /api/splose/availabilities/:practitionerId?startDate=...&endDate=...
 */
router.get('/api/splose/availabilities/:practitionerId', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const avail = await sploseApi.getAvailabilities(req.params.practitionerId, startDate, endDate);
    res.json({ data: avail });
  } catch (err) {
    console.error('Splose availabilities error:', err.message);
    res.status(500).json({ error: 'Failed to fetch availabilities', details: err.message });
  }
});

/**
 * GET /api/splose/payments
 * Returns all payments (receipts).
 */
router.get('/api/splose/payments', requireAuth, async (req, res) => {
  try {
    const payments = await sploseApi.getPayments();
    const active = payments.filter(p => !p.archived && !p.archivedAt);
    console.log(`Splose payments loaded: ${active.length} records`);
    res.json({ data: active });
  } catch (err) {
    console.error('Splose payments error:', err.message);
    res.status(500).json({ error: 'Failed to fetch payments', details: err.message });
  }
});

/**
 * GET /api/splose/support-activities
 */
router.get('/api/splose/support-activities', requireAuth, async (req, res) => {
  try {
    const all = await sploseApi.getSupportActivities();
    console.log(`Splose support-activities loaded: ${all.length} records`);
    res.json({ data: all.filter(s => !s.archived && !s.deletedAt) });
  } catch (err) {
    console.error('Splose support-activities error:', err.message);
    res.status(500).json({ error: 'Failed to fetch support activities', details: err.message });
  }
});

/**
 * GET /api/splose/support-items
 * Returns support items (travel logs, NDIS line items).
 */
router.get('/api/splose/support-items', requireAuth, async (req, res) => {
  try {
    const all = await sploseApi.getSupportItems();
    console.log(`Splose support-items loaded: ${all.length} records`);
    res.json({ data: all.filter(i => !i.deletedAt) });
  } catch (err) {
    console.error('Splose support-items error:', err.message);
    res.status(500).json({ error: 'Failed to fetch support items', details: err.message });
  }
});

/**
 * GET /api/splose/dormant-cases
 *
 * Returns clients whose most-recent Splose appointment (by startDate) is older
 * than 6 weeks (42 days) ago, or who have NO appointments at all.
 *
 * Algorithm:
 *  1. Load all patients from Splose.
 *  2. For each patient, fetch their appointments over the last 12 months.
 *     (We use a wide window so we don't miss infrequent clients.)
 *  3. Find the most-recent appointment date per patient.
 *  4. Flag anyone whose most-recent date is > 42 days ago (or null).
 *  5. Return sorted by lastActivity ascending (oldest first).
 */
router.get('/api/splose/dormant-cases', requireAuth, async (req, res) => {
  try {
    const thresholdDays = parseInt(req.query.days || '42', 10);
    const now = new Date();
    const cutoff = new Date(now - thresholdDays * 24 * 60 * 60 * 1000);

    // 1. Fetch all patients
    console.log('[dormant] fetching patients...');
    const patients = await sploseApi.getPatients();
    console.log(`[dormant] got ${patients.length} patients`);
    const activePatients = patients.filter(p => !p.deletedAt && !p.archivedAt);

    // 2. Fetch appointments for a rolling 12-month window
    const endDate   = now.toISOString().slice(0, 10);
    const startDate = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    console.log(`[dormant] fetching appointments ${startDate} → ${endDate}...`);
    const allAppts  = await sploseApi.getAppointments(startDate, endDate);
    console.log(`[dormant] got ${allAppts.length} appointments`);

    // 3. Build a map: patientId → most-recent appointment startDate
    const lastApptMap = new Map(); // patientId → Date
    for (const appt of allAppts) {
      // appointmentPatients is an array of { patientId, ... }
      const participants = appt.patients || appt.appointmentPatients || [];
      const apptDate = appt.start ? new Date(appt.start) : null;
      if (!apptDate) continue;
      for (const ap of participants) {
        const pid = ap.patientId || ap.id;
        if (!pid) continue;
        const existing = lastApptMap.get(String(pid));
        if (!existing || apptDate > existing) lastApptMap.set(String(pid), apptDate);
      }
    }

    // 4. Flag dormant patients
    const dormant = [];
    for (const p of activePatients) {
      const lastAppt = lastApptMap.get(String(p.id));
      const isDormant = !lastAppt || lastAppt < cutoff;
      if (!isDormant) continue;

      const weeksAgo = lastAppt
        ? Math.floor((now - lastAppt) / (7 * 24 * 60 * 60 * 1000))
        : null;

      dormant.push({
        patient: {
          id:         p.id,
          firstname:  p.firstname,
          lastname:   p.lastname,
          ndisNumber: p.ndisNumber || null,
          email:      p.email || null,
          phone:      p.phoneNumbers?.[0]?.phoneNumber || null,
        },
        lastActivity:  lastAppt ? lastAppt.toISOString().slice(0, 10) : null,
        weeksAgo:      weeksAgo,
        hasEverBooked: !!lastAppt,
      });
    }

    // 5. Sort: never-booked first, then by oldest last-activity
    dormant.sort((a, b) => {
      if (!a.lastActivity && !b.lastActivity) return 0;
      if (!a.lastActivity) return -1;
      if (!b.lastActivity) return 1;
      return new Date(a.lastActivity) - new Date(b.lastActivity);
    });

    res.json({ data: dormant, thresholdDays, checkedAt: now.toISOString() });
  } catch (err) {
    console.error('Dormant cases error:', err.message);
    res.status(500).json({ error: 'Failed to check dormant cases', details: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  OUTLOOK WRITE-BACK ROUTES
//
//  These routes push changes from the app back to the user's
//  Outlook calendar via Microsoft Graph. All calls are proxied
//  through the backend so the OAuth token stays server-side.
//
//  Write permission is already granted: the OAuth scope
//  Calendars.ReadWrite is requested at login, so any connected
//  user's token can create, update, and delete events.
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/outlook/events
 * Create a new event in the user's Outlook calendar from the app.
 * If dbEventId is provided, the returned outlookId is stored in the local DB
 * record so future syncs match on it rather than creating a duplicate.
 *
 * Body: { dbEventId?, title, startTime, endTime, location?, categories?, sploseId?,
 *         targetTherapistUserId? }
 *
 * targetTherapistUserId — owner/admin only. If set, the event is written to
 * that user's Outlook calendar using their stored access token instead of the
 * caller's. Ignored (silently falls back to caller) for non-owner/admin callers.
 */
router.post('/api/outlook/events', requireAuth, async (req, res) => {
  try {
    const { dbEventId, title, startTime, endTime, location, categories,
            sploseId, targetTherapistUserId } = req.body;

    // Resolve whose Outlook calendar to write to
    let targetUser;
    const callerIsManager = ['owner', 'admin'].includes(req.user?.role);
    if (targetTherapistUserId && callerIsManager) {
      targetUser = await db.getUser(targetTherapistUserId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Target therapist user not found' });
      }
    } else {
      targetUser = await db.getUser(req.session.userId);
    }

    // If the resolved user has no Outlook token, fall back to any active org member
    // who does. This covers the common case where an owner/admin account was never
    // connected to Outlook but the therapist account in the same org was.
    let accessToken;
    try {
      accessToken = await getValidAccessToken(targetUser);
    } catch (tokenErr) {
      // organisation_id may be null — use IS NOT DISTINCT FROM to match nulls,
      // or just find any connected user when org is unset (single-practice setup).
      const orgId = targetUser?.organisation_id || req.user?.organisation_id;
      const fallback = await db.pool.query(
        `SELECT id FROM users
         WHERE access_token IS NOT NULL AND access_token != ''
           AND is_active = true
           AND (organisation_id IS NOT DISTINCT FROM $1 OR $1 IS NULL)
         ORDER BY created_at
         LIMIT 1`,
        [orgId]
      );
      if (fallback.rows.length) {
        const fallbackUser = await db.getUser(fallback.rows[0].id);
        accessToken = await getValidAccessToken(fallbackUser);
        console.log(`🔄 Outlook write: using token from ${fallbackUser.email} (fallback — caller had no token)`);
      } else {
        return res.status(400).json({
          error: 'No Outlook account connected',
          message: 'No user in this organisation has linked their Outlook account. Connect Outlook via the Settings → Integrations page.',
        });
      }
    }

    if (!title || !startTime || !endTime) {
      return res.status(400).json({ error: 'title, startTime, and endTime are required' });
    }

    const result = await outlookApi.createOutlookEvent(accessToken, {
      title,
      startTime,
      endTime,
      location: location || '',
      categories: categories || [],
      appEventId: dbEventId || null,
      sploseId:   sploseId  || null,
    });

    // Link to existing DB record when caller supplied one
    if (dbEventId) {
      await db.updateEventOutlookId(dbEventId, result.outlookId);
    }

    // Always write to the local DB immediately so the event survives a page
    // refresh without waiting for the 5-minute delta sync. The upsert is
    // idempotent — if the delta sync later re-imports the same event it will
    // just update the existing row rather than creating a duplicate.
    try {
      await db.upsertOutlookEvent(req.session.userId, {
        outlookId:       result.outlookId,
        title,
        startTime,
        endTime,
        location:        location || '',
        categories:      categories || [],
        isCancelled:     false,
        lastModifiedAt:  new Date().toISOString(),
        sploseId:        sploseId || null,   // stored so the Splose poller can cross-reference
        createdBySource: 'app',              // this event originated in the app, not Outlook
        eventType:       classifyEventType(categories || [], false),
      });
      console.log(`💾 Event saved to local DB: ${result.outlookId}`);
    } catch (dbErr) {
      // Non-fatal — the Outlook event was created; delta sync will import it
      console.warn('⚠️  Local DB save failed (non-fatal):', dbErr.message);
    }

    console.log(`✅ Outlook event created: ${result.outlookId} — "${title}"`);
    res.status(201).json({ ok: true, outlookId: result.outlookId });
  } catch (err) {
    console.error('Outlook create event error:', err.response?.data || err.message);
    if (req.body.dbEventId) {
      await db.updateEventWriteError(req.body.dbEventId, err.message).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to create Outlook event', details: err.message });
  }
});

/**
 * PATCH /api/outlook/events/:dbId/location
 * Write the routing address back to the corresponding Outlook event.
 * Also persists the manual_location override to the local DB row so it
 * survives page reloads and is protected from future Outlook sync overwrites.
 *
 * Body: { location, lat?, lng? }
 */
router.patch('/api/outlook/events/:dbId/location', requireAuth, async (req, res) => {
  try {
    const { dbId } = req.params;
    const { location, lat, lng } = req.body;

    if (!location) {
      return res.status(400).json({ error: 'location is required' });
    }

    // Persist to local DB first (sets is_manual_location_override = TRUE)
    await db.updateEventManualLocation(dbId, { address: location, lat: lat || null, lng: lng || null });

    // Look up the Outlook event ID
    const ev = await db.pool.query(
      'SELECT outlook_id FROM events WHERE id = $1 AND user_id = $2',
      [dbId, req.session.userId]
    );
    if (!ev.rows.length) return res.status(404).json({ error: 'Event not found' });

    const outlookId = ev.rows[0].outlook_id;
    if (!outlookId) {
      // Saved locally; no Outlook event to push to yet
      console.log(`📍 Location saved to DB (no Outlook ID yet) for ${dbId}: "${location}"`);
      return res.json({ ok: true, savedToDb: true, savedToOutlook: false, reason: 'no_outlook_id' });
    }

    const user = await db.getUser(req.session.userId);
    const accessToken = await getValidAccessToken(user);
    await outlookApi.updateOutlookEvent(accessToken, outlookId, { location });

    // Log successful write-back
    await db.pool.query(
      `INSERT INTO sync_log (event_id, action, source, target, status) VALUES ($1, 'updated', 'app', 'outlook', 'success')`,
      [dbId]
    ).catch(() => {});

    console.log(`📍 Location written to Outlook ${outlookId}: "${location}"`);
    res.json({ ok: true, savedToDb: true, savedToOutlook: true, outlookId });
  } catch (err) {
    console.error('Outlook location update error:', err.response?.data || err.message);
    const userId = req.user?.id || req.session?.userId;
    const { dbId } = req.params;
    if (dbId) {
      await db.pool.query(
        `INSERT INTO sync_log (event_id, action, source, target, status, error_message) VALUES ($1, 'updated', 'app', 'outlook', 'failed', $2)`,
        [dbId, err.message]
      ).catch(() => {});
    }
    if (userId) {
      storeNotificationLazy(userId, {
        type: 'outlook_writeback_failed',
        title: 'Outlook write-back failed',
        message: `Location update could not be written to Outlook: ${err.message}. Check Settings → Integrations.`,
        severity: 'error',
        relatedEntity: 'integration',
        actionPayload: { action: 'reconnect_outlook' },
      }).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to update Outlook location', details: err.message });
  }
});

/**
 * PATCH /api/outlook/events/:dbId
 * Update the title, time, or location of an existing Outlook event.
 * Only fields provided in the body are changed (partial update).
 *
 * Body: { title?, startTime?, endTime?, location? }
 */
router.patch('/api/outlook/events/:dbId', requireAuth, async (req, res) => {
  try {
    const { dbId } = req.params;
    const { title, startTime, endTime, location } = req.body;

    const ev = await db.pool.query(
      'SELECT outlook_id FROM events WHERE id = $1 AND user_id = $2',
      [dbId, req.session.userId]
    );
    if (!ev.rows.length) return res.status(404).json({ error: 'Event not found' });

    const outlookId = ev.rows[0].outlook_id;
    if (!outlookId) {
      return res.status(400).json({ error: 'This event has no Outlook ID — push it to Outlook first' });
    }

    const user = await db.getUser(req.session.userId);
    const accessToken = await getValidAccessToken(user);

    // Push partial update to Outlook (only defined fields are sent)
    await outlookApi.updateOutlookEvent(accessToken, outlookId, { title, startTime, endTime, location });

    // Mirror changes to local DB
    await db.updateEvent(dbId, { title, startTime, endTime, location, lastModifiedBy: 'app' });

    await db.pool.query(
      `INSERT INTO sync_log (event_id, action, source, target, status) VALUES ($1, 'updated', 'app', 'outlook', 'success')`,
      [dbId]
    ).catch(() => {});

    console.log(`✏️ Outlook event updated: ${outlookId}`);
    res.json({ ok: true, outlookId });
  } catch (err) {
    console.error('Outlook update error:', err.response?.data || err.message);
    const userId = req.user?.id || req.session?.userId;
    const { dbId } = req.params;
    if (dbId) {
      await db.pool.query(
        `INSERT INTO sync_log (event_id, action, source, target, status, error_message) VALUES ($1, 'updated', 'app', 'outlook', 'failed', $2)`,
        [dbId, err.message]
      ).catch(() => {});
    }
    if (userId) {
      storeNotificationLazy(userId, {
        type: 'outlook_writeback_failed',
        title: 'Outlook event update failed',
        message: `Could not sync appointment changes to Outlook: ${err.message}. Your local changes are saved.`,
        severity: 'error',
        relatedEntity: 'integration',
        actionPayload: { action: 'reconnect_outlook' },
      }).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to update Outlook event', details: err.message });
  }
});

/**
 * DELETE /api/outlook/events/:dbId
 * Remove an event from Outlook AND soft-delete the local record.
 * If Outlook returns 404 (already deleted), we still soft-delete locally.
 */
router.delete('/api/outlook/events/:dbId', requireAuth, async (req, res) => {
  try {
    const { dbId } = req.params;

    const ev = await db.pool.query(
      'SELECT outlook_id, title FROM events WHERE id = $1 AND user_id = $2',
      [dbId, req.session.userId]
    );
    if (!ev.rows.length) return res.status(404).json({ error: 'Event not found' });

    const { outlook_id: outlookId, title } = ev.rows[0];
    let deletedFromOutlook = false;

    if (outlookId) {
      try {
        const targetUser  = await db.getUser(req.session.userId);
        const accessToken = await getValidAccessToken(targetUser).catch(async () => {
          // Caller has no token — try org fallback (same as write path)
          const orgId = targetUser?.organisation_id;
          const fb = await db.pool.query(
            `SELECT id FROM users WHERE access_token IS NOT NULL AND access_token != ''
               AND is_active = true AND (organisation_id IS NOT DISTINCT FROM $1 OR $1 IS NULL)
             ORDER BY created_at LIMIT 1`, [orgId]
          );
          if (!fb.rows.length) throw new Error('No connected Outlook account');
          return getValidAccessToken(await db.getUser(fb.rows[0].id));
        });
        await outlookApi.deleteOutlookEvent(accessToken, outlookId);
        deletedFromOutlook = true;
        console.log(`🗑️ Deleted from Outlook: ${outlookId} — "${title}"`);
      } catch (outlookErr) {
        // Treat ALL Outlook errors as non-fatal for delete — the event may already
        // be gone (ErrorItemNotFound / 404) or the token may be temporarily invalid.
        // Always proceed with the local soft-delete so the UI stays consistent.
        console.warn(`⚠️ Outlook delete skipped (non-fatal): ${outlookErr.message}`);
      }
    }

    // Soft-delete locally — this is the authoritative action
    await db.pool.query(`
      UPDATE events
      SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
    `, [dbId, req.session.userId]);

    res.json({ ok: true, deletedFromOutlook, title });
  } catch (err) {
    console.error('Outlook delete error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to delete event', details: err.message });
  }
});

/**
 * POST /api/outlook/travel-blocks
 * Create a travel time block in Outlook — used when the app calculates travel
 * segments between sessions so Ann's Outlook calendar shows the driving time.
 * Also creates a local DB record (event_type='travel') so we can track/delete.
 *
 * Body: { start, end, fromLabel, toLabel, fromAddress?, toAddress?, travelMin }
 */
router.post('/api/outlook/travel-blocks', requireAuth, async (req, res) => {
  try {
    const { start, end, fromLabel, toLabel, fromAddress, toAddress, travelMin } = req.body;
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end are required' });
    }

    const user = await db.getUser(req.session.userId);
    const accessToken = await getValidAccessToken(user);

    const title    = `🚗 Travel: ${fromLabel || 'Origin'} → ${toLabel || 'Destination'}`;
    const location = toAddress || toLabel || '';
    const body     = `Auto-generated travel block (${travelMin || '?'} min).\nFrom: ${fromAddress || fromLabel || 'unknown'}\nTo: ${toAddress || toLabel || 'unknown'}`;

    const result = await outlookApi.createOutlookEvent(accessToken, {
      title,
      startTime:  start,
      endTime:    end,
      location,
      categories: ['Travel'],
      appEventId: null,
      sploseId:   null,
    });

    // Create a local DB record so travel blocks can be found and cleaned up
    const localEvent = await db.createEvent(req.session.userId, {
      title,
      description: body,
      startTime:   start,
      endTime:     end,
      location,
      eventType:   'travel',
      outlookId:   result.outlookId,
      categories:  ['Travel'],
    });

    // Mark as app-created and already synced
    await db.pool.query(
      `UPDATE events SET source = 'app', sync_status = 'synced', last_modified_by = 'app' WHERE id = $1`,
      [localEvent.id]
    );

    // Log success
    await db.pool.query(
      `INSERT INTO sync_log (event_id, action, source, target, status) VALUES ($1, 'created', 'app', 'outlook', 'success')`,
      [localEvent.id]
    ).catch(() => {});

    console.log(`🚗 Travel block pushed to Outlook: ${result.outlookId} — ${title}`);
    res.status(201).json({ ok: true, outlookId: result.outlookId, dbId: localEvent.id });
  } catch (err) {
    console.error('Travel block create error:', err.response?.data || err.message);
    const userId = req.user?.id || req.session?.userId;
    if (userId) {
      storeNotificationLazy(userId, {
        type: 'outlook_writeback_failed',
        title: 'Travel block write to Outlook failed',
        message: `A travel time block could not be added to your Outlook calendar: ${err.message}. Try reconnecting Outlook in Settings.`,
        severity: 'warning',
        relatedEntity: 'integration',
        actionPayload: { action: 'reconnect_outlook' },
      }).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to create travel block in Outlook', details: err.message });
  }
});

module.exports = router;
