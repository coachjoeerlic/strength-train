-- Temporarily disable RLS
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants DISABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can create their own profile" ON public.profiles;

DROP POLICY IF EXISTS "Users can view all chats" ON public.chats;
DROP POLICY IF EXISTS "Users can view their chats" ON public.chats;
DROP POLICY IF EXISTS "Users can create chats" ON public.chats;
DROP POLICY IF EXISTS "Users can update their own chats" ON public.chats;

DROP POLICY IF EXISTS "Users can view messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages to their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;

DROP POLICY IF EXISTS "Users can view their chat participants" ON public.chat_participants;
DROP POLICY IF EXISTS "Users can view chat participants" ON public.chat_participants;
DROP POLICY IF EXISTS "Users can view other participants in their chats" ON public.chat_participants;
DROP POLICY IF EXISTS "Users can join chats" ON public.chat_participants;
DROP POLICY IF EXISTS "Users can leave chats" ON public.chat_participants;

-- Re-enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;

-- Create clean, non-conflicting policies
-- Profiles
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id);

CREATE POLICY "Users can create their own profile"
ON public.profiles
FOR INSERT
WITH CHECK (auth.uid() = id);

-- Chats
CREATE POLICY "Users can view all chats"
ON public.chats
FOR SELECT
USING (true);

CREATE POLICY "Users can create chats"
ON public.chats
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can update their own chats"
ON public.chats
FOR UPDATE
USING (
  id IN (
    SELECT chat_id 
    FROM public.chat_participants 
    WHERE user_id = auth.uid()
  )
);

-- Messages
CREATE POLICY "Users can view messages in their chats"
ON public.messages
FOR SELECT
USING (
  chat_id IN (
    SELECT chat_id 
    FROM public.chat_participants 
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can send messages to their chats"
ON public.messages
FOR INSERT
WITH CHECK (
  chat_id IN (
    SELECT chat_id 
    FROM public.chat_participants 
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update their own messages"
ON public.messages
FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own messages"
ON public.messages
FOR DELETE
USING (user_id = auth.uid());

-- Chat Participants
CREATE POLICY "Users can view their chat participants"
ON public.chat_participants
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can join chats"
ON public.chat_participants
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can leave chats"
ON public.chat_participants
FOR DELETE
USING (user_id = auth.uid()); 