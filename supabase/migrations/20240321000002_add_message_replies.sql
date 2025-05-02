-- Drop existing foreign key if it exists
ALTER TABLE messages
DROP CONSTRAINT IF EXISTS messages_reply_to_message_id_fkey;

-- Add reply_to_message_id column to messages table with proper foreign key constraint
ALTER TABLE messages
ADD COLUMN reply_to_message_id UUID,
ADD CONSTRAINT messages_reply_to_message_id_fkey 
FOREIGN KEY (reply_to_message_id) 
REFERENCES messages(id) 
ON DELETE SET NULL;

-- Create index for faster reply lookups
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id);

-- Update RLS policies to allow viewing replied messages
CREATE POLICY "Users can view replied messages"
ON messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM chat_participants cp
    WHERE cp.chat_id = messages.chat_id
    AND cp.user_id = auth.uid()
  )
); 