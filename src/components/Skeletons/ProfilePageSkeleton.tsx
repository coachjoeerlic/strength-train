'use client';

import React from 'react';
import SkeletonElement from './SkeletonElement';

const ProfilePageSkeleton: React.FC = () => {
  return (
    <div className="max-w-md mx-auto p-4">
      {/* Header Skeleton (Optional - if the header also has loading state or is part of this view) */}
      {/* For now, focusing on the main profile card content */}
      <div className="flex justify-between items-center mb-6">
        <SkeletonElement className="h-7 w-1/4 rounded" /> {/* Title: Profile */}
        <SkeletonElement className="h-8 w-8 rounded-full" /> {/* Chat Icon Badge */}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-6">
        {/* Avatar Skeleton */}
        <div className="flex justify-center">
          <SkeletonElement className="h-24 w-24 rounded-full" />
        </div>

        {/* Username & Bio Skeleton */}
        <div className="space-y-3 text-center">
          <SkeletonElement className="h-6 w-1/2 mx-auto rounded" /> {/* Username */}
          <SkeletonElement className="h-4 w-3/4 mx-auto rounded" /> {/* Bio line 1 */}
          <SkeletonElement className="h-4 w-5/6 mx-auto rounded" /> {/* Bio line 2 (slightly different) */}
        </div>

        {/* Buttons Skeleton */}
        <div className="flex space-x-4 pt-4">
          <SkeletonElement className="h-10 flex-1 rounded-md" /> {/* Edit/Save Button */}
          <SkeletonElement className="h-10 flex-1 rounded-md" /> {/* Logout/Cancel Button */}
        </div>
      </div>
    </div>
  );
};

export default ProfilePageSkeleton; 