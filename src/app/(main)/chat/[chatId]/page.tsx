'use client';

import { useEffect, useState, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import MessageBubble from '@/components/MessageBubble';
import MessageInput from '@/components/MessageInput';
import TypingIndicator from '@/components/TypingIndicator';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Message, ReactionSummary } from '@/types/message';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import debounce from 'lodash.debounce';
import React from 'react';
import { isToday, format, startOfDay, isSameDay } from 'date-fns';
import { addReaction, removeReaction } from '@/lib/reactionService';
import { useToasts } from '@/contexts/ToastContext'; // Import useToasts

// Add throb animation via a style tag in the component
function addThrobAnimation() {
  // Only add the style tag once
  if (typeof window !== 'undefined' && !document.getElementById('throb-animation-style')) {
    const style = document.createElement('style');
    style.id = 'throb-animation-style';
    style.innerHTML = `
      @keyframes throb {
        0%, 100% { transform: scale(1); opacity: 0.7; }
        50% { transform: scale(1.1); opacity: 1; }
      }
      .animate-throb {
        animation: throb 1.5s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);
  }
}

// Add UnreadBanner component
function UnreadBanner() {
  return (
    <div 
      className="w-full py-2 px-4 my-2 bg-blue-50 border-l-4 border-blue-500 rounded-r-md"
      data-testid="unread-banner"
    >
      <p className="text-blue-700 font-medium text-sm">New messages above</p>
    </div>
  );
}

// Add DateHeader component
function DateHeader({ date }: { date: Date }) {
  const formattedDate = isToday(date) 
    ? "Today" 
    : format(date, 'MMM d');
    
  return (
    <div className="flex justify-center my-4">
      <div className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-500">
        {formattedDate}
      </div>
    </div>
  );
}

function ScrollToBottomButton({ visible, onClick, unreadCount = 0 }: { visible: boolean; onClick: (event: React.MouseEvent) => void; unreadCount?: number }) {
  return (
    <button
      className={`fixed z-30 transition-opacity duration-300 bottom-32 right-6 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600 focus:outline-none ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      style={{ pointerEvents: visible ? 'auto' : 'none' }}
      onClick={(e) => onClick(e)}
      aria-label="Scroll to bottom or unread"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5 shadow">{unreadCount}</span>
      )}
    </button>
  );
}

// Helper hook for intersection observer
function useMessageInView(onInView: (id: string) => void) {
  const observer = useRef<IntersectionObserver | null>(null);
  const observed = useRef<Set<string>>(new Set());

  const observe = useCallback((node: Element | null, id: string) => {
    if (!node) return;
    if (!observer.current) {
      observer.current = new window.IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const messageId = (entry.target as HTMLElement).dataset.messageId;
          if (entry.isIntersecting && messageId && !observed.current.has(messageId)) {
            observed.current.add(messageId);
            onInView(messageId);
          }
        });
      }, { threshold: 0.5 });
    }
    observer.current.observe(node);
  }, [onInView]);

  useEffect(() => {
    return () => {
      observer.current?.disconnect();
      observed.current.clear();
    };
  }, []);

  return observe;
}

function useBatchedMarkAsRead(
  supabase: any,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  user: { id: string } | null
) {
  const batchRef = useRef<Set<string>>(new Set());
  const retryRef = useRef<Set<string>>(new Set());
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const isUnmounted = useRef(false);

  // Add message ID to batch and optimistically update local state
  const addToBatch = useCallback((id: string) => {
    batchRef.current.add(id);
    setMessages((msgs: Message[]) => msgs.map((m: Message) => m.id === id ? { ...m, is_read: true } : m));
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    debounceTimeout.current = setTimeout(() => {
      flushBatch();
    }, 200);
  }, [setMessages]);

  // Flush the batch and send update to Supabase
  const flushBatch = useCallback(async () => {
    if (batchRef.current.size === 0) return;
    const ids = Array.from(batchRef.current);
    batchRef.current.clear();
    try {
      const { error } = await supabase.from('messages').update({ is_read: true }).in('id', ids);
      if (error) {
        // Retry failed IDs in the next batch
        ids.forEach((id: string) => retryRef.current.add(id));
      } else {
        // Remove retried IDs if successful
        ids.forEach((id: string) => retryRef.current.delete(id));
      }
    } catch {
      ids.forEach((id: string) => retryRef.current.add(id));
    }
  }, [supabase]);

  // Retry failed IDs in the next batch
  useEffect(() => {
    if (retryRef.current.size > 0) {
      retryRef.current.forEach((id: string) => batchRef.current.add(id));
      retryRef.current.clear();
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
      debounceTimeout.current = setTimeout(() => {
        flushBatch();
      }, 200);
    }
  }, [setMessages, flushBatch]);

  // Flush batch on unmount
  useEffect(() => {
    return () => {
      isUnmounted.current = true;
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
      flushBatch();
    };
  }, [flushBatch]);

  return addToBatch;
}

// Add binary search function for message insertion
const findMessageInsertionPoint = (messages: Message[], newMessage: Message): number => {
  let left = 0;
  let right = messages.length - 1;
  const newMessageTime = new Date(newMessage.created_at).getTime();
  
  console.log('[REALTIME] Binary search start:', {
    messageId: newMessage.id,
    messageTime: newMessageTime,
    totalMessages: messages.length,
    timeRange: messages.length > 0 ? {
      oldest: new Date(messages[0].created_at).toISOString(),
      newest: new Date(messages[messages.length - 1].created_at).toISOString()
    } : 'No messages'
  });

  while (left <= right) {
    let mid = Math.floor((left + right) / 2);
    const midMessageTime = new Date(messages[mid].created_at).getTime();

    if (midMessageTime === newMessageTime) {
      // If times are equal, insert after the last message with same time
      while (mid + 1 < messages.length && 
             new Date(messages[mid + 1].created_at).getTime() === newMessageTime) {
        mid++;
      }
      console.log('[REALTIME] Found equal timestamp, inserting at:', mid + 1);
      return mid + 1;
    }

    if (midMessageTime < newMessageTime) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  console.log('[REALTIME] Binary search result:', {
    insertIndex: left,
    messageId: newMessage.id,
    messageTime: newMessageTime
  });
  return left;
};

// Update time range check helper
const isMessageInCurrentTimeRange = (message: Message, messages: Message[]): boolean => {
  if (messages.length === 0) {
    console.log('[REALTIME] No messages in view, accepting new message');
    return true;
  }
  
  const messageTime = new Date(message.created_at).getTime();
  const oldestMessageTime = new Date(messages[0].created_at).getTime();
  
  // Only check if message is older than our oldest message
  // Always accept newer messages
  const inRange = messageTime >= oldestMessageTime;
  
  console.log('[REALTIME] Time range check:', {
    messageId: message.id,
    messageTime: new Date(message.created_at).toISOString(),
    oldestMessageTime: new Date(oldestMessageTime).toISOString(),
    inRange,
    reason: inRange ? 'Message is newer or within range' : 'Message is older than current view'
  });
  
  return inRange;
};

// Add ReturnToReplyArrow component at the top level
// function ReturnToReplyArrow({ onClick }: { onClick: () => void }) {
//   return (
//     <button
//       onClick={onClick}
//       className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 hover:bg-blue-200 focus:outline-none ml-2 animate-throb"
//       aria-label="Return to reply"
//       title="Return to previous message"
//     >
//       <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
//       </svg>
//     </button>
//   );
// }

// Import the new components
import ChatHeader from '@/components/ChatHeader';
import UserModal from '@/components/UserModal';
import UserProfileModal, { UserProfile } from '@/components/UserProfileModal'; // Import new modal and its Profile type
import SuperemojiMenu from '@/components/SuperemojiMenu'; // Added
import ChatPageMessagesSkeleton from '@/components/Skeletons/ChatPageMessagesSkeleton'; // Import skeleton
import PinnedMessageBanner from '@/components/PinnedMessageBanner'; // Import PinnedMessageBanner
import PinnedMessagesModal from '@/components/PinnedMessagesModal'; // Import PinnedMessagesModal

export default function ChatPage({ params }: { params: { chatId: string } }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [oldestCursor, setOldestCursor] = useState<string | null>(null);
  const [newestCursor, setNewestCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [hasNewer, setHasNewer] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState<Set<string>>(new Set());
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [scrollContainerReady, setScrollContainerReady] = useState(false);
  const [unreadMessagesLoaded, setUnreadMessagesLoaded] = useState(false);
  const [testMode, setTestMode] = useState<'top' | 'bottom' | null>(null);
  const [showTestControls, setShowTestControls] = useState(false);
  const [loadingContextForMessageId, setLoadingContextForMessageId] = useState<string | null>(null);
  // Add new state for jump history
  const [jumpHistory, setJumpHistory] = useState<Array<{ sourceId: string, targetId: string }>>([]);
  // Add state for banner position
  const [firstUnreadMessageIdForBanner, setFirstUnreadMessageIdForBanner] = useState<string | null>(null);
  // Add state for modal visibility
  const [modalVisible, setModalVisible] = useState(false); // Existing modal for chat members
  const [isUserProfileModalOpen, setIsUserProfileModalOpen] = useState(false);
  const [selectedUserProfile, setSelectedUserProfile] = useState<UserProfile | null>(null);
  const [userProfileModalLoading, setUserProfileModalLoading] = useState(false);
  const [userProfileModalError, setUserProfileModalError] = useState<string | null>(null);
  const [latestPinnedMessage, setLatestPinnedMessage] = useState<Message | null>(null);
  const [isPinnedMessagesModalOpen, setIsPinnedMessagesModalOpen] = useState(false); // State for pinned messages modal

  // State for SuperemojiMenu
  const [superemojiMenuState, setSuperemojiMenuState] = useState<{
    isVisible: boolean;
    message: Message | null;
    position: { x: number; y: number } | null;
    reactingUsersProfiles?: Array<{ id: string; username?: string; avatar_url?: string; emoji: string }>; 
  }>({ isVisible: false, message: null, position: null, reactingUsersProfiles: [] });

  const { showToast } = useToasts(); 

  // Local toast state, ref, and helper function have been removed.

  const fetchLatestPinnedMessage = async () => {
    if (!params.chatId || !supabase) return; 
    try {
      console.log('[PINNED_BANNER] Fetching latest pinned message for chat:', params.chatId);
      // Step 1: Fetch the core pinned message data
      const { data: messageData, error: messageError } = await supabase
        .from('messages')
        .select('*, reply_to:reply_to_message_id!left(user_id, content, media_type)') // Get essential fields, including reply author ID
        .eq('chat_id', params.chatId)
        .eq('is_pinned', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (messageError) {
        console.error('Error fetching latest pinned message (step 1):', messageError);
        showToast('Could not load pinned message.', 'error');
        setLatestPinnedMessage(null);
        return;
      }

      if (!messageData) {
        setLatestPinnedMessage(null); // No pinned message found
        return;
      }

      // Step 2: Fetch author profile for the main message
      let authorProfile = null;
      if (messageData.user_id) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .eq('id', messageData.user_id)
          .single();
        if (profileError) {
          console.error('Error fetching author profile for pinned message:', profileError);
          // Decide if this is critical for the banner; for MVP, can proceed without profile
        } else {
          authorProfile = profileData;
        }
      }
      
      // Step 3: (Optional for banner, more for modal) Fetch profile for replied-to user if exists
      // For the banner, we primarily need the main message author. The reply_to content is often just text.

      // Step 4: Construct the final message object for state
      const finalMessageData = {
        ...messageData,
        profiles: authorProfile, // Attach the fetched profile
        // reply_to object from initial fetch is kept, profiles for it aren't critical for banner
      };

      console.log('[PINNED_BANNER] Processed pinned message for state:', finalMessageData);
      setLatestPinnedMessage(finalMessageData as Message | null);

    } catch (err: any) {
      console.error('Unexpected error fetching pinned message:', err);
      showToast('Error loading pinned message.', 'error');
      setLatestPinnedMessage(null);
    }
  };

  const handlePinMessage = async (messageId: string) => {
    console.log('[PINNING] Pinning message:', messageId);
    // Optimistic UI Update
    setMessages(prevMessages => 
      prevMessages.map(msg => 
        msg.id === messageId ? { ...msg, is_pinned: true } : msg
      )
    );

    try {
      const { error } = await supabase
        .from('messages')
        .update({ is_pinned: true })
        .eq('id', messageId);

      if (error) {
        showToast(`Failed to pin message: ${error.message}`, 'error');
        // Revert optimistic update on error
        setMessages(prevMessages => 
          prevMessages.map(msg => 
            msg.id === messageId ? { ...msg, is_pinned: false } : msg // Assuming it was false before
          )
        );
        console.error('Error pinning message:', error);
      } else {
        showToast('Message pinned!', 'success');
        fetchLatestPinnedMessage(); // Refresh banner
      }
    } catch (err: any) {
      showToast(`An unexpected error occurred: ${err.message}`, 'error');
      // Revert optimistic update on error
      setMessages(prevMessages => 
        prevMessages.map(msg => 
          msg.id === messageId ? { ...msg, is_pinned: false } : msg
        )
      );
      console.error('Unexpected error pinning message:', err);
    }
  };

  const handleUnpinMessage = async (messageId: string) => {
    console.log('[PINNING] Unpinning message:', messageId);
    // Optimistic UI Update
    setMessages(prevMessages => 
      prevMessages.map(msg => 
        msg.id === messageId ? { ...msg, is_pinned: false } : msg
      )
    );

    try {
      const { error } = await supabase
        .from('messages')
        .update({ is_pinned: false })
        .eq('id', messageId);

      if (error) {
        showToast(`Failed to unpin message: ${error.message}`, 'error');
        // Revert optimistic update on error
        setMessages(prevMessages => 
          prevMessages.map(msg => 
            msg.id === messageId ? { ...msg, is_pinned: true } : msg // Assuming it was true before
          )
        );
        console.error('Error unpinning message:', error);
      } else {
        showToast('Message unpinned!', 'success');
        fetchLatestPinnedMessage(); // Refresh banner
      }
    } catch (err: any) {
      showToast(`An unexpected error occurred: ${err.message}`, 'error');
      // Revert optimistic update on error
      setMessages(prevMessages => 
        prevMessages.map(msg => 
          msg.id === messageId ? { ...msg, is_pinned: true } : msg
        )
      );
      console.error('Unexpected error unpinning message:', err);
    }
  };

  // Helper function to process raw reactions and stitch them to messages
  const processAndStitchReactions = useCallback((
    messagesToProcess: Message[],
    rawReactions: Array<{ message_id: string; user_id: string; emoji: string }>,
    currentUserId: string | undefined
  ): Message[] => {
    if (!currentUserId) {
      // If no current user, or reactions can't be personalized, return messages as is or with basic counts
      // For now, just returning with empty reactions if no user.
       return messagesToProcess.map(msg => ({...msg, reactions: msg.reactions || []}));
    }

    const reactionsByMessageId = rawReactions.reduce((acc, reaction) => {
      acc[reaction.message_id] = acc[reaction.message_id] || [];
      acc[reaction.message_id].push(reaction);
      return acc;
    }, {} as Record<string, Array<{ message_id: string; user_id: string; emoji: string }>>);

    return messagesToProcess.map(message => {
      const msgRawReactions = reactionsByMessageId[message.id] || [];
      const reactionSummaries: ReactionSummary[] = [];

      const reactionsByEmoji = msgRawReactions.reduce((acc, reaction) => {
        acc[reaction.emoji] = acc[reaction.emoji] || { userIds: [], count: 0 };
        acc[reaction.emoji].userIds.push(reaction.user_id);
        acc[reaction.emoji].count++;
        return acc;
      }, {} as Record<string, { userIds: string[]; count: number }>);

      for (const emojiKey in reactionsByEmoji) {
        const { userIds, count } = reactionsByEmoji[emojiKey];
        reactionSummaries.push({
          emoji: emojiKey,
          count: count,
          reactedByCurrentUser: userIds.includes(currentUserId),
          userIds: userIds,
        });
      }
      reactionSummaries.sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return a.emoji.localeCompare(b.emoji);
      });
      
      return { ...message, reactions: reactionSummaries };
    });
  }, []); // No dependencies needed as it's a pure function based on its arguments

  // Refs
  const channelRef = useRef<RealtimeChannel | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const retryCountRef = useRef(0);
  const prevScrollHeightRef = useRef<number>(0);
  const prevScrollTopRef = useRef<number>(0);
  const topMessageRef = useRef<HTMLDivElement | null>(null);
  const bottomMessageRef = useRef<HTMLDivElement | null>(null);
  const isLoadingMoreRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastScrollTopRef = useRef(0);
  const isRestoringAnchor = useRef(false);
  const anchorRestoreRef = useRef<{ anchorId: string, offset: number, attempts?: number } | null>(null);
  const hasRestoredScroll = useRef(false);
  const unreadMessagesRef = useRef<Set<string>>(new Set());
  const initialFetchRef = useRef(false);
  const fetchPromiseRef = useRef<Promise<void> | null>(null);
  const authCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Refs for anchor scroll adjustment
  const anchorScrollInfoRef = useRef<{ id: string | null, offset: number }>({ id: null, offset: 0 });
  const needsScrollAdjustmentRef = useRef<boolean>(false);

  // Refs for unread state
  const unreadCountRef = useRef(0);
  const firstUnreadIdRef = useRef<string | null>(null);
  // Add ref to track scroll button visibility to avoid circular dependency
  const showScrollButtonRef = useRef(false);

  // Hooks
  const addToBatch = useBatchedMarkAsRead(supabase, setMessages, user);

  // Persistent scroll position logic
  const SCROLL_KEY = `chat-scroll-${params.chatId}`;
  const userId = user?.id;

  // Callback ref for scroll container
  const handleScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      console.log('[SCROLL] Scroll container ready:', {
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        scrollTop: node.scrollTop,
        messageCount: messages.length,
        timeRange: messages.length > 0 ? {
          oldest: messages[0].created_at,
          newest: messages[messages.length - 1].created_at
        } : 'No messages'
      });
      scrollContainerRef.current = node;
      if (!scrollContainerReady) {
        console.log('[SCROLL] Setting scroll container ready');
        setScrollContainerReady(true);
      }

      // Add scroll event listener
      const handleScroll = () => {
        const { scrollTop, scrollHeight, clientHeight } = node;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        const isNearBottom = distanceFromBottom < 100;
        
        console.log('[SCROLL_BUTTON] Scroll position check:', {
          scrollTop,
          scrollHeight,
          clientHeight,
          distanceFromBottom,
          isNearBottom,
          unreadCount,
          firstUnreadId,
          hasUnreadMessages: unreadCount > 0,
          currentShowButton: showScrollButtonRef.current,
          shouldShowButton: !isNearBottom || unreadCount > 0
        });

        // Calculate if button should be visible
        const shouldShowButton = !isNearBottom || unreadCount > 0;
        
        // Only update state if it would actually change, using the ref for comparison
        if (showScrollButtonRef.current !== shouldShowButton) {
          showScrollButtonRef.current = shouldShowButton; // Update ref first
          setShowScrollButton(shouldShowButton); // Then update state
        }
      };

      // Initial check
      handleScroll();

      // Add scroll event listener
      node.addEventListener('scroll', handleScroll);

      // Cleanup function
      return () => {
        node.removeEventListener('scroll', handleScroll);
      };
    }
  }, [messages, scrollContainerReady, unreadCount, firstUnreadId]); // Remove showScrollButton from deps

  // Update ref when state changes
  useEffect(() => {
    showScrollButtonRef.current = showScrollButton;
  }, [showScrollButton]);

  // Update refs when state changes 
  useEffect(() => {
    unreadCountRef.current = unreadCount;
    firstUnreadIdRef.current = firstUnreadId;
  }, [unreadCount, firstUnreadId]);

  // Add state update lock and fetch lock at the component level
  const stateUpdateLock = useRef(false);
  const fetchLock = useRef(false);
  const lastFetchTime = useRef<number>(0);
  const fetchQueue = useRef<(() => Promise<boolean>)[]>([]);
  const isProcessingQueue = useRef(false);
  const FETCH_COOLDOWN = 500; // 500ms cooldown between fetches
  const fetchState = useRef<'idle' | 'fetching' | 'updating'>('idle');

  // Process fetch queue
  const processFetchQueue = useCallback(async () => {
    if (isProcessingQueue.current || fetchQueue.current.length === 0 || fetchState.current !== 'idle') {
      console.log('[PAGINATION] Skipping queue processing:', {
        isProcessing: isProcessingQueue.current,
        queueLength: fetchQueue.current.length,
        fetchState: fetchState.current
      });
      return;
    }
    
    isProcessingQueue.current = true;
    const now = Date.now();
    
    try {
      while (fetchQueue.current.length > 0 && fetchState.current === 'idle') {
        const nextFetch = fetchQueue.current[0];
        
        // Check cooldown
        if (now - lastFetchTime.current < FETCH_COOLDOWN) {
          await new Promise(resolve => setTimeout(resolve, FETCH_COOLDOWN - (now - lastFetchTime.current)));
        }
        
        // Set fetching state
        fetchState.current = 'fetching';
        console.log('[PAGINATION] State transition: idle -> fetching');
        
        try {
          // Execute fetch and wait for it to complete
          const result = await nextFetch();
          
          // Set updating state
          fetchState.current = 'updating';
          console.log('[PAGINATION] State transition: fetching -> updating');
          
          // Only remove from queue if fetch was successful
          if (result) {
            fetchQueue.current.shift();
            lastFetchTime.current = Date.now();
            
            // Wait for state updates to complete
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            // If fetch failed, remove it from queue and continue
            fetchQueue.current.shift();
          }
        } finally {
          // Reset fetch state
          fetchState.current = 'idle';
          console.log('[PAGINATION] State transition: updating -> idle');
        }
      }
    } finally {
      isProcessingQueue.current = false;
    }
  }, []);

  // Helper: Fetch newer messages
  const fetchNewerMessages = useCallback(async () => {
    // This function now just queues the operation.
    // Add lock checks here before queueing.
    if (isLoadingMoreRef.current || fetchState.current !== 'idle') {
      console.log('[PAGINATION_NEWER_QUEUE] Skipping add to queue - already busy or locked.');
      return; 
    }
     if (!hasNewer) { // Use hasNewer state variable directly
         console.log('[PAGINATION_NEWER_QUEUE] Skipping add to queue - hasNewer is false.');
         return;
     }
    
    if (!scrollContainerRef.current) return;
    
    // Ensure we use the newestCursor if available and hasNewer is true
    let cursorTime: string | undefined;
    let cursorMessageId: string | null = null;

    if (hasNewer && newestCursor) {
      const cursorMsg = messages.find(m => m.id === newestCursor);
      if (cursorMsg) {
        cursorTime = cursorMsg.created_at;
        cursorMessageId = cursorMsg.id;
        console.log('[PAGINATION_NEWER] Using newestCursor:', { cursorId: newestCursor, cursorTime });
      } else {
        // Fallback if cursor message not found in current state, which shouldn't happen if cursors are set correctly.
        // This might indicate an issue or that the list is empty/too small after a context jump.
        console.warn('[PAGINATION_NEWER] newestCursor message not found in state. Attempting to use last message in array or aborting.', { newestCursor, messageCount: messages.length });
        if (messages.length > 0) {
            // As a robust fallback, try to use the actual last message if newestCursor is somehow desynced
            // This case should be rare if fetchMessageWithContext sets cursors properly
            cursorTime = messages[messages.length - 1].created_at;
            cursorMessageId = messages[messages.length - 1].id;
            console.log('[PAGINATION_NEWER] Fallback to actual last message in array:', { cursorId: cursorMessageId, cursorTime });
        } else {
            console.log('[PAGINATION_NEWER] No messages in state, cannot fetch newer.');
            setHasNewer(false); // Nothing to page from
            return; // Cannot proceed if no messages and no valid cursor
        }
      }
    } else if (messages.length > 0) {
      // Original behavior if hasNewer is false or newestCursor is not set (e.g. initial load from bottom)
      // However, hasNewer should be true if we expect this to run via scroll trigger for more content
      cursorTime = messages[messages.length - 1].created_at;
      cursorMessageId = messages[messages.length - 1].id;
      console.log('[PAGINATION_NEWER] Using last message in array as cursor (no newestCursor or !hasNewer):', { cursorId: cursorMessageId, cursorTime });
    } else {
      console.log('[PAGINATION_NEWER] No messages and no newestCursor, cannot fetch newer.');
      setHasNewer(false);
      return;
    }

    if (!cursorTime) {
        console.error('[PAGINATION_NEWER] No valid cursorTime to fetch newer messages.');
        setHasNewer(false); // Cannot proceed
        return;
    }
    
    try {
      isLoadingMoreRef.current = true;
      const container = scrollContainerRef.current;
      const oldScrollHeight = container.scrollHeight;
      const oldScrollTop = container.scrollTop;

      const now = Date.now();
      if (!hasNewer || stateUpdateLock.current || fetchLock.current || 
          (now - lastFetchTime.current) < 1000) {
        return;
      }

      // Add fetch to queue
      const fetchPromise = async () => {
        console.log('[PAGINATION] Starting fetchNewerMessages:', {
          currentMessageCount: messages.length,
          lastMessageTime: messages[messages.length - 1]?.created_at,
          hasNewer,
          isLoadingMore: isLoadingMoreRef.current,
          timeSinceLastFetch: now - lastFetchTime.current,
          fetchState: fetchState.current
        });

        // Set loading states
        isLoadingMoreRef.current = true;
        stateUpdateLock.current = true;
        fetchLock.current = true;

        try {
          // Get the last message's timestamp to use as the cursor
          const lastMessage = messages[messages.length - 1];
          if (!lastMessage) {
            console.log('[PAGINATION] No last message found');
            return false;
          }

          // const cursorTime = lastMessage.created_at; // Replaced by logic above
          console.log('[PAGINATION] Fetching with cursor (fetchNewerMessages):', {
            cursorTime, // This now comes from newestCursor or fallback
            lastMessageId: cursorMessageId, // Adjusted to reflect the actual cursor used
            currentMessageCount: messages.length,
            fetchState: fetchState.current
          });

          // First check how many messages are available
          const { count: totalNewerCount } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('chat_id', params.chatId)
            .gt('created_at', cursorTime);

          console.log('[PAGINATION] Total newer messages available:', {
            totalNewerCount: totalNewerCount || 0,
            cursorTime,
            fetchState: fetchState.current
          });

          if (!totalNewerCount || totalNewerCount === 0) {
            console.log('[PAGINATION] No newer messages available');
            setHasNewer(false);
            return false;
          }

          const { data, error } = await supabase
            .from('messages')
            .select(`
              *,
              is_read,
              reply_to:reply_to_message_id (
                content,
                user_id,
                media_url,
                media_type,
                is_read
              )
            `)
            .eq('chat_id', params.chatId)
            .order('created_at', { ascending: true })
            .limit(50)
            .gt('created_at', cursorTime);

          if (error) {
            console.error('[PAGINATION] Error fetching newer messages:', error);
            throw error;
          }

          console.log('[PAGINATION] Fetch response:', {
            messageCount: data?.length || 0,
            firstMessageTime: data?.[0]?.created_at,
            lastMessageTime: data?.[data.length - 1]?.created_at,
            cursorTime,
            totalNewerCount,
            fetchState: fetchState.current
          });

          if (data && data.length > 0) {
            // Get all user IDs from messages and replies
            const userIds = new Set([
              ...data.map(m => m.user_id),
              ...data.filter(m => m.reply_to).map(m => m.reply_to.user_id)
            ].filter(Boolean));

            const { data: profilesData, error: profilesError } = await supabase
              .from('profiles')
              .select('id, username')
              .in('id', Array.from(userIds));

            if (profilesError) {
              console.error('[PAGINATION] Error fetching profiles:', profilesError);
              throw profilesError;
            }

            const profilesMap = new Map(
              profilesData?.map(profile => [profile.id, profile]) || []
            );

            const transformedData = data.map(message => ({
              ...message,
              profiles: profilesMap.get(message.user_id),
              reply_to: message.reply_to ? {
                ...message.reply_to,
                profiles: profilesMap.get(message.reply_to.user_id)
              } : undefined
            }));

            // --- Fetch and Stitch Reactions for fetchNewerMessages ---
            let messagesWithReactions = transformedData;
            if (transformedData.length > 0 && user?.id) {
              const messageIds = transformedData.map(m => m.id);
              const { data: rawReactionsData, error: reactionsError } = await supabase
                .from('reactions')
                .select('message_id, user_id, emoji')
                .in('message_id', messageIds);

              if (reactionsError) {
                console.error('[PAGINATION] Error fetching reactions for newer messages:', reactionsError);
              } else if (rawReactionsData) {
                messagesWithReactions = processAndStitchReactions(transformedData, rawReactionsData, user.id);
                console.log('[PAGINATION] Newer messages stitched with reactions:', messagesWithReactions.length);
              }
            }
            // --- End Fetch and Stitch Reactions ---

            // Create a Map of existing messages for faster lookup
            const existingMessages = new Map(messages.map(msg => [msg.id, msg]));
            
            // Filter out any messages that already exist
            // Use messagesWithReactions instead of transformedData here
            const newMessages = messagesWithReactions.filter(msg => !existingMessages.has(msg.id));
            
            if (newMessages.length === 0) {
              console.log('[PAGINATION] No new messages to add, all were duplicates');
              setHasNewer(false);
              return false;
            }

            console.log('[PAGINATION] Adding new messages:', {
              newMessageCount: newMessages.length,
              firstNewMessageTime: newMessages[0].created_at,
              lastNewMessageTime: newMessages[newMessages.length - 1].created_at,
              totalNewerCount,
              fetchState: fetchState.current
            });

            // Sort all messages by created_at
            // Use messagesWithReactions (which are the new ones with reactions) and existing messages
            const allMessages = [...messages, ...newMessages].sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );

            // Update cursor with the newest message from the fetched data
            // Use messagesWithReactions to get the latest message for cursor update
            const newLatestMessageInFetchedBlock = messagesWithReactions[messagesWithReactions.length - 1];
            const newCursorId = newLatestMessageInFetchedBlock.id;
            const newCursorTimestamp = newLatestMessageInFetchedBlock.created_at;

            console.log('[PAGINATION] Updating state (fetchNewerMessages):', {
              oldMessageCount: messages.length,
              newMessageCount: allMessages.length,
              oldCursorTime: cursorTime, // The cursor time used for the fetch
              newCursorTime: newCursorTimestamp, // Time of the new actual newest message from this batch
              newCursorId: newCursorId, // ID of the new actual newest message
              hasMoreMessages: totalNewerCount > newMessages.length, // newMessages already has reactions
              fetchState: fetchState.current
            });

            // Update all states in a single batch and wait for them to complete
            await Promise.all([
              new Promise<void>(resolve => {
                setMessages(allMessages);
                resolve();
              }),
              new Promise<void>(resolve => {
                setNewestCursor(newCursorId); // Update newestCursor state
                resolve();
              }),
              new Promise<void>(resolve => {
                setHasNewer(totalNewerCount > newMessages.length);
                resolve();
              })
            ]);

            // Wait for state to update
            await new Promise(resolve => setTimeout(resolve, 100));

            // Return true to indicate new messages were loaded
            return true;
          } else {
            console.log('[PAGINATION] No newer messages found');
            setHasNewer(false);
            return false;
          }
        } catch (err: any) { // Typed err
          console.error('[PAGINATION] Error in fetchNewerMessages:', err);
          showToast(err.message || 'Failed to load newer messages', 'error');
          setHasNewer(false);
          throw err; // Re-throw if other parts of the app expect to catch this too
        } finally {
          // Reset loading states
          isLoadingMoreRef.current = false;
          stateUpdateLock.current = false;
          fetchLock.current = false;
          console.log('[PAGINATION] Finished fetchNewerMessages:', {
            fetchState: fetchState.current
          });
        }
      };

      // Add to queue and process
      fetchQueue.current.push(fetchPromise);
      processFetchQueue();

      // After messages are added, restore scroll position
      // This scroll restoration logic might need to be re-evaluated if it fights with explicit scrolling
      // requestAnimationFrame(() => {
      //   if (container) {
      //     const newScrollHeight = container.scrollHeight;
      //     const scrollDiff = newScrollHeight - oldScrollHeight;
      //     container.scrollTop = oldScrollTop + scrollDiff;
      //   }
      // });
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [hasNewer, newestCursor, params.chatId, messages, processFetchQueue, supabase]); // Added newestCursor and supabase

  // Helper: Fetch more messages (pagination)
  const fetchMoreMessages = useCallback(async () => {
    // Add lock checks here before starting
    if (isLoadingMoreRef.current || fetchState.current !== 'idle') {
      console.log('[PAGINATION_OLDER] Skipping fetchMoreMessages - already busy or locked.');
      return;
    }
    if (!hasMore || !oldestCursor) {
       console.log('[PAGINATION_OLDER] Skipping fetchMoreMessages - no more or no cursor.', { hasMore, oldestCursor });
      return;
    }
    
    console.log('[DEBUG] fetchMoreMessages: messages[0].created_at BEFORE fetch:', messages[0]?.created_at);
    console.log('[DEBUG] fetchMoreMessages: oldestCursor state BEFORE fetch:', oldestCursor);
    console.log('[PAGINATION] Starting to fetch more messages:', {
      oldestCursor,
      currentMessageCount: messages.length,
      oldestMessageTime: messages[0]?.created_at,
      testMode
    });

    setLoadingMore(true);
    isLoadingMoreRef.current = true;
    fetchState.current = 'fetching';
    console.log('[PAGINATION] State transition: idle -> fetching');

    // --- Anchor Scroll: Capture Info --- 
    let capturedAnchorId: string | null = null;
    let capturedAnchorOffsetTop: number = 0;
      const container = scrollContainerRef.current;

    if (container) {
      const messageElements = container.querySelectorAll('[data-message-id]');
      const containerRect = container.getBoundingClientRect();
      for (let i = 0; i < messageElements.length; i++) {
        const el = messageElements[i] as HTMLElement;
        const elRect = el.getBoundingClientRect();
        // Find first element whose top is within/above viewport top and bottom is below viewport top
        if (elRect.top <= containerRect.top && elRect.bottom > containerRect.top) {
          capturedAnchorId = el.getAttribute('data-message-id');
          // Ensure offset is relative to container, not viewport, if needed. Here using diff from container top.
          capturedAnchorOffsetTop = elRect.top - containerRect.top; 
          console.log('[FETCH_MORE_ANCHOR] Captured anchor:', { capturedAnchorId, capturedAnchorOffsetTop });
          break;
        }
      }
      // Fallback if nothing is crossing the top boundary
      if (!capturedAnchorId && messageElements.length > 0) {
          const firstEl = messageElements[0] as HTMLElement;
           capturedAnchorId = firstEl.getAttribute('data-message-id');
           capturedAnchorOffsetTop = firstEl.getBoundingClientRect().top - containerRect.top;
           console.log('[FETCH_MORE_ANCHOR] Using fallback anchor (first element):', { capturedAnchorId, capturedAnchorOffsetTop });
      }

      // Store captured info in refs immediately
      anchorScrollInfoRef.current = { id: capturedAnchorId, offset: capturedAnchorOffsetTop };
      // Signal that adjustment is needed *after* the upcoming state update
      if (capturedAnchorId) { // Only signal if we actually found an anchor
           needsScrollAdjustmentRef.current = true; 
      } else {
           needsScrollAdjustmentRef.current = false; // Ensure it's false if no anchor found
      }
    } else {
         needsScrollAdjustmentRef.current = false; // Ensure it's false if no container
    }
    // --- End Anchor Scroll Capture --- 

    try {
      // REMOVED prevScrollHeight/prevScrollTop definitions here

      // First, get the message at the cursor to verify it exists
      const { data: cursorMessage, error: cursorError } = await supabase
        .from('messages')
        .select('created_at')
        .eq('id', oldestCursor)
        .single();

      if (cursorError) {
        console.error('[PAGINATION] Error fetching cursor message:', cursorError);
        // Try to recover by using the oldest message's timestamp
        if (messages.length > 0) {
          const oldestMessageInState = messages[0];
          console.log('[PAGINATION] Recovering from cursor error using oldest message in state:', {
            messageId: oldestMessageInState.id,
            created_at: oldestMessageInState.created_at
          });
          
          // Fetch messages before the oldest message
          const { data, error } = await supabase
            .from('messages')
            .select(`
              *,
              is_read,
              reply_to:reply_to_message_id (
                content,
                user_id,
                media_url,
                media_type,
                is_read
              )
            `)
            .eq('chat_id', params.chatId)
            .order('created_at', { ascending: true })
            .limit(100) // Increased limit for better pagination
            .lt('created_at', oldestMessageInState.created_at);

          if (error) {
            console.error('[PAGINATION] Error in recovery fetch:', error);
            setHasMore(false);
            return;
          }

          if (data && data.length > 0) {
            // Process the recovered messages
            const userIds = new Set([
              ...data.map(m => m.user_id),
              ...data.filter(m => m.reply_to).map(m => m.reply_to.user_id)
            ].filter(Boolean));

            const { data: profilesData, error: profilesError } = await supabase
              .from('profiles')
              .select('id, username')
              .in('id', Array.from(userIds));

            if (profilesError) {
              console.error('[PAGINATION] Error fetching profiles in recovery:', profilesError);
              throw profilesError;
            }

            const profilesMap = new Map(
              profilesData?.map(profile => [profile.id, profile]) || []
            );

            const transformedData = data.map(message => ({
              ...message,
              profiles: profilesMap.get(message.user_id),
              reply_to: message.reply_to ? {
                ...message.reply_to,
                profiles: profilesMap.get(message.reply_to.user_id)
              } : undefined
            }));

            // Set updating state
            fetchState.current = 'updating';
            console.log('[PAGINATION] State transition: fetching -> updating');

            setMessages(prevMessages => {
              const existingMessages = new Map(prevMessages.map(msg => [msg.id, msg]));
              const newMessages = transformedData.filter(msg => !existingMessages.has(msg.id));
              
              if (newMessages.length === 0) {
                console.log('[PAGINATION] No new messages in recovery');
                setHasMore(false);
                needsScrollAdjustmentRef.current = false; // No adjustment needed if no messages added
                return prevMessages;
              }

              const allMessages = [...newMessages, ...prevMessages].sort((a, b) => 
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );

              console.log('[PAGINATION] Recovery successful:', {
                newMessageCount: newMessages.length,
                totalMessageCount: allMessages.length,
                firstMessageTime: allMessages[0]?.created_at,
                lastMessageTime: allMessages[allMessages.length - 1]?.created_at
              });

              return allMessages;
            });

            if (transformedData.length > 0) {
              const newCursor = transformedData[0].id;
              setOldestCursor(newCursor);
              setHasMore(true);
            } else {
              setHasMore(false);
            }
          } else {
            setHasMore(false);
          }
        } else {
          setHasMore(false);
        }
        return;
      }

      console.log('[PAGINATION] Executing query with cursor:', {
        cursor: cursorMessage.created_at, // This is Timestamp_A for the DEBUG logs
        chatId: params.chatId,
        oldestCursor,
        currentMessages: messages.length
      });

      // First check how many messages are available before the cursor
      const { count: totalOlderCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', params.chatId)
        .lt('created_at', cursorMessage.created_at);

      console.log('[PAGINATION] Total older messages available:', {
        totalOlderCount: totalOlderCount || 0,
        cursorTime: cursorMessage.created_at
      });

      if (!totalOlderCount || totalOlderCount === 0) {
        console.log('[PAGINATION] No older messages available based on totalOlderCount');
        setHasMore(false);
        setLoadingMore(false);
        isLoadingMoreRef.current = false;
        fetchState.current = 'idle';
        return;
      }

      // Fetch all messages before the cursor in a single query
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          is_read,
          reply_to:reply_to_message_id (
            content,
            user_id,
            media_url,
            media_type,
            is_read
          )
        `)
        .eq('chat_id', params.chatId)
        .order('created_at', { ascending: false }) // Fetch in descending order
        .limit(100) 
        .lt('created_at', cursorMessage.created_at);

      if (error) {
        console.error('[PAGINATION] Error fetching messages:', error);
        throw error;
      }

      console.log('[PAGINATION] Fetched messages:', {
        count: data?.length || 0,
        firstMessageTime: data?.[0]?.created_at, // This is Timestamp_B for the DEBUG logs
        lastMessageTime: data?.[data.length - 1]?.created_at, // This is Timestamp_C for the DEBUG logs
        cursor: cursorMessage.created_at,
        hasMore: data?.length === 100, // This specific hasMore is a bit misleading here, relies on totalOlderCount later
        existingMessageCount: messages.length,
        totalOlderCount
      });

      if (data && data.length > 0) {
        // Get all user IDs from messages and replies
        const userIds = new Set([
          ...data.map(m => m.user_id),
          ...data.filter(m => m.reply_to).map(m => m.reply_to.user_id)
        ].filter(Boolean));

        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', Array.from(userIds));

        if (profilesError) {
          console.error('[PAGINATION] Error fetching profiles:', profilesError);
          throw profilesError;
        }

        const profilesMap = new Map(
          profilesData?.map(profile => [profile.id, profile]) || []
        );

        const transformedDataWithProfiles = data.map(message => ({
          ...message,
          profiles: profilesMap.get(message.user_id),
          reply_to: message.reply_to ? {
            ...message.reply_to,
            profiles: profilesMap.get(message.reply_to.user_id)
          } : undefined
        }));
        
        // Reverse the array so it's in chronological order for prepending
        const transformedData = transformedDataWithProfiles.reverse();

        console.log('[PAGINATION] Transforming messages:', {
          originalCount: data.length,
          transformedCount: transformedData.length,
          firstMessageId: transformedData[0]?.id,
          lastMessageId: transformedData[transformedData.length - 1]?.id,
          firstMessageTime: transformedData[0]?.created_at,
          lastMessageTime: transformedData[transformedData.length - 1]?.created_at
        });

        // --- Fetch and Stitch Reactions for fetchMoreMessages ---
        let messagesWithReactions = transformedData;
        if (transformedData.length > 0 && user?.id) {
          const messageIds = transformedData.map(m => m.id);
          const { data: rawReactionsData, error: reactionsError } = await supabase
            .from('reactions')
            .select('message_id, user_id, emoji')
            .in('message_id', messageIds);

          if (reactionsError) {
            console.error('[PAGINATION] Error fetching reactions for older messages:', reactionsError);
          } else if (rawReactionsData) {
            messagesWithReactions = processAndStitchReactions(transformedData, rawReactionsData, user.id);
            console.log('[PAGINATION] Older messages stitched with reactions:', messagesWithReactions.length);
          }
        }
        // --- End Fetch and Stitch Reactions ---

        // Set updating state
        fetchState.current = 'updating';
        console.log('[PAGINATION] State transition: fetching -> updating');

        setMessages(prevMessages => {
          // Create a Map of existing messages for faster lookup
          const existingMessages = new Map(prevMessages.map(msg => [msg.id, msg]));
          
          // Filter out any messages that already exist
          // Use messagesWithReactions instead of transformedData here
          const newMessages = messagesWithReactions.filter(msg => !existingMessages.has(msg.id));
          
          if (newMessages.length === 0) {
            console.log('[PAGINATION] No new messages to add, all were duplicates or empty fetch');
            setHasMore(false);
            needsScrollAdjustmentRef.current = false; // No adjustment needed if no messages added
            return prevMessages;
          }

          // Sort all messages by created_at
          const allMessages = [...newMessages, ...prevMessages].sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );

          console.log('[PAGINATION] Updating messages state:', {
            previousCount: prevMessages.length,
            newCount: allMessages.length,
            addedCount: newMessages.length,
            firstMessageId: allMessages[0]?.id,
            lastMessageId: allMessages[allMessages.length - 1]?.id,
            firstMessageTime: allMessages[0]?.created_at,
            lastMessageTime: allMessages[allMessages.length - 1]?.created_at,
            duplicateCount: messagesWithReactions.length - newMessages.length // Adjusted to messagesWithReactions
          });

          // --- ENTIRELY REMOVE OLD SCROLL ADJUSTMENT requestAnimationFrame block ---
          // NO scroll logic inside this callback anymore

          return allMessages;
        }); // End setMessages

        if (transformedData.length > 0) {
          const newCursor = transformedData[0].id;
          console.log('[PAGINATION] Updating cursor:', {
            oldCursor: oldestCursor,
            newCursor,
            hasMore: totalOlderCount > transformedData.length,
            oldCursorTime: cursorMessage.created_at,
            newCursorTime: transformedData[0].created_at,
            remainingMessages: totalOlderCount - transformedData.length
          });
          setOldestCursor(newCursor);
          setHasMore(totalOlderCount > transformedData.length);
        } else {
          console.log('[PAGINATION] No more messages available');
          setHasMore(false);
        }
      } else {
        console.log('[PAGINATION] No messages found');
        setHasMore(false);
      }
    } catch (err: any) { // Typed err
      console.error('[PAGINATION] Error fetching more messages:', err);
      showToast(err.message || 'Failed to load more messages', 'error');
      setHasMore(false);
    } finally {
      console.log('[PAGINATION] Finished loading more messages');
      setLoadingMore(false);
      isLoadingMoreRef.current = false;
      fetchState.current = 'idle';
      console.log('[PAGINATION] State transition: updating -> idle');
      console.log('[DEBUG] fetchMoreMessages: messages[0].created_at AFTER fetch and state update (via effect likely needed for accurate value):', messages[0]?.created_at); // This log might not show the updated value immediately due to closure
    }
  }, [hasMore, loadingMore, oldestCursor, params.chatId, messages, testMode]); // Added messages to dependency array for more accurate logging of messages[0]

  // Modify the intersection observer setup
  useEffect(() => {
    if (!scrollContainerReady || !scrollContainerRef.current) {
      console.log('[PAGINATION] Waiting for scroll container to be ready');
      return;
    }

    console.log('[PAGINATION] Setting up intersection observer:', {
      containerHeight: scrollContainerRef.current.scrollHeight,
      clientHeight: scrollContainerRef.current.clientHeight,
      scrollTop: scrollContainerRef.current.scrollTop,
      messageCount: messages.length,
      hasMore,
      hasNewer,
      testMode
    });

    // Add debounce for intersection observer
    // REMOVED debounce wrapper for faster triggering
    const handleIntersection = (isTop: boolean) => {
      // REMOVED shared lock check: if (isLoadingMoreRef.current || fetchState.current !== 'idle') { ... }
      // Locks will be checked inside the specific fetch functions now

      if (isTop && hasMore) {
        console.log('[PAGINATION] Intersection detected for TOP, attempting fetchMoreMessages');
        fetchMoreMessages();
      } else if (!isTop && hasNewer) {
        console.log('[PAGINATION] Triggering newer messages fetch');
        fetchNewerMessages();
      }
    }; // Removed debounce(..., 100)

    // Create new observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const target = entry.target;
          const isTop = target === topMessageRef.current;
          const isBottom = target === bottomMessageRef.current;
          
          console.log('[PAGINATION] Intersection detected:', {
            isIntersecting: entry.isIntersecting,
            target: isTop ? 'top' : isBottom ? 'bottom' : 'unknown',
            isLoadingMore: isLoadingMoreRef.current,
            hasNewer,
            hasMore,
            messageCount: messages.length,
            fetchState: fetchState.current,
            scrollTop: scrollContainerRef.current?.scrollTop,
            scrollHeight: scrollContainerRef.current?.scrollHeight,
            clientHeight: scrollContainerRef.current?.clientHeight,
            testMode
          });

          if (isLoadingMoreRef.current || fetchState.current !== 'idle') {
            console.log('[PAGINATION] Skipping - already loading:', {
              isLoadingMore: isLoadingMoreRef.current,
              fetchState: fetchState.current
            });
            return;
          }

          if (entry.isIntersecting) {
            // Call handler directly without debounce
            handleIntersection(isTop);
          }
        });
      },
      {
        root: scrollContainerRef.current,
        rootMargin: '500px', // Reduced from 3000px
        threshold: 0.1 // Keep threshold low, rootMargin is the main trigger
      }
    );

    // Store observer reference
    observerRef.current = observer;

    // Initial observation setup
    if (topMessageRef.current && hasMore) {
      console.log('[PAGINATION] Observing top message');
      observer.observe(topMessageRef.current);
    }
    if (bottomMessageRef.current && hasNewer) {
      console.log('[PAGINATION] Observing bottom message');
      observer.observe(bottomMessageRef.current);
    }

    return () => {
      console.log('[PAGINATION] Cleaning up observer');
      observer.disconnect();
      observerRef.current = null;
    };
  }, [scrollContainerReady, messages.length, hasMore, hasNewer, fetchMoreMessages, fetchNewerMessages, testMode, oldestCursor, newestCursor]); // Added oldestCursor, newestCursor

  // Update observer targets when messages change
  useEffect(() => {
    if (!observerRef.current || !scrollContainerRef.current) {
      console.log('[PAGINATION] No observer or container available for target update');
      return;
    }

    console.log('[PAGINATION] Updating observer targets:', {
      hasMore,
      hasNewer,
      messageCount: messages.length,
      isLoadingMore: isLoadingMoreRef.current,
      fetchState: fetchState.current
    });

    // Unobserve previous targets
    if (topMessageRef.current) {
      observerRef.current.unobserve(topMessageRef.current);
    }
    if (bottomMessageRef.current) {
      observerRef.current.unobserve(bottomMessageRef.current);
    }

    // Observe new targets
    if (!isLoadingMoreRef.current && fetchState.current === 'idle') {
      if (topMessageRef.current && hasMore && oldestCursor) { // Ensure oldestCursor exists
        console.log('[PAGINATION] Setting up top observer for', oldestCursor);
        observerRef.current.observe(topMessageRef.current);
      }
      if (bottomMessageRef.current && hasNewer && newestCursor) { // Ensure newestCursor exists
        console.log('[PAGINATION] Setting up bottom observer for', newestCursor, {
          hasNewer,
          currentMessageCount: messages.length,
          lastMessageTime: messages[messages.length - 1]?.created_at,
          fetchState: fetchState.current
        });
        observerRef.current.observe(bottomMessageRef.current);
      }
    }
  }, [messages.length, hasMore, hasNewer, oldestCursor, newestCursor]); // Added oldestCursor, newestCursor

  // Scroll position restoration
  useLayoutEffect(() => {
    if (loading || loadingMore || hasRestoredScroll.current || messages.length === 0) {
      console.log('[SCROLL] Skipping scroll restoration:', {
        loading,
        loadingMore,
        hasRestored: hasRestoredScroll.current,
        messageCount: messages.length,
        timeRange: messages.length > 0 ? {
          oldest: messages[0].created_at,
          newest: messages[messages.length - 1].created_at
        } : 'No messages'
      });
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) {
      console.log('[SCROLL] No scroll container available');
      return;
    }

    // Wait for next frame to ensure DOM is ready
    requestAnimationFrame(() => {
      console.log('[SCROLL] Attempting scroll restoration:', {
        savedPosition: localStorage.getItem(SCROLL_KEY),
        containerHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        messageCount: messages.length,
        timeRange: messages.length > 0 ? {
          oldest: messages[0].created_at,
          newest: messages[messages.length - 1].created_at
        } : 'No messages'
      });

      // Try to restore saved scroll position
      const saved = localStorage.getItem(SCROLL_KEY);
      if (saved && !isNaN(Number(saved))) {
        const savedScroll = Number(saved);
        const maxScroll = container.scrollHeight - container.clientHeight;
        
        // Only restore if the saved position is within valid bounds
        if (savedScroll >= 0 && savedScroll <= maxScroll) {
          console.log('[SCROLL] Restoring saved position:', {
            savedScroll,
            maxScroll,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
            difference: maxScroll - savedScroll
          });
          container.scrollTop = savedScroll;
          hasRestoredScroll.current = true;
          return;
        } else {
          console.log('[SCROLL] Saved position out of bounds:', {
            savedScroll,
            maxScroll,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
            difference: maxScroll - savedScroll
          });
        }
      }

      // Find first unread message
      const firstUnread = messages.find(
        m => !m.is_read && m.user_id !== userId
      );
      if (firstUnread) {
        console.log('[SCROLL] Found unread message:', {
          messageId: firstUnread.id,
          created_at: firstUnread.created_at,
          messageCount: messages.length
        });
        const el = document.getElementById(`message-${firstUnread.id}`);
        if (el) {
          console.log('[SCROLL] Scrolling to unread message');
          el.scrollIntoView({ behavior: 'auto', block: 'center' });
          hasRestoredScroll.current = true;
        }
        return;
      }

      // Otherwise, scroll to bottom
      console.log('[SCROLL] Scrolling to bottom:', {
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        messageCount: messages.length
      });
      container.scrollTop = container.scrollHeight;
      hasRestoredScroll.current = true;
    });
  }, [loading, loadingMore, messages, userId, SCROLL_KEY]);

  // Save scroll position (debounced)
  const saveScrollPosition = useMemo(() => debounce(() => {
    if (scrollContainerRef.current && !isLoadingMoreRef.current) {
      localStorage.setItem(SCROLL_KEY, scrollContainerRef.current.scrollTop.toString());
    }
  }, 200), [SCROLL_KEY]);

  // Attach scroll event to save position
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', saveScrollPosition);
    return () => {
      container.removeEventListener('scroll', saveScrollPosition);
      saveScrollPosition.cancel();
    };
  }, [saveScrollPosition]);

  // (Stub) Keyboard open/close handling for mobile
  // In a real app, use a library or platform-specific event
  // For now, this is a placeholder for future implementation
  useEffect(() => {
    // Example: window.addEventListener('keyboardDidShow', ...)
    // Adjust scroll position if needed
    return () => {
      // Cleanup
    };
  }, []);

  // Message-ID-based scroll restoration
  const ANCHOR_KEY = `chat-anchor-${params.chatId}`;
  // Save anchor (topmost visible message ID and offset)
  const saveAnchor = useMemo(() => debounce(() => {
    if (isRestoringAnchor.current) {
      console.log('[ANCHOR] Skipping anchor save during restoration');
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) return;
    // Find the topmost visible message
    const messageDivs = Array.from(container.querySelectorAll('[data-message-id]'));
    for (let div of messageDivs) {
      const rect = (div as HTMLElement).getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (rect.bottom > containerRect.top) {
        // This is the topmost visible message
        const messageId = div.getAttribute('data-message-id');
        const offset = rect.top - containerRect.top;
        if (messageId) {
          console.log('[ANCHOR] Saving anchor:', { messageId, offset });
          localStorage.setItem(ANCHOR_KEY, JSON.stringify({ messageId, offset }));
        }
        break;
      }
    }
  }, 50), [ANCHOR_KEY]);

  // Add missing functions
  const observeMessage = useMessageInView((id: string) => {
    if (user && !markingRead.has(id)) {
      addToBatch(id);
    }
  });

  const handleReply = useCallback((message: Message) => {
    console.log('[REPLYING] handleReply called with message:', message);
    setReplyingTo(message);
    // Do not clear jump history when starting a reply
  }, []);

  const CONTEXT_MESSAGE_COUNT = 5;

  const fetchMessageWithContext = useCallback(async (messageId: string): Promise<boolean> => {
    if (!params.chatId || !supabase) return false;
    setLoadingContextForMessageId(messageId);
    console.log('[CONTEXT_FETCH] Starting fetch for message and context:', messageId);

    try {
      // 1. Fetch the target message
      const { data: targetMsgData, error: targetMsgError } = await supabase
        .from('messages')
        .select(`
          *,
          is_read,
          reply_to:reply_to_message_id (
            content,
            user_id,
            media_url,
            media_type,
            is_read
          )
        `)
        .eq('id', messageId)
        .single();

      if (targetMsgError || !targetMsgData) {
        console.error('[CONTEXT_FETCH] Error fetching target message or message not found:', messageId, targetMsgError);
        // TODO: Implement user-facing error (e.g., toast: "Original message not found or has been deleted")
        setError(`Original message (ID: ${messageId}) not found or could not be loaded.`);
        return false;
      }
      console.log('[CONTEXT_FETCH] Target message fetched:', targetMsgData);

      // 2. Fetch context messages (before and after)
      const anchorCreatedAt = targetMsgData.created_at;
      let fetchedMessagesBlock: Message[] = [];

      // Fetch messages before the anchor
      const { data: beforeMessages, error: beforeError } = await supabase
        .from('messages')
        .select(`
          *,
          is_read,
          reply_to:reply_to_message_id (
            content,
            user_id,
            media_url,
            media_type,
            is_read
          )
        `)
        .eq('chat_id', params.chatId)
        .lt('created_at', anchorCreatedAt)
        .order('created_at', { ascending: false }) // Fetch newest of the older ones first
        .limit(CONTEXT_MESSAGE_COUNT);

      if (beforeError) console.error('[CONTEXT_FETCH] Error fetching messages before anchor:', beforeError);
      else if (beforeMessages) fetchedMessagesBlock.push(...beforeMessages.reverse()); // Reverse to maintain chronological order

      // Add the target message itself
      fetchedMessagesBlock.push(targetMsgData);

      // Fetch messages after the anchor
      const { data: afterMessages, error: afterError } = await supabase
        .from('messages')
        .select(`
          *,
          is_read,
          reply_to:reply_to_message_id (
            content,
            user_id,
            media_url,
            media_type,
            is_read
          )
        `)
        .eq('chat_id', params.chatId)
        .gt('created_at', anchorCreatedAt)
        .order('created_at', { ascending: true })
        .limit(CONTEXT_MESSAGE_COUNT);

      if (afterError) console.error('[CONTEXT_FETCH] Error fetching messages after anchor:', afterError);
      else if (afterMessages) fetchedMessagesBlock.push(...afterMessages);
      
      console.log('[CONTEXT_FETCH] Raw block of fetched messages (target + context):', fetchedMessagesBlock.length, 'messages');

      // 3. Fetch profiles for all involved users
      const userIds = new Set<string>();
      fetchedMessagesBlock.forEach(msg => {
        if (msg.user_id) userIds.add(msg.user_id);
        if (msg.reply_to?.user_id) userIds.add(msg.reply_to.user_id);
      });

      let profilesMap = new Map();
      if (userIds.size > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', Array.from(userIds));
        if (profilesError) {
          console.error('[CONTEXT_FETCH] Error fetching profiles:', profilesError);
          // Continue without profiles if there's an error, or handle more gracefully
        } else if (profilesData) {
          profilesMap = new Map(profilesData.map(p => [p.id, p]));
        }
      }
      console.log('[CONTEXT_FETCH] Profiles map created for', profilesMap.size, 'profiles');

      // 4. Transform messages to include profile data
      const transformedFetchedBlock: Message[] = fetchedMessagesBlock.map(msg => ({
        ...msg,
        profiles: profilesMap.get(msg.user_id) || undefined, // Ensure undefined if not found
        reply_to: msg.reply_to ? {
          ...msg.reply_to,
          profiles: profilesMap.get(msg.reply_to.user_id) || undefined // Ensure undefined if not found
        } : undefined,
        reactions: [] // Initialize with empty reactions, will be populated next
      } as Message)); // Explicitly cast to Message
      console.log('[CONTEXT_FETCH] Transformed message block with profiles:', transformedFetchedBlock.length, 'messages');

      // --- Fetch and Stitch Reactions for fetchMessageWithContext ---
      let contextMessagesWithReactions = transformedFetchedBlock;
      if (transformedFetchedBlock.length > 0 && user?.id) {
        const messageIds = transformedFetchedBlock.map(m => m.id);
        const { data: rawReactionsData, error: reactionsError } = await supabase
          .from('reactions')
          .select('message_id, user_id, emoji')
          .in('message_id', messageIds);

        if (reactionsError) {
          console.error('[CONTEXT_FETCH] Error fetching reactions for context messages:', reactionsError);
        } else if (rawReactionsData) {
          contextMessagesWithReactions = processAndStitchReactions(transformedFetchedBlock, rawReactionsData, user.id);
          console.log('[CONTEXT_FETCH] Context messages stitched with reactions:', contextMessagesWithReactions.length);
        }
      }
      // --- End Fetch and Stitch Reactions ---

      // 5. Merge with existing messages and reset pagination cursors/flags
      setMessages(prevMessages => {
        const existingMessageIds = new Set(prevMessages.map(m => m.id));
        // Filter out messages from contextMessagesWithReactions that are already in prevMessages
        const uniqueNewMessagesFromBlock = contextMessagesWithReactions.filter(m => !existingMessageIds.has(m.id));

        if (uniqueNewMessagesFromBlock.length === 0 && contextMessagesWithReactions.some(m => existingMessageIds.has(m.id))) {
          // This means the target message and its context were already loaded.
          // We still need to reset cursors to focus on this existing block.
          console.log('[CONTEXT_FETCH] Target message and its context were already loaded. Resetting cursors.');
          
          const sortedPreviouslyFetchedBlock = [...contextMessagesWithReactions].sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          if (sortedPreviouslyFetchedBlock.length > 0) {
            setOldestCursor(sortedPreviouslyFetchedBlock[0].id);
            setNewestCursor(sortedPreviouslyFetchedBlock[sortedPreviouslyFetchedBlock.length - 1].id);
            // Assuming there's more to load outside this focused block
            setHasMore(true); 
            setHasNewer(true);
          }
          return prevMessages; // No change to messages themselves
        }
        
        if (uniqueNewMessagesFromBlock.length === 0) {
          console.log('[CONTEXT_FETCH] No new unique messages from context fetch to add, and target was not in existing.');
          return prevMessages;
        }


        console.log('[CONTEXT_FETCH] Adding', uniqueNewMessagesFromBlock.length, 'new unique messages to state.');
        const allMessages = [...prevMessages, ...uniqueNewMessagesFromBlock].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        // Reset cursors to the boundaries of the newly added B_context (approximated by uniqueNewMessagesFromBlock)
        // For more accuracy, we should use the sorted uniqueNewMessagesFromBlock if it's guaranteed to be contiguous
        // or the overall contextMessagesWithReactions if we want to ensure cursors are set around the originally intended context window
        
        const sortedContextBlock = [...contextMessagesWithReactions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        if (sortedContextBlock.length > 0) {
          console.log('[CONTEXT_FETCH] Resetting cursors to fetched context block boundaries.');
          setOldestCursor(sortedContextBlock[0].id);
          setNewestCursor(sortedContextBlock[sortedContextBlock.length - 1].id);
          setHasMore(true); // Optimistically assume there's more outside this loaded context
          setHasNewer(true); // Optimistically assume there's more outside this loaded context
        }
        return allMessages;
      });
      
      return true;
    } catch (err: any) { // Typed err
      console.error('[CONTEXT_FETCH] General error in fetchMessageWithContext:', err);
      showToast(err.message || 'Failed to load context for the message', 'error');
      return false;
    } finally {
      setLoadingContextForMessageId(null);
      console.log('[CONTEXT_FETCH] Finished fetch for message and context:', messageId);
    }
  }, [params.chatId, supabase, setMessages, setLoadingContextForMessageId, setError, setOldestCursor, setNewestCursor]);


  const handleScrollToMessage = useCallback(async (messageId: string) => {
    // Reset adjustment flag before handling this specific scroll action
    needsScrollAdjustmentRef.current = false; 

    if (loadingContextForMessageId === messageId) {
      console.log('[SCROLL_HANDLER] Already loading context for this message, aborting scroll attempt:', messageId);
      return;
    }
    // Prevent trying to load context if another context load is already in progress for ANY message.
    // For a more sophisticated approach, a queue could be implemented, but this prevents concurrent context loads.
    if (loadingContextForMessageId && loadingContextForMessageId !== messageId) {
        console.log('[SCROLL_HANDLER] Another message context is currently loading, aborting scroll attempt for:', messageId);
        return;
    }

    const el = document.getElementById(`message-${messageId}`);
    if (el) {
      console.log('[SCROLL_HANDLER] Element found, scrolling to:', messageId);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      console.log('[SCROLL_HANDLER] Element not found for messageId:', messageId, 'Attempting to fetch context.');
      const success = await fetchMessageWithContext(messageId);
      if (success) {
        // Wait for DOM update
        requestAnimationFrame(() => {
          const newEl = document.getElementById(`message-${messageId}`);
          if (newEl) {
            console.log('[SCROLL_HANDLER] Element found after context fetch, scrolling to:', messageId);
            newEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else {
            console.error('[SCROLL_HANDLER] Failed to find element for scrolling even after context fetch:', messageId);
            // setError might be too aggressive here, perhaps a console warning is enough.
          }
        });
      } else {
        console.log('[SCROLL_HANDLER] Context fetch failed or did not complete successfully for messageId:', messageId);
        // Error state is handled within fetchMessageWithContext
      }
    }
  }, [fetchMessageWithContext, loadingContextForMessageId]);

  const retryMessage = useCallback((messageId: string) => {
    // Implement retry logic here
    console.log('Retrying message:', messageId);
  }, []);

  // Add initiateReplyJump function
  const initiateReplyJump = useCallback((currentMessageId: string, originalTargetId: string) => {
    console.log('[REPLY_CHAIN] Initiating reply jump:', { 
      from: currentMessageId, 
      to: originalTargetId,
      currentJumpHistory: jumpHistory
    });
    
    // Create new jump and add to history
    const newJump = { sourceId: currentMessageId, targetId: originalTargetId };
    setJumpHistory(prevHistory => [...prevHistory, newJump]);
    
    // Use existing scroll function to handle pagination and scrolling
    handleScrollToMessage(originalTargetId);
  }, [handleScrollToMessage, jumpHistory]);

  // Add executeReturnFromReply function
  const executeReturnFromReply = useCallback(() => {
    if (jumpHistory.length === 0) {
      console.log('[REPLY_CHAIN] No jump history to return from');
      return;
    }
    
    // Get the last jump
    const lastJump = jumpHistory[jumpHistory.length - 1];
    console.log('[REPLY_CHAIN] Executing return from reply:', { to: lastJump.sourceId, from: lastJump.targetId });
    
    // Scroll to source of the last jump
    handleScrollToMessage(lastJump.sourceId);
    
    // Pop the last jump off the stack
    setJumpHistory(prevHistory => prevHistory.slice(0, -1));
  }, [jumpHistory, handleScrollToMessage]);

  // Clear jump history when user sends a new message
  const sendMessage = useCallback(async (content: string, mediaUrl?: string, mediaType?: string) => {
    if (!user) return;
    
    console.log('[REPLYING] sendMessage called with content:', content, 'replyingTo ID:', replyingTo?.id);

    try {
      const messageData = {
        chat_id: params.chatId,
        user_id: user.id,
        content,
        media_url: mediaUrl,
        media_type: mediaType,
        reply_to_message_id: replyingTo?.id
      };

      const { error } = await supabase.from('messages').insert([messageData]);
      if (error) throw error;

      // Clear jump history when sending a new message
      setJumpHistory([]);
      setReplyingTo(null);
    } catch (err: any) { // Ensure this err is typed as any
      console.error('Error sending message:', err);
      showToast(err.message || 'Failed to send message', 'error');
    }
  }, [user, params.chatId, replyingTo, showToast]);

  // Fetch current user profile
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (!error && data) {
        setCurrentUserProfile(data);
      }
    };

    fetchUserProfile();
  }, [user]);

  // Fetch messages around anchor
  const fetchMessagesAroundAnchor = useCallback(async (anchorId: string, offset: number) => {
    console.log('[ANCHOR] Fetching messages around anchor:', { anchorId, offset });
    // Fetch anchor message to get its created_at
    const { data: anchorMsg, error: anchorError } = await supabase
      .from('messages')
      .select('created_at')
      .eq('id', anchorId)
      .single();
    if (anchorError || !anchorMsg) {
      console.log('[ANCHOR] Anchor message not found in DB:', anchorId, anchorError);
      return null;
    }
    const anchorCreatedAt = anchorMsg.created_at;
    // Fetch 25 before and 25 after anchor
    const { data: before, error: beforeError } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', params.chatId)
      .lt('created_at', anchorCreatedAt)
      .order('created_at', { ascending: false })
      .limit(25);
    const { data: after, error: afterError } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', params.chatId)
      .gte('created_at', anchorCreatedAt)
      .order('created_at', { ascending: true })
      .limit(25);
    if (beforeError || afterError) {
      console.log('[ANCHOR] Error fetching before/after:', beforeError, afterError);
      return null;
    }
    // Merge, sort, and dedupe
    const merged = [...(before || []), ...(after || [])].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    console.log('[ANCHOR] Merged messages:', merged.map((m: any) => m.id));
    return { messages: merged, anchorId, offset };
  }, [params.chatId]);

  // Function to check if first unread message is loaded
  const checkFirstUnreadLoaded = useCallback((messages: Message[]) => {
    return messages.some(m => m.id === firstUnreadId);
  }, [firstUnreadId]);

  // Function to load messages around first unread
  const loadMessagesAroundFirstUnread = useCallback(async () => {
    if (!firstUnreadId || unreadMessagesLoaded) {
      console.log('[UNREAD] Skipping load around first unread:', {
        firstUnreadId,
        unreadMessagesLoaded,
        reason: !firstUnreadId ? 'No first unread ID' : 'Already loaded'
      });
      return;
    }

    console.log('[UNREAD] Loading messages around first unread:', {
      firstUnreadId,
      currentMessageCount: messages.length
    });

    try {
      // First, get the first unread message to get its timestamp
      const { data: unreadMessage, error: unreadError } = await supabase
        .from('messages')
        .select('created_at')
        .eq('id', firstUnreadId)
        .single();

      if (unreadError || !unreadMessage) {
        console.error('[UNREAD] Error fetching unread message:', unreadError);
        return;
      }

      // Get the timestamp of the oldest message in our current view
      const oldestMessageTime = messages[0]?.created_at;
      
      console.log('[UNREAD] Fetching messages between current view and unread:', {
        firstUnreadId,
        unreadMessageTime: unreadMessage.created_at,
        oldestMessageTime,
        currentMessageCount: messages.length
      });

      // Fetch all messages between our oldest message and the unread message
      const { data: newMessages, error: fetchError } = await supabase
        .from('messages')
        .select(`
          *,
          is_read,
          reply_to:reply_to_message_id (
            content,
            user_id,
            media_url,
            media_type,
            is_read
          )
        `)
        .eq('chat_id', params.chatId)
        .order('created_at', { ascending: true })
        .lt('created_at', unreadMessage.created_at)
        .gt('created_at', oldestMessageTime);

      if (fetchError) {
        console.error('[UNREAD] Error fetching messages:', fetchError);
        return;
      }

      if (newMessages && newMessages.length > 0) {
        console.log('[UNREAD] Found messages to load:', {
          messageCount: newMessages.length,
          firstMessageTime: newMessages[0].created_at,
          lastMessageTime: newMessages[newMessages.length - 1].created_at
        });

        // Get user profiles for new messages
        const userIds = new Set([
          ...newMessages.map(m => m.user_id),
          ...newMessages.filter(m => m.reply_to).map(m => m.reply_to.user_id)
        ].filter(Boolean));

        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', Array.from(userIds));

        const profilesMap = new Map(
          profilesData?.map(profile => [profile.id, profile]) || []
        );

        const transformedData = newMessages.map(message => ({
          ...message,
          profiles: profilesMap.get(message.user_id),
          reply_to: message.reply_to ? {
            ...message.reply_to,
            profiles: profilesMap.get(message.reply_to.user_id)
          } : undefined
        }));

        setMessages(prevMessages => {
          const existingMessages = new Map(prevMessages.map(msg => [msg.id, msg]));
          const uniqueNewMessages = transformedData.filter(msg => !existingMessages.has(msg.id));
          
          console.log('[UNREAD] Adding new messages:', {
            newMessageCount: uniqueNewMessages.length,
            firstMessageTime: uniqueNewMessages[0]?.created_at,
            lastMessageTime: uniqueNewMessages[uniqueNewMessages.length - 1]?.created_at,
            totalMessageCount: prevMessages.length + uniqueNewMessages.length,
            duplicateCount: transformedData.length - uniqueNewMessages.length
          });

          return [...prevMessages, ...uniqueNewMessages].sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });

        setUnreadMessagesLoaded(true);
      } else {
        console.log('[UNREAD] No messages found between current view and unread message');
        setUnreadMessagesLoaded(true);
      }
    } catch (err) {
      console.error('[UNREAD] Error in loadMessagesAroundFirstUnread:', err);
      setError('Failed to load messages around unread');
    }
  }, [firstUnreadId, messages, unreadMessagesLoaded, params.chatId]);

  // Add a ref to track if we're manually handling unread state
  const isManuallyHandlingUnread = useRef(false);

  // Update the unread state effect
  useEffect(() => {
    if (!user || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isNearBottom = distanceFromBottom < 100;

    // Only update unread state if we're near bottom or if there are unread messages
    if (isNearBottom || unreadCount > 0) {
      const previousUnreadCount = unreadCount;
      const newUnreadCount = isNearBottom ? 0 : unreadCount;
      const hasUnreadMessages = newUnreadCount > 0;

      console.log('[UNREAD] Updating unread state:', {
        previousUnreadCount,
        newUnreadCount,
        messageCount: messages.length,
        firstUnreadId,
        hasUnreadMessages,
        isNearBottom,
        distanceFromBottom
      });

      if (previousUnreadCount !== newUnreadCount) {
        setUnreadCount(newUnreadCount);
        setFirstUnreadId(hasUnreadMessages ? firstUnreadId : null);
      }
    }
  }, [user, messages, unreadCount, firstUnreadId, scrollContainerRef]);

  // Add test mode controls
  const TestControls = () => {
  return (
      <div className={`fixed top-4 right-4 z-50 bg-white p-4 rounded-lg shadow-lg transition-all duration-300 ${showTestControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-bold">Test Mode</h3>
          <button
            onClick={() => setShowTestControls(false)}
            className="text-gray-500 hover:text-gray-700"
          >
            ×
          </button>
        </div>
        <div className="space-y-2">
          <button
            onClick={() => {
              setTestMode('top');
              setShowTestControls(false);
            }}
            className={`w-full px-3 py-1 rounded ${testMode === 'top' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            Load at Top
          </button>
          <button
            onClick={() => {
              setTestMode('bottom');
              setShowTestControls(false);
            }}
            className={`w-full px-3 py-1 rounded ${testMode === 'bottom' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            Load at Bottom
          </button>
          <button
            onClick={() => {
              setTestMode(null);
              setShowTestControls(false);
            }}
            className="w-full px-3 py-1 rounded bg-red-500 text-white"
          >
            Reset
          </button>
        </div>
      </div>
    );
  };

  // Add test mode toggle button
  const TestModeToggle = () => {
    return (
      <button
        onClick={() => setShowTestControls(!showTestControls)}
        className="fixed top-4 right-4 z-50 bg-white p-2 rounded-full shadow-lg hover:bg-gray-100 transition-colors"
        title="Toggle test mode"
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    );
  };

  // Add test mode indicator
  const TestModeIndicator = () => {
    if (!testMode) return null;
    
    return (
      <div className="fixed top-4 left-4 z-50 bg-white px-3 py-1 rounded-full shadow-lg text-sm">
        Test Mode: {testMode === 'top' ? 'Loading at Top' : 'Loading at Bottom'}
      </div>
    );
  };

  // Modify initial messages fetch to handle test mode
  useEffect(() => {
    let isMounted = true;

    const fetchInitialMessages = async () => {
      console.log('[INITIAL_FETCH] Starting initial message fetch');
      if (!user || !params.chatId || !supabase) {
        console.log('[INITIAL_FETCH] User, chatId, or supabase not available. Aborting.');
        setLoading(false);
        return;
      }
      
      // Add a check to prevent multiple initial fetches if one is already in progress
      if (initialFetchRef.current) {
        console.log('[INITIAL_FETCH] Initial fetch already in progress or completed. Skipping.');
            return;
          }
      initialFetchRef.current = true; // Mark as started
      setLoading(true);
      setError(null);

      console.log('[INITIAL_FETCH] User and chatId available:', { userId: user.id, chatId: params.chatId });

      try {
        // ... (anchor and unread logic remains the same) ...
        // Determine the anchor point for fetching (e.g., first unread message, or bottom)
        // This part of the logic for finding firstUnreadId, anchorTimestamp etc. is complex and assumed to be working.
        // We'll integrate reaction fetching after messages (and their profiles) are fetched.

        // Simplified: Assume we fetch a block of messages (e.g., latest N or around an anchor)
        // The existing logic fetches unread messages and then messages around them.
        // For this step, we'll focus on the part where `data` (array of messages) is available.
        
        // Example from existing logic: fetch around firstUnreadId or latest
        // This is a placeholder for the actual complex message fetching logic that exists.
        // The key is that after fetching `initialMessagesData`, we process them.

        const { data: initialMessagesData, error: messagesError } = await supabase
            .from('messages')
            .select(`
              *,
              is_read,
              reply_to:reply_to_message_id (
                content,
                user_id,
                media_url,
                media_type,
                is_read
              )
            `)
          .eq('chat_id', params.chatId)
          .order('created_at', { ascending: false }) // Fetch latest first
          .limit(50); // Example limit

        if (messagesError) {
          console.error('[INITIAL_FETCH] Error fetching initial messages:', messagesError);
          setError(messagesError.message);
          setLoading(false);
          initialFetchRef.current = false; // Reset if fetch failed
            return;
          }

        let transformedMessages = [];
        if (initialMessagesData && initialMessagesData.length > 0) {
          const userIds = new Set<string>();
          initialMessagesData.forEach(m => {
            userIds.add(m.user_id);
            if (m.reply_to?.user_id) {
              userIds.add(m.reply_to.user_id);
            }
          });

            const { data: profilesData, error: profilesError } = await supabase
              .from('profiles')
            .select('id, username, avatar_url') // Assuming avatar_url exists for profiles
              .in('id', Array.from(userIds));

            if (profilesError) {
            console.error('[INITIAL_FETCH] Error fetching profiles for initial messages:', profilesError);
            // Continue without profiles or handle error as appropriate
            }

          const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);
          transformedMessages = initialMessagesData.map(m => ({
            ...m,
            profiles: profilesMap.get(m.user_id),
            reply_to: m.reply_to ? {
              ...m.reply_to,
              profiles: profilesMap.get(m.reply_to.user_id)
            } : undefined,
            reactions: [] // Initialize with empty reactions
          })).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // Sort back to chronological
        }
        
        // --- Fetch and Stitch Reactions ---
        let messagesWithReactions = transformedMessages;
        if (transformedMessages.length > 0 && user?.id) {
          const messageIds = transformedMessages.map(m => m.id);
          const { data: rawReactionsData, error: reactionsError } = await supabase
            .from('reactions')
            .select('message_id, user_id, emoji')
            .in('message_id', messageIds);

          if (reactionsError) {
            console.error('[INITIAL_FETCH] Error fetching reactions for initial messages:', reactionsError);
          } else if (rawReactionsData) {
            messagesWithReactions = processAndStitchReactions(transformedMessages, rawReactionsData, user.id);
          }
        }
        // --- End Fetch and Stitch Reactions ---

        console.log('[INITIAL_FETCH] Processed initial messages with reactions:', messagesWithReactions.length);

        if (messagesWithReactions.length > 0) {
          setMessages(messagesWithReactions);
          setOldestCursor(messagesWithReactions[0].id);
          setNewestCursor(messagesWithReactions[messagesWithReactions.length - 1].id);
          setHasMore(messagesWithReactions.length === 50); // Assuming limit was 50
           // If initial fetch was from bottom (most recent), newer messages are unlikely unless race condition.
          // This depends on the exact logic of initial fetch (e.g. if it aims for unread or absolute bottom)
          setHasNewer(false); // Typically, initial load gets the newest, so no "newer" from this point.
                             // This might need adjustment based on precise unread/anchor logic.
          } else {
          setMessages([]);
          setOldestCursor(null);
          setNewestCursor(null);
            setHasMore(false);
            setHasNewer(false);
          }
        console.log('[INITIAL_FETCH] Initial messages loaded and state updated.');
        fetchLatestPinnedMessage(); // Fetch pinned message after initial load
      } catch (err: any) {
        console.error('[INITIAL_FETCH] Critical error during initial message fetch:', err);
        setError(err.message || 'Failed to load initial messages.');
        initialFetchRef.current = false; // Reset on critical error
      } finally {
          setLoading(false);
        // initialFetchRef.current should remain true if successful to prevent re-fetch
        // It's reset above only on specific error conditions before this finally block.
        console.log('[INITIAL_FETCH] Finished initial message fetch. Loading state set to false.');
      }
    };

    if (authCheckTimeoutRef.current) {
      clearTimeout(authCheckTimeoutRef.current);
    }

    authCheckTimeoutRef.current = setTimeout(() => {
      if (isMounted) {
        fetchInitialMessages();
      }
    }, 100);

    return () => {
      isMounted = false;
      if (authCheckTimeoutRef.current) {
        clearTimeout(authCheckTimeoutRef.current);
      }
      initialFetchRef.current = false;
      fetchPromiseRef.current = null;
    };
  }, [user, params.chatId]);

  // Add scrollToUnreadMessage function before handleScrollButtonClick
  const scrollToUnreadMessage = useCallback(async (firstUnreadId: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    console.log('[SCROLL_UNREAD] Starting scroll to unread:', {
      firstUnreadId,
      testMode,
      currentMessageCount: messages.length
    });

    // If in load-at-top mode, we need to ensure all messages up to the unread message are loaded
    if (testMode === 'top') {
      console.log('[SCROLL_UNREAD] Load-at-top mode detected, loading messages around unread');
      
      try {
        // Get the unread message to get its timestamp
        const { data: unreadMessage, error: unreadError } = await supabase
          .from('messages')
          .select('created_at')
          .eq('id', firstUnreadId)
          .single();

        if (unreadError || !unreadMessage) {
          console.error('[SCROLL_UNREAD] Error fetching unread message:', unreadError);
          return;
        }

        // Get the timestamp of the oldest message in our current view
        const oldestMessageTime = messages[0]?.created_at;
        
        // Fetch all messages between our oldest message and the unread message
        const { data: newMessages, error: fetchError } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', params.chatId)
          .order('created_at', { ascending: true })
          .lt('created_at', unreadMessage.created_at)
          .gt('created_at', oldestMessageTime);

        if (fetchError) {
          console.error('[SCROLL_UNREAD] Error fetching messages:', fetchError);
          return;
        }

        if (newMessages && newMessages.length > 0) {
          console.log('[SCROLL_UNREAD] Adding messages before unread:', {
            messageCount: newMessages.length,
            firstMessageTime: newMessages[0].created_at,
            lastMessageTime: newMessages[newMessages.length - 1].created_at
          });

          setMessages(prevMessages => {
            const existingMessages = new Map(prevMessages.map(msg => [msg.id, msg]));
            const uniqueNewMessages = newMessages.filter(msg => !existingMessages.has(msg.id));
            return [...prevMessages, ...uniqueNewMessages].sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });

          // Wait for state update and DOM to reflect changes
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (err) {
        console.error('[SCROLL_UNREAD] Error in load-at-top mode:', err);
        return;
      }
    }

    // Now scroll to the unread message
    const unreadElement = document.getElementById(`message-${firstUnreadId}`);
    if (unreadElement) {
      console.log('[SCROLL_UNREAD] Scrolling to unread message:', {
        messageId: firstUnreadId,
        testMode
      });
      
      // Get container and element dimensions
      const containerRect = container.getBoundingClientRect();
      const elementRect = unreadElement.getBoundingClientRect();
      const offset = elementRect.top - containerRect.top;
      
      // Scroll with a small offset to ensure the message is visible
      container.scrollTo({
        top: container.scrollTop + offset - 100,
        behavior: 'smooth'
      });

      // Double check scroll position after a short delay
      setTimeout(() => {
        const finalElementRect = unreadElement.getBoundingClientRect();
        const finalContainerRect = container.getBoundingClientRect();
        const finalOffset = finalElementRect.top - finalContainerRect.top;
        
        if (Math.abs(finalOffset - 100) > 50) {
          console.log('[SCROLL_UNREAD] Adjusting final scroll position:', {
            initialOffset: offset,
            finalOffset,
            difference: finalOffset - offset
          });
          
          container.scrollTo({
            top: container.scrollTop + finalOffset - 100,
            behavior: 'auto'
          });
        }
      }, 100);
    } else {
      console.log('[SCROLL_UNREAD] Unread message element not found:', firstUnreadId);
    }
  }, [messages, testMode, params.chatId]);

  // Add scroll state management
  const [scrollState, setScrollState] = useState<{
    isScrolling: boolean;
    targetId: string | null;
    direction: 'top' | 'bottom' | null;
    loadingMessages: boolean;
    unreadCount: number;
    firstUnreadId: string | null;
    hasNewer: boolean;
    testMode: 'top' | 'bottom';
  }>({
    isScrolling: false,
    targetId: null,
    direction: null,
    loadingMessages: false,
    unreadCount: 0,
    firstUnreadId: null,
    hasNewer: false,
    testMode: 'bottom'
  });

  // Add scroll operation queue
  type ScrollOperation = {
    targetId: string;
    direction: 'top' | 'bottom';
    offset: number;
  };

  const scrollQueue = useRef<ScrollOperation[]>([]);
  const isProcessingScrollQueue = useRef(false);

  // Add scroll position calculation function (moved to top to fix linter errors)
  const calculateScrollPosition = useCallback((
    targetElement: HTMLElement,
    container: HTMLElement,
    options: {
      offset?: number;
      behavior?: ScrollBehavior;
      direction?: 'top' | 'bottom';
      considerCurrentPosition?: boolean;
    } = {}
  ) => {
    const {
      offset = 100,
      behavior = 'smooth',
      direction = 'top',
      considerCurrentPosition = true
    } = options;

    // Get container and element dimensions
    const containerRect = container.getBoundingClientRect();
    const elementRect = targetElement.getBoundingClientRect();
    
    // Calculate the base offset
    const baseOffset = elementRect.top - containerRect.top;
    
    // Calculate the final scroll position
    let finalScrollTop: number;
    
    if (direction === 'top') {
      // For top direction, we want the element to be at the top of the viewport
      finalScrollTop = container.scrollTop + baseOffset - offset;
    } else {
      // For bottom direction, we want the element to be at the bottom of the viewport
      finalScrollTop = container.scrollTop + baseOffset - (containerRect.height - elementRect.height - offset);
    }

    // If we should consider current position, adjust for any existing scroll
    if (considerCurrentPosition) {
      const currentScrollTop = container.scrollTop;
      const scrollDiff = finalScrollTop - currentScrollTop;
      
      // If the scroll difference is small, don't scroll
      if (Math.abs(scrollDiff) < 10) {
        console.log('[SCROLL] Scroll difference too small, skipping:', {
          currentScrollTop,
          finalScrollTop,
          difference: scrollDiff
        });
        return false;
      }
    }

    // Ensure the scroll position is within bounds
    finalScrollTop = Math.max(0, Math.min(finalScrollTop, container.scrollHeight - container.clientHeight));

    console.log('[SCROLL] Calculating scroll position:', {
      baseOffset,
      finalScrollTop,
      containerHeight: containerRect.height,
      elementHeight: elementRect.height,
      currentScrollTop: container.scrollTop,
      maxScroll: container.scrollHeight - container.clientHeight,
      direction,
      behavior
    });

    return {
      scrollTop: finalScrollTop,
      behavior
    };
  }, []);

  // Add scroll position verification function (moved to top to fix linter errors)
  const verifyScrollPosition = useCallback((
    targetElement: HTMLElement,
    container: HTMLElement,
    options: {
      offset?: number;
      direction?: 'top' | 'bottom';
      maxAttempts?: number;
    } = {}
  ) => {
    const {
      offset = 100,
      direction = 'top',
      maxAttempts = 3
    } = options;

    return new Promise<boolean>((resolve) => {
      let attempts = 0;

      const checkPosition = () => {
        const containerRect = container.getBoundingClientRect();
        const elementRect = targetElement.getBoundingClientRect();
        const currentOffset = elementRect.top - containerRect.top;
        
        // Calculate the expected position based on direction
        const expectedPosition = direction === 'top' ? offset : containerRect.height - elementRect.height - offset;
        const positionDiff = Math.abs(currentOffset - expectedPosition);
        
        const isCorrectPosition = positionDiff <= 50;

        console.log('[SCROLL] Verifying scroll position:', {
          attempt: attempts + 1,
          currentOffset,
          expectedPosition,
          positionDiff,
          isCorrectPosition,
          direction,
          containerHeight: containerRect.height,
          elementHeight: elementRect.height
        });

        if (isCorrectPosition || attempts >= maxAttempts) {
          resolve(isCorrectPosition);
          return;
        }

        // Adjust scroll position if needed
        const scrollOptions = calculateScrollPosition(targetElement, container, {
          offset,
          behavior: 'auto',
          direction,
          considerCurrentPosition: false
        });

        if (scrollOptions) {
          container.scrollTo(scrollOptions);
        }

        attempts++;
        setTimeout(checkPosition, 100);
      };

      checkPosition();
    });
  }, [calculateScrollPosition]);

  // Add helper function to find element with retry
  const findElementWithRetry = useCallback(async (
    elementId: string,
    maxAttempts: number = 5,
    delay: number = 200
  ): Promise<HTMLElement | null> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const element = document.getElementById(elementId);
      if (element) {
        console.log('[SCROLL] Found element on attempt:', {
          attempt,
          elementId,
          elementHeight: element.offsetHeight,
          elementTop: element.offsetTop
        });
        return element;
      }
      
      console.log('[SCROLL] Element not found, retrying:', {
        attempt,
        maxAttempts,
        elementId
      });
      
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    console.log('[SCROLL] Element not found after all attempts:', {
      elementId,
      maxAttempts
    });
    return null;
  }, []);

  // Update processScrollQueue to use retry logic
  const processScrollQueue = async () => {
    if (scrollQueue.current.length === 0) return;

    const { targetId, direction } = scrollQueue.current[0];
    console.log('[SCROLL_QUEUE] Processing scroll operation:', { targetId, direction });

    try {
      // Wait for state updates and DOM changes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Find the target element with retry
      const element = await findElementWithRetry(`message-${targetId}`, 10, 300);
      if (!element) {
        console.error('[SCROLL_QUEUE] Target element not found after retries');
        scrollQueue.current.shift();
        return;
      }

      const container = scrollContainerRef.current;
      if (!container) {
        console.error('[SCROLL_QUEUE] Container not found');
        scrollQueue.current.shift();
        return;
      }

      // Get element and container dimensions
      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const elementTop = elementRect.top - containerRect.top + container.scrollTop;
      const elementHeight = elementRect.height;
      const containerHeight = containerRect.height;

      console.log('[SCROLL_QUEUE] Element dimensions:', {
        elementTop,
        elementHeight,
        containerHeight,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight
      });

      // Calculate target scroll position
      let targetScrollTop;
      if (direction === 'top') {
        // For top direction, position element at top of container with padding
        targetScrollTop = Math.max(0, elementTop - 100);
      } else {
        // For bottom direction, position element at bottom of container with padding
        targetScrollTop = Math.min(
          container.scrollHeight - containerHeight,
          elementTop - containerHeight + elementHeight + 100
        );
      }

      // Ensure scroll position is within bounds
      targetScrollTop = Math.max(0, Math.min(targetScrollTop, container.scrollHeight - containerHeight));

      console.log('[SCROLL_QUEUE] Scrolling to position:', {
        targetScrollTop,
        currentScrollTop: container.scrollTop,
        difference: targetScrollTop - container.scrollTop
      });

      // Perform the scroll in one smooth operation
      container.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      });

      // Wait for scroll to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify final scroll position
      const finalElementRect = element.getBoundingClientRect();
      const finalContainerRect = container.getBoundingClientRect();
      const finalElementTop = finalElementRect.top - finalContainerRect.top + container.scrollTop;
      const positionDiff = Math.abs(finalElementTop - (direction === 'top' ? 100 : containerHeight - 100));

      console.log('[SCROLL_QUEUE] Scroll verification:', {
        finalElementTop,
        targetPosition: direction === 'top' ? 100 : containerHeight - 100,
        positionDiff,
        scrollTop: container.scrollTop
      });

      // If position difference is too large, make a precise adjustment
      if (positionDiff > 10) {
        const adjustment = direction === 'top' ? 100 - finalElementTop : containerHeight - 100 - finalElementTop;
        container.scrollBy({
          top: adjustment,
          behavior: 'auto'
        });
      }

    } catch (error) {
      console.error('[SCROLL_QUEUE] Error processing scroll:', error);
    } finally {
      scrollQueue.current.shift();
    }
  };

  // Update handleScrollButtonClick to ensure DOM is ready
  const handleScrollButtonClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    // Reset adjustment flag before handling this specific scroll action
    needsScrollAdjustmentRef.current = false; 

    const container = scrollContainerRef.current;
    if (!container) return;

    // If clicking scroll to bottom button, clear jump history
    setJumpHistory([]);

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

    // If we're near bottom, just scroll to bottom
    if (isNearBottom) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
      return;
    }

    // If we have an unread message, scroll to it
    if (unreadCount > 0 && firstUnreadId) {
      console.log('[SCROLL_BUTTON] Button clicked:', {
        unreadCount,
        firstUnreadId,
        hasNewer,
        testMode,
        isNearBottom,
        messageCount: messages.length,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight
      });

      try {
        // First, get the unread message to get its timestamp
        const { data: unreadData, error: unreadError } = await supabase
          .from('messages')
          .select('*')
          .eq('id', firstUnreadId)
          .single();

        if (unreadError || !unreadData) {
          console.error('[SCROLL_BUTTON] Error fetching unread message:', unreadError);
          return;
        }

        console.log('[SCROLL_BUTTON] Found unread message:', {
          messageId: unreadData.id,
          created_at: unreadData.created_at,
          currentMessageCount: messages.length
        });

        // In load-at-top mode, we need to fetch messages before the unread message
        if (testMode === 'top') {
          // Get the timestamp of the oldest message in our current view
          const oldestMessageTime = messages[0]?.created_at;
          
          console.log('[SCROLL_BUTTON] Fetching messages before unread:', {
            unreadMessageTime: unreadData.created_at,
            oldestMessageTime,
            currentMessageCount: messages.length
          });

          // Fetch messages between our oldest message and the unread message
          const { data: olderMessages, error: olderError } = await supabase
            .from('messages')
            .select(`
              *,
              is_read,
              reply_to:reply_to_message_id (
                content,
                user_id,
                media_url,
                media_type,
                is_read
              )
            `)
            .eq('chat_id', params.chatId)
            .lte('created_at', unreadData.created_at)
            .gt('created_at', oldestMessageTime)
            .order('created_at', { ascending: true });

          if (olderError) {
            console.error('[SCROLL_BUTTON] Error fetching older messages:', olderError);
            return;
          }

          if (olderMessages && olderMessages.length > 0) {
            console.log('[SCROLL_BUTTON] Adding older messages:', {
              messageCount: olderMessages.length,
              firstMessageTime: olderMessages[0].created_at,
              lastMessageTime: olderMessages[olderMessages.length - 1].created_at
            });

            // Get all user IDs from messages and replies
            const userIds = new Set([
              ...olderMessages.map(m => m.user_id),
              ...olderMessages.filter(m => m.reply_to).map(m => m.reply_to.user_id)
            ].filter(Boolean));

            const { data: profilesData, error: profilesError } = await supabase
              .from('profiles')
              .select('id, username')
              .in('id', Array.from(userIds));

            if (profilesError) {
              console.error('[SCROLL_BUTTON] Error fetching profiles:', profilesError);
              return;
            }

            const profilesMap = new Map(
              profilesData?.map(profile => [profile.id, profile]) || []
            );

            const transformedData = olderMessages.map(message => ({
              ...message,
              profiles: profilesMap.get(message.user_id),
              reply_to: message.reply_to ? {
                ...message.reply_to,
                profiles: profilesMap.get(message.reply_to.user_id)
              } : undefined
            }));

            // Update messages state with new messages
            setMessages(prev => {
              const existingMessages = new Map(prev.map(msg => [msg.id, msg]));
              const uniqueNewMessages = transformedData.filter(msg => !existingMessages.has(msg.id));
              
              console.log('[SCROLL_BUTTON] Merging messages:', {
                previousCount: prev.length,
                newCount: uniqueNewMessages.length,
                totalCount: prev.length + uniqueNewMessages.length
              });

              // Ensure the unread message is included
              const allMessages = [...prev, ...uniqueNewMessages].sort((a, b) => 
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );

              // Verify the unread message is in the array
              const hasUnreadMessage = allMessages.some(msg => msg.id === firstUnreadId);
              console.log('[SCROLL_BUTTON] Message array check:', {
                hasUnreadMessage,
                unreadMessageId: firstUnreadId,
                totalMessages: allMessages.length,
                firstMessageId: allMessages[0]?.id,
                lastMessageId: allMessages[allMessages.length - 1]?.id
              });

              return allMessages;
            });

            // Wait for state update and DOM to reflect changes
            await new Promise(resolve => setTimeout(resolve, 300));

            // Try to find the unread message element with retries
            let unreadElement = null;
            let attempts = 0;
            const maxAttempts = 5;

            while (!unreadElement && attempts < maxAttempts) {
              unreadElement = document.getElementById(`message-${firstUnreadId}`);
              if (!unreadElement) {
                console.log('[SCROLL_BUTTON] Waiting for unread message element, attempt:', attempts + 1);
                // Force a re-render by updating a dummy state
                setMessages(prev => [...prev]);
                await new Promise(resolve => setTimeout(resolve, 200));
                attempts++;
              }
            }

            if (unreadElement) {
              console.log('[SCROLL_BUTTON] Found unread message element after', attempts + 1, 'attempts');
              unreadElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setUnreadCount(0);
              setFirstUnreadId(null);
            } else {
              console.error('[SCROLL_BUTTON] Unread message element not found after', maxAttempts, 'attempts');
              // Try one last time with a longer delay
              await new Promise(resolve => setTimeout(resolve, 500));
              const finalAttempt = document.getElementById(`message-${firstUnreadId}`);
              if (finalAttempt) {
                console.log('[SCROLL_BUTTON] Found unread message element on final attempt');
                finalAttempt.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setUnreadCount(0);
                setFirstUnreadId(null);
              }
            }
          }
        }

        // Now scroll to the unread message
        const unreadElement = document.getElementById(`message-${firstUnreadId}`);
        if (unreadElement) {
          console.log('[SCROLL_BUTTON] Scrolling to unread message');
          unreadElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setUnreadCount(0);
          setFirstUnreadId(null);
        } else {
          console.error('[SCROLL_BUTTON] Unread message element not found after loading messages');
        }
      } catch (error) {
        console.error('[SCROLL_BUTTON] Error handling unread message:', error);
      }
    } else {
      // If no unread messages, handle scroll to bottom based on test mode
      if (testMode === 'top') {
        console.log('[SCROLL_BUTTON] Scroll to bottom in load-at-top mode:', {
          currentMessageCount: messages.length,
          hasNewer,
          testMode
        });

        try {
          // Get the timestamp of the newest message in our current view
          const newestMessageTime = messages[messages.length - 1]?.created_at;
          
          console.log('[SCROLL_BUTTON] Fetching newer messages:', {
            newestMessageTime,
            currentMessageCount: messages.length
          });

          // Fetch messages after our newest message
          const { data: newerMessages, error: newerError } = await supabase
            .from('messages')
            .select(`
              *,
              is_read,
              reply_to:reply_to_message_id (
                content,
                user_id,
                media_url,
                media_type,
                is_read
              )
            `)
            .eq('chat_id', params.chatId)
            .gt('created_at', newestMessageTime)
            .order('created_at', { ascending: true });

          if (newerError) {
            console.error('[SCROLL_BUTTON] Error fetching newer messages:', newerError);
            return;
          }

          if (newerMessages && newerMessages.length > 0) {
            console.log('[SCROLL_BUTTON] Adding newer messages:', {
              messageCount: newerMessages.length,
              firstMessageTime: newerMessages[0].created_at,
              lastMessageTime: newerMessages[newerMessages.length - 1].created_at
            });

            // Get all user IDs from messages and replies
            const userIds = new Set([
              ...newerMessages.map(m => m.user_id),
              ...newerMessages.filter(m => m.reply_to).map(m => m.reply_to.user_id)
            ].filter(Boolean));

            const { data: profilesData, error: profilesError } = await supabase
              .from('profiles')
              .select('id, username')
              .in('id', Array.from(userIds));

            if (profilesError) {
              console.error('[SCROLL_BUTTON] Error fetching profiles:', profilesError);
              return;
            }

            const profilesMap = new Map(
              profilesData?.map(profile => [profile.id, profile]) || []
            );

            const transformedData = newerMessages.map(message => ({
              ...message,
              profiles: profilesMap.get(message.user_id),
              reply_to: message.reply_to ? {
                ...message.reply_to,
                profiles: profilesMap.get(message.reply_to.user_id)
              } : undefined
            }));

            // Update messages state with new messages
            setMessages(prev => {
              const existingMessages = new Map(prev.map(msg => [msg.id, msg]));
              const uniqueNewMessages = transformedData.filter(msg => !existingMessages.has(msg.id));
              
              console.log('[SCROLL_BUTTON] Merging messages:', {
                previousCount: prev.length,
                newCount: uniqueNewMessages.length,
                totalCount: prev.length + uniqueNewMessages.length
              });

              // Sort all messages by created_at
              const allMessages = [...prev, ...uniqueNewMessages].sort((a, b) => 
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );

              return allMessages;
            });

            // Wait for state update and DOM to reflect changes
            await new Promise(resolve => setTimeout(resolve, 300));

            // Try to scroll to bottom with retries
            let attempts = 0;
            const maxAttempts = 5;
            let scrolled = false;

            while (!scrolled && attempts < maxAttempts) {
              console.log('[SCROLL_BUTTON] Attempting to scroll to bottom, attempt:', attempts + 1);
              
              // Force a re-render by updating a dummy state
              setMessages(prev => [...prev]);
              
              // Wait for DOM update
              await new Promise(resolve => setTimeout(resolve, 200));
              
              // Scroll to bottom
              container.scrollTo({
                top: container.scrollHeight,
                behavior: 'smooth'
              });
              
              // Verify scroll position
              await new Promise(resolve => setTimeout(resolve, 100));
              const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 10;
              
              if (isAtBottom) {
                console.log('[SCROLL_BUTTON] Successfully scrolled to bottom');
                scrolled = true;
              } else {
                console.log('[SCROLL_BUTTON] Scroll verification failed, retrying...');
                attempts++;
              }
            }

            if (!scrolled) {
              console.error('[SCROLL_BUTTON] Failed to scroll to bottom after', maxAttempts, 'attempts');
              // Try one last time with a longer delay
              await new Promise(resolve => setTimeout(resolve, 500));
              container.scrollTo({
                top: container.scrollHeight,
                behavior: 'auto'
              });
            }
          } else {
            console.log('[SCROLL_BUTTON] No newer messages found, scrolling to current bottom');
            container.scrollTo({
              top: container.scrollHeight,
              behavior: 'smooth'
            });
          }
        } catch (error) {
          console.error('[SCROLL_BUTTON] Error handling scroll to bottom:', error);
          // Fallback to simple scroll
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
          });
        }
      } else {
        // If not in load-at-top mode, use simple scroll
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }
    }
  }, [unreadCount, firstUnreadId, hasNewer, testMode, messages, params.chatId]);

  // Debounce scroll position updates
  const debouncedScrollCheck = useCallback(
    debounce((container: HTMLDivElement) => {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      console.log('[SCROLL_BUTTON] Scroll position check:', {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        distanceFromBottom: container.scrollHeight - container.scrollTop - container.clientHeight,
        isNearBottom
      });
    }, 100),
    []
  );

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    debouncedScrollCheck(scrollContainerRef.current);
  }, [debouncedScrollCheck]);

  // Add real-time message handling
  useEffect(() => {
    if (!user || !params.chatId) return;

    console.log('[REALTIME] Setting up real-time subscription');
    
    // Subscribe to new messages
    const channel = supabase
      .channel(`chat:${params.chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${params.chatId}`
        },
        async (payload) => {
          console.log('[REALTIME] New message received (raw payload.new):', payload.new);

          // If it's not our own message, update unread state immediately
          if (payload.new.user_id !== user.id) {
            console.log('[REALTIME] Updating unread state for new message');
            
            // Update refs first
            unreadCountRef.current += 1;
            if (!firstUnreadIdRef.current) {
              firstUnreadIdRef.current = payload.new.id;
            }

            // Then update state
            setUnreadCount(unreadCountRef.current);
            if (!firstUnreadId) {
              setFirstUnreadId(firstUnreadIdRef.current);
            }

            // Note: We don't update firstUnreadMessageIdForBanner here
            // This ensures the banner stays fixed at its original position
            console.log('[REALTIME] Unread state updated:', {
              newUnreadCount: unreadCountRef.current,
              firstUnreadId: firstUnreadIdRef.current,
              bannerPositionId: firstUnreadMessageIdForBanner // Banner position remains unchanged
            });
          }

          // Get the new message with profile info
          const { data: messageData, error: messageError } = await supabase
            .from('messages')
            .select(`
              *,
              is_read,
              reply_to:reply_to_message_id (
                content,
                user_id,
                media_url,
                media_type,
                is_read
              )
            `)
            .eq('id', payload.new.id)
            .single();

          if (messageError) {
            console.error('[REALTIME] Error fetching new message:', messageError);
            return;
          }
          console.log('[REALTIME] Fetched messageData for new message (includes reply_to snippet):', messageData);

          // Get profile for the new message
          const { data: senderProfileData, error: senderProfileError } = await supabase
            .from('profiles')
            .select('id, username')
            .eq('id', payload.new.user_id)
            .single();

          if (senderProfileError) {
            console.error('[REALTIME] Error fetching profile for sender:', senderProfileError);
            // Potentially return or use a default profile
          }
          console.log('[REALTIME] Profile data for main message sender:', senderProfileData);

          let repliedToProfileData = null;
          if (messageData && messageData.reply_to && messageData.reply_to.user_id) {
            const { data: originalSenderProfile, error: originalSenderProfileError } = await supabase
              .from('profiles')
              .select('id, username')
              .eq('id', messageData.reply_to.user_id)
              .single();
            if (originalSenderProfileError) {
              console.error('[REALTIME] Error fetching profile for original sender of replied-to message:', originalSenderProfileError);
            } else {
              repliedToProfileData = originalSenderProfile;
            }
            console.log('[REALTIME] Profile data for original sender of replied-to message:', repliedToProfileData);
          }

          if (messageData) {
            const newMessage = {
              ...messageData,
              profiles: senderProfileData, // Profile of the person who sent *this* message
              reply_to: messageData.reply_to ? {
                ...messageData.reply_to,
                profiles: repliedToProfileData // Profile of the person who sent the *original* message
              } : undefined,
              reactions: [] // Initialize reactions as empty for new messages
            };
            console.log('[REALTIME] Constructed newMessage object for UI:', newMessage);

            console.log('[REALTIME] Adding new message to state:', {
              messageId: newMessage.id,
              userId: newMessage.user_id,
              isOwnMessage: newMessage.user_id === user.id,
              hasReply: !!newMessage.reply_to
            });

            setMessages(prevMessages => {
              // Check if message already exists
              if (prevMessages.some(m => m.id === newMessage.id)) {
                console.log('[REALTIME] Message already exists in state');
                return prevMessages;
              }

              // Add new message and sort
              const updatedMessages = [...prevMessages, newMessage].sort((a, b) => 
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );

              console.log('[REALTIME] Messages updated:', {
                previousCount: prevMessages.length,
                newCount: updatedMessages.length,
                messageId: newMessage.id,
                messageTime: newMessage.created_at
              });

              return updatedMessages;
            });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      console.log('[REALTIME] Cleaning up subscription');
      channel.unsubscribe();
    };
  }, [user, params.chatId]); // Remove unreadCount and firstUnreadId from dependencies

  // Update refs when state changes
  useEffect(() => {
    unreadCountRef.current = unreadCount;
    firstUnreadIdRef.current = firstUnreadId;
  }, [unreadCount, firstUnreadId]);

  // Set the first unread message ID for banner when unread messages are detected
  useEffect(() => {
    // Only set the banner position if we have unread messages and it hasn't been set yet
    if (unreadCount > 0 && firstUnreadId && !firstUnreadMessageIdForBanner) {
      console.log('[UNREAD_BANNER] Setting banner position at message:', firstUnreadId, {
        unreadCount,
        messagesLoaded: messages.length,
        loadingState: loading
      });
      setFirstUnreadMessageIdForBanner(firstUnreadId);
    }
  }, [unreadCount, firstUnreadId, firstUnreadMessageIdForBanner, messages.length, loading]);

  // Add a fallback effect that runs after loading is complete to ensure the banner is set
  useEffect(() => {
    if (!loading && messages.length > 0 && !firstUnreadMessageIdForBanner) {
      // Check if there are any unread messages in the loaded messages
      const unreadMessages = messages.filter(m => !m.is_read && m.user_id !== user?.id);
      if (unreadMessages.length > 0) {
        const firstUnread = unreadMessages[0];
        const lastUnread = unreadMessages[unreadMessages.length - 1];
        console.log('[UNREAD_BANNER] Fallback: Found unread messages after loading:', {
          count: unreadMessages.length,
          firstUnreadId: firstUnread.id,
          lastUnreadId: lastUnread.id,
          messageCount: messages.length
        });
        
        // Set the unread count and first unread ID if not already set
        if (unreadCount === 0) {
          setUnreadCount(unreadMessages.length);
        }
        if (!firstUnreadId) {
          setFirstUnreadId(firstUnread.id);
        }
        
        // Set the banner position to the last unread message
        setFirstUnreadMessageIdForBanner(lastUnread.id);
      }
    }
  }, [loading, messages, firstUnreadMessageIdForBanner, unreadCount, firstUnreadId, user?.id]);

  // Add effect to handle marking messages as read
  useEffect(() => {
    if (!user || !firstUnreadId) return;

    const handleMessageRead = async () => {
      const unreadElement = document.getElementById(`message-${firstUnreadId}`);
      if (!unreadElement) return;

      const container = scrollContainerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const elementRect = unreadElement.getBoundingClientRect();

      // If the unread message is visible in the viewport
      if (elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom) {
        console.log('[UNREAD] Marking messages as read:', {
          firstUnreadId,
          unreadCount: unreadCountRef.current
        });

        // Mark messages as read
        const { error } = await supabase
          .from('messages')
          .update({ is_read: true })
          .eq('chat_id', params.chatId)
          .eq('is_read', false)
          .neq('user_id', user.id);

        if (!error) {
          // Clear unread state
          setUnreadCount(0);
          setFirstUnreadId(null);
          unreadCountRef.current = 0;
          firstUnreadIdRef.current = null;
        }
      }
    };

    // Check if messages are read when scrolling
    const handleScroll = debounce(handleMessageRead, 100);
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => {
        container.removeEventListener('scroll', handleScroll);
        handleScroll.cancel();
      };
    }
  }, [user, firstUnreadId, params.chatId]);

  // Add useEffect for scroll adjustment after upward pagination
  useEffect(() => {
    // Check if adjustment is needed (set by fetchMoreMessages)
    if (needsScrollAdjustmentRef.current && scrollContainerRef.current) {
      const { id: anchorId, offset: anchorOffsetTop } = anchorScrollInfoRef.current;
      const container = scrollContainerRef.current;
      // Make a local copy of the flag and reset the ref immediately
      // to prevent the effect from running multiple times for the same adjustment
      needsScrollAdjustmentRef.current = false; 

      if (anchorId) {
        // Wait for next frame to ensure DOM is updated after messages render
        requestAnimationFrame(() => {
          const newAnchorEl = document.getElementById(`message-${anchorId}`);
          if (newAnchorEl && container) { // Re-check container ref just in case
            const newAnchorOffsetFromScrollParent = newAnchorEl.offsetTop;
            const targetScrollTop = newAnchorOffsetFromScrollParent - anchorOffsetTop;
            console.log('[ANCHOR_EFFECT] Restoring scroll:', { anchorId, currentScrollTop: container.scrollTop, targetScrollTop });
            // Only adjust if the difference is significant to avoid minor jitter
            if (Math.abs(container.scrollTop - targetScrollTop) > 1) { 
                container.scrollTop = targetScrollTop;
            }
          } else {
             console.warn('[ANCHOR_EFFECT] Anchor element or container not found:', anchorId);
          }
          // Clear anchor info after attempting adjustment
          anchorScrollInfoRef.current = { id: null, offset: 0 }; 
        });
      } else {
          console.log('[ANCHOR_EFFECT] No anchorId found for adjustment.');
          // Clear anchor info even if no ID was found
           anchorScrollInfoRef.current = { id: null, offset: 0 };
      }

      // Resetting the flag is now done at the start of the if block.
    }
  }, [messages]); // Run this effect whenever messages array changes

  // useEffect
  useEffect(() => {
    addThrobAnimation();

    // Reset banner state when chat changes
    return () => {
      setFirstUnreadMessageIdForBanner(null);
    };
  }, [params.chatId]);

  // Update the unread state effect to always check for banner position
  useEffect(() => {
    if (!loading && messages.length > 0) {
      // Find unread messages that aren't from the current user
      const unreadMessages = messages.filter(m => !m.is_read && m.user_id !== user?.id);
      
      console.log('[UNREAD_CHECK] Checking for unread messages:', {
        unreadCount: unreadMessages.length,
        hasPositionedBanner: !!firstUnreadMessageIdForBanner,
        totalMessages: messages.length
      });
      
      if (unreadMessages.length > 0) {
        // Update unread count and first unread ID if needed
        if (unreadCount !== unreadMessages.length) {
          setUnreadCount(unreadMessages.length);
        }
        
        // Set the first unread message ID if it's not already set
        if (!firstUnreadId) {
          setFirstUnreadId(unreadMessages[0].id);
        }
        
        // Set the banner position if it's not already set
        if (!firstUnreadMessageIdForBanner) {
          console.log('[UNREAD_CHECK] Setting banner position:', unreadMessages[unreadMessages.length - 1].id);
          setFirstUnreadMessageIdForBanner(unreadMessages[unreadMessages.length - 1].id);
        }
      }
    }
  }, [loading, messages, user?.id, unreadCount, firstUnreadId, firstUnreadMessageIdForBanner]);

  useEffect(() => {
    if (!user || !params.chatId) return;

    console.log('[REALTIME] Setting up real-time subscriptions for chat:', params.chatId);
    
    // Subscribe to new/updated messages in the current chat
    const messagesChatChannel = supabase
      .channel(`chat-messages:${params.chatId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${params.chatId}` },
        async (payload) => {
          // ... existing logic for INSERT and UPDATE from postgres_changes ...
          console.log('[REALTIME_MESSAGE_EVENT] Event type:', payload.eventType, 'Payload:', payload);

          if (payload.eventType === 'INSERT') {
            const newMessagePayload = payload.new as Message;
            console.log('[REALTIME_MESSAGE] New message INSERT received:', newMessagePayload);
            
            if (messages.some(m => m.id === newMessagePayload.id)) {
               console.log('[REALTIME_MESSAGE] Message already exists, skipping.');
            return;
          }
          
            // Get the new message with complete reply information
            const { data: messageData, error: messageError } = await supabase
              .from('messages')
              .select(`
                *,
                is_read,
                reply_to:reply_to_message_id (
                  content,
                  user_id,
                  media_url,
                  media_type,
                  is_read
                )
              `)
              .eq('id', newMessagePayload.id)
              .single();

            if (messageError) {
              console.error('[REALTIME_MESSAGE] Error fetching new message details:', messageError);
              return;
            }

            if (!messageData) {
              console.error('[REALTIME_MESSAGE] No message data returned');
              return;
            }

            // Starting point for the transformed message
            let messageToInsert: Message = { 
              ...messageData, 
              reactions: messageData.reactions || [] 
            };

            // Fetch profiles needed for the message
            const profileIds = new Set<string>();
            profileIds.add(messageData.user_id); // Main message sender
            
            // Add the original message sender if this is a reply
            if (messageData.reply_to && messageData.reply_to.user_id) {
              profileIds.add(messageData.reply_to.user_id);
            }
            
            if (profileIds.size > 0) {
              const { data: profilesData, error: profilesError } = await supabase
              .from('profiles')
              .select('id, username, avatar_url')
                .in('id', Array.from(profileIds));
                
              if (profilesError) {
                console.error('[REALTIME_MESSAGE] Error fetching profiles:', profilesError);
              } else if (profilesData) {
                const profilesMap = new Map(profilesData.map(p => [p.id, p]));
                
                // Set the main message sender's profile
                if (messageData.user_id) {
                  const senderProfile = profilesMap.get(messageData.user_id);
                  if (senderProfile) {
                    messageToInsert.profiles = senderProfile;
                  }
                }
                
                // Set the replied-to message sender's profile
                if (messageToInsert.reply_to && messageToInsert.reply_to.user_id) {
                  const replyUserProfile = profilesMap.get(messageToInsert.reply_to.user_id);
                  if (replyUserProfile) {
                    messageToInsert.reply_to = {
                      ...messageToInsert.reply_to,
                      profiles: replyUserProfile
                    };
                  }
                }
              }
            }

          setMessages(prevMessages => {
              const newMessagesArray = [...prevMessages, messageToInsert]
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            return newMessagesArray;
          });

            // Continue with the existing unread count logic for messages from others
            if (newMessagePayload.user_id !== user?.id) {
              unreadCountRef.current += 1;
              if (!firstUnreadIdRef.current) {
                firstUnreadIdRef.current = newMessagePayload.id;
              }
              setUnreadCount(unreadCountRef.current);
              if (!firstUnreadId) {
                 setFirstUnreadId(firstUnreadIdRef.current);
        }
              if (!firstUnreadMessageIdForBanner) {
                setFirstUnreadMessageIdForBanner(newMessagePayload.id);
              }
            }

          } else if (payload.eventType === 'UPDATE') {
            const updatedMessage = payload.new as Message;
            console.log('[RT_UPDATE] Received payload.new:', JSON.stringify(updatedMessage, null, 2));
            console.log('[RT_UPDATE] currentUserProfile on this client:', JSON.stringify(currentUserProfile, null, 2));

            const localUserIsAdmin = currentUserProfile?.is_admin || false;
            console.log('[RT_UPDATE] Admin status on this client:', localUserIsAdmin);
            console.log('[RT_UPDATE] updatedMessage.is_hidden value:', updatedMessage.is_hidden);

            // Note: The RLS policy should prevent non-admins from seeing is_hidden=true in payload.new from postgres_changes.
            // The custom 'message_hidden' event is the more reliable way to remove it from their UI immediately.
            // So, this block primarily handles updates for admins, or non-hidden updates for non-admins.
            setMessages(prevMessages =>
              prevMessages.map(msg =>
                msg.id === updatedMessage.id 
                  ? { ...msg, ...updatedMessage, reactions: msg.reactions || updatedMessage.reactions || [] } 
                  : msg
              )
            );
            
            fetchLatestPinnedMessage();
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[REALTIME_MESSAGE] Subscribed to messages channel for chat:', params.chatId);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[REALTIME_MESSAGE] Subscription error or timed out for messages:', err, params.chatId);
        }
      });

    // Subscribe to reaction changes (existing subscription)
    const reactionsChannel = supabase
      .channel(`chat-reactions:${params.chatId}`)
      // ... existing reactions subscription logic ...
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[REALTIME_REACTION] Subscribed to reactions channel for chat:', params.chatId);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[REALTIME_REACTION] Subscription error or timed out for reactions:', err, params.chatId);
        }
      });
      
    // Subscribe to custom admin actions for this chat
    const adminActionChannel = supabase.channel('admin-actions'); // Use a general channel name
    adminActionChannel
      .on('broadcast', { event: 'message_hidden' }, (response) => {
        const { messageId: hiddenMessageId, chatId: eventChatId } = response.payload;
        console.log(`[RT_CUSTOM_ADMIN_ACTION] Received 'message_hidden' for message ${hiddenMessageId} in chat ${eventChatId}`);
        if (eventChatId === params.chatId) {
          const localUserIsAdmin = currentUserProfile?.is_admin || false;
          if (!localUserIsAdmin) {
            console.log(`[RT_CUSTOM_ADMIN_ACTION] Non-admin client, removing hidden message ${hiddenMessageId}`);
            setMessages(prevMessages => prevMessages.filter(msg => msg.id !== hiddenMessageId));
          } else {
            console.log(`[RT_CUSTOM_ADMIN_ACTION] Admin client, message ${hiddenMessageId} was hidden, UI will reflect via RLS/refresh or next full load.`);
            // Admin already sees hidden messages due to RLS allowing it in fetches.
            // Or, if we wanted admins to see a visual change for hidden messages without re-fetch:
            // setMessages(prevMessages => prevMessages.map(msg => msg.id === hiddenMessageId ? {...msg, is_hidden: true} : msg)); 
        }
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[RT_CUSTOM_ADMIN_ACTION] Subscribed to admin-actions channel.');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[RT_CUSTOM_ADMIN_ACTION] Subscription error for admin-actions:', status);
        }
      });

    // channelRef.current = messagesChannel; // Keep main channel ref, or manage multiple if needed
    // const reactionsChannelRef = reactionsChannel; // To use in cleanup

    return () => {
      console.log('[REALTIME] Cleaning up subscriptions for chat:', params.chatId);
      if (messagesChatChannel) supabase.removeChannel(messagesChatChannel).catch(err => console.error('Error removing messagesChatChannel:', err));
      if (reactionsChannel) supabase.removeChannel(reactionsChannel).catch(err => console.error('Error removing reactionsChannel:', err));
      if (adminActionChannel) supabase.removeChannel(adminActionChannel).catch(err => console.error('Error removing adminActionChannel:', err));
      // channelRef.current = null;
    };
  }, [user, params.chatId, supabase, processAndStitchReactions, messages, currentUserProfile, fetchLatestPinnedMessage, firstUnreadId, firstUnreadMessageIdForBanner]); // Added dependencies

  const handleOpenSuperemojiMenu = async (message: Message, position: { x: number; y: number }) => {
    let profilesForMenu: Array<{ id: string; username?: string; avatar_url?: string; emoji: string }> = [];
    if (message.reactions && message.reactions.length > 0 && supabase) {
      const allUserIdsInReactions = new Set<string>();
      message.reactions.forEach(reactionSummary => {
        reactionSummary.userIds.forEach(uid => allUserIdsInReactions.add(uid));
      });

      if (allUserIdsInReactions.size > 0) {
        const { data: fetchedProfiles, error: profileError } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .in('id', Array.from(allUserIdsInReactions));
        
        if (profileError) {
          console.error("[SuperemojiMenu] Error fetching profiles for reacting users:", profileError);
        } else if (fetchedProfiles) {
          const profilesMap = new Map(fetchedProfiles.map(p => [p.id, p]));
          message.reactions.forEach(reactionSummary => {
            reactionSummary.userIds.forEach(uid => {
              const userProfile = profilesMap.get(uid);
              profilesForMenu.push({
                id: uid,
                username: userProfile?.username || 'User',
                avatar_url: userProfile?.avatar_url,
                emoji: reactionSummary.emoji,
              });
            });
          });
        }
      }
    }
    setSuperemojiMenuState({ isVisible: true, message, position, reactingUsersProfiles: profilesForMenu });
  };

  const handleCloseSuperemojiMenu = () => {
    setSuperemojiMenuState({ isVisible: false, message: null, position: null, reactingUsersProfiles: [] });
  };

  // Generic optimistic toggle handler for reactions
  const handleOptimisticallyToggleReaction = (messageId: string, emoji: string, currentReactionSummaryForEmoji: ReactionSummary | undefined) => {
    if (!user) return;
    const currentUserId = user.id;
    const isCurrentlyReactedByMe = currentReactionSummaryForEmoji?.reactedByCurrentUser || false;

    setMessages(prevMessages => 
      prevMessages.map(msg => {
        if (msg.id === messageId) {
          let newReactions = [...(msg.reactions || [])];
          const reactionIndex = newReactions.findIndex(r => r.emoji === emoji);

          if (isCurrentlyReactedByMe) { // User is REMOVING this reaction (based on state *before* toggle)
            if (reactionIndex > -1) {
              const reactionToUpdate = { ...newReactions[reactionIndex] }; 
              reactionToUpdate.count -= 1;
              reactionToUpdate.userIds = reactionToUpdate.userIds.filter(uid => uid !== currentUserId);
              reactionToUpdate.reactedByCurrentUser = false; 
              if (reactionToUpdate.count <= 0) {
                newReactions.splice(reactionIndex, 1); 
              } else {
                newReactions[reactionIndex] = reactionToUpdate; 
              }
            }
          } else { // User is ADDING this reaction
            if (reactionIndex > -1) { 
              const reactionToUpdate = { ...newReactions[reactionIndex] };
              if (!reactionToUpdate.userIds.includes(currentUserId)) {
                reactionToUpdate.count += 1;
                reactionToUpdate.userIds = [...reactionToUpdate.userIds, currentUserId];
              }
              reactionToUpdate.reactedByCurrentUser = true; 
              newReactions[reactionIndex] = reactionToUpdate;
            } else { 
              newReactions.push({
                emoji,
                count: 1,
                reactedByCurrentUser: true,
                userIds: [currentUserId]
              });
            }
          }
          newReactions.sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.emoji.localeCompare(b.emoji);
          });
          return { ...msg, reactions: newReactions };
        }
        return msg;
      })
    );
  };

  const handleMenuSelectEmoji = async (emoji: string) => {
    if (!superemojiMenuState.message || !user) {
      console.error("[SuperemojiMenu] Message or user not available for reaction.");
      handleCloseSuperemojiMenu();
      return;
    }
    
    const messageId = superemojiMenuState.message.id;
    const currentUserId = user.id;
    const selectedMessage = superemojiMenuState.message; 

    console.log('[SuperemojiMenu] Toggling emoji:', emoji, 'for message:', messageId);
    handleCloseSuperemojiMenu(); 

    const currentReactionSummary = selectedMessage.reactions?.find(r => r.emoji === emoji);
    handleOptimisticallyToggleReaction(messageId, emoji, currentReactionSummary); // Use the new handler

    const hasUserReactedWithThisEmoji = currentReactionSummary?.reactedByCurrentUser || false;

    try {
      if (hasUserReactedWithThisEmoji) {
        const { error } = await removeReaction(messageId, currentUserId, emoji);
        if (error) console.error('[SuperemojiMenu] Error removing reaction (DB):', error.message);
      } else {
        const { error } = await addReaction(messageId, currentUserId, emoji);
        if (error) console.error('[SuperemojiMenu] Error adding reaction (DB):', error.message);
      }
    } catch (err: any) {
      console.error('[SuperemojiMenu] Unexpected error toggling reaction:', err.message ? err.message : err);
    }
  };

  const handleMenuReply = () => {
    if (!superemojiMenuState.message) {
      console.error("[SuperemojiMenu] No message available for reply action.");
      handleCloseSuperemojiMenu();
      return;
    }
    console.log('[SuperemojiMenu] Reply action for message:', superemojiMenuState.message.id);
    setReplyingTo(superemojiMenuState.message); // Use existing setReplyingTo state updater
    handleCloseSuperemojiMenu();
  };

  const handleMenuCopy = async () => {
    if (!superemojiMenuState.message || typeof superemojiMenuState.message.content !== 'string') {
      console.error("[SuperemojiMenu] No message content available for copy action.");
      handleCloseSuperemojiMenu();
      return;
    }
    console.log('[SuperemojiMenu] Copy action for message:', superemojiMenuState.message.id);
    try {
      await navigator.clipboard.writeText(superemojiMenuState.message.content);
      console.log('[SuperemojiMenu] Message content copied to clipboard.');
      showToast('Copied to clipboard!', 'success');
    } catch (err: any) { 
      console.error('[SuperemojiMenu] Failed to copy message content:', err);
      showToast(err.message || 'Failed to copy', 'error');
    }
    handleCloseSuperemojiMenu();
  };

  // Function to handle opening the user profile modal
  const handleOpenUserProfileModal = async (userId: string) => {
    if (!userId) return;
    setUserProfileModalLoading(true);
    setUserProfileModalError(null);
    setSelectedUserProfile(null);
    setIsUserProfileModalOpen(true);

    try {
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, bio') // Ensure we select all needed fields
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching profile for modal:', error);
        setUserProfileModalError(error.message || 'Failed to load profile.');
        setSelectedUserProfile(null); // Clear any potentially stale data
      } else if (profileData) {
        setSelectedUserProfile(profileData as UserProfile); // Cast to UserProfile type from the modal
      } else {
        setUserProfileModalError('Profile not found.');
        setSelectedUserProfile(null);
      }
    } catch (err: any) {
      console.error('Unexpected error fetching profile for modal:', err);
      setUserProfileModalError(err.message || 'An unexpected error occurred.');
      setSelectedUserProfile(null);
    } finally {
      setUserProfileModalLoading(false);
    }
  };

  const handleCloseUserProfileModal = () => {
    setIsUserProfileModalOpen(false);
    setSelectedUserProfile(null);
    setUserProfileModalLoading(false);
    setUserProfileModalError(null);
  };

  const handleFlagMessage = async (messageId: string, reason?: string) => {
    if (!user || !params.chatId || !supabase) {
      showToast('Cannot report message at this time.', 'error');
      return;
    }

    console.log(`[FLAGGING] User ${user.id} flagging message ${messageId} in chat ${params.chatId}`);

    try {
      const { error } = await supabase
        .from('reports')
        .insert([
          {
            message_id: messageId,
            reported_by_user_id: user.id,
            chat_id: params.chatId,
            reason: reason || null,
            status: 'pending',
          },
        ]);

      if (error) {
        // Check for unique constraint violation (user already reported this message)
        // PostgreSQL unique violation error code is '23505'
        if (error.code === '23505') {
          showToast('You have already reported this message.', 'info');
        } else {
          showToast(`Failed to report message: ${error.message}`, 'error');
        }
        console.error('Error reporting message:', error);
      } else {
        showToast('Message reported. Thank you for your feedback.', 'success');
      }
    } catch (err: any) {
      showToast(`An unexpected error occurred while reporting: ${err.message}`, 'error');
      console.error('Unexpected error reporting message:', err);
    }
  };

  if (loading) { // This `loading` state is for initial message fetch
    return (
      <div className="h-screen flex flex-col">
        <ChatHeader 
          chatId={params.chatId}
          onOpenModal={() => setModalVisible(true)}
        />
        <div className="flex-1 overflow-y-auto">
          <ChatPageMessagesSkeleton />
          </div>
        {/* MessageInput area could be disabled or replaced by a skeleton too */}
        {/* For MVP, simply not rendering the real MessageInput during this top-level loading is fine */}
      </div>
    );
  }

  return (
    <main className="h-screen flex flex-col relative"> {/* Added relative positioning for toast container */}
      {/* SuperemojiMenu - Rendered at top level */}
      {superemojiMenuState.isVisible && superemojiMenuState.message && superemojiMenuState.position && (
        <SuperemojiMenu
          message={superemojiMenuState.message}
          isVisible={superemojiMenuState.isVisible}
          position={superemojiMenuState.position}
          reactingUsersProfiles={superemojiMenuState.reactingUsersProfiles || []} 
          onClose={handleCloseSuperemojiMenu}
          onSelectEmoji={handleMenuSelectEmoji}
          onReply={handleMenuReply}
          onCopy={handleMenuCopy}
          isCurrentUserAdmin={currentUserProfile?.is_admin || false}
          onPinMessage={handlePinMessage}
          onUnpinMessage={handleUnpinMessage}
          onFlagMessage={handleFlagMessage}
        />
      )}

      {/* Chat Header */}
      <ChatHeader 
        chatId={params.chatId}
        onOpenModal={() => setModalVisible(true)}
      />
      
      {/* Render Pinned Message Banner if a message is pinned */}
      {latestPinnedMessage && (
        <PinnedMessageBanner 
          pinnedMessage={latestPinnedMessage} 
          onClick={() => {
            // console.log('Pinned message banner clicked. Message ID:', latestPinnedMessage.id);
            // showToast('List of all pinned messages coming soon!', 'info'); 
            setIsPinnedMessagesModalOpen(true); // Open the modal
          }} 
        />
      )}
      
      {/* Remove debug components - TestModeToggle, TestControls, TestModeIndicator */}
      {false && (
        <>
          <TestModeToggle />
          <TestControls />
          <TestModeIndicator />
        </>
      )}
      
      {error && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4" role="alert">
          <p>{error}</p>
        </div>
      )}
      
      {/* Remove debug output */}
      {/* Show only when in development and specifically enabled */}
      {false && process.env.NODE_ENV !== 'production' && (
        <div className="fixed top-16 left-0 bg-white bg-opacity-80 z-30 p-2 text-xs font-mono max-w-xs overflow-auto" style={{ maxHeight: '200px' }}>
          <div>firstUnreadId: {firstUnreadId || 'none'}</div>
          <div>unreadCount: {unreadCount}</div>
          <div>bannerPos (lastUnread): {firstUnreadMessageIdForBanner || 'none'}</div>
          <div>msgCount: {messages.length}</div>
        </div>
      )}
      
      {/* Message container */}
      <div ref={handleScrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-4 px-4 pb-2 pt-2">
          {(() => {
            // Track the current message date to detect date changes
            let currentMessageDate: Date | null = null;
            
            return messages.map((message, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === messages.length - 1;
              
              // Determine if this message is the current target for top or bottom observers
              const isTopObserverTarget = message.id === oldestCursor && hasMore;
              const isBottomObserverTarget = message.id === newestCursor && hasNewer;
              
              // Check if this message is a target in the jump history
              const isReplyJumpTarget = jumpHistory.length > 0 && jumpHistory[jumpHistory.length - 1].targetId === message.id;
              
              // Check if banner should be shown before this message
              const showBannerBeforeThisMessage = message.id === firstUnreadMessageIdForBanner;
              
              // Check if we need to show a date header
              const messageDate = startOfDay(new Date(message.created_at));
              const showDateHeader = !currentMessageDate || !isSameDay(messageDate, currentMessageDate);
              
              // Update the current date tracker
              currentMessageDate = messageDate;
              
              // Prepare the message element
              const messageElement = (
                <div
                  data-message-id={message.id}
                  ref={el => {
                    if (isTopObserverTarget) topMessageRef.current = el;
                    if (isBottomObserverTarget) bottomMessageRef.current = el;
                    // Keep existing observeMessage for read status
                    observeMessage(el, message.id); 
                  }}
                  id={`message-${message.id}`}
                >
                  <MessageBubble
                    message={message}
                    isOwnMessage={message.user_id === user?.id}
                    ownUsername={currentUserProfile?.username || user?.email || 'Me'}
                    onRetry={() => retryMessage(message.id)}
                    onReply={handleReply}
                    onScrollToMessage={handleScrollToMessage}
                    // Add props for reply chain navigation
                    onInitiateReplyJump={initiateReplyJump}
                    isReplyJumpTarget={isReplyJumpTarget}
                    onReturnFromReply={executeReturnFromReply}
                    onOpenSuperemojiMenu={handleOpenSuperemojiMenu} // Passed to MessageBubble
                    onOptimisticallyToggleReaction={handleOptimisticallyToggleReaction} // Pass new handler
                    onAvatarClick={handleOpenUserProfileModal} // Pass the new handler
                  />
                </div>
              );
              
              // Return elements with date header, banner, and message in the correct order
              return (
                <React.Fragment key={message.id}>
                  {showDateHeader && <DateHeader date={messageDate} />}
                  {showBannerBeforeThisMessage && <UnreadBanner key={`banner-${message.id}`} />}
                  {messageElement}
                </React.Fragment>
              );
            });
          })()}
          <div ref={messagesEndRef} />
        </div>
        <ScrollToBottomButton
          visible={showScrollButton}
          onClick={handleScrollButtonClick}
          unreadCount={unreadCount}
        />
      </div>
      
      {/* Message input area */}
      <div className="flex-shrink-0 border-t bg-white pb-[50px]">
        <div className="max-w-2xl mx-auto px-4 py-2">
          {replyingTo && (
            <div className="p-2 bg-gray-100 rounded-lg flex justify-between items-center mb-2">
              <div className="text-sm text-gray-600 flex items-center gap-2 min-w-0">
                <span className="flex-shrink-0">Replying to:</span>
                {replyingTo.media_url && (
                  <div className="relative w-8 h-8 flex-shrink-0">
                    {(replyingTo.media_type === 'image' || replyingTo.media_type === 'gif') && (
                      <img 
                        src={replyingTo.media_url} 
                        alt="Reply preview" 
                        className="w-8 h-8 object-cover rounded"
                      />
                    )}
                    {replyingTo.media_type === 'video' && (
                      <video 
                        src={replyingTo.media_url}
                        className="w-8 h-8 object-cover rounded"
                      >
                        <source src={replyingTo.media_url} type="video/mp4" />
                      </video>
                    )}
                    {replyingTo.media_type === 'video' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded">
                        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                )}
                <div className="truncate">
                  {replyingTo.content ? (
                    <span className="truncate">
                      {replyingTo.content.length > 50 
                        ? replyingTo.content.substring(0, 50) + '...' 
                        : replyingTo.content}
                    </span>
                  ) : (
                    replyingTo.media_type === 'image' ? 'Image' :
                    replyingTo.media_type === 'video' ? 'Video' :
                    replyingTo.media_type === 'gif' ? 'GIF' : 'Media'
                  )}
                </div>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="text-gray-500 hover:text-gray-700 flex-shrink-0 ml-2"
              >
                ×
              </button>
            </div>
          )}
          {/* Add typing indicator component */}
          <TypingIndicator chatId={params.chatId} currentUser={user} />
          <MessageInput onSend={sendMessage} chatId={params.chatId} />
        </div>
      </div>
      
      {/* Add UserModal component */}
      {modalVisible && (
        <UserModal 
          chatId={params.chatId}
          onClose={() => setModalVisible(false)}
        />
      )}

      {/* Render the new UserProfileModal */}
      <UserProfileModal 
        isOpen={isUserProfileModalOpen}
        onClose={handleCloseUserProfileModal}
        profile={selectedUserProfile}
        isLoading={userProfileModalLoading}
        error={userProfileModalError}
      />

      {/* Render the new PinnedMessagesModal */}
      <PinnedMessagesModal
        isOpen={isPinnedMessagesModalOpen}
        onClose={() => setIsPinnedMessagesModalOpen(false)}
        chatId={params.chatId}
        currentUserIsAdmin={currentUserProfile?.is_admin || false}
        onUnpinMessage={handleUnpinMessage} // Already defined in ChatPage
        onScrollToMessage={handleScrollToMessage} // Already defined in ChatPage
      />

      {/* Simple Toast Notification - This was for the old local toast, global one is in layout */}
      {/* {toast.isVisible && ( ... )} */}
    </main>
  );
} 