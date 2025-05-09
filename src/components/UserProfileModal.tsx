'use client';

import React, { useEffect, useRef } from 'react';

// Define a more complete Profile type for this modal, including id
export type UserProfile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
};

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | null;
  isLoading: boolean;
  error: string | null;
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  profile,
  isLoading,
  error,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div ref={modalRef} className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          aria-label="Close profile modal"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {isLoading && (
          <div className="flex flex-col items-center justify-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-300">Loading profile...</p>
          </div>
        )}

        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <p className="text-red-500">Error loading profile:</p>
            <p className="text-red-400 text-sm mt-1">{error}</p>
            <button 
              onClick={onClose} 
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Close
            </button>
          </div>
        )}

        {!isLoading && !error && profile && (
          <div className="space-y-4">
            <div className="flex flex-col items-center">
              <div className="w-32 h-32 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center overflow-hidden mb-4 border-2 border-gray-300 dark:border-gray-600">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.username || 'User avatar'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg
                    className="w-20 h-20 text-gray-400 dark:text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                )}
              </div>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{profile.username || 'Anonymous User'}</h2>
            </div>
            {profile.bio ? (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-1">BIO</h3>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-gray-700 p-3 rounded-md">{profile.bio}</p>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center">No bio available.</p>
            )}
          </div>
        )}
        {!isLoading && !error && !profile && (
             <div className="flex flex-col items-center justify-center h-48 text-center">
                <p className="text-gray-600 dark:text-gray-300">Profile not found.</p>
                 <button 
                    onClick={onClose} 
                    className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                    Close
                </button>
            </div>
        )}
      </div>
    </div>
  );
};

export default UserProfileModal; 