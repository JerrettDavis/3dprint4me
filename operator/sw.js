const CACHE_NAME = "operator-shell-v1";
const SHELL_ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/assets/operator.css", "/assets/operator.js", "/assets/api-client.js", "/assets/auth-client.js", "/assets/push-client.js", "/assets/work-state.js", "/assets/icon.svg"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("operator-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || event.request.method !== "GET") { event.respondWith(fetch(event.request)); return; }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
self.addEventListener("push", event => {
  let data = {}; try { data = event.data?.json() ?? {}; } catch { data = {}; }
  const route = /^\/work\/[A-Za-z0-9_-]{8,128}$/.test(data?.data?.route) ? data.data.route : "/";
  event.waitUntil(self.registration.showNotification("New 3dprint4.me work request", { body: "Open the work inbox to review it.", tag: data.tag ?? "new-work", data: { route } }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const route = /^\/work\/[A-Za-z0-9_-]{8,128}$/.test(event.notification.data?.route) ? event.notification.data.route : "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => { const existing = clients[0]; if (existing) { await existing.navigate(route); await existing.focus(); } else await self.clients.openWindow(route); }));
});
