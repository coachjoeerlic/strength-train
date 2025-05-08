import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const chatId = url.searchParams.get('chatId');
    
    if (!chatId) {
      return NextResponse.json(
        { error: 'Chat ID is required' },
        { status: 400 }
      );
    }
    
    // Create a Supabase client with the user's session cookie
    const supabase = createRouteHandlerClient({ cookies });
    
    // Verify the user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // First, check if the user is a member of this chat (for extra security)
    const { data: membership, error: membershipError } = await supabase
      .from('chat_participants')
      .select('user_id')
      .eq('chat_id', chatId)
      .eq('user_id', user.id)
      .single();
    
    if (membershipError || !membership) {
      return NextResponse.json(
        { error: 'You are not a member of this chat' },
        { status: 403 }
      );
    }
    
    // Get all participants for this chat
    const { data: participants, error: participantsError } = await supabase
      .from('chat_participants')
      .select('user_id')
      .eq('chat_id', chatId);
    
    if (participantsError) {
      console.error('Error fetching participants:', participantsError);
      return NextResponse.json(
        { error: 'Failed to fetch chat participants' },
        { status: 500 }
      );
    }
    
    // Log the results to help with debugging
    console.log(`Found ${participants?.length || 0} participants for chat ${chatId}`);
    
    // Extract user IDs
    const userIds = participants?.map(p => p.user_id) || [];
    
    // If we have no user IDs, return an empty array
    if (userIds.length === 0) {
      return NextResponse.json({ members: [] });
    }
    
    // Fetch profiles for all participants
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, bio')
      .in('id', userIds);
    
    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      return NextResponse.json(
        { error: 'Failed to fetch member profiles' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ members: profiles || [] });
  } catch (error) {
    console.error('Error in chat-members route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 