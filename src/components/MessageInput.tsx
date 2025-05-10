'use client';

import { useState, FormEvent, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { setTypingStatus, removeTypingStatus, cleanupTyping } from '@/lib/typingService';
import { useAuth } from '@/lib/AuthContext';
import { useToasts } from '@/contexts/ToastContext';

interface MessageInputProps {
  onSend: (content: string, mediaUrl?: string, mediaType?: 'image' | 'video' | 'gif') => void;
  chatId: string;
}

interface GifResult {
  id: string;
  title: string;
  media_formats: {
    gif: { url: string };
    tinygif: { url: string };
  };
}

export default function MessageInput({ onSend, chatId }: MessageInputProps) {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const { showToast } = useToasts();
  const [isGifSearchOpen, setIsGifSearchOpen] = useState(false);
  const [gifSearchQuery, setGifSearchQuery] = useState('');
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [isSearchingGifs, setIsSearchingGifs] = useState(false);
  const [isSendDisabled, setIsSendDisabled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();

  // Clean up typing status when component unmounts
  useEffect(() => {
    return () => {
      if (user?.id) {
        cleanupTyping(user.id, chatId);
      }
    };
  }, [user?.id, chatId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (isSendDisabled) {
      showToast("Please wait a moment before sending another message.", 'info', 2000);
      return;
    }

    if (!message.trim() && !isUploading) return;

    // Clear typing status when sending a message
    if (user?.id) {
      removeTypingStatus(user.id, chatId);
    }

    onSend(message);
    setMessage('');

    setIsSendDisabled(true);
    setTimeout(() => {
      setIsSendDisabled(false);
    }, 2000);
  };

  // Handle typing detection
  const handleTyping = () => {
    if (user?.id) {
      setTypingStatus(user.id, chatId);
    }
  };

  const handleMessageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    handleTyping();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm'];
    if (!validTypes.includes(file.type)) {
      showToast('Invalid file type. Please select an image or video.', 'error');
      return;
    }

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      showToast('File is too large. Maximum size is 10MB.', 'error');
      return;
    }

    setIsUploading(true);

    try {
      // Generate a unique file name
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${chatId}/${fileName}`;

      // Upload file to Supabase Storage
      const { error: uploadError, data } = await supabase.storage
        .from('chat-media')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('chat-media')
        .getPublicUrl(filePath);

      // Determine media type
      let mediaType: 'image' | 'video' | 'gif' = file.type.startsWith('image/') ? 'image' : 'video';
      if (file.type === 'image/gif') {
        mediaType = 'gif';
      }

      // Clear typing status when sending a message
      if (user?.id) {
        removeTypingStatus(user.id, chatId);
      }

      // Send message with media
      onSend(message, publicUrl, mediaType);
      setMessage('');
    } catch (error: any) {
      console.error('Error uploading file:', error);
      showToast(error.message || 'Failed to upload file. Please try again.', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const searchGifs = async (query: string) => {
    if (!query.trim()) {
      setGifResults([]);
      return;
    }

    const apiKey = process.env.NEXT_PUBLIC_TENOR_API_KEY;
    if (!apiKey) {
      showToast('GIF search is not configured. Please contact support.', 'error');
      return;
    }

    setIsSearchingGifs(true);
    try {
      const response = await fetch(
        `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${apiKey}&client_key=strength-train&limit=10`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setGifResults(data.results || []);
    } catch (error) {
      console.error('Error searching GIFs:', error);
      showToast('Failed to search GIFs. Please try again.', 'error');
      setGifResults([]);
    } finally {
      setIsSearchingGifs(false);
    }
  };

  const handleGifSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setGifSearchQuery(query);

    // Debounce search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      searchGifs(query);
    }, 300);
  };

  const handleGifSelect = (gif: GifResult) => {
    // Clear typing status when sending a message
    if (user?.id) {
      removeTypingStatus(user.id, chatId);
    }
    
    if (isSendDisabled) {
      showToast("Please wait a moment before sending another message.", 'info', 2000);
      // It might be better to also close the GIF search panel here if the send is blocked
      // setIsGifSearchOpen(false); // Optional: close panel if rate limited
      return;
    }
    
    onSend(message, gif.media_formats.gif.url, 'gif');
    setMessage('');
    setIsGifSearchOpen(false);
    setGifSearchQuery('');
    setGifResults([]);

    setIsSendDisabled(true);
    setTimeout(() => {
      setIsSendDisabled(false);
    }, 2000);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {isGifSearchOpen && (
        <div className="border rounded-lg p-4 bg-white shadow-lg">
          <input
            type="text"
            value={gifSearchQuery}
            onChange={handleGifSearch}
            placeholder="Search GIFs..."
            className="w-full p-2 border rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          {isSearchingGifs ? (
            <div className="text-center py-4">Searching...</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
              {gifResults.map((gif) => (
                <button
                  key={gif.id}
                  onClick={() => handleGifSelect(gif)}
                  className="relative aspect-video hover:opacity-90 transition-opacity"
                >
                  <img
                    src={gif.media_formats.tinygif.url}
                    alt={gif.title}
                    className="w-full h-full object-cover rounded"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 w-full">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          disabled={isUploading}
        >
          📎
        </button>
        <button
          type="button"
          onClick={() => setIsGifSearchOpen(!isGifSearchOpen)}
          className="p-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          disabled={isUploading}
        >
          GIF
        </button>
      <input
        type="text"
          value={message}
          onChange={handleMessageChange}
          onBlur={() => {
            if (user?.id && !message.trim()) {
              removeTypingStatus(user.id, chatId);
            }
          }}
        placeholder="Type a message..."
          className="flex-1 min-w-0 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isUploading}
        />
        <button
          type="submit"
          disabled={(!message.trim() && !isUploading) || isUploading || isSendDisabled}
          className="p-2 bg-blue-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600 flex-shrink-0"
        >
          {isUploading ? 'Uploading...' : isSendDisabled ? 'Wait...' : 'Send'}
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*,video/mp4,video/webm"
          className="hidden"
          disabled={isUploading}
      />
    </div>
    </form>
  );
} 