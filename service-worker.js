/* ============================================================
   service-worker.js — makes Math Hero work OFFLINE and installable.

   How it works (plain English):
   - On INSTALL we pre-download every file the app needs and stash
     them in a named cache.
   - On FETCH we answer from that cache so the app opens with no
     network at all (airplane mode, dead wifi). For the PAGE ITSELF
     we try the network FIRST when online, so a shipped fix shows up
     without a hard reload (the classic "stale cache" trap = PRD risk #2).
   - On ACTIVATE we delete older caches so old builds don't pile up.

   *** WHEN YOU SHIP A CHANGE: bump CACHE_VERSION below. ***
   That one edit renames the cache, which invalidates the old files
   and pulls fresh copies on the next visit. Forget this and devices
   keep serving the old build.
   ============================================================ */

const CACHE_VERSION = "v4";   // subtraction + escalator + chapter/World + full dress-up shop drop
const CACHE = `mathhero-${CACHE_VERSION}`;

/* Everything the app needs to run from a cold, offline start. Paths are
   RELATIVE so this works whether the app is served from the domain root
   (localhost) or a project subpath (username.github.io/math-hero/). */
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/skills.js",
  "./js/visuals.js",
  "./js/speech.js",
  "./js/sfx.js",
  "./js/progress.js",
  "./js/curriculum.js",
  "./icons/apple-touch-icon.png",
  "./icons/apple-touch-icon-152.png",
  "./icons/apple-touch-icon-167.png",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

/* INSTALL: pre-cache the shell, then take over immediately (skipWaiting). */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ACTIVATE: drop any cache that isn't the current version, then control
   already-open pages right away (clients.claim). */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* FETCH:
   - navigations (loading the page) → NETWORK-FIRST, fall back to the
     cached page when offline. Keeps the HTML fresh, no stale trap.
   - everything else (css / js / icons) → CACHE-FIRST for instant,
     offline loads; runtime-cache anything new we didn't precache. */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;          // never intercept writes (there are none, but be safe)

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Keep BOTH cached page keys fresh for the next offline open:
          // "./" is what GitHub Pages serves at the app root, "./index.html"
          // is the manifest start_url — refresh them together so they can't
          // drift to different builds. Only cache a good, same-origin page.
          if (res.ok && new URL(req.url).origin === self.location.origin) {
            const a = res.clone(), b = res.clone();
            caches.open(CACHE).then((c) => { c.put("./index.html", a); c.put("./", b); });
          }
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        // stash any successful same-origin GET so it's available offline next time
        if (res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
    )
  );
});
