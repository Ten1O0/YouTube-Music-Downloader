/**
 * La duración de una canción descargada (plan 22). El servidor la manda en el
 * progreso, pero se perdía al guardar la canción: sin ella, la letra no puede
 * distinguir versiones ni una lista saber cuánto dura.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './harness.mjs';

const { api } = app();
const entrada = (finalProgressData, videoInfo = null) =>
    api.entradaDeBiblioteca({ streamUrl: 'idb://x', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', finalProgressData, videoInfo });

test('guarda la duración que manda el servidor, en segundos enteros', () => {
    assert.equal(entrada({ title: 'Canción', duration: 198.4 }).duration, 198);
});

test('si el servidor no la manda, la de la búsqueda', () => {
    assert.equal(entrada({ title: 'Canción' }, { title: 'Canción', duration: 212 }).duration, 212);
});

test('sin una duración válida, no se inventa ninguna', () => {
    for (const duration of [undefined, null, 0, -3, Number.NaN, '200']) {
        assert.equal('duration' in entrada({ title: 'Canción', duration }), false, String(duration));
    }
});
