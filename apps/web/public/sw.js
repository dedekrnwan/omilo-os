/* Omilo service worker: shows Web Push notifications and opens the right page when one is clicked. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch { n = { title: "Omilo", body: e.data ? e.data.text() : "" }; }
  const base = self.registration.scope;
  e.waitUntil(self.registration.showNotification(n.title || "Omilo", {
    body: n.body || "", tag: n.tag || undefined, renotify: !!n.tag, icon: base + "icon-192.png", badge: base + "icon-192.png",
    requireInteraction: n.level === "critical", data: { url: n.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); if ("navigate" in c) return c.navigate(url); return; }
    }
    return self.clients.openWindow(url);
  })());
});
