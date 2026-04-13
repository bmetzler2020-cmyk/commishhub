// netlify/functions/get-reveal.js
const { getStore } = require('@netlify/blobs');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing id parameter' }) };
  }

  let data;
  try {
    const store = getStore({
      name: 'draft-reveals',
      consistency: 'strong',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN
    });
    const raw = await store.get(`reveal-${id}`);
    if (!raw) { data = null; }
    else { data = JSON.parse(raw); }
  } catch (err) {
    console.error('Blob fetch error:', err.message);
    return { statusCode: 404, body: JSON.stringify({ error: 'Reveal not found' }) };
  }

  if (!data) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Reveal not found' }) };
  }

  const now      = Date.now();
  const revealAt = new Date(data.revealTime).getTime();
  const isReady  = now >= revealAt;

  if (isReady) {
    // Normalize shuffled entries — handles old string-array format gracefully
    // so reveals created before the bio update still work
    const shuffled = (data.shuffled || []).map(entry => {
      if (typeof entry === 'string') {
        return { name: entry, hometown: '', record: '', tagline: '' };
      }
      return {
        name:     entry.name     || '',
        hometown: entry.hometown || '',
        record:   entry.record   || '',
        tagline:  entry.tagline  || ''
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ready: true,
        shuffled,
        leagueName: data.leagueName,
        speed: data.speed
      })
    };
  } else {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ready: false,
        revealTime: data.revealTime,
        leagueName: data.leagueName
      })
    };
  }
};
