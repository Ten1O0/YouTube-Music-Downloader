/**
 * Sincronización de favoritos e historial con el servidor.
 *
 * Hasta ahora todas las escrituras estaban detrás de
 * `if (globalThis.auth?.isLoggedIn())`, y `auth` es un const de nivel
 * superior: la condición era siempre falsa. La carga inicial sí funcionaba
 * —usa `this` dentro de AuthManager—, así que con sesión iniciada la
 * aplicación mostraba el historial del servidor pero nunca le mandaba nada:
 * las descargas nuevas no aparecían, limpiar el historial no hacía nada y los
 * favoritos dejaban de subir.
 *
 * Al arreglarlo salen a la luz tres efectos que la guarda tapaba, y también se
 * prueban aquí: el historial del servidor acababa copiado en el almacenamiento
 * local, la vista tardaba una ida y vuelta en mostrar la descarga nueva, y al
 * limpiar se volvía a pintar el historial antiguo hasta que respondía la red.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain } from './harness.mjs';

const TOKEN = 'token-de-prueba';

/**
 * Aplicación cargada con almacenamiento en memoria y red grabada.
 *
 * Cada test usa una carga nueva: toggleFavorite bloquea las pulsaciones
 * seguidas durante 400 ms y la sesión es estado compartido.
 */
function entorno({ conSesion = true, cacheServidor = null, local = {} } = {}) {
    const { api, context } = loadApp();

    const almacen = new Map(Object.entries(local));
    const copia = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
    api.StorageModule.get = async (k) => copia(almacen.get(k)) ?? null;
    api.StorageModule.set = async (k, v) => { almacen.set(k, copia(v)); };
    api.StorageModule.remove = async (k) => { almacen.delete(k); };

    const peticiones = [];
    context.fetch = async (url, opts = {}) => {
        peticiones.push({
            url: String(url),
            method: opts.method || 'GET',
            headers: { ...(opts.headers || {}) },
            body: opts.body ? JSON.parse(opts.body) : null,
        });
        return { ok: true, status: 200, json: async () => ({}) };
    };

    if (conSesion) {
        api.auth.token = TOKEN;
        api.auth.user = { name: 'Prueba' };
    }
    api.auth._serverHistoryCache = cacheServidor;

    const alServidor = () => peticiones.filter((p) => p.url.includes('/api/user/'));
    return { api, almacen, alServidor };
}

const video = (id, extra = {}) => ({
    id,
    title: `Canción ${id}`,
    url: `https://www.youtube.com/watch?v=${id}`,
    ...extra,
});

// ========================================
// Favoritos
// ========================================

describe('favoritos con sesión', () => {
    test('añadir un favorito lo envía al servidor con el token', async () => {
        const { api, alServidor } = entorno();
        await api.FavoritesModule.toggleFavorite(video('aaaaaaaaaaa'));

        const post = alServidor().find((p) => p.method === 'POST');
        assert.ok(post, 'no se envió el favorito al servidor');
        assert.ok(post.url.endsWith('/api/user/favorites'));
        assert.equal(post.headers.Authorization, `Bearer ${TOKEN}`);
        assert.equal(post.body.id, 'aaaaaaaaaaa');
    });

    test('quitar un favorito lo borra en el servidor', async () => {
        const { api, alServidor } = entorno({
            local: { favorites: [{ id: 'aaaaaaaaaaa', title: 'Ya era favorito' }] },
        });
        await api.FavoritesModule.toggleFavorite(video('aaaaaaaaaaa'));

        const del = alServidor().find((p) => p.method === 'DELETE');
        assert.ok(del, 'no se pidió al servidor que lo borrara');
        assert.ok(del.url.endsWith('/api/user/favorites/aaaaaaaaaaa'));
        assert.equal(del.headers.Authorization, `Bearer ${TOKEN}`);
    });

    test('sin sesión el favorito se queda solo en el dispositivo', async () => {
        const { api, almacen, alServidor } = entorno({ conSesion: false });
        await api.FavoritesModule.toggleFavorite(video('aaaaaaaaaaa'));

        assert.equal(alServidor().length, 0);
        assert.equal(almacen.get('favorites')?.[0]?.id, 'aaaaaaaaaaa');
    });
});

// ========================================
// Historial con sesión
// ========================================

describe('historial con sesión', () => {
    test('una descarga nueva se envía al servidor', async () => {
        const { api, alServidor } = entorno({ cacheServidor: [] });
        await api.addToHistory(video('bbbbbbbbbbb'));

        const post = alServidor().find((p) => p.method === 'POST');
        assert.ok(post, 'la descarga no llegó al servidor');
        assert.ok(post.url.endsWith('/api/user/history'));
        assert.equal(post.headers.Authorization, `Bearer ${TOKEN}`);
        assert.equal(post.body.id, 'bbbbbbbbbbb');
    });

    test('aparece al momento en el historial mostrado, sin esperar a la red', async () => {
        const { api } = entorno({ cacheServidor: [{ id: 'viejo', title: 'Descarga antigua' }] });
        await api.addToHistory(video('bbbbbbbbbbb'));

        const mostrado = plain(await api.getDownloadHistory());
        assert.deepEqual(mostrado.map((h) => h.id), ['bbbbbbbbbbb', 'viejo']);
    });

    test('el historial del servidor no se copia en el almacenamiento local', async () => {
        const { api, almacen } = entorno({
            cacheServidor: [{ id: 'solo-en-servidor', title: 'De otro dispositivo' }],
        });
        await api.addToHistory(video('bbbbbbbbbbb'));

        const local = almacen.get(api.HISTORY_STORAGE_KEY).map((h) => h.id);
        assert.deepEqual(local, ['bbbbbbbbbbb'],
            'el historial del servidor acabó guardado en este dispositivo');
    });

    test('una descarga repetida sube arriba sin duplicarse', async () => {
        const { api } = entorno({
            cacheServidor: [{ id: 'x' }, { id: 'bbbbbbbbbbb' }, { id: 'y' }],
        });
        await api.addToHistory(video('bbbbbbbbbbb'));

        const ids = plain(await api.getDownloadHistory()).map((h) => h.id);
        assert.deepEqual(ids, ['bbbbbbbbbbb', 'x', 'y']);
    });

    test('limpiar el historial lo vacía al instante y avisa al servidor', async () => {
        const { api, alServidor } = entorno({ cacheServidor: [{ id: 'a' }, { id: 'b' }] });
        await api.clearHistory();

        assert.deepEqual(plain(await api.getDownloadHistory()), [],
            'tras limpiar se seguía mostrando el historial del servidor');
        const del = alServidor().find((p) => p.method === 'DELETE');
        assert.ok(del?.url.endsWith('/api/user/history'), 'no se borró en el servidor');
    });

    test('actualizar un título no mezcla la copia local con la del servidor', async () => {
        const { api, almacen } = entorno({
            cacheServidor: [{ id: 'x', title: 'Título provisional' }],
            local: { downloadHistory: [{ id: 'y', title: 'Solo local' }] },
        });
        await api.updateHistoryItem('x', { title: 'Título definitivo' });

        const mostrado = plain(await api.getDownloadHistory());
        assert.equal(mostrado[0].title, 'Título definitivo');
        assert.deepEqual(plain(almacen.get('downloadHistory')), [{ id: 'y', title: 'Solo local' }]);
    });
});

// ========================================
// Historial sin sesión
// ========================================

describe('historial sin sesión', () => {
    test('una descarga se guarda en local y no llama al servidor', async () => {
        const { api, almacen, alServidor } = entorno({ conSesion: false });
        await api.addToHistory(video('ccccccccccc'));

        assert.equal(alServidor().length, 0);
        assert.equal(almacen.get(api.HISTORY_STORAGE_KEY)[0].id, 'ccccccccccc');
    });

    test('se muestra el historial local aunque quede una caché de otra sesión', async () => {
        const { api } = entorno({
            conSesion: false,
            cacheServidor: [{ id: 'de-otra-cuenta' }],
            local: { downloadHistory: [{ id: 'mio' }] },
        });
        assert.deepEqual(plain(await api.getDownloadHistory()).map((h) => h.id), ['mio']);
    });

    test('el historial local respeta el tope de entradas', async () => {
        const { api, almacen } = entorno({ conSesion: false });
        const lleno = Array.from({ length: api.HISTORY_MAX_ITEMS }, (_, i) => ({ id: `v${i}` }));
        almacen.set(api.HISTORY_STORAGE_KEY, lleno);

        await api.addToHistory(video('ccccccccccc'));

        const guardado = almacen.get(api.HISTORY_STORAGE_KEY);
        assert.equal(guardado.length, api.HISTORY_MAX_ITEMS);
        assert.equal(guardado[0].id, 'ccccccccccc');
    });
});
