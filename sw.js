// Road Clear offline helper: opens the app with no signal and keeps map areas you've seen.
const VERSION = "rc-2026-10-30b";
const SHELL_CACHE = "rc-shell-" + VERSION;
const TILE_CACHE = "rc-tiles-v1";
const MAX_TILES = 3000; // roughly 40–60 MB of map

const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./favicon.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(k => k.startsWith("rc-shell-") && k !== SHELL_CACHE)
    .map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

let tilePuts = 0;
async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Map tiles: use the saved copy first, fetch and save new ones
  if (url.hostname === "tile.openstreetmap.org" || (url.hostname === "maps.geoapify.com" && url.pathname.startsWith("/v1/tile/"))) {
    e.respondWith(caches.open(TILE_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { cache.put(req, res.clone()); if (++tilePuts % 100 === 0) trimTiles(cache); }
        return res;
      } catch { return new Response("", { status: 504 }); }
    }));
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // Voice clips are handled by the page itself (avoids audio problems on iPhone)
  if (sameOrigin && /\.(m4a|mp3|wav|aac|caf|mp4|ogg)$/i.test(url.pathname)) return;

  // The app page: always try for the newest version, fall back to the saved one offline
  if (req.mode === "navigate" || (sameOrigin && /\/$|index\.html$/.test(url.pathname))) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(SHELL_CACHE); const isApp = /\/$|index\.html$/.test(url.pathname); c.put(isApp ? "./index.html" : req, res.clone()); }
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match("./index.html")) || new Response("Road Clear needs network the first time you open it.", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  // App files and libraries: serve the saved copy quickly, refresh it in the background
  if (sameOrigin || url.hostname === "cdnjs.cloudflare.com" || url.hostname === "cdn.jsdelivr.net" || url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com")) {
    e.respondWith(caches.open(SHELL_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || new Response("", { status: 504 });
    }));
    return;
  }
  // Everything else (live reports, search, directions) goes straight to the network
});
