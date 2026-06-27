require('dotenv').config();
const https = require('https');

function get(path) {
  return new Promise(resolve => {
    const req = https.get({ hostname: 'api.splose.com', path,
      headers: { 'Authorization': 'Bearer ' + process.env.SPLOSE_API_KEY }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

async function run() {
  // Contact types breakdown
  const contacts = await get('/v1/contacts');
  const types = {};
  (contacts.data || []).forEach(c => { types[c.type] = (types[c.type]||0)+1; });
  console.log('\n📇 CONTACT TYPES:', JSON.stringify(types, null, 2));

  // Sample appointment with patient status (cancellations)
  const appts = await get('/v1/appointments');
  const withStatus = (appts.data||[]).filter(a => a.appointmentPatients?.some(p => p.status !== 'Active'));
  console.log('\n📅 APPOINTMENTS WITH NON-ACTIVE STATUS:', withStatus.length);
  if (withStatus[0]) {
    console.log('Sample:', JSON.stringify(withStatus[0].appointmentPatients, null, 2).substring(0,400));
  }

  // Invoice item code breakdown
  const invoices = await get('/v1/invoices');
  const codes = {};
  (invoices.data||[]).forEach(inv => {
    (inv.invoiceItems||[]).forEach(item => {
      if (item.code) codes[item.code] = (codes[item.code]||0)+1;
    });
  });
  console.log('\n💰 NDIS ITEM CODES (top 10):', Object.entries(codes).sort((a,b)=>b[1]-a[1]).slice(0,10));

  // Cases with budget populated
  const cases = await get('/v1/cases');
  const withBudget = (cases.data||[]).filter(c => c.budget !== null);
  console.log('\n📁 CASES WITH BUDGET:', withBudget.length, '/', (cases.data||[]).length);
  if (withBudget[0]) console.log('Sample budget:', withBudget[0].budget);
}
run();
