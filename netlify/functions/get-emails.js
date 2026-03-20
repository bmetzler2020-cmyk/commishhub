// netlify/functions/get-emails.js
//
// Returns all stored emails from the email-signups Blobs store.
// Protected by a secret token — pass as ?token=YOUR_ADMIN_TOKEN
// Set ADMIN_TOKEN as a Netlify environment variable.
//
// Usage: https://commishhub.com/.netlify/functions/get-emails?token=YOUR_TOKEN
// Returns: JSON array of { email, source, metadata, createdAt }

const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Simple token auth — keeps random people from dumping your email list
  const token       = event.queryStringParameters?.token;
  const adminToken  = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ADMIN_TOKEN not configured' }) };
  }
  if (token !== adminToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const store = getStore({
      name: 'email-signups',
      consistency: 'strong',
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_TOKEN
    });

    // List all keys in the store
    const { blobs } = await store.list();

    if (!blobs || blobs.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 0, emails: [] })
      };
    }

    // Fetch each entry
    const emails = await Promise.all(
      blobs.map(async ({ key }) => {
        try {
          const raw = await store.get(key);
          return raw ? JSON.parse(raw) : null;
        } catch (e) {
          return null;
        }
      })
    );

    const valid = emails
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: valid.length, emails: valid })
    };

  } catch (err) {
    console.error('get-emails error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to retrieve emails', detail: err.message })
    };
  }
};
