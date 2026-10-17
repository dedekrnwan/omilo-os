/* Omilo service worker: shows Web Push notifications, opens the right page when one is clicked, and handles the buttons
   on them (Open, Snooze 1 h, and Approve for low-risk proposals). Buttons call the API with this browser's session; if
   the sign-in is too old to approve from a notification, the sign-in page opens first. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch { n = { title: "Omilo", body: e.data ? e.data.text() : "" }; }
  const base = self.registration.scope;
  const max = (self.Notification && Notification.maxActions) || 2;
  e.waitUntil(self.registration.showNotification(n.title || "Omilo", {
    body: n.body || "", tag: n.tag || undefined, renotify: !!n.tag, icon: base + "icon-192.png", badge: base + "icon-192.png",
    requireInteraction: n.level === "critical",
    actions: Array.isArray(n.actions) ? n.actions.slice(0, max) : [],
    data: { url: n.url || "/", item_id: n.item_id || null, sig: n.sig || null, co: n.co || null },
  }));
});

async function focusOrOpen(url) {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of all) {
    if (c.url.startsWith(self.registration.scope)) { await c.focus(); if ("navigate" in c) return c.navigate(url); return; }
  }
  return self.clients.openWindow(url);
}

async function act(d, action) {
  const headers = { "Content-Type": "application/json", "X-Omilo": "1" };
  if (d.co) headers["X-Omilo-Company"] = d.co;
  return fetch(new URL("api/notify/act", self.registration.scope).href, {
    method: "POST", credentials: "include", headers, body: JSON.stringify({ item_id: d.item_id, action, sig: d.sig }),
  });
}

async function confirm(title, body) {
  await self.registration.showNotification(title, { body, tag: "omilo-done", icon: self.registration.scope + "icon-192.png", silent: true });
  setTimeout(() => self.registration.getNotifications({ tag: "omilo-done" }).then((ns) => ns.forEach((x) => x.close())), 4000);
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const url = new URL(d.url || "/", self.registration.scope).href;
  e.waitUntil((async () => {
    if (!d.item_id || !d.sig) return focusOrOpen(url);
    const action = e.action || "open";
    try {
      const r = await act(d, action);
      if (action === "approve") {
        if (r.status === 401) return focusOrOpen(new URL("login/?next=" + encodeURIComponent(url), self.registration.scope).href);
        if (!r.ok) return focusOrOpen(url); // no longer one-tap (risk changed, already decided…): show it
        return confirm("Approved", e.notification.title);
      }
      if (action === "snooze") return r.ok ? confirm("Snoozed for an hour", e.notification.title) : focusOrOpen(url);
    } catch { if (action !== "open") return focusOrOpen(url); }
    return focusOrOpen(url);
  })());
});
