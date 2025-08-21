const http = require('http');

// Test CORS preflight request
const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/auth/login',
  method: 'OPTIONS',
  headers: {
    'Origin': 'https://softsme.phoenixtrailers.ca',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type, Authorization'
  }
};

console.log('Testing CORS configuration...');
console.log('Origin:', options.headers.Origin);
console.log('Requesting:', `http://${options.hostname}:${options.port}${options.path}`);

const req = http.request(options, (res) => {
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
  console.log('\nThis could mean:');
  console.log('1. Backend server is not running');
  console.log('2. Backend is running on a different port');
  console.log('3. There\'s a network connectivity issue');
});

req.end();
