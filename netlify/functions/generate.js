// netlify/functions/generate.js
//
// Proxies requests from the browser to the Anthropic API.
// The API key never touches the browser.
//
// RATE LIMITING NOTE:
// This uses an in-memory store, which works for single-instance
// environments but will not persist across separate Netlify function
// invocations if they land on different server instances (serverless limitation).
// Good enough for early traffic. Upgrade to Upstash Redis when traffic grows.

// ── In-memory rate limit store ──────────────────────────────
// Structure: { "ip_address": [timestamp1, timestamp2, ...] }
const ipRequestLog = {};
const RATE_LIMIT = 10;          // max requests
const WINDOW_MS = 60 * 60 * 1000; // per hour (in milliseconds)

function isRateLimited(ip) {
  const now = Date.now();
  if (!ipRequestLog[ip]) {
    ipRequestLog[ip] = [];
  }
  // Remove timestamps older than the window
  ipRequestLog[ip] = ipRequestLog[ip].filter(ts => now - ts < WINDOW_MS);
  // Check if over limit
  if (ipRequestLog[ip].length >= RATE_LIMIT) {
    return true;
  }
  // Log this request
  ipRequestLog[ip].push(now);
  return false;
}

// ── Handler ─────────────────────────────────────────────────
exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Get client IP from Netlify headers
  const ip = event.headers['x-forwarded-for']
    ? event.headers['x-forwarded-for'].split(',')[0].trim()
    : event.headers['client-ip'] || 'unknown';

  // Check rate limit before doing anything else
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
    console.log('ERROR: ANTHROPIC_API_KEY not set');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in environment variables' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON in request body' })
    };
  }

  console.log('Model:', payload.model);
  console.log('IP:', ip);

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
    console.log('Anthropic status:', response.status);
    if (!response.ok) {
      console.log('Anthropic error:', rawText.slice(0, 300));
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Could not parse Anthropic response' })
      };
    }

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };

  } catch (err) {
    console.log('Fetch error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Function failed', detail: err.message })
    };
  }
};
