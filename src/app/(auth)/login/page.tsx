'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { AuthError } from '@supabase/supabase-js';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Check for error in URL
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error === 'auth_callback_failed') {
      setMessage({ 
        type: 'error', 
        text: 'Authentication failed. Please try logging in again.' 
      });
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        const typedAuthError = authError as AuthError;
        setMessage({ type: 'error', text: typedAuthError.message });
        setLoading(false);
        return;
      }

      if (authData.user) {
        // Successful Supabase auth, now check profile for ban status
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('is_banned')
          .eq('id', authData.user.id)
          .single();

        if (profileError) {
          console.error("Error fetching profile for ban check:", profileError);
          // Potentially sign out and show generic error, or let through for MVP if profile fetch fails?
          // For MVP, let's show an error and prevent login if profile can't be checked.
          await supabase.auth.signOut(); 
          setMessage({ type: 'error', text: 'Could not verify account status. Please try again.' });
          setLoading(false);
          return;
        }

        if (profileData && profileData.is_banned) {
          await supabase.auth.signOut(); // Sign out the just-authenticated user
          setMessage({ type: 'error', text: 'Your account has been suspended. Please contact support.' });
          setLoading(false);
          return;
        } else {
          // Not banned or profile issue that we decided to let pass (if any)
          router.push('/profile');
          // setLoading will be handled by page navigation or can be set here if push is not immediate enough
        }
      } else {
        // Should not happen if authError is null, but as a fallback
        setMessage({ type: 'error', text: 'Login failed. Please try again.' });
        setLoading(false);
      }

    } catch (error) { // Catch any other unexpected errors
      console.error("Unexpected login error:", error);
      setMessage({ type: 'error', text: 'An unexpected error occurred during login.' });
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      setMessage({ type: 'error', text: 'Please enter your email address' });
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        const authError = error as AuthError;
        setMessage({ type: 'error', text: authError.message });
      } else {
        setMessage({ type: 'success', text: 'Password reset instructions sent to your email' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-center">Login</h1>
          <p className="mt-2 text-center text-gray-600">
            Don't have an account?{' '}
            <Link href="/register" className="text-blue-500 hover:text-blue-600">
              Register
            </Link>
          </p>
        </div>

        {message && (
          <div
            className={`p-4 rounded-lg ${
              message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleResetPassword}
              className="text-sm text-blue-500 hover:text-blue-600"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
} 