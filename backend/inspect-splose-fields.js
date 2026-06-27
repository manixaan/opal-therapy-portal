require('dotenv').config();
const https = require('https');

const KEY = process.env.SPLOSE_API_KEY;

function get(path) {
  return new Promise(resolve => {
    const req = https.get({
      hostname: 'api.splose.com', path,
      headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({}); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

async function inspect(label, path) {
  const result = await get(path);
  const record = result.data?.[0] || result;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📋 ${label}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(JSON.stringify(record, null, 2).substring(0, 1500));
}

async function run() {
  await inspect('PATIENT (first record)', '/v1/patients');
  await inspect('CASE (first record)', '/v1/cases');
  await inspect('INVOICE (first record)', '/v1/invoices');
  await inspect('PAYMENT (first record)', '/v1/payments');
  await inspect('SUPPORT ITEM (first record)', '/v1/support-items');
  await inspect('CONTACT (first record)', '/v1/contacts');
  await inspect('SUPPORT ACTIVITY (first record)', '/v1/support-activities');
  await inspect('BUSY TIME TYPE (all)', '/v1/busy-time-types');
}

run();
