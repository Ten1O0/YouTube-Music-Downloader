/**
 * Lo que llega de fuera (plan 13, §3): la sincronización y los ficheros de
 * copia se validan campo a campo. Ficheros hostiles incluidos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeguro, validarCancion, validarCopia, validarLista, validarRemotos, validarAjustes, validarEscucha } from '../../frontend/src/features/sync/validar.js';

const ID = 'dQw4w9WgXcQ';
const copia = (extra = {}) => ({ formato: 'music-downloader', version: 1, creada: '2026-10-02T18:30:00Z', biblioteca: [], listas: [], favoritos: [], escuchas: [], ajustes: {}, ...extra });

describe('parseSeguro', () => {
    test('descarta __proto__, constructor y prototype a cualquier profundidad', () => {
        const o = parseSeguro('{"a":1,"__proto__":{"contaminado":true},"b":{"constructor":{"prototype":{"x":1}},"c":2}}');
        assert.equal(o.a, 1);
        assert.equal(o.b.c, 2);
        assert.equal(Object.hasOwn(o, '__proto__'), false);
        assert.equal(Object.hasOwn(o.b, 'constructor'), false);
        assert.equal({}.contaminado, undefined, 'el prototipo global sigue limpio');
    });
});

describe('validarCancion', () => {
    test('recorta los textos, quita caracteres de control y rehace lo que falta', () => {
        const c = validarCancion({ videoId: ID, title: 'x'.repeat(1000), artist: 'A\u0000B', editado: 'sí', duration: -5, addedAt: 'ayer', thumbnail: 'javascript:alert(1)' });
        assert.equal(c.title.length, 300);
        assert.equal(c.artist, 'A B');
        assert.equal(c.editado, false, 'solo true vale como editado');
        assert.equal(c.duration, 0);
        assert.equal(c.addedAt, new Date(0).toISOString());
        assert.equal('thumbnail' in c, false, 'las miniaturas de fuera no se aceptan');
    });

    test('el HTML de los títulos llega como texto: lo escapa quien lo pinta', () => {
        assert.equal(validarCancion({ videoId: ID, title: '<img src=x onerror=alert(1)>' }).title, '<img src=x onerror=alert(1)>');
    });

    test('videoId falsos o de otro tipo: fuera', () => {
        for (const videoId of ['corto', 'dQw4w9WgXc!', 'dQw4w9WgXcQQ', 12345678901, null, '../../../etc']) {
            assert.equal(validarCancion({ videoId }), null, String(videoId));
        }
        for (const c of [null, 'texto', [], 7]) assert.equal(validarCancion(c), null);
    });
});

describe('validarLista', () => {
    test('nombre de 1 a 40, canciones válidas, sin repetidas, como mucho 1.000', () => {
        const l = validarLista({ id: 'pl_1', name: '  Viaje ', description: 'd'.repeat(500), songs: [ID, 'falso', ID, 3] });
        assert.deepEqual([l.name, l.description.length, l.songs], ['Viaje', 200, [ID]]);
        assert.equal(validarLista({ id: 'x', name: '   ' }), null);
        assert.equal(validarLista({ id: 'x', name: 'n'.repeat(41) }), null);
        assert.equal(validarLista({ id: '../x', name: 'n' }), null);
        const muchas = Array.from({ length: 1500 }, (_, i) => `v${String(i).padStart(10, '0')}`);
        assert.equal(validarLista({ id: 'x', name: 'n', songs: muchas }).songs.length, 1000);
    });

    test('una lápida solo necesita su id', () => {
        assert.deepEqual(validarLista({ id: 'x', deleted: true }), { id: 'x', deleted: true });
    });
});

test('validarAjustes: solo lo conocido y con valores válidos', () => {
    assert.deepEqual(validarAjustes({ idioma: 'fr', tema: 'rosa', reproduccion: { fundido: 6, igualar: 'no', visualizador: false, otra: 1 } }),
        { idioma: 'fr', reproduccion: { fundido: 6, visualizador: false } });
    assert.deepEqual(validarAjustes({ idioma: 'klingon', reproduccion: { fundido: 7 } }), { reproduccion: {} });
    assert.equal(validarAjustes('x'), null);
});

test('validarEscucha', () => {
    assert.deepEqual(validarEscucha({ videoId: ID, artista: 'A', cancion: 'T', t: 1, s: 40 }), { videoId: ID, artista: 'A', cancion: 'T', t: 1, s: 40 });
    assert.equal(validarEscucha({ videoId: ID, t: Date.now() + 10 * 86_400_000 }), null, 'del futuro no');
    assert.equal(validarEscucha({ videoId: 'x', t: 1 }), null);
});

describe('validarCopia con ficheros hostiles', () => {
    test('otro formato u otra versión: no es una copia', () => {
        for (const c of [null, [], {}, { formato: 'otra-app', version: 1 }, copia({ version: 2 }), copia({ version: '1' })]) {
            assert.equal(validarCopia(c), null);
        }
    });

    test('tipos cambiados: se toman como vacíos, sin romper', () => {
        const v = validarCopia(copia({ biblioteca: 'no', listas: { a: 1 }, favoritos: 7, escuchas: null, ajustes: [] }));
        assert.deepEqual(v.resumen, { canciones: 0, listas: 0, favoritos: 0, escuchas: 0, descartadas: 0 });
    });

    test('100.000 canciones: se quedan en el límite de la cuenta', () => {
        const biblioteca = Array.from({ length: 100_000 }, (_, i) => ({ videoId: `v${String(i).padStart(10, '0')}`, title: 't' }));
        assert.equal(validarCopia(copia({ biblioteca })).biblioteca.length, 10_000);
    });

    test('las entradas malas se descartan y se cuentan; las repetidas, una vez', () => {
        const v = validarCopia(copia({
            biblioteca: [{ videoId: ID }, { videoId: ID }, { videoId: 'falso' }, 'x'],
            listas: [{ id: 'a', name: 'A', songs: [ID] }, { id: 'b', name: '' }],
            favoritos: [ID, 'falso', ID],
            escuchas: [{ videoId: ID, t: 5 }, { videoId: ID }],
        }));
        assert.deepEqual(v.resumen, { canciones: 1, listas: 1, favoritos: 1, escuchas: 1, descartadas: 5 });
    });

    test('una copia envenenada por texto no toca el prototipo', () => {
        const v = validarCopia(parseSeguro(JSON.stringify(copia()).replace('{', '{"__proto__":{"admin":true},')));
        assert.ok(v);
        assert.equal({}.admin, undefined);
    });
});

test('validarRemotos: la respuesta del servidor también se valida', () => {
    assert.equal(validarRemotos({ biblioteca: [] }), null, 'sin seq no');
    assert.equal(validarRemotos({ seq: -1 }), null);
    const r = validarRemotos({ seq: 3, biblioteca: [{ videoId: ID, deleted: true }, { videoId: 'x' }], listas: [{ id: 'a', deleted: true }], ajustes: null });
    assert.deepEqual(r.biblioteca.map((c) => [c.videoId, c.deleted]), [[ID, true]]);
    assert.deepEqual(r.listas, [{ id: 'a', deleted: true }]);
    assert.equal(r.ajustes, null);
});
