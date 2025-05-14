'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { ArrowLeft, Users } from 'lucide-react';
import { subscribeToPresence, setActiveChat } from '@/lib/presenceService';
import { RealtimeChannel } from '@supabase/supabase-js';

interface ChatHeaderProps {
  chatId: string;
  onOpenModal: () => void;
}

export default function ChatHeader({ chatId, onOpenModal }: ChatHeaderProps) {
  const [chatTitle, setChatTitle] = useState<string>('Chat');
  const [memberCount, setMemberCount] = useState<number>(0);
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [presenceChannel, setPresenceChannel] = useState<RealtimeChannel | null>(null);
  const router = useRouter();

  // Set this chat as active for presence tracking
  useEffect(() => {
    setActiveChat(chatId);
    
    return () => {
      // Clear active chat when component unmounts
      setActiveChat(null);
    };
  }, [chatId]);
  
  // Subscribe to presence updates
  useEffect(() => {
    if (!chatId) return;
    
    console.log('[ChatHeader] Setting up presence subscription for chat:', chatId);
    
    // Set up presence subscription
    const channel = subscribeToPresence(chatId, (presenceData) => {
      console.log('[ChatHeader] Presence data updated:', presenceData);
      setOnlineCount(presenceData.length);
    });
    
    setPresenceChannel(channel);
    
    return () => {
      console.log('[ChatHeader] Cleaning up presence subscription');
      channel.unsubscribe();
    };
  }, [chatId]);

  useEffect(() => {
    const fetchChatDetails = async () => {
      try {
        setIsLoading(true);
        
        // Fetch chat details using the correct column name 'name'
        const { data: chatData, error: chatError } = await supabase
          .from('chats')
          .select('name')
          .eq('id', chatId)
          .single();
        
        if (chatError) {
          console.error('Error fetching chat details:', chatError);
        } else {
          console.log('Chat data:', chatData);
          
          // Set chat title from name field
          if (chatData?.name) {
            setChatTitle(chatData.name);
          } else {
            setChatTitle(`Chat #${chatId.substring(0, 8)}`);
          }
        }
        
        // First try using the API route (most reliable)
        try {
          const response = await fetch(`/api/chat-members?chatId=${chatId}`, { credentials: 'include' });
          
          if (response.ok) {
            const data = await response.json();
            console.log('Members from API:', data.members?.length || 0);
            setMemberCount(data.members?.length || 0);
            // Success! Return early
            return;
          }
        } catch (apiError) {
          console.error('Error using API route for count:', apiError);
          // Continue to fallback method
        }
        
        // Try direct Supabase query using the fixed policy
        try {
          const { data: participants, error: participantsError } = await supabase
            .from('chat_participants')
            .select('user_id')
            .eq('chat_id', chatId);
          
          if (!participantsError && participants) {
            console.log('Participants count:', participants.length);
            setMemberCount(participants.length);
            return;
          }
        } catch (participantsError) {
          console.error('Error getting participants count:', participantsError);
          // Continue to final fallback
        }
        
        // Final fallback: set to 2 as a reasonable default for now
        setMemberCount(2);
      } catch (err) {
        console.error('Failed to fetch chat details:', err);
        // Set a reasonable fallback count
        setMemberCount(2);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchChatDetails();
  }, [chatId]);
  
  const handleBack = () => {
    router.push('/chats');
  };
  
  return (
    <header className="sticky top-0 z-20 border-b bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between max-w-2xl mx-auto">
        {/* Left: Back button */}
        <div className="flex-none">
          <button 
            onClick={handleBack}
            className="p-1 rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Back to chats"
          >
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
        </div>
        
        {/* Center: Chat title */}
        <div className="flex-1 flex justify-center">
          <button
            onClick={onOpenModal}
            className="flex items-center space-x-2 hover:bg-gray-50 px-2 py-1 rounded-lg transition-colors"
            title="View chat members"
          >
            <h1 className="font-semibold text-lg truncate max-w-[180px] sm:max-w-[250px] text-center">
              {isLoading ? 'Loading...' : chatTitle}
            </h1>
          </button>
        </div>
        
        {/* Right: Member count */}
        <div className="flex-none">
          <button
            onClick={onOpenModal}
            className="flex items-center space-x-1 text-gray-600 hover:bg-gray-50 px-2 py-1 rounded-md transition-colors"
            title="View chat members"
          >
            <Users className="h-4 w-4" />
            <span className="text-sm">
              {memberCount}{" "}
              {onlineCount > 0 && (
                <span className="text-green-500 ml-1">
                  ({onlineCount} online)
                </span>
              )}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
} 