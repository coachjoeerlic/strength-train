// load-test-MINIMAL-auth-join.js
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, fail } from 'k6';

// ... (Configuration and Setup function remain the same as the previous minimal script) ...
const SUPABASE_URL_WS_BASE = __ENV.SUPABASE_URL_WS || 'wss://wbrlglamhecvkcbifzls.supabase.co';
const SUPABASE_URL_HTTP = __ENV.SUPABASE_URL_HTTP || 'https://wbrlglamhecvkcbifzls.supabase.co';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY_HERE'; // Replace or use ENV
const TEST_USER_EMAIL = __ENV.TEST_USER_EMAIL || 'info@vezba.ca';
const TEST_USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'Lock96xts@';

const SUPABASE_WS_URL = `${SUPABASE_URL_WS_BASE}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=2.0.0`;

export const options = {
  vus: 1,
  duration: '20s', 
};

export function setup() {
  console.log(`DEBUG MINIMAL: Supabase WS URL: ${SUPABASE_WS_URL}`);
  let authToken = null;
  const loginPayload = JSON.stringify({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
  const loginParams = { headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY } };
  const loginRes = http.post(`${SUPABASE_URL_HTTP}/auth/v1/token?grant_type=password`, loginPayload, loginParams);

  if (loginRes.status === 200 && loginRes.json() && loginRes.json('access_token')) {
    authToken = loginRes.json('access_token');
    console.log(`DEBUG MINIMAL Setup: Login Succeeded. Token obtained.`);
  } else {
    console.error(`DEBUG MINIMAL Setup: Login Failed! Status: ${loginRes.status}, Body: ${loginRes.body ? loginRes.body.substring(0,200) : '(no body)'}`);
    fail(`DEBUG MINIMAL Setup failed: Unable to login test user.`);
  }
  return { authToken };
}


export default function (data) {
  if (!data || !data.authToken) {
    return;
  }
  const userJWT = data.authToken;
  let refCounter = 0;
  const makeRef = () => `${++refCounter}`;

  const res = ws.connect(SUPABASE_WS_URL, null, function (socket) {
    refCounter = 0;
    socket.on('open', () => {
      console.log(`DEBUG MINIMAL VU ${__VU} iter ${__ITER}: WebSocket connected.`);
      
      const minimalTopic = `minimal-test-channel-v2:${__VU}`; // Slightly new topic name for this test
      const joinPayload = {
        topic: minimalTopic,
        event: "phx_join",
        payload: { 
          // This is the main change: nesting access_token inside a config-like structure,
          // even if other configs are minimal/default.
          // The actual Supabase client might send an empty "config" or specific defaults.
          // We are testing if the presence of a "config" object, even if mostly empty, 
          // and having "access_token" at this level is what the server expects
          // for an authenticated channel that isn't yet specifying db changes or broadcasts.
          config: { 
            broadcast: { ack: false, self: false }, // Minimal standard broadcast config
            presence: { key: "" }                  // Minimal standard presence config
          },
          access_token: userJWT // User JWT for channel authentication
        },
        ref: makeRef(),
      };
      socket.send(JSON.stringify(joinPayload));
      console.log(`DEBUG MINIMAL VU ${__VU} iter ${__ITER}: Sent phx_join for ${minimalTopic} with ref ${joinPayload.ref} and structured payload.`);
      
      socket.setInterval(() => {
        socket.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: makeRef() }));
      }, 20000);

      socket.setTimeout(function () {
        console.log(`DEBUG MINIMAL VU ${__VU} iter ${__ITER}: Test duration ended. Closing WebSocket.`);
        socket.close();
      }, 15000); 
    });

    socket.on('message', (message) => {
      console.log(`DEBUG MINIMAL VU ${__VU} iter ${__ITER}: Received WS message: ${message.substring(0,150)}`);
    });
    socket.on('close', (code) => { console.log(`DEBUG MINIMAL VU ${__VU} iter ${__ITER}: WebSocket disconnected with code ${code}.`); });
    socket.on('error', (e) => {
      const errorMsg = e.error ? e.error().toString() : JSON.stringify(e);
      console.error(`DEBUG MINIMAL VU ${__VU} iter ${__ITER}: WS error: ${errorMsg}`);
    });
  });
  check(res, { 'WS connection request successful': (r) => r && r.status === 101 }) || fail(`VU ${__VU} iter ${__ITER} WS connection failed!`);
  sleep(1); 
}

export function teardown(data) {
  console.log('DEBUG Test finished.');
}