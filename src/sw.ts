/// <reference lib="webworker" />
// Service worker: offline cache of the whole app (incl. OCR engine) + Android share target.
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };

self.skipWaiting();
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// Map tiles: cache what was viewed (helps re-render and respects OSM's tile policy)
registerRoute(({ url }) => url.hostname === 'tile.openstreetmap.org', new CacheFirst({ cacheName: 'osm-tiles' }));

const SHARE_CACHE = 'share-inbox';

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(
      (async () => {
        const form = await event.request.formData();
        const cache = await caches.open(SHARE_CACHE);
        const files = form.getAll('files').filter((f): f is File => f instanceof File);
        let i = 0;
        for (const f of files) {
          await cache.put(
            new Request(`./__shared/${Date.now()}-${i++}`),
            new Response(f, { headers: { 'content-type': f.type, 'x-file-name': encodeURIComponent(f.name) } }),
          );
        }
        const base = new URL('./', self.registration.scope).href;
        return Response.redirect(`${base}#/inbox`, 303);
      })(),
    );
  }
});
