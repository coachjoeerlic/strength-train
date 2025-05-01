import { supabase } from './supabaseClient';

export const trackPresence = async (userId: string) => {
  const { error } = await supabase
    .from('presence')
    .upsert({ user_id: userId, last_seen: new Date().toISOString() });
  return { error };
};

export const getOnlineUsers = async () => {
  const { data, error } = await supabase
    .from('presence')
    .select('*')
    .gte('last_seen', new Date(Date.now() - 30000).toISOString());
  return { data, error };
}; 