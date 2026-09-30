/**
 * El latido de la reproducción (plan 19, T13 y T15).
 *
 * Con la música sonando, el audio avisa cuatro veces por segundo. Antes, cada
 * segundo se le repetía la posición al sistema por el puente nativo, aunque
 * Android la avanza solo desde la última que recibió. Ahora solo se le
 * corrige cuando se desvía; y la carátula llega a la APK una vez por canción.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// El plugin de la APK, falso: apunta lo que se le manda
const llamadas = [];
globalThis.Capacitor = {
    platform: 'android',
    Plugins: {
        MediaSession: {
            setMetadata: async (m) => { llamadas.push(['metadata', m]); },
            setPositionState: async (p) => { llamadas.push(['posicion', p]); },
            setPlaybackState: async (e) => { llamadas.push(['estado', e]); },
            setActionHandler: async () => {},
        },
    },
};

const { createSesionSistema } = await import('../../frontend/src/features/player/system-session.js');

const posiciones = () => llamadas.filter(([tipo]) => tipo === 'posicion');

describe('la posición en el sistema', () => {
    let ahora, audio, sesion;
    const dateNow = Date.now;
    beforeEach(() => {
        llamadas.length = 0;
        ahora = 1_000_000;
        Date.now = () => ahora;
        audio = { duration: 200, currentTime: 0, paused: false, playbackRate: 1 };
        sesion = createSesionSistema({ audio, resume() {}, pause() {}, prev() {}, next() {}, updatePlayPauseBtn() {} });
    });
    afterEach(() => { Date.now = dateNow; });

    /** Avanza el reloj y, si suena, el audio con él, en latidos de 250 ms. */
    function sonar(ms, { audioAvanza = true } = {}) {
        for (let t = 0; t < ms; t += 250) {
            ahora += 250;
            if (audioAvanza && !audio.paused) audio.currentTime += 0.25;
            sesion.revisarPosicion();
        }
    }

    test('se envía una vez y el sistema la avanza solo: ni una más en un minuto', () => {
        sonar(250);
        assert.equal(posiciones().length, 1);
        sonar(60_000);
        assert.equal(posiciones().length, 1, 'se repitió la posición sin que cambiara nada');
    });

    test('si el audio se atasca (red), se corrige en cuanto se desvía más de 1 s', () => {
        sonar(250);
        sonar(1000, { audioAvanza: false });
        assert.equal(posiciones().length, 1, 'un desvío de 1 s aún no se corrige');
        sonar(500, { audioAvanza: false });
        assert.equal(posiciones().length, 2);
        assert.equal(posiciones().at(-1)[1].position, audio.currentTime);
    });

    test('en pausa, el sistema no la avanza: no hay nada que corregir', () => {
        sonar(250);
        audio.paused = true;
        sesion.updatePositionState(); // lo hace el 'pause'
        sonar(10_000);
        assert.equal(posiciones().length, 2);
    });

    test('otra duración (cambió la canción) se envía enseguida', () => {
        sonar(250);
        audio.duration = 180;
        audio.currentTime = 0;
        sesion.revisarPosicion();
        assert.equal(posiciones().length, 2);
        assert.equal(posiciones().at(-1)[1].duration, 180);
    });
});

describe('la carátula en la APK', () => {
    test('una sola vez por canción aunque no haya cuadrada', async () => {
        llamadas.length = 0;
        const audio = { duration: 200, currentTime: 0, paused: false, playbackRate: 1 };
        const sesion = createSesionSistema({ audio, resume() {}, pause() {}, prev() {}, next() {}, updatePlayPauseBtn() {} });
        sesion.updateMediaSession({ title: 'Canción', artist: 'Alguien', thumbnail: 'data:image/jpeg;base64,xx' });
        await new Promise(r => setTimeout(r, 450));
        const metadatos = llamadas.filter(([tipo]) => tipo === 'metadata');
        assert.equal(metadatos.length, 1);
        assert.equal(metadatos[0][1].artwork.length, 1, 'a la APK, una sola imagen (Binder)');
    });
});

