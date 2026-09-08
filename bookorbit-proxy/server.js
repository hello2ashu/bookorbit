const express = require('express');
const app = express();

const BOOKORBIT_URL = https://bookorbit.ashish-syn-nas.synology.me;           // e.g. https://bookorbit.ashish-syn-nas.synology.me
const USERNAME = hello2ashu;
const PASSWORD = Ashgoe@2101;
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

// Log in immediately on startup so the first dashboard load isn't slow,
// then keep the token fresh on a timer in the background.
login().catch((err) => console.error('Initial login failed:', err.message));
setInterval(() => {
  login().catch((err) => console.error('Scheduled token refresh failed:', err.message));
}, REFRESH_INTERVAL_MS);

app.listen(PORT, () => console.log(`bookorbit-proxy listening on :${PORT}`));
