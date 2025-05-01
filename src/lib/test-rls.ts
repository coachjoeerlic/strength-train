import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function testRLSPolicies() {
  const log = (message: string, data?: any) => {
    console.log(message);
    if (data !== undefined) {
      console.log(JSON.stringify(data, null, 2));
    }
  };

  log('Testing RLS Policies...\n');

  // Get current user ID first
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    log('No authenticated user found');
    return;
  }
  const userId = user.id;
  log('Testing with user ID:', userId);

  // Test 1: Verify chat access
  log('\nTest 1: Verifying chat access...');
  try {
    // First check if there are any chats at all
    const { data: allChats, error: allChatsError } = await supabase
      .from('chats')
      .select('id, name')
      .limit(1);
    
    if (allChatsError) {
      log('Error checking if chats exist:', allChatsError);
    } else {
      log('Chats exist in database:', allChats && allChats.length > 0);
    }

    // Then check which chats the user is in
    const { data: userChats, error: userChatsError } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', userId);
    
    if (userChatsError) {
      log('Error checking user chats:', userChatsError);
    } else {
      log('User is in these chats:', userChats);
    }

    // Finally try to access all chats
    const { data: chats, error: chatsError } = await supabase
      .from('chats')
      .select('id, name, last_message_at');
    
    if (chatsError) {
      log('Error accessing chats:', chatsError);
    } else if (!chats || chats.length === 0) {
      log('No chats found');
    } else {
      log('Successfully accessed chats:', chats);
    }
  } catch (error) {
    log('Unexpected error in Test 1:', error);
  }

  // Test 2: Verify message access
  log('\nTest 2: Verifying message access...');
  try {
    // First check if there are any messages at all
    const { data: allMessages, error: allMessagesError } = await supabase
      .from('messages')
      .select('id')
      .limit(1);
    
    if (allMessagesError) {
      log('Error checking if messages exist:', allMessagesError);
    } else {
      log('Messages exist in database:', allMessages && allMessages.length > 0);
    }

    // Then try to access messages
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (messagesError) {
      log('Error accessing messages:', messagesError);
    } else if (!messages || messages.length === 0) {
      log('No messages found');
    } else {
      log('Successfully accessed messages:', messages);
    }
  } catch (error) {
    log('Unexpected error in Test 2:', error);
  }

  // Test 3: Verify profile access
  log('\nTest 3: Verifying profile access...');
  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (profileError) {
      log('Error accessing profile:', profileError);
    } else {
      log('Successfully accessed profile:', profile);
    }
  } catch (error) {
    log('Unexpected error in Test 3:', error);
  }

  // Test 4: Try to access another user's profile
  log('\nTest 4: Trying to access another user\'s profile...');
  try {
    const { data: otherProfile, error: otherProfileError } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', userId)
      .limit(1)
      .single();
    
    if (otherProfileError) {
      log('Expected error accessing other profile:', otherProfileError);
    } else {
      log('Unexpectedly accessed other profile:', otherProfile);
    }
  } catch (error) {
    log('Unexpected error in Test 4:', error);
  }

  // Test 5: Try to update another user's profile
  log('\nTest 5: Trying to update another user\'s profile...');
  try {
    const { data: updateData, error: updateError } = await supabase
      .from('profiles')
      .update({ username: 'hacked' })
      .neq('id', userId)
      .select()
      .single();
    
    if (updateError) {
      log('Expected error updating other profile:', updateError);
    } else {
      log('Unexpectedly updated other profile:', updateData);
    }
  } catch (error) {
    log('Unexpected error in Test 5:', error);
  }

  // Test 6: Try to send a message to a chat you're not in
  log('\nTest 6: Trying to send a message to a chat you\'re not in...');
  
  try {
    // Try to send the message directly
    const { error: messageError } = await supabase
      .from('messages')
      .insert({
        chat_id: '11111111-1111-1111-1111-111111111111',
        user_id: userId,
        content: 'Test message'
      });
    
    if (messageError) {
      log('Expected error sending message:', messageError);
    } else {
      log('Unexpectedly sent message to chat not in');
    }
  } catch (error) {
    log('Unexpected error in Test 6:', error);
  }
}

// Export the test function
export { testRLSPolicies }; 