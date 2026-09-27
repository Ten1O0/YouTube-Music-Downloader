/**
 * Motor de dos elementos de audio (plan 12, T2).
 *
 * Dos <audio> se turnan: mientras uno suena, el otro precarga la siguiente
 * canción, y durante un fundido suenan los dos. El resto del reproductor no se
 * entera: recibe `engine.audio`, un envoltorio con la interfaz de un <audio>
 * que habla siempre con el elemento **actual**.
 *
 * - El actual lleva siempre `id="mainAudio"`; al cambiar, los ids se
 *   intercambian. Lo que busque el elemento por id sigue funcionando.
 * - Los eventos del otro elemento no llegan a los escuchadores del envoltorio:
 *   una canción que se apaga no mueve la barra de la que entra.
 * - `volume` en el envoltorio es el volumen del usuario. El que suena en cada
 *   elemento es ese, por la ganancia de su canción, por su parte del fundido.
 *
 * No se crean ni destruyen elementos por canción: se perdería la precarga y la
 * sesión multimedia del sistema se reiniciaría.
 */

import { volumenEfectivo } from '../../core/loudness.js';

const IDS = ['mainAudio', 'deckAudio'];
/** Lo que el envoltorio repite al cambiar de elemento: el nuevo actual ya los disparó mientras era el otro. */
const AL_CAMBIAR = ['durationchange', 'loadedmetadata', 'play', 'playing', 'timeupdate'];

export function createEngine({ a, b }) {
    const els = [a, b];
    let indice = 0;
    let usuario = typeof a.volume === 'number' ? a.volume : 1;
    const mezcla = new Map(els.map((el) => [el, { ganancia: 1, cruce: 1 }]));
    const oyentes = new Map();
    const interceptores = new Map();
    const alCambiar = new Set();

    const actual = () => els[indice];
    const libre = () => els[1 - indice];

    function emitir(tipo, evento) {
        for (const fn of [...(oyentes.get(tipo) ?? [])]) {
            try { fn.call(audio, evento); } catch (e) { console.error(`[Motor] Escuchador de '${tipo}':`, e); }
        }
    }

    const enganchados = new Set();
    function enganchar(tipo) {
        if (enganchados.has(tipo)) return;
        enganchados.add(tipo);
        for (const el of els) {
            el.addEventListener(tipo, (e) => {
                if (el !== actual()) return;
                if (interceptores.get(tipo)?.(e)) return;
                emitir(tipo, e);
            });
        }
    }

    function aplicarVolumen(el) {
        el.volume = volumenEfectivo({ usuario, ...mezcla.get(el) });
    }

    const audio = {
        get src() { return actual().src; },
        set src(v) { actual().src = v; },
        get currentTime() { return actual().currentTime; },
        set currentTime(v) { actual().currentTime = v; },
        get duration() { return actual().duration; },
        get paused() { return actual().paused; },
        get ended() { return actual().ended; },
        get readyState() { return actual().readyState; },
        get playbackRate() { return actual().playbackRate; },
        set playbackRate(v) { actual().playbackRate = v; },
        get loop() { return actual().loop; },
        get volume() { return usuario; },
        set volume(v) {
            usuario = Math.min(1, Math.max(0, Number(v) || 0));
            els.forEach(aplicarVolumen);
        },
        play() { return actual().play(); },
        pause() { actual().pause(); },
        load() { actual().load(); },
        addEventListener(tipo, fn) {
            enganchar(tipo);
            if (!oyentes.has(tipo)) oyentes.set(tipo, new Set());
            oyentes.get(tipo).add(fn);
        },
        removeEventListener(tipo, fn) { oyentes.get(tipo)?.delete(fn); },
    };

    return {
        audio,
        actual,
        libre,
        /** Ganancia (igualar volumen) y parte del fundido de un elemento. */
        mezclar(el, { ganancia, cruce } = {}) {
            const m = mezcla.get(el);
            if (!m) return;
            if (ganancia !== undefined) m.ganancia = ganancia;
            if (cruce !== undefined) m.cruce = cruce;
            aplicarVolumen(el);
        },
        precargar(src) {
            const el = libre();
            el.src = src;
            el.load();
        },
        /** Para y vacía el elemento libre (la siguiente precargada o la que se apaga). */
        detenerLibre() {
            const el = libre();
            el.pause();
            if (el.getAttribute?.('src') || el.src) {
                el.removeAttribute?.('src');
                el.load();
            }
            mezcla.get(el).cruce = 1;
        },
        /** El libre pasa a ser el actual. */
        intercambiar() {
            indice = 1 - indice;
            actual().id = IDS[0];
            libre().id = IDS[1];
            for (const tipo of AL_CAMBIAR) {
                if (tipo === 'play' || tipo === 'playing') {
                    if (actual().paused) continue;
                }
                emitir(tipo, { type: tipo, target: actual(), sintetico: true });
            }
            for (const fn of alCambiar) fn(actual());
        },
        /** Un interceptor que devuelve true se queda el evento del actual (no llega al envoltorio). */
        interceptar(tipo, fn) {
            enganchar(tipo);
            interceptores.set(tipo, fn);
        },
        alCambiar(fn) { alCambiar.add(fn); },
    };
}
