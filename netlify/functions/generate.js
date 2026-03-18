// netlify/functions/generate.js
//
// Proxies requests from the browser to the Anthropic API.
// The API key never touches the browser — it lives only here
// as a Netlify environment variable.

exports.handler = async function(event) {

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Check API key is configured
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in environment variables' })
    };
  }

  // Parse request body
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON in request body' })
    };
  }

  // Forward to Anthropic
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for web_search tool
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    // Log errors to Netlify function logs for debugging (not visible to browser)
    if (!response.ok) {
      console.error('Anthropic API error:', response.status, JSON.stringify(data));
    }

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };

  } catch (err) {
    console.error('Function error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Function failed', detail: err.message })
    };
  }
};
