'use client';

import React from 'react';

interface SkeletonElementProps {
  className?: string;
}

const SkeletonElement: React.FC<SkeletonElementProps> = ({ className }) => {
  return (
    <div 
      className={`bg-gray-300 dark:bg-gray-700 animate-pulse rounded-md ${className || ''}`}
      role="status"
      aria-busy="true"
    />
  );
};

export default SkeletonElement; 