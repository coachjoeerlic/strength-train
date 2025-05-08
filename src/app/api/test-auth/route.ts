import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  console.log('[API /test-auth] Route hit.');
  const cookieStore = cookies();
  
  try {
    const supabase = createRouteHandlerClient({ cookies });

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('[API /test-auth] Error getting session:', sessionError);
      return NextResponse.json({ error: 'Supabase auth error', details: sessionError.message }, { status: 500 });
    }
    
    if (!session) {
      console.error('[API /test-auth] Auth session missing!');
      return NextResponse.json({ error: 'Supabase auth error', details: 'Auth session missing!' }, { status: 500 });
    }

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error) {
      console.error('[API /test-auth] Supabase auth error:', error);
      return NextResponse.json({ error: 'Supabase auth error', details: error.message }, { status: 500 });
    }

    if (user) {
      console.log('[API /test-auth] User found:', user.id);
      return NextResponse.json({ 
        message: 'User authenticated', 
        userId: user.id,
        sessionId: session.user.id 
      });
    } else {
      console.log('[API /test-auth] User not found (401).');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch (e: any) {
    console.error('[API /test-auth] Catch block error:', e);
    return NextResponse.json({ error: 'Internal server error', details: e.message }, { status: 500 });
  }
} 