// netlify/functions/generate.js

exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
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
    console.log('ERROR: Could not parse request body');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON in request body' })
    };
  }

  // Log what we're sending so we can diagnose issues
  console.log('Model:', payload.model);
  console.log('Tools:', JSON.stringify((payload.tools || []).map(t => t.name || t.type)));

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

    // Read as text first so we can log it before parsing
    const rawText = await response.text();
    console.log('Anthropic status:', response.status);
    console.log('Anthropic response (first 600 chars):', rawText.slice(0, 600));

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Could not parse Anthropic response', raw: rawText.slice(0, 300) })
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
