/**
 * Línea base de rendimiento (plan 19, T0).
 *
 *     node test/perf/medir.mjs [--canciones 300] [--cpu 4,6] [--repeticiones 3]
 *
 * Levanta la web compilada (dist/) con `vite preview` en su propio puerto (no
 * el de los recorridos E2E), carga una biblioteca sintética y mide los seis
 * gestos del plan con la CPU frenada, en dos variantes: miniaturas incrustadas
 * en la canción (como guarda hoy la APK) y por enlace (como en la web).
 *
 * Todo sucede en el navegador de Playwright, sin servidor de la app: las
 * llamadas a /api fallan y la app sigue funcionando sin conexión, como en el
 * móvil con la red cortada. Las miniaturas por enlace se sirven desde aquí.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const arg = (nombre, defecto) => {
    const i = process.argv.indexOf(`--${nombre}`);
    return i > 0 ? process.argv[i + 1] : defecto;
};
const CANCIONES = Number(arg('canciones', 300));
const CPUS = arg('cpu', '4,6').split(',').map(Number);
const REPETICIONES = Number(arg('repeticiones', 3));
const PUERTO = 5098;
const BASE = `http://127.0.0.1:${PUERTO}`;

const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const r = (x) => Math.round(x);

async function servidor() {
    if (!existsSync('dist/index.html')) throw new Error('Falta dist/: npm run build');
    const proc = spawn('npx', ['vite', 'preview', '--port', String(PUERTO), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(BASE)).ok) return proc; } catch { /* aún no */ }
        await new Promise((ok) => setTimeout(ok, 250));
    }
    proc.kill();
    throw new Error('vite preview no arrancó');
}

/** Tareas largas y marcas, desde el primer instante de cada carga. */
const SONDA = () => {
    globalThis.__lt = [];
    try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) globalThis.__lt.push({ t: e.startTime, d: e.duration }); })
            .observe({ type: 'longtask', buffered: true });
    } catch { /* sin longtask */ }
};

/** Biblioteca sintética: audio real (1 s de WAV), miniaturas de ~25 KB. */
async function sembrar(page, n, incrustadas) {
    await page.evaluate(async ({ n, incrustadas }) => {
        // Una miniatura con ruido, del tamaño de las reales
        const lienzo = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
        const ctx = lienzo.getContext('2d');
        const img = ctx.createImageData(320, 180);
        for (let i = 0; i < img.data.length; i += 4) {
            const p = i / 4; const x = p % 320; const y = Math.floor(p / 320); const ruido = Math.random() * 60;
            img.data[i] = (x * 0.7 + ruido) % 255; img.data[i + 1] = (y * 1.3 + ruido) % 255; img.data[i + 2] = (x + y + ruido) % 255; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const miniatura = lienzo.toDataURL('image/jpeg', 0.75);
        globalThis.__kbMiniatura = Math.round(miniatura.length / 1024);
        // 1 s de silencio en WAV
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
            thumbnail: incrustadas ? miniatura : `https://i.ytimg.com/vi/${id(i)}/mqdefault.jpg`,
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
    }, { n, incrustadas });
}

/** Tareas largas entre dos instantes de la página: número y tiempo bloqueado (>50 ms). */
const bloqueo = (page, desde, hasta) => page.evaluate(([a, b]) => {
    const t = (globalThis.__lt ?? []).filter((x) => x.t >= a && x.t <= b);
    return { largas: t.length, bloqueado: t.reduce((s, x) => s + Math.max(0, x.d - 50), 0) };
}, [desde, hasta]);

/**
 * Espera en la página a que se cumpla `cond` (texto de una función) y devuelve
 * { visto, t0 }: cuánto tardó en pintarse el cambio desde t0.
 */
const HASTA_QUE = `(t0, cond) => new Promise((ok) => {
    const f = new Function('return (' + cond + ')()');
    const tic = () => (f() ? requestAnimationFrame(() => ok({ visto: performance.now() - t0, t0 })) : requestAnimationFrame(tic));
    tic();
})`;

/** Tras un gesto: lo que tardó en verse y el tiempo bloqueado (tareas >50 ms) en los 1,5 s siguientes. */
async function gesto(page, codigo) {
    const { visto, t0 } = await page.evaluate(codigo);
    await page.waitForTimeout(1500);
    const { bloqueado } = await bloqueo(page, t0, t0 + 1500);
    return { visto, libre: bloqueado };
}

async function medirVariante(browser, { cpu, incrustadas }) {
    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await contexto.addInitScript(SONDA);
    // Las miniaturas por enlace, servidas aquí: la medida no depende de la red
    let jpeg = null;
    await contexto.route('https://i.ytimg.com/**', (ruta) => (jpeg
        ? ruta.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg })
        : ruta.fulfill({ status: 404 })));
    await contexto.route(/\/api\//, (ruta) => ruta.fulfill({ status: 503, body: '{}', contentType: 'application/json' }));
    const page = await contexto.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => /\d/.test(document.getElementById('libraryCount')?.textContent ?? ''), null, { timeout: 30_000 });
    jpeg = Buffer.from((await page.evaluate(() => {
        const c = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
        c.getContext('2d').fillRect(0, 0, 320, 180);
        return c.toDataURL('image/jpeg', 0.8);
    })).split(',')[1], 'base64');
    await sembrar(page, CANCIONES, incrustadas);
    const kbMiniatura = await page.evaluate(() => globalThis.__kbMiniatura);

    const cdp = await contexto.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

    // 1. Arrancar: hasta la biblioteca contada y el hilo libre
    await page.reload();
    const arranque = await page.evaluate(`(${HASTA_QUE})(0, "() => /${CANCIONES}/.test(document.getElementById('libraryCount')?.textContent ?? '')")`);
    await page.waitForTimeout(1500);
    const bArranque = await bloqueo(page, 0, arranque.visto + 1500);

    // 2. Abrir la biblioteca: del toque a las filas pintadas
    const abrir = await gesto(page, `(() => { const t0 = performance.now();
        document.querySelector('.nav-btn[data-view="libraryView"]:not([hidden])')?.click();
        [...document.querySelectorAll('.nav-btn[data-view="libraryView"]')].find((b) => b.offsetParent)?.click();
        return (${HASTA_QUE})(t0, "() => !document.getElementById('libraryView').classList.contains('hidden') && document.querySelectorAll('#libraryList .library-item').length > 0"); })()`);
    await page.waitForTimeout(800);

    // 3. Tocar un corazón: del toque al corazón marcado (varias veces, mediana)
    const corazones = [];
    for (let i = 0; i < REPETICIONES; i++) {
        corazones.push(await gesto(page, `(() => { const b = document.querySelectorAll('#libraryList .lib-fav-btn')[${i}];
            const antes = b.classList.contains('active'); const t0 = performance.now(); b.click();
            return (${HASTA_QUE})(t0, "() => document.querySelectorAll('#libraryList .lib-fav-btn')[${i}].classList.contains('active') !== " + antes); })()`));
        await page.waitForTimeout(600);
    }

    // 4. Scroll: 3 s moviendo la lista; tareas largas y fotogramas perdidos
    const scroll = await page.evaluate(() => new Promise((ok) => {
        const el = document.querySelector('.main-content');
        const t0 = performance.now();
        let ultimo = t0; let perdidos = 0; let marcos = 0;
        const paso = (t) => {
            marcos++;
            perdidos += Math.max(0, Math.round((t - ultimo) / 16.7) - 1);
            ultimo = t;
            el.scrollTop += 14;
            if (t - t0 < 3000) requestAnimationFrame(paso);
            else ok({ t0, t1: t, perdidos, marcos });
        };
        requestAnimationFrame(paso);
    }));
    const bScroll = await bloqueo(page, scroll.t0, scroll.t1);
    await page.evaluate(() => { document.querySelector('.main-content').scrollTop = 0; });
    await page.waitForTimeout(500);

    // 5. Pantalla completa: se pone una canción y se abre; fotogramas perdidos en el vuelo
    await page.evaluate(() => document.querySelector('#libraryList .library-item .library-item-info')?.click());
    await page.waitForFunction(() => !document.getElementById('playerBar')?.classList.contains('hidden'), null, { timeout: 15_000 });
    await page.waitForTimeout(1200);
    const vuelo = await page.evaluate(() => new Promise((ok) => {
        let ultimo = performance.now(); const t0 = ultimo; let perdidos = 0; let marcos = 0;
        document.getElementById('playerInfo').click();
        const paso = (t) => {
            marcos++;
            perdidos += Math.max(0, Math.round((t - ultimo) / 16.7) - 1);
            ultimo = t;
            if (t - t0 < 700) requestAnimationFrame(paso); else ok({ perdidos, marcos });
        };
        requestAnimationFrame(paso);
    }));
    await page.waitForTimeout(600);
    await page.evaluate(() => document.getElementById('fullPlayerClose')?.click());
    await page.waitForTimeout(900);

    // 6. Cambiar de canción: del toque a la carátula y el título nuevos
    const cambios = [];
    for (let i = 0; i < REPETICIONES; i++) {
        cambios.push(await gesto(page, `(() => { const antes = document.getElementById('playerTitle').textContent; const t0 = performance.now();
            document.getElementById('playerNext').click();
            return (${HASTA_QUE})(t0, "() => document.getElementById('playerTitle').textContent !== " + JSON.stringify(antes)); })()`));
        await page.waitForTimeout(700);
    }

    const peso = await page.evaluate(() => ({
        html: document.getElementById('libraryList').innerHTML.length,
        filas: document.querySelectorAll('#libraryList .library-item').length,
        kbMiniatura: globalThis.__kbMiniatura,
    }));
    await contexto.close();
    return {
        cpu, miniaturas: incrustadas ? 'incrustadas' : 'enlace',
        kbMiniatura: incrustadas ? kbMiniatura : 0,
        arranque: r(arranque.visto), arranqueBloqueado: r(bArranque.bloqueado),
        abrirBiblioteca: `${r(abrir.visto)} / ${r(abrir.libre)}`,
        corazon: `${r(mediana(corazones.map((c) => c.visto)))} / ${r(mediana(corazones.map((c) => c.libre)))}`,
        scrollLargas: bScroll.largas, scrollPerdidos: `${r((scroll.perdidos / (scroll.marcos + scroll.perdidos)) * 100)} %`,
        vueloPerdidos: `${r((vuelo.perdidos / (vuelo.marcos + vuelo.perdidos)) * 100)} %`,
        cambiarCancion: `${r(mediana(cambios.map((c) => c.visto)))} / ${r(mediana(cambios.map((c) => c.libre)))}`,
        htmlBiblioteca: `${(peso.html / 1024).toFixed(0)} KB`, filas: peso.filas,
    };
}

const proc = await servidor();
const browser = await chromium.launch();
const resultados = [];
try {
    for (const cpu of CPUS) {
        for (const incrustadas of [true, false]) {
            const m = await medirVariante(browser, { cpu, incrustadas });
            resultados.push(m);
            console.error(`hecho: CPU ${cpu}×, miniaturas ${m.miniaturas}`);
        }
    }
} finally {
    await browser.close();
    proc.kill();
}

const columnas = [
    ['CPU', (m) => `${m.cpu}×`], ['Miniaturas', (m) => (m.kbMiniatura ? `incrustadas (${m.kbMiniatura} KB)` : m.miniaturas)],
    ['Arrancar (ms)', (m) => m.arranque], ['Bloqueado al arrancar (ms)', (m) => m.arranqueBloqueado],
    ['Abrir biblioteca: visto / bloqueado después (ms)', (m) => m.abrirBiblioteca], ['Corazón: visto / bloqueado después (ms)', (m) => m.corazon],
    ['Scroll: tareas >50 ms', (m) => m.scrollLargas], ['Scroll: fotogramas perdidos', (m) => m.scrollPerdidos],
    ['Pantalla completa: perdidos', (m) => m.vueloPerdidos], ['Cambiar canción: visto / bloqueado después (ms)', (m) => m.cambiarCancion],
    ['HTML de la lista', (m) => m.htmlBiblioteca],
];
console.log(`\n${CANCIONES} canciones · mediana de ${REPETICIONES} en los gestos repetidos\n`);
console.log(`| ${columnas.map(([c]) => c).join(' | ')} |`);
console.log(`|${columnas.map(() => '---').join('|')}|`);
for (const m of resultados) console.log(`| ${columnas.map(([, f]) => f(m)).join(' | ')} |`);
console.log(`\n${JSON.stringify(resultados)}`);
