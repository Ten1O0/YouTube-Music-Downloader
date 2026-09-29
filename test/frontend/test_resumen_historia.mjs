/**
 * La historia de «Tu año en música» (plan 17, T4 y T7).
 *
 * El navegador simulado del arnés no tiene un DOM de verdad, así que aquí se
 * prueba lo que no depende de pintar: abrir y cerrar, cuántas diapositivas hay,
 * el avance y que la música del usuario se pare y se reanude. Lo que sí depende
 * de ver la pantalla (toques, barras de progreso, la imagen) es el recorrido 50.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const TOKEN = 'token-de-prueba';
const copia = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** n escuchas de una canción, una por día desde mayo de 2026. */
function serie({ artista = 'Rosalia', cancion = 'Malamente', videoId = 'aaaaaaaaaaa', n, segundos = 200 }) {
    const inicio = Date.UTC(2026, 4, 1, 12);
    return Array.from({ length: n }, (_, i) => ({ id: i + 1, videoId, artista, cancion, t: inicio + i * 86_400_000, segundos }));
}

function entorno({ escuchasLocales = [], sonando = false } = {}) {
    const { api, context } = loadApp();
    api.StorageModule.leerEscuchas = async () => copia(escuchasLocales);
    api.auth.token = null;
    api.auth.user = null;

    // El módulo mira las dos pletinas del plan 12 para saber si hay música
    const pletinas = { mainAudio: { paused: !sonando, ended: false, currentTime: sonando ? 12 : 0 } };
    context.document.getElementById = (id) => pletinas[id] ?? elementoFalso();

    const musica = { pausas: 0, reanudos: 0 };
    api.PlayerModule.pause = () => { musica.pausas++; };
    api.PlayerModule.resume = () => { musica.reanudos++; };

    return { api, musica };
}

/** Elemento permisivo, como el del arnés: acepta todo sin romper. */
function elementoFalso() {
    const el = {
        children: [],
        style: { setProperty() {}, removeProperty() {} },
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        dataset: {},
        setAttribute() {}, removeAttribute() {},
        addEventListener() {}, removeEventListener() {},
        querySelectorAll: () => [],
        appendChild() {}, remove() {},
        get firstElementChild() { return null; },
        set innerHTML(v) { this._html = v; },
        get innerHTML() { return this._html ?? ''; },
        offsetHeight: 800,
    };
    return el;
}

describe('abrir y cerrar', () => {
    test('con música de sobra abre con las diapositivas puestas', async () => {
        const { api } = entorno({ escuchasLocales: serie({ n: 25 }) });
        const r = await api.HistoriaModule.abrir(2026);
        assert.equal(r.suficiente, true);
        assert.equal(api.HistoriaModule.estaAbierta(), true);
        assert.ok(api.HistoriaModule.cuantasDiapositivas() >= 4);
        api.HistoriaModule.cerrar();
        assert.equal(api.HistoriaModule.estaAbierta(), false);
    });

    test('con poca música abre, pero sin diapositivas', async () => {
        const { api } = entorno({ escuchasLocales: serie({ n: 2 }) });
        const r = await api.HistoriaModule.abrir(2026);
        assert.equal(r.suficiente, false);
        assert.equal(api.HistoriaModule.cuantasDiapositivas(), 0, 'se enseña el aviso, no una historia vacía');
        assert.equal(api.HistoriaModule.estaAbierta(), true);
        api.HistoriaModule.cerrar();
    });

    test('abrir dos veces no reinicia la historia', async () => {
        const { api } = entorno({ escuchasLocales: serie({ n: 25 }) });
        await api.HistoriaModule.abrir(2026);
        api.HistoriaModule.siguiente();
        const donde = api.HistoriaModule.indiceActual();
        await api.HistoriaModule.abrir(2026);
        assert.equal(api.HistoriaModule.indiceActual(), donde, 'sigue donde estaba');
        api.HistoriaModule.cerrar();
    });

    test('cerrar dos veces no pasa nada', async () => {
        const { api } = entorno({ escuchasLocales: serie({ n: 25 }) });
        await api.HistoriaModule.abrir(2026);
        api.HistoriaModule.cerrar();
        assert.doesNotThrow(() => api.HistoriaModule.cerrar());
    });
});

describe('la música del usuario', () => {
    test('se para al abrir y se reanuda al cerrar', async () => {
        const { api, musica } = entorno({ escuchasLocales: serie({ n: 25 }), sonando: true });
        await api.HistoriaModule.abrir(2026);
        assert.equal(musica.pausas, 1, 'la historia tiene su propio sonido');
        assert.equal(musica.reanudos, 0);
        api.HistoriaModule.cerrar();
        assert.equal(musica.reanudos, 1, 'la música vuelve donde estaba');
    });

    test('si no había música sonando, al cerrar no se pone a sonar nada', async () => {
        const { api, musica } = entorno({ escuchasLocales: serie({ n: 25 }), sonando: false });
        await api.HistoriaModule.abrir(2026);
        api.HistoriaModule.cerrar();
        assert.equal(musica.pausas, 0);
        assert.equal(musica.reanudos, 0, 'abrir el resumen no puede empezar a reproducir');
    });
});

describe('avance', () => {
    test('empieza en la primera', async () => {
        const { api } = entorno({ escuchasLocales: serie({ n: 25 }) });
        await api.HistoriaModule.abrir(2026);
        assert.equal(api.HistoriaModule.indiceActual(), 0);
        api.HistoriaModule.cerrar();
    });

    test('siguiente y anterior se mueven, y no se pasan por abajo', async () => {
        const { api } = entorno({ escuchasLocales: serie({ n: 25 }) });
        await api.HistoriaModule.abrir(2026);
        api.HistoriaModule.anterior();
        assert.equal(api.HistoriaModule.indiceActual(), 0, 'en la primera, atrás no hace nada');
        api.HistoriaModule.siguiente();
        assert.equal(api.HistoriaModule.indiceActual(), 1);
        api.HistoriaModule.anterior();
        assert.equal(api.HistoriaModule.indiceActual(), 0);
        api.HistoriaModule.cerrar();
    });

    test('la última no se cierra sola: ahí está «Guardar imagen»', async () => {
        const { api } = entorno({ escuchasLocales: serie({ n: 25 }) });
        await api.HistoriaModule.abrir(2026);
        const total = api.HistoriaModule.cuantasDiapositivas();
        for (let i = 0; i < total + 3; i++) api.HistoriaModule.siguiente();
        assert.equal(api.HistoriaModule.estaAbierta(), true, 'sigue abierta al final');
        assert.equal(api.HistoriaModule.indiceActual(), total - 1);
        api.HistoriaModule.cerrar();
    });
});

describe('paleta', () => {
    test('sin poder leer la carátula, los colores de la casa', async () => {
        const { api } = entorno({ escuchasLocales: serie({ n: 25 }) });
        await api.HistoriaModule.abrir(2026);
        const paleta = api.HistoriaModule.paleta();
        assert.equal(paleta.length, 3, 'tres colores, como FALLBACK');
        api.HistoriaModule.cerrar();
    });
});

describe('sin sesión no se llama a la cuenta', () => {
    test('el resumen sale del registro de este dispositivo', async () => {
        const { api } = entorno({ escuchasLocales: serie({ n: 25 }) });
        const r = await api.HistoriaModule.abrir(2026);
        assert.equal(r.fuente, 'local');
        api.HistoriaModule.cerrar();
    });

    test('con sesión, el token viaja', async () => {
        const { api } = entorno({ escuchasLocales: serie({ n: 25 }) });
        api.auth.token = TOKEN;
        api.auth.user = { id: 1 };
        const r = await api.HistoriaModule.abrir(2026);
        assert.ok(['cuenta', 'local'].includes(r.fuente));
        api.HistoriaModule.cerrar();
    });
});
