'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
      <div className="max-w-md mx-auto flex justify-around">
        <Link 
          href="/profile" 
          className={`flex flex-col items-center p-2 rounded-lg ${pathname === '/profile' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="text-xs mt-1">Profile</span>
        </Link>
        <Link 
          href="/training" 
          className={`flex flex-col items-center p-2 rounded-lg ${pathname === '/training' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
        >
          <span className="text-2xl">💪</span>
          <span className="text-xs mt-1">Train</span>
        </Link>
      </div>
    </nav>
  );
} 