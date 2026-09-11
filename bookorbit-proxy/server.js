const express = require('express');
const app = express();

const BOOKORBIT_URL = process.env.BOOKORBIT_URL;           // e.g. https://bookorbit.ashish-syn-nas.synology.me
const USERNAME = process.env.BOOKORBIT_USERNAME;
const PASSWORD = process.env.BOOKORBIT_PASSWORD;
const PORT = process.env.PORT || 4321;

// BookOrbit's access token lives for 15 minutes - refresh well before that
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

let cachedToken = null;

async function login() {
  const res = await fetch(`${BOOKORBIT_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  cachedToken = data.accessToken;
  console.log(`[${new Date().toISOString()}] BookOrbit login refreshed.`);
}

async function fetchStats() {
  if (!cachedToken) {
    await login();
  }

  const doFetch = () =>
    fetch(`${BOOKORBIT_URL}/api/v1/user-statistics/summary`, {
      headers: { Authorization: `Bearer ${cachedToken}` },
    });

  let res = await doFetch();

  // Token might have expired early (clock skew, early revoke, etc) - retry once with a fresh one
  if (res.status === 401) {
    await login();
    res = await doFetch();
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stats fetch failed: ${res.status} ${body}`);
  }

  return res.json();
}

app.get('/stats', async (req, res) => {
  try {
    const stats = await fetchStats();
    res.json(stats);
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.send('ok'));

const STARTUP_DELAY_MS = parseInt(process.env.STARTUP_DELAY_MS || '15000', 10); // give BookOrbit time to finish booting
const STARTUP_RETRY_DELAY_MS = 10000; // if BookOrbit still isn't ready, retry every 10s instead of logging an error
const STARTUP_MAX_ATTEMPTS = 6; // ~1 minute of retries total before giving up and just waiting for the scheduled loop

async function loginWithStartupRetry(attempt = 1) {
  try {
    await login();
  } catch (err) {
    if (attempt >= STARTUP_MAX_ATTEMPTS) {
      console.error(`Initial login failed after ${attempt} attempts:`, err.message);
      return;
    }
    console.log(`BookOrbit not ready yet (attempt ${attempt}/${STARTUP_MAX_ATTEMPTS}), retrying in ${STARTUP_RETRY_DELAY_MS / 1000}s...`);
    setTimeout(() => loginWithStartupRetry(attempt + 1), STARTUP_RETRY_DELAY_MS);
  }
}

// Wait a bit before the very first login attempt - if this container and
// BookOrbit's own container start at the same time, BookOrbit (and the
// reverse proxy in front of it) may not be ready yet, producing a noisy
// but harmless 502 on the very first try. Then keep the token fresh on a
// timer in the background as before.
setTimeout(() => loginWithStartupRetry(), STARTUP_DELAY_MS);
setInterval(() => {
  login().catch((err) => console.error('Scheduled token refresh failed:', err.message));
}, REFRESH_INTERVAL_MS);

app.listen(PORT, () => console.log(`bookorbit-proxy listening on :${PORT}`));