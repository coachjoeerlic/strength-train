'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
      <div className="max-w-md mx-auto flex justify-between">
        <Link 
          href="/profile" 
          className={`p-2 rounded-full ${pathname === '/profile' ? 'bg-gray-100' : ''}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </Link>
        <Link 
          href="/training" 
          className={`p-2 rounded-full ${pathname === '/training' ? 'bg-gray-100' : ''} text-2xl`}
        >
          💪
        </Link>
      </div>
    </nav>
  );
} 