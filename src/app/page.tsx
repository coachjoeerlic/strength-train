'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleRedirect = async () => {
      try {
        if (!loading) {
          if (user) {
            router.push('/profile');
          } else {
            router.push('/login');
          }
        }
      } catch (err) {
        console.error('Redirect error:', err);
        setError('An error occurred while redirecting. Please try refreshing the page.');
      }
    };

    handleRedirect();
  }, [user, loading, router]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="text-red-500 text-center">
          <p className="mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Refresh Page
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
    </main>
  );
}
