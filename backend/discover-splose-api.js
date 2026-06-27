require('dotenv').config();
const https = require('https');

const KEY = process.env.SPLOSE_API_KEY;
const BASE = 'api.splose.com';

// All plausible Splose endpoints to probe
const endpoints = [
  // Core clinical
  '/v1/patients',
  '/v1/cases',
  '/v1/appointments',
  '/v1/services',
  '/v1/support-activities',
  '/v1/busy-times',
  '/v1/busy-time-types',
  '/v1/availabilities',
  
  // Billing & NDIS
  '/v1/invoices',
  '/v1/invoice-items',
  '/v1/payments',
  '/v1/support-items',
  '/v1/funding-sources',
  '/v1/ndis-plans',
  '/v1/plan-managers',
  '/v1/service-agreements',
  '/v1/service-bookings',
  
  // Practice management
  '/v1/practitioners',
  '/v1/locations',
  '/v1/contacts',
  '/v1/referrals',
  '/v1/documents',
  '/v1/files',
  '/v1/notes',
  '/v1/case-notes',
  '/v1/goals',
  
  // Scheduling
  '/v1/recurring-appointments',
  '/v1/appointment-types',
  '/v1/schedules',
  '/v1/time-off',
  '/v1/leave',
  
  // Reporting
  '/v1/reports',
  '/v1/statistics',
  '/v1/analytics',
  
  // Comms
  '/v1/messages',
  '/v1/notifications',
  '/v1/reminders',
  
  // Settings
  '/v1/organisation',
  '/v1/settings',
  '/v1/webhooks',
  '/v1/users',
  '/v1/roles',
  '/v1/teams',
  '/v1/tags',
  '/v1/categories',
  '/v1/claim-codes',
  '/v1/item-codes',
  '/v1/price-lists',
];

async function probe(path) {
  return new Promise(resolve => {
    const req = https.get({
      hostname: BASE,
      path,
      headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        let preview = '';
        try {
          const json = JSON.parse(data);
          if (json.data && Array.isArray(json.data)) {
            preview = `${json.data.length} records`;
            if (json.data[0]) {
              preview += ` | fields: ${Object.keys(json.data[0]).slice(0, 8).join(', ')}`;
            }
          } else if (json.message) {
            preview = json.message;
          }
        } catch(e) { preview = data.substring(0, 80); }
        resolve({ path, status: res.statusCode, preview });
      });
    });
    req.on('error', e => resolve({ path, status: 'ERR', preview: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ path, status: 'TIMEOUT', preview: '' }); });
  });
}

async function run() {
  console.log('🔍 Probing Splose API endpoints...\n');
  // Run in small batches to avoid rate limiting (60/min)
  const results = [];
  for (let i = 0; i < endpoints.length; i += 5) {
    const batch = endpoints.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(probe));
    results.push(...batchResults);
    if (i + 5 < endpoints.length) await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n✅ AVAILABLE (200):');
  results.filter(r => r.status === 200).forEach(r => 
    console.log(`  ${r.path.padEnd(35)} → ${r.preview}`)
  );
  
  console.log('\n⚠️  AUTH/FORBIDDEN (401/403):');
  results.filter(r => r.status === 401 || r.status === 403).forEach(r =>
    console.log(`  ${r.path.padEnd(35)} → ${r.status}`)
  );

  console.log('\n❌ NOT FOUND (404):');
  results.filter(r => r.status === 404).forEach(r =>
    console.log(`  ${r.path}`)
  );

  console.log('\n🔄 OTHER:');
  results.filter(r => ![200,401,403,404].includes(r.status)).forEach(r =>
    console.log(`  ${r.path.padEnd(35)} → ${r.status} ${r.preview}`)
  );
}

run();
