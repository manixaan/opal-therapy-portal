/**
 * SPLOSE API CLIENT
 *
 * Built against the confirmed live Splose v1 API (validated April 2026).
 *
 * Key conventions:
 *  - Base URL:  https://api.splose.com/v1
 *  - Auth:      Authorization: Bearer <token>
 *  - Pagination: id_gt / id_lt query params — NO "limit" param (server rejects it)
 *  - Date range: startDate / endDate (YYYY-MM-DD) — NOT start_date / end_date
 *  - Envelope:  { data: [...], links: { previousPage?, nextPage? } }
 *  - Write:     POST /appointments, PUT /appointments/{id}, POST /patients
 *  - Cancellation is READ-ONLY from API — must be done in Splose UI
 */

const axios = require('axios');

// ─── Client setup ─────────────────────────────────────────────────────────────

const BASE_URL = (process.env.SPLOSE_BASE_URL || 'https://api.splose.com') + '/v1';

function client() {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${process.env.SPLOSE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

// ─── Rate-limit queue ─────────────────────────────────────────────────────────
// Splose enforces ~2 req/s. We serialize all outbound calls through a queue
// with a minimum gap of 600 ms between requests. On a 429 we back off 5 s
// and retry up to 3 times.

const RATE_LIMIT_MS  = 600;
const RETRY_AFTER_MS = 5000;
const MAX_RETRIES    = 3;
let   _lastRequestAt = 0;
let   _queue         = Promise.resolve();

function _throttledGet(axiosInstance, path, config = {}) {
  _queue = _queue.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, _lastRequestAt + RATE_LIMIT_MS - now);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _lastRequestAt = Date.now();

    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await axiosInstance.get(path, config);
      } catch (err) {
        lastErr = err;
        if (err.response?.status === 429) {
          const backoff = RETRY_AFTER_MS * (attempt + 1);
          console.warn(`⏳ Splose 429 (attempt ${attempt + 1}/${MAX_RETRIES}) — backing off ${backoff}ms for ${path}`);
          await new Promise(r => setTimeout(r, backoff));
          _lastRequestAt = Date.now();
          continue;
        }
        if (err.response?.status === 400) {
          console.error(`❌ Splose 400 on ${path} — params: ${JSON.stringify(config.params)} — body: ${JSON.stringify(err.response?.data)}`);
        }
        throw err;
      }
    }
    throw lastErr;
  });
  return _queue;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Fetching all appointments/cases is expensive. Cache full-list responses for
// 3 minutes so concurrent page loads share one fetch rather than hammering Splose.

const _cache = new Map(); // key → { data, expiresAt }
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.data;
}
function _cacheSet(key, data) {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}
function invalidateCache(key) {
  if (key) _cache.delete(key); else _cache.clear();
}

// ─── Pagination helper ────────────────────────────────────────────────────────
// Follows Splose's nextPage links until exhausted.

// _inflight tracks in-progress full-list fetches so concurrent callers
// wait for the same promise rather than firing duplicate requests.
const _inflight = new Map();

async function fetchAllPages(path, params = {}) {
  // Only cache parameterless full-list fetches (appointments, cases, patients…)
  const hasParams = Object.keys(params).length > 0;
  const cacheKey = hasParams ? null : path;

  if (cacheKey) {
    const cached = _cacheGet(cacheKey);
    if (cached) return cached;
    // If an identical fetch is already running, wait for it
    if (_inflight.has(cacheKey)) return _inflight.get(cacheKey);
  }

  const fetchPromise = (async () => {
    const c = client();
    let url = path;
    const allItems = [];
    let pageCount = 0;
    const MAX_PAGES = 50;
    let firstRequest = true;

    while (url && pageCount < MAX_PAGES) {
      pageCount++;
      const relativePath = url.startsWith('/v1') ? url.slice(3) : url;
      const response = await _throttledGet(c, relativePath, { params: firstRequest ? params : undefined });
      const { data, links } = response.data;
      if (Array.isArray(data)) allItems.push(...data);
      url = links?.nextPage || null;
      firstRequest = false;
    }

    if (cacheKey) { _cacheSet(cacheKey, allItems); _inflight.delete(cacheKey); }
    return allItems;
  })();

  if (cacheKey) {
    _inflight.set(cacheKey, fetchPromise);
    // Clean up inflight entry on error so subsequent callers can retry
    fetchPromise.catch(() => {
      if (_inflight.get(cacheKey) === fetchPromise) _inflight.delete(cacheKey);
    });
  }
  return fetchPromise;
}

// ─── Connection test ──────────────────────────────────────────────────────────

async function testConnection() {
  try {
    const c = client();
    const response = await c.get('/services');
    const count = response.data?.data?.length ?? 0;
    return { ok: true, message: `Connected — ${count} services found` };
  } catch (err) {
    return {
      ok: false,
      message: err.response?.data?.message || err.message,
      status: err.response?.status,
    };
  }
}

// ─── Services ─────────────────────────────────────────────────────────────────

async function getServices() {
  const items = await fetchAllPages('/services');
  return items.map(s => ({
    id: s.id,
    title: s.name,        // Splose uses "name" not "title"
    for: s.for,           // "appointment" | "support activity"
    duration: s.duration,
    price: s.pricing,     // Splose uses "pricing" not "price"
    code: s.code,         // NDIS support item code e.g. 15_617_0128_1_3
    type: s.type,
    taxType: s.taxType,
    archived: !!s.archived,
  }));
}

// ─── Practitioners ────────────────────────────────────────────────────────────

async function getPractitioners() {
  const items = await fetchAllPages('/practitioners');
  return items
    .filter(p => !p.archived && !p.deletedAt && p.isActive !== false)
    .map(p => ({
      id: p.id,
      firstname: p.firstname,
      lastname: p.lastname,
      fullName: `${p.firstname} ${p.lastname}`.trim(),
      email: p.email,
      title: p.title,
      profession: p.profession,
      roleName: p.roleName,
      timezone: p.timezone,
    }));
}

// ─── Locations ────────────────────────────────────────────────────────────────

async function getLocations() {
  const items = await fetchAllPages('/locations');
  return items
    .filter(l => !l.archived && !l.deletedAt)
    .map(l => ({
      id: l.id,
      title: l.title,
      address: l.address,
      suburb: l.suburb,
      state: l.state,
      postalCode: l.postalCode,
      timezone: l.timezone,
    }));
}

// ─── Appointments ─────────────────────────────────────────────────────────────

async function getAppointments(startDate, endDate, practitionerId = null) {
  // Splose /appointments accepts NO date filter params — cursor-only pagination.
  // We fetch all appointments and filter by date client-side.
  const allItems = await fetchAllPages('/appointments');
  const start = startDate ? new Date(startDate) : null;
  const end   = endDate   ? new Date(endDate + 'T23:59:59') : null;

  return allItems
    .filter(a => !a.archived && !a.deletedAt && !a.isUnavailableBlock)
    .filter(a => !practitionerId || a.practitionerId === practitionerId)
    .filter(a => {
      if (!start && !end) return true;
      const d = a.start ? new Date(a.start) : null;
      if (!d) return false;
      if (start && d < start) return false;
      if (end   && d > end)   return false;
      return true;
    })
    .map(normaliseAppointment);
}

async function getAppointment(id) {
  const c = client();
  const response = await c.get(`/appointments/${id}`);
  return normaliseAppointment(response.data);
}

function normaliseAppointment(a) {
  return {
    id: a.id,
    start: a.start,
    end: a.end,
    serviceId: a.serviceId,
    locationId: a.locationId,
    practitionerId: a.practitionerId,
    maxPatients: a.maxPatients,
    repeatId: a.repeatId || null,
    recurringRule: a.recurringRule || null,
    note: a.note || '',
    patients: (a.appointmentPatients || []).map(ap => ({
      patientId: ap.patientId,
      caseId: ap.caseId,
      status: ap.status,
      cancellationReason: ap.cancellationReason || null,
      cancellationRate: ap.cancellationRate || null,
      cancellationNote: ap.cancellationNote || null,
      invoiceId: ap.invoiceId || null,
      doNotInvoice: ap.doNotInvoice || false,
    })),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

async function createAppointment(data) {
  const c = client();
  const payload = {
    start: data.start,
    end: data.end,
    serviceId: Number(data.serviceId),
    locationId: Number(data.locationId),
    practitionerId: Number(data.practitionerId),
    patientId: Number(data.patientId),
    caseId: Number(data.caseId),
    note: data.note || '',
  };
  try {
    const response = await c.post('/appointments', payload);
    invalidateCache('/appointments'); // force fresh fetch after write
    return normaliseAppointment(response.data);
  } catch (err) {
    console.error('❌ createAppointment failed:', err.response?.status, JSON.stringify(err.response?.data));
    throw err;
  }
}

async function updateAppointment(id, data) {
  const c = client();
  const payload = {};
  if (data.start)             payload.start     = data.start;
  if (data.end)               payload.end       = data.end;
  if (data.note !== undefined) payload.note     = data.note;
  if (data.serviceId)         payload.serviceId = data.serviceId;
  const response = await c.put(`/appointments/${id}`, payload);
  return normaliseAppointment(response.data);
}

// ─── Busy times ───────────────────────────────────────────────────────────────

async function getBusyTimes(startDate, endDate, practitionerId = null) {
  // Splose /busy-times likely also uses cursor-only pagination — fetch all, filter client-side.
  const allItems = await fetchAllPages('/busy-times');
  const start = startDate ? new Date(startDate) : null;
  const end   = endDate   ? new Date(endDate + 'T23:59:59') : null;
  const items = allItems.filter(b => {
    if (!start && !end) return true;
    const d = b.start ? new Date(b.start) : null;
    if (!d) return false;
    if (start && d < start) return false;
    if (end   && d > end)   return false;
    return true;
  });
  return items
    .filter(b => !practitionerId || (b.busyTimePractitionerIds || []).includes(practitionerId))
    .map(b => ({
      id: b.id,
      start: b.start,
      end: b.end,
      busyTimeTypeId: b.busyTimeTypeId,
      practitionerIds: b.busyTimePractitionerIds || [],
      note: b.note || '',
    }));
}

async function getBusyTimeTypes() {
  const items = await fetchAllPages('/busy-time-types');
  return items.map(t => ({
    id: t.id,
    title: t.title,
    colour: t.colour,
    isUtilisationIncluded: t.isUtilisationIncluded,
  }));
}

async function createBusyTime(data) {
  const c = client();
  const response = await c.post('/busy-times', {
    start: data.start,
    end: data.end,
    busyTimeTypeId: data.busyTimeTypeId,
    busyTimePractitionerIds: data.practitionerIds || [],
    note: data.note || '',
  });
  return response.data;
}

// ─── Availabilities ───────────────────────────────────────────────────────────
// Max 100-day range per call.

async function getAvailabilities(practitionerId, startDate, endDate) {
  const c = client();
  const response = await c.get(`/availabilities/${practitionerId}`, {
    params: { startDate, endDate },
  });
  return response.data?.data || [];
}

// ─── Patients ─────────────────────────────────────────────────────────────────

/**
 * Extract every possible address field from a raw Splose patient/contact record.
 * Splose has used several different field names across API versions.
 * We capture all of them so the enrichment layer can try whatever is present.
 */
function extractPatientAddress(p) {
  // Possible street/address field names (Splose has used all of these)
  const addressL1 =
    p.addressL1       ||   // most common in current Splose v1
    p.address         ||   // older / alternate naming
    p.streetAddress   ||
    p.addressLine1    ||
    p.street          ||
    null;

  const suburb     = p.suburb     || p.city        || p.town     || null;
  const state      = p.state      || p.province    || null;
  const postalCode = p.postalCode || p.postcode    || p.zip      || null;
  const country    = p.country    || 'Australia';

  // Build a formatted address from components (best-effort)
  const formattedAddress = [addressL1, suburb, state, postalCode, country !== 'Australia' ? country : null]
    .filter(Boolean).join(', ') || null;

  return { addressL1, suburb, state, postalCode, country, formattedAddress };
}

async function getPatient(id) {
  const c = client();
  const response = await c.get(`/patients/${id}`);
  const p = response.data;
  const addr = extractPatientAddress(p);
  return {
    id:           p.id,
    firstname:    p.firstname,
    lastname:     p.lastname,
    fullName:     `${p.firstname} ${p.lastname}`.trim(),
    email:        p.email,
    mobilePhone:  p.mobilePhone,
    ndisNumber:   p.ndisNumber,
    // Address fields — all possible names
    addressL1:    addr.addressL1,
    suburb:       addr.suburb,
    state:        addr.state,
    postalCode:   addr.postalCode,
    country:      addr.country,
    formattedAddress: addr.formattedAddress,
    // Raw record so the enrichment layer can inspect any field we might have missed
    _raw: p,
  };
}

async function getPatients() {
  const items = await fetchAllPages('/patients');
  return items
    .filter(p => !p.archived && !p.deletedAt)
    .map(p => {
      const addr = extractPatientAddress(p);
      return {
        id:           p.id,
        firstname:    p.firstname,
        lastname:     p.lastname,
        fullName:     `${p.firstname} ${p.lastname}`.trim(),
        email:        p.email,
        mobilePhone:  p.mobilePhone,
        ndisNumber:   p.ndisNumber,
        // Address fields
        addressL1:    addr.addressL1,
        suburb:       addr.suburb,
        state:        addr.state,
        postalCode:   addr.postalCode,
        country:      addr.country,
        formattedAddress: addr.formattedAddress,
        // Keep raw for diagnosis (stripped before sending to frontend to save bandwidth)
        _rawAddressFields: {
          addressL1:    p.addressL1,
          address:      p.address,
          streetAddress: p.streetAddress,
          addressLine1: p.addressLine1,
          street:       p.street,
          suburb:       p.suburb,
          city:         p.city,
          state:        p.state,
          postalCode:   p.postalCode,
          postcode:     p.postcode,
          country:      p.country,
        },
      };
    });
}

// ─── Cases ────────────────────────────────────────────────────────────────────

async function getCase(id) {
  const c = client();
  const response = await c.get(`/cases/${id}`);
  return response.data;
}

async function fetchAllCases() {
  return fetchAllPages('/cases');
}

// ─── Support activities ───────────────────────────────────────────────────────

async function createSupportActivity(data) {
  const c = client();
  const response = await c.post('/support-activities', {
    start: data.start,
    end: data.end,
    serviceId: data.serviceId,
    locationId: data.locationId,
    practitionerId: data.practitionerId,
    patientId: data.patientId,
    caseId: data.caseId,
    note: data.note || '',
  });
  return response.data;
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

async function getContacts() {
  return fetchAllPages('/contacts');
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

async function getInvoices(params = {}) {
  return fetchAllPages('/invoices', params);
}

// ─── Payments ─────────────────────────────────────────────────────────────────

async function getPayments() {
  return fetchAllPages('/payments');
}

// ─── Support activities (read) ────────────────────────────────────────────────

async function getSupportActivities() {
  return fetchAllPages('/support-activities');
}

// ─── Support items ────────────────────────────────────────────────────────────

async function getSupportItems() {
  return fetchAllPages('/support-items');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  testConnection,
  getServices,
  getPractitioners,
  getLocations,
  getAppointments,
  getAppointment,
  createAppointment,
  updateAppointment,
  getBusyTimes,
  getBusyTimeTypes,
  createBusyTime,
  getAvailabilities,
  getPatient,
  getPatients,
  getCase,
  fetchAllCases,
  invalidateCache,
  createSupportActivity,
  getContacts,
  getInvoices,
  getPayments,
  getSupportActivities,
  getSupportItems,
};
