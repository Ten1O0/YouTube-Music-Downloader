/**
 * La duración de lo descargado antes del plan 22 (plan 23): qué canción toca,
 * qué se acepta como duración y dónde se guarda.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './harness.mjs';

const { api } = app();
const { siguienteSinDuracion, segundosDeAudio, ponerDuracion, MAX_INTENTOS_DURACION } = api;

test('toca la primera del dispositivo sin duración, sin las de la nube ni las que fallaron dos veces', () => {
    const biblioteca = [
        { src: 'idb://a', duration: 200 },
        { src: 'nube://b', nube: true },
        { src: 'idb://c' },
        { src: 'idb://d', duration: 0 },
    ];
    assert.equal(siguienteSinDuracion(biblioteca).src, 'idb://c');
    assert.equal(siguienteSinDuracion(biblioteca, { 'idb://c': MAX_INTENTOS_DURACION }).src, 'idb://d');
    assert.equal(siguienteSinDuracion([{ src: 'idb://a', duration: 200 }]), null);
    assert.equal(siguienteSinDuracion(undefined), null);
});

test('la duración del <audio>, en segundos enteros; lo que no es una duración, no', () => {
    assert.equal(segundosDeAudio(198.4), 198);
    assert.equal(segundosDeAudio(0.3), 1);
    for (const raro of [Number.NaN, Infinity, 0, -1, undefined]) assert.equal(segundosDeAudio(raro), null, String(raro));
});

test('se pone en todas las copias de esa canción que no la tienen, y en ninguna otra', () => {
    const copias = [{ src: 'idb://a' }, { src: 'idb://b' }, { src: 'idb://a', duration: 190 }, { src: 'idb://a' }];
    assert.equal(ponerDuracion(copias, 'idb://a', 200), 2);
    assert.deepEqual(copias.map((s) => s.duration), [200, undefined, 190, 200]);
});
