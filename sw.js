// Offline-Cache: alle Dateien werden beim ersten Öffnen gespeichert.
// Bei Änderungen an der App VERSION erhöhen, damit Handys die neue Version laden.
const VERSION = 'schach-v7';
const FILES = ['./', './index.html', './style.css', './app.js', './engine.js', './puzzles.js', './lessons.js', './openings.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];

const PIECES = ['cburnett', 'merida', 'chessnut', 'fantasy', 'celtic', 'spatial', 'papercut', 'rhosgfx', 'kiwen-suwi']
  .flatMap(set => ['w', 'b'].flatMap(c => ['K', 'Q', 'R', 'B', 'N', 'P'].map(p => `./pieces/${set}/${c}${p}.svg`)));
FILES.push(...PIECES);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Erst Netz (für Updates), bei fehlendem Netz aus dem Cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
