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
 *
 * Los favoritos siguen además un modelo propio: con sesión, la lista de la
 * cuenta es la referencia, y lo que no puede llegar al servidor queda
 * pendiente hasta que se puede. El caso que motivó el diseño es el primero de
 * su bloque: un favorito borrado en otro dispositivo no puede reaparecer.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain } from './harness.mjs';

const TOKEN = 'token-de-prueba';
const CUENTA = '1';

const copia = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const fav = (id) => ({ id, videoId: id, title: `Canción ${id}` });
const ids = (lista) => (lista || []).map((f) => f.id);
/** Deja correr los envíos en segundo plano, que solo usan microtareas. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Aplicación cargada con almacenamiento en memoria y un servidor falso que se
 * comporta como los endpoints reales de /api/user/.
 *
 * Cada test usa una carga nueva: toggleFavorite bloquea las pulsaciones
 * seguidas durante 400 ms y la sesión es estado compartido.
 */
function entorno({
    conSesion = true,
    cacheServidor = null,
    local = {},
    favoritosServidor = [],
    fallaEnvio = false,     // POST/DELETE de favoritos sin red
    fallaLectura = false,   // GET de favoritos sin red
    alLeer = null,          // se ejecuta mientras el servidor responde al GET
} = {}) {
    const { api, context } = loadApp();

    const almacen = new Map(Object.entries(local));
    api.StorageModule.get = async (k) => copia(almacen.get(k)) ?? null;
    api.StorageModule.set = async (k, v) => { almacen.set(k, copia(v)); };
    api.StorageModule.remove = async (k) => { almacen.delete(k); };

    const servidor = { favoritos: copia(favoritosServidor) };
    const peticiones = [];
    const responder = (datos, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => copia(datos) });

    context.fetch = async (url, opts = {}) => {
        const p = {
            url: String(url),
            method: opts.method || 'GET',
            headers: { ...(opts.headers || {}) },
            body: opts.body ? JSON.parse(opts.body) : null,
        };
        peticiones.push(p);
        const ruta = p.url.replace(/^https?:\/\/[^/]+/, '');

        if (ruta.startsWith('/api/user/favorites')) {
            if (p.method !== 'GET' && fallaEnvio) throw new TypeError('Failed to fetch');
            if (p.method === 'GET') {
                if (fallaLectura) throw new TypeError('Failed to fetch');
                const foto = copia(servidor.favoritos);
                if (alLeer) await alLeer(api);
                return responder({ favorites: foto });
            }
            if (p.method === 'POST') {
                servidor.favoritos = [p.body, ...servidor.favoritos.filter((f) => f.id !== p.body.id)];
            } else {
                const id = decodeURIComponent(ruta.split('/').pop());
                servidor.favoritos = servidor.favoritos.filter((f) => f.id !== id);
            }
            return responder({ status: 'ok' });
        }
        if (ruta === '/api/user/sync') {
            // Como la base de datos: INSERT OR IGNORE
            for (const f of p.body.favorites || []) {
                if (!servidor.favoritos.some((s) => s.id === f.id)) servidor.favoritos.push(f);
            }
            return responder({ status: 'ok', history: [], favorites: servidor.favoritos });
        }
        return responder({});
    };

    if (conSesion) {
        api.auth.token = TOKEN;
        api.auth.user = { id: Number(CUENTA), name: 'Prueba' };
    }
    api.auth._serverHistoryCache = cacheServidor;

    const alServidor = () => peticiones.filter((p) => p.url.includes('/api/user/'));
    const localFavs = () => almacen.get('favorites');
    const pendientes = () => almacen.get('favorites_pending') || [];
    return { api, almacen, servidor, alServidor, localFavs, pendientes };
}

const video = (id, extra = {}) => ({
    id,
    title: `Canción ${id}`,
    url: `https://www.youtube.com/watch?v=${id}`,
    ...extra,
});

// ========================================
// Favoritos: cambios del momento
// ========================================

describe('favoritos con sesión', () => {
    test('añadir un favorito lo envía al servidor con el token', async () => {
        const { api, alServidor, servidor, pendientes } = entorno();
        await api.FavoritesModule.toggleFavorite(video('aaaaaaaaaaa'));
        await tick();

        const post = alServidor().find((p) => p.method === 'POST');
        assert.ok(post, 'no se envió el favorito al servidor');
        assert.ok(post.url.endsWith('/api/user/favorites'));
        assert.equal(post.headers.Authorization, `Bearer ${TOKEN}`);
        assert.deepEqual(ids(servidor.favoritos), ['aaaaaaaaaaa']);
        assert.equal(pendientes().length, 0);
    });

    test('quitar un favorito lo borra en el servidor', async () => {
        const { api, alServidor, servidor } = entorno({
            local: { favorites: [fav('aaaaaaaaaaa')] },
            favoritosServidor: [fav('aaaaaaaaaaa')],
        });
        await api.FavoritesModule.toggleFavorite(video('aaaaaaaaaaa'));
        await tick();

        const del = alServidor().find((p) => p.method === 'DELETE');
        assert.ok(del?.url.endsWith('/api/user/favorites/aaaaaaaaaaa'), 'no se pidió borrarlo');
        assert.equal(del.headers.Authorization, `Bearer ${TOKEN}`);
        assert.deepEqual(servidor.favoritos, []);
    });

    test('sin red, el cambio queda pendiente para esta cuenta', async () => {
        const { api, localFavs, pendientes } = entorno({ fallaEnvio: true });
        await api.FavoritesModule.toggleFavorite(video('aaaaaaaaaaa'));
        await tick();

        assert.deepEqual(ids(localFavs()), ['aaaaaaaaaaa'], 'el corazón debe verse igualmente');
        const [p] = pendientes();
        assert.equal(p?.op, 'add');
        assert.equal(p.id, 'aaaaaaaaaaa');
        assert.equal(p.owner, CUENTA);
    });
});

describe('favoritos sin sesión', () => {
    test('se guardan en el dispositivo y quedan pendientes', async () => {
        const { api, alServidor, localFavs, pendientes } = entorno({ conSesion: false });
        await api.FavoritesModule.toggleFavorite(video('aaaaaaaaaaa'));
        await tick();

        assert.equal(alServidor().length, 0);
        assert.deepEqual(ids(localFavs()), ['aaaaaaaaaaa']);
        assert.equal(pendientes()[0]?.op, 'add');
        assert.equal(pendientes()[0].owner, null, 'sin cuenta previa no tiene dueño');
    });

    test('tras cerrar sesión, los cambios se apuntan a la última cuenta', async () => {
        const { api, pendientes } = entorno({ conSesion: false, local: { favorites_owner: CUENTA } });
        await api.FavoritesModule.toggleFavorite(video('aaaaaaaaaaa'));
        await tick();

        assert.equal(pendientes()[0]?.owner, CUENTA);
    });

    test('añadir y luego quitar deja un único pendiente: quitar', async () => {
        const { api, pendientes } = entorno({ conSesion: false });
        await api.FavoritesModule.toggleFavorite(video('aaaaaaaaaaa'));
        await new Promise((r) => setTimeout(r, 450));  // el corazón se bloquea 400 ms
        await api.FavoritesModule.toggleFavorite(video('aaaaaaaaaaa'));
        await tick();

        assert.deepEqual(pendientes().map((p) => p.op), ['remove']);
    });
});

// ========================================
// Favoritos: sincronización con la cuenta
// ========================================

describe('favoritos: la cuenta es la referencia', () => {
    test('un favorito borrado en otro dispositivo no reaparece', async () => {
        // C se borró en otro dispositivo: el servidor ya no lo tiene, pero
        // este dispositivo aún lo guarda. Juntar las listas lo resucitaría.
        const { api, alServidor, servidor, localFavs } = entorno({
            local: { favorites: [fav('A'), fav('C')], favorites_owner: CUENTA },
            favoritosServidor: [fav('A'), fav('B')],
        });
        await api.FavoritesModule.syncWithServer();

        assert.deepEqual(ids(localFavs()), ['A', 'B']);
        assert.deepEqual(ids(servidor.favoritos), ['A', 'B'], 'C volvió a subirse al servidor');
        assert.ok(!alServidor().some((p) => p.method === 'POST'));
    });

    test('los cambios pendientes se envían al sincronizar', async () => {
        const { api, servidor, localFavs, pendientes } = entorno({
            local: {
                favorites: [fav('A'), fav('B')],
                favorites_owner: CUENTA,
                favorites_pending: [
                    { op: 'add', id: 'D', entry: fav('D'), owner: CUENTA },
                    { op: 'remove', id: 'A', entry: null, owner: CUENTA },
                ],
            },
            favoritosServidor: [fav('A'), fav('B')],
        });
        await api.FavoritesModule.syncWithServer();

        assert.deepEqual(ids(servidor.favoritos), ['D', 'B']);
        assert.deepEqual(ids(localFavs()), ['D', 'B']);
        assert.deepEqual(pendientes(), []);
    });

    test('lo que no se puede enviar sigue pendiente y se ve igualmente', async () => {
        const { api, localFavs, pendientes } = entorno({
            fallaEnvio: true,
            local: {
                favorites_owner: CUENTA,
                favorites_pending: [{ op: 'add', id: 'D', entry: fav('D'), owner: CUENTA }],
            },
            favoritosServidor: [fav('A')],
        });
        await api.FavoritesModule.syncWithServer();

        assert.deepEqual(ids(localFavs()), ['D', 'A']);
        assert.deepEqual(pendientes().map((p) => p.id), ['D']);
    });

    test('la primera sesión en un dispositivo suma sus favoritos una sola vez', async () => {
        const { api, alServidor, servidor, localFavs, pendientes, almacen } = entorno({
            local: {
                favorites: [fav('X')],
                favorites_pending: [{ op: 'add', id: 'X', entry: fav('X'), owner: null }],
            },
            favoritosServidor: [fav('Y')],
        });
        await api.FavoritesModule.syncWithServer();

        const sync = alServidor().find((p) => p.url.endsWith('/api/user/sync'));
        assert.deepEqual(ids(sync?.body.favorites), ['X'], 'no se subieron los favoritos locales');
        assert.deepEqual(ids(servidor.favoritos).sort(), ['X', 'Y']);
        assert.deepEqual(ids(localFavs()).sort(), ['X', 'Y']);
        assert.deepEqual(pendientes(), [], 'los pendientes sin dueño ya van en la subida');
        assert.equal(almacen.get('favorites_owner'), CUENTA);

        // Una segunda vez ya no suma: la cuenta es la referencia
        await api.FavoritesModule.syncWithServer();
        assert.equal(alServidor().filter((p) => p.url.endsWith('/api/user/sync')).length, 1);
    });

    test('la lista de otra cuenta no se sube a esta', async () => {
        const deOtra = { op: 'add', id: 'Z', entry: fav('Z'), owner: '2' };
        const { api, alServidor, servidor, localFavs, pendientes, almacen } = entorno({
            local: { favorites: [fav('Z')], favorites_owner: '2', favorites_pending: [deOtra] },
            favoritosServidor: [fav('Y')],
        });
        await api.FavoritesModule.syncWithServer();

        assert.ok(!alServidor().some((p) => p.url.endsWith('/api/user/sync')));
        assert.deepEqual(ids(servidor.favoritos), ['Y']);
        assert.deepEqual(ids(localFavs()), ['Y']);
        assert.deepEqual(plain(pendientes()), [deOtra], 'el cambio de la otra cuenta espera a esa cuenta');
        assert.equal(almacen.get('favorites_owner'), CUENTA);
    });

    test('sin conexión, la lista local se queda como está', async () => {
        const { api, localFavs, almacen } = entorno({
            fallaLectura: true,
            local: { favorites: [fav('A'), fav('C')], favorites_owner: CUENTA },
            favoritosServidor: [fav('A')],
        });
        await api.FavoritesModule.syncWithServer();

        assert.deepEqual(ids(localFavs()), ['A', 'C']);
        assert.equal(almacen.get('favorites_owner'), CUENTA);
    });

    test('un corazón pulsado mientras llega la lista no se pierde', async () => {
        const { api, localFavs } = entorno({
            local: { favorites: [fav('A')], favorites_owner: CUENTA },
            favoritosServidor: [fav('A')],
            alLeer: (app) => app.FavoritesModule.toggleFavorite(video('nnnnnnnnnnn')),
        });
        await api.FavoritesModule.syncWithServer();
        await tick();

        assert.ok(ids(localFavs()).includes('nnnnnnnnnnn'),
            'la lista del servidor, ya desfasada, pisó el favorito recién marcado');
    });

    test('sin sesión no se sincroniza nada', async () => {
        const { api, alServidor } = entorno({ conSesion: false, local: { favorites: [fav('A')] } });
        await api.FavoritesModule.syncWithServer();

        assert.equal(alServidor().length, 0);
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
