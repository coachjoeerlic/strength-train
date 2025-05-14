// load-test-debug-chat-join-only.js
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, group, fail } from 'k6';

// --- Configuration - Set these via environment variables ---
const BASE_URL = __ENV.BASE_URL || 'https://ephemeral-rolypoly-106984.netlify.app';
const SUPABASE_URL_WS_BASE = __ENV.SUPABASE_URL_WS || 'wss://wbrlglamhecvkcbifzls.supabase.co';
const SUPABASE_URL_HTTP = __ENV.SUPABASE_URL_HTTP || 'https://wbrlglamhecvkcbifzls.supabase.co';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicmxnbGFtaGVjdmtjYmlmemxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwMTQ5NDMsImV4cCI6MjA2MjU5MDk0M30.YhAybiPgDQa9qPelxiK1dG2Jc3UVzEpeu7SNntVERRY';

const TEST_USER_EMAIL = __ENV.TEST_USER_EMAIL || 'info@vezba.ca';
const TEST_USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'Lock96xts@';
const TARGET_CHAT_ID = __ENV.TARGET_CHAT_ID || '14502958-08e6-4840-a03f-4815d19db023';

const SUPABASE_WS_URL = `${SUPABASE_URL_WS_BASE}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=2.0.0`;

// --- k6 Options ---
export const options = {
  stages: [
    { duration: '30s', target: 1 }, // 1 VU for 30 seconds
  ],
  thresholds: {
    ws_sessions: ['count>0'], // Ensure at least one WS session attempts to start
  },
};

// --- Setup Function (runs once) ---
export function setup() {
  console.log(`DEBUG: Starting test against: ${BASE_URL}`);
  console.log(`DEBUG: Supabase WS URL: ${SUPABASE_WS_URL}`);
  console.log(`DEBUG: Target Chat ID: ${TARGET_CHAT_ID}`);

  let authToken = null;
  let userId = null;

  const loginPayload = JSON.stringify({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
  const loginParams = { headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY } };
  
  console.log(`DEBUG Setup: Attempting login for ${TEST_USER_EMAIL}...`);
  const loginRes = http.post(`${SUPABASE_URL_HTTP}/auth/v1/token?grant_type=password`, loginPayload, loginParams);

  if (loginRes.status === 200 && loginRes.json() && loginRes.json('access_token')) {
    authToken = loginRes.json('access_token');
    userId = loginRes.json('user.id');
    console.log(`DEBUG Setup: Login Succeeded. User ID: ${userId}. Auth token obtained.`);
  } else {
    console.error(`DEBUG Setup: Login Failed! Status: ${loginRes.status}, Body: ${loginRes.body ? loginRes.body.substring(0,200) : '(no body)'}`);
    fail(`DEBUG Setup failed: Unable to login test user ${TEST_USER_EMAIL}.`);
  }
  return { authToken, userId, targetChatId: TARGET_CHAT_ID };
}

// --- Main VU Function ---
export default function (data) {
  if (!data || !data.authToken || !data.userId || !data.targetChatId) {
    console.error(`DEBUG VU ${__VU} iter ${__ITER}: Missing data from setup. Skipping.`);
    return;
  }
  const userJWT = data.authToken;
  const currentChatId = data.targetChatId;
  let wsSessionRefCounter = 0;
  const makeRef = () => `${++wsSessionRefCounter}`;

  const res = ws.connect(SUPABASE_WS_URL, null, function (socket) {
    wsSessionRefCounter = 0;

    socket.on('open', () => {
      console.log(`DEBUG VU ${__VU} iter ${__ITER}: WebSocket connected.`);
      
      // 1. Join a VERY simple, non-database related channel name
      const simpleTopic = `private-vu-channel:${__VU}-${__ITER}`; // Unique per VU iteration, no schema implications
      const joinSimplePayload = {
        topic: simpleTopic,
        event: "phx_join",
        payload: { 
          access_token: userJWT // Just authenticate this basic channel join
        },
        ref: makeRef(),
      };
      socket.send(JSON.stringify(joinSimplePayload));
      console.log(`DEBUG VU ${__VU} iter ${__ITER}: Sent phx_join for SIMPLE TOPIC ${simpleTopic} with ref ${joinSimplePayload.ref}`);
      
      // Heartbeat
      socket.setInterval(() => {
        socket.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: makeRef() }));
      }, 20000);

      // Keep connection open
      socket.setTimeout(function () {
        console.log(`DEBUG VU ${__VU} iter ${__ITER}: Test duration for SIMPLE TOPIC ended. Closing WebSocket.`);
        socket.close();
      }, 25000); 
    });

    socket.on('message', (message) => {
      try {
        const parsed = JSON.parse(message);
        if (parsed.event === "phx_reply" && parsed.payload && parsed.payload.status === "ok") {
          console.log(`DEBUG VU ${__VU} iter ${__ITER}: Received OK phx_reply for ref ${parsed.ref} on topic ${parsed.topic}`);
        } else {
          // console.log(`DEBUG VU ${__VU} iter ${__ITER}: Received WS message: ${message.substring(0,100)}`);
        }
      } catch(e) {
        // console.warn(`DEBUG VU ${__VU} iter ${__ITER}: Non-JSON WS message: ${message.substring(0,100)}`);
      }
    });

    socket.on('close', (code) => { console.log(`DEBUG VU ${__VU} iter ${__ITER}: WebSocket disconnected with code ${code}.`); });
    socket.on('error', (e) => {
      if (e.error && e.error().toString() !== 'websocket: close sent') {
        console.error(`DEBUG VU ${__VU} iter ${__ITER}: WS error: ${e.error()}`);
      } else if (!e.error) {
        console.error(`DEBUG VU ${__VU} iter ${__ITER}: WS error (unknown structure): ${e}`);
      }
    });
  });
  check(res, { 'WS connection request successful': (r) => r && r.status === 101 }) || fail(`VU ${__VU} iter ${__ITER} WS connection failed! Status: ${res ? res.status : 'undefined'}`);
  sleep(1); // VU waits a bit before (potentially) another iteration if duration allows
}

export function teardown(data) {
  console.log('DEBUG Test finished.');
}