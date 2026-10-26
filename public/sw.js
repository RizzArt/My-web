/* Push-only worker: no page, API, chat, transaction, or private-product caching. */
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || "Notifikasi Riezz99";
  const options = { body: payload.body || "Ada aktivitas baru di akun kamu.", tag: payload.tag || "riezz99-push", data: { url: payload.url || "/" }, icon: "/icon.svg", badge: "/icon.svg", renotify: true };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data && typeof event.notification.data.url === "string" && event.notification.data.url.startsWith("/") ? event.notification.data.url : "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => "focus" in client);
    if (existing) return existing.focus().then(() => existing.navigate(target));
    return self.clients.openWindow(target);
  }));
});
