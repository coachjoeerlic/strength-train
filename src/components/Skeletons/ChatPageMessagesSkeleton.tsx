'use client';

import React from 'react';
import MessageBubbleSkeleton from './MessageBubbleSkeleton';

interface ChatPageMessagesSkeletonProps {
  count?: number; // Optional prop to control how many skeleton bubbles to show
}

const ChatPageMessagesSkeleton: React.FC<ChatPageMessagesSkeletonProps> = ({ count = 6 }) => {
  return (
    <div className="max-w-2xl mx-auto space-y-5 px-4 pb-2 pt-2">
      {Array.from({ length: count }).map((_, index) => (
        <MessageBubbleSkeleton key={index} isOwnMessage={index % 2 !== 0} />
        // Alternating: index 0 (other), 1 (own), 2 (other), ...
      ))}
    </div>
  );
};

export default ChatPageMessagesSkeleton; 