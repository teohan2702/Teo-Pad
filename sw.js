'use strict';

// Release identifier must change when the offline shell changes.
const RELEASE = 'v3.1-icons-20261005';
const ROOT = new URL('./',self.location.href);
const ENTRY = ROOT.href;
const INDEX = new URL('index.html',ROOT).href;
const MANIFEST = new URL('manifest.json',ROOT).href;
const PREFIX = 'teopad-' + encodeURIComponent(ROOT.pathname) + '-';
const CACHE = PREFIX + RELEASE;
const ICON_FILES = ['icon-192.png','icon-512.png','icon-maskable-192.png','icon-maskable-512.png','apple-touch-icon.png','favicon-16.png','favicon-32.png','favicon-48.png','favicon.ico'];
const ICON_URLS = new Set(ICON_FILES.map(name => new URL('icons/' + name,ROOT).href));
const ASSETS = [ENTRY,MANIFEST,...ICON_URLS];
const NETWORK_TIMEOUT = 5000;

self.addEventListener('install',event => {
  // The offline shell, manifest and declared external icons must all be available.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of ASSETS) {
      const response = await fetch(new Request(url,{cache:'reload'}));
      if (!response.ok || response.redirected) throw new Error('Offline asset unavailable: ' + url);
      await cache.put(url,response);
    }
  })());
});

self.addEventListener('activate',event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    for (const name of names) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
      // Remove this app's legacy cache only when it contains this exact shell URL.
      if (/^teopad-(shell|runtime)-v\d+$/.test(name)) {
        const old = await caches.open(name);
        if (await old.match(ENTRY) || await old.match(MANIFEST)) await caches.delete(name);
      }
    }
    try { await self.registration?.navigationPreload?.disable(); } catch { /* Optional capability. */ }
    await self.clients.claim();
  })());
});

self.addEventListener('message',event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

async function readCache(url) {
  try { return await (await caches.open(CACHE)).match(url); }
  catch { return undefined; }
}
async function writeCache(url,response) {
  try { await (await caches.open(CACHE)).put(url,response); }
  catch (error) { console.warn('[TeoPad] Offline cache write failed:',error.name); }
}
function offlineResponse() {
  return new Response('TeoPad çevrimdışı kopyasına ulaşılamadı. Bağlantı kurulduğunda yeniden deneyin.',{
    status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}
  });
}
async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),NETWORK_TIMEOUT);
  try {
    const response = await fetch(request,{signal:controller.signal,cache:'no-cache'});
    await response.clone().arrayBuffer(); // Keep the timeout active until the small app resource is complete.
    return response;
  }
  finally { clearTimeout(timer); }
}
async function navigation(request) {
  let response;
  try {
    response = await fetchWithTimeout(request);
    const html = (response.headers.get('Content-Type') || '').includes('text/html');
    if (response.ok && !response.redirected && html) {
      await writeCache(ENTRY,response.clone());
      return response;
    }
  } catch { /* A cached shell can serve offline and network failures. */ }
  return await readCache(ENTRY) || response || offlineResponse();
}
async function refreshManifest(request) {
  const response = await fetchWithTimeout(request);
  if (response.ok && !response.redirected) {
    // Do not replace a valid manifest with a captive portal or malformed JSON.
    const parsed = await response.clone().json();
    if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string') throw new Error('Invalid manifest');
    await writeCache(MANIFEST,response.clone());
  }
  return response;
}
self.addEventListener('fetch',event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== ROOT.origin) return;
  const canonical = url.origin + url.pathname;
  if (ICON_URLS.has(canonical)) {
    event.respondWith((async () => {
      const cached = await readCache(canonical);
      if (cached) return cached;
      try { return await fetchWithTimeout(request); }
      catch { return new Response('',{status:503}); }
    })());
    return;
  }
  if (request.mode === 'navigate' && (canonical === ENTRY || canonical === INDEX)) {
    event.respondWith(navigation(request));
    return;
  }
  if (request.mode === 'navigate' || canonical !== MANIFEST) return;
  // The lifetime promise is registered synchronously and absorbs refresh failures.
  const refreshing = refreshManifest(request).catch(() => undefined);
  event.waitUntil(refreshing);
  event.respondWith((async () => {
    const cached = await readCache(MANIFEST);
    return cached || await refreshing || offlineResponse();
  })());
});
