/**
 * Red de seguridad visual (plan 19, T1): capturas de referencia de todas las
 * pantallas, a 390 px (móvil) y a 1280 px (escritorio), con datos fijos.
 *
 * El plan 19 cambia *cómo* se pinta la app, nunca *lo que* se ve: cada tarea
 * termina con estas capturas iguales. Si una sale distinta, la tarea no está
 * hecha. Para rehacer una referencia a propósito (un cambio visual pedido):
 *
 *     npx playwright test estetica --update-snapshots
 *
 * Datos fijos: una biblioteca de 12 canciones (3 en la nube) y 2 listas,
 * sembradas en IndexedDB; las miniaturas y la letra, servidas desde aquí; el
 * audio, 20 s de silencio, en pausa al principio. Las animaciones de CSS se
 * congelan en la captura y se espera a que los muelles se asienten.
 */

import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const MINIATURA = fs.readFileSync('test/e2e/ficheros/miniatura.jpg');
const LETRA = [
    '[00:00.00] Primera línea de la letra',
    '[00:05.00] Segunda línea, la que suena',
    '[00:10.00] Tercera línea de prueba',
    '[00:15.00] Cuarta línea para ver el desenfoque',
    '[00:20.00] Quinta y última',
].join('\n');

const ARTISTAS = ['Aurora Norte', 'Bruma', 'Cala Verde', 'Duna'];
const id = (i) => `estetica${String(i).padStart(3, '0')}`;
const CANCIONES = Array.from({ length: 12 }, (_, i) => ({
    src: i < 9 ? `idb://${id(i)}` : `nube://${id(i)}`,
    ...(i < 9 ? {} : { nube: true }),
    videoId: id(i),
    title: `${ARTISTAS[i % 4]} - Canción ${i + 1}`,
    channel: ARTISTAS[i % 4],
    artist: ARTISTAS[i % 4],
    track: `Canción ${i + 1}`,
    thumbnail: `https://i.ytimg.com/vi/${id(i)}/mqdefault.jpg`,
    duration: 180 + i * 7,
    addedAt: new Date(Date.UTC(2026, 8, 1, 12, 0, 0) - i * 3_600_000).toISOString(),
}));
// Listas largas (plan 19, T6): lo que queda lejos de la pantalla no se pinta, y
// eso solo se ve con más filas de las que caben. Solo para sus pruebas: las
// demás capturas siguen con los datos de siempre
const LARGAS = Array.from({ length: 60 }, (_, i) => ({
    src: `idb://${id(i)}`,
    videoId: id(i),
    title: `${ARTISTAS[i % 4]} - Canción ${i + 1}`,
    channel: ARTISTAS[i % 4],
    artist: ARTISTAS[i % 4],
    track: `Canción ${i + 1}`,
    thumbnail: `https://i.ytimg.com/vi/${id(i)}/mqdefault.jpg`,
    duration: 180 + i * 7,
    addedAt: new Date(Date.UTC(2026, 8, 1, 12, 0, 0) - i * 3_600_000).toISOString(),
}));
const FAVORITOS = LARGAS.slice(0, 40).map((c) => ({ id: c.videoId, title: c.title, channel: c.channel, thumbnail: c.thumbnail, addedAt: c.addedAt }));
const HISTORIAL = LARGAS.slice(0, 40).map((c) => ({ id: c.videoId, title: c.title, channel: c.channel, thumbnail: c.thumbnail, downloadedAt: c.addedAt }));

const LISTAS = [
    { id: '1790000000001', name: 'Para correr', description: 'Rápidas y con ritmo', createdAt: '2026-09-01T10:00:00.000Z', songs: CANCIONES.slice(0, 5) },
    { id: '1790000000002', name: 'Tranquilas', description: '', createdAt: '2026-09-02T10:00:00.000Z', songs: CANCIONES.slice(4, 11) },
];

/** La app con los datos fijos, en la vista de Inicio y con las fuentes cargadas. */
async function preparar(page, { largas = false } = {}) {
    const canciones = largas ? LARGAS : CANCIONES;
    const extra = largas ? { favorites: FAVORITOS, downloadHistory: HISTORIAL } : {};
    await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/jpeg', body: MINIATURA }));
    await page.route('https://lrclib.net/**', (r) => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ id: 1, trackName: 'Canción 1', artistName: 'Aurora Norte', duration: 180, syncedLyrics: LETRA, plainLyrics: '' }]),
    }));
    await page.goto('/');
    await page.evaluate(() => new Promise((ok) => {
        const q = indexedDB.deleteDatabase('YTMusicDB');
        q.onsuccess = q.onerror = q.onblocked = () => ok();
    }));
    await page.evaluate(() => localStorage.clear());
    await page.goto('/');
    await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });
    await page.evaluate(async ({ canciones, listas, extra }) => {
        // 20 s de silencio en WAV: sonando de verdad cuando se pausa con el botón
        const n = 8000 * 20;
        const buf = new ArrayBuffer(44 + n * 2);
        const v = new DataView(buf);
        const txt = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
        txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
        v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 2, true);
        const audio = new Blob([buf], { type: 'audio/wav' });
        await new Promise((ok, ko) => {
            const req = indexedDB.open('YTMusicDB');
            req.onsuccess = () => {
                const tx = req.result.transaction(['kv_store', 'audio_blobs'], 'readwrite');
                tx.objectStore('kv_store').put(canciones, 'ytdl_library');
                tx.objectStore('kv_store').put(listas, 'ytdl_playlists');
                for (const [clave, valor] of Object.entries(extra)) tx.objectStore('kv_store').put(valor, clave);
                canciones.filter((s) => s.src.startsWith('idb://')).forEach((s) => tx.objectStore('audio_blobs').put(audio, s.src.slice(6)));
                tx.oncomplete = ok; tx.onerror = () => ko(tx.error);
            };
        });
    }, { canciones, listas: LISTAS, extra });
    await page.reload();
    const locales = canciones.filter((c) => c.src.startsWith('idb://')).length;
    await expect(page.locator('#libraryCount')).toContainText(String(locales), { timeout: 15_000 });
    // Las fuentes se cargan aparte (ficheros propios desde la T10 del plan 19): sin
    // ellas los iconos salen como palabras («library_music») y la captura no sirve. Se espera a tenerlas
    // (check() da true también si la fuente ni está registrada: se exige cargada)
    await page.waitForFunction(() => ['Material Symbols Outlined', 'Inter', 'Plus Jakarta Sans'].every((familia) =>
        [...document.fonts].some((f) => f.family.replace(/"/g, '') === familia && f.status === 'loaded')), null, { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await quieta(page);
}

/** Que todo se asiente: muelles, imágenes y fuentes. */
async function quieta(page, ms = 900) {
    await page.waitForTimeout(ms);
    // Solo las imágenes a la vista: las diferidas de fuera de pantalla no cargan hasta acercarse
    await page.evaluate(() => Promise.all([...document.images].filter((i) => {
        if (i.complete) return false;
        const r = i.getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight && r.width > 0;
    }).map((i) => Promise.race([
        new Promise((ok) => { i.addEventListener('load', ok, { once: true }); i.addEventListener('error', ok, { once: true }); }),
        new Promise((ok) => setTimeout(ok, 5000)),
    ]))));
}

async function ir(page, vista) {
    await page.locator(`.nav-btn[data-view="${vista}"]:visible`).first().click();
    await quieta(page);
}

/** Pone la primera canción, la pausa al principio y abre la pantalla completa. */
async function pantallaCompleta(page) {
    await ir(page, 'libraryView');
    await page.locator('#libraryList .library-item', { hasText: 'Canción 1' }).first().locator('.library-item-info').click();
    await expect(page.locator('#playerBar')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await page.locator('#playerInfo').click();
    await quieta(page, 1400);
    // En pausa (con el botón de la app, para que su estado lo sepa) y al
    // principio: la barra de progreso y los tiempos, siempre iguales
    const suena = () => page.evaluate(() => ['mainAudio', 'deckAudio'].some((i) => document.getElementById(i)?.paused === false));
    if (await suena()) await page.locator('#fullPlayerPlay').click();
    await expect.poll(suena).toBe(false);
    await page.evaluate(() => {
        for (const i of ['mainAudio', 'deckAudio']) {
            const a = document.getElementById(i);
            if (a) { a.currentTime = 0; a.dispatchEvent(new Event('timeupdate')); }
        }
    });
    await quieta(page, 600);
}

const CAPTURA = {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.002,
};
const captura = (page, nombre, opciones = {}) => expect(page).toHaveScreenshot(`${nombre}.png`, { ...CAPTURA, ...opciones });
// Las de listas largas, sin tolerancia: lo que se deja de pintar lejos de la
// pantalla (T6) tiene que salir exactamente igual al acercarse
const capturaExacta = (page, nombre, opciones = {}) => captura(page, nombre, { maxDiffPixelRatio: 0, maxDiffPixels: 0, ...opciones });

/** Lleva a la mitad el contenedor con scroll que tiene dentro `selector`. */
async function aMitad(page, selector) {
    await page.locator(selector).first().evaluate((el) => {
        let c = el;
        while (c && !(c.scrollHeight > c.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
        (c ?? document.scrollingElement).scrollTop = Math.round(((c ?? document.scrollingElement).scrollHeight - (c ?? document.scrollingElement).clientHeight) / 2);
    });
    await quieta(page);
}

for (const [tamano, uso] of [
    ['movil', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ['escritorio', { viewport: { width: 1280, height: 800 } }],
]) {
    test.describe(`estética · ${tamano}`, () => {
        test.use(uso);

        test('inicio', async ({ page }) => {
            await preparar(page);
            await captura(page, `${tamano}-inicio`);
        });

        test('biblioteca: canciones (con algunas en la nube) y artistas', async ({ page }) => {
            await preparar(page);
            await ir(page, 'libraryView');
            await captura(page, `${tamano}-biblioteca-canciones`);
            await page.locator('#libraryModo [data-modo="artistas"]').click();
            await quieta(page);
            await captura(page, `${tamano}-biblioteca-artistas`);
        });

        test('listas y el detalle de una lista', async ({ page }) => {
            await preparar(page);
            await ir(page, 'playlistsView');
            await captura(page, `${tamano}-listas`);
            await page.locator('.playlist-card', { hasText: 'Para correr' }).click();
            await quieta(page);
            await captura(page, `${tamano}-lista-detalle`);
        });

        test('pantalla completa, con letra, cola y editar', async ({ page }) => {
            await preparar(page);
            await pantallaCompleta(page);
            // El visualizador se mueve con la música: en pausa, pero se enmascara por si acaso
            const vis = page.locator('#fullPlayerVisualizer');
            await captura(page, `${tamano}-pantalla-completa`, { mask: [vis] });

            await page.locator('#lyricsToggle').click();
            // La letra llega de la red cuando quiere: con ella ya pintada, se
            // coloca el audio en la segunda línea («la que suena») y se avisa,
            // para que siempre sea esa la activa y las demás, con su profundidad
            await expect(page.locator('#lyricsContent .lyrics-line')).toHaveCount(5);
            await page.evaluate(() => {
                const a = document.getElementById('mainAudio');
                a.currentTime = 6;
                a.dispatchEvent(new Event('timeupdate'));
            });
            await expect(page.locator('#lyricsContent .lyrics-line.active')).toHaveText('Segunda línea, la que suena');
            await quieta(page, 1400);
            await captura(page, `${tamano}-letra`, { mask: [vis] });
            await page.locator('#lyricsBackBtn').click();
            await quieta(page);

            await page.locator('#fullPlayerQueue').click();
            await quieta(page);
            await captura(page, `${tamano}-cola`);
            await page.keyboard.press('Escape');
            await quieta(page);

            await page.locator('#fullPlayerEdit').click();
            await quieta(page);
            await captura(page, `${tamano}-editar`);
        });

        test('ajustes: cuenta, reproducción y versión', async ({ page }) => {
            await preparar(page);
            await page.locator('#navProfile:visible, #sidebarAjustesBtn:visible').first().click();
            await quieta(page);
            // La versión publicada cambia con cada APK: se enmascara
            await captura(page, `${tamano}-ajustes`, { mask: [page.locator('#ajustesVersionEstado')] });
        });

        test('listas largas: favoritos, historial y cola, arriba y a media lista', async ({ page }) => {
            // Seis capturas y 60 canciones: en el escritorio rozaba los 45 s del límite
            test.slow();
            await preparar(page, { largas: true });
            for (const [panel, lista] of [['favorites', '#favoritesList'], ['history', '#historyList']]) {
                await page.locator(`#${panel}Toggle`).click();
                await quieta(page);
                await expect(page.locator(`${lista} .history-item`)).toHaveCount(40);
                await page.locator(lista).scrollIntoViewIfNeeded();
                await quieta(page);
                await capturaExacta(page, `${tamano}-largas-${panel}`);
                await aMitad(page, `${lista} .history-item`);
                await capturaExacta(page, `${tamano}-largas-${panel}-mitad`);
                await page.locator(`#${panel}Toggle`).click();
                await quieta(page);
            }
            await pantallaCompleta(page);
            await page.locator('#fullPlayerQueue').click();
            await quieta(page);
            await expect(page.locator('#pqQueueList .pq-item')).toHaveCount(59);
            await capturaExacta(page, `${tamano}-largas-cola`);
            await aMitad(page, '#pqQueueList .pq-item');
            await capturaExacta(page, `${tamano}-largas-cola-mitad`);
        });

        test('tus datos', async ({ page }) => {
            await preparar(page);
            await ir(page, 'libraryView');
            await page.locator('#libraryDataBtn').click();
            await quieta(page);
            // «Sincronizado hace…» cambia con la hora: se enmascara
            await captura(page, `${tamano}-tus-datos`, { mask: [page.locator('#dataSyncStatus')] });
        });
    });
}
