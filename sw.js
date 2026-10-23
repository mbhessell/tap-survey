// Tap Survey service worker: offline app shell + background sending of queued visits (Android/Chrome).
const VERSION = "tapsurvey-v5";
const SHELL = ["./", "index.html", "app.js", "store.js", "config.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];

importScripts("config.js", "store.js");

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // API calls go straight to the network
  if (e.request.mode === "navigate") {
    // Network first so updates arrive; cached copy when offline.
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put("index.html", c)); return r; })
      .catch(() => caches.match("index.html")));
    return;
  }
  // Cache first, refresh in the background.
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});

async function flushAndTell() {
  const res = await TapStore.flush();
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ type: "flushed", res }));
  if (res.left > 0 && !res.needLogin && !res.deviceRevoked) throw new Error("retry later"); // makes the browser retry the sync
}

self.addEventListener("sync", e => { if (e.tag === "send-visits") e.waitUntil(flushAndTell()); });
self.addEventListener("periodicsync", e => { if (e.tag === "send-visits") e.waitUntil(flushAndTell().catch(() => {})); });
self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
  if (e.data === "flush") e.waitUntil(flushAndTell().catch(() => {}));
});
