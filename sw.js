// Import FCM compat scripts for background push support
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const CACHE = 'taskflow-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Google+Sans+Display:wght@400;500;700&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap',
];

// ─── Firebase config for background messaging ────────────────────
// The SW reads this from IndexedDB (set by the app after user configures it)
let firebaseInitialized = false;
function tryInitFirebase() {
  if (firebaseInitialized) return;
  try {
    // Read config from a shared IDB key the app writes
    const req = indexedDB.open('tf_sw_config', 1);
    req.onsuccess = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('config')) return;
      const tx = db.transaction('config', 'readonly');
      const store = tx.objectStore('config');
      const get = store.get('fb');
      get.onsuccess = () => {
        const cfg = get.result;
        if (cfg && cfg.projectId && !firebaseInitialized) {
          firebase.initializeApp(cfg);
          const messaging = firebase.messaging();
          // Background message handler — fires when app is closed/backgrounded
          messaging.onBackgroundMessage(payload => {
            const { title = "Charan's TaskFlow", body = '', icon = './icon-192.png' } = payload.notification || {};
            self.registration.showNotification(title, {
              body, icon, badge: './icon-192.png',
              tag: payload.collapseKey || 'taskflow-notif',
              renotify: true,
              data: payload.data,
            });
          });
          firebaseInitialized = true;
        }
      };
    };
  } catch(e) {
    // IDB not available — skip FCM init
  }
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      return Promise.allSettled(ASSETS.map(url => c.add(url).catch(() => {})));
    })
  );
  self.skipWaiting();
  tryInitFirebase();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
  tryInitFirebase();
});

// ─── Push event (VAPID-direct push, without FCM SDK) ────────────
// This fires when FCM sends a raw Web Push message (VAPID) and the
// Firebase SDK background handler above is not running.
self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { try { data = { notification: { body: e.data.text() } }; } catch {} }
  const n = data.notification || {};
  const title = n.title || "Charan's TaskFlow";
  const body  = n.body  || data.body  || '';
  const icon  = n.icon  || './icon-192.png';
  e.waitUntil(
    self.registration.showNotification(title, {
      body, icon, badge: './icon-192.png',
      tag: 'taskflow-push',
      renotify: true,
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Don't intercept Firebase requests
  if (e.request.url.includes('firebaseapp.com') || e.request.url.includes('googleapis.com/firebase')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) return client.focus();
      }
      return clients.openWindow('./');
    })
  );
});
