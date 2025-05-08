'use client';

import { useEffect, useState } from 'react';
import { subscribeToTypingStatus, TypingStatus } from '@/lib/typingService';
import { User } from '@supabase/supabase-js';
import { RealtimeChannel } from '@supabase/supabase-js';

type TypingIndicatorProps = {
  chatId: string;
  currentUser: User | null;
};

export default function TypingIndicator({ chatId, currentUser }: TypingIndicatorProps) {
  const [typingUsers, setTypingUsers] = useState<any[]>([]);
  const [displayIndex, setDisplayIndex] = useState(0);
  const [typingChannel, setTypingChannel] = useState<RealtimeChannel | null>(null);
  
  useEffect(() => {
    if (!chatId || !currentUser) return;
    
    const channel = subscribeToTypingStatus(
      chatId,
      currentUser.id,
      (data) => {
        console.log('[TypingIndicator] Typing users updated:', data);
        setTypingUsers(data);
      }
    );
    
    setTypingChannel(channel);
    
    // Rotate through typing users if multiple are typing
    let rotationInterval: NodeJS.Timeout | null = null;
    
    if (typingUsers.length > 1) {
      rotationInterval = setInterval(() => {
        setDisplayIndex((prev) => (prev + 1) % typingUsers.length);
      }, 3000); // Rotate every 3 seconds
    }
    
    return () => {
      if (channel) channel.unsubscribe();
      if (rotationInterval) clearInterval(rotationInterval);
    };
  }, [chatId, currentUser]);
  
  // When typing users count changes, reset display index and set up rotation if needed
  useEffect(() => {
    let rotationInterval: NodeJS.Timeout | null = null;
    
    if (typingUsers.length > 1) {
      setDisplayIndex(0); // Reset to first user
      rotationInterval = setInterval(() => {
        setDisplayIndex((prev) => (prev + 1) % typingUsers.length);
      }, 3000); // Rotate every 3 seconds
    }
    
    return () => {
      if (rotationInterval) clearInterval(rotationInterval);
    };
  }, [typingUsers.length]);
  
  if (typingUsers.length === 0) return null;
  
  // Get the user to display (rotating if multiple)
  const userToDisplay = typingUsers[displayIndex % typingUsers.length];
  const username = userToDisplay?.profiles?.username || 'Someone';
  
  return (
    <div className="flex items-center text-sm text-gray-500 italic py-1 px-4 border-t">
      <div className="flex space-x-1 mr-2">
        <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
        <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
        <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
      </div>
      <span>
        {username} is typing
        {typingUsers.length > 1 && ` (${typingUsers.length} people typing)`}
      </span>
    </div>
  );
} 