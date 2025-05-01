'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import NavBar from '@/components/NavBar';

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
  const { user } = useAuth();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const ITEMS_PER_PAGE = 15;

  const fetchChats = async (pageNum: number) => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('chats')
        .select(`
          id,
          name,
          last_message_at,
          chat_participants(
            user_id
          ),
          messages:messages(
            content,
            created_at,
            user_id
          ),
          unread_messages:messages(
            id,
            is_read
          )
        `)
        .order('last_message_at', { ascending: false })
        .range(pageNum * ITEMS_PER_PAGE, (pageNum + 1) * ITEMS_PER_PAGE - 1);

      if (error) throw error;

      const formattedChats = data.map(chat => {
        // Get the latest message
        const latestMessage = chat.messages?.sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0] || null;

        // Count unread messages
        const unreadCount = chat.unread_messages?.filter(m => !m.is_read).length || 0;

        return {
          id: chat.id,
          name: chat.name,
          last_message_at: chat.last_message_at,
          last_message: latestMessage,
          unread_count: unreadCount
        };
      });

      setChats(prev => pageNum === 0 ? formattedChats : [...prev, ...formattedChats]);
      setHasMore(formattedChats.length === ITEMS_PER_PAGE);
    } catch (error) {
      console.error('Error fetching chats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }

    fetchChats(0);

    // Subscribe to new messages
    const channel = supabase
      .channel('chat_updates')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'messages' 
      }, () => {
        fetchChats(0); // Refresh the list when messages change
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, router]);

  const loadMore = () => {
    if (!hasMore || loading) return;
    setPage(prev => prev + 1);
    fetchChats(page + 1);
  };

  if (loading && chats.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <main className="min-h-screen pb-20">
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-2xl font-bold mb-6">Chats</h1>
        
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