/* Service worker: app shell offline + dados com "rede primeiro" */
const VERSAO = 'painel-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/format.js',
  'js/charts.js',
  'js/app.js',
  'vendor/chart.umd.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/municipio.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function redePrimeiro(req) {
  const cache = await caches.open(VERSAO);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
}

async function cachePrimeiro(req) {
  const cache = await caches.open(VERSAO);
  const salvo = await cache.match(req, { ignoreSearch: true });
  if (salvo) return salvo;
  const resp = await fetch(req);
  if (resp.ok || resp.type === 'opaque') cache.put(req, resp.clone());
  return resp;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Dados: sempre tenta a versão mais nova; offline usa a última salva
  if (url.pathname.endsWith('/data/municipio.json')) return e.respondWith(redePrimeiro(req));
  // Fontes do Google e arquivos estáticos: cache primeiro
  if (url.origin === location.origin || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    return e.respondWith(req.mode === 'navigate' ? redePrimeiro(req) : cachePrimeiro(req));
  }
});
