import { supabase } from './supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';

// Constants
const TYPING_DEBOUNCE_TIME = 1000; // 1 second
const TYPING_EXPIRY_TIME = 5000; // 5 seconds

// Types
export type TypingStatus = {
  user_id: string;
  chat_id: string;
  started_at: string;
  updated_at: string;
  profiles?: {
    username: string;
  } | null;
};

// State management
let typingDebounce: NodeJS.Timeout | null = null;
let typingChannel: RealtimeChannel | null = null;

// Set typing status
export const setTypingStatus = async (userId: string, chatId: string) => {
  if (!userId || !chatId) return { error: 'Missing user or chat ID' };
  
  // Debounce typing updates to avoid excessive database calls
  if (typingDebounce) clearTimeout(typingDebounce);
  
  typingDebounce = setTimeout(async () => {
    console.log('[Typing] Setting typing status for user', userId, 'in chat', chatId);
    // Update or insert typing status
    const now = new Date().toISOString();
    
    const { error } = await supabase
      .from('typing_status')
      .upsert({
        user_id: userId,
        chat_id: chatId,
        started_at: now,
        updated_at: now
      });
      
    if (error) {
      console.error('[Typing] Error setting typing status:', error);
      return { error };
    }
      
    // Schedule removal of typing status after expiry
    setTimeout(async () => {
      await removeTypingStatus(userId, chatId);
    }, TYPING_EXPIRY_TIME);
  }, TYPING_DEBOUNCE_TIME);
  
  return { error: null };
};

// Remove typing status
export const removeTypingStatus = async (userId: string, chatId: string) => {
  if (!userId || !chatId) return { error: 'Missing user or chat ID' };
  
  if (typingDebounce) clearTimeout(typingDebounce);
  
  console.log('[Typing] Removing typing status for user', userId, 'in chat', chatId);
  
  const { error } = await supabase
    .from('typing_status')
    .delete()
    .match({ user_id: userId, chat_id: chatId });
    
  return { error };
};

// Get users currently typing in a chat
export const getTypingUsers = async (chatId: string, currentUserId: string) => {
  if (!chatId) return { data: null, error: 'No chat ID provided' };
  
  const { data, error } = await supabase
    .from('typing_status')
    .select('user_id, chat_id, started_at, updated_at, profiles(username)')
    .eq('chat_id', chatId)
    .neq('user_id', currentUserId) // Don't show current user as typing
    .gte('updated_at', new Date(Date.now() - TYPING_EXPIRY_TIME).toISOString());
    
  return { data, error };
};

// Subscribe to typing status changes for a chat
export const subscribeToTypingStatus = (
  chatId: string, 
  currentUserId: string,
  callback: (data: any[]) => void
) => {
  if (!chatId) return null;
  
  console.log('[Typing] Setting up typing subscription for chat:', chatId);
  
  const channel = supabase
    .channel(`typing:${chatId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'typing_status',
      filter: `chat_id=eq.${chatId}`
    }, (payload) => {
      console.log('[Typing] Typing status change detected:', payload);
      // Fetch all typing users when status changes
      getTypingUsers(chatId, currentUserId).then(({ data, error }) => {
        if (error) {
          console.error('[Typing] Error fetching typing users:', error);
          return;
        }
        if (data) callback(data);
      });
    })
    .subscribe();
    
  typingChannel = channel;
  return channel;
};

// Clean up typing status and subscription
export const cleanupTyping = (userId: string, chatId: string) => {
  console.log('[Typing] Cleaning up typing status and subscription');
  
  if (typingDebounce) clearTimeout(typingDebounce);
  if (typingChannel) typingChannel.unsubscribe();
  
  // Remove typing status when cleaning up
  removeTypingStatus(userId, chatId);
}; 