'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  showToast: (message: string, type: ToastType, duration?: number, id?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToasts = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToasts must be used within a ToastProvider');
  }
  return context;
};

interface ToastProviderProps {
  children: ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType, duration: number = 5000, id?: string) => {
      const newToastId = id || Math.random().toString(36).substring(2, 9);
      
      // If an ID is provided (e.g., for a persistent offline toast), remove any existing toast with that ID first
      if (id) {
        setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
      }

      const newToast: Toast = { id: newToastId, message, type, duration };
      setToasts(prevToasts => [newToast, ...prevToasts]); // Add new toasts to the top

      if (duration) { // Only set timeout if duration is provided (not undefined/0)
        setTimeout(() => {
          removeToast(newToastId);
        }, duration);
      }
    },
    [removeToast]
  );

  useEffect(() => {
    const handleOnline = () => {
      // Remove persistent offline toast if it exists
      removeToast('offline-toast');
      showToast("You're back online!", 'success', 3000);
    };

    const handleOffline = () => {
      // Show a persistent warning toast. Provide a specific ID to manage it.
      showToast("You appear to be offline. Some features may not work.", 'warning', 0, 'offline-toast'); // duration 0 for persistent
    };

    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      // Check initial status
      if (!navigator.onLine) {
        handleOffline();
      }

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, [showToast, removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
      {/* ToastContainer will be rendered here by its own component consuming the context */}
    </ToastContext.Provider>
  );
}; 