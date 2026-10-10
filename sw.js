/* Guarda la app en el teléfono para que abra sin señal. Subir VERSION cada vez que se cambian los archivos. */
const VERSION = 'ga-v17';
const ARCHIVOS = ['./', 'index.html', 'estilos.css', 'app.js', 'panel.js', 'admin.js', 'manifest.webmanifest', 'icono-180.png', 'icono-192.png', 'icono-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // la API va siempre a la red
  // Red primero (para tomar actualizaciones); si no hay señal, la copia guardada.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })   // siempre consulta a GitHub si hay versión nueva (evita esperar el caché de 10 min)
      .then(r => { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
