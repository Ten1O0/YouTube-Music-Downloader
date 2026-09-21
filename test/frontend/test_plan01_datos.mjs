/**
 * Cobertura de la lógica introducida por el plan 01
 * (integridad de datos en el cliente).
 *
 * Son los cinco defectos que se corrigieron: fusión de la migración, ciclo de
 * vida de los object URLs y resolución del audio. Si algo de esto se rompe,
 * el usuario pierde biblioteca o favoritos en silencio.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app, loadApp, plain } from './harness.mjs';

const { api } = app();

// ========================================
// storageItemKey — identidad de un elemento guardado
// ========================================

describe('storageItemKey', () => {
    test('prefiere id sobre el resto', () => {
        assert.equal(api.storageItemKey({ id: 'A', videoId: 'B', src: 'C' }), 'A');
    });

    test('cae a videoId si no hay id', () => {
        assert.equal(api.storageItemKey({ videoId: 'B', src: 'C' }), 'B');
    });

    test('cae a src si no hay ninguno de los dos', () => {
        assert.equal(api.storageItemKey({ src: 'C' }), 'C');
    });

    test('devuelve null si no hay nada identificable', () => {
        assert.equal(api.storageItemKey({ title: 'sin clave' }), null);
        assert.equal(api.storageItemKey({}), null);
        assert.equal(api.storageItemKey(null), null);
        assert.equal(api.storageItemKey(undefined), null);
    });
});

// ========================================
// mergeStoredArrays — el corazón de la migración segura (T4)
// ========================================

describe('mergeStoredArrays', () => {
    test('une elementos sin solapamiento', () => {
        const r = api.mergeStoredArrays(
            [{ id: 'a' }],
            [{ id: 'b' }]
        );
        assert.equal(r.length, 2);
        assert.deepEqual(plain(r).map(x => x.id).sort(), ['a', 'b']);
    });

    test('lo que ya está en IndexedDB gana ante un duplicado', () => {
        const r = api.mergeStoredArrays(
            [{ id: 'a', title: 'BUENO' }],
            [{ id: 'a', title: 'viejo de localStorage' }]
        );
        assert.equal(r.length, 1);
        assert.equal(r[0].title, 'BUENO');
    });

    test('NUNCA pierde elementos existentes (regresión del defecto D2)', () => {
        // El código antiguo comparaba longitudes y sobrescribía el array entero,
        // lo que podía resucitar favoritos borrados o perder los nuevos.
        const existentes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        const entrantes = [{ id: 'z' }];

        const r = api.mergeStoredArrays(existentes, entrantes);

        for (const e of existentes) {
            assert.ok(r.some(x => x.id === e.id), `se perdió ${e.id}`);
        }
        assert.equal(r.length, 4);
    });

    test('un array entrante más largo no sustituye al existente', () => {
        const r = api.mergeStoredArrays(
            [{ id: 'conservado', title: 'original' }],
            [{ id: 'conservado', title: 'PISADO' }, { id: 'n1' }, { id: 'n2' }]
        );
        assert.equal(r.find(x => x.id === 'conservado').title, 'original');
        assert.equal(r.length, 3);
    });

    test('descarta elementos entrantes sin clave', () => {
        const r = api.mergeStoredArrays([], [{ title: 'sin clave' }]);
        assert.equal(r.length, 0);
    });

    test('conserva elementos existentes sin clave', () => {
        const r = api.mergeStoredArrays([{ title: 'raro pero mío' }], []);
        assert.equal(r.length, 1);
    });

    test('funciona con arrays vacíos', () => {
        assert.deepEqual(plain(api.mergeStoredArrays([], [])), []);
        assert.equal(api.mergeStoredArrays([], [{ id: 'a' }]).length, 1);
        assert.equal(api.mergeStoredArrays([{ id: 'a' }], []).length, 1);
    });

    test('deduplica dentro del array entrante', () => {
        const r = api.mergeStoredArrays([], [{ id: 'a' }, { id: 'a' }, { id: 'a' }]);
        assert.equal(r.length, 1);
    });

    test('es idempotente', () => {
        const a = [{ id: '1' }, { id: '2' }];
        const b = [{ id: '2' }, { id: '3' }];
        const primera = api.mergeStoredArrays(a, b);
        const segunda = api.mergeStoredArrays(primera, b);
        assert.equal(primera.length, segunda.length);
    });

    test('aguanta lotes grandes sin duplicar', () => {
        const existentes = Array.from({ length: 500 }, (_, i) => ({ id: `e${i}` }));
        const entrantes = Array.from({ length: 500 }, (_, i) => ({ id: `e${i}` }));
        assert.equal(api.mergeStoredArrays(existentes, entrantes).length, 500);
    });
});

// ========================================
// generateSongId
// ========================================

describe('generateSongId', () => {
    test('devuelve una cadena no vacía', () => {
        const id = api.generateSongId();
        assert.equal(typeof id, 'string');
        assert.ok(id.length > 0);
    });

    test('funciona sin crypto.randomUUID (contexto no seguro)', () => {
        const { api: sinCrypto, context } = loadApp();
        context.crypto = {};             // simula HTTP plano
        const id = sinCrypto.generateSongId();
        assert.equal(typeof id, 'string');
        assert.ok(id.startsWith('song_'), `respaldo no usado: ${id}`);
    });

    test('el respaldo produce identificadores distintos', () => {
        const { api: sinCrypto, context } = loadApp();
        context.crypto = {};
        const ids = new Set(Array.from({ length: 50 }, () => sinCrypto.generateSongId()));
        assert.ok(ids.size > 40, `demasiadas colisiones: ${ids.size}/50`);
    });
});

// ========================================
// IDB_SRC_PREFIX
// ========================================

describe('IDB_SRC_PREFIX', () => {
    test('es el prefijo esperado', () => {
        assert.equal(api.IDB_SRC_PREFIX, 'idb://');
    });

    test('no colisiona con blob: ni con http', () => {
        assert.ok(!'blob:x'.startsWith(api.IDB_SRC_PREFIX));
        assert.ok(!'https://x'.startsWith(api.IDB_SRC_PREFIX));
    });
});

// ========================================
// AudioUrlCache — ciclo de vida de los object URLs (T6)
// ========================================

describe('AudioUrlCache', () => {
    function nuevoEntorno() {
        const entorno = loadApp();
        return { cache: entorno.api.AudioUrlCache, urls: entorno.objectUrls };
    }

    test('crea un object URL al guardar', () => {
        const { cache, urls } = nuevoEntorno();
        const url = cache.put('cancion1', new Blob(['x']));
        assert.ok(url.startsWith('blob:'));
        assert.equal(urls.created.length, 1);
    });

    test('devuelve la misma URL para el mismo id', () => {
        const { cache, urls } = nuevoEntorno();
        const a = cache.put('c1', new Blob(['x']));
        const b = cache.put('c1', new Blob(['y']));
        assert.equal(a, b);
        assert.equal(urls.created.length, 1, 'no debe crear una segunda URL');
    });

    test('get devuelve lo guardado', () => {
        const { cache } = nuevoEntorno();
        const url = cache.put('c1', new Blob(['x']));
        assert.equal(cache.get('c1'), url);
    });

    test('get devuelve undefined para un id desconocido', () => {
        const { cache } = nuevoEntorno();
        assert.equal(cache.get('no-existe'), undefined);
    });

    test('drop revoca la URL', () => {
        const { cache, urls } = nuevoEntorno();
        const url = cache.put('c1', new Blob(['x']));
        cache.drop('c1');
        assert.ok(urls.revoked.includes(url));
        assert.equal(cache.get('c1'), undefined);
    });

    test('drop de un id desconocido no rompe', () => {
        const { cache } = nuevoEntorno();
        cache.drop('no-existe');
    });

    test('desaloja la entrada más antigua al llegar al límite', () => {
        const { cache, urls } = nuevoEntorno();
        for (let i = 0; i < 6; i++) cache.put(`c${i}`, new Blob([`${i}`]));

        assert.equal(urls.revoked.length, 1, 'debió revocar exactamente una');
        assert.equal(cache.get('c0'), undefined, 'la más antigua debe salir');
        assert.ok(cache.get('c5'), 'la más reciente debe seguir');
    });

    test('el número de URLs vivas nunca supera el máximo', () => {
        const { cache, urls } = nuevoEntorno();
        for (let i = 0; i < 40; i++) cache.put(`c${i}`, new Blob([`${i}`]));

        const vivas = urls.created.length - urls.revoked.length;
        assert.ok(vivas <= 5, `quedaron ${vivas} URLs vivas, máximo 5`);
    });

    test('clear revoca todas las URLs (regresión del defecto D4)', () => {
        const { cache, urls } = nuevoEntorno();
        for (let i = 0; i < 4; i++) cache.put(`c${i}`, new Blob([`${i}`]));
        cache.clear();

        assert.equal(urls.revoked.length, 4);
        for (let i = 0; i < 4; i++) assert.equal(cache.get(`c${i}`), undefined);
    });

    test('toda URL creada acaba revocada tras clear', () => {
        const { cache, urls } = nuevoEntorno();
        for (let i = 0; i < 12; i++) cache.put(`c${i}`, new Blob([`${i}`]));
        cache.clear();
        assert.equal(urls.created.length, urls.revoked.length);
    });
});

// ========================================
// resolveStreamSrc — resolución unificada del audio (T7)
// ========================================

describe('resolveStreamSrc', () => {
    test('devuelve tal cual una URL http', async () => {
        const r = await api.resolveStreamSrc({ src: 'https://cdn.example/a.m4a' });
        assert.equal(r, 'https://cdn.example/a.m4a');
    });

    test('devuelve tal cual una ruta de streaming propia', async () => {
        const r = await api.resolveStreamSrc({ src: '/api/stream/abc12345' });
        assert.equal(r, '/api/stream/abc12345');
    });

    test('resuelve idb:// desde el blob guardado', async () => {
        const entorno = loadApp();
        entorno.api.StorageModule.getBlob = async (id) =>
            id === 'mi-cancion' ? new Blob(['audio']) : undefined;

        const r = await entorno.api.resolveStreamSrc({ src: 'idb://mi-cancion' });
        assert.ok(r.startsWith('blob:'), `no resolvió a object URL: ${r}`);
    });

    test('reutiliza la caché en la segunda llamada', async () => {
        const entorno = loadApp();
        let lecturas = 0;
        entorno.api.StorageModule.getBlob = async () => { lecturas++; return new Blob(['a']); };

        const cancion = { src: 'idb://c1' };
        const a = await entorno.api.resolveStreamSrc(cancion);
        const b = await entorno.api.resolveStreamSrc(cancion);

        assert.equal(a, b);
        assert.equal(lecturas, 1, 'debió leer IndexedDB una sola vez');
    });

    test('si el blob fue desalojado, cae al streaming del servidor', async () => {
        const entorno = loadApp();
        entorno.api.StorageModule.getBlob = async () => undefined;

        const r = await entorno.api.resolveStreamSrc({
            src: 'idb://perdida',
            videoId: 'dQw4w9WgXcQ',
        });
        assert.ok(r.includes('/api/stream/dQw4w9WgXcQ'), `respaldo incorrecto: ${r}`);
    });

    test('devuelve null si no hay blob ni videoId', async () => {
        const entorno = loadApp();
        entorno.api.StorageModule.getBlob = async () => undefined;

        const r = await entorno.api.resolveStreamSrc({ src: 'idb://perdida', title: 'X' });
        assert.equal(r, null, 'debe avisar con null, no devolver una URL muerta');
    });

    test('un error leyendo IndexedDB no propaga la excepción', async () => {
        const entorno = loadApp();
        entorno.api.StorageModule.getBlob = async () => { throw new Error('IDB caído'); };

        const r = await entorno.api.resolveStreamSrc({
            src: 'idb://x',
            videoId: 'dQw4w9WgXcQ',
        });
        assert.ok(r.includes('/api/stream/'), 'debe caer al respaldo, no lanzar');
    });

    test('una entrada legada con blob: se devuelve tal cual', async () => {
        // No se resuelve, pero tampoco se rompe: T10 la marca como no disponible
        const r = await api.resolveStreamSrc({ src: 'blob:http://localhost/muerta' });
        assert.equal(r, 'blob:http://localhost/muerta');
    });
});

// ========================================
// isSongDuplicate
// ========================================

describe('isSongDuplicate', () => {
    test('detecta duplicado por videoId', () => {
        const lib = [{ videoId: 'abc', title: 'A', channel: 'C' }];
        const nueva = { videoId: 'abc', title: 'Otro título', channel: 'Otro' };
        assert.ok(api.isSongDuplicate(nueva, lib, new Set()));
    });

    test('detecta duplicado por título y canal', () => {
        const lib = [{ videoId: 'x', title: 'Canción', channel: 'Canal' }];
        const nueva = { videoId: 'y', title: 'Canción', channel: 'Canal' };
        assert.ok(api.isSongDuplicate(nueva, lib, new Set()));
    });

    test('una canción nueva no es duplicada', () => {
        const lib = [{ videoId: 'abc', title: 'A', channel: 'C' }];
        const nueva = { videoId: 'xyz', title: 'B', channel: 'D' };
        assert.ok(!api.isSongDuplicate(nueva, lib, new Set()));
    });

    test('detecta duplicado dentro del mismo lote', () => {
        const yaAnadidas = new Set(['abc']);
        const nueva = { videoId: 'abc', title: 'A', channel: 'C' };
        assert.ok(api.isSongDuplicate(nueva, [], yaAnadidas));
    });

    test('biblioteca vacía nunca da duplicado', () => {
        assert.ok(!api.isSongDuplicate({ videoId: 'x', title: 'A' }, [], new Set()));
    });

    test('mismo título con distinto canal no es duplicado', () => {
        const lib = [{ videoId: 'a', title: 'Versión', channel: 'Artista1' }];
        const nueva = { videoId: 'b', title: 'Versión', channel: 'Artista2' };
        assert.ok(!api.isSongDuplicate(nueva, lib, new Set()));
    });
});

// ========================================
// Media Session
// ========================================

describe('buildMediaSessionArtwork', () => {
    test('devuelve vacío si no hay carátula', () => {
        assert.deepEqual(plain(api.buildMediaSessionArtwork(null, true)), []);
        assert.deepEqual(plain(api.buildMediaSessionArtwork('', true)), []);
    });

    test('devuelve vacío si la URL no es válida para nativo', () => {
        assert.deepEqual(plain(api.buildMediaSessionArtwork('http://x/a.jpg', false)), []);
    });

    test('genera los seis tamaños estándar', () => {
        const a = api.buildMediaSessionArtwork('https://cdn/a.jpg', true);
        assert.equal(a.length, 6);
        assert.deepEqual(
            plain(a).map(x => x.sizes),
            ['96x96', '128x128', '192x192', '256x256', '384x384', '512x512']
        );
    });

    test('añade variantes de alta resolución para miniaturas de YouTube', () => {
        const a = api.buildMediaSessionArtwork(
            'https://i.ytimg.com/vi/abc/mqdefault.jpg', true
        );
        assert.equal(a.length, 8, 'deben añadirse hqdefault y maxresdefault');
        assert.ok(a.some(x => x.src.includes('hqdefault')));
        assert.ok(a.some(x => x.src.includes('maxresdefault')));
    });

    test('todas las entradas declaran tipo de imagen', () => {
        const a = api.buildMediaSessionArtwork('https://cdn/a.jpg', true);
        assert.ok(a.every(x => x.type === 'image/jpeg'));
    });
});

describe('validateArtworkUrlForNative', () => {
    test('sin carátula se considera válido', () => {
        assert.equal(api.validateArtworkUrlForNative(null), true);
        assert.equal(api.validateArtworkUrlForNative(''), true);
    });

    test('en web acepta http, https y data URLs', () => {
        assert.ok(api.validateArtworkUrlForNative('http://x/a.jpg'));
        assert.ok(api.validateArtworkUrlForNative('https://x/a.jpg'));
        assert.ok(api.validateArtworkUrlForNative('data:image/jpeg;base64,AAAA'));
    });

    test('en web rechaza esquemas desconocidos', () => {
        assert.ok(!api.validateArtworkUrlForNative('capacitor://localhost/x.jpg'));
        assert.ok(!api.validateArtworkUrlForNative('file:///x.jpg'));
    });
});
