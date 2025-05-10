'use client';

import { useEffect } from 'react';

const PWAInitializer: React.FC = () => {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => { // Register after page load for performance
        navigator.serviceWorker
          .register('/sw.js') // Path to your service worker file
          .then((registration) => {
            console.log('[Service Worker] Registered successfully with scope:', registration.scope);
          })
          .catch((error) => {
            console.error('[Service Worker] Registration failed:', error);
          });
      });
    }
  }, []); // Empty dependency array ensures this runs only once on mount

  return null; // This component does not render any UI
};

export default PWAInitializer; 