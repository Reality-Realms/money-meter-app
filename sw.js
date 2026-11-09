// Money Meter: keeps the app's own files on the device so it opens fast and
// works offline (it then shows the last numbers it saw). GitHub data is never
// cached here: the app always asks GitHub for the newest numbers.
const VERSION = "money-meter-v2";
const FILES = ["./", "index.html", "install.html", "app.js", "view.mjs", "core.mjs", "style.css", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    if (url.origin !== location.origin || e.request.method !== "GET") return; // GitHub API: always live
    // Network first (so updates arrive), cache if offline.
    e.respondWith(
        fetch(e.request)
            .then((res) => {
                const copy = res.clone();
                caches.open(VERSION).then((c) => c.put(e.request, copy));
                return res;
            })
            .catch(() => caches.match(e.request).then((r) => r || caches.match("./")))
    );
});
