'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toast, ToastType } from '@/contexts/ToastContext'; // Adjust path as needed
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'; // Using lucide-react icons

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const toastConfig = {
  success: {
    bgColor: 'bg-green-500',
    icon: <CheckCircle className="h-5 w-5 text-white" />,
    borderColor: 'border-green-600',
  },
  error: {
    bgColor: 'bg-red-500',
    icon: <XCircle className="h-5 w-5 text-white" />,
    borderColor: 'border-red-600',
  },
  info: {
    bgColor: 'bg-blue-500',
    icon: <Info className="h-5 w-5 text-white" />,
    borderColor: 'border-blue-600',
  },
  warning: {
    bgColor: 'bg-yellow-500',
    icon: <AlertTriangle className="h-5 w-5 text-white" />,
    borderColor: 'border-yellow-600',
  },
};

const ToastItem: React.FC<ToastItemProps> = ({ toast, onRemove }) => {
  const config = toastConfig[toast.type];

  // Auto-remove functionality is handled by ToastProvider if duration is set
  // This useEffect is only if you wanted an internal timer within ToastItem, 
  // but it's better centralized in ToastProvider.
  // useEffect(() => {
  //   if (toast.duration && toast.duration > 0) {
  //     const timer = setTimeout(() => {
  //       onRemove(toast.id);
  //     }, toast.duration);
  //     return () => clearTimeout(timer);
  //   }
  // }, [toast, onRemove]);

  return (
    <motion.div
      layout // Enables smooth transition when items are added/removed
      initial={{ opacity: 0, y: -20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 50, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      className={`relative flex items-center w-full max-w-sm p-4 text-white ${config.bgColor} rounded-lg shadow-md border-l-4 ${config.borderColor} overflow-hidden`}
    >
      <div className="flex-shrink-0 mr-3">
        {config.icon}
      </div>
      <div className="flex-1 text-sm font-medium break-words">
        {toast.message}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="ml-3 -mr-1 p-1 rounded-md hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 transition-colors"
        aria-label="Close toast"
      >
        <X className="h-4 w-4 text-white" />
      </button>
    </motion.div>
  );
};

export default ToastItem; 