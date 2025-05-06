'use client';

import { useEffect, useState, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import MessageBubble from '@/components/MessageBubble';
import MessageInput from '@/components/MessageInput';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Message } from '@/types/message';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import debounce from 'lodash.debounce';

function ScrollToBottomButton({ visible, onClick, unreadCount = 0 }: { visible: boolean; onClick: (event: React.MouseEvent) => void; unreadCount?: number }) {
  return (
    <button
      className={`fixed z-30 transition-opacity duration-300 bottom-20 right-6 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600 focus:outline-none ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
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

  // Add refs for unread state
  const unreadCountRef = useRef(0);
  const firstUnreadIdRef = useRef<string | null>(null);

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
          currentShowButton: showScrollButton,
          shouldShowButton: !isNearBottom || unreadCount > 0
        });

        // Show button if we're not near bottom OR if there are unread messages
        setShowScrollButton(!isNearBottom || unreadCount > 0);
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
  }, [messages, scrollContainerReady, unreadCount, firstUnreadId, showScrollButton]);

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
    if (isLoadingMoreRef.current || !scrollContainerRef.current) return;
    
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

          const cursorTime = lastMessage.created_at;
          console.log('[PAGINATION] Fetching with cursor:', {
            cursorTime,
            lastMessageId: lastMessage.id,
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
              reply_to:messages!reply_to_message_id (
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

            // Create a Map of existing messages for faster lookup
            const existingMessages = new Map(messages.map(msg => [msg.id, msg]));
            
            // Filter out any messages that already exist
            const newMessages = transformedData.filter(msg => !existingMessages.has(msg.id));
            
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
            const allMessages = [...messages, ...newMessages].sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );

            // Update cursor with the newest message from the fetched data
            const newCursor = transformedData[transformedData.length - 1].id;
            const newCursorTime = transformedData[transformedData.length - 1].created_at;

            console.log('[PAGINATION] Updating state:', {
              oldMessageCount: messages.length,
              newMessageCount: allMessages.length,
              oldCursorTime: cursorTime,
              newCursorTime,
              hasMoreMessages: totalNewerCount > newMessages.length,
              fetchState: fetchState.current
            });

            // Update all states in a single batch and wait for them to complete
            await Promise.all([
              new Promise<void>(resolve => {
                setMessages(allMessages);
                resolve();
              }),
              new Promise<void>(resolve => {
                setNewestCursor(newCursor);
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
        } catch (err) {
          console.error('[PAGINATION] Error in fetchNewerMessages:', err);
          setError('Failed to load newer messages');
          setHasNewer(false);
          throw err;
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
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          const scrollDiff = newScrollHeight - oldScrollHeight;
          container.scrollTop = oldScrollTop + scrollDiff;
        }
      });
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [hasNewer, params.chatId, messages, processFetchQueue]);

  // Helper: Fetch more messages (pagination)
  const fetchMoreMessages = useCallback(async () => {
    if (!hasMore || loadingMore || !oldestCursor || isLoadingMoreRef.current || fetchState.current !== 'idle') {
      console.log('[PAGINATION] Skipping fetchMoreMessages:', {
        hasMore,
        loadingMore,
        oldestCursor,
        isLoadingMore: isLoadingMoreRef.current,
        fetchState: fetchState.current,
        currentMessageCount: messages.length,
        reason: !hasMore ? 'No more messages' : 
                loadingMore ? 'Already loading' : 
                !oldestCursor ? 'No cursor' : 
                isLoadingMoreRef.current ? 'Loading in progress' :
                fetchState.current !== 'idle' ? 'Fetch state not idle' : 'Unknown'
      });
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

    try {
      // Save current scroll position and height
      const container = scrollContainerRef.current;
      const prevScrollHeight = container?.scrollHeight || 0;
      const prevScrollTop = container?.scrollTop || 0;

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
              reply_to:messages!reply_to_message_id (
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

              // Restore scroll position
              requestAnimationFrame(() => {
                if (container) {
                  const newScrollHeight = container.scrollHeight;
                  const scrollDiff = newScrollHeight - prevScrollHeight;
                  container.scrollTop = prevScrollTop + scrollDiff;
                }
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
          reply_to:messages!reply_to_message_id (
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

        // Set updating state
        fetchState.current = 'updating';
        console.log('[PAGINATION] State transition: fetching -> updating');

        setMessages(prevMessages => {
          // Create a Map of existing messages for faster lookup
          const existingMessages = new Map(prevMessages.map(msg => [msg.id, msg]));
          
          // Filter out any messages that already exist
          const newMessages = transformedData.filter(msg => !existingMessages.has(msg.id));
          
          if (newMessages.length === 0) {
            console.log('[PAGINATION] No new messages to add, all were duplicates or empty fetch');
            setHasMore(false);
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
            duplicateCount: transformedData.length - newMessages.length
          });

          // Restore scroll position after state update
          requestAnimationFrame(() => {
            if (container) {
              const newScrollHeight = container.scrollHeight;
              const scrollDiff = newScrollHeight - prevScrollHeight;
              container.scrollTop = prevScrollTop + scrollDiff;
            }
          });

          return allMessages;
        });

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
    } catch (err) {
      console.error('[PAGINATION] Error fetching more messages:', err);
      setError('Failed to load more messages');
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
    const debouncedFetch = debounce((isTop: boolean) => {
      if (isLoadingMoreRef.current || fetchState.current !== 'idle') {
        console.log('[PAGINATION] Skipping debounced fetch:', {
          isLoadingMore: isLoadingMoreRef.current,
          fetchState: fetchState.current
        });
        return;
      }

      if (isTop && hasMore) {
        console.log('[PAGINATION] Triggering older messages fetch');
        fetchMoreMessages();
      } else if (!isTop && hasNewer) {
        console.log('[PAGINATION] Triggering newer messages fetch');
        fetchNewerMessages();
      }
    }, 500); // Increased debounce time to 500ms

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
            debouncedFetch(isTop);
          }
        });
      },
      {
        root: scrollContainerRef.current,
        rootMargin: '300px', // Increased from 200px to 300px to trigger earlier
        threshold: 0.1
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
      debouncedFetch.cancel();
    };
  }, [scrollContainerReady, messages.length, hasMore, hasNewer, fetchMoreMessages, fetchNewerMessages, testMode]);

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
      if (topMessageRef.current && hasMore) {
        console.log('[PAGINATION] Setting up top observer');
        observerRef.current.observe(topMessageRef.current);
      }
      if (bottomMessageRef.current && hasNewer) {
        console.log('[PAGINATION] Setting up bottom observer:', {
          hasNewer,
          currentMessageCount: messages.length,
          lastMessageTime: messages[messages.length - 1]?.created_at,
          fetchState: fetchState.current
        });
        observerRef.current.observe(bottomMessageRef.current);
      }
    }
  }, [messages.length, hasMore, hasNewer]);

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
    setReplyingTo(message);
  }, []);

  const handleScrollToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`message-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const retryMessage = useCallback((messageId: string) => {
    // Implement retry logic here
    console.log('Retrying message:', messageId);
  }, []);

  const sendMessage = useCallback(async (content: string, mediaUrl?: string, mediaType?: string) => {
    if (!user) return;
    
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

      setReplyingTo(null);
    } catch (err) {
      console.error('Error sending message:', err);
      setError('Failed to send message');
    }
  }, [user, params.chatId, replyingTo]);

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
          reply_to:messages!reply_to_message_id (
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
      if (!user || initialFetchRef.current || fetchPromiseRef.current) {
        console.log('[INITIAL] Skipping initial fetch:', {
          hasUser: !!user,
          alreadyFetched: initialFetchRef.current,
          hasPendingFetch: !!fetchPromiseRef.current
        });
        return;
      }
      
      try {
        console.log('[INITIAL] Starting initial message fetch');
        initialFetchRef.current = true;
        
        fetchPromiseRef.current = (async () => {
          await new Promise(resolve => setTimeout(resolve, 100));

          if (!isMounted) {
            console.log('[INITIAL] Component unmounted before fetch');
            return;
          }

          // First, get the total count of messages
          const { count: totalMessageCount } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('chat_id', params.chatId);

          console.log('[INITIAL] Initial fetch info:', {
            totalMessageCount: totalMessageCount || 0
          });

          let query = supabase
            .from('messages')
            .select(`
              *,
              is_read,
              reply_to:messages!reply_to_message_id (
                content,
                user_id,
                media_url,
                media_type,
                is_read
              )
            `)
            .eq('chat_id', params.chatId);

          // Modify query based on test mode
          if (testMode === 'top') {
            // For top loading, fetch oldest messages first
            query = query.order('created_at', { ascending: true }).limit(100);
          } else {
            // For bottom loading, fetch newest messages first
            query = query.order('created_at', { ascending: false }).limit(100);
          }

          const { data, error } = await query;

          if (error) {
            console.error('[INITIAL] Error fetching messages:', error);
            throw error;
          }

          if (!isMounted) {
            console.log('[INITIAL] Component unmounted after fetch');
            return;
          }

          if (data && data.length > 0) {
            console.log('[INITIAL] Fetched messages:', {
              count: data.length,
              firstMessageTime: data[data.length - 1].created_at,
              lastMessageTime: data[0].created_at,
              testMode,
              totalMessageCount
            });

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
              console.error('[INITIAL] Error fetching profiles:', profilesError);
              throw profilesError;
            }

            if (!isMounted) {
              console.log('[INITIAL] Component unmounted after profiles fetch');
              return;
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

            // Sort messages based on test mode
            const sortedMessages = testMode === 'top' 
              ? transformedData 
              : transformedData.sort((a, b) => 
                  new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );

            console.log('[INITIAL] Setting initial messages:', {
              count: sortedMessages.length,
              firstMessageTime: sortedMessages[0].created_at,
              lastMessageTime: sortedMessages[sortedMessages.length - 1].created_at,
              testMode,
              totalMessageCount: totalMessageCount || 0,
              hasMore: (totalMessageCount || 0) > sortedMessages.length
            });

            // Set initial messages and cursors
            setMessages(sortedMessages);
            setOldestCursor(sortedMessages[0].id);
            setNewestCursor(sortedMessages[sortedMessages.length - 1].id);
            setHasMore((totalMessageCount || 0) > sortedMessages.length);
            setHasNewer(testMode === 'top');

            // Force scroll position based on test mode
            if (testMode === 'top') {
              // For top loading, scroll to top
              requestAnimationFrame(() => {
                const container = scrollContainerRef.current;
                if (container) {
                  container.scrollTop = 0;
                  console.log('[INITIAL] Forced scroll to top');
                }
              });
            }
          } else {
            console.log('[INITIAL] No messages found');
            setHasMore(false);
            setHasNewer(false);
          }
        })();

        await fetchPromiseRef.current;
      } catch (err) {
        console.error('[INITIAL] Error in fetchInitialMessages:', err);
        setError('Failed to load messages');
        initialFetchRef.current = false;
      } finally {
        if (isMounted) {
          setLoading(false);
        }
        fetchPromiseRef.current = null;
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
  }, [user, params.chatId, testMode]);

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
    const container = scrollContainerRef.current;
    if (!container) return;

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
              reply_to:messages!reply_to_message_id (
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
              reply_to:messages!reply_to_message_id (
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
          console.log('[REALTIME] New message received:', {
            messageId: payload.new.id,
            userId: payload.new.user_id,
            isOwnMessage: payload.new.user_id === user.id,
            currentUnreadCount: unreadCountRef.current,
            firstUnreadId: firstUnreadIdRef.current
          });

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

            console.log('[REALTIME] Unread state updated:', {
              newUnreadCount: unreadCountRef.current,
              firstUnreadId: firstUnreadIdRef.current
            });
          }

          // Get the new message with profile info
          const { data: messageData, error: messageError } = await supabase
            .from('messages')
            .select(`
              *,
              is_read,
              reply_to:messages!reply_to_message_id (
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

          // Get profile for the new message
          const { data: profileData } = await supabase
            .from('profiles')
            .select('id, username')
            .eq('id', payload.new.user_id)
            .single();

          if (messageData) {
            const newMessage = {
              ...messageData,
              profiles: profileData,
              reply_to: messageData.reply_to ? {
                ...messageData.reply_to,
                profiles: profileData
              } : undefined
            };

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

  if (loading) {
    return <div className="p-4">Loading messages...</div>;
  }

  return (
    <main className="h-screen flex flex-col">
      <TestModeToggle />
      <TestControls />
      <TestModeIndicator />
      {error && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div ref={handleScrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-4 px-4 pb-2">
          {messages.map((message, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === messages.length - 1;
            
            return (
              <div
                key={message.id}
                data-message-id={message.id}
                ref={isFirst ? (el => { 
                  topMessageRef.current = el; 
                  observeMessage(el, message.id); 
                }) : 
                isLast ? (el => { 
                  bottomMessageRef.current = el; 
                  observeMessage(el, message.id); 
                }) :
                (el => observeMessage(el, message.id))}
                id={`message-${message.id}`}
              >
                <MessageBubble
                  message={message}
                  isOwnMessage={message.user_id === user?.id}
                  ownUsername={currentUserProfile?.username || user?.email || 'Me'}
                  onRetry={() => retryMessage(message.id)}
                  onReply={handleReply}
                  onScrollToMessage={handleScrollToMessage}
                />
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
        <ScrollToBottomButton
          visible={showScrollButton}
          onClick={handleScrollButtonClick}
          unreadCount={unreadCount}
        />
      </div>
      <div className="flex-shrink-0 border-t bg-white">
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
          <MessageInput onSend={sendMessage} chatId={params.chatId} />
        </div>
      </div>
    </main>
  );
} 