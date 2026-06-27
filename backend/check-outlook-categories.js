require('dotenv').config();
const https = require('https');

function get(path, token) {
  return new Promise(resolve => {
    const req = https.get({
      hostname: 'graph.microsoft.com',
      path,
      headers: { 'Authorization': 'Bearer ' + token }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

async function run() {
  // Get access token from DB
  const userRes = await pool.query('SELECT access_token FROM users LIMIT 1');
  const token = userRes.rows[0]?.access_token;
  if (!token) { console.log('No token in DB'); pool.end(); return; }

  // Fetch master categories (colour map)
  console.log('\n🎨 MASTER CATEGORIES (Outlook colour assignments):');
  const cats = await get('/v1.0/me/outlook/masterCategories', token);
  console.log(JSON.stringify(cats, null, 2));

  // Sample of events that have categories set
  console.log('\n📅 EVENTS WITH CATEGORIES (from DB):');
  const evRes = await pool.query(
    "SELECT title, categories FROM events WHERE categories IS NOT NULL AND array_length(categories,1) > 0 LIMIT 10"
  );
  evRes.rows.forEach(r => console.log(r.categories, '→', r.title));

  pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
