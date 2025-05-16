'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import NavBar from '@/components/NavBar';
import ChatListItemSkeleton from '@/components/Skeletons/ChatListItemSkeleton';
import { ShieldAlert } from 'lucide-react';

type Chat = {
  id: string;
  name: string;
  last_message_at: string;
  last_message: {
    content: string;
    created_at: string;
    user_id: string;
  } | null;
  unread_count: number;
};

export default function ChatsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const ITEMS_PER_PAGE = 15;

  useEffect(() => {
    const fetchAdminStatus = async () => {
      if (user) {
        try {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', user.id)
            .single();
          if (error) throw error;
          if (profile) {
            setIsAdmin(profile.is_admin || false);
          }
        } catch (err) {
          console.error("Error fetching admin status:", err);
          setIsAdmin(false);
        }
      }
    };
    if (!authLoading) {
      fetchAdminStatus();
    }
  }, [user, authLoading]);

  const fetchChats = useCallback(async (pageNum: number) => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    console.log(`[ChatsPage] fetchChats (Restored Structure) called for user: ${user.id}, pageNum: ${pageNum}`);

    try {
      const { data, error } = await supabase
        .from('chats')
        .select(`
          id,
          name,
          last_message_at,
          chat_participants(user_id),
          messages(content, created_at, user_id, is_read)
        `)
        .order('last_message_at', { ascending: false })
        .range(pageNum * ITEMS_PER_PAGE, (pageNum + 1) * ITEMS_PER_PAGE - 1);

      if (error) {
        console.error('[ChatsPage] Error in Restored fetchChats query:', error);
        setChats([]);
        setHasMore(false);
        throw error;
      }

      console.log('[ChatsPage] Raw data from Restored fetchChats query:', data);

      if (data) {
        const formattedChats = data.map(chat => {
          const sortedMessages = chat.messages?.sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          const latestMessage = sortedMessages?.[0] || null;
          
          const unreadCount = chat.messages?.filter(m => !m.is_read && m.user_id !== user.id).length || 0;

          return {
            id: chat.id,
            name: chat.name,
            last_message_at: chat.last_message_at,
            last_message: latestMessage ? { 
                content: latestMessage.content,
                created_at: latestMessage.created_at,
                user_id: latestMessage.user_id
            } : null,
            unread_count: unreadCount
          };
        });
        setChats(prev => pageNum === 0 ? formattedChats : [...prev, ...formattedChats]);
        setHasMore(formattedChats.length === ITEMS_PER_PAGE);
      } else {
        setChats([]);
        setHasMore(false);
      }

    } catch (error) { 
      console.error('Error fetching chats (Restored overall catch):', error);
      setChats([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [user, ITEMS_PER_PAGE]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      fetchChats(0);
    }

    // Listen for new messages or updates that should refresh the chat list
    const messagesChannel = supabase
      .channel('messages_realtime_for_chatlist') // Unique channel name
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'messages' 
        // Consider adding a filter if this becomes too noisy, e.g., for messages in user's chats
      }, (payload) => {
        console.log('[ChatsPage] New message or message update detected, refetching chats:', payload);
        fetchChats(0); 
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[ChatsPage] Subscribed to messages_realtime_for_chatlist');
        }
      });

    // Listen for changes in chat participation (e.g., new chat created for user, user added/removed)
    const participantsChannel = supabase
      .channel('participants_realtime_for_chatlist') // Unique channel name
      .on('postgres_changes', {
        event: 'INSERT', // Listen for new participations
        schema: 'public',
        table: 'chat_participants'
        // We might want to filter for efficiency if user is available: filter: `user_id=eq.${user.id}`
        // However, for a new chat created by a trigger, this user.id might not be available immediately in the filter context
        // or the insert might be for the other participant (admin). A general refetch on any new participation is safer for now.
      }, (payload) => {
        console.log('[ChatsPage] New chat participation detected, refetching chats:', payload);
        fetchChats(0); 
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[ChatsPage] Subscribed to participants_realtime_for_chatlist');
        }
      });

    return () => {
      supabase.removeChannel(messagesChannel).catch(err => console.error('Error removing messagesChannel:', err));
      supabase.removeChannel(participantsChannel).catch(err => console.error('Error removing participantsChannel:', err));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, router]); // fetchChats is memoized with user, so it's stable if user is stable.
  // Added authLoading and router as they are used in the effect.
  // fetchChats itself is stable due to useCallback with [user] dependency.

  const loadMore = () => {
    if (!hasMore || loading) return;
    setPage(prev => prev + 1);
    fetchChats(page + 1);
  };

  if (loading && chats.length === 0) {
    return (
      <main className="min-h-screen pb-20">
        <div className="max-w-md mx-auto p-4">
          <h1 className="text-2xl font-bold mb-6">Chats</h1>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <ChatListItemSkeleton key={index} />
            ))}
          </div>
      </div>
        <NavBar />
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-20">
      <div className="max-w-md mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Chats</h1>
          {isAdmin && (
            <Link href="/admin/flags" className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Admin Flag Portal">
              <ShieldAlert className="h-6 w-6 text-orange-500" />
            </Link>
          )}
        </div>
        
        <div className="space-y-2">
          {chats.map(chat => (
            <Link
              key={chat.id}
              href={`/chat/${chat.id}`}
              className="block bg-white rounded-lg shadow p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold truncate">{chat.name}</h2>
                  {chat.last_message && (
                    <p className="text-gray-600 text-sm truncate">
                      {chat.last_message.content}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end ml-4">
                  <span className="text-xs text-gray-500">
                    {new Date(chat.last_message_at).toLocaleDateString()}
                  </span>
                  {chat.unread_count > 0 && (
                    <span className="mt-1 bg-blue-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                      {chat.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loading}
            className="w-full mt-4 py-2 text-blue-500 hover:text-blue-600 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        )}
      </div>
      <NavBar />
    </main>
  );
} 