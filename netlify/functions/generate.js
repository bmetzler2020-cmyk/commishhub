// netlify/functions/generate.js
//
// Proxies requests from the browser to the Anthropic API.
// The API key never touches the browser.
//
// RATE LIMITING NOTE:
// Uses an in-memory store — works for single-instance environments.
// Serverless means separate instances won't share state, so the
// real-world effective limit is higher than the number below.
// Upgrade to Upstash Redis when traffic grows.
//
// RATE LIMIT: 20/hour per IP — enough for a real user (10+ generations),
// not enough for systematic abuse. Drop to 10 if abuse becomes an issue.

const ipRequestLog = {};
const RATE_LIMIT = 20;
const WINDOW_MS  = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip) {
  const now = Date.now();
  if (!ipRequestLog[ip]) ipRequestLog[ip] = [];
  ipRequestLog[ip] = ipRequestLog[ip].filter(ts => now - ts < WINDOW_MS);
  if (ipRequestLog[ip].length >= RATE_LIMIT) return true;
  ipRequestLog[ip].push(now);
  return false;
}

exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const ip = event.headers['x-forwarded-for']
    ? event.headers['x-forwarded-for'].split(',')[0].trim()
    : event.headers['client-ip'] || 'unknown';

  if (isRateLimited(ip)) {
    console.log('Rate limit hit for IP:', ip);
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Rate limit exceeded' })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  console.log('Model:', payload.model, '| IP:', ip);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();
    if (!response.ok) console.log('Anthropic error:', response.status, rawText.slice(0, 300));

    let data;
    try { data = JSON.parse(rawText); }
    catch (e) { return { statusCode: 500, body: JSON.stringify({ error: 'Could not parse response' }) }; }

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };

  } catch (err) {
    console.log('Fetch error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Function failed', detail: err.message }) };
  }
};
