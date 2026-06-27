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

// ===== MIDDLEWARE =====
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ===== PHASE 1: OUTLOOK LOGIN & TOKEN EXCHANGE =====

/**
 * GET /auth/outlook-login
 * Starts the Microsoft OAuth flow
 * Frontend redirects user here to login
 */
router.get('/auth/outlook-login', (req, res) => {
  try {
    const { url, state } = outlookApi.getAuthorizationUrl();
    req.session.oauthState = state;
    req.session.save();

    res.json({
      message: 'Redirect to Microsoft login',
      authUrl: url,
      instruction: 'User should navigate to: ' + url
    });
  } catch (error) {
    console.error('Error initiating OAuth:', error);
    res.status(500).json({ error: 'Failed to initiate Microsoft login' });
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

    if (state !== req.session.oauthState) {
      return res.status(400).json({ error: 'Invalid state' });
    }

    // Get token from Microsoft
    const tokenData = await outlookApi.getAccessToken(code);

    // Get user info
    const microsoftUser = await outlookApi.getMicrosoftUser(tokenData.accessToken);

    // Create/update user in database
    let user = await db.getUser(microsoftUser.id);
    if (!user) {
      user = await db.createUser(microsoftUser.email, microsoftUser.id);
    }

    // Store tokens
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

    res.json({
      message: 'Authentication successful',
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
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
      hasOutlookTokens: !!user.outlook_access_token
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// ===== PHASE 2: INITIAL OUTLOOK SYNC (READ-ONLY) =====

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
router.post('/api/sync/outlook-initial', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);

    if (!user.outlook_access_token) {
      return res.status(400).json({
        error: 'Outlook not connected',
        message: 'User must authenticate with Microsoft first'
      });
    }

    console.log(`🔄 Starting initial Outlook sync for ${user.email}...`);

    // Fetch ALL events from Outlook
    const outlookEvents = await outlookApi.getOutlookCalendarEvents(
      user.outlook_access_token,
      null // null = get all events, no date filter
    );

    console.log(`📅 Found ${outlookEvents.length} events in Outlook`);

    let syncedCount = 0;

    // Store each Outlook event in app database
    for (const outlookEvent of outlookEvents) {
      try {
        // Create event in our database
        await db.createEvent(
          user.id,
          outlookEvent.subject || 'Untitled',
          outlookEvent.start?.dateTime || new Date().toISOString(),
          outlookEvent.end?.dateTime || new Date().toISOString(),
          {
            outlookId: outlookEvent.id,
            description: outlookEvent.bodyPreview || '',
            location: outlookEvent.location?.displayName || '',
            syncedFromOutlook: true,
            syncedAt: new Date().toISOString()
          }
        );
        syncedCount++;
      } catch (err) {
        console.error(`Failed to sync event ${outlookEvent.id}:`, err.message);
        // Continue with next event even if one fails
      }
    }

    console.log(`✅ Successfully synced ${syncedCount} events`);

    res.json({
      message: 'Outlook sync completed',
      eventsFound: outlookEvents.length,
      eventsSynced: syncedCount,
      nextStep: 'Events are now in your calendar. Ready for bidirectional sync.',
      outlookConnected: true
    });

  } catch (error) {
    console.error('Outlook sync error:', error);
    res.status(500).json({
      error: 'Sync failed',
      details: error.message
    });
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
    const outlookEvents = events.filter(e => e.metadata?.syncedFromOutlook);

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
      title,
      start,
      end,
      {
        description,
        location,
        createdInApp: true,
        syncedAt: new Date().toISOString()
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

// ===== SYNC STATUS =====

/**
 * GET /api/sync-status
 * Check if Outlook is connected and last sync time
 */
router.get('/api/sync-status', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    const events = await db.getEvents(req.session.userId);
    const outlookEvents = events.filter(e => e.metadata?.syncedFromOutlook);

    res.json({
      outlookConnected: !!user.outlook_access_token,
      totalEvents: events.length,
      outlookSyncedEvents: outlookEvents.length,
      status: outlookEvents.length > 0 ? 'synced' : 'not_synced',
      message: outlookEvents.length > 0
        ? `${outlookEvents.length} events synced from Outlook`
        : 'No Outlook events synced yet'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

module.exports = router;
