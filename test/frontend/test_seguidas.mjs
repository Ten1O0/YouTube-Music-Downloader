/**
 * Listas de YouTube que se siguen (plan 14, T4): las reglas de seguidas.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CADA_MS, cancionDeLista, esSeguida, incorporar, listaDe, listaVinculada, nuevasDe,
    puedeDescargarSolo, sinVinculo, tocaComprobar,
} from '../../frontend/src/features/seguidas.js';

const LISTA = 'PLabcdefghij0123456789';
const v = (n) => `vid${String(n).padStart(8, '0')}`;

test('listaDe: saca el id de la URL o lo acepta suelto, como el servidor', () => {
    assert.equal(listaDe(`https://www.youtube.com/playlist?list=${LISTA}`), LISTA);
    assert.equal(listaDe(`https://music.youtube.com/watch?v=${v(1)}&list=${LISTA}&index=3`), LISTA);
    assert.equal(listaDe(`  ${LISTA} `), LISTA);
});

test('listaDe: las mezclas automáticas (RD…) y lo que no es una lista no se siguen', () => {
    assert.equal(listaDe(`https://www.youtube.com/watch?v=${v(1)}&list=RDabcdefghij0123`), null);
    assert.equal(listaDe('https://www.youtube.com/watch?v=abc'), null);
    assert.equal(listaDe('corto'), null);
    assert.equal(listaDe('PL<script>alert(1)</script>'), null);
    assert.equal(listaDe(null), null);
});

test('puedeDescargarSolo: en la web siempre; en la APK, según el Wi-Fi si se pidió', () => {
    const auto = { auto: true, soloWifi: true };
    assert.equal(puedeDescargarSolo(auto, undefined, false), true);
    assert.equal(puedeDescargarSolo(auto, { type: 'wifi' }, true), true);
    assert.equal(puedeDescargarSolo(auto, { type: 'cellular' }, true), false);
    // Sin la API de conexión no se sabe: mejor no gastar datos
    assert.equal(puedeDescargarSolo(auto, undefined, true), false);
    assert.equal(puedeDescargarSolo({ auto: true, soloWifi: false }, { type: 'cellular' }, true), true);
    assert.equal(puedeDescargarSolo({ auto: false, soloWifi: false }, { type: 'wifi' }, false), false);
});

test('cancionDeLista: acepta id o videoId, recorta y descarta lo que no es un vídeo', () => {
    assert.deepEqual(cancionDeLista({ id: v(1), title: 'Canción', channel: 'Canal', duration: 200.7 }),
        { videoId: v(1), title: 'Canción', channel: 'Canal', duration: 200 });
    assert.equal(cancionDeLista({ id: 'no-vale' }), null);
    assert.equal(cancionDeLista({ videoId: v(2), duration: -5 }).duration, 0);
    assert.equal(cancionDeLista({ videoId: v(2), title: 'x'.repeat(1000) }).title.length, 300);
});

test('nuevasDe: solo lo que no se había visto, sin repetir', () => {
    const nuevas = nuevasDe([{ id: v(1) }, { id: v(2) }, { id: v(2) }, { id: v(3) }], [v(1)]);
    assert.deepEqual(nuevas.map((c) => c.videoId), [v(2), v(3)]);
});

test('tocaComprobar: cada 6 horas, o ya si se fuerza', () => {
    const ahora = 1_800_000_000_000;
    assert.equal(tocaComprobar({ comprobada: ahora - CADA_MS + 1000 }, ahora), false);
    assert.equal(tocaComprobar({ comprobada: ahora - CADA_MS }, ahora), true);
    assert.equal(tocaComprobar({ comprobada: ahora }, ahora, true), true);
    assert.equal(tocaComprobar({}, ahora), true);
});

test('incorporar: lo que no está llega en la nube; lo que ya está se reutiliza', () => {
    const tenida = { src: 'idb://1', videoId: v(1), title: 'Ya la tengo', channel: 'C' };
    const lista = listaVinculada({ id: '111', nombre: 'Mi lista', listId: LISTA });
    const r = incorporar({ biblioteca: [tenida], listas: [lista] }, '111', [
        { videoId: v(1), title: 'Ya la tengo' },
        { videoId: v(2), title: 'Artista - Nueva', channel: 'Canal' },
    ], '2026-09-28T10:00:00.000Z');

    assert.equal(r.nuevasEnNube.length, 1);
    const nueva = r.biblioteca.find((s) => s.videoId === v(2));
    assert.equal(nueva.nube, true);
    assert.equal(nueva.src, `nube://${v(2)}`);
    // Artista y canción se deducen del título, como en cualquier descarga
    assert.equal(nueva.artist, 'Artista');
    assert.equal(nueva.track, 'Nueva');
    assert.equal(r.biblioteca.find((s) => s.videoId === v(1)).src, 'idb://1');
    assert.deepEqual(r.listas[0].songs.map((s) => s.videoId), [v(1), v(2)]);
    assert.equal(r.anadidas, 2);
});

test('incorporar: no repite y no borra lo que ya había en la lista vinculada', () => {
    const vieja = { src: 'idb://9', videoId: v(9), title: 'Borrada en YouTube' };
    const lista = { ...listaVinculada({ id: '111', nombre: 'L', listId: LISTA }), songs: [vieja] };
    const r = incorporar({ biblioteca: [vieja], listas: [lista] }, '111', [{ videoId: v(1) }, { videoId: v(1) }]);
    assert.deepEqual(r.listas[0].songs.map((s) => s.videoId), [v(9), v(1)]);
    assert.equal(r.anadidas, 1);
    // Otra vez lo mismo: nada nuevo
    const otra = incorporar({ biblioteca: r.biblioteca, listas: r.listas }, '111', [{ videoId: v(1) }]);
    assert.equal(otra.nuevasEnNube.length, 0);
    assert.equal(otra.anadidas, 0);
});

test('incorporar: las demás listas no se tocan', () => {
    const otra = { id: '222', name: 'Otra', songs: [] };
    const r = incorporar({ biblioteca: [], listas: [otra] }, '111', [{ videoId: v(1) }]);
    assert.equal(r.listas[0], otra);
});

test('esSeguida y sinVinculo: el distintivo va y viene con el origen', () => {
    const pl = listaVinculada({ id: '1', nombre: 'L', listId: LISTA });
    assert.equal(esSeguida(pl), true);
    const normal = sinVinculo(pl);
    assert.equal(esSeguida(normal), false);
    assert.equal('origen' in normal, false);
    assert.equal(normal.name, 'L');
    assert.equal(esSeguida({ origen: { tipo: 'spotify', lista: 'x' } }), false);
});
