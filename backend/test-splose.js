require('dotenv').config();
const https = require('https');

const key = process.env.SPLOSE_API_KEY;
console.log('Key present:', !!key, '| Length:', key?.length);

// Try multiple auth formats to find what Splose accepts
const authFormats = [
  { label: 'Bearer token',  header: 'Bearer ' + key },
  { label: 'Token prefix',  header: 'Token ' + key },
  { label: 'Raw key',       header: key },
  { label: 'X-API-Key',     headerName: 'X-API-Key', header: key },
];

function tryAuth(format, index) {
  if (index >= authFormats.length) return;

  const headers = { 'Content-Type': 'application/json' };
  if (format.headerName) {
    headers[format.headerName] = format.header;
  } else {
    headers['Authorization'] = format.header;
  }

  const req = https.get({
    hostname: 'api.splose.com',
    path: '/v1/services',
    headers
  }, res => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      console.log(`\n[${format.label}] Status: ${res.statusCode}`);
      if (res.statusCode === 200) {
        console.log('✅ THIS FORMAT WORKS!');
        console.log('Response preview:', data.substring(0, 200));
      } else {
        console.log('❌ Response:', data.substring(0, 100));
      }
      tryAuth(authFormats[index + 1], index + 1);
    });
  });
  req.on('error', e => console.error(`[${format.label}] Error:`, e.message));
  req.setTimeout(10000, () => { req.destroy(); });
}

tryAuth(authFormats[0], 0);
