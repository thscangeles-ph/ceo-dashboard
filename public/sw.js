// THSC CEO Dashboard service worker: makes the app installable and lets it open
// without a connection. Only the app's own pages, scripts, styles and icons are cached; workbooks
// are read in the browser and never pass through here.

const CACHE = "thsc-ceo-dashboard-v2";
const SHELL = ["/", "/manifest.webmanifest", "/theheartspecialists.png", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

const save = (request, response) => {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Pages: always try the network first so a new deployment shows up; fall back to the saved copy.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => (url.pathname === "/" ? save("/", response) : response)).catch(async () => (await caches.match("/")) || Response.error()));
    return;
  }

  // Next.js build files have unique names per deployment, so a saved copy never goes stale.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => save(request, response))));
    return;
  }

  // Logo, icons and other public files: serve the saved copy, refresh it in the background.
  if (SHELL.includes(url.pathname) || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => save(request, response)).catch(() => cached || Response.error());
      return cached || network;
    }));
  }
});
