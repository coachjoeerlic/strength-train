'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import MessageBubble from '@/components/MessageBubble';
import MessageInput from '@/components/MessageInput';
import { RealtimeChannel } from '@supabase/supabase-js';

type Message = {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  status: 'sending' | 'sent' | 'failed';
  media_url?: string;
  media_type?: 'image' | 'video' | 'gif';
};

export default function ChatPage({ params }: { params: { chatId: string } }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const retryCountRef = useRef(0);

  // Fetch initial messages
  useEffect(() => {
    async function fetchMessages() {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', params.chatId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        setMessages(data || []);
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
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${params.chatId}`,
        },
        (payload) => {
          console.log('Received realtime update:', payload);
          console.log('Current messages:', messages);
          
          if (payload.eventType === 'INSERT') {
            const newMessage = payload.new as Message;
            console.log('Processing new message:', newMessage);
            setMessages((current) => {
              // Check if message already exists
              const exists = current.some(msg => msg.id === newMessage.id);
              console.log('Message exists:', exists);
              if (exists) return current;
              
              // Add new message and sort by created_at
              const updated = [...current, newMessage].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
              console.log('Updated messages:', updated);
              return updated;
            });
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

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (content: string, mediaUrl?: string, mediaType?: 'image' | 'video' | 'gif') => {
    if (!user) return;

    // Create optimistic message
    const optimisticMessage: Message = {
      id: crypto.randomUUID(),
      content,
      user_id: user.id,
      created_at: new Date().toISOString(),
      status: 'sending',
      media_url: mediaUrl,
      media_type: mediaType,
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
      }).select().single();

      if (error) throw error;

      // Update optimistic message with the real message
      setMessages((current) =>
        current.map((msg) =>
          msg.id === optimisticMessage.id ? { ...data, status: 'sent' } : msg
        )
      );
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

  if (loading) {
    return <div className="p-4">Loading messages...</div>;
  }

  return (
    <main className="min-h-screen flex flex-col">
      {error && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isOwnMessage={message.user_id === user?.id}
              onRetry={() => retryMessage(message.id)}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="p-4 border-t">
        <MessageInput onSend={sendMessage} chatId={params.chatId} />
      </div>
    </main>
  );
} 