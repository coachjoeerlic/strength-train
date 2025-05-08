import { supabase } from './supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';

// Constants
const PRESENCE_HEARTBEAT_INTERVAL = 30000; // 30 seconds
const IDLE_TIMEOUT = 5 * 60000; // 5 minutes
const OFFLINE_TIMEOUT = 10 * 60000; // 10 minutes

// Types
export type PresenceStatus = 'online' | 'idle' | 'offline';
export type UserPresence = {
  user_id: string;
  status: PresenceStatus;
  last_seen: string;
  chat_id?: string;
  profiles?: {
    username: string;
  } | null;
};

// State management
let heartbeatInterval: NodeJS.Timeout | null = null;
let presenceChannel: RealtimeChannel | null = null;
let lastActivity = Date.now();
let currentChatId: string | null = null;

// Update last activity timestamp on user interaction
const updateLastActivity = () => {
  lastActivity = Date.now();
};

// Update presence in database
export const updatePresence = async (userId: string, chatId: string | null = null) => {
  if (!userId) return { error: 'No user ID provided' };
  
  const now = Date.now();
  const timeSinceActivity = now - lastActivity;
  
  // Determine status based on activity
  let status: PresenceStatus = 'online';
  if (timeSinceActivity > OFFLINE_TIMEOUT) {
    status = 'offline';
  } else if (timeSinceActivity > IDLE_TIMEOUT) {
    status = 'idle';
  }
  
  const { error } = await supabase.from('presence').upsert({
    user_id: userId,
    last_seen: new Date(now).toISOString(),
    status,
    chat_id: chatId,
    updated_at: new Date(now).toISOString()
  });
  
  return { status, error };
};

// Initialize presence tracking
export const initPresence = (userId: string) => {
  if (!userId) return () => {};
  
  console.log('[Presence] Initializing presence tracking for user:', userId);
  
  // Track user interactions
  const trackActivity = () => updateLastActivity();
  
  window.addEventListener('mousemove', trackActivity);
  window.addEventListener('keydown', trackActivity);
  window.addEventListener('click', trackActivity);
  window.addEventListener('touchstart', trackActivity);
  
  // Set initial presence
  updatePresence(userId);
  
  // Subscribe to presence channel
  presenceChannel = supabase.channel('presence_updates');
  presenceChannel.subscribe(status => {
    console.log('[Presence] Channel subscription status:', status);
  });
  
  // Set up heartbeat for presence updates
  heartbeatInterval = setInterval(() => {
    updatePresence(userId, currentChatId);
  }, PRESENCE_HEARTBEAT_INTERVAL);
  
  // Handle page unload to set offline status immediately
  window.addEventListener('beforeunload', async () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
    // Best effort to update status to offline before page unloads
    try {
      await supabase.from('presence').update({
        status: 'offline',
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('user_id', userId);
    } catch (error) {
      console.error('[Presence] Error setting offline status:', error);
    }
  });
  
  // Return cleanup function
  return () => {
    console.log('[Presence] Cleaning up presence tracking');
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    presenceChannel?.unsubscribe();
    window.removeEventListener('mousemove', trackActivity);
    window.removeEventListener('keydown', trackActivity);
    window.removeEventListener('click', trackActivity);
    window.removeEventListener('touchstart', trackActivity);
    
    // Best effort to update status to offline on cleanup
    supabase.from('presence').update({
      status: 'offline',
      last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('user_id', userId);
  };
};

// Set current chat context
export const setActiveChat = (chatId: string | null) => {
  console.log('[Presence] Setting active chat:', chatId);
  currentChatId = chatId;
};

// Get online users for a specific chat
export const getOnlineUsersForChat = async (chatId: string) => {
  const { data, error } = await supabase
    .from('presence')
    .select('user_id, status, last_seen, profiles(username)')
    .eq('chat_id', chatId)
    .not('status', 'eq', 'offline')
    .order('last_seen', { ascending: false });
    
  return { data, error };
};

// Get all online users (system-wide)
export const getAllOnlineUsers = async () => {
  const { data, error } = await supabase
    .from('presence')
    .select('user_id, status, last_seen')
    .not('status', 'eq', 'offline')
    .order('last_seen', { ascending: false });
  
  return { data, error };
};

// Subscribe to presence changes for a chat
export const subscribeToPresence = (chatId: string, callback: (data: any[]) => void) => {
  const channel = supabase
    .channel(`presence:${chatId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'presence',
      filter: `chat_id=eq.${chatId}`
    }, (payload) => {
      console.log('[Presence] Presence change detected:', payload);
      // Fetch all online users when presence changes
      getOnlineUsersForChat(chatId).then(({ data, error }) => {
        if (error) {
          console.error('[Presence] Error fetching online users:', error);
          return;
        }
        if (data) callback(data);
      });
    })
    .subscribe();
    
  return channel;
}; 