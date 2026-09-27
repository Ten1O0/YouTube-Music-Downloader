/**
 * El motor de dos elementos y las transiciones sobre él (plan 12, T2 y T3),
 * con <audio> simulados: el envoltorio reenvía al actual, filtra los eventos
 * del otro, #mainAudio es siempre el que suena y el paso de canción ocurre una
 * sola vez, en el momento que toca.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../frontend/src/features/player/engine.js';
import { createTransiciones } from '../../frontend/src/features/player/transitions.js';

class AudioFalso extends EventTarget {
    constructor(id) {
        super();
        Object.assign(this, { id, src: '', currentTime: 0, duration: NaN, paused: true, ended: false, volume: 1, loop: false, playbackRate: 1, readyState: 0 });
    }
    emitir(tipo) { this.dispatchEvent(new Event(tipo)); }
    play() { this.paused = false; this.ended = false; this.emitir('play'); return Promise.resolve(); }
    pause() { if (!this.paused) { this.paused = true; this.emitir('pause'); } }
    load() { this.currentTime = 0; }
    getAttribute(n) { return n === 'src' ? this.src || null : null; }
    removeAttribute(n) { if (n === 'src') this.src = ''; }
    /** Avanza la reproducción y dispara timeupdate. */
    ir(t) { this.currentTime = t; this.emitir('timeupdate'); }
    acabar() { this.currentTime = this.duration; this.paused = true; this.ended = true; this.emitir('pause'); this.emitir('ended'); }
}

function montar() {
    const a = new AudioFalso('mainAudio');
    const b = new AudioFalso('deckAudio');
    const engine = createEngine({ a, b });
    return { a, b, engine, audio: engine.audio };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('envoltorio', () => {
    test('reenvía propiedades y métodos al elemento actual', async () => {
        const { a, audio } = montar();
        audio.src = 'blob:uno';
        assert.equal(a.src, 'blob:uno');
        a.duration = 180;
        audio.currentTime = 42;
        assert.equal(a.currentTime, 42);
        assert.equal(audio.duration, 180);
        await audio.play();
        assert.equal(audio.paused, false);
        audio.pause();
        assert.equal(a.paused, true);
    });

    test('volume es el del usuario; el elemento suena a usuario × ganancia × fundido', () => {
        const { a, b, engine, audio } = montar();
        audio.volume = 0.8;
        assert.equal(audio.volume, 0.8);
        assert.equal(a.volume, 0.8);
        engine.mezclar(a, { ganancia: 0.5 });
        assert.ok(Math.abs(a.volume - 0.4) < 1e-9);
        engine.mezclar(b, { ganancia: 0.5, cruce: 0.5 });
        assert.ok(Math.abs(b.volume - 0.2) < 1e-9);
        audio.volume = 3;
        assert.equal(audio.volume, 1, 'nunca más de 1');
        assert.equal(a.volume, 0.5);
    });

    test('los eventos del otro elemento no llegan', () => {
        const { a, b, audio } = montar();
        const vistos = [];
        audio.addEventListener('timeupdate', (e) => vistos.push(e.target.id));
        a.emitir('timeupdate');
        b.emitir('timeupdate');
        assert.deepEqual(vistos, ['mainAudio']);
    });

    test('al intercambiar, #mainAudio pasa al que suena y se repiten sus eventos', async () => {
        const { a, b, engine, audio } = montar();
        const vistos = [];
        for (const t of ['durationchange', 'loadedmetadata', 'play', 'timeupdate']) audio.addEventListener(t, () => vistos.push(t));
        b.duration = 99;
        await b.play();
        vistos.length = 0;
        engine.intercambiar();
        assert.equal(b.id, 'mainAudio');
        assert.equal(a.id, 'deckAudio');
        assert.equal(engine.actual(), b);
        assert.equal(audio.duration, 99);
        assert.deepEqual(vistos, ['durationchange', 'loadedmetadata', 'play', 'timeupdate']);
        // Y ahora el filtrado va al revés
        vistos.length = 0;
        a.emitir('timeupdate');
        assert.deepEqual(vistos, []);
    });

    test('removeEventListener deja de avisar', () => {
        const { a, audio } = montar();
        let n = 0;
        const fn = () => n++;
        audio.addEventListener('pause', fn);
        a.paused = false; a.pause();
        audio.removeEventListener('pause', fn);
        a.paused = false; a.pause();
        assert.equal(n, 1);
    });

    test('un escuchador que falla no impide a los demás', () => {
        const { a, audio } = montar();
        let llego = false;
        const error = mock.method(console, 'error', () => {});
        audio.addEventListener('timeupdate', () => { throw new Error('x'); });
        audio.addEventListener('timeupdate', () => { llego = true; });
        a.emitir('timeupdate');
        error.mock.restore();
        assert.ok(llego);
    });
});

/** Un reproductor mínimo encima: cola de canciones y lo que haría player.js. */
function reproductor({ fundido = 0, repetirUna = false, cola = ['uno', 'dos', 'tres'] } = {}) {
    const m = montar();
    const estado = { indice: 0, pasadas: [], fundido, repetirUna, ended: 0 };
    const t = createTransiciones({
        engine: m.engine,
        fundido: () => estado.fundido,
        repetirUna: () => estado.repetirUna,
        siguiente: () => (estado.indice + 1 < cola.length ? { src: cola[estado.indice + 1] } : null),
        resolver: async (song) => `blob:${song.src}`,
        ganancia: () => 1,
        alPasar: (song) => { estado.indice = cola.indexOf(song.src); estado.pasadas.push(song.src); },
    });
    m.audio.addEventListener('ended', () => estado.ended++);
    return { ...m, t, estado };
}

async function sonando(r, duracion = 100) {
    r.audio.src = 'blob:uno';
    r.a.duration = duracion;
    await r.audio.play();
}

describe('sin cortes', () => {
    test('precarga a 20 s y, al acabar, la siguiente suena sin pasar por el ended del reproductor', async () => {
        const r = reproductor();
        await sonando(r);
        r.a.ir(79);
        await esperar();
        assert.equal(r.b.src, '', 'aún no toca precargar');
        r.a.ir(80);
        await esperar();
        assert.equal(r.b.src, 'blob:dos');
        assert.equal(r.b.paused, true, 'precargada, no sonando');

        r.b.duration = 50;
        r.a.acabar();
        assert.deepEqual(r.estado.pasadas, ['dos']);
        assert.equal(r.estado.ended, 0, 'el reproductor no ve el ended: no salta otra vez');
        assert.equal(r.b.id, 'mainAudio');
        assert.equal(r.b.paused, false);
        assert.equal(r.b.volume, 1);
        assert.equal(r.a.src, '', 'la que acabó se vacía');
    });

    test('el temporizador la arranca justo antes de acabar', async () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            const r = reproductor();
            await sonando(r);
            r.a.ir(85);
            await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
            r.a.ir(99.7);
            assert.deepEqual(r.estado.pasadas, []);
            mock.timers.tick(300);
            assert.deepEqual(r.estado.pasadas, ['dos']);
            assert.equal(r.engine.actual(), r.b);
        } finally {
            mock.timers.reset();
        }
    });

    test('la última de la cola acaba como siempre: el reproductor ve su ended', async () => {
        const r = reproductor({ cola: ['uno'] });
        await sonando(r);
        r.a.ir(90);
        await esperar();
        r.a.acabar();
        assert.equal(r.estado.ended, 1);
        assert.deepEqual(r.estado.pasadas, []);
    });

    test('con «Repetir una» no se prepara nada', async () => {
        const r = reproductor({ repetirUna: true });
        await sonando(r);
        r.a.ir(95);
        await esperar();
        assert.equal(r.b.src, '');
        r.a.acabar();
        assert.equal(r.estado.ended, 1);
    });

    test('con el elemento en bucle, tampoco', async () => {
        const r = reproductor();
        await sonando(r);
        r.a.loop = true;
        r.a.ir(95);
        await esperar();
        assert.equal(r.b.src, '');
    });
});

test('si la precargada da error, no hay transición: el reproductor ve el ended', async () => {
    const r = reproductor();
    await sonando(r);
    r.a.ir(85);
    await esperar();
    assert.equal(r.b.src, 'blob:dos');
    r.b.emitir('error');
    r.a.acabar();
    assert.deepEqual(r.estado.pasadas, []);
    assert.equal(r.estado.ended, 1);
    assert.equal(r.engine.actual(), r.a);
});

describe('fundido', () => {
    async function cruzando() {
        const r = reproductor({ fundido: 4 });
        await sonando(r, 100);
        r.a.ir(90);
        await esperar();
        r.b.duration = 60;
        return r;
    }

    test('arranca a volumen 0, se cruzan y a mitad la siguiente es la actual', async () => {
        const r = await cruzando();
        r.a.ir(96);
        assert.equal(r.b.paused, false, 'arranca cuando quedan 4 s');
        assert.equal(r.b.volume, 0);
        assert.equal(r.a.volume, 1);
        r.a.ir(97);
        assert.ok(Math.abs(r.a.volume ** 2 + r.b.volume ** 2 - 1) < 1e-9, 'igual potencia');
        assert.deepEqual(r.estado.pasadas, []);
        r.a.ir(98);
        assert.deepEqual(r.estado.pasadas, ['dos'], 'a mitad, una sola vez');
        assert.equal(r.b.id, 'mainAudio');

        // La que sale sigue bajando con sus propios timeupdate
        r.a.ir(99);
        assert.ok(r.a.volume < 0.39 && r.b.volume > 0.92);
        r.a.acabar();
        assert.equal(r.b.volume, 1);
        assert.equal(r.a.src, '');
        assert.deepEqual(r.estado.pasadas, ['dos'], 'el final de la saliente no vuelve a pasar');
        assert.equal(r.estado.ended, 0);
    });

    test('pausar a mitad del cruce lo cancela: la otra se para', async () => {
        const r = await cruzando();
        r.a.ir(96.5);
        assert.equal(r.b.paused, false);
        r.audio.pause();
        assert.equal(r.b.paused, true);
        assert.equal(r.b.src, '');
        assert.equal(r.a.volume, 1, 'la actual recupera su volumen');
    });

    test('mover la barra cancela el cruce', async () => {
        const r = await cruzando();
        r.a.ir(97);
        r.a.emitir('seeking');
        assert.equal(r.b.paused, true);
        assert.deepEqual(r.estado.pasadas, []);
    });

    test('cambiar de canción a mano (olvidar) corta también la cola de la que sale', async () => {
        const r = await cruzando();
        r.a.ir(96); r.a.ir(98);
        assert.equal(r.engine.actual(), r.b);
        assert.equal(r.a.paused, false, 'la saliente aún suena');
        r.t.olvidar();
        assert.equal(r.a.paused, true);
        assert.equal(r.b.volume, 1);
    });

    test('replanificar no corta un cruce que ya suena', async () => {
        const r = await cruzando();
        r.a.ir(96.5);
        r.t.replanificar();
        assert.equal(r.b.paused, false);
    });

    test('replanificar olvida la precargada que aún no suena', async () => {
        const r = reproductor({ fundido: 4 });
        await sonando(r);
        r.a.ir(85);
        await esperar();
        assert.equal(r.b.src, 'blob:dos');
        r.t.replanificar();
        assert.equal(r.b.src, '');
        r.a.ir(86);
        await esperar();
        assert.equal(r.b.src, 'blob:dos', 'se vuelve a pedir la que toque');
    });
});
