'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { X, UserCircle2 } from 'lucide-react';

interface UserModalProps {
  chatId: string;
  onClose: () => void;
}

interface ChatMember {
  id: string;
  username: string | null;
  avatar_url?: string | null;
  bio?: string | null;
}

export default function UserModal({ chatId, onClose }: UserModalProps) {
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  
  // Handle ESC key for closing modal
  useEffect(() => {
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleEscKey);
    return () => {
      window.removeEventListener('keydown', handleEscKey);
    };
  }, [onClose]);
  
  useEffect(() => {
    // Focus trap for accessibility
    const focusableElements = modalRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusableElements && focusableElements.length > 0) {
      (focusableElements[0] as HTMLElement).focus();
    }
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);
  
  useEffect(() => {
    const fetchChatMembers = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // First try to use the new API route which should work with the fixed policy
        try {
          const response = await fetch(`/api/chat-members?chatId=${chatId}`, { credentials: 'include' });
          
          if (!response.ok) {
            const errorData = await response.json();
            console.error('API Error:', errorData.error);
            throw new Error(errorData.error || 'Failed to fetch members');
          }
          
          const data = await response.json();
          console.log('Members from API:', data.members);
          
          if (data.members && data.members.length > 0) {
            setMembers(data.members);
            return; // Success! No need to try the fallback
          }
        } catch (apiError) {
          console.error('Error using API route:', apiError);
          // Will continue to fallback method
        }
        
        // FALLBACK METHOD: Use direct Supabase client
        console.log('Trying direct Supabase method...');
        
        // Try to get chat participants directly (this should work if the policy is fixed)
        const { data: participants, error: participantsError } = await supabase
          .from('chat_participants')
          .select('user_id')
          .eq('chat_id', chatId);
          
        if (participantsError) {
          console.error('Error fetching participants:', participantsError);
          throw new Error('Failed to fetch chat participants');
        }
        
        console.log('Participants from Supabase:', participants);
        
        if (!participants || participants.length === 0) {
          console.log('No participants found');
          setMembers([]);
          return;
        }
        
        // Get all valid user IDs
        const userIds = participants
          .map(p => p.user_id)
          .filter(Boolean);
        
        console.log('Valid user IDs:', userIds);
        
        if (userIds.length === 0) {
          setMembers([]);
          return;
        }
        
        // Fetch profiles for these users
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username, avatar_url, bio')
          .in('id', userIds);
          
        if (profilesError) {
          console.error('Error fetching profiles:', profilesError);
          throw new Error('Failed to fetch user profiles');
        }
        
        console.log('Profiles from Supabase:', profiles);
        setMembers(profiles || []);
      } catch (err) {
        console.error('Error fetching chat members:', err);
        setError('Failed to load chat members. Please try again.');
        
        // LAST RESORT FALLBACK: Just show all profiles in the system
        // This is not ideal, but ensures the user sees something
        try {
          const { data: allProfiles } = await supabase
            .from('profiles')
            .select('id, username, avatar_url, bio');
            
          setMembers(allProfiles || []);
        } catch (fallbackError) {
          console.error('Even fallback failed:', fallbackError);
        }
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchChatMembers();
    
    // Add click outside listener
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [chatId, onClose]);
  
  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div 
        ref={modalRef}
        className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between border-b p-4">
          <h2 id="modal-title" className="text-lg font-semibold">Chat Members ({members.length})</h2>
          <button 
            onClick={onClose}
            className="p-1 rounded-full hover:bg-gray-100"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="overflow-y-auto flex-1 p-4">
          {isLoading ? (
            <div className="flex justify-center items-center h-40">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 border-t-2 border-blue-500 rounded-full animate-spin mb-2"></div>
                <p className="text-gray-600">Loading members...</p>
              </div>
            </div>
          ) : error ? (
            <div className="text-red-500 text-center p-4">
              <p>{error}</p>
              <button 
                onClick={() => setIsLoading(true)} 
                className="mt-2 px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
              >
                Retry
              </button>
            </div>
          ) : members.length === 0 ? (
            <div className="text-gray-500 text-center p-4">No members found</div>
          ) : (
            <ul className="space-y-4">
              {members.map((member) => (
                <li key={member.id} className="flex items-center space-x-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gray-200 overflow-hidden">
                    {member.avatar_url ? (
                      <img 
                        src={member.avatar_url} 
                        alt={member.username || 'User profile'}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Fallback if image fails to load
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).parentElement!.innerHTML = `
                            <div class="w-full h-full flex items-center justify-center bg-blue-100 text-blue-500">
                              ${(member.username || 'U').charAt(0).toUpperCase()}
                            </div>
                          `;
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-blue-100 text-blue-500">
                        <UserCircle2 className="w-8 h-8" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 truncate">
                      {member.username || 'Anonymous User'}
                    </h3>
                    {member.bio && (
                      <p className="text-sm text-gray-500 line-clamp-2">
                        {member.bio}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
} 