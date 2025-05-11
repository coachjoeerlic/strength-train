'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import { initPresence } from './presenceService';
import { useToasts } from '@/contexts/ToastContext';

type AuthContextType = {
  user: User | null;
  loading: boolean;
  error: string | null;
};

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, error: null });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToasts();

  // Initialize presence tracking
  useEffect(() => {
    let presenceCleanup: (() => void) | undefined;
    
    if (user?.id) {
      console.log('[AuthContext] Initializing presence tracking for user:', user.id);
      presenceCleanup = initPresence(user.id);
    }
    
    return () => {
      if (presenceCleanup) {
        console.log('[AuthContext] Cleaning up presence tracking');
        presenceCleanup();
      }
    };
  }, [user?.id]);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('[AuthContext] Initial getSession error:', sessionError);
          setError('Failed to get initial session');
          setLoading(false);
          return;
        }
        
        console.log('[AuthContext] Initial session user:', initialSession?.user?.id);
        setUser(initialSession?.user ?? null);
        setLoading(false);

        // If we have an initial session, ensure server cookies are set
        if (initialSession?.user) {
          try {
            const res = await fetch('/api/auth/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ session: initialSession })
            });
            
            if (!res.ok) {
              console.error('[AuthContext] Failed to synchronize session with server:', await res.text());
            } else {
              console.log('[AuthContext] Session synchronized with server');
            }
          } catch (error) {
            console.error('[AuthContext] Error synchronizing session:', error);
          }
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event: string, session: Session | null) => {
            console.log('[AuthContext] Auth state changed:', event, 'User ID:', session?.user?.id);
            setUser(session?.user ?? null);
            setLoading(false);

            if (event === 'SIGNED_IN' && session) {
              console.log('[AuthContext] SIGNED_IN detected, syncing session with server');
              try {
                // Send the session to the server
                const res = await fetch('/api/auth/session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ session })
                });
                
                if (res.ok) {
                  console.log('[AuthContext] Session synchronized successfully');
                  
                  // Now test the auth with a separate call
                  const testRes = await fetch('/api/test-auth', { credentials: 'include' });
                  if (testRes.ok) {
                    const data = await testRes.json();
                    console.log('[AuthContext] /api/test-auth ping successful:', data);
                  } else {
                    console.error('[AuthContext] /api/test-auth ping failed:', testRes.status, await testRes.text());
                  }
                } else {
                  console.error('[AuthContext] Session sync failed:', res.status, await res.text());
                }
              } catch (error) {
                console.error('[AuthContext] Error during session sync:', error);
              }
            }
          }
        );

        return () => {
          console.log('[AuthContext] Unsubscribing from onAuthStateChange');
          subscription.unsubscribe();
        };
      } catch (err) {
        console.error('[AuthContext] Auth initialization error:', err);
        setError('Failed to initialize authentication');
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  // New useEffect for user-specific realtime events (like account_banned)
  useEffect(() => {
    if (user && supabase) {
      const userStatusChannelName = `user-status:${user.id}`;
      console.log(`[AuthContext] Attempting to subscribe to: ${userStatusChannelName}`);
      const channel: RealtimeChannel = supabase.channel(userStatusChannelName, {
        config: {
          broadcast: { ack: true }
        }
      });

      channel
        .on('broadcast', { event: 'account_banned' }, (response) => {
          console.log(`[AuthContext] Received 'account_banned' event for user ${user.id}:`, response.payload);
          showToast(response.payload?.message || 'Your account access has been revoked and you have been logged out.', 'error', 0);
          
          supabase.auth.signOut().catch(signOutError => {
            console.error('[AuthContext] Error signing out after ban event:', signOutError);
          });
        })
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[AuthContext] Successfully subscribed to ${userStatusChannelName}`);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error(`[AuthContext] Failed to subscribe to ${userStatusChannelName}:`, err || status);
          } else if (status === 'CLOSED') {
            console.log(`[AuthContext] Channel ${userStatusChannelName} closed.`);
          }
        });

      return () => {
        console.log(`[AuthContext] Unsubscribing from ${userStatusChannelName}`);
        supabase.removeChannel(channel).catch(removeErr => console.error(`[AuthContext] Error removing channel ${userStatusChannelName}:`, removeErr));
      };
    }
  }, [user, supabase, showToast]);

  return (
    <AuthContext.Provider value={{ user, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  return useContext(AuthContext);
}; 