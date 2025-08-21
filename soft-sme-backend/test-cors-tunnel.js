const https = require('https');

const host = process.env.TUNNEL_HOST || 'kinda-broker-railroad-eyes.trycloudflare.com';
const path = process.env.TUNNEL_PATH || '/api/auth/login';

// Test CORS preflight request to tunnel URL
const options = {
  hostname: host,
  port: 443,
  path: path,
  method: 'OPTIONS',
  headers: {
    'Origin': 'https://softsme.phoenixtrailers.ca',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type, Authorization'
  }
};

console.log('Testing CORS configuration with tunnel...');
console.log('Origin:', options.headers.Origin);
console.log('Requesting:', `https://${options.hostname}${options.path}`);

const req = https.request(options, (res) => {
  console.log('Response Status:', res.statusCode);
  console.log('Response Headers:');
  
  Object.keys(res.headers).forEach(key => {
    console.log(`  ${key}: ${res.headers[key]}`);
  });
  
  // Check if CORS headers are present
  const corsHeaders = {
    'access-control-allow-origin': res.headers['access-control-allow-origin'],
    'access-control-allow-methods': res.headers['access-control-allow-methods'],
    'access-control-allow-headers': res.headers['access-control-allow-headers'],
    'access-control-allow-credentials': res.headers['access-control-allow-credentials']
  };
  
  console.log('\nCORS Headers:');
  Object.keys(corsHeaders).forEach(key => {
    console.log(`  ${key}: ${corsHeaders[key] || 'NOT SET'}`);
  });
  
  if (corsHeaders['access-control-allow-origin'] === 'https://softsme.phoenixtrailers.ca') {
    console.log('\n✅ CORS is correctly configured for your domain!');
  } else {
    console.log('\n❌ CORS is NOT correctly configured for your domain!');
  }
});

req.on('error', (err) => {
  console.error('Request failed:', err.message);
});

req.end();
