const express = require('express');

const app = express();

const PORT = process.env.PORT || 4321;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Required environment variables.
// These should be injected by Dockhand / Bitwarden Secrets Manager.
const requiredEnvVars = [
  'BOOKORBIT_URL',
  'BOOKORBIT_USERNAME',
  'BOOKORBIT_PASSWORD',
];

for (const name of requiredEnvVars) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

let cachedToken = null;
let loginInProgress = null;

/**
 * Authenticate with BookOrbit and cache the access token.
 */
async function login() {
  // Prevent multiple simultaneous login requests.
  if (loginInProgress) {
    return loginInProgress;
  }

  loginInProgress = (async () => {
    const res = await fetch(
      `${process.env.BOOKORBIT_URL}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: process.env.BOOKORBIT_USERNAME,
          password: process.env.BOOKORBIT_PASSWORD,
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Login failed: ${res.status} ${body}`);
    }

    const data = await res.json();

    if (!data.accessToken) {
      throw new Error('Login succeeded but no accessToken was returned');
    }

    cachedToken = data.accessToken;

    console.log(
      `[${new Date().toISOString()}] BookOrbit login refreshed.`
    );
  })();

  try {
    await loginInProgress;
  } finally {
    loginInProgress = null;
  }
}

/**
 * Fetch BookOrbit user statistics.
 */
async function fetchStats() {
  if (!cachedToken) {
    await login();
  }

  const doFetch = () =>
    fetch(
      `${process.env.BOOKORBIT_URL}/api/v1/user-statistics/summary`,
      {
        headers: {
          Authorization: `Bearer ${cachedToken}`,
        },
      }
    );

  let res = await doFetch();

  // Token may expire early because of clock skew,
  // revocation, or other server-side conditions.
  if (res.status === 401) {
    console.log(
      `[${new Date().toISOString()}] Token rejected; refreshing login.`
    );

    cachedToken = null;
    await login();

    res = await doFetch();
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stats fetch failed: ${res.status} ${body}`);
  }

  return res.json();
}

/**
 * Statistics endpoint.
 */
app.get('/stats', async (req, res) => {
  try {
    const stats = await fetchStats();
    res.json(stats);
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] ${err.message}`
    );

    res.status(502).json({
      error: err.message,
    });
  }
});

/**
 * Health check.
 */
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

/**
 * Initial login.
 *
 * This makes the first /stats request faster.
 * If login fails, the service remains running and
 * the scheduled refresh / subsequent request can retry.
 */
login().catch((err) => {
  console.error(
    `[${new Date().toISOString()}] Initial login failed: ${err.message}`
  );
});

/**
 * Refresh the BookOrbit token every 10 minutes.
 */
setInterval(() => {
  login().catch((err) => {
    console.error(
      `[${new Date().toISOString()}] Scheduled token refresh failed: ${err.message}`
    );
  });
}, REFRESH_INTERVAL_MS);

/**
 * Start HTTP server.
 */
app.listen(PORT, () => {
  console.log(`bookorbit-proxy listening on :${PORT}`);
});
