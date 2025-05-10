'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message } from '@/types/message';
import { supabase } from '@/lib/supabaseClient'; // Adjust path as necessary
import { X, ArrowUpRightSquare, PinOff, MessageCircle } from 'lucide-react';
import { useToasts } from '@/contexts/ToastContext'; // For error feedback
import { format } from 'date-fns';

interface PinnedMessagesModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatId: string | null; // Can be null if no chat is active
  currentUserIsAdmin: boolean;
  onUnpinMessage: (messageId: string) => void; // Passed from ChatPage
  onScrollToMessage: (messageId: string) => void; // Passed from ChatPage
}

const PinnedMessagesModal: React.FC<PinnedMessagesModalProps> = ({
  isOpen,
  onClose,
  chatId,
  currentUserIsAdmin,
  onUnpinMessage,
  onScrollToMessage,
}) => {
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToasts();

  const fetchPinnedMessages = useCallback(async () => {
    if (!chatId || !isOpen) {
      setPinnedMessages([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      // Step 1: Fetch core pinned message data (no direct profile join)
      const { data: messagesData, error: fetchError } = await supabase
        .from('messages')
        .select('*, reply_to:reply_to_message_id!left(user_id, content, media_type)') // Include essential reply info
        .eq('chat_id', chatId)
        .eq('is_pinned', true)
        .order('created_at', { ascending: true }); // Oldest first

      if (fetchError) {
        throw fetchError;
      }

      if (!messagesData || messagesData.length === 0) {
        setPinnedMessages([]);
        setIsLoading(false);
        return;
      }

      // Step 2: Collect all unique user IDs from messages and their replies
      const userIds = new Set<string>();
      messagesData.forEach(msg => {
        if (msg.user_id) userIds.add(msg.user_id);
        if (msg.reply_to?.user_id) userIds.add(msg.reply_to.user_id);
      });

      // Step 3: Fetch profiles for these user IDs
      let profilesMap = new Map();
      if (userIds.size > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .in('id', Array.from(userIds));

        if (profilesError) {
          console.error('Error fetching profiles for pinned messages modal:', profilesError);
          // Continue without all profiles, or show partial data
        } else if (profilesData) {
          profilesData.forEach(p => profilesMap.set(p.id, p));
        }
      }

      // Step 4: Combine messages with their profiles
      const combinedMessages = messagesData.map(msg => ({
        ...msg,
        profiles: profilesMap.get(msg.user_id) || null, // Attach main author profile
        reply_to: msg.reply_to 
          ? { 
              ...msg.reply_to, 
              profiles: profilesMap.get(msg.reply_to.user_id) || null // Attach replied-to author profile
            } 
          : null,
      }));

      setPinnedMessages(combinedMessages as Message[]);
    } catch (err: any) {
      console.error('Error fetching pinned messages:', err);
      setError('Failed to load pinned messages.');
      showToast('Failed to load pinned messages.', 'error');
      setPinnedMessages([]);
    } finally {
      setIsLoading(false);
    }
  }, [chatId, isOpen, showToast]);

  useEffect(() => {
    if (isOpen) {
      fetchPinnedMessages();
    }
  }, [isOpen, fetchPinnedMessages]);

  // Click outside handler
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

  const handleUnpinClick = (messageId: string) => {
    onUnpinMessage(messageId);
    // Optimistically remove from local list or re-fetch
    setPinnedMessages(prev => prev.filter(msg => msg.id !== messageId));
  };

  const handleJumpToMessageClick = (messageId: string) => {
    onScrollToMessage(messageId);
    onClose(); // Close modal after jumping
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black bg-opacity-60 p-4 backdrop-blur-sm">
      <div ref={modalRef} className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Pinned Messages</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 p-1 rounded-full"
            aria-label="Close pinned messages modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading && (
            <div className="text-center py-10">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto"></div>
              <p className="mt-3 text-gray-600 dark:text-gray-300">Loading pinned messages...</p>
            </div>
          )}
          {!isLoading && error && (
            <div className="text-center py-10 px-4">
              <p className="text-red-500">{error}</p>
              <button onClick={fetchPinnedMessages} className="mt-3 text-sm text-blue-500 hover:underline">Try again</button>
            </div>
          )}
          {!isLoading && !error && pinnedMessages.length === 0 && (
            <div className="text-center py-10 px-4">
               <MessageCircle className="h-12 w-12 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">No messages have been pinned in this chat yet.</p>
            </div>
          )}
          {!isLoading && !error && pinnedMessages.length > 0 && (
            pinnedMessages.map(msg => (
              <div key={msg.id} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center min-w-0">
                    {msg.profiles?.avatar_url ? (
                        <img src={msg.profiles.avatar_url} alt={msg.profiles.username || 'avatar'} className="h-6 w-6 rounded-full mr-2 flex-shrink-0" />
                    ) : (
                        <div className="h-6 w-6 rounded-full bg-gray-300 dark:bg-gray-600 mr-2 flex-shrink-0 flex items-center justify-center text-xs text-gray-500 dark:text-gray-300">
                            {msg.profiles?.username?.[0]?.toUpperCase() || 'U'}
                        </div>
                    )}
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{msg.profiles?.username || 'User'}</span>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">{format(new Date(msg.created_at), 'MMM d, h:mm a')}</span>
                </div>
                
                {msg.content && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words mb-2">{msg.content}</p>}
                {/* Basic media type display for MVP */}
                {msg.media_type && !msg.content && (
                    <p className="text-sm italic text-gray-500 dark:text-gray-400 mb-2">
                        [{msg.media_type.charAt(0).toUpperCase() + msg.media_type.slice(1)}]
                    </p>
                )}

                <div className="flex items-center justify-end space-x-2 mt-1 pt-1 border-t border-gray-200 dark:border-gray-600">
                  <button 
                    onClick={() => handleJumpToMessageClick(msg.id)}
                    className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 p-1 rounded hover:bg-blue-50 dark:hover:bg-gray-600 flex items-center"
                    title="Jump to message"
                  >
                    <ArrowUpRightSquare className="h-3.5 w-3.5 mr-1" /> Go to message
                  </button>
                  {currentUserIsAdmin && (
                    <button 
                      onClick={() => handleUnpinClick(msg.id)}
                      className="text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 p-1 rounded hover:bg-red-50 dark:hover:bg-gray-600 flex items-center"
                      title="Unpin this message"
                    >
                      <PinOff className="h-3.5 w-3.5 mr-1" /> Unpin
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default PinnedMessagesModal; 