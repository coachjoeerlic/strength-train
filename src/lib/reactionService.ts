import { supabase } from '@/lib/supabaseClient';

/**
 * Adds an emoji reaction to a message for a specific user.
 * @param messageId The ID of the message to react to.
 * @param userId The ID of the user reacting.
 * @param emoji The emoji character.
 * @returns The result of the insert operation.
 */
export const addReaction = async (messageId: string, userId: string, emoji: string) => {
  if (!userId) {
    console.error('User ID is required to add a reaction');
    return { data: null, error: new Error('User ID is required') };
  }
  const { data, error } = await supabase
    .from('reactions')
    .insert([{ message_id: messageId, user_id: userId, emoji: emoji }])
    .select(); // .select() can be useful to get the inserted row back

  if (error) {
    console.error('Error adding reaction:', error);
  }
  return { data, error };
};

/**
 * Removes an emoji reaction from a message for a specific user.
 * @param messageId The ID of the message.
 * @param userId The ID of the user whose reaction is to be removed.
 * @param emoji The emoji character of the reaction to be removed.
 * @returns The result of the delete operation.
 */
export const removeReaction = async (messageId: string, userId: string, emoji: string) => {
  if (!userId) {
    console.error('User ID is required to remove a reaction');
    return { data: null, error: new Error('User ID is required') };
  }
  const { data, error } = await supabase
    .from('reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji);

  if (error) {
    console.error('Error removing reaction:', error);
  }
  return { data, error }; // For delete, data is usually null or an empty array on success
}; 