// netlify/functions/generate.js
//
// Proxies requests from the browser to the Anthropic API.
// The API key never touches the browser.
//
// RATE LIMITING:
// Two separate counters per IP:
//   - "nickname" tool: 30/hour (retry-heavy by design)
//   - all other tools: 20/hour (shared — trash talk, etc.)
// Uses in-memory store — serverless instances don't share state so
// real-world effective limits are higher. Upgrade to Upstash Redis at scale.

const ipRequestLog   = {};   // key: "ip"         — general tools
const ipNicknameLog  = {};   // key: "ip:nickname" — nickname generator only

const RATE_LIMIT_GENERAL  = 40;
const RATE_LIMIT_NICKNAME = 40;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip, tool) {
  const now   = Date.now();
  const isNickname = tool === 'nickname';
  const log   = isNickname ? ipNicknameLog : ipRequestLog;
  const limit = isNickname ? RATE_LIMIT_NICKNAME : RATE_LIMIT_GENERAL;
  const key   = isNickname ? ip + ':nickname' : ip;

  if (!log[key]) log[key] = [];
  log[key] = log[key].filter(ts => now - ts < WINDOW_MS);
  if (log[key].length >= limit) return true;
  log[key].push(now);
  return false;
}

exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const ip = event.headers['x-forwarded-for']
    ? event.headers['x-forwarded-for'].split(',')[0].trim()
    : event.headers['client-ip'] || 'unknown';

  // Caller can pass { tool: 'nickname' } to use the separate nickname counter
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const tool = payload.tool || 'general';

  if (isRateLimited(ip, tool)) {
    console.log('Rate limit hit for IP:', ip, '| tool:', tool);
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Rate limit exceeded' })
    };
  }

  // Remove tool field before forwarding — Anthropic API doesn't know about it
  delete payload.tool;

  // Payload validation — lock down what clients can actually send
  const ALLOWED_MODELS = ['claude-sonnet-4-20250514', 'claude-sonnet-4-6'];
  const MAX_TOKENS_CAP  = 400; // brainstorm pass on nickname generator uses 300
  const MAX_SYSTEM_LEN  = 4000; // longest system prompt across all tools is ~2000 chars
  const MAX_MSG_LEN     = 2000; // user message content cap

  if (!ALLOWED_MODELS.includes(payload.model)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid model' }) };
  }
  if (typeof payload.max_tokens !== 'number' || payload.max_tokens > MAX_TOKENS_CAP) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid max_tokens' }) };
  }
  if (payload.system && payload.system.length > MAX_SYSTEM_LEN) {
    return { statusCode: 400, body: JSON.stringify({ error: 'System prompt too long' }) };
  }
  if (Array.isArray(payload.messages)) {
    for (const msg of payload.messages) {
      if (typeof msg.content === 'string' && msg.content.length > MAX_MSG_LEN) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Message content too long' }) };
      }
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  console.log('Model:', payload.model, '| IP:', ip, '| tool:', tool);

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
