'use client';

import React from 'react';
import SkeletonElement from './SkeletonElement';

const ChatListItemSkeleton: React.FC = () => {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow flex items-center space-x-4">
      {/* Avatar Skeleton */}
      <SkeletonElement className="h-12 w-12 rounded-full flex-shrink-0" />
      
      {/* Text Content Skeleton */}
      <div className="flex-1 min-w-0 space-y-2">
        <SkeletonElement className="h-4 w-3/4 rounded" /> 
        <SkeletonElement className="h-3 w-1/2 rounded" /> 
      </div>
      
      {/* Timestamp & Badge Skeleton */}
      <div className="flex flex-col items-end space-y-1 flex-shrink-0">
        <SkeletonElement className="h-3 w-12 rounded mb-1" /> 
        <SkeletonElement className="h-5 w-5 rounded-full" /> 
      </div>
    </div>
  );
};

export default ChatListItemSkeleton; 