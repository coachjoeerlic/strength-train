// load-test.js
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, group, fail } from 'k6';
import { Trend } from 'k6/metrics';

// --- Configuration - Set these via environment variables ---
const BASE_URL = __ENV.BASE_URL || 'https://ephemeral-rolypoly-106984.netlify.app';
const SUPABASE_URL_WS_BASE = __ENV.SUPABASE_URL_WS || 'wss://wbrlglamhecvkcbifzls.supabase.co';
const SUPABASE_URL_HTTP = __ENV.SUPABASE_URL_HTTP || 'https://wbrlglamhecvkcbifzls.supabase.co';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicmxnbGFtaGVjdmtjYmlmemxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwMTQ5NDMsImV4cCI6MjA2MjU5MDk0M30.YhAybiPgDQa9qPelxiK1dG2Jc3UVzEpeu7SNntVERRY';

const TEST_USER_EMAIL = __ENV.TEST_USER_EMAIL || 'info@vezba.ca';
const TEST_USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'Lock96xts@';
const TARGET_CHAT_ID = __ENV.TARGET_CHAT_ID || '14502958-08e6-4840-a03f-4815d19db023';

const SUPABASE_WS_URL = `${SUPABASE_URL_WS_BASE}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=2.0.0`;

// --- Custom Metrics ---
// const wsConnectDuration = new Trend('ws_connect_duration', true); // Commented out due to NaN issues, k6 has built-in ws_connecting
const chatChannelJoinAckDuration = new Trend('chat_channel_join_ack_duration', true); // Time to get phx_reply for chat join
const presenceChannelJoinAckDuration = new Trend('presence_channel_join_ack_duration', true); // Time to get phx_reply for presence join
const typingChannelJoinAckDuration = new Trend('typing_channel_join_ack_duration', true);
const messageSendApiDuration = new Trend('message_send_api_duration', true);
const apiChatDetailsDuration = new Trend('api_chat_details_duration', true);
const apiPaginateMessagesDuration = new Trend('api_paginate_messages_duration', true);
const apiUserProfileDuration = new Trend('api_user_profile_duration', true);

// --- k6 Options ---
export const options = {
  stages: [
    { duration: '30s', target: 1 }, // Start with 1 VU for easier debugging
    { duration: '1m', target: 1 },
    // { duration: '30s', target: 5 }, 
    // { duration: '1m', target: 5 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    ws_connecting: ['p(95)<3000'],
    ws_sessions: ['count>0'], // Ensure WebSocket sessions were actually started
    'message_send_api_duration{expected_response:true}': ['p(95)<1000'], // Check if messages are actually sent
  },
};

// --- Setup Function (runs once) ---
export function setup() {
  console.log(`Load Testing Environment:`);
  console.log(`-------------------------`);
  console.log(`BASE_URL (Netlify): ${BASE_URL}`);
  console.log(`SUPABASE_URL_HTTP: ${SUPABASE_URL_HTTP}`);
  console.log(`SUPABASE_WS_URL (for k6 script): ${SUPABASE_WS_URL}`);
  console.log(`TARGET_CHAT_ID: ${TARGET_CHAT_ID}`);
  console.log(`TEST_USER_EMAIL: ${TEST_USER_EMAIL}`);
  console.log(`-------------------------`);

  let authToken = null;
  let userId = null;

  const loginPayload = JSON.stringify({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
  });
  const loginParams = {
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
  };

  console.log(`Setup: Attempting login for ${TEST_USER_EMAIL}...`);
  const loginRes = http.post(`${SUPABASE_URL_HTTP}/auth/v1/token?grant_type=password`, loginPayload, loginParams);

  if (loginRes.status === 200 && loginRes.json() && loginRes.json('access_token')) {
    authToken = loginRes.json('access_token');
    userId = loginRes.json('user.id');
    console.log(`Setup: Login Succeeded. User ID: ${userId}. Auth token obtained.`);
  } else {
    const errorBody = loginRes.body ? loginRes.body.substring(0, 500) : '(no body)'; // Limit error body length
    console.error(`Setup: Login Failed! Status: ${loginRes.status}, Body: ${errorBody}`);
    fail(`Setup failed: Unable to login test user ${TEST_USER_EMAIL}.`); // Fail test if critical setup fails
  }
  
  // Verify TARGET_CHAT_ID
  const chatCheckHeaders = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${authToken}`,
  };
  const chatCheckUrl = `${SUPABASE_URL_HTTP}/rest/v1/chats?id=eq.${TARGET_CHAT_ID}&select=id`;
  const chatCheckRes = http.get(chatCheckUrl, { headers: chatCheckHeaders });
  if (chatCheckRes.status !== 200 || !chatCheckRes.json() || (Array.isArray(chatCheckRes.json()) && chatCheckRes.json().length === 0) ) {
      const errorBody = chatCheckRes.body ? chatCheckRes.body.substring(0,500) : '(no body)';
      console.error(`Setup: Target chat ID ${TARGET_CHAT_ID} not found or not accessible. Status: ${chatCheckRes.status}, Body: ${errorBody}`);
      fail(`Setup failed: Target chat ID ${TARGET_CHAT_ID} invalid or not found.`);
  } else {
    console.log(`Setup: Target chat ID ${TARGET_CHAT_ID} verified.`);
  }

  return { authToken, userId, targetChatId: TARGET_CHAT_ID };
}

// --- Main VU Function ---
export default function (data) {
  if (!data || !data.authToken || !data.userId || !data.targetChatId) {
    console.error(`VU ${__VU} iter ${__ITER}: Missing critical data from setup. Skipping VU execution.`);
    return;
  }
  const userJWT = data.authToken;
  const currentUserId = data.userId;
  const currentChatId = data.targetChatId;
  let oldestMessageTimestamp = new Date().toISOString();
  let wsSessionRefCounter = 0;

  const makeRef = () => `${++wsSessionRefCounter}`;

  group('User Enters Chat Room and Interacts', function () {
    const wsParams = { tags: { k6_ws_session: `vu${__VU}-iter${__ITER}` } };
    const res = ws.connect(SUPABASE_WS_URL, wsParams, function (socket) {
      wsSessionRefCounter = 0; // Reset ref for this specific socket connection

      let chatJoinSentTime, presenceJoinSentTime, typingJoinSentTime;

      socket.on('open', () => {
        console.log(`VU ${__VU} iter ${__ITER}: WebSocket connected.`);
        
        // 1. Join Chat Channel (realtime:chat-messages:CHAT_ID)
        const chatMessagesTopic = `realtime:chat-messages:${currentChatId}`;
        const joinChatPayload = {
          topic: chatMessagesTopic, event: "phx_join",
          payload: { access_token: userJWT, config: { broadcast: { ack: true, self: false }, presence: { key: "" }, postgres_changes: [{ event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${currentChatId}` }] } },
          ref: makeRef(),
        };
        chatJoinSentTime = Date.now();
        socket.send(JSON.stringify(joinChatPayload));
        console.log(`VU ${__VU} iter ${__ITER}: Sent phx_join for ${chatMessagesTopic} with ref ${joinChatPayload.ref}`);
        sleep(0.3); // Small pause

        // 2. Join Presence Channel (realtime:presence_updates)
        const presenceUpdatesTopic = `realtime:presence_updates`;
        const joinPresencePayload = {
          topic: presenceUpdatesTopic, event: "phx_join",
          payload: { access_token: userJWT, config: { broadcast: { ack: true, self: false }, presence: { key: "" }}},
          ref: makeRef(),
        };
        presenceJoinSentTime = Date.now();
        socket.send(JSON.stringify(joinPresencePayload));
        console.log(`VU ${__VU} iter ${__ITER}: Sent phx_join for ${presenceUpdatesTopic} with ref ${joinPresencePayload.ref}`);
        sleep(0.3); // Small pause
        
        // 3. Heartbeat
        socket.setInterval(() => {
          socket.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: makeRef() }));
        }, 20000); // Reduced interval slightly

        // --- Simulate User Actions within the Chat ---
        group('Active Chatting', function() {
          for (let i = 0; i < 1; i++) { // Reduced message count for initial debugging
            const typingIndicatorTopic = `realtime:typing:${currentChatId}`;

            // 4a. Typing Indicator ON (Join typing channel)
            const joinTypingPayload = {
              topic: typingIndicatorTopic, event: "phx_join",
              payload: { access_token: userJWT, config: { broadcast: { ack: true, self: false }, presence: { key: "" }, postgres_changes: [{event: "*", schema: "public", table: "typing_status", filter: `chat_id=eq.${currentChatId}`}] } },
              ref: makeRef()
            };
            typingJoinSentTime = Date.now();
            socket.send(JSON.stringify(joinTypingPayload));
            // console.log(`VU ${__VU} iter ${__ITER}: Sent phx_join for ${typingIndicatorTopic} with ref ${joinTypingPayload.ref}`);
            sleep(Math.random() * 0.5 + 0.2);

            // 4b. Send a Text Message (via HTTP POST)
            const messageContent = `k6 VU ${__VU} iter ${__ITER}: Test msg ${i + 1} - ${Date.now()}`;
            const messagePostPayload = JSON.stringify({
              chat_id: currentChatId, user_id: currentUserId, content: messageContent,
            });
            const messagePostHeaders = {
              'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${userJWT}`, 'Prefer': 'return=representation',
            };
            const msgSendApiStartTime = Date.now();
            const postRes = http.post(`${SUPABASE_URL_HTTP}/rest/v1/messages`, messagePostPayload, { headers: messagePostHeaders, tags: { name: 'SendMessage' } });
            const msgSendDuration = Date.now() - msgSendApiStartTime;
            messageSendApiDuration.add(msgSendDuration, { expected_response: (postRes.status === 201) });
            check(postRes, { 'Message sent successfully': (r) => r.status === 201 }) || console.error(`MSG SEND FAIL VU ${__VU} iter ${__ITER}: ${postRes.status} ${postRes.body ? postRes.body.substring(0,100) : '(no body)'}`);
            
            if (postRes.status === 201 && postRes.json() && Array.isArray(postRes.json()) && postRes.json().length > 0) {
                 // oldestMessageTimestamp = postRes.json()[0].created_at; // Could use this for first pagination cursor
            }
            sleep(Math.random() * 1 + 0.5);

            // 4c. Typing Indicator OFF (Leave typing channel)
            const leaveTypingPayload = { topic: typingIndicatorTopic, event: "phx_leave", payload: {}, ref: makeRef() };
            socket.send(JSON.stringify(leaveTypingPayload));
            // console.log(`VU ${__VU} iter ${__ITER}: Sent phx_leave for ${typingIndicatorTopic} with ref ${leaveTypingPayload.ref}`);
          }
        });
        
        // ... (Pagination and Profile Load groups remain, with similar structure) ...
        // 6. Load Older Messages (Pagination)
        if (__ITER % 2 === 0) { // Increased frequency for testing
            group('Load Older Messages (Pagination)', function() {
                const paginateHeaders = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${userJWT}`};
                const simpleSelect = 'id,content,created_at,user_id,is_read'; // Keep select simple for test
                const paginationUrl = `${SUPABASE_URL_HTTP}/rest/v1/messages?select=${simpleSelect}&chat_id=eq.${currentChatId}&order=created_at.desc&limit=10&created_at=lt.${encodeURIComponent(oldestMessageTimestamp)}`;
                
                const paginateApiStartTime = Date.now();
                const paginateRes = http.get(paginationUrl, { headers: paginateHeaders, tags: { name: 'GetOlderMessages' } });
                apiPaginateMessagesDuration.add(Date.now() - paginateApiStartTime);

                if (check(paginateRes, { 'Paginated messages fetched': (r) => r.status === 200 })) {
                    const messages = paginateRes.json();
                    if (messages && Array.isArray(messages) && messages.length > 0) {
                        oldestMessageTimestamp = messages[messages.length - 1].created_at;
                    }
                }
            });
        }

        // 7. User Profile Load (Less Frequent)
        if (__ITER % 5 === 0) { // Increased frequency for testing
            group('Load User Profile API', function() {
                const profileUserIdToFetch = currentUserId;
                const profileHeaders = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${userJWT}`, 'Accept': 'application/vnd.pgrst.object+json' };
                const profileApiStartTime = Date.now();
                const profileRes = http.get(`${SUPABASE_URL_HTTP}/rest/v1/profiles?select=id,username,avatar_url,bio&id=eq.${profileUserIdToFetch}`, { headers: profileHeaders, tags: { name: 'GetUserProfile' } });
                apiUserProfileDuration.add(Date.now() - profileApiStartTime);
                check(profileRes, { 'User profile fetched': (r) => r.status === 200 });
            });
        }

        socket.setTimeout(function () {
          socket.close();
        }, (Math.random() * 10 + 5) * 1000); // Reduced active time for quicker test iterations: 5-15 seconds
      });

      socket.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            if (parsed.event === "phx_reply" && parsed.payload && parsed.payload.status === "ok") {
                if(joinChatPayload.ref === parsed.ref) chatChannelJoinAckDuration.add(Date.now() - chatJoinSentTime);
                if(joinPresencePayload.ref === parsed.ref) presenceChannelJoinAckDuration.add(Date.now() - presenceJoinSentTime);
                if(joinTypingPayload && joinTypingPayload.ref === parsed.ref) typingChannelJoinAckDuration.add(Date.now() - typingJoinSentTime);
            }
        } catch (e) {
            // console.warn(`VU ${__VU} iter ${__ITER}: Non-JSON WS message or parse error: ${message.substring(0,100)}`);
        }
      });
      socket.on('close', (code) => { /* console.log(`VU ${__VU} iter ${__ITER}: WebSocket disconnected with code ${code}.`); */ });
      socket.on('error', (e) => {
        if (e.error && e.error().toString() !== 'websocket: close sent') {
          console.error(`VU ${__VU} iter ${__ITER}: WS error: ${e.error()}`);
        } else if (!e.error) {
          console.error(`VU ${__VU} iter ${__ITER}: WS error (unknown structure): ${e}`);
        }
      });
    });
    check(res, { 'WS connection request successful': (r) => r && r.status === 101 }) || fail(`VU ${__VU} iter ${__ITER} WS connection failed! Status: ${res ? res.status : 'undefined'}`);
  });
  sleep(Math.random() * 1 + 0.5); // Stagger VU iterations
}

export function teardown(data) {
  console.log('Test finished.');
}