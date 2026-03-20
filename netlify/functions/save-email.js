// netlify/functions/save-email.js
//
// Stores submitted emails in Netlify Blobs.
// Accepts: { email, source, metadata }
//   source: 'dynasty-teaser' | 'draft-reveal-schedule' | future sources
//   metadata: any extra context (e.g. league name, reveal ID)
//
// Emails are stored as individual keyed entries:
//   Key: email-{timestamp}-{random}
//   Value: { email, source, metadata, createdAt }
//
// To retrieve all emails later, use the Netlify Blobs list API
// or a future admin function. Nothing is ever overwritten.
//
// v2 upgrade path: add Resend call here once domain is verified
// and sending is ready. The data collection is already complete.

const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email, source, metadata } = body;

  // Basic email validation
  if (!email || !email.includes('@') || !email.includes('.')) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid email address' })
    };
  }

  const sanitizedEmail = email.trim().toLowerCase();
  const timestamp      = Date.now();
  const random         = Math.random().toString(36).substring(2, 8);
  const key            = `email-${timestamp}-${random}`;

  try {
    const store = getStore({
      name: 'email-signups',
      consistency: 'strong',
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_TOKEN
    });

    await store.set(key, JSON.stringify({
      email:     sanitizedEmail,
      source:    source || 'unknown',
      metadata:  metadata || {},
      createdAt: new Date().toISOString()
    }));

    console.log(`Email saved: ${sanitizedEmail} from ${source || 'unknown'}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error('Email save error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to save email', detail: err.message })
    };
  }
};
