'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

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

  return (
    <AuthContext.Provider value={{ user, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  return useContext(AuthContext);
}; 