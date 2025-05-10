'use client';

import React from 'react';
import SkeletonElement from './SkeletonElement';

interface MessageBubbleSkeletonProps {
  isOwnMessage: boolean;
}

const MessageBubbleSkeleton: React.FC<MessageBubbleSkeletonProps> = ({ isOwnMessage }) => {
  return (
    <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'} w-full`}>
      <div className={`flex items-end gap-2 ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'} w-full`}>
        {/* Avatar Placeholder (for other users' messages) */}
        {!isOwnMessage && (
          <SkeletonElement className="h-8 w-8 rounded-full flex-shrink-0" />
        )}

        {/* Bubble Content Placeholder */}
        <div 
          className={`max-w-[75%] p-3 rounded-lg 
            ${isOwnMessage ? 'bg-blue-400 rounded-br-none' : 'bg-gray-300 dark:bg-gray-600 rounded-bl-none'}
            // Using slightly different colors for the skeleton bubble itself to distinguish from SkeletonElement
          `}
        >
          {/* Optional: Username placeholder inside bubble for other users' messages */}
          {!isOwnMessage && (
            <SkeletonElement className="h-3 w-1/3 mb-1.5 rounded bg-gray-400 dark:bg-gray-500" />
          )}
          {/* Message content lines */}
          <SkeletonElement className={`h-4 ${isOwnMessage ? 'w-28' : 'w-32'} mb-1 rounded ${isOwnMessage ? 'bg-blue-300' : 'bg-gray-400 dark:bg-gray-500'}`} />
          <SkeletonElement className={`h-4 ${isOwnMessage ? 'w-20' : 'w-24'} rounded ${isOwnMessage ? 'bg-blue-300' : 'bg-gray-400 dark:bg-gray-500'}`} />
          
          {/* Timestamp placeholder - kept simple, below content */}
          <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} mt-1.5`}>
            <SkeletonElement className={`h-2.5 w-10 rounded ${isOwnMessage ? 'bg-blue-300' : 'bg-gray-400 dark:bg-gray-500'}`} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageBubbleSkeleton; 