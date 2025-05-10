const CACHE_NAME = 'strength-train-offline-v1';
const OFFLINE_URL = 'offline.html';

self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install event in progress.');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Precaching offline page:', OFFLINE_URL);
      return cache.add(OFFLINE_URL); // Add OFFLINE_URL, not an array with it
    })
  );
  self.skipWaiting(); // Force the waiting service worker to become the active service worker.
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate event in progress.');
  // Clean up old caches if any
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); // Ensure that the service worker takes control of the page as soon as it's activated.
});

self.addEventListener('fetch', (event) => {
  // We only want to handle navigation requests for the offline fallback.
  // Other requests (images, API calls, etc.) will pass through and fail naturally if offline,
  // unless more sophisticated caching is added later.
  if (event.request.mode === 'navigate') {
    console.log('[Service Worker] Handling fetch event for navigation request:', event.request.url);
    event.respondWith(
      (async () => {
        try {
          // Try the network first.
          const networkResponse = await fetch(event.request);
          console.log('[Service Worker] Fetched from network:', event.request.url);
          return networkResponse;
        } catch (error) {
          // Network request failed, serve the offline page from the cache.
          console.log('[Service Worker] Network request failed for navigation. Serving offline page.', error);
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match(OFFLINE_URL);
          if (cachedResponse) {
            return cachedResponse;
          }
          // This should not happen if offline.html was cached properly during install
          // but as a very last resort, return a generic error response.
          return new Response('Network error and offline page not found in cache.', { 
            status: 404, 
            headers: { 'Content-Type': 'text/plain' } 
          });
        }
      })()
    );
  } else {
    // For non-navigation requests (API calls, images, CSS, JS within the page itself if not part of initial navigation), 
    // let them go to the network. If offline, they will fail as expected.
    // More advanced caching strategies could be implemented here for specific assets if needed later.
    // console.log('[Service Worker] Not a navigation request, passing through:', event.request.url);
    return; 
  }
}); 