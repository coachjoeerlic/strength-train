import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  console.log(`[Middleware] Running for path: ${req.nextUrl.pathname}`);
  const res = NextResponse.next();

  try {
    const supabase = createMiddlewareClient({ req, res });
    console.log('[Middleware] Attempting to get session...');
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      console.error('[Middleware] Error getting session:', error);
    }

    if (session) {
      console.log('[Middleware] Session found:', session.user.id, 'Access token will be set in cookie.');
    } else {
      console.log('[Middleware] No session found by getSession().');
    }
  } catch (e) {
    console.error('[Middleware] Error in middleware try-catch:', e);
  }
  
  // Log cookies *before* returning the response to see what the auth helper *should* be setting
  // Note: This shows what's *intended* to be set on the outgoing response, not what's on the incoming request.
  console.log('[Middleware] Response headers to be sent (cookies):', res.headers.getSetCookie());

  return res;
}

// Add a matcher for API routes that need authentication
export const config = {
  matcher: [
    // Required for CORS preflight checks
    '/api/:path*',
    // Protected routes
    '/((?!_next/static|_next/image|favicon.ico).*)'
  ],
}; 