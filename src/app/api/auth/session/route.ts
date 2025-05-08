import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    console.log('[API /auth/session] Received session sync request');
    const { session } = await req.json();
    
    if (!session || !session.access_token || !session.refresh_token) {
      console.error('[API /auth/session] Invalid session data received');
      return NextResponse.json({ error: 'Invalid session data' }, { status: 400 });
    }

    const supabase = createRouteHandlerClient({ cookies });

    // Set the cookies for server-side auth
    await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    });

    console.log('[API /auth/session] Session synchronized successfully, user:', session.user?.id);
    
    return NextResponse.json({ 
      message: 'Session synchronized successfully',
      userId: session.user?.id 
    });
  } catch (error: any) {
    console.error('[API /auth/session] Error processing session:', error);
    return NextResponse.json(
      { error: 'Failed to synchronize session', details: error.message },
      { status: 500 }
    );
  }
} 