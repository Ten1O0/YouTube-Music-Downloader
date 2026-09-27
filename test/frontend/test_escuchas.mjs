/**
 * Contar escuchas (plan 11, T5): 30 s escuchados, o la mitad si dura menos de
 * un minuto; saltar no suma; una vez por reproducción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { claveEscucha, crearContador, sumarEscucha, umbralEscucha } from '../../frontend/src/features/player/listens.js';

/** Simula una reproducción: avances de 0,25 s, como los timeupdate reales. */
function reproducir(contador, desde, hasta, duracion, paso = 0.25) {
    for (let t = desde; t <= hasta + 1e-9; t += paso) contador.avance(Number(t.toFixed(3)), duracion);
}

function montar() {
    const contadas = [];
    const cerradas = [];
    const contador = crearContador({
        alContar: (song, s) => contadas.push([song.src, s]),
        alCerrar: (song, s) => cerradas.push([song.src, Math.round(s)]),
    });
    return { contador, contadas, cerradas };
}

const cancion = { src: 'idb://1', videoId: 'aaaaaaaaaaa' };

describe('umbral', () => {
    test('30 s, o la mitad si dura menos de un minuto', () => {
        assert.equal(umbralEscucha(240), 30);
        assert.equal(umbralEscucha(60), 30);
        assert.equal(umbralEscucha(40), 20);
        assert.equal(umbralEscucha(1), 0.5);
        assert.equal(umbralEscucha(NaN), 30, 'sin duración conocida, 30 s');
    });
});

describe('crearContador', () => {
    test('29 s no cuentan; 30 s sí, una vez', () => {
        const { contador, contadas } = montar();
        contador.nueva(cancion);
        reproducir(contador, 0, 29, 200);
        assert.equal(contadas.length, 0);
        reproducir(contador, 29.25, 60, 200);
        assert.equal(contadas.length, 1, 'una sola vez aunque siga sonando');
    });

    test('una canción de 40 s cuenta a los 20', () => {
        const { contador, contadas } = montar();
        contador.nueva(cancion);
        reproducir(contador, 0, 19.5, 40);
        assert.equal(contadas.length, 0);
        reproducir(contador, 19.75, 21, 40);
        assert.equal(contadas.length, 1);
    });

    test('arrastrar la barra no suma', () => {
        const { contador, contadas } = montar();
        contador.nueva(cancion);
        reproducir(contador, 0, 5, 200);
        contador.saltar(150);
        reproducir(contador, 150, 170, 200);
        assert.equal(contadas.length, 0, 'son 25 s escuchados, no 170');
    });

    test('un salto sin evento seeked tampoco suma', () => {
        const { contador, contadas } = montar();
        contador.nueva(cancion);
        contador.avance(0, 200);
        contador.avance(100, 200);
        assert.equal(contadas.length, 0);
    });

    test('tras una pausa, el primer avance no suma el tiempo parado', () => {
        const { contador, contadas } = montar();
        contador.nueva(cancion);
        reproducir(contador, 0, 10, 200);
        contador.pausar();
        contador.avance(10.25, 200);
        reproducir(contador, 10.5, 20, 200);
        assert.equal(contadas.length, 0);
    });

    test('volver a empezar la misma canción cuenta otra vez', () => {
        const { contador, contadas } = montar();
        contador.nueva(cancion);
        reproducir(contador, 0, 31, 200);
        contador.nueva(cancion);
        reproducir(contador, 0, 31, 200);
        assert.equal(contadas.length, 2);
    });

    test('al cerrar, los segundos totales solo de lo que contó', () => {
        const { contador, cerradas } = montar();
        contador.nueva(cancion);
        reproducir(contador, 0, 10, 200);
        contador.nueva({ src: 'idb://2' });           // cambió antes del umbral: nada
        reproducir(contador, 0, 45, 200);
        contador.cerrar();
        assert.deepEqual(cerradas, [['idb://2', 45]]);
    });

    test('sin canción no hace nada', () => {
        const { contador, contadas } = montar();
        reproducir(contador, 0, 40, 200);
        assert.equal(contadas.length, 0);
    });
});

describe('sumarEscucha y claveEscucha', () => {
    test('suma escuchas y segundos, sin tocar las demás', () => {
        let m = sumarEscucha({ otra: { n: 3, ultima: 'x', segundos: 10 } }, 'k', 31.4, 'ahora');
        m = sumarEscucha(m, 'k', 30, 'luego');
        assert.deepEqual(m.k, { n: 2, ultima: 'luego', segundos: 61 });
        assert.deepEqual(m.otra, { n: 3, ultima: 'x', segundos: 10 });
    });
    test('la clave es el videoId, que es igual en todos los dispositivos', () => {
        assert.equal(claveEscucha({ src: 'idb://1', videoId: 'v' }), 'v');
        assert.equal(claveEscucha({ src: 'file://x' }), 'file://x');
        assert.equal(claveEscucha(null), null);
    });
});
