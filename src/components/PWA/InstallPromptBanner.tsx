'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Download, Share } from 'lucide-react'; // Icons

const InstallPromptBanner: React.FC = () => {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null); // To store the install prompt event

  useEffect(() => {
    // Detect iOS
    const isDeviceIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isDeviceIOS);

    // Check if already in standalone mode (PWA installed)
    const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault(); // Prevent the mini-infobar
      setDeferredPrompt(event);
      // Show prompt only if not on iOS and not already standalone
      if (!isDeviceIOS && !isInStandaloneMode) {
        console.log('[InstallPrompt] beforeinstallprompt event fired, showing banner.');
        setShowPrompt(true);
      }
    };

    // For iOS, show prompt if not standalone (it won't fire beforeinstallprompt)
    if (isDeviceIOS && !isInStandaloneMode) {
      console.log('[InstallPrompt] iOS device detected, not standalone, showing iOS banner.');
      setShowPrompt(true);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []); // Empty dependency array, runs once on mount

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      return;
    }
    setShowPrompt(false); // Hide the banner
    deferredPrompt.prompt(); // Show the browser install prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[InstallPrompt] User response to the install prompt: ${outcome}`);
    setDeferredPrompt(null); // We can only use the prompt once
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    console.log('[InstallPrompt] Banner dismissed by user.');
    // Optionally, set a flag in localStorage/sessionStorage to not show again for a while
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[150] bg-gray-800 text-white p-4 shadow-lg flex items-center justify-between sm:px-6">
      <div className="flex items-center">
        <Download className="h-6 w-6 mr-3 flex-shrink-0" /> 
        <div>
          <p className="font-semibold">Install Strength Train</p>
          {!isIOS && <p className="text-sm text-gray-300">Get the full app experience on your home screen.</p>}
          {isIOS && <p className="text-sm text-gray-300">For quick access, add this app to your Home Screen.</p>}
        </div>
      </div>
      <div className="flex items-center">
        {!isIOS && deferredPrompt && (
          <button
            onClick={handleInstallClick}
            className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg text-sm shadow-md transition-colors mr-3"
          >
            Install
          </button>
        )}
        {isIOS && (
            <p className="text-xs text-gray-400 hidden sm:block mr-3">
                Tap <Share className="inline h-4 w-4 mx-1" /> then 'Add to Home Screen'
            </p>
        )}
        <button
          onClick={handleDismiss}
          className="text-gray-400 hover:text-gray-200 p-2 rounded-full"
          aria-label="Dismiss install prompt"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default InstallPromptBanner; 