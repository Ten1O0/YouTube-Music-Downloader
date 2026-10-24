/**
 * Cuánto trabajo de maquetación y pintado hace la reproducción (plan 19, T8).
 *
 *     node test/perf/pintado.mjs [--dist dist] [--segundos 4]
 *
 * Con una canción sonando y la pantalla completa abierta (y después, con el
 * mini reproductor), graba una traza de Chrome y cuenta los eventos de
 * maquetación (Layout), pintado (Paint) y rasterizado por segundo. Sirve para
 * comparar antes y después de un cambio que no se ve, como mover las barras
 * a su propia capa.
 *
 *     node test/perf/pintado.mjs --escenas
 *
 * Con --escenas mide los movimientos (plan 28, T1): abrir y cerrar el
 * reproductor con el vuelo, arrastrarlo para cerrarlo, pausar y reanudar (la
 * carátula que respira) y abrir y cerrar la hoja de la cola. Por cada uno:
 * pintados, cuántos son de la página entera (#document), ms de rasterizado,
 * recálculos de estilo y ms de script.
 */

import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const DIST = arg('dist', 'dist');
const SEGUNDOS = Number(arg('segundos', 4));
const PUERTO = Number(arg('puerto', 5097));
const BASE = `http://127.0.0.1:${PUERTO}`;

async function servidor() {
    const proc = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PUERTO), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(BASE)).ok) return proc; } catch { /* aún no */ }
        await new Promise((ok) => setTimeout(ok, 250));
    }
    proc.kill();
    throw new Error('vite preview no arrancó');
}

async function sembrar(page) {
    await page.evaluate(async () => {
        const n = 8000 * 30;
        const buf = new ArrayBuffer(44 + n * 2);
        const v = new DataView(buf);
        const txt = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
        txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
        v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 2, true);
        const audio = new Blob([buf], { type: 'audio/wav' });
        const lib = Array.from({ length: 5 }, (_, i) => ({
            src: `idb://pintado${i}`, videoId: `pintado${String(i).padStart(4, '0')}`, title: `Artista - Canción ${i}`,
            channel: 'Artista', artist: 'Artista', track: `Canción ${i}`, thumbnail: 'favicon.png', duration: 30,
            addedAt: new Date().toISOString(),
        }));
        await new Promise((ok, ko) => {
            const r = indexedDB.open('YTMusicDB');
            r.onsuccess = () => {
                const tx = r.result.transaction(['kv_store', 'audio_blobs'], 'readwrite');
                tx.objectStore('kv_store').put(lib, 'ytdl_library');
                lib.forEach((s) => tx.objectStore('audio_blobs').put(audio, s.src.slice(6)));
                tx.oncomplete = ok; tx.onerror = () => ko(tx.error);
            };
        });
    });
}

async function contar(page, cdp, segundos) {
    const eventos = [];
    cdp.on('Tracing.dataCollected', (d) => eventos.push(...d.value));
    const fin = new Promise((ok) => cdp.once('Tracing.tracingComplete', ok));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
    await page.waitForTimeout(segundos * 1000);
    await cdp.send('Tracing.end');
    await fin;
    if (process.argv.includes('--detalle')) {
        // Qué elementos se pintan: el nodo de cada evento Paint, descrito
        const porNodo = new Map();
        for (const e of eventos) {
            const id = e.name === 'Paint' ? e.args?.data?.nodeId : null;
            if (id) porNodo.set(id, (porNodo.get(id) ?? 0) + 1);
        }
        // El área que repinta cada evento (del documento): ¿la franja o toda la pantalla?
        const areas = eventos.filter((e) => e.name === 'Paint' && e.args?.data?.clip).map((e) => {
            const q = e.args.data.clip; // [x1,y1,x2,y2,x3,y3,x4,y4]
            const w = Math.abs(q[2] - q[0]); const h = Math.abs(q[5] - q[1]);
            return `${Math.round(w)}x${Math.round(h)}`;
        });
        const cuentaAreas = new Map();
        areas.forEach((a) => cuentaAreas.set(a, (cuentaAreas.get(a) ?? 0) + 1));
        console.log('    áreas:', JSON.stringify([...cuentaAreas].sort((x, y) => y[1] - x[1]).slice(0, 6)));
        const top = [...porNodo].sort((x, y) => y[1] - x[1]).slice(0, 8);
        for (const [backendNodeId, n] of top) {
            let desc = `#${backendNodeId}`;
            try {
                const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
                const r = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
                    functionDeclaration: 'function () { const e = this.nodeType === 1 ? this : this.parentElement; return e ? e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\\s+/).join(".") : "") : String(this.nodeName); }' });
                desc = r.result.value;
            } catch { /* nodo ya no existe */ }
            console.log(`    pinta ${n}× ${desc}`);
        }
    }
    const cuenta = (nombre) => eventos.filter((e) => e.name === nombre && e.ph !== 'E').length;
    const dur = (nombre) => eventos.filter((e) => e.name === nombre && e.dur).reduce((s, e) => s + e.dur, 0) / 1000;
    return {
        layoutPorSegundo: +(cuenta('Layout') / segundos).toFixed(1),
        paintPorSegundo: +(cuenta('Paint') / segundos).toFixed(1),
        msPintando: +(dur('Paint') + dur('PaintImage')).toFixed(1),
        msMaquetando: +dur('Layout').toFixed(1),
        // Recalcular estilos: lo que cuesta cambiar clases o textos aunque no se pinte
        estilosPorSegundo: +(cuenta('UpdateLayoutTree') / segundos).toFixed(1),
        msEstilos: +dur('UpdateLayoutTree').toFixed(1),
    };
}

/** Qué elemento es un nodo de la traza: «#document», «div#playerBar.player-bar»… */
async function describir(cdp, backendNodeId) {
    try {
        const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
        const r = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
            functionDeclaration: 'function () { if (this.nodeType === 9) return "#document"; const e = this.nodeType === 1 ? this : this.parentElement; return e ? e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") : String(this.nodeName); }' });
        return r.result.value;
    } catch { return '(ya no existe)'; }
}

/** Traza lo que cuesta `accion`, desde que empieza hasta `ms` después. */
async function trazarEscena(page, cdp, accion, ms) {
    const eventos = [];
    const recoger = (d) => eventos.push(...d.value);
    cdp.on('Tracing.dataCollected', recoger);
    const fin = new Promise((ok) => cdp.once('Tracing.tracingComplete', ok));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
    await page.waitForTimeout(100);
    await accion();
    await page.waitForTimeout(ms);
    await cdp.send('Tracing.end');
    await fin;
    cdp.off('Tracing.dataCollected', recoger);
    const dur = (n) => eventos.filter((e) => e.name === n && e.dur).reduce((t, e) => t + e.dur, 0) / 1000;
    const pintados = eventos.filter((e) => e.name === 'Paint' && e.args?.data);
    const porNodo = new Map();
    for (const e of pintados) porNodo.set(e.args.data.nodeId, (porNodo.get(e.args.data.nodeId) ?? 0) + 1);
    let pagina = 0;
    for (const [id, n] of porNodo) if (await describir(cdp, id) === '#document') pagina += n;
    return {
        pintados: pintados.length,
        pagina,
        msRaster: +dur('RasterTask').toFixed(1),
        estilos: eventos.filter((e) => e.name === 'UpdateLayoutTree' && e.ph !== 'E').length,
        msScript: +(dur('FunctionCall') + dur('EventDispatch') + dur('FireAnimationFrame')).toFixed(1),
    };
}

/** Las escenas del plan 28, con el reproductor sonando y el mini reproductor a la vista. */
async function escenas(page, cdp, ancho) {
    const r = {};
    const arrastrar = async (pasos, dy, pausa) => {
        await page.mouse.move(ancho / 2, 300);
        await page.mouse.down();
        for (let i = 1; i <= pasos; i++) { await page.mouse.move(ancho / 2, 300 + i * dy); if (pausa) await page.waitForTimeout(pausa); }
        await page.mouse.up();
    };
    r.abrir = await trazarEscena(page, cdp, () => page.locator('#playerInfo').click(), 900);
    await page.waitForTimeout(600);
    r.cerrar = await trazarEscena(page, cdp, () => page.keyboard.press('Escape'), 900);
    await page.waitForTimeout(600);
    await page.locator('#playerInfo').click();
    await page.waitForTimeout(1500);
    r.arrastrarYVolver = await trazarEscena(page, cdp, () => arrastrar(6, 10, 40), 900);
    r.arrastrarYCerrar = await trazarEscena(page, cdp, () => arrastrar(12, 30, 0), 900);
    await page.waitForTimeout(600);
    await page.locator('#playerInfo').click();
    await page.waitForTimeout(1500);
    r.pausar = await trazarEscena(page, cdp, () => page.locator('#fullPlayerPlay').click(), 900);
    r.reanudar = await trazarEscena(page, cdp, () => page.locator('#fullPlayerPlay').click(), 900);
    r.abrirHoja = await trazarEscena(page, cdp, () => page.locator('#fullPlayerQueue').click(), 900);
    r.cerrarHoja = await trazarEscena(page, cdp, () => page.keyboard.press('Escape'), 900);
    return r;
}

const proc = await servidor();
const browser = await chromium.launch();
try {
    for (const [nombre, uso] of [['movil', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
        ['escritorio', { viewport: { width: 1280, height: 800 } }]]) {
        const ctx = await browser.newContext(uso);
        await ctx.route(/\/api\//, (r) => r.fulfill({ status: 503, body: '{}', contentType: 'application/json' }));
        // Letra sincronizada, una línea cada 2 s (la canción dura 30)
        const lrc = Array.from({ length: 15 }, (_, i) => `[00:${String(i * 2).padStart(2, '0')}.00] Línea ${i + 1} de la letra`).join('\n');
        // Con título, artista y duración: sin ellos, la app la descarta (plan 22)
        const letraFalsa = [{ trackName: 'Canción', artistName: 'Artista', duration: 30, syncedLyrics: lrc }];
        await ctx.route(/lrclib\.net/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(letraFalsa) }));
        const page = await ctx.newPage();
        await page.goto(BASE);
        await page.waitForFunction(() => /\d/.test(document.getElementById('libraryCount')?.textContent ?? ''), null, { timeout: 30_000 });
        await sembrar(page);
        await page.reload();
        await page.waitForFunction(() => /5/.test(document.getElementById('libraryCount')?.textContent ?? ''), null, { timeout: 30_000 });
        await page.locator('.nav-btn[data-view="libraryView"]:visible').first().click();
        await page.waitForTimeout(800);
        await page.locator('#libraryList .library-item .library-item-info').first().click();
        await page.waitForTimeout(1500);
        const cdp = await ctx.newCDPSession(page);
        if (process.argv.includes('--escenas')) {
            await cdp.send('DOM.getDocument');
            for (const [escena, cifras] of Object.entries(await escenas(page, cdp, uso.viewport.width))) {
                console.log(`${nombre} · ${escena}: ${JSON.stringify(cifras)}`);
            }
            await ctx.close();
            continue;
        }
        const mini = await contar(page, cdp, SEGUNDOS);
        await page.locator('#playerInfo').click();
        await page.waitForTimeout(1500);
        const completa = await contar(page, cdp, SEGUNDOS);
        await page.locator('#lyricsToggle').click();
        await page.waitForTimeout(1500);
        const letra = await contar(page, cdp, SEGUNDOS);
        console.log(`${nombre} · mini reproductor: ${JSON.stringify(mini)}`);
        console.log(`${nombre} · pantalla completa: ${JSON.stringify(completa)}`);
        console.log(`${nombre} · con la letra: ${JSON.stringify(letra)}`);
        await ctx.close();
    }
} finally {
    await browser.close();
    proc.kill();
}
