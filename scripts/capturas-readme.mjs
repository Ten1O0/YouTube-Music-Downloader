/**
 * Las capturas del README (plan 21, T10).
 *
 *     node scripts/capturas-readme.mjs
 *
 * Compila la web en una carpeta aparte, la sirve con `vite preview` en su
 * propio puerto y la abre en Chromium, sin conexión con el servidor: una
 * biblioteca de ejemplo, con artistas inventados y portadas abstractas que se
 * generan en el propio navegador (nada de portadas reales, que tienen
 * derechos de autor). Deja las capturas en docs/capturas/.
 */

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'docs', 'capturas');
const DIST = path.join(RAIZ, 'node_modules', '.cache', 'capturas-readme');
const PUERTO = 5094;
const BASE = `http://127.0.0.1:${PUERTO}`;

// Artistas y canciones inventados; cada artista con su paleta para las portadas
const ARTISTAS = [
    { nombre: 'Luna Costa', colores: ['#f6a96c', '#c2456e'] },
    { nombre: 'Los Faros', colores: ['#3fb8af', '#1d3557'] },
    { nombre: 'Aurora Vela', colores: ['#e9c46a', '#9b5de5'] },
    { nombre: 'Nébula', colores: ['#4cc9f0', '#3a0ca3'] },
    { nombre: 'Río Sur', colores: ['#90be6d', '#277da1'] },
    { nombre: 'Marea Roja', colores: ['#ff6b6b', '#2d1e2f'] },
];
const TITULOS = [
    'Marea alta', 'Norte', 'Luces de ciudad', 'Órbita', 'Agua dulce', 'Sin frenos',
    'Verano eterno', 'Faro', 'Polvo de estrellas', 'Gravedad', 'Corriente', 'Fuego lento',
    'Kilómetro cero', 'Horizonte', 'Medianoche', 'Satélite',
];
// Un verso por segundo: a los 5 s (donde se hace la captura) hay letra por encima y por debajo
const LETRA = [
    'Bajo la luz de la ciudad', 'camino sin mirar atrás', 'y el ruido se vuelve canción',
    'cuando suena tu voz', 'Las calles cuentan lo que fui', 'luces de ciudad',
    'brillando solo para mí', 'no quiero que se apaguen hoy', 'Corre la noche por la avenida',
    'y yo detrás, sin prisa', 'luces de ciudad', 'llévame a donde estás',
    'que el amanecer espere', 'un poco más',
].map((verso, i) => `[00:${String(i).padStart(2, '0')}.00] ${verso}`).join('\n');

function servidor() {
    execFileSync('npx', ['vite', 'build', '--outDir', DIST, '--emptyOutDir'], { cwd: path.join(RAIZ, 'frontend'), stdio: 'ignore' });
    const proc = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PUERTO), '--strictPort', '--host', '127.0.0.1'], { cwd: path.join(RAIZ, 'frontend'), stdio: 'ignore' });
    return proc;
}

async function esperarServidor() {
    for (let i = 0; i < 80; i++) {
        try { await fetch(BASE); return; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    throw new Error('vite preview no arrancó');
}

/** La biblioteca de ejemplo, con sus portadas, sembrada en IndexedDB. */
async function sembrar(page) {
    await page.evaluate(async ({ artistas, titulos }) => {
        // Una portada abstracta por canción: degradado de su artista y unas formas
        const portada = (i, [a, b]) => {
            const c = document.createElement('canvas');
            c.width = c.height = 360;
            const g = c.getContext('2d');
            const fondo = g.createLinearGradient(0, 0, 360, 360);
            fondo.addColorStop(0, a);
            fondo.addColorStop(1, b);
            g.fillStyle = fondo;
            g.fillRect(0, 0, 360, 360);
            g.globalAlpha = 0.35;
            g.fillStyle = '#fff';
            g.beginPath();
            g.arc(90 + (i * 53) % 180, 110 + (i * 37) % 150, 60 + (i * 13) % 70, 0, Math.PI * 2);
            g.fill();
            g.globalAlpha = 0.2;
            g.fillStyle = '#000';
            g.fillRect(0, 230 + (i * 17) % 60, 360, 40 + (i * 7) % 30);
            return c.toDataURL('image/jpeg', 0.86);
        };
        // 20 s de silencio en WAV, para que el reproductor tenga algo que sonar
        const n = 8000 * 20;
        const buf = new ArrayBuffer(44 + n * 2);
        const v = new DataView(buf);
        const txt = (o, s) => [...s].forEach((ch, k) => v.setUint8(o + k, ch.charCodeAt(0)));
        txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
        v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 2, true);
        const audio = new Blob([buf], { type: 'audio/wav' });

        const canciones = titulos.map((titulo, i) => {
            const artista = artistas[i % artistas.length];
            const id = `ejemplo${String(i).padStart(4, '0')}`;
            return {
                src: `idb://${id}`, videoId: id, title: `${artista.nombre} - ${titulo}`,
                channel: artista.nombre, artist: artista.nombre, track: titulo,
                thumbnail: portada(i, artista.colores), duration: 170 + i * 9,
                addedAt: new Date(Date.now() - i * 5_400_000).toISOString(),
            };
        });
        const listas = [
            { id: '1790000000001', name: 'Para correr', description: 'Rápidas y con ritmo', createdAt: new Date().toISOString(), songs: canciones.slice(0, 6) },
            { id: '1790000000002', name: 'Domingo tranquilo', description: '', createdAt: new Date().toISOString(), songs: canciones.slice(5, 12) },
            { id: '1790000000003', name: 'Carretera', description: '', createdAt: new Date().toISOString(), songs: canciones.slice(8, 16) },
        ];
        const favoritos = canciones.slice(0, 5).map((c) => ({ id: c.videoId, title: c.title, channel: c.channel, thumbnail: c.thumbnail }));
        await new Promise((ok, ko) => {
            const req = indexedDB.open('YTMusicDB');
            req.onsuccess = () => {
                const tx = req.result.transaction(['kv_store', 'audio_blobs'], 'readwrite');
                tx.objectStore('kv_store').put(canciones, 'ytdl_library');
                tx.objectStore('kv_store').put(listas, 'ytdl_playlists');
                tx.objectStore('kv_store').put(favoritos, 'favorites');
                canciones.forEach((c) => tx.objectStore('audio_blobs').put(audio, c.src.slice(6)));
                tx.oncomplete = ok;
                tx.onerror = () => ko(tx.error);
            };
        });
    }, { artistas: ARTISTAS, titulos: TITULOS });
}

async function quieta(page, ms = 1000) {
    await page.waitForTimeout(ms);
    await page.evaluate(() => document.fonts.ready);
}

async function ir(page, vista) {
    await page.locator(`.nav-btn[data-view="${vista}"]:visible`).first().click();
    await quieta(page);
}

async function preparar(page) {
    await page.route(/\/api\//, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.route('https://lrclib.net/**', (r) => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ id: 1, trackName: 'Luces de ciudad', artistName: 'Aurora Vela', duration: 188, syncedLyrics: LETRA, plainLyrics: '' }]),
    }));
    await page.route(/accounts\.google\.com|gstatic\.com|youtube\.com/, (r) => r.abort());
    await page.goto(BASE);
    await page.waitForFunction(() => /\d/.test(document.getElementById('libraryCount')?.textContent ?? ''), null, { timeout: 30_000 });
    await sembrar(page);
    await page.reload();
    await page.waitForFunction(() => /16/.test(document.getElementById('libraryCount')?.textContent ?? ''), null, { timeout: 30_000 });
    await page.evaluate(() => { localStorage.setItem('ytdl_lang', 'es'); });
    await quieta(page, 1500);
}

/** La canción «Luces de ciudad» sonando, en pausa al principio, en pantalla completa. */
async function pantallaCompleta(page) {
    await ir(page, 'libraryView');
    await page.locator('#libraryList .library-item', { hasText: 'Luces de ciudad' }).first().locator('.library-item-info').click();
    await page.locator('#playerInfo').click();
    await quieta(page, 1500);
    if (await page.evaluate(() => !document.getElementById('mainAudio').paused)) await page.locator('#fullPlayerPlay').click();
    await page.evaluate(() => {
        const a = document.getElementById('mainAudio');
        a.currentTime = 5;
        a.dispatchEvent(new Event('timeupdate'));
    });
    await quieta(page, 800);
}

const proc = servidor();
try {
    await esperarServidor();
    fs.mkdirSync(SALIDA, { recursive: true });
    const browser = await chromium.launch();
    const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
    const page = await movil.newPage();
    await preparar(page);
    const foto = async (nombre) => { await page.screenshot({ path: path.join(SALIDA, `${nombre}.png`), animations: 'disabled' }); console.log('  ', nombre); };

    await ir(page, 'libraryView');
    await foto('movil-biblioteca');
    await ir(page, 'playlistsView');
    await foto('movil-listas');
    await ir(page, 'homeView');
    await foto('movil-inicio');
    await pantallaCompleta(page);
    await foto('movil-reproductor');
    await page.locator('#lyricsToggle').click();
    await quieta(page, 1500);
    await foto('movil-letra');
    await page.locator('#lyricsBackBtn').click();
    await quieta(page);
    await page.locator('#fullPlayerQueue').click();
    await quieta(page);
    await foto('movil-cola');
    await movil.close();

    const escritorio = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-ES' });
    const pc = await escritorio.newPage();
    await preparar(pc);
    await ir(pc, 'libraryView');
    await pc.screenshot({ path: path.join(SALIDA, 'escritorio-biblioteca.png'), animations: 'disabled' });
    console.log('   escritorio-biblioteca');
    await browser.close();
} finally {
    proc.kill();
}
