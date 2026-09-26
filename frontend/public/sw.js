/**
 * Service Worker — YouTube Music Downloader PWA
 *
 * Estrategias por tipo de recurso (plan 07, T5):
 *   HTML            -> red primero, caché como respaldo offline
 *   /assets/<hash>  -> caché primero (llevan hash: son inmutables)
 *   resto           -> stale-while-revalidate
 *   /api/, CDNs     -> nunca se cachean
 *
 * El network-first del HTML es el cambio que importa: antes era cache-first,
 * así que un despliegue no llegaba al usuario hasta que alguien se acordaba de
 * subir CACHE_NAME a mano.
 */

// Sustituido por el plugin de Vite en cada build (plan 07, T6). Sin sustituir
// —en desarrollo— es un nombre de caché válido y constante, así que no molesta.
const SW_VERSION = '__SW_VERSION__';
const CACHE_NAME = `ytdl-${SW_VERSION}`;

// Caché aparte para las fuentes: son estables y pesadas, y purgarlas en cada
// despliegue es tirar ancho de banda del usuario sin ganar nada.
const FONT_CACHE = 'ytdl-fonts';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/favicon.png',
    '/manifest.json',
];

// Contenido de terceros que cambia solo y no aporta nada cachear: miniaturas
// de YouTube, banderas y los scripts de Google.
const NEVER_CACHE_HOSTS = [
    'i.ytimg.com',
    'img.youtube.com',
    'flagcdn.com',
    'accounts.google.com',
    'www.youtube.com',
];

const IMMUTABLE_ASSET = /\/assets\/[^/]+\.(js|css|png|jpg|svg|woff2?)$/;

// ========================================
// Instalación
// ========================================

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);

        // Uno a uno y tolerando fallos: cache.addAll() es atómico, así que un
        // solo recurso caído dejaba la instalación entera sin hacer.
        await Promise.allSettled(
            STATIC_ASSETS.map((asset) =>
                cache.add(asset).catch((err) => {
                    console.warn('[SW] No se pudo cachear:', asset, err);
                })
            )
        );
    })());

    self.skipWaiting();
});

// ========================================
// Activación
// ========================================

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const nombres = await caches.keys();
        await Promise.all(
            nombres
                // La caché de fuentes sobrevive a los despliegues a propósito
                .filter((n) => n !== CACHE_NAME && n !== FONT_CACHE)
                .map((n) => caches.delete(n))
        );
        await self.clients.claim();
    })());
});

// ========================================
// Estrategias
// ========================================

async function guardarEnCache(nombreCache, request, response) {
    if (!response || response.status !== 200 || response.type === 'opaque') return;
    try {
        const cache = await caches.open(nombreCache);
        await cache.put(request, response);
    } catch (err) {
        console.warn('[SW] No se pudo guardar en caché:', request.url, err);
    }
}

/** Red primero; si falla, lo que haya en caché. Para HTML. */
async function redPrimero(request) {
    try {
        const respuesta = await fetch(request);
        guardarEnCache(CACHE_NAME, request, respuesta.clone());
        return respuesta;
    } catch {
        const cacheada = await caches.match(request);
        return cacheada || await caches.match('/index.html') || Response.error();
    }
}

/** Caché primero. Solo para recursos inmutables (los que llevan hash). */
async function cachePrimero(request, nombreCache = CACHE_NAME) {
    const cacheada = await caches.match(request);
    if (cacheada) return cacheada;

    const respuesta = await fetch(request);
    guardarEnCache(nombreCache, request, respuesta.clone());
    return respuesta;
}

/** Devuelve lo cacheado al instante y refresca por detrás. */
async function cacheYRevalida(request) {
    const cacheada = await caches.match(request);

    const refresco = fetch(request)
        .then((respuesta) => {
            guardarEnCache(CACHE_NAME, request, respuesta.clone());
            return respuesta;
        })
        .catch(() => null);

    return cacheada || await refresco || Response.error();
}

/**
 * Decide qué estrategia corresponde a una petición.
 * Extraída a función pura para poder probarla (plan 07, T7).
 */
function elegirEstrategia(request, url) {
    if (request.method !== 'GET') return 'ninguna';
    if (url.pathname.startsWith('/api/')) return 'ninguna';
    if (url.pathname.startsWith('/download')) return 'ninguna';
    if (NEVER_CACHE_HOSTS.includes(url.hostname)) return 'ninguna';
    if (FONT_HOSTS.includes(url.hostname)) return 'fuentes';
    if (request.destination === 'document') return 'red-primero';
    if (IMMUTABLE_ASSET.test(url.pathname)) return 'cache-primero';
    return 'cache-y-revalida';
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    switch (elegirEstrategia(event.request, url)) {
        case 'ninguna':
            return;  // que lo gestione el navegador
        case 'fuentes':
            event.respondWith(cachePrimero(event.request, FONT_CACHE));
            return;
        case 'red-primero':
            event.respondWith(redPrimero(event.request));
            return;
        case 'cache-primero':
            event.respondWith(cachePrimero(event.request));
            return;
        default:
            event.respondWith(cacheYRevalida(event.request));
    }
});

// Exportado solo para los tests; en el navegador no molesta.
if (typeof globalThis !== 'undefined') {
    globalThis.__swInternals = {
        elegirEstrategia, CACHE_NAME, FONT_CACHE,
        NEVER_CACHE_HOSTS, FONT_HOSTS, IMMUTABLE_ASSET, STATIC_ASSETS,
    };
}
