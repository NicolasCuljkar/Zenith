require('dotenv').config();
const https = require('https');

const CLIENT_ID    = process.env.BRIDGE_CLIENT_ID;
const CLIENT_SECRET= process.env.BRIDGE_CLIENT_SECRET;
const TOKEN        = 'f851b6463a5e59e6c12ee6b4626ecb69a31a4291-291f40e0-6b6f-4698-be82-93a68fd3ea15';
const REDIRECT     = encodeURIComponent('http://localhost:3001/banque');

function get(hostname, path, headers = {}) {
  return new Promise(resolve => {
    https.request({ hostname, path, method: 'GET', headers }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), raw }); }
        catch { resolve({ status: res.statusCode, body: null, raw: raw.slice(0, 300) }); }
      });
    }).on('error', e => resolve({ status: 'ERR', raw: e.message })).end();
  });
}

async function run() {
  const paths = [
    `/v3/items/add/url?access_token=${TOKEN}&redirect_uri=${REDIRECT}&client_id=${CLIENT_ID}`,
    `/items/add/url?access_token=${TOKEN}&redirect_uri=${REDIRECT}&client_id=${CLIENT_ID}`,
    `/v2/connect?access_token=${TOKEN}&redirect_uri=${REDIRECT}&client_id=${CLIENT_ID}`,
    `/?access_token=${TOKEN}&redirect_uri=${REDIRECT}&client_id=${CLIENT_ID}`,
  ];

  console.log('Testing GET on connect.bridgeapi.io...\n');
  for (const path of paths) {
    const r = await get('connect.bridgeapi.io', path);
    console.log(`${r.status} GET ${path.split('?')[0]}`);
    if (r.body) console.log('  JSON:', JSON.stringify(r.body).slice(0, 300));
    else        console.log('  HTML/text:', r.raw.slice(0, 200));
    console.log('');
  }
}

run();
