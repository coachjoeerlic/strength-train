-- IMPORTANT: Run this SQL in your Supabase dashboard SQL editor to fix the infinite recursion issue
-- Copy all of this SQL and paste it into the SQL editor at https://app.supabase.com

-- Drop the existing policy that's causing infinite recursion
DROP POLICY IF EXISTS "Users can view chat participants" ON public.chat_participants;

-- Create a new, clearer policy that should work more reliably
-- This policy allows users to see all participants of chats they're members of
CREATE POLICY "Users can view chat participants" 
ON public.chat_participants 
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.chat_participants my_participation
    WHERE my_participation.chat_id = chat_participants.chat_id
    AND my_participation.user_id = auth.uid()
  )
);

-- Add a comment to explain the policy
COMMENT ON POLICY "Users can view chat participants" ON public.chat_participants IS 
'Allows users to see all participants in chats they are members of'; 