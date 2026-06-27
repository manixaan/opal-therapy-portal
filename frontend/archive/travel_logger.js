/**
 * Travel Logbook Logger
 *
 * Auto-captures business travel when scheduler creates appointments/busy-times
 * Integrates with Google Maps API for distance calculation
 * Stores logs in local database (IndexedDB or SQLite)
 *
 * Usage:
 *   - Call logTravel() after appointment creation
 *   - Call getTravelSummary() for daily/monthly/yearly reports
 *   - Call generateAnnualReport() to create PDF/CSV export
 */

// Constants
const ATO_RATE_2026 = 0.66; // cents per km for FY2026
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PRACTITIONER_HOME = {
  name: 'Home',
  address: '123 Therapist Street, Willetton WA 6155',
  latitude: -32.0234,
  longitude: 115.8456,
  type: 'home'
};

/**
 * Main logger: called after scheduler creates appointment or busy-time
 */
async function logTravelForAppointment(appointmentData) {
  const {
    appointmentId,
    clientName,
    clientId,
    caseId,
    sessionType,
    sessionDuration,
    startTime,
    endTime,
    location,
    previousLocation
  } = appointmentData;

  // 1. Determine travel route
  const route = {
    from: previousLocation || PRACTITIONER_HOME,
    to: location,
    purpose: `${sessionType} session with ${clientName}`
  };

  // 2. Calculate distance via Google Maps
  const travelData = await calculateDistance(route.from, route.to);

  // 3. Create logbook entry
  const entry = createTravelLogEntry({
    appointmentId,
    dateTime: new Date(startTime),
    startLocation: route.from,
    endLocation: route.to,
    purpose: route.purpose,
    clientName,
    clientId,
    caseId,
    sessionType,
    sessionDuration,
    kms: travelData.distanceKm,
    googleMapsRoute: travelData
  });

  // 4. Store in database
  await saveTravelLogEntry(entry);

  return entry;
}

/**
 * Create travel log entry object
 */
function createTravelLogEntry({
  appointmentId,
  dateTime,
  startLocation,
  endLocation,
  purpose,
  clientName,
  clientId,
  caseId,
  sessionType,
  sessionDuration,
  kms,
  googleMapsRoute
}) {
  return {
    id: `TL-${dateTime.toISOString().split('T')[0]}-${Math.random().toString(36).substr(2, 5)}`.toUpperCase(),
    dateTime: dateTime.toISOString(),
    date: dateTime.toISOString().split('T')[0],
    dayOfWeek: getDayOfWeek(dateTime),
    startTime: dateTime.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
    endTime: new Date(dateTime.getTime() + 35 * 60000).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }), // estimate 35 min travel

    startLocation: {
      name: startLocation.name,
      address: startLocation.address,
      latitude: startLocation.latitude,
      longitude: startLocation.longitude,
      type: startLocation.type
    },

    endLocation: {
      name: endLocation.name,
      address: endLocation.address,
      latitude: endLocation.latitude,
      longitude: endLocation.longitude,
      type: endLocation.type
    },

    purpose,

    client: clientId ? {
      patientId: clientId,
      name: clientName,
      caseId: caseId,
      ndisNumber: null
    } : null,

    sessionDetails: sessionType ? {
      appointmentId,
      sessionType,
      duration_minutes: sessionDuration
    } : null,

    travel: {
      kms: parseFloat(kms.toFixed(1)),
      source: 'google_maps_api',
      route: googleMapsRoute
    },

    vehicle: {
      id: 'VEH-001',
      name: 'Toyota Corolla (White)',
      registration: 'WA 26 ABC',
      fuelType: 'Unleaded 91'
    },

    businessUse: {
      isBusinessTravel: true,
      percentBusiness: 100,
      note: null
    },

    metadata: {
      createdAt: new Date().toISOString(),
      createdBy: 'scheduler_auto',
      editedAt: null,
      flaggedForReview: false,
      reviewNotes: null
    }
  };
}

/**
 * Calculate distance via Google Maps Routes API
 */
async function calculateDistance(startLocation, endLocation) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('Google Maps API key not configured. Using estimate.');
    return estimateDistance(startLocation, endLocation);
  }

  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: startLocation.latitude,
              longitude: startLocation.longitude
            }
          }
        },
        destination: {
          location: {
            latLng: {
              latitude: endLocation.latitude,
              longitude: endLocation.longitude
            }
          }
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: false
      })
    });

    if (!response.ok) {
      console.warn(`Google Maps API error: ${response.status}. Using estimate.`);
      return estimateDistance(startLocation, endLocation);
    }

    const data = await response.json();
    const leg = data.routes[0].legs[0];
    const distanceKm = leg.distanceMeters / 1000;
    const durationSeconds = parseInt(leg.duration.replace('s', ''));

    return {
      distanceMeters: leg.distanceMeters,
      distanceKm: parseFloat((distanceKm).toFixed(1)),
      duration_seconds: durationSeconds,
      duration_minutes: Math.round(durationSeconds / 60),
      source: 'google_maps_api'
    };
  } catch (error) {
    console.error('Google Maps API error:', error);
    return estimateDistance(startLocation, endLocation);
  }
}

/**
 * Fallback: estimate distance using haversine formula
 */
function estimateDistance(loc1, loc2) {
  const R = 6371; // Earth's radius in km
  const lat1 = (loc1.latitude * Math.PI) / 180;
  const lat2 = (loc2.latitude * Math.PI) / 180;
  const deltaLat = ((loc2.latitude - loc1.latitude) * Math.PI) / 180;
  const deltaLng = ((loc2.longitude - loc1.longitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;

  // Add 20% buffer for actual road distance (crow flies vs. roads)
  const adjustedKm = distanceKm * 1.2;

  return {
    distanceMeters: Math.round(adjustedKm * 1000),
    distanceKm: parseFloat((adjustedKm).toFixed(1)),
    duration_minutes: Math.round((adjustedKm / 50) * 60), // assume avg 50km/h
    source: 'haversine_estimate'
  };
}

/**
 * Save travel log entry to database
 */
async function saveTravelLogEntry(entry) {
  return new Promise((resolve, reject) => {
    const db = openDatabase();
    const transaction = db.transaction('travel_logs', 'readwrite');
    const store = transaction.objectStore('travel_logs');

    const request = store.add(entry);

    request.onsuccess = () => {
      console.log(`Travel logged: ${entry.id} (${entry.travel.kms} km)`);
      resolve(entry);
    };

    request.onerror = () => {
      console.error('Error saving travel log:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Retrieve travel logs for a date range
 */
async function getTravelLogs(startDate, endDate) {
  return new Promise((resolve, reject) => {
    const db = openDatabase();
    const transaction = db.transaction('travel_logs', 'readonly');
    const store = transaction.objectStore('travel_logs');
    const index = store.index('by_date');

    const range = IDBKeyRange.bound(
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0],
      false,
      false
    );

    const request = index.getAll(range);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('Error retrieving travel logs:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get summary for a specific date range
 */
async function getTravelSummary(startDate, endDate) {
  const logs = await getTravelLogs(startDate, endDate);

  const summary = {
    periodStart: startDate.toISOString().split('T')[0],
    periodEnd: endDate.toISOString().split('T')[0],
    totalEntries: logs.length,
    totalDays: new Set(logs.map(l => l.date)).size,
    totalKms: 0,
    totalClaim: 0,
    byClient: {},
    byRegion: {},
    warnings: []
  };

  for (const log of logs) {
    summary.totalKms += log.travel.kms;
    summary.totalClaim += log.travel.kms * ATO_RATE_2026;

    // By client
    if (log.client) {
      const clientKey = log.client.name;
      if (!summary.byClient[clientKey]) {
        summary.byClient[clientKey] = { kms: 0, trips: 0, caseId: log.client.caseId };
      }
      summary.byClient[clientKey].kms += log.travel.kms;
      summary.byClient[clientKey].trips += 1;
    }
  }

  summary.totalKms = parseFloat(summary.totalKms.toFixed(1));
  summary.totalClaim = parseFloat(summary.totalClaim.toFixed(2));
  summary.averageKmsPerDay = parseFloat((summary.totalKms / summary.totalDays).toFixed(1));

  return summary;
}

/**
 * Get financial year summary (1 July – 30 June)
 */
async function getFinancialYearSummary(year) {
  // year = 2026 means FY 2025-2026 (1 Jul 2025 – 30 Jun 2026)
  const fyStart = new Date(`${year - 1}-07-01`);
  const fyEnd = new Date(`${year}-06-30`);

  const logs = await getTravelLogs(fyStart, fyEnd);

  const summary = {
    financialYear: `${year - 1}-${year}`,
    periodStart: fyStart.toISOString().split('T')[0],
    periodEnd: fyEnd.toISOString().split('T')[0],
    totalEntries: logs.length,
    totalDays: new Set(logs.map(l => l.date)).size,
    totalKms: 0,
    averageKmsPerDay: 0,
    totalClaim: 0,
    monthly: {},
    warnings: []
  };

  // Group by month
  for (const log of logs) {
    const month = log.date.substring(0, 7); // YYYY-MM
    if (!summary.monthly[month]) {
      summary.monthly[month] = { kms: 0, trips: 0, days: new Set() };
    }
    summary.monthly[month].kms += log.travel.kms;
    summary.monthly[month].trips += 1;
    summary.monthly[month].days.add(log.date);
    summary.totalKms += log.travel.kms;
  }

  summary.totalKms = parseFloat(summary.totalKms.toFixed(1));
  summary.totalClaim = parseFloat((summary.totalKms * ATO_RATE_2026).toFixed(2));
  summary.averageKmsPerDay = parseFloat((summary.totalKms / summary.totalDays).toFixed(1));

  // Convert Set to count
  for (const month in summary.monthly) {
    summary.monthly[month].days = summary.monthly[month].days.size;
  }

  // Add ATO compliance warnings
  checkComplianceIssues(logs, summary);

  return summary;
}

/**
 * Check for ATO compliance issues
 */
function checkComplianceIssues(logs, summary) {
  const sortedLogs = logs.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Check for gaps in logging
  let lastLogDate = null;
  for (const log of sortedLogs) {
    if (lastLogDate) {
      const daysBetween = (new Date(log.date) - new Date(lastLogDate)) / (1000 * 60 * 60 * 24);
      if (daysBetween > 12) {
        summary.warnings.push({
          type: 'gap_in_recording',
          date: lastLogDate,
          message: `No travel logged for ${Math.round(daysBetween)} consecutive business days`
        });
      }
    }
    lastLogDate = log.date;
  }

  // Check for unusual distances
  const avgKm = summary.totalKms / logs.length;
  for (const log of logs) {
    if (log.travel.kms > avgKm * 2) {
      summary.warnings.push({
        type: 'unusual_distance',
        date: log.date,
        entryId: log.id,
        kms: log.travel.kms,
        message: `Distance significantly higher than usual (${log.travel.kms} km vs. avg ${avgKm.toFixed(1)} km)`
      });
    }
  }
}

/**
 * Initialize IndexedDB database
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('OpalTherapyDB', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('travel_logs')) {
        const store = db.createObjectStore('travel_logs', { keyPath: 'id' });
        store.createIndex('by_date', 'date', { unique: false });
        store.createIndex('by_client', 'client.patientId', { unique: false });
      }
    };
  }).then(db => {
    db.close();
    const newRequest = indexedDB.open('OpalTherapyDB', 1);
    return new Promise((resolve, reject) => {
      newRequest.onsuccess = () => resolve(newRequest.result);
      newRequest.onerror = () => reject(newRequest.error);
    });
  });
}

/**
 * Utility: get day of week
 */
function getDayOfWeek(date) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    logTravelForAppointment,
    getTravelLogs,
    getTravelSummary,
    getFinancialYearSummary,
    calculateDistance
  };
}
