/**
 * MICROSOFT OUTLOOK OAUTH SETUP
 *
 * What this does:
 * - Handles login with Microsoft accounts
 * - Gets permission to access Outlook calendar
 * - Securely stores access tokens
 * - Refreshes tokens when they expire
 *
 * OAuth = A safe way for users to give us permission without sharing passwords
 * Think of it like: "Tell Microsoft I trust this app with my calendar"
 */

const axios = require('axios');

// ===== MICROSOFT OAUTH CONFIGURATION =====
// These constants define the OAuth flow

// Tenant is environment configuration (dev/staging/prod may use different
// Azure app registrations). The historical Opal tenant remains the safe
// development fallback so local work keeps functioning without a .env change.
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || 'ab55fe6c-cf70-4452-87aa-5c017960d362';

const MICROSOFT_OAUTH_CONFIG = {
  clientId: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:5001/auth/oauth/callback',
  tenantId: MICROSOFT_TENANT_ID,

  // Endpoints — tenant-specific (not /common) so only org accounts sign in
  authorizationUri: `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`,
  tokenUri: `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
  graphBaseUri: 'https://graph.microsoft.com/v1.0',

  // Permissions (scopes) we need
  scopes: [
    'Calendars.ReadWrite', // Read and write calendar events
    'offline_access', // Get refresh tokens for offline access
    'User.Read' // Read user profile
  ]
};

// ===== STEP 1: GENERATE LOGIN URL =====
// This creates the URL user clicks to login with Microsoft

function getAuthorizationUrl(returnUrl) {
  const csrf = require('crypto').randomBytes(16).toString('hex');
  // Encode returnUrl into state so it survives the Microsoft redirect round-trip
  // Format: "<csrf>|<base64(returnUrl)>" — the | separator is safe in base64url
  const state = returnUrl
    ? `${csrf}|${Buffer.from(returnUrl).toString('base64')}`
    : csrf;

  const params = new URLSearchParams({
    client_id: MICROSOFT_OAUTH_CONFIG.clientId,
    redirect_uri: MICROSOFT_OAUTH_CONFIG.redirectUri,
    response_type: 'code',
    scope: MICROSOFT_OAUTH_CONFIG.scopes.join(' '),
    state: state,
    response_mode: 'query',
    prompt: 'select_account'
  });

  return {
    url: `${MICROSOFT_OAUTH_CONFIG.authorizationUri}?${params.toString()}`,
    state: state
  };
}

// ===== STEP 2: EXCHANGE CODE FOR TOKEN =====
// After user clicks "Allow", Microsoft gives us a code
// We exchange that code for an access token

async function getAccessToken(code) {
  try {
    console.log('Exchanging authorization code for access token...');

    // Microsoft OAuth token endpoint requires form-encoded data, not JSON
    const params = new URLSearchParams();
    params.append('client_id', MICROSOFT_OAUTH_CONFIG.clientId);
    params.append('client_secret', MICROSOFT_OAUTH_CONFIG.clientSecret);
    params.append('code', code);
    params.append('redirect_uri', MICROSOFT_OAUTH_CONFIG.redirectUri);
    params.append('grant_type', 'authorization_code');

    const response = await axios.post(MICROSOFT_OAUTH_CONFIG.tokenUri, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    // Response contains:
    // - access_token: Used to access Outlook
    // - refresh_token: Used to get a new access_token when it expires
    // - expires_in: Seconds until token expires (usually 3600 = 1 hour)

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
      tokenType: response.data.token_type
    };
  } catch (error) {
    console.error('Error getting access token:', error.response?.data || error.message);
    throw new Error('Failed to authenticate with Microsoft');
  }
}

// ===== STEP 3: REFRESH TOKEN =====
// When token expires, use refresh token to get a new one
// No user interaction needed

async function refreshAccessToken(refreshToken) {
  try {
    console.log('Refreshing access token...');

    // Microsoft OAuth token endpoint requires form-encoded data, not JSON
    const params = new URLSearchParams();
    params.append('client_id', MICROSOFT_OAUTH_CONFIG.clientId);
    params.append('client_secret', MICROSOFT_OAUTH_CONFIG.clientSecret);
    params.append('refresh_token', refreshToken);
    params.append('grant_type', 'refresh_token');

    const response = await axios.post(MICROSOFT_OAUTH_CONFIG.tokenUri, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || refreshToken, // Microsoft may or may not return new refresh token
      expiresIn: response.data.expires_in
    };
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
    throw new Error('Failed to refresh authentication token');
  }
}

// ===== STEP 4: GET USER INFO FROM MICROSOFT =====
// Use the access token to get user's profile

async function getMicrosoftUser(accessToken) {
  try {
    const response = await axios.get(`${MICROSOFT_OAUTH_CONFIG.graphBaseUri}/me`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    return {
      id: response.data.id,
      email: response.data.userPrincipalName || response.data.mail,
      displayName: response.data.displayName
    };
  } catch (error) {
    console.error('Error getting Microsoft user:', error.response?.data || error.message);
    throw new Error('Failed to get user information from Microsoft');
  }
}

// ===== STEP 5: GET USER'S CALENDAR EVENTS =====
// Fetch events from Outlook calendar

async function getOutlookCalendarEvents(accessToken, startDate, endDate) {
  try {
    // If no dates provided, use a wide range (past 2 years to future 2 years)
    if (!startDate || !endDate) {
      const now = new Date();
      startDate = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).toISOString();
      endDate = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()).toISOString();
      console.log(`📅 Using default date range: ${startDate} to ${endDate}`);
    }

    // Construct the query with StartDateTime and EndDateTime parameters
    // Note: calendarview endpoint requires these specific parameter names
    // $top=250 requests more events per page (faster pagination, but within API limits)
    const query = `?startDateTime=${encodeURIComponent(startDate)}&endDateTime=${encodeURIComponent(endDate)}&$top=250&$select=id,iCalUId,changeKey,subject,start,end,location,categories,organizer,responseStatus,isCancelled,showAs,lastModifiedDateTime,onlineMeetingUrl,isOnlineMeeting,type,seriesMasterId`;

    console.log('📍 Fetching Outlook events with query:', query.substring(0, 100) + '...');

    let allEvents = [];
    let nextLink = `${MICROSOFT_OAUTH_CONFIG.graphBaseUri}/me/calendar/calendarview${query}`;
    let pageCount = 0;
    const maxPages = 50; // safety limit (50 pages × $top=250 = 12,500 events)
    const seenEventIds = new Set();
    let fetchTruncated = false; // set when maxPages is hit with a nextLink remaining

    // Handle pagination - keep fetching until no more pages or max pages reached
    while (nextLink && pageCount < maxPages) {
      pageCount++;
      console.log(`📄 [Page ${pageCount}/${maxPages}] Fetching events...`);

      const response = await axios.get(nextLink, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          // Force Graph to return event start/end in UTC. Without this header
          // Graph returns times in the mailbox's default zone (Perth/AWST here),
          // and toUtcIso() then stamps that Perth wall-clock with 'Z', shifting
          // every event +8h. With this header dateTime is true UTC and the 'Z'
          // append is correct. This is the root-cause fix for the timezone bug.
          'Prefer': 'outlook.timezone="UTC"'
        }
      });

      if (response.data.value && response.data.value.length > 0) {
        let newCount = 0;
        response.data.value.forEach(event => {
          if (!seenEventIds.has(event.id)) {
            seenEventIds.add(event.id);
            allEvents.push(event);
            newCount++;
          }
        });
        console.log(`✅ Page ${pageCount}: Got ${response.data.value.length} events (${newCount} new, ${response.data.value.length - newCount} duplicates)`);
      }

      // Check if there's a next page
      nextLink = response.data['@odata.nextLink'] || null;
      if (nextLink && pageCount < maxPages) {
        console.log(`🔗 Found next page link, continuing... (Page ${pageCount + 1}/${maxPages})`);
      } else if (nextLink && pageCount >= maxPages) {
        console.log(`⚠️ Reached max pages limit (${maxPages}) with pages remaining — result is TRUNCATED.`);
        fetchTruncated = true;
        nextLink = null;
      }
    }

    console.log(`✅ Total Outlook events fetched: ${allEvents.length} events across ${pageCount} pages`);

    if (allEvents.length === 0) {
      const empty = [];
      Object.defineProperty(empty, '_fetchComplete', { value: !fetchTruncated, enumerable: false });
      return empty;
    }

    // Normalize Graph datetimes to a real UTC ISO string. The default Graph
    // response uses { dateTime: "2026-05-15T01:30:00.0000000", timeZone: "UTC" }
    // — the dateTime string has no Z suffix, so JS / Postgres can mis-parse it
    // as local time. We honour the embedded timeZone when present.
    const toUtcIso = (slot) => {
      if (!slot || !slot.dateTime) return null;
      const raw = String(slot.dateTime);
      if (/Z$|[+\-]\d{2}:?\d{2}$/.test(raw)) return raw; // already has TZ marker
      const tz = slot.timeZone || 'UTC';
      if (tz === 'UTC') return raw + 'Z';
      // Last-resort fallback: trust JS engine's IANA handling via Date.UTC
      // (rarely hit because Graph defaults to UTC).
      const d = new Date(raw);
      return isNaN(d.getTime()) ? raw + 'Z' : d.toISOString();
    };

    const mapped = allEvents.map(event => ({
      id:                  event.id,
      outlookId:           event.id,
      iCalUId:             event.iCalUId || null,
      changeKey:           event.changeKey || null,
      lastModifiedAt:      event.lastModifiedDateTime || null,
      title:               event.subject || null,  // null kept deliberately — callers log/skip empty
      startTime:           toUtcIso(event.start),
      endTime:             toUtcIso(event.end),
      location:            event.location?.displayName || '',
      organizer:           event.organizer?.emailAddress?.address || '',
      isTeamsMeeting:      !!(event.isOnlineMeeting || event.onlineMeetingUrl),
      teamsJoinLink:       event.onlineMeetingUrl || null,
      categories:          event.categories || [],
      isCancelled:         !!(event.isCancelled),
      showAs:              event.showAs || null,
      type:                event.type || 'singleInstance',
      seriesMasterId:      event.seriesMasterId || null,
    }));
    // Deletion-safety consumers must be able to distinguish a complete window
    // fetch from one truncated at the page cap.
    Object.defineProperty(mapped, '_fetchComplete', { value: !fetchTruncated, enumerable: false });
    return mapped;
  } catch (error) {
    console.error('Error getting Outlook events:', error.response?.data || error.message);
    throw new Error('Failed to fetch Outlook calendar events');
  }
}

// ===== STEP 6: CREATE EVENT IN OUTLOOK =====
// Create a new event in user's calendar

async function createOutlookEvent(accessToken, eventData) {
  try {
    const outlookEvent = {
      subject: eventData.title,
      start: {
        dateTime: eventData.startTime,
        timeZone: 'Australia/Perth',
      },
      end: {
        dateTime: eventData.endTime,
        timeZone: 'Australia/Perth',
      },
      ...(eventData.location ? { location: { displayName: eventData.location } } : {}),
      // Only include categories that already exist in the mailbox; sending an
      // unknown category name causes Graph to silently drop it or reject the call.
      // We pass an empty array by default — callers may pass known category names.
      categories: eventData.categories?.length ? eventData.categories : [],
      isReminderOn: true,
      reminderMinutesBeforeStart: 15,
      // Note: Graph open extensions cannot be embedded in the POST body —
      // they require a separate POST to /events/{id}/extensions after creation.
      // We track the link between our DB record and Outlook via outlook_id stored
      // in the events table, so no extension metadata is needed here.
    };

    const response = await axios.post(
      `${MICROSOFT_OAUTH_CONFIG.graphBaseUri}/me/calendar/events`,
      outlookEvent,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      outlookId: response.data.id,
      subject: response.data.subject,
      created: true
    };
  } catch (error) {
    console.error('Error creating Outlook event:', error.response?.data || error.message);
    throw new Error('Failed to create event in Outlook');
  }
}

// ===== STEP 7: UPDATE EVENT IN OUTLOOK =====
// Partial-update aware: only fields present in eventData are sent in the PATCH
// body. This lets callers update just the location without touching start/end/title.

async function updateOutlookEvent(accessToken, outlookEventId, eventData) {
  try {
    const outlookEvent = {};

    if (eventData.title      !== undefined) outlookEvent.subject    = eventData.title;
    if (eventData.startTime  !== undefined) outlookEvent.start      = { dateTime: eventData.startTime, timeZone: 'Australia/Perth' };
    if (eventData.endTime    !== undefined) outlookEvent.end        = { dateTime: eventData.endTime,   timeZone: 'Australia/Perth' };
    if (eventData.location   !== undefined) outlookEvent.location   = { displayName: eventData.location || '' };
    if (eventData.categories !== undefined) outlookEvent.categories = eventData.categories;
    if (eventData.body       !== undefined) outlookEvent.body       = { contentType: 'text', content: eventData.body };

    const response = await axios.patch(
      `${MICROSOFT_OAUTH_CONFIG.graphBaseUri}/me/calendar/events/${outlookEventId}`,
      outlookEvent,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      outlookId: response.data.id,
      updated: true
    };
  } catch (error) {
    console.error('Error updating Outlook event:', error.response?.data || error.message);
    throw new Error('Failed to update event in Outlook');
  }
}

// ===== STEP 8: DELETE EVENT IN OUTLOOK =====

async function deleteOutlookEvent(accessToken, outlookEventId) {
  try {
    await axios.delete(
      `${MICROSOFT_OAUTH_CONFIG.graphBaseUri}/me/calendar/events/${outlookEventId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return { deleted: true };
  } catch (error) {
    console.error('Error deleting Outlook event:', error.response?.data || error.message);
    throw new Error('Failed to delete event from Outlook');
  }
}

// ===== DELTA SYNC =====
// Uses Microsoft Graph /calendarView/delta to fetch only what changed since
// the last sync. On the very first call (no deltaToken), pass null — Graph
// will do a full pass and return a deltaToken for future incremental calls.
//
// Returns:
//   { changed: [...], deleted: [...], deltaToken: "..." }
//
// changed = events created or updated since last token
// deleted = event IDs removed from Outlook since last token
// deltaToken = store this and pass it next time

async function getOutlookCalendarDelta(accessToken, deltaToken = null) {
  const baseUrl = `${MICROSOFT_OAUTH_CONFIG.graphBaseUri}/me/calendarView/delta`;

  // Bootstrap window: 90 days back + 180 days forward from today.
  // A ±2-year window previously caused the app to freeze on re-bootstrap by
  // fetching thousands of historical events (Ann has 5,292) and upserting them
  // one by one. A tighter window keeps the initial fetch to ~few hundred events.
  const now = new Date();
  const startDateTime = new Date(now.getTime() - 90  * 24 * 60 * 60 * 1000).toISOString();
  const endDateTime   = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();

  // When a stored deltaToken is a full Graph URL (Microsoft sometimes returns
  // the complete @odata.deltaLink rather than a bare token), use it directly.
  // Assembling baseUrl?$deltaToken=<full URL> produces a malformed request that
  // Graph rejects with 400 — that was the root cause of the perpetual bootstrap.
  const firstUrl = deltaToken
    ? (deltaToken.startsWith('https://') ? deltaToken : `${baseUrl}?$deltaToken=${encodeURIComponent(deltaToken)}`)
    : `${baseUrl}?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}&$select=id,iCalUId,changeKey,subject,start,end,location,categories,isCancelled,showAs,lastModifiedDateTime,type,seriesMasterId`;

  const changed = [];
  const deleted = [];
  let nextLink = firstUrl;
  let newDeltaToken = null;
  let pageCount = 0;
  const MAX_PAGES = 100;

  // Normalize a Graph date slot to a true UTC ISO instant. Because the delta
  // fetch below sends `Prefer: outlook.timezone="UTC"`, Graph returns dateTime
  // in UTC (no 'Z' suffix) with timeZone:"UTC", so appending 'Z' is correct.
  // Any slot that already carries a TZ marker is passed through unchanged.
  const toUtcIso = (slot) => {
    if (!slot || !slot.dateTime) return null;
    const raw = String(slot.dateTime);
    if (/Z$|[+\-]\d{2}:?\d{2}$/.test(raw)) return raw; // already has a TZ marker
    return raw + 'Z';                                  // UTC (guaranteed by Prefer header)
  };

  while (nextLink && pageCount < MAX_PAGES) {
    pageCount++;
    const response = await axios.get(nextLink, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        // Same root-cause fix as the initial sync: force UTC so toUtcIso()'s
        // 'Z' append is correct and delta-synced events aren't shifted +8h.
        'Prefer': 'outlook.timezone="UTC"'
      }
    });

    const items = response.data.value || [];
    for (const item of items) {
      if (item['@removed']) {
        deleted.push(item.id);
      } else {
        changed.push({
          outlookId:      item.id,
          iCalUId:        item.iCalUId || null,
          changeKey:      item.changeKey || null,
          lastModifiedAt: item.lastModifiedDateTime || null,
          title:          item.subject || null,
          startTime:      toUtcIso(item.start),
          endTime:        toUtcIso(item.end),
          location:       item.location?.displayName || '',
          categories:     item.categories || [],
          isCancelled:    !!(item.isCancelled),
          showAs:         item.showAs || null,
          type:           item.type || 'singleInstance',
          seriesMasterId: item.seriesMasterId || null,
        });
      }
    }

    // Graph returns either @odata.nextLink (more pages) or
    // @odata.deltaLink (we're done — contains the new token).
    if (response.data['@odata.deltaLink']) {
      const deltaLink = response.data['@odata.deltaLink'];
      const match = deltaLink.match(/[?&]\$deltaToken=([^&]+)/);
      newDeltaToken = match ? decodeURIComponent(match[1]) : deltaLink;
      break;
    }
    nextLink = response.data['@odata.nextLink'] || null;
  }

  return { changed, deleted, deltaToken: newDeltaToken };
}

// ===== SUBSCRIBE TO OUTLOOK WEBHOOKS =====
// Get real-time notifications when Outlook calendar changes

async function subscribeToCalendarChanges(accessToken) {
  try {
    const subscription = {
      changeType: 'created,updated,deleted',
      notificationUrl: `${process.env.WEBHOOK_URL || 'http://localhost:5000'}/webhooks/outlook`,
      resource: 'me/calendar/events',
      expirationDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      clientState: 'therapyScheduler' // Token to verify webhook
    };

    const response = await axios.post(
      `${MICROSOFT_OAUTH_CONFIG.graphBaseUri}/subscriptions`,
      subscription,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      subscriptionId: response.data.id,
      expiresAt: response.data.expirationDateTime
    };
  } catch (error) {
    console.error('Error subscribing to calendar changes:', error.response?.data || error.message);
    // This might fail in development - not critical
    return null;
  }
}

// ===== EXPORTS =====

module.exports = {
  MICROSOFT_OAUTH_CONFIG,
  getAuthorizationUrl,
  getAccessToken,
  refreshAccessToken,
  getMicrosoftUser,
  getOutlookCalendarEvents,
  getOutlookCalendarDelta,
  createOutlookEvent,
  updateOutlookEvent,
  deleteOutlookEvent,
  subscribeToCalendarChanges
};
