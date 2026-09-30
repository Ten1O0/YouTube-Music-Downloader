/**
 * Presupuesto de rendimiento (plan 19, T16): los objetivos de §2.3 como test.
 *
 *     npm run test:perf
 *
 * La web compilada, 300 canciones, viewport de móvil y la CPU frenada 4×: si
 * una función nueva hace que un gesto se pase de su objetivo, falla. Los seis
 * gestos se miden como en test/perf/medir.mjs (T0), sin servidor de la app:
 * las llamadas a /api fallan y la app funciona sin conexión.
 *
 * Mide tiempos de verdad: con la máquina ocupada (la E2E a la vez, una
 * compilación) puede fallar sin motivo. Se pasa en reposo.
 */

import { test, expect } from '@playwright/test';

const CANCIONES = 300;
const CPU = 4;
const REPETICIONES = 3;

/** Objetivos de §2.3 del plan 19 (Chrome, CPU 4×, 300 canciones). */
const OBJETIVO = {
    arrancarMs: 1000,
    abrirBibliotecaMs: 150,
    corazonMs: 100,
    scrollTareasLargas: 0,
    pantallaCompletaPerdidos: 0.05,
    cambiarCancionMs: 150,
};

const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Deja escrito lo medido frente a su objetivo, pase o no: el margen importa. */
function apuntar(gesto, valor, objetivo, unidad = 'ms') {
    const texto = `${gesto}: ${Math.round(valor * 100) / 100} ${unidad} (objetivo < ${objetivo} ${unidad})`;
    console.log(`  presupuesto · ${texto}`);
    test.info().annotations.push({ type: 'medida', description: texto });
}

/**
 * Desde el primer instante de cada carga: las tareas largas y el fotograma en
 * que la biblioteca sale contada. Se apunta aquí dentro y no esperando a
 * page.reload(), que aguarda al evento load: ese depende de lo que tarden
 * terceros (el reproductor de YouTube, el botón de Google) y no de la app.
 */
const SONDA = (canciones) => {
    globalThis.__lt = [];
    try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) globalThis.__lt.push({ t: e.startTime, d: e.duration }); })
            .observe({ type: 'longtask', buffered: true });
    } catch { /* sin longtask */ }
    globalThis.__contada = null;
    const mirar = () => {
        if (new RegExp(`\\b${canciones}\\b`).test(document.getElementById('libraryCount')?.textContent ?? '')) {
            requestAnimationFrame(() => { globalThis.__contada = performance.now(); });
        } else {
            requestAnimationFrame(mirar);
        }
    };
    requestAnimationFrame(mirar);
};

/**
 * Espera a que se cumpla `cond` (texto de una función) y devuelve cuánto tardó
 * en pintarse desde t0: el fotograma siguiente a verlo en el DOM.
 */
const HASTA_QUE = `(t0, cond) => new Promise((ok) => {
    const f = new Function('return (' + cond + ')()');
    const tic = () => (f() ? requestAnimationFrame(() => ok(performance.now() - t0)) : requestAnimationFrame(tic));
    tic();
})`;

/** Biblioteca sintética: 1 s de audio real por canción, miniaturas por enlace. */
async function sembrar(page, n) {
    await page.evaluate(async (n) => {
        const muestras = 8000;
        const buf = new ArrayBuffer(44 + muestras * 2);
        const v = new DataView(buf);
        const txt = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
        txt(0, 'RIFF'); v.setUint32(4, 36 + muestras * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
        v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, muestras * 2, true);
        const audio = new Blob([buf], { type: 'audio/wav' });

        const id = (i) => `perf${String(i).padStart(7, '0')}`;
        const lib = Array.from({ length: n }, (_, i) => ({
            src: `idb://${id(i)}`, videoId: id(i),
            title: `Artista ${i % 40} - Canción de prueba número ${i}`, channel: `Artista ${i % 40}`,
            artist: `Artista ${i % 40}`, track: `Canción de prueba número ${i}`,
            thumbnail: `https://i.ytimg.com/vi/${id(i)}/mqdefault.jpg`,
            duration: 200, addedAt: new Date(Date.now() - i * 60_000).toISOString(),
        }));
        const listas = Array.from({ length: 6 }, (_, j) => ({
            id: `17000000000${j}`, name: `Lista ${j}`, description: '', createdAt: new Date().toISOString(),
            songs: lib.slice(j * 20, j * 20 + 20).map((s) => ({ ...s })),
        }));
        await new Promise((ok, ko) => {
            const req = indexedDB.open('YTMusicDB');
            req.onsuccess = () => {
                const tx = req.result.transaction(['kv_store', 'audio_blobs'], 'readwrite');
                tx.objectStore('kv_store').put(lib, 'ytdl_library');
                tx.objectStore('kv_store').put(listas, 'ytdl_playlists');
                lib.forEach((s) => tx.objectStore('audio_blobs').put(audio, s.src.slice(6)));
                tx.oncomplete = ok; tx.onerror = () => ko(tx.error);
            };
            req.onerror = () => ko(req.error);
        });
    }, n);
}

test.describe.configure({ mode: 'serial' });

let contexto;
let page;

test.beforeAll(async ({ browser }) => {
    contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: 'es-ES' });
    await contexto.addInitScript(SONDA, CANCIONES);
    // Nada de fuera, como sin conexión: la medida no depende de la red ni de
    // terceros. Las miniaturas, una imagen servida aquí; el servidor de la app, caído
    page = await contexto.newPage();
    const jpeg = Buffer.from((await page.evaluate(() => {
        const c = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
        c.getContext('2d').fillRect(0, 0, 320, 180);
        return c.toDataURL('image/jpeg', 0.8);
    })).split(',')[1], 'base64');
    const base = new URL(test.info().project.use.baseURL).origin;
    await contexto.route(() => true, (ruta) => {
        const url = ruta.request().url();
        if (url.startsWith('https://i.ytimg.com/')) return ruta.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg });
        if (!url.startsWith(base)) return ruta.abort();
        if (/\/api\//.test(url)) return ruta.fulfill({ status: 503, body: '{}', contentType: 'application/json' });
        return ruta.continue();
    });
    await page.goto('/');
    await page.waitForFunction(() => /\d/.test(document.getElementById('libraryCount')?.textContent ?? ''), null, { timeout: 30_000 });
    await sembrar(page, CANCIONES);
    const cdp = await contexto.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
});

test.afterAll(async () => {
    await contexto?.close();
});

test(`arrancar: la biblioteca contada en menos de ${OBJETIVO.arrancarMs} ms`, async () => {
    const tiempos = [];
    for (let i = 0; i < REPETICIONES; i++) {
        await page.reload({ waitUntil: 'commit' });
        await page.waitForFunction(() => globalThis.__contada != null, null, { timeout: 30_000 });
        tiempos.push(await page.evaluate(() => globalThis.__contada));
        await page.waitForTimeout(1500);
    }
    apuntar('arrancar', mediana(tiempos), OBJETIVO.arrancarMs);
    expect(mediana(tiempos), `arranques: ${tiempos.map(Math.round).join(', ')} ms`).toBeLessThan(OBJETIVO.arrancarMs);
});

test(`abrir la biblioteca: filas pintadas en menos de ${OBJETIVO.abrirBibliotecaMs} ms`, async () => {
    const tiempos = [];
    for (let i = 0; i < REPETICIONES; i++) {
        await page.evaluate(() => [...document.querySelectorAll('.nav-btn[data-view="homeView"]')].find((b) => b.offsetParent)?.click());
        await page.waitForTimeout(800);
        tiempos.push(await page.evaluate(`(() => { const t0 = performance.now();
            [...document.querySelectorAll('.nav-btn[data-view="libraryView"]')].find((b) => b.offsetParent)?.click();
            return (${HASTA_QUE})(t0, "() => !document.getElementById('libraryView').classList.contains('hidden') && document.querySelectorAll('#libraryList .library-item').length > 0"); })()`));
        await page.waitForTimeout(800);
    }
    apuntar('abrir la biblioteca', mediana(tiempos), OBJETIVO.abrirBibliotecaMs);
    expect(mediana(tiempos), `aperturas: ${tiempos.map(Math.round).join(', ')} ms`).toBeLessThan(OBJETIVO.abrirBibliotecaMs);
});

test(`tocar un corazón: marcado en menos de ${OBJETIVO.corazonMs} ms`, async () => {
    const tiempos = [];
    for (let i = 0; i < REPETICIONES; i++) {
        tiempos.push(await page.evaluate(`(() => { const b = document.querySelectorAll('#libraryList .lib-fav-btn')[${i}];
            const antes = b.classList.contains('active'); const t0 = performance.now(); b.click();
            return (${HASTA_QUE})(t0, "() => document.querySelectorAll('#libraryList .lib-fav-btn')[${i}].classList.contains('active') !== " + antes); })()`));
        await page.waitForTimeout(600);
    }
    apuntar('corazón', mediana(tiempos), OBJETIVO.corazonMs);
    expect(mediana(tiempos), `corazones: ${tiempos.map(Math.round).join(', ')} ms`).toBeLessThan(OBJETIVO.corazonMs);
});

test('scroll de la biblioteca: 3 s sin tareas de más de 50 ms', async () => {
    const { t0, t1 } = await page.evaluate(() => new Promise((ok) => {
        const el = document.querySelector('.main-content');
        const inicio = performance.now();
        const paso = (t) => {
            el.scrollTop += 14;
            if (t - inicio < 3000) requestAnimationFrame(paso); else ok({ t0: inicio, t1: t });
        };
        requestAnimationFrame(paso);
    }));
    const largas = await page.evaluate(([a, b]) => (globalThis.__lt ?? []).filter((x) => x.t >= a && x.t <= b).map((x) => Math.round(x.d)), [t0, t1]);
    apuntar('scroll, tareas largas', largas.length, OBJETIVO.scrollTareasLargas + 1, 'tareas');
    expect(largas.length, `tareas largas durante el scroll: ${largas.join(', ')} ms`).toBeLessThanOrEqual(OBJETIVO.scrollTareasLargas);
    await page.evaluate(() => { document.querySelector('.main-content').scrollTop = 0; });
    await page.waitForTimeout(500);
});

test(`abrir la pantalla completa: menos del ${OBJETIVO.pantallaCompletaPerdidos * 100} % de fotogramas perdidos`, async () => {
    await page.evaluate(() => document.querySelector('#libraryList .library-item .library-item-info')?.click());
    await page.waitForFunction(() => !document.getElementById('playerBar')?.classList.contains('hidden'), null, { timeout: 15_000 });
    await page.waitForTimeout(1200);
    const vuelos = [];
    for (let i = 0; i < REPETICIONES; i++) {
        vuelos.push(await page.evaluate(() => new Promise((ok) => {
            let ultimo = performance.now(); const t0 = ultimo; let perdidos = 0; let marcos = 0;
            document.getElementById('playerInfo').click();
            const paso = (t) => {
                marcos++;
                perdidos += Math.max(0, Math.round((t - ultimo) / 16.7) - 1);
                ultimo = t;
                if (t - t0 < 700) requestAnimationFrame(paso); else ok(perdidos / (marcos + perdidos));
            };
            requestAnimationFrame(paso);
        })));
        await page.waitForTimeout(600);
        await page.evaluate(() => document.getElementById('fullPlayerClose')?.click());
        await page.waitForTimeout(900);
    }
    apuntar('pantalla completa, perdidos', mediana(vuelos) * 100, OBJETIVO.pantallaCompletaPerdidos * 100, '%');
    expect(mediana(vuelos), `perdidos: ${vuelos.map((x) => `${Math.round(x * 100)} %`).join(', ')}`).toBeLessThan(OBJETIVO.pantallaCompletaPerdidos);
});

test(`cambiar de canción: título nuevo en menos de ${OBJETIVO.cambiarCancionMs} ms`, async () => {
    const tiempos = [];
    for (let i = 0; i < REPETICIONES; i++) {
        tiempos.push(await page.evaluate(`(() => { const antes = document.getElementById('playerTitle').textContent; const t0 = performance.now();
            document.getElementById('playerNext').click();
            return (${HASTA_QUE})(t0, "() => document.getElementById('playerTitle').textContent !== " + JSON.stringify(antes)); })()`));
        await page.waitForTimeout(700);
    }
    apuntar('cambiar de canción', mediana(tiempos), OBJETIVO.cambiarCancionMs);
    expect(mediana(tiempos), `cambios: ${tiempos.map(Math.round).join(', ')} ms`).toBeLessThan(OBJETIVO.cambiarCancionMs);
});
