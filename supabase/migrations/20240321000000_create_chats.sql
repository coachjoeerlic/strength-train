-- Drop existing policies if they exist
drop policy if exists "Users can view their chats" on chats;
drop policy if exists "Users can create chats" on chats;
drop policy if exists "Users can view messages in their chats" on messages;
drop policy if exists "Users can send messages in their chats" on messages;
drop policy if exists "Users can update their messages" on messages;
drop policy if exists "Users can delete their messages" on messages;
drop policy if exists "Users can join chats" on chat_participants;
drop policy if exists "Users can view chat participants" on chat_participants;
drop policy if exists "Users can leave chats" on chat_participants;
drop policy if exists "Users can update their profile" on profiles;
drop policy if exists "Users can view profiles" on profiles;

-- Drop existing triggers if they exist
drop trigger if exists handle_updated_at on chats;
drop trigger if exists handle_updated_at on messages;

-- Drop existing functions if they exist
drop function if exists public.handle_updated_at() cascade;

-- Create chats table
create table if not exists public.chats (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_message_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create chat_participants table
create table if not exists public.chat_participants (
  chat_id uuid references public.chats on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (chat_id, user_id)
);

-- Create messages table
create table if not exists public.messages (
  id uuid default gen_random_uuid() primary key,
  chat_id uuid references public.chats on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  content text not null,
  is_read boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create indexes
create index if not exists idx_chat_participants_user_id on public.chat_participants(user_id);
create index if not exists idx_messages_chat_id on public.messages(chat_id);
create index if not exists idx_messages_user_id on public.messages(user_id);
create index if not exists idx_messages_created_at on public.messages(created_at);
create index if not exists idx_chats_last_message_at on public.chats(last_message_at);

-- Enable Row Level Security
alter table public.chats enable row level security;
alter table public.chat_participants enable row level security;
alter table public.messages enable row level security;

-- Create function to handle updated_at
create or replace function public.handle_updated_at()
returns trigger
security definer
set search_path = public
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Create function to update last_message_at
create or replace function public.handle_new_message()
returns trigger
security definer
set search_path = public
language plpgsql as $$
begin
  update public.chats
  set last_message_at = new.created_at
  where id = new.chat_id;
  return new;
end;
$$;

-- Create triggers for updated_at
create trigger handle_updated_at
  before update on public.chats
  for each row
  execute procedure public.handle_updated_at();

create trigger handle_updated_at
  before update on public.messages
  for each row
  execute procedure public.handle_updated_at();

-- Create trigger for new messages
create trigger on_new_message
  after insert on public.messages
  for each row
  execute procedure public.handle_new_message();

-- Create new policies with fixed logic
-- Chats policies
create policy "Users can view their chats"
  on chats for select
  using (
    exists (
      select 1 from chat_participants cp
      where cp.chat_id = chats.id
      and cp.user_id = auth.uid()
    )
  );

create policy "Users can create chats"
  on chats for insert
  with check (true);

-- Messages policies
create policy "Users can view messages in their chats"
  on messages for select
  using (
    exists (
      select 1 from chat_participants cp
      where cp.chat_id = messages.chat_id
      and cp.user_id = auth.uid()
    )
  );

create policy "Users can send messages in their chats"
  on messages for insert
  with check (
    exists (
      select 1 from chat_participants cp
      where cp.chat_id = messages.chat_id
      and cp.user_id = auth.uid()
    )
  );

create policy "Users can update their own messages"
  on messages for update
  using (
    user_id = auth.uid()
  );

create policy "Users can delete their own messages"
  on messages for delete
  using (
    user_id = auth.uid()
  );

-- Chat participants policies
create policy "Users can view chat participants"
  on chat_participants for select
  using (
    user_id = auth.uid() OR
    exists (
      select 1 from chat_participants cp
      where cp.chat_id = chat_participants.chat_id
      and cp.user_id = auth.uid()
    )
  );

create policy "Users can join chats"
  on chat_participants for insert
  with check (true);

create policy "Users can leave chats"
  on chat_participants for delete
  using (
    user_id = auth.uid()
  );

-- Profile policies
create policy "Users can view profiles"
  on profiles for select
  using (true);

create policy "Users can update their own profile"
  on profiles for update
  using (
    id = auth.uid()
  );

-- Remove the restrictive policy
drop policy if exists "Users can only view their own profile" on profiles; 