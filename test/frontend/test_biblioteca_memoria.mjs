/**
 * La biblioteca y las listas en memoria (plan 19, T3): coherentes al guardar,
 * cuando escribe otro y cuando cambia otra pestaña.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agrupada, copiar, crearColeccion } from '../../frontend/src/core/coleccion.js';

/** Un almacén en memoria que cuenta lecturas y avisa de las escrituras, como StorageModule. */
function almacen(inicial = {}, { falla = false } = {}) {
    const datos = structuredClone(inicial);
    const oyentes = new Map();
    const a = {
        lecturas: 0,
        falla,
        async get(k) { a.lecturas++; await null; return structuredClone(datos[k]); },
        async set(k, v) {
            if (a.falla) throw new Error('cuota');
            datos[k] = structuredClone(v);
            (oyentes.get(k) ?? []).forEach((fn) => fn(v));
        },
        alEscribir(k, fn) { if (!oyentes.has(k)) oyentes.set(k, []); oyentes.get(k).push(fn); },
        datos,
    };
    return a;
}

function canalFalso() {
    const oyentes = [];
    return { addEventListener: (_t, fn) => oyentes.push(fn), postMessage: () => {}, emitir: (data) => oyentes.forEach((fn) => fn({ data })) };
}

const lib = [{ src: 'a', videoId: 'aaaaaaaaaaa', title: 'A' }, { src: 'b', videoId: 'bbbbbbbbbbb', title: 'B' }];

test('se lee una vez; después, memoria (aunque la pidan varios a la vez)', async () => {
    const alm = almacen({ ytdl_library: lib });
    const c = crearColeccion('ytdl_library', { almacen: alm, canal: null });
    await Promise.all([c.get(), c.get(), c.get()]);
    await c.get();
    assert.equal(alm.lecturas, 1);
});

test('lo que devuelve es una copia: cambiarla no toca la memoria', async () => {
    const c = crearColeccion('ytdl_library', { almacen: almacen({ ytdl_library: lib }), canal: null });
    const una = await c.get();
    una[0].title = 'Cambiada';
    una.push({ src: 'c' });
    const otra = await c.get();
    assert.equal(otra[0].title, 'A');
    assert.equal(otra.length, 2);
});

test('guardar devuelve cómo estaba antes (para el diario) y no vuelve a leer', async () => {
    const alm = almacen({ ytdl_library: lib });
    const c = crearColeccion('ytdl_library', { almacen: alm, canal: null });
    const nueva = [...(await c.get()), { src: 'c', videoId: 'ccccccccccc', title: 'C' }];
    const antes = await c.set(nueva);
    assert.deepEqual(antes.map((s) => s.src), ['a', 'b']);
    assert.deepEqual((await c.get()).map((s) => s.src), ['a', 'b', 'c']);
    assert.deepEqual(alm.datos.ytdl_library.map((s) => s.src), ['a', 'b', 'c']);
    assert.equal(alm.lecturas, 1);
    // Cambiar después lo que se guardó no toca la memoria
    nueva[0].title = 'Tarde';
    assert.equal((await c.get())[0].title, 'A');
});

test('si otro escribe la clave (una migración, la recuperación), se relee', async () => {
    const alm = almacen({ ytdl_library: lib });
    const c = crearColeccion('ytdl_library', { almacen: alm, canal: null });
    await c.get();
    await alm.set('ytdl_library', [{ src: 'z', title: 'Z' }]);
    assert.deepEqual((await c.get()).map((s) => s.src), ['z']);
    assert.equal(alm.lecturas, 2);
});

test('lo que escribe la propia colección no la invalida', async () => {
    const alm = almacen({ ytdl_library: lib });
    const c = crearColeccion('ytdl_library', { almacen: alm, canal: null });
    await c.set(await c.get());
    await c.get();
    assert.equal(alm.lecturas, 1);
});

test('otra pestaña cambia la clave: se relee', async () => {
    const alm = almacen({ ytdl_library: lib });
    const canal = canalFalso();
    const c = crearColeccion('ytdl_library', { almacen: alm, canal });
    await c.get();
    alm.datos.ytdl_library = [{ src: 'otra' }];
    canal.emitir('ytdl_playlists'); // otra clave: nada
    assert.deepEqual((await c.get()).map((s) => s.src), ['a', 'b']);
    canal.emitir('ytdl_library');
    assert.deepEqual((await c.get()).map((s) => s.src), ['otra']);
});

test('si guardar falla, la memoria no cambia', async () => {
    const alm = almacen({ ytdl_library: lib });
    const c = crearColeccion('ytdl_library', { almacen: alm, canal: null });
    await c.get();
    alm.falla = true;
    await assert.rejects(() => c.set([{ src: 'x' }]));
    assert.deepEqual((await c.get()).map((s) => s.src), ['a', 'b']);
});

test('se normaliza al leer (duplicados fuera, como hacía getLibrary)', async () => {
    const alm = almacen({ ytdl_library: [...lib, { ...lib[0] }] });
    const c = crearColeccion('ytdl_library', {
        almacen: alm, canal: null,
        normalizar: (l) => l.filter((s, i) => l.findIndex((x) => x.videoId === s.videoId) === i),
    });
    assert.equal((await c.get()).length, 2);
});

test('copiar: también las canciones de dentro de cada lista', () => {
    const listas = [{ id: '1', songs: [{ src: 'a' }] }];
    const c = copiar(listas);
    c[0].songs[0].src = 'cambiada';
    c[0].songs.push({ src: 'b' });
    assert.equal(listas[0].songs[0].src, 'a');
    assert.equal(listas[0].songs.length, 1);
});

test('agrupada: una sola vez tras el último cambio, con el último valor; ya() la adelanta', async () => {
    const hechas = [];
    const pedir = agrupada((v) => hechas.push(v), 30);
    pedir(1); pedir(2); pedir(3);
    assert.deepEqual(hechas, []);
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual(hechas, [3]);
    pedir(4);
    pedir.ya();
    assert.deepEqual(hechas, [3, 4]);
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual(hechas, [3, 4]); // no se repite
});
