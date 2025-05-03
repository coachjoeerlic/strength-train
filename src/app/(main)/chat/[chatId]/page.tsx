'use client';

import { useEffect, useState, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import MessageBubble from '@/components/MessageBubble';
import MessageInput from '@/components/MessageInput';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Message } from '@/types/message';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

function ScrollToBottomButton({ visible, onClick, unreadCount = 0 }: { visible: boolean; onClick: () => void; unreadCount?: number }) {
  return (
    <button
      className={`fixed z-30 transition-opacity duration-300 bottom-20 right-6 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600 focus:outline-none ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      style={{ pointerEvents: visible ? 'auto' : 'none' }}
      onClick={onClick}
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

export default function ChatPage({ params }: { params: { chatId: string } }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const retryCountRef = useRef(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState<Set<string>>(new Set());
  const addToBatch = useBatchedMarkAsRead(supabase, setMessages, user);

  // Fetch initial messages
  useEffect(() => {
    async function fetchMessages() {
      try {
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
          .order('created_at', { ascending: true });

        if (error) throw error;
        console.log('Fetched messages:', data);

        // Get all user IDs from messages and replies
        const userIds = new Set([
          ...data.map(m => m.user_id),
          ...data.filter(m => m.reply_to).map(m => m.reply_to.user_id)
        ].filter(Boolean));
        console.log('User IDs to fetch:', Array.from(userIds));

        // Fetch profiles for all users
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', Array.from(userIds));

        if (profilesError) throw profilesError;
        console.log('Fetched profiles:', JSON.stringify(profilesData, null, 2));

        // Create a map of user IDs to profiles
        const profilesMap = new Map(
          profilesData.map(profile => [profile.id, profile])
        );
        console.log('Profiles map:', JSON.stringify(Object.fromEntries(profilesMap), null, 2));

        // Transform the data to include profiles, with fallback for missing reply_to
        const transformedData = await Promise.all(data.map(async (message) => {
          let replyTo = undefined;
          if (message.reply_to && Object.keys(message.reply_to).length > 0) {
            // Normal case: reply_to is populated
            replyTo = {
              ...message.reply_to,
              profiles: profilesMap.get(message.reply_to.user_id)
            };
          } else if (message.reply_to_message_id) {
            // Fallback: fetch the replied-to message and its profile
            const { data: replyMsg } = await supabase
              .from('messages')
              .select('content, user_id, media_url, media_type, is_read')
              .eq('id', message.reply_to_message_id)
              .single();
            if (replyMsg) {
              replyTo = {
                ...replyMsg,
                profiles: profilesMap.get(replyMsg.user_id)
              };
            }
          }
          const transformed = {
            ...message,
            profiles: profilesMap.get(message.user_id),
            reply_to: replyTo
          };
          console.log('Transformed message:', JSON.stringify(transformed, null, 2));
          return transformed;
        }));

        setMessages(transformedData);
      } catch (err) {
        setError('Failed to load messages');
        console.error('Error fetching messages:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchMessages();
  }, [params.chatId]);

  // Subscribe to realtime updates
  useEffect(() => {
    // Cleanup previous subscription
    if (channelRef.current) {
      channelRef.current.unsubscribe();
    }

    // Reset retry count
    retryCountRef.current = 0;

    // Create new subscription
    const channel = supabase
      .channel(`chat:${params.chatId}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${params.chatId}`,
        },
        async (payload: { 
          eventType: string; 
          new: {
            id: string;
            chat_id: string;
            content: string;
            created_at: string;
            user_id: string;
            media_url?: string;
            media_type?: 'image' | 'video' | 'gif';
            reply_to_message_id?: string;
            is_read: boolean;
          }
        }) => {
          console.log('Received realtime update:', payload);
          
          if (payload.eventType === 'INSERT') {
            const newMessage = payload.new;
            console.log('Processing new message:', newMessage);

            // Get the reply message data if it exists
            let replyToData = undefined;
            if (newMessage.reply_to_message_id) {
              // Fetch the replied-to message
              const { data: replyData } = await supabase
                .from('messages')
                .select('content, user_id, media_url, media_type, is_read')
                .eq('id', newMessage.reply_to_message_id)
                .single();

              if (replyData) {
                // Fetch the profile for the replied-to message
                const { data: replyProfile } = await supabase
                  .from('profiles')
                  .select('id, username')
                  .eq('id', replyData.user_id)
                  .single();
                replyToData = {
                  ...replyData,
                  profiles: replyProfile
                };
              }
            }

            // Get all user IDs from the message and reply
            const userIds = [newMessage.user_id];
            if (replyToData?.user_id) {
              userIds.push(replyToData.user_id);
            }

            // Fetch profiles for all users
            const { data: profilesData, error: profilesError } = await supabase
              .from('profiles')
              .select('id, username')
              .in('id', userIds);

            if (profilesError) {
              console.error('Error fetching profiles:', profilesError);
              return;
            }

            // Create a map of user IDs to profiles
            const profilesMap = new Map(
              profilesData.map(profile => [profile.id, profile])
            );

            // Transform the message to include profiles
            console.log('Real-time handler replyToData:', replyToData);
            let replyToProp = {};
            if (
              replyToData &&
              typeof replyToData === 'object' &&
              Object.keys(replyToData).length > 0 &&
              replyToData.user_id &&
              newMessage.reply_to_message_id &&
              (replyToData.content || replyToData.media_url)
            ) {
              replyToProp = {
                reply_to: {
                  ...replyToData,
                  profiles: profilesMap.get(replyToData.user_id) || (replyToData.profiles ?? undefined)
                }
              };
            }
            const transformedMessage: Message = {
              ...newMessage,
              status: 'sent',
              profiles: profilesMap.get(newMessage.user_id),
              ...replyToProp
            };

            setMessages((current) => {
              // Check if message already exists
              const exists = current.some(msg => msg.id === newMessage.id);
              if (exists) {
                // If the optimistic message had a reply_to and the real-time message does not, merge it in
                return current.map(msg => {
                  if (msg.id === newMessage.id) {
                    // Preserve the existing reply_to data if it exists and the new message doesn't have it
                    if (!transformedMessage.reply_to && msg.reply_to) {
                      return { ...transformedMessage, reply_to: msg.reply_to };
                    }
                    // If both have reply_to data, prefer the existing one if it's more complete
                    if (transformedMessage.reply_to && msg.reply_to) {
                      const existingReplyTo = msg.reply_to;
                      const newReplyTo = transformedMessage.reply_to;
                      // Keep the existing reply_to if it has more complete data
                      if (existingReplyTo.profiles && (!newReplyTo.profiles || Object.keys(existingReplyTo.profiles).length > Object.keys(newReplyTo.profiles).length)) {
                        return { ...transformedMessage, reply_to: existingReplyTo };
                      }
                    }
                    return transformedMessage;
                  }
                  return msg;
                });
              }
              // Add new message and sort by created_at
              return [...current, transformedMessage].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedMessage = payload.new;
            setMessages((current) =>
              current.map(msg =>
                msg.id === updatedMessage.id
                  ? { ...msg, ...updatedMessage }
                  : msg
              )
            );
          }
        }
      )
      .subscribe((status) => {
        console.log('Subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('Successfully connected to realtime updates');
          setIsConnected(true);
          setError(null);
          retryCountRef.current = 0;
        } else if (status === 'CHANNEL_ERROR') {
          retryCountRef.current += 1;
          if (retryCountRef.current === 1) {
            console.log('Reconnecting to realtime updates...');
            setError('Reconnecting to chat...');
          }
          setIsConnected(false);
        }
      });

    channelRef.current = channel;

    return () => {
      console.log('Cleaning up subscription');
      channel.unsubscribe();
      setIsConnected(false);
    };
  }, [params.chatId]);

  const sendMessage = async (content: string, mediaUrl?: string, mediaType?: 'image' | 'video' | 'gif') => {
    if (!user) return;

    // Create optimistic message
    let replyToProfiles = replyingTo?.profiles;
    if (replyingTo && !replyToProfiles) {
      // Try to find the profile from the messages state
      const foundProfile = messages.find(m => m.user_id === replyingTo.user_id)?.profiles;
      if (foundProfile) {
        replyToProfiles = foundProfile;
      } else if (replyingTo.user_id === user.id) {
        // If replying to self, use current user's info
        replyToProfiles = { username: currentUserProfile?.username || user.email || 'Me' };
      } else {
        // Fallback to email or placeholder
        replyToProfiles = { username: 'Unknown user' };
      }
    }
    const optimisticMessage: Message = {
      id: crypto.randomUUID(),
      content,
      user_id: user.id,
      created_at: new Date().toISOString(),
      status: 'sending',
      media_url: mediaUrl,
      media_type: mediaType,
      reply_to_message_id: replyingTo?.id,
      reply_to: replyingTo
        ? {
            content: replyingTo.content,
            user_id: replyingTo.user_id,
            media_url: replyingTo.media_url,
            media_type: replyingTo.media_type,
            profiles: replyToProfiles,
            is_read: replyingTo.is_read ?? false
          }
        : undefined,
      is_read: false,
    };

    // Add optimistic message to state
    setMessages((current) => [...current, optimisticMessage]);

    try {
      // Send message to Supabase
      const { data, error } = await supabase.from('messages').insert({
        chat_id: params.chatId,
        content,
        user_id: user.id,
        media_url: mediaUrl,
        media_type: mediaType,
        reply_to_message_id: replyingTo?.id,
        is_read: false,
      }).select(`
        *,
        is_read,
        reply_to:messages!reply_to_message_id (
          content,
          user_id,
          media_url,
          media_type,
          is_read
        )
      `).single();

      if (error) throw error;

      // Get profiles for the message and reply
      const userIds = [data.user_id];
      if (data.reply_to?.user_id) {
        userIds.push(data.reply_to.user_id);
      }

      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds);

      if (profilesError) throw profilesError;

      // Create a map of user IDs to profiles
      const profilesMap = new Map(
        profilesData.map(profile => [profile.id, profile])
      );

      // Transform the data to include profiles
      const transformedData = {
        ...data,
        profiles: profilesMap.get(data.user_id),
        reply_to: data.reply_to ? {
          ...data.reply_to,
          profiles: profilesMap.get(data.reply_to.user_id)
        } : undefined
      };

      // Update optimistic message with the real message
      setMessages((current) =>
        current.map((msg) =>
          msg.id === optimisticMessage.id ? { ...transformedData, status: 'sent' } : msg
        )
      );

      // Clear reply state
      setReplyingTo(null);
    } catch (err) {
      console.error('Error sending message:', err);
      // Update optimistic message status to failed
      setMessages((current) =>
        current.map((msg) =>
          msg.id === optimisticMessage.id ? { ...msg, status: 'failed' } : msg
        )
      );
    }
  };

  const handleReply = (message: Message) => {
    setReplyingTo(message);
  };

  const handleScrollToMessage = (messageId: string) => {
    const element = document.getElementById(`message-${messageId}`);
    if (element) {
      // Add a small delay to ensure the element is in the DOM
      setTimeout(() => {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('highlight');
        setTimeout(() => element.classList.remove('highlight'), 2000);
      }, 100);
    }
  };

  const retryMessage = async (messageId: string) => {
    const messageToRetry = messages.find((m) => m.id === messageId);
    if (!messageToRetry) return;

    // Update status to sending
    setMessages((current) =>
      current.map((msg) =>
        msg.id === messageId ? { ...msg, status: 'sending' } : msg
      )
    );

    try {
      const { data, error } = await supabase.from('messages').insert({
        chat_id: params.chatId,
        content: messageToRetry.content,
        user_id: user?.id,
      }).select().single();

      if (error) throw error;

      // Remove the failed message
      setMessages((current) => current.filter((msg) => msg.id !== messageId));
    } catch (err) {
      console.error('Error retrying message:', err);
      // Update status back to failed
      setMessages((current) =>
        current.map((msg) =>
          msg.id === messageId ? { ...msg, status: 'failed' } : msg
        )
      );
    }
  };

  // Find the current user's profile
  const currentUserProfile = messages.find(m => m.user_id === user?.id)?.profiles;

  // Scroll position detection for button visibility
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 10;
    setShowScrollButton(!atBottom);
    console.log('handleScroll called:', { atBottom, scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight });
  }, []);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll);
    // Initial check
    handleScroll();
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll, scrollContainerRef.current]);

  // Ensure scroll handler runs after messages are loaded/updated
  useEffect(() => {
    handleScroll();
  }, [messages, handleScroll]);

  // Unread message tracking
  useEffect(() => {
    // Only track unread for messages not sent by the current user
    const unreadMessages = messages.filter(
      (msg) => !msg.is_read && msg.user_id !== user?.id
    );
    setUnreadCount(unreadMessages.length);
    setFirstUnreadId(unreadMessages.length > 0 ? unreadMessages[0].id : null);
    console.log('Unread count recalculated:', unreadMessages.length, unreadMessages.map(m => ({id: m.id, is_read: m.is_read})));
  }, [messages, user]);

  const observeMessage = useMessageInView((id) => {
    setTimeout(() => {
      setMessages((msgs) => {
        const msg = msgs.find(m => m.id === id);
        if (msg && !msg.is_read && msg.user_id !== user?.id) {
          addToBatch(id);
        }
        return msgs;
      });
    }, 0);
  });

  // Add debug log before rendering the button
  console.log('Button render debug:', { showScrollButton, unreadCount, messagesLength: messages.length, firstUnreadId });

  if (loading) {
    return <div className="p-4">Loading messages...</div>;
  }

  return (
    <main className="h-screen flex flex-col">
      {error && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-4 px-4 pb-2">
          {messages.map((message) => (
            <div
              key={message.id}
              data-message-id={message.id}
              ref={node => observeMessage(node, message.id)}
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
          ))}
          <div ref={messagesEndRef} />
        </div>
        <ScrollToBottomButton
          visible={showScrollButton}
          onClick={() => {
            console.log('ScrollToBottomButton clicked', { unreadCount, firstUnreadId });
            if (unreadCount > 0 && firstUnreadId) {
              // Scroll to the first unread message
              const el = document.getElementById(`message-${firstUnreadId}`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            } else {
              // Scroll to bottom
              const container = scrollContainerRef.current;
              if (container) {
                container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
              }
            }
          }}
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