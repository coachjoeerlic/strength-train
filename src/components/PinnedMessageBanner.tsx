'use client';

import React from 'react';
import { Message } from '@/types/message';
import { Pin } from 'lucide-react';

interface PinnedMessageBannerProps {
  pinnedMessage: Message;
  onClick: () => void;
}

const MAX_SNIPPET_LENGTH = 60;

const PinnedMessageBanner: React.FC<PinnedMessageBannerProps> = ({ pinnedMessage, onClick }) => {
  let snippet = '';
  if (pinnedMessage.content) {
    snippet = pinnedMessage.content.length > MAX_SNIPPET_LENGTH 
      ? `${pinnedMessage.content.substring(0, MAX_SNIPPET_LENGTH)}...` 
      : pinnedMessage.content;
  } else if (pinnedMessage.media_type === 'image') {
    snippet = 'Photo';
  } else if (pinnedMessage.media_type === 'video') {
    snippet = 'Video';
  } else if (pinnedMessage.media_type === 'gif') {
    snippet = 'GIF';
  } else {
    snippet = 'Message pinned'; // Fallback
  }

  const authorName = pinnedMessage.profiles?.username || 'User';

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center p-2.5 bg-blue-50 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-gray-600 transition-colors cursor-pointer border-b border-blue-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500"
      aria-label={`Pinned message: ${authorName} says ${snippet}`}
    >
      <Pin className="h-4 w-4 text-blue-500 dark:text-blue-400 mr-2.5 flex-shrink-0" />
      <div className="flex-1 min-w-0 text-left">
        <span className="text-xs font-semibold text-blue-600 dark:text-blue-300 block truncate">
          Pinned by {authorName} {/* For MVP, assuming pinner is author. This can be enhanced later if pinning stores pinner_id */}
        </span>
        <p className="text-sm text-gray-700 dark:text-gray-200 truncate">
          {snippet}
        </p>
      </div>
    </button>
  );
};

export default PinnedMessageBanner; 