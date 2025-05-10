'use client';

import React from 'react';
import { useToasts } from '@/contexts/ToastContext'; // Adjust path as needed
import ToastItem from './ToastItem'; // Adjust path as needed
import { AnimatePresence } from 'framer-motion';

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToasts();

  if (!toasts.length) {
    return null;
  }

  return (
    <div
      aria-live="assertive"
      className="fixed top-5 right-5 z-[200] flex flex-col items-end space-y-2"
      // Using a high z-index to ensure it's above most other UI elements
    >
      <AnimatePresence initial={false}>
        {/* Toasts are added to the top of the array, so we don't need to reverse here for visual order */}
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default ToastContainer; 