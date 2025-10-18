#!/usr/bin/env node
const { fetch } = require('undici');

async function checkEndpoint(url, label) {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `${label} check failed with status ${response.status}. Body: ${body.trim()}`
      );
    }
    console.log(`✅ ${label} check passed (${response.status})`);
  } catch (error) {
    throw new Error(`${label} check error: ${error.message}`);
  }
}

async function main() {
  const backendBaseUrl = (process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:10000').replace(/\/$/, '');
  const dbCheckUrl = `${backendBaseUrl}/api/db-check`;
  const aiHealthUrl = process.env.SMOKE_AI_HEALTH_URL || 'http://127.0.0.1:15000/health';

  try {
    await checkEndpoint(dbCheckUrl, 'Database');
    await checkEndpoint(aiHealthUrl, 'AI agent health');
    console.log('All smoke checks passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();
