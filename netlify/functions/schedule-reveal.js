// netlify/functions/schedule-reveal.js
const { getStore } = require('@netlify/blobs');
const { Resend }   = require('resend');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weightedShuffle(teams) {
  const pool = [];
  teams.forEach(t => {
    const balls = Math.max(1, parseInt(t.balls) || 1);
    for (let b = 0; b < balls; b++) pool.push(t.name);
  });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const seen = new Set(), result = [];
  for (const name of pool) {
    if (!seen.has(name)) { seen.add(name); result.push(name); }
  }
  return result;
}

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { teams, leagueName, revealTime, utcOffsetMin, email, speed, weighted } = body;

  if (!teams || teams.length < 2) {
    return { statusCode: 400, body: JSON.stringify({ error: 'At least 2 teams required' }) };
  }
  if (!email || !revealTime) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email and reveal time required' }) };
  }

  let shuffled;
  if (weighted) {
    shuffled = weightedShuffle(teams);
  } else {
    const names = teams.map(t => typeof t === 'string' ? t : t.name);
    shuffled = shuffle(names);
  }

  // Convert local datetime string to UTC using the browser's offset
  // revealTime = "YYYY-MM-DDTHH:MM" (no tz), utcOffsetMin = browser getTimezoneOffset()
  // getTimezoneOffset() returns minutes BEHIND UTC (positive = west of UTC)
  // e.g. EST = 300, so local time is UTC - 300min = UTC + offset
  let revealTimeUTC = revealTime;
  try {
    if (revealTime && typeof utcOffsetMin === 'number') {
      // Parse as if UTC, then add the offset back to get true UTC
      const localMs  = new Date(revealTime + ':00Z').getTime(); // treat as UTC first
      const offsetMs = utcOffsetMin * 60 * 1000;               // convert mins to ms
      revealTimeUTC  = new Date(localMs + offsetMs).toISOString();
    }
  } catch (e) {
    console.error('Time conversion error:', e.message);
    // Fall back to raw string — better than crashing
    revealTimeUTC = revealTime;
  }

  const revealId = Math.random().toString(36).substring(2, 10) +
                   Math.random().toString(36).substring(2, 6);

  try {
    const store = getStore({
      name: 'draft-reveals',
      consistency: 'strong',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN
    });
    await store.set(`reveal-${revealId}`, JSON.stringify({
      shuffled,
      leagueName: leagueName || 'CommishHub Draft Lottery',
      revealTime: revealTimeUTC,
      speed: speed || 'default',
      createdAt: new Date().toISOString()
    }));
  } catch (err) {
    console.error('Blob store error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to store reveal data', detail: err.message }) };
  }

  // Also save email to email-signups store for future outreach
  // This runs independently — if it fails, the reveal still works
  try {
    const emailStore = getStore({
      name: 'email-signups',
      consistency: 'strong',
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_TOKEN
    });
    const emailKey = `email-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    await emailStore.set(emailKey, JSON.stringify({
      email:     email.trim().toLowerCase(),
      source:    'draft-reveal-schedule',
      metadata:  { leagueName: leagueName || null, revealId },
      createdAt: new Date().toISOString()
    }));
    console.log(`Email saved for future outreach: ${email}`);
  } catch (err) {
    // Non-fatal — log but continue
    console.error('Email save error (non-fatal):', err.message);
  }

  const revealUrl    = `https://commishhub.com/draft-order-randomizer/reveal/?id=${revealId}`;
  const displayName  = leagueName || 'CommishHub Draft Lottery';

  let revealDisplay = revealTime;
  try {
    revealDisplay = new Date(revealTime).toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });
  } catch (e) {}

  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    await resend.emails.send({
      from: 'CommishHub <noreply@commishhub.com>',
      to: email,
      subject: `Your ${displayName} Draft Order Reveal is Scheduled`,
      html: `
        <div style="background:#0A0705;color:#FAF7F0;font-family:sans-serif;padding:48px 40px;max-width:600px;margin:0 auto;border-radius:8px;">
          <h1 style="color:#F0D080;font-family:Georgia,serif;font-size:28px;margin:0 0 8px;">The pick is in.</h1>
          <p style="color:rgba(250,247,240,0.7);margin:0 0 28px;font-size:15px;">Your draft order is locked and sealed. Share this link with your league when you're ready to reveal.</p>
          <a href="${revealUrl}" style="display:inline-block;background:#8B6914;color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;margin-bottom:28px;">Open the Reveal Page →</a>
          <div style="border-top:1px solid rgba(139,105,20,0.3);padding-top:20px;margin-top:8px;">
            <p style="color:rgba(250,247,240,0.4);font-size:13px;margin:4px 0;">League: ${displayName}</p>
            <p style="color:rgba(250,247,240,0.4);font-size:13px;margin:4px 0;">Reveal time: ${revealDisplay}</p>
            <p style="color:rgba(250,247,240,0.4);font-size:13px;margin:16px 0 0;">— <a href="https://commishhub.com" style="color:rgba(139,105,20,0.8);text-decoration:none;">CommishHub</a></p>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('Resend error:', err.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revealId, revealUrl, emailSent: false, warning: 'Reveal saved but email failed' })
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revealId, revealUrl, emailSent: true })
  };
};
