// Offline-Cache: alle Dateien werden beim ersten Öffnen gespeichert.
// Bei Änderungen an der App VERSION erhöhen, damit Handys die neue Version laden.
const VERSION = 'schach-v11';
const FILES = ['./', './index.html', './style.css', './app.js', './engine.js', './puzzles.js', './lessons.js', './openings.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];

const PIECES = ['cburnett', 'merida', 'chessnut', 'fantasy', 'celtic', 'spatial', 'papercut', 'rhosgfx', 'kiwen-suwi']
  .flatMap(set => ['w', 'b'].flatMap(c => ['K', 'Q', 'R', 'B', 'N', 'P'].map(p => `./pieces/${set}/${c}${p}.svg`)));
FILES.push(...PIECES);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Sofort aus dem Speicher antworten (schnell, auch bei schlechtem Netz) und im Hintergrund aktualisieren.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || (await cache.match('./index.html')) || Response.error();
  }));
});
