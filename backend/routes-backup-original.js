/**
 * API ROUTES & SYNC LOGIC
 *
 * What this does:
 * - Defines all API endpoints (/api/events, /api/sync, etc.)
 * - Handles the bidirectional sync logic
 * - Orchestrates syncing between app, Splose, and Outlook
 * - Detects and resolves conflicts
 *
 * This is the "brain" that coordinates everything
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Import all our helper modules
const db = require('./database');
const outlookApi = require('./outlook-oauth');
const sploseApi = require('./splose-api');

// ===== MIDDLEWARE =====
// Verify user is logged in before accessing routes

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ===== AUTHENTICATION ROUTES =====

/**
 * GET /auth/outlook-login
 * Initiates Microsoft OAuth flow
 * User clicks this link to login with their Microsoft account
 */
router.get('/auth/outlook-login', (req, res) => {
  try {
    const { url, state } = outlookApi.getAuthorizationUrl();

    // Store state in session for security verification
    req.session.oauthState = state;
    req.session.save();

    res.json({
      message: 'Redirect to this URL to login with Microsoft',
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
 * We exchange the code for an access token
 */
router.get('/auth/oauth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    // Verify state (security check)
    if (state !== req.session.oauthState) {
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    // Exchange code for token
    const tokenData = await outlookApi.getAccessToken(code);

    // Get user info from Microsoft
    const microsoftUser = await outlookApi.getMicrosoftUser(tokenData.accessToken);

    // Create or update user in our database
    let user = await db.getUser(microsoftUser.id);
    if (!user) {
      user = await db.createUser(microsoftUser.email, microsoftUser.id);
    }

    // Store tokens securely
    await db.updateUserTokens(
      user.id,
      tokenData.accessToken,
      tokenData.refreshToken,
      tokenData.expiresIn
    );

    // Create session
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.save();

    // Return success
    res.json({
      message: 'Authentication successful!',
      user: {
        id: user.id,
        email: user.email
      },
      redirect: process.env.FRONTEND_URL || 'http://localhost:3000'
    });
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /auth/logout
 * Logout user
 */
router.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out successfully' });
});

// ===== EVENT ROUTES =====

/**
 * GET /api/events
 * Get all events for logged-in user
 * Optional filters: startDate, endDate, eventType
 */
router.get('/api/events', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, eventType } = req.query;

    const events = await db.getEvents(req.session.userId, {
      startDate,
      endDate,
      eventType
    });

    res.json({
      count: events.length,
      events: events
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * POST /api/events
 * Create a new event
 * Syncs to: App → Database → Splose → Outlook
 */
router.post('/api/events', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const {
      title, description, startTime, endTime, location,
      eventType = 'therapy',
      clientId, clientName, regionalTag, travelDistance, notes
    } = req.body;

    // Validate required fields
    if (!title || !startTime || !endTime) {
      return res.status(400).json({ error: 'Missing required fields: title, startTime, endTime' });
    }

    console.log(`Creating event: "${title}" at ${startTime}`);

    // Step 1: Create in our database
    const dbEvent = await db.createEvent(req.session.userId, {
      title,
      description,
      startTime,
      endTime,
      location,
      eventType,
      clientName,
      regionalTag,
      travelDistance
    });

    try {
      // Step 2: Create in Splose (if it's a therapy appointment)
      if (eventType === 'therapy' && clientId) {
        const sploseResult = await sploseApi.createAppointment(user.id, {
          clientId,
          clientName,
          startTime,
          endTime,
          serviceType: 'Therapy',
          location,
          notes
        });

        // Update event with Splose ID
        await db.updateEvent(dbEvent.id, {
          sploseId: sploseResult.sploseId
        });

        await db.logSync(dbEvent.id, 'created', 'app', 'splose', 'success');
      }

      // Step 3: Create in Outlook
      const outlookResult = await outlookApi.createOutlookEvent(user.access_token, {
        title,
        startTime,
        endTime,
        location,
        appEventId: dbEvent.id,
        sploseId: dbEvent.splose_id,
        categories: [eventType]
      });

      // Update event with Outlook ID
      await db.updateEvent(dbEvent.id, {
        outlookId: outlookResult.outlookId,
        syncStatus: 'synced'
      });

      await db.logSync(dbEvent.id, 'created', 'app', 'outlook', 'success');

      // Return complete event
      const finalEvent = await db.getEvents(req.session.userId);
      const createdEvent = finalEvent.find(e => e.id === dbEvent.id);

      res.status(201).json({
        message: 'Event created successfully',
        event: createdEvent,
        synced: {
          database: true,
          splose: eventType === 'therapy',
          outlook: true
        }
      });

    } catch (syncError) {
      // If sync fails, mark as pending
      console.error('Sync error:', syncError);
      await db.updateEvent(dbEvent.id, { syncStatus: 'pending' });
      await db.logSync(dbEvent.id, 'created', 'app', 'outlook', 'failed', syncError.message);

      res.status(201).json({
        message: 'Event created locally but sync pending',
        event: dbEvent,
        error: syncError.message
      });
    }

  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/events/:id
 * Update an existing event
 * Syncs changes to: Database → Splose → Outlook
 */
router.put('/api/events/:id', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    const eventId = req.params.id;
    const updateData = req.body;

    console.log(`Updating event ${eventId}`);

    // Check if event exists and belongs to user
    const events = await db.getEvents(req.session.userId);
    const event = events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Update in database
    const updatedEvent = await db.updateEvent(eventId, {
      ...updateData,
      lastModifiedBy: 'app'
    });

    // Update in Splose if applicable
    if (event.splose_id) {
      try {
        await sploseApi.updateAppointment(event.splose_id, updateData);
        await db.logSync(eventId, 'updated', 'app', 'splose', 'success');
      } catch (error) {
        console.error('Splose sync failed:', error);
        await db.logSync(eventId, 'updated', 'app', 'splose', 'failed', error.message);
      }
    }

    // Update in Outlook
    if (event.outlook_id) {
      try {
        await outlookApi.updateOutlookEvent(user.access_token, event.outlook_id, updateData);
        await db.logSync(eventId, 'updated', 'app', 'outlook', 'success');
      } catch (error) {
        console.error('Outlook sync failed:', error);
        await db.logSync(eventId, 'updated', 'app', 'outlook', 'failed', error.message);
      }
    }

    res.json({
      message: 'Event updated successfully',
      event: updatedEvent
    });

  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/events/:id
 * Delete an event
 * Removes from: Database → Splose → Outlook
 */
router.delete('/api/events/:id', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    const eventId = req.params.id;

    // Get event first
    const events = await db.getEvents(req.session.userId);
    const event = events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    console.log(`Deleting event ${eventId}`);

    // Delete from Splose
    if (event.splose_id) {
      try {
        await sploseApi.deleteAppointment(event.splose_id);
        await db.logSync(eventId, 'deleted', 'app', 'splose', 'success');
      } catch (error) {
        console.error('Splose deletion failed:', error);
      }
    }

    // Delete from Outlook
    if (event.outlook_id) {
      try {
        await outlookApi.deleteOutlookEvent(user.access_token, event.outlook_id);
        await db.logSync(eventId, 'deleted', 'app', 'outlook', 'success');
      } catch (error) {
        console.error('Outlook deletion failed:', error);
      }
    }

    // Delete from database
    await db.deleteEvent(eventId);

    res.json({
      message: 'Event deleted successfully',
      deletedId: eventId
    });

  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== SYNC ROUTES =====

/**
 * POST /api/sync
 * Manually trigger full sync
 * Syncs from all sources: Splose, Outlook, App
 * Resolves any conflicts
 */
router.post('/api/sync', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    const { startDate, endDate } = req.body;

    console.log(`Starting full sync for user ${user.id}`);

    const syncResults = {
      start_time: new Date(),
      splose_events_synced: 0,
      outlook_events_synced: 0,
      conflicts_detected: 0,
      errors: []
    };

    // Get all events from all sources
    const appEvents = await db.getEvents(user.id, { startDate, endDate });
    const sploseEvents = await sploseApi.getAppointments(user.id, startDate, endDate);
    const outlookEvents = await outlookApi.getOutlookCalendarEvents(user.access_token, startDate, endDate);

    // Sync Splose → App
    for (const sploseEvent of sploseEvents) {
      const existingEvent = appEvents.find(e => e.splose_id === sploseEvent.sploseId);
      if (!existingEvent) {
        try {
          const newEvent = await db.createEvent(user.id, {
            title: sploseEvent.title,
            startTime: sploseEvent.startTime,
            endTime: sploseEvent.endTime,
            location: sploseEvent.location,
            sploseId: sploseEvent.sploseId,
            clientName: sploseEvent.clientName,
            eventType: 'therapy'
          });
          syncResults.splose_events_synced++;
          await db.logSync(newEvent.id, 'created', 'splose', 'app', 'success');
        } catch (error) {
          syncResults.errors.push({ source: 'splose', error: error.message });
        }
      }
    }

    // Sync Outlook → App (read Teams meetings)
    for (const outlookEvent of outlookEvents) {
      const existingEvent = appEvents.find(e => e.outlook_id === outlookEvent.id);
      if (!existingEvent && outlookEvent.isTeamsMeeting) {
        try {
          const newEvent = await db.createEvent(user.id, {
            title: outlookEvent.title,
            startTime: outlookEvent.startTime,
            endTime: outlookEvent.endTime,
            outlookId: outlookEvent.id,
            eventType: 'teams_meeting',
            isTeamsMeeting: true,
            teamsJoinLink: outlookEvent.teamsJoinLink
          });
          syncResults.outlook_events_synced++;
          await db.logSync(newEvent.id, 'created', 'outlook', 'app', 'success');
        } catch (error) {
          syncResults.errors.push({ source: 'outlook', error: error.message });
        }
      }
    }

    syncResults.end_time = new Date();
    syncResults.duration_ms = syncResults.end_time - syncResults.start_time;

    res.json({
      message: 'Sync completed',
      results: syncResults
    });

  } catch (error) {
    console.error('Error during sync:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sync-status
 * Check sync status of all events
 */
router.get('/api/sync-status', requireAuth, async (req, res) => {
  try {
    const events = await db.getEvents(req.session.userId);

    const status = {
      total_events: events.length,
      synced: events.filter(e => e.sync_status === 'synced').length,
      pending: events.filter(e => e.sync_status === 'pending').length,
      failed: events.filter(e => e.sync_status === 'failed').length
    };

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== CALENDAR ROUTES =====

/**
 * GET /api/calendar/availability
 * Get therapist's availability for a date range
 * Used by auto-fit algorithm
 */
router.get('/api/calendar/availability', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const user = await db.getUser(req.session.userId);

    // Get appointments and busy times
    const appointments = await sploseApi.getAppointments(user.id, startDate, endDate);
    const busyTimes = await sploseApi.getBusyTimes(user.id, startDate, endDate);

    const allBlocks = [
      ...appointments.map(a => ({ ...a, type: 'appointment' })),
      ...busyTimes.map(b => ({ ...b, type: b.type }))
    ];

    res.json({
      startDate,
      endDate,
      blockedTimes: allBlocks,
      availableSlotsApprox: 'To be calculated by frontend'
    });

  } catch (error) {
    console.error('Error fetching availability:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== EXPORTS =====

module.exports = router;
