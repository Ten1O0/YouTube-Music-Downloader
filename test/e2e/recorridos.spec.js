/**
 * Los recorridos críticos de la aplicación (plan 06, T7), más los avisos de
 * descarga (8 y 9), los del movimiento (10 a 17, plan 09) y los de la cola y
 * el volumen (20 y 21) y los modales de una lista (22), escritos antes de
 * partir el reproductor y las listas en módulos.
 *
 * Están escritos **solo contra la interfaz**: botones, texto y el elemento de
 * audio. No tocan ninguna API interna, y por eso siguen valiendo después de la
 * modularización del plan 08. Son la definición ejecutable de "la aplicación
 * hace lo mismo que antes".
 *
 * El recorrido 3 merece mención aparte: comprueba que una canción descargada
 * sigue sonando tras recargar. Es exactamente el defecto que el plan 01
 * persiguió y que resultó estar peor de lo diagnosticado, así que tenerlo aquí
 * significa que no puede volver sin que nadie se entere.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { iniciarSesionDePrueba, tokenDe, usuarioDePrueba } from './sesion.js';

const ESPERA_DESCARGA = 60_000;

/** Abre la aplicación con el almacenamiento limpio. */
async function abrirApp(page) {
    await page.goto('/');
    await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('YTMusicDB');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
    }));
    await page.evaluate(() => localStorage.clear());

    await page.goto('/');
    await expect(page.locator('#youtubeUrl')).toBeVisible();
    // El contador de biblioteca se pinta al final del arranque
    await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });
}

/** Escribe en la caja y lanza la acción (búsqueda o descarga según el texto). */
async function pedir(page, texto) {
    await page.fill('#youtubeUrl', texto);
    await page.click('#downloadBtn');
}

/**
 * Cambia de vista pulsando el botón de navegación **visible**.
 *
 * Hay dos barras: la lateral en escritorio y la inferior en móvil, ambas con
 * `[data-view]`. Cuál está visible depende del ancho, así que se filtra por
 * visibilidad en vez de fijar un id.
 */
async function irA(page, vista) {
    await page.locator(`.nav-btn[data-view="${vista}"]:visible`).first().click();
    await page.waitForTimeout(400);
}

/** Espera a que la biblioteca tenga al menos `n` canciones. */
async function esperarBiblioteca(page, n = 1) {
    await expect(page.locator('#libraryList .library-item'))
        .toHaveCount(n, { timeout: ESPERA_DESCARGA });
}

// ============================================================
// 1 · Buscar
// ============================================================

test('1 · buscar muestra resultados', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'cancion de prueba');

    await expect(page.locator('#searchResults')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Cancion de prueba 1').first()).toBeVisible();
});

// ============================================================
// 2 · Descargar → entra en la biblioteca
// ============================================================

test('2 · descargar una canción la añade a la biblioteca', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');

    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await expect(page.locator('#libraryList')).toContainText('Cancion de prueba 1');
});

// ============================================================
// 3 · Recargar → la canción sigue ahí Y SUENA
// ============================================================

test('3 · la canción sobrevive a una recarga y se puede reproducir', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');

    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);

    // --- recarga ---
    await page.reload();
    await expect(page.locator('#youtubeUrl')).toBeVisible();
    await irA(page, 'libraryView');

    // Sigue en la biblioteca
    await esperarBiblioteca(page, 1);
    await expect(page.locator('#libraryList')).toContainText('Cancion de prueba 1');

    // Y, lo que de verdad importa: al pulsarla, el audio carga.
    // Antes el src apuntaba a un recurso temporal que el servidor ya había
    // borrado, así que esto se quedaba en silencio.
    await page.locator('#libraryList .library-item').first().click();

    const cargó = await page.waitForFunction(() => {
        const audio = document.getElementById('mainAudio');
        if (!audio?.src) return false;
        return audio.readyState >= 1 || audio.duration > 0;
    }, { timeout: 20_000 }).then(() => true).catch(() => false);

    const src = await page.evaluate(() => document.getElementById('mainAudio')?.src || '');
    expect(cargó, `el audio no cargó tras recargar (src: ${src})`).toBe(true);
});

// ============================================================
// 4 · Favorito → recargar → sigue marcado
// ============================================================

test('4 · un favorito sobrevive a una recarga', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');

    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);

    const corazon = page.locator('#libraryList .library-item').first().locator('.lib-fav-btn');
    await corazon.click();
    await expect(corazon).toHaveClass(/active/, { timeout: 10_000 });

    await page.reload();
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);

    const corazonTrasRecarga = page.locator('#libraryList .library-item').first().locator('.lib-fav-btn');
    await expect(corazonTrasRecarga, 'el favorito se perdió al recargar')
        .toHaveClass(/active/, { timeout: 10_000 });
});

// ============================================================
// 5 · Crear playlist → añadir canción → abrirla
// ============================================================

test('5 · crear una playlist y añadirle una canción', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');

    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);

    // Añadir a playlist desde la biblioteca abre el modal de selección
    await page.locator('#libraryList .library-item').first()
        .locator('.lib-add-playlist-btn').click();

    const modal = page.locator('#addToPlaylistModal');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // "Nueva playlist" se crea en la misma ventana, sin abrir otra encima (plan 23)
    await modal.locator('#addToPlaylistCreateNewBtn').click();
    await expect(modal.locator('#newPlaylistNameInput')).toBeVisible({ timeout: 10_000 });
    await expect(modal.locator('#addToPlaylistCreateNewBtn')).toBeHidden();
    await page.fill('#newPlaylistNameInput', 'Mi lista E2E');
    await page.click('#confirmCreateNewPlaylistBtn');

    // La ventana se queda abierta a propósito, con la lista recién creada ya
    // marcada, así que se cierra como lo haría el usuario.
    await expect(modal.locator('.anadir-lista.elegida', { hasText: 'Mi lista E2E' })).toBeVisible({ timeout: 10_000 });
    await expect(modal.locator('#addToPlaylistCreateNewBtn')).toBeVisible();
    await page.click('#closeAddToPlaylistModal');
    await expect(modal).toBeHidden({ timeout: 10_000 });

    await irA(page, 'playlistsView');
    await expect(page.locator('#playlistsGrid'))
        .toContainText('Mi lista E2E', { timeout: 15_000 });
});

// ============================================================
// 6 · Reproducir, pausar, siguiente
// ============================================================

test('6 · el reproductor controla la cola', async ({ page }) => {
    await abrirApp(page);

    // Dos canciones distintas, una a una. Una URL de playlist abriría el
    // selector de canciones, que es otro recorrido.
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);

    await irA(page, 'homeView');
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);

    // Reproducir la primera
    await page.locator('#libraryList .library-item').first().click();
    await expect(page.locator('#playerBar')).toBeVisible({ timeout: 15_000 });

    const tituloInicial = await page.locator('#playerTitle').textContent();

    // Pausar
    await page.click('#playerPlay');
    await expect.poll(
        () => page.evaluate(() => document.getElementById('mainAudio')?.paused),
        { timeout: 10_000 }
    ).toBe(true);

    // Siguiente
    await page.click('#playerNext');
    await expect.poll(
        () => page.locator('#playerTitle').textContent(),
        { message: 'next() no cambió de canción', timeout: 15_000 }
    ).not.toBe(tituloInicial);
});

// ============================================================
// 7 · Cambiar de idioma → la interfaz se traduce
// ============================================================

test('7 · la interfaz se traduce al cambiar de idioma', async ({ page }) => {
    await abrirApp(page);

    const textoEs = await page.locator('[data-i18n="nav_library"]').first().textContent();

    // Selector de idioma de la cabecera móvil o de la barra lateral
    await page.locator('.lang-toggle-el:visible').first().click();
    await page.locator('.lang-option[data-lang="en"]:visible').first().click();
    await page.waitForTimeout(600);

    const textoEn = await page.locator('[data-i18n="nav_library"]').first().textContent();

    expect(textoEn, 'la interfaz no cambió de idioma').not.toBe(textoEs);
    expect(textoEn.toLowerCase()).toContain('librar');
});

// ============================================================
// 8 · Escritorio: el aviso de descarga es un banner
// ============================================================

/**
 * Durante mucho tiempo el aviso de progreso no se mostró nunca: la llamada
 * que lo creaba estaba tras una guarda que jamás se cumplía. Como el fallo es
 * silencioso —la descarga termina igual—, conviene que lo mire alguien que no
 * se olvide. Desde el plan 09 (T13), en escritorio es un banner como los de
 * macOS y en el móvil, una isla.
 */
test('8 · en escritorio la descarga se anuncia con un banner', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await abrirApp(page);

    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');

    const banner = page.locator('#queuePanel .dl-banner');
    await expect(banner, 'el banner de descarga no apareció').toBeVisible({ timeout: 20_000 });
    await expect(banner.locator('.dl-banner-barra')).toBeAttached();

    // Fijo, arriba a la derecha y por encima del resto
    const caja = await banner.boundingBox();
    expect(caja.y).toBeLessThan(60);
    expect(caja.x + caja.width).toBeGreaterThan(1280 - 40);
    const capa = await page.locator('#queuePanel').evaluate((el) => {
        const s = getComputedStyle(el);
        return { position: s.position, zIndex: parseInt(s.zIndex, 10) };
    });
    expect(capa.position).toBe('fixed');
    expect(capa.zIndex).toBeGreaterThan(1000);

    // Al terminar se retira solo
    await expect(banner, 'el banner se quedó en pantalla tras completarse')
        .toHaveCount(0, { timeout: 30_000 });
});

// ============================================================
// 9 · Móvil: el aviso de descarga es una isla
// ============================================================

test('9 · en el móvil la descarga se anuncia con una isla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrirApp(page);

    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');

    const isla = page.locator('#queuePanel .dl-island');
    await expect(isla, 'la isla no apareció en el móvil').toBeVisible({ timeout: 20_000 });

    // Se expande hasta ocupar casi todo el ancho, sin salirse
    await expect.poll(async () => (await isla.boundingBox())?.width ?? 0,
        { message: 'la isla no se expandió', timeout: 5_000 }).toBeGreaterThan(300);
    const caja = await isla.boundingBox();
    expect(caja.x, 'la isla se sale por la izquierda').toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width, 'la isla se sale por la derecha').toBeLessThanOrEqual(390);
    expect(caja.y, 'la isla no está arriba del todo').toBeLessThan(40);

    // Al terminar se recoge y desaparece
    await expect(isla, 'la isla se quedó en pantalla tras completarse').toBeHidden({ timeout: 30_000 });
});

// ============================================================
// Movimiento (plan 09, T23)
// ============================================================

/**
 * Del 10 al 17 comprueban el movimiento: lo que más fácil se rompe sin que
 * nadie lo note, porque la aplicación sigue funcionando igual. Miden estados
 * (hay un clon en vuelo, la escala se asienta en 0,82, la hoja está anclada
 * abajo), no fotogramas concretos, para no depender de la velocidad del equipo.
 */

/** Descarga una canción, la pone a sonar en bucle y deja el mini reproductor a la vista. */
async function sonando(page) {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await page.locator('#libraryList .library-item').first().click();
    await expect(page.locator('#playerBar')).toBeVisible({ timeout: 15_000 });
    // El audio falso dura un segundo: en bucle, el reproductor no se cierra solo
    await page.evaluate(() => { document.getElementById('mainAudio').loop = true; });
}

async function abrirReproductor(page) {
    await page.locator('#playerThumb').click();
    await expect(page.locator('#fullPlayer')).not.toHaveClass(/fp-hidden/);
    await expect(page.locator('.flight-clone')).toHaveCount(0, { timeout: 3_000 });
}

/** Escala real de la carátula grande. */
const escalaCaratula = page => page.evaluate(() =>
    new DOMMatrix(getComputedStyle(document.getElementById('fullPlayerThumb')).transform).a);

test('10 · el mini reproductor se transforma en el completo', async ({ page }) => {
    await sonando(page);

    await page.locator('#playerThumb').click();
    await expect(page.locator('.flight-clone'), 'no hay carátula en vuelo').toHaveCount(1, { timeout: 1_000 });

    // Al asentarse, el clon desaparece y queda la carátula grande
    await expect(page.locator('.flight-clone')).toHaveCount(0, { timeout: 3_000 });
    await expect(page.locator('#fullPlayer')).not.toHaveClass(/fp-hidden/);
    await expect(page.locator('#fullPlayerThumb')).toBeVisible();

    // Y al cerrar vuelve a verse el mini reproductor
    await page.keyboard.press('Escape');
    await expect(page.locator('#fullPlayer')).toHaveClass(/fp-hidden/, { timeout: 3_000 });
    await expect(page.locator('#playerBar')).toBeVisible();
});

test('12 · la carátula respira al pausar y al reproducir', async ({ page }) => {
    await sonando(page);
    await abrirReproductor(page);

    await page.click('#fullPlayerPlay');
    await expect.poll(() => escalaCaratula(page), { message: 'en pausa no se encoge', timeout: 3_000 })
        .toBeCloseTo(0.82, 2);

    await page.click('#fullPlayerPlay');
    await expect.poll(() => escalaCaratula(page), { message: 'al reproducir no vuelve', timeout: 3_000 })
        .toBeCloseTo(1, 2);
});

test('13 · tocar una línea de la letra salta a ese momento', async ({ page }) => {
    const lrc = Array.from({ length: 12 }, (_, i) =>
        `[00:00.${String(i * 8).padStart(2, '0')}] Línea ${i + 1} de la letra de prueba`).join('\n');
    // Como las de verdad: con título, artista y duración (plan 22 comprueba que es esa canción)
    await page.route('**/lrclib.net/**', r => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ trackName: 'Cancion de prueba 1', artistName: 'Canal E2E', duration: 180, syncedLyrics: lrc, plainLyrics: 'x' }]),
    }));
    await sonando(page);
    await abrirReproductor(page);
    await page.click('#lyricsToggle');
    await expect(page.locator('#lyricsSection .lyrics-line')).toHaveCount(12, { timeout: 10_000 });

    await page.evaluate(() => {
        const a = document.getElementById('mainAudio');
        a.pause();
        a.currentTime = 0.9;
    });
    // La segunda línea empieza en 0,08 s
    await page.locator('#lyricsSection .lyrics-line').nth(1).click();
    await expect.poll(() => page.evaluate(() => document.getElementById('mainAudio').currentTime),
        { message: 'tocar la línea no movió el audio', timeout: 3_000 }).toBeLessThan(0.3);
});

test('14 · en escritorio las descargas se apilan y el de debajo sube', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await abrirApp(page);

    // Dos descargas a la vez, como las hace un usuario: desde los resultados de
    // una búsqueda (la caja de URL descarga de una en una)
    await pedir(page, 'cancion de prueba');
    await expect(page.locator('#searchResults .result-item').nth(1)).toBeVisible({ timeout: 30_000 });

    // Sin respuestas de progreso, las dos siguen «en curso» lo que dure el recorrido
    await page.route('**/api/progress/**', () => { });
    await page.route('**/api/cancel/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.locator('#searchResults .result-item .result-info').nth(0).click();
    await expect(page.locator('#queuePanel .dl-banner')).toHaveCount(1, { timeout: 20_000 });
    await page.locator('#searchResults .result-item .result-info').nth(1).click();
    await expect(page.locator('#queuePanel .dl-banner')).toHaveCount(2, { timeout: 20_000 });

    // Uno encima del otro, sin solaparse
    const alturas = () => page.locator('#queuePanel .dl-banner').evaluateAll(els =>
        els.map(e => Math.round(e.getBoundingClientRect().y)).sort((a, b) => a - b));
    await expect.poll(async () => { const [a, b] = await alturas(); return b - a; },
        { message: 'los banners no se apilan', timeout: 3_000 }).toBeGreaterThan(40);
    const [arriba] = await alturas();

    // Se cancela el de arriba: el de debajo sube a su sitio
    await page.evaluate((y) => {
        [...document.querySelectorAll('#queuePanel .dl-banner')]
            .find(e => Math.round(e.getBoundingClientRect().y) === y)
            .querySelector('.dl-cancelar').click();
    }, arriba);
    await expect(page.locator('#queuePanel .dl-banner')).toHaveCount(1, { timeout: 5_000 });
    await expect.poll(async () => (await alturas())[0], { message: 'el de debajo no subió', timeout: 3_000 })
        .toBeLessThanOrEqual(arriba + 1);
});

test('15 · con «Reducir movimiento» no hay vuelo y la isla no se expande', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sonando(page);

    await page.locator('#playerThumb').click();
    await expect(page.locator('#fullPlayer')).not.toHaveClass(/fp-hidden/);
    expect(await page.locator('.flight-clone').count(), 'con movimiento reducido no debe haber clon').toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#fullPlayer')).toHaveClass(/fp-hidden/, { timeout: 3_000 });

    // La isla aparece ya abierta: su primer tamaño visible es el definitivo
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/progress/**', () => { });
    await irA(page, 'homeView');
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    const isla = page.locator('#queuePanel .dl-island');
    await expect(isla).toBeVisible({ timeout: 20_000 });
    expect((await isla.boundingBox()).width, 'la isla creció en vez de aparecer abierta').toBeGreaterThan(300);
});

test('17 · el botón de descarga dice el formato elegido', async ({ page }) => {
    await abrirApp(page);
    await expect(page.locator('#downloadBtn')).toContainText('M4A');

    await page.click('#customFormatSelect');
    await page.click('#customFormatOptions .custom-option[data-value="mp3"]');
    await expect(page.locator('#downloadBtn')).toContainText('MP3');
    await expect(page.locator('#downloadBtn')).not.toContainText('M4A');
});

test('18 · en escritorio el reproductor se recoge al elegir sección, con el ratón y con el trackpad', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await sonando(page);
    const fp = page.locator('#fullPlayer');
    const cerrado = () => expect(fp).toHaveClass(/fp-hidden/, { timeout: 3_000 });

    // Elegir otra sección lo recoge y lleva allí; atrás vuelve a la anterior
    await abrirReproductor(page);
    await page.locator('.sidebar-nav .nav-btn[data-view="playlistsView"]').click();
    await cerrado();
    await expect(page.locator('#playlistsView')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#libraryView')).toBeVisible({ timeout: 3_000 });

    // Arrastrar con el ratón: poco vuelve, mucho cierra
    await abrirReproductor(page);
    await page.mouse.move(760, 300);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(760, 300 + i * 10); await page.waitForTimeout(40); }
    await page.mouse.up();
    await page.waitForTimeout(800);
    await expect(fp, 'un arrastre corto lo cerró').not.toHaveClass(/fp-hidden/);
    await page.mouse.move(760, 300);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(760, 300 + i * 30);
    await page.mouse.up();
    await cerrado();
    // Cerrarlo a mano no deja una entrada de más en el historial
    expect(await page.evaluate(() => history.state?.type)).toBe('view');

    // Dos dedos en el trackpad hacia abajo, estando arriba del todo
    await abrirReproductor(page);
    await page.mouse.move(760, 300);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -30); await page.waitForTimeout(16); }
    await cerrado();
});

test('19 · el sistema ve lo que suena: carátula cuadrada y la pausa aunque la haga el sistema', async ({ page }) => {
    await sonando(page);

    // La carátula cuadrada sustituye a la miniatura en cuanto está lista
    await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.artwork?.[0]?.sizes),
        { message: 'la sesión multimedia no recibió la carátula cuadrada', timeout: 10_000 }).toBe('512x512');
    expect(await page.evaluate(() => navigator.mediaSession.metadata.title)).toBe('Cancion de prueba 1');
    expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe('playing');

    // Una pausa que no viene de la app (una llamada, otros auriculares…)
    await page.evaluate(() => document.getElementById('mainAudio').pause());
    await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState),
        { message: 'el sistema seguiría viendo la canción sonando' }).toBe('paused');
});

test('20 · la hoja de la cola muestra lo que suena y salta a otra canción', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await irA(page, 'homeView');
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);

    await page.locator('#libraryList .library-item').first().click();
    await expect(page.locator('#playerBar')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { document.getElementById('mainAudio').loop = true; });
    await abrirReproductor(page);

    const actual = (await page.locator('#playerTitle').textContent()).trim();
    await page.click('#fullPlayerQueue');
    const hoja = page.locator('#playbackQueueSheet');
    await expect(hoja).not.toHaveClass(/hidden/);
    await expect(page.locator('#pqNowPlaying .pq-item-title')).toHaveText(actual);
    // Ocupa todo su recuadro, como las de la cola: no se encoge al ancho del título
    const anchos = await page.evaluate(() => {
        const marco = document.getElementById('pqNowPlaying');
        const estilo = getComputedStyle(marco);
        const interior = marco.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
        // offsetWidth: el ancho de maqueta, sin la escala de la animación de apertura
        return { fila: document.querySelector('#pqNowPlaying .pq-item').offsetWidth, interior };
    });
    expect(Math.abs(anchos.fila - anchos.interior)).toBeLessThan(2);

    // La otra canción espera en la cola; tocarla la pone a sonar
    const siguiente = page.locator('#pqQueueList .pq-item');
    await expect(siguiente).toHaveCount(1);
    const otra = (await siguiente.locator('.pq-item-title').textContent()).trim();
    expect(otra).not.toBe(actual);
    await siguiente.click();
    await expect.poll(() => page.locator('#playerTitle').textContent(), { timeout: 10_000 }).toBe(otra);
    await expect(page.locator('#pqNowPlaying .pq-item-title')).toHaveText(otra);

    await page.keyboard.press('Escape');
    await expect(hoja).toHaveClass(/hidden/, { timeout: 3_000 });
});

test('21 · el volumen y el silencio van a la par en las dos barras', async ({ page }) => {
    await sonando(page);
    await abrirReproductor(page);
    const volumen = () => page.evaluate(() => document.getElementById('mainAudio').volume);

    await page.locator('#fullPlayerVolume').fill('30');
    await expect.poll(volumen).toBeCloseTo(0.3, 2);
    await expect(page.locator('#playerVolume')).toHaveValue('30');

    // Silenciar deja las dos barras a cero y recuerda el volumen de antes
    await page.click('#fullPlayerMuteBtn');
    await expect.poll(volumen).toBe(0);
    await expect(page.locator('#playerVolume')).toHaveValue('0');
    await page.click('#fullPlayerMuteBtn');
    await expect.poll(volumen).toBeCloseTo(0.3, 2);
    await expect(page.locator('#fullPlayerVolume')).toHaveValue('30');
});

test('22 · editar una lista y añadirle canciones desde su detalle', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await irA(page, 'homeView');
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);

    // Una lista con la primera canción, como en el recorrido 5
    await page.locator('#libraryList .library-item').first().locator('.lib-add-playlist-btn').click();
    await page.locator('#addToPlaylistCreateNewBtn').click();
    await page.fill('#newPlaylistNameInput', 'Lista para editar');
    await page.click('#confirmCreateNewPlaylistBtn');
    await expect(page.locator('#addToPlaylistModal')).toContainText('Lista para editar', { timeout: 10_000 });
    await page.click('#closeAddToPlaylistModal');

    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Lista para editar' }).click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(1, { timeout: 10_000 });

    // Editar el nombre y la descripción
    await page.click('#plActionEdit');
    await expect(page.locator('#editPlaylistModal')).toBeVisible();
    // Con su portada y su resumen; sin nombre no se puede guardar (plan 23, D5)
    await expect(page.locator('#editPlaylistCover > *')).toHaveCount(1);
    await expect(page.locator('#editPlaylistSubtitulo')).toContainText('1 canción');
    await page.fill('#editPlaylistNameInput', '  ');
    await expect(page.locator('#confirmEditPlaylistBtn')).toBeDisabled();
    await page.fill('#editPlaylistNameInput', 'Lista renombrada');
    await page.fill('#editPlaylistDescInput', 'Con descripción');
    await page.click('#confirmEditPlaylistBtn');
    await expect(page.locator('#editPlaylistModal')).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#playlistDetailName')).toHaveText('Lista renombrada');
    await expect(page.locator('#playlistDetailDescription')).toHaveText('Con descripción');

    // Añadir la otra canción con el selector de canciones (plan 23)
    await page.click('#plActionAdd');
    await expect(page.locator('#playlistSearchModal')).toBeVisible();
    const filas = page.locator('#plSearchResults .selector-fila');
    await expect(filas).toHaveCount(2);
    await expect(page.locator('#plSearchResults .selector-fila.elegida')).toHaveCount(1);
    await page.locator('#plSearchResults .selector-fila:not(.elegida)').click();
    await expect(page.locator('#plSearchResults .selector-fila.elegida')).toHaveCount(2);
    await expect(page.locator('#playlistSearchResumen')).toContainText('2 seleccionadas');
    await page.click('#playlistSearchDone');
    await expect(page.locator('#playlistSearchModal')).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(2);
    await expect(page.locator('#playlistDetailCount')).toContainText('2');
});

test('23 · los atajos de teclado controlan el reproductor y no molestan al escribir', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await irA(page, 'homeView');
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);
    await page.locator('#libraryList .library-item').first().click();
    await expect(page.locator('#playerBar')).toBeVisible({ timeout: 15_000 });
    const audio = (prop) => page.evaluate((p) => document.getElementById('mainAudio')[p], prop);
    await page.evaluate(() => { document.getElementById('mainAudio').loop = true; document.activeElement?.blur(); });

    // Espacio pausa y reanuda
    await page.keyboard.press('Space');
    await expect.poll(() => audio('paused')).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(() => audio('paused')).toBe(false);

    // Flecha abajo baja el volumen; M silencia
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => audio('volume')).toBeCloseTo(0.95, 2);
    await page.keyboard.press('m');
    await expect.poll(() => audio('volume')).toBe(0);
    await page.keyboard.press('m');

    // N pasa a la siguiente canción
    const antes = await page.locator('#playerTitle').textContent();
    await page.keyboard.press('n');
    await expect.poll(() => page.locator('#playerTitle').textContent()).not.toBe(antes);

    // F abre el reproductor completo y ? la ayuda; Escape la cierra
    await page.keyboard.press('f');
    await expect(page.locator('#fullPlayer')).not.toHaveClass(/fp-hidden/);
    await page.keyboard.press('Shift+?');
    await expect(page.locator('#shortcutsSheet')).not.toHaveClass(/hidden/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcutsSheet')).toHaveClass(/hidden/, { timeout: 3_000 });
    await page.keyboard.press('f');
    await expect(page.locator('#fullPlayer')).toHaveClass(/fp-hidden/, { timeout: 3_000 });

    // Escribiendo en el buscador, las teclas son texto
    await page.keyboard.press('/');
    await expect(page.locator('#youtubeUrl')).toBeFocused();
    await page.keyboard.type('mk n');
    await expect(page.locator('#youtubeUrl')).toHaveValue(/mk n$/);
    expect(await audio('paused')).toBe(false);
});

test('24 · un título con HTML se ve como texto y no ejecuta nada', async ({ page }) => {
    await abrirApp(page);
    const hostil = '<img src=x onerror=';

    // En los resultados de búsqueda
    await pedir(page, 'hostil');
    await expect(page.locator('#resultsList')).toContainText(hostil, { timeout: 15_000 });
    await expect(page.locator('#resultsList')).toContainText('<svg onload=');

    // En la biblioteca, el reproductor y la cola
    await pedir(page, 'https://www.youtube.com/watch?v=xssxssxssxs');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await expect(page.locator('#libraryList')).toContainText(hostil);
    await page.locator('#libraryList .library-item').first().click();
    await expect(page.locator('#playerTitle')).toContainText(hostil, { timeout: 15_000 });
    await page.evaluate(() => { document.getElementById('mainAudio').loop = true; });
    await abrirReproductor(page);
    await page.click('#fullPlayerQueue');
    await expect(page.locator('#pqNowPlaying')).toContainText(hostil);

    // Nada de eso llegó a ser una etiqueta de verdad
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('img[src="x"], svg[onload]')).toHaveCount(0);
});

test('25 · la biblioteca vacía tiene ilustración y lleva al buscador', async ({ page }) => {
    await abrirApp(page);
    await irA(page, 'libraryView');

    const vacio = page.locator('#libraryEmpty');
    await expect(vacio).toBeVisible();
    await expect(vacio.locator('.estado-vacio-ilustracion')).toBeVisible();
    await expect(vacio).toContainText('Tu biblioteca está vacía');

    await vacio.getByRole('button', { name: 'Buscar música' }).click();
    await expect(page.locator('#youtubeUrl')).toBeVisible();
    await expect(page.locator('#youtubeUrl')).toBeFocused();

    // Y el texto sigue al idioma
    await page.locator('.lang-toggle-el:visible').first().click();
    await page.locator('.lang-option[data-lang="en"]:visible').first().click();
    await irA(page, 'libraryView');
    await expect(vacio).toContainText('Your library is empty');
});

test('26 · artista y canción limpios, editables, y la edición sobrevive a recargar', async ({ page }) => {
    await abrirApp(page);
    for (const id of ['bbbbbbbbbbb', 'ccccccccccc']) {
        await pedir(page, `https://www.youtube.com/watch?v=${id}`);
        await irA(page, 'libraryView');
        await esperarBiblioteca(page, id === 'bbbbbbbbbbb' ? 1 : 2);
        await irA(page, 'homeView');
    }
    await irA(page, 'libraryView');
    const fila = (texto) => page.locator('#libraryList .library-item', { hasText: texto });

    // Lo que dio YouTube y lo deducido del título
    await expect(fila('Tema Oficial')).toContainText('Artista Oficial');
    await expect(fila('Cancion de prueba 3')).toContainText('Grupo Tres');
    await expect(fila('Cancion de prueba 3')).not.toContainText('Official Video');

    // Reproducir la de «Grupo Tres» y editarla
    await fila('Cancion de prueba 3').click();
    await expect(page.locator('#playerTitle')).toHaveText('Cancion de prueba 3', { timeout: 15_000 });
    // El audio simulado dura un segundo: en bucle, no pasa a la siguiente mientras se edita
    const enBucle = () => page.evaluate(() => { const a = document.getElementById('mainAudio'); a.loop = true; a.currentTime = 0; });
    await enBucle();
    // En las filas no hay lápiz: en el móvil se pulsaba sin querer. Se edita
    // desde la pantalla completa, la única vista dedicada a una canción
    await expect(page.locator('#libraryList .lib-edit-btn')).toHaveCount(0);
    const editarLoQueSuena = async () => {
        if (await page.locator('#fullPlayer').evaluate((el) => el.classList.contains('fp-hidden'))) await page.locator('#playerInfo').click();
        await page.click('#fullPlayerEdit');
        await expect(page.locator('#editSongSheet')).toBeVisible();
    };
    const cerrarPantallaCompleta = async () => {
        await page.click('#fullPlayerClose');
        await expect(page.locator('#fullPlayer')).toHaveClass(/fp-hidden/);
    };
    await editarLoQueSuena();
    await expect(page.locator('#editSongOriginal')).toContainText('(Official Video) [HD]');
    await page.fill('#editSongArtist', 'Mi Grupo');
    await page.fill('#editSongTrack', 'Mi Tema');
    await page.click('#editSongSave');
    await expect(page.locator('#editSongSheet')).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#fullPlayerTitle')).toHaveText('Mi Tema');
    await cerrarPantallaCompleta();

    // Llega a la biblioteca y a lo que suena
    await expect(fila('Mi Tema')).toContainText('Mi Grupo');
    await expect(page.locator('#playerTitle')).toHaveText('Mi Tema');
    await expect(page.locator('#playerArtist')).toHaveText('Mi Grupo');

    // Vacío no se guarda
    await editarLoQueSuena();
    await page.fill('#editSongTrack', '   ');
    await page.click('#editSongSave');
    await expect(page.locator('#editSongSheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#editSongSheet')).toBeHidden();
    await cerrarPantallaCompleta();

    // Y sobrevive a una recarga
    await page.reload();
    await irA(page, 'libraryView');
    await expect(fila('Mi Tema')).toContainText('Mi Grupo', { timeout: 15_000 });

    // Volver a lo automático
    await fila('Mi Tema').click();
    await expect(page.locator('#playerTitle')).toHaveText('Mi Tema', { timeout: 15_000 });
    await enBucle();
    await editarLoQueSuena();
    await page.click('#editSongRestore');
    await expect(page.locator('#editSongSheet')).toBeHidden({ timeout: 5_000 });
    await cerrarPantallaCompleta();
    await expect(fila('Cancion de prueba 3')).toContainText('Grupo Tres', { timeout: 5_000 });
});

test('27 · la biblioteca por artistas agrupa, abre el artista y lo reproduce', async ({ page }) => {
    await abrirApp(page);
    for (const [id, n] of [['aaaaaaaaaaa', 1], ['ccccccccccc', 2]]) {
        await pedir(page, `https://www.youtube.com/watch?v=${id}`);
        await irA(page, 'libraryView');
        await esperarBiblioteca(page, n);
        await irA(page, 'homeView');
    }
    await irA(page, 'libraryView');

    await page.click('#libraryModo [data-modo="artistas"]');
    await expect(page.locator('#libraryList')).toBeHidden();
    const filas = page.locator('#artistsList .artista-fila');
    await expect(filas).toHaveCount(2);
    await expect(filas.nth(0)).toContainText('Canal E2E');
    await expect(filas.nth(1)).toContainText('Grupo Tres');

    // El artista abre su vista y «Reproducir» suena su canción
    await filas.filter({ hasText: 'Grupo Tres' }).click();
    await expect(page.locator('#artistDetailView')).toBeVisible();
    await expect(page.locator('#artistDetailName')).toHaveText('Grupo Tres');
    await expect(page.locator('#artistDetailList .library-item')).toHaveCount(1);
    await page.click('#artistPlayBtn');
    await expect(page.locator('#playerTitle')).toHaveText('Cancion de prueba 3', { timeout: 15_000 });

    // Atrás vuelve a la biblioteca, que sigue por artistas, también tras recargar
    await page.click('#backToLibraryBtn');
    await expect(page.locator('#libraryView')).toBeVisible();
    await expect(filas).toHaveCount(2);
    await page.reload();
    await irA(page, 'libraryView');
    await expect(filas).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('#libraryModo [data-modo="artistas"]')).toHaveAttribute('aria-selected', 'true');
});

test('28 · las listas automáticas: nueva y sin escuchar, y tras dos escuchas, «Más escuchadas»', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);

    const tarjeta = (id) => page.locator(`#playlistsGrid .playlist-card[data-id="${id}"]`);
    await irA(page, 'playlistsView');
    await expect(tarjeta('auto:recent')).toContainText('Añadidas recientemente');
    await expect(tarjeta('auto:unplayed')).toContainText('Sin escuchar');
    await expect(tarjeta('auto:top'), 'con 0 escuchas no hay «Más escuchadas»').toHaveCount(0);

    // El audio simulado dura 1 s: cuenta a la mitad. Dos reproducciones completas
    const escuchar = async () => {
        await irA(page, 'libraryView');
        await page.locator('#libraryList .library-item').first().click();
        await expect.poll(() => page.evaluate(() => document.getElementById('mainAudio').ended), { timeout: 15_000 }).toBe(true);
    };
    await escuchar();
    await escuchar();

    await irA(page, 'playlistsView');
    await expect(tarjeta('auto:top')).toContainText('Más escuchadas', { timeout: 5_000 });
    await expect(tarjeta('auto:unplayed')).toHaveCount(0);

    // Solo lectura: sin añadir, editar, ordenar, borrar ni quitar
    await tarjeta('auto:top').click();
    await expect(page.locator('#playlistDetailName')).toHaveText('Más escuchadas');
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(1);
    for (const id of ['#plActionAdd', '#plActionEdit', '#plActionReorder', '#plActionDelete']) {
        await expect(page.locator(id)).toBeHidden();
    }
    await expect(page.locator('#playlistDetailList .pl-remove-btn')).toHaveCount(0);
    await page.click('#backToPlaylistsBtn');
    await expect(page.locator('#playlistsView')).toBeVisible();
});

// ============================================================
// 29-32 · Sonido (plan 12)
// ============================================================

/** Descarga los ids en orden; la biblioteca queda con el último arriba. */
async function descargarTodos(page, ids) {
    for (const [i, id] of ids.entries()) {
        await pedir(page, `https://www.youtube.com/watch?v=${id}`);
        await irA(page, 'libraryView');
        await esperarBiblioteca(page, i + 1);
        await irA(page, 'homeView');
    }
    await irA(page, 'libraryView');
}

/** Abre la hoja de Ajustes: «Ajustes» de la barra inferior en el móvil, o de la lateral. */
async function abrirAjustes(page) {
    await page.locator('#navProfile:visible, #sidebarAjustesBtn:visible').first().click();
    await expect(page.locator('#ajustesSheet')).toBeVisible();
}

/** Elige la transición en la hoja de Ajustes. */
async function elegirTransicion(page, segundos) {
    await abrirAjustes(page);
    await page.click(`#pbFundido [data-fundido="${segundos}"]`);
    await expect(page.locator(`#pbFundido [data-fundido="${segundos}"]`)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#ajustesSheet')).toBeHidden();
}

/** Muestrea los dos elementos de audio cada 50 ms mientras dura `ms`. */
function muestrear(page, ms) {
    return page.evaluate((duracion) => new Promise((resolve) => {
        const muestras = [];
        const inicio = performance.now();
        const tomar = () => {
            const t = performance.now() - inicio;
            muestras.push(['mainAudio', 'deckAudio'].map((id) => {
                const el = document.getElementById(id);
                return { id, src: el.src.slice(-12), sonando: !el.paused && !el.ended && el.currentTime > 0, vol: el.volume, t: el.currentTime };
            }).concat([{ t }]));
            if (t < duracion) setTimeout(tomar, 50); else resolve(muestras);
        };
        tomar();
    }), ms);
}

test('29 · con fundido de 2 s, las dos canciones suenan a la vez y sus volúmenes se cruzan', async ({ page }) => {
    await abrirApp(page);
    await descargarTodos(page, ['eeeeeeeeeee', 'ddddddddddd']);
    // Arriba «Tono uno», debajo «Tono dos»: la cola es ese orden
    await page.locator('#libraryList .library-item', { hasText: 'Tono uno' }).click();
    await expect(page.locator('#playerTitle')).toHaveText('Tono uno', { timeout: 15_000 });
    await elegirTransicion(page, 2);

    const muestras = await muestrear(page, 7_000);
    const juntas = muestras.filter(([a, b]) => a.sonando && b.sonando);
    expect(juntas.length, 'nunca sonaron las dos a la vez').toBeGreaterThan(5);

    // Durante el cruce, la que entra sube y la que sale baja, y ninguna pasa de 1.
    // Las fuentes son URL blob: la que sale es la que sonaba sola al principio
    const srcUno = muestras.find(([a, b]) => a.sonando !== b.sonando).slice(0, 2).find((x) => x.sonando).src;
    const volDe = (m, deUno) => m.slice(0, 2).find((x) => (x.src === srcUno) === deUno && x.sonando)?.vol;
    const sale = juntas.map((m) => volDe(m, true)).filter((v) => v !== undefined);
    const entra = juntas.map((m) => volDe(m, false)).filter((v) => v !== undefined);
    expect(entra.at(-1)).toBeGreaterThan(entra[0]);
    expect(sale.at(-1)).toBeLessThan(sale[0]);
    for (const m of muestras) for (const x of m.slice(0, 2)) expect(x.vol).toBeLessThanOrEqual(1);

    // Al final suena solo la segunda, entera, y es la que muestra el reproductor
    await expect(page.locator('#playerTitle')).toHaveText('Tono dos');
    const final = await page.evaluate(() => ({
        otraParada: document.getElementById('deckAudio').paused,
        vol: document.getElementById('mainAudio').volume,
    }));
    expect(final.otraParada).toBe(true);
    expect(final.vol, 'acabado el cruce, la que queda suena entera').toBe(1);
});

test('30 · sin cortes: la siguiente empieza menos de 300 ms después de acabar la anterior', async ({ page }) => {
    await abrirApp(page);
    await descargarTodos(page, ['eeeeeeeeeee', 'ddddddddddd']);
    // Relojes en los dos elementos antes de reproducir: cuándo acaba uno y cuándo suena el otro
    await page.evaluate(() => {
        window.__marcas = [];
        for (const id of ['mainAudio', 'deckAudio']) {
            const el = document.getElementById(id);
            el.addEventListener('ended', () => window.__marcas.push(['fin', decodeURIComponent(el.src), performance.now()]));
            el.addEventListener('playing', () => window.__marcas.push(['suena', decodeURIComponent(el.src), performance.now()]));
        }
    });
    await page.locator('#libraryList .library-item', { hasText: 'Tono uno' }).click();
    await expect(page.locator('#playerTitle')).toHaveText('Tono dos', { timeout: 15_000 });

    const marcas = await page.evaluate(() => window.__marcas);
    // Las fuentes son URL blob: la primera que suena es «Tono uno»
    const srcUno = marcas.find(([q]) => q === 'suena')[1];
    const fin = marcas.find(([q, src]) => q === 'fin' && src === srcUno);
    const suena = marcas.find(([q, src]) => q === 'suena' && src !== srcUno);
    expect(fin, JSON.stringify(marcas)).toBeTruthy();
    expect(suena, JSON.stringify(marcas)).toBeTruthy();
    expect(suena[2] - fin[2], 'hueco entre canciones (ms)').toBeLessThan(300);
    // Y no se solapan de forma audible: empieza como mucho unas décimas antes
    expect(fin[2] - suena[2]).toBeLessThan(300);
});

test('31 · igualar volumen: el tono fuerte suena más bajo que el suave, y se puede desactivar', async ({ page }) => {
    await abrirApp(page);
    await descargarTodos(page, ['ddddddddddd', 'fffffffffff']);
    const volumenDe = async (titulo) => {
        await page.locator('#libraryList .library-item', { hasText: titulo }).click();
        await expect(page.locator('#playerTitle')).toHaveText(titulo, { timeout: 15_000 });
        return page.evaluate(() => document.getElementById('mainAudio').volume);
    };
    const fuerte = await volumenDe('Tono fuerte');
    const suave = await volumenDe('Tono uno');
    expect(suave).toBe(1);
    // −4,4 LUFS hacia −16: unos 11,6 dB menos, un volumen de ~0,26
    expect(fuerte).toBeGreaterThan(0.2);
    expect(fuerte).toBeLessThan(0.32);

    // Medido por el servidor y guardado en la biblioteca (se lee de IndexedDB:
    // las filas ya no llevan la canción entera, plan 19)
    const medida = await page.evaluate(() => new Promise((ok) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const g = r.result.transaction('kv_store').objectStore('kv_store').get('ytdl_library');
            g.onsuccess = () => ok((g.result || []).find((s) => s.title === 'Tono fuerte')?.loudness);
        };
    }));
    expect(medida.fuente).toBe('servidor');

    // Sin igualar, suena a su volumen de origen
    await abrirAjustes(page);
    await page.locator('label:has(#pbIgualar)').click();
    await page.keyboard.press('Escape');
    expect(await volumenDe('Tono fuerte')).toBe(1);
});

test('32 · el visualizador pinta con la música y se para al cerrar la pantalla completa', async ({ page }) => {
    await abrirApp(page);
    await descargarTodos(page, ['fffffffffff']);
    await page.locator('#libraryList .library-item', { hasText: 'Tono fuerte' }).click();
    await expect(page.locator('#playerTitle')).toHaveText('Tono fuerte', { timeout: 15_000 });
    // El tono dura 6 s: en bucle para tener música todo el recorrido
    await page.evaluate(() => { document.getElementById('mainAudio').loop = true; });

    const lienzo = page.locator('#fullPlayerVisualizer');
    const cuadros = () => lienzo.evaluate((el) => Number(el.dataset.cuadros || 0));
    await expect(lienzo).toBeHidden();

    await page.locator('#playerInfo').click();
    await expect(lienzo).toBeVisible();
    await expect.poll(cuadros, { timeout: 5_000 }).toBeGreaterThan(10);
    // Hay barras: píxeles pintados en el lienzo
    await expect.poll(() => lienzo.evaluate((el) => {
        const d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
        let pintados = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) pintados++;
        return pintados;
    }), { timeout: 5_000 }).toBeGreaterThan(50);

    // Cerrada la pantalla completa, deja de dibujar
    await page.click('#fullPlayerClose');
    await page.waitForTimeout(600);
    const alCerrar = await cuadros();
    await page.waitForTimeout(800);
    expect(await cuadros()).toBe(alCerrar);

    // Desactivado en los ajustes, ni aparece
    await abrirAjustes(page);
    await page.locator('label:has(#pbVisualizador)').click();
    await page.keyboard.press('Escape');
    await page.locator('#playerInfo').click();
    await expect(page.locator('#fullPlayer')).not.toHaveClass(/fp-hidden/);
    await expect(lienzo).toBeHidden();
});

test('33 · un favorito marcado desde la biblioteca se vuelve a descargar de YouTube, también desde el historial', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    // Favorito desde la fila de la biblioteca: la canción lleva su ruta interna (idb://)
    await page.locator('#libraryList .lib-fav-btn').first().click();
    await irA(page, 'homeView');

    const pedidas = [];
    page.on('request', (r) => { if (r.url().includes('/api/start-download')) pedidas.push(JSON.parse(r.postData()).url); });
    for (const [i, lista] of ['#favoritesList', '#historyList'].entries()) {
        await page.evaluate((sel) => document.querySelector(`${sel} .history-download-btn`).click(), lista);
        await expect.poll(() => pedidas.length, { timeout: 10_000 }).toBe(i + 1);
        // Que acabe antes de pedir la siguiente
        await expect(page.locator('#downloadBtn')).toBeEnabled({ timeout: 30_000 });
    }
    expect(pedidas).toEqual(['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://www.youtube.com/watch?v=aaaaaaaaaaa']);
    await expect(page.getByText(/no válida/i)).toHaveCount(0);
});

// ============================================================
// 34-36 · Tus datos en todos tus dispositivos (plan 13)
// ============================================================

/** Un «dispositivo»: contexto de navegador propio, con la app abierta y la sesión de `email`. */
async function dispositivoCon(browser, email) {
    const contexto = await browser.newContext({ locale: 'es-ES' });
    const page = await contexto.newPage();
    await abrirApp(page);
    await iniciarSesionDePrueba(page, email);
    await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });
    return page;
}

/** Lo que la cuenta tiene en el servidor, visto con su token. */
async function cuentaDe(request, email) {
    const { id } = usuarioDePrueba(email);
    const res = await request.get('/api/sync?desde=0', { headers: { Authorization: `Bearer ${tokenDe(id)}` } });
    return res.json();
}

test('34 · una lista y una canción de un dispositivo aparecen en el otro; la canción en la nube, y tocarla la descarga', async ({ browser, request }) => {
    const email = `dos-${Date.now()}@e2e.test`;
    const movil = await dispositivoCon(browser, email);

    await pedir(movil, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(movil, 'libraryView');
    await esperarBiblioteca(movil, 1);
    await movil.locator('#libraryList .lib-add-playlist-btn').first().click();
    await movil.locator('#addToPlaylistCreateNewBtn').click();
    await movil.fill('#newPlaylistNameInput', 'Viaje');
    await movil.click('#confirmCreateNewPlaylistBtn');
    await expect(movil.locator('#addToPlaylistModal')).toContainText('Viaje');
    await movil.click('#closeAddToPlaylistModal');

    // Llega a la cuenta (3 s después del último cambio)
    await expect.poll(async () => {
        const c = await cuentaDe(request, email);
        return [c.biblioteca.map((s) => s.videoId), c.listas.map((l) => [l.name, l.songs])];
    }, { timeout: 20_000 }).toEqual([['aaaaaaaaaaa'], [['Viaje', ['aaaaaaaaaaa']]]]);

    // El ordenador, con la misma cuenta y sin nada descargado
    const ordenador = await dispositivoCon(browser, email);
    await irA(ordenador, 'libraryView');
    const fila = ordenador.locator('#libraryList .library-item', { hasText: 'Cancion de prueba 1' });
    await expect(fila).toHaveClass(/library-item-nube/, { timeout: 15_000 });
    await expect(ordenador.locator('#libraryCloudBar')).toBeVisible();
    await expect(ordenador.locator('#libraryCloudBtn')).toContainText('(1)');
    await irA(ordenador, 'playlistsView');
    await expect(ordenador.locator('#playlistsGrid')).toContainText('Viaje');

    // Tocarla la descarga y la reproduce; deja de estar en la nube
    await irA(ordenador, 'libraryView');
    await fila.click();
    await expect(ordenador.locator('#playerTitle')).toHaveText('Cancion de prueba 1', { timeout: 30_000 });
    await expect(fila).not.toHaveClass(/library-item-nube/);
    await expect(ordenador.locator('#libraryCloudBar')).toBeHidden();
    await expect(ordenador.locator('#libraryList .library-item')).toHaveCount(1);
});

test('35 · exportar, borrar los datos del navegador e importar: vuelven las listas y las canciones, en la nube', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await page.locator('#libraryList .lib-add-playlist-btn').first().click();
    await page.locator('#addToPlaylistCreateNewBtn').click();
    await page.fill('#newPlaylistNameInput', 'Para la copia');
    await page.click('#confirmCreateNewPlaylistBtn');
    await expect(page.locator('#addToPlaylistModal')).toContainText('Para la copia');
    await page.click('#closeAddToPlaylistModal');

    await page.click('#libraryDataBtn');
    await expect(page.locator('#dataSheet')).toBeVisible();
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#backupExportBtn')]);
    expect(descarga.suggestedFilename()).toMatch(/^music-downloader-copia-\d{4}-\d{2}-\d{2}\.json$/);
    const ruta = await descarga.path();
    const copia = JSON.parse(await (await import('node:fs/promises')).readFile(ruta, 'utf8'));
    expect(copia.formato).toBe('music-downloader');
    expect(copia.biblioteca.map((c) => c.videoId)).toEqual(['aaaaaaaaaaa']);
    expect(Object.keys(copia.biblioteca[0])).not.toContain('src');

    // Navegador limpio: ni biblioteca ni listas
    await abrirApp(page);
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryList .library-item')).toHaveCount(0);
    await page.click('#libraryDataBtn');
    await page.setInputFiles('#backupImportInput', ruta);
    await expect(page.locator('#backupSummaryText')).toContainText('1 canciones, 1 listas');
    await page.click('#backupMergeBtn');

    await page.keyboard.press('Escape');
    await expect(page.locator('#libraryList .library-item')).toHaveCount(1);
    await expect(page.locator('#libraryList .library-item')).toHaveClass(/library-item-nube/);
    await irA(page, 'playlistsView');
    await expect(page.locator('#playlistsGrid')).toContainText('Para la copia');
});

test('36 · si otro dispositivo borra más de 10 canciones, se pregunta antes; conservarlas las devuelve a la cuenta', async ({ page, request }) => {
    test.setTimeout(90_000);
    const email = `borrados-${Date.now()}@e2e.test`;
    const ids = Array.from({ length: 12 }, (_, i) => `z${String(i).padStart(10, '0')}`);

    // Doce canciones con audio en este dispositivo, antes de tener sesión
    await abrirApp(page);
    await page.evaluate((ids) => new Promise((ok, ko) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const tx = r.result.transaction(['kv_store', 'audio_blobs'], 'readwrite');
            ids.forEach((id) => tx.objectStore('audio_blobs').put(new Blob(['x'], { type: 'audio/wav' }), id));
            tx.objectStore('kv_store').put(ids.map((id, i) => ({
                src: `idb://${id}`, videoId: id, title: `Tema ${i}`, channel: 'Canal', artist: 'Canal', track: `Tema ${i}`,
                addedAt: new Date(Date.now() - i * 1000).toISOString(),
            })), 'ytdl_library');
            tx.oncomplete = ok; tx.onerror = ko;
        };
    }), ids);
    const { id: userId } = usuarioDePrueba(email);
    const auth = { Authorization: `Bearer ${tokenDe(userId)}` };
    await iniciarSesionDePrueba(page, email);
    await expect.poll(async () => (await cuentaDe(request, email)).biblioteca.length, { timeout: 20_000 }).toBe(12);

    // Otro dispositivo las borra todas
    const borrarTodas = () => request.post('/api/sync', { headers: auth, data: {
        dispositivo: 'otro-dispositivo-1', cambios: ids.map((videoId) => ({ tipo: 'cancion', accion: 'borrar', datos: { videoId } })),
    } });
    expect((await borrarTodas()).ok()).toBe(true);

    // Al sincronizar, se pregunta; conservarlas
    await page.reload();
    await expect(page.locator('#confirmModal')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#confirmMessage')).toContainText('12');
    await page.click('#confirmNoBtn');
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryList .library-item')).toHaveCount(12);
    await expect.poll(async () => (await cuentaDe(request, email)).biblioteca.filter((c) => !c.deleted).length, { timeout: 20_000 }).toBe(12);

    // Otra vez, y ahora sí: se borran y se libera su audio
    expect((await borrarTodas()).ok()).toBe(true);
    await page.reload();
    await expect(page.locator('#confirmModal')).toBeVisible({ timeout: 15_000 });
    await page.click('#confirmYesBtn');
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryList .library-item')).toHaveCount(0);
    const blobs = await page.evaluate(() => new Promise((ok) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => { const c = r.result.transaction('audio_blobs').objectStore('audio_blobs').count(); c.onsuccess = () => ok(c.result); };
    }));
    expect(blobs).toBe(0);
});

test('38 · canciones de antes de guardar su id: no se duplican en la nube, suben a la cuenta y Artistas cuenta solo lo descargado', async ({ page, request }) => {
    const email = `antiguas-${Date.now()}@e2e.test`;
    const { id: userId } = usuarioDePrueba(email);
    const auth = { Authorization: `Bearer ${tokenDe(userId)}` };
    const TITULO = 'KAZE - MODO TURBIO - VIDEOCLIP [PROD. FIGU]';

    // Lo que subió «el ordenador»: esa canción con su id de verdad, y otra de Kaze que aquí no está
    await request.post('/api/sync', { headers: auth, data: { dispositivo: 'ordenador-0001', cambios: [
        { tipo: 'cancion', accion: 'poner', datos: { videoId: 'rLZSjJPyulk', title: TITULO, channel: 'KAZE', artist: 'KAZE', track: 'MODO TURBIO' } },
        { tipo: 'cancion', accion: 'poner', datos: { videoId: 'kkkkkkkkkkk', title: 'KAZE - OTRA', channel: 'KAZE', artist: 'KAZE', track: 'OTRA' } },
    ] } });

    // «El móvil», antes de iniciar sesión: las dos con el id de la descarga, como se guardaban
    await abrirApp(page);
    await page.evaluate((TITULO) => new Promise((ok, ko) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const tx = r.result.transaction(['kv_store', 'audio_blobs'], 'readwrite');
            for (const id of ['turbio', 'movil']) tx.objectStore('audio_blobs').put(new Blob(['x'], { type: 'audio/wav' }), id);
            tx.objectStore('kv_store').put([
                { src: 'idb://turbio', videoId: '8a8ceb9e0d4f4b1c9a7e2b3c4d5e6f70', title: TITULO, channel: 'KAZE', artist: 'KAZE', track: 'MODO TURBIO', thumbnail: 'data:image/jpeg;base64,xx', addedAt: '2026-09-20T10:00:00Z' },
                { src: 'idb://movil', videoId: '1f2e3d4c5b6a79880a1b2c3d4e5f6071', title: 'Tema del móvil', channel: 'Alguien', artist: 'Alguien', track: 'Tema del móvil', addedAt: '2026-09-21T10:00:00Z' },
            ], 'ytdl_library');
            // Su enlace solo está en el historial de descargas
            tx.objectStore('kv_store').put([{ id: 'mmmmmmmmmmm', title: 'Tema del móvil', url: 'https://www.youtube.com/watch?v=mmmmmmmmmmm', downloadedAt: '2026-09-21T10:00:00Z' }], 'downloadHistory');
            tx.oncomplete = ok; tx.onerror = ko;
        };
    }), TITULO);
    await iniciarSesionDePrueba(page, email);
    await irA(page, 'libraryView');

    // Modo Turbio no aparece dos veces: es la descargada; la otra de Kaze sí está en la nube
    const filas = page.locator('#libraryList .library-item');
    await expect(filas).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('#libraryList .library-item-nube')).toHaveCount(1);
    await expect(page.locator('#libraryList .library-item-nube')).toContainText('OTRA');
    await expect(page.locator('#libraryCount')).toContainText('2');
    await expect(page.locator('#libraryCloudBtn')).toContainText('(1)');

    // La del móvil sube a la cuenta: el ordenador la verá en la nube
    await expect.poll(async () => (await cuentaDe(request, email)).biblioteca.map((c) => c.videoId).sort(), { timeout: 20_000 })
        .toEqual(['kkkkkkkkkkk', 'mmmmmmmmmmm', 'rLZSjJPyulk']);

    // Artistas: Kaze tiene una descargada aquí, no dos
    await page.click('#libraryModo [data-modo="artistas"]');
    const kaze = page.locator('#artistsList .artista-fila', { hasText: 'KAZE' });
    await expect(kaze).toContainText('1 canción');
    // Y en las filas no hay lápiz de editar
    await page.click('#libraryModo [data-modo="canciones"]');
    await expect(page.locator('#libraryList .lib-edit-btn')).toHaveCount(0);
});

// ============================================================
// 39-40 · Listas que se siguen y descargas que sobreviven (plan 14)
// ============================================================

/** Lo apuntado como descarga pendiente en IndexedDB. */
function pendientes(page) {
    return page.evaluate(() => new Promise((ok) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => { const g = r.result.transaction('kv_store').objectStore('kv_store').get('descargas_pendientes'); g.onsuccess = () => ok(g.result || []); };
    }));
}

/** Guarda un valor en el almacenamiento de la app, como lo haría ella. */
function guardarEnApp(page, clave, valor) {
    return page.evaluate(([k, v]) => new Promise((ok) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const tx = r.result.transaction('kv_store', 'readwrite');
            tx.objectStore('kv_store').put(v, k);
            tx.oncomplete = ok;
        };
    }), [clave, valor]);
}

const LISTA_EXTRA = path.resolve('test/e2e/.tmp-data/lista_extra.json');

test('39 · seguir una lista crea la lista vinculada; lo que YouTube le añade llega con «Buscar novedades»', async ({ page }) => {
    await abrirApp(page);
    fs.rmSync(LISTA_EXTRA, { force: true });
    // Sin descarga automática: lo nuevo se queda en la nube y el recorrido no espera descargas
    await guardarEnApp(page, 'ytdl_seguimiento', { auto: false, soloWifi: true });
    await page.reload();

    try {
        // Una canción ya descargada, que no está en la lista
        await pedir(page, 'https://www.youtube.com/watch?v=eeeeeeeeeee');
        await irA(page, 'libraryView');
        await esperarBiblioteca(page, 1);
        await irA(page, 'homeView');

        await pedir(page, 'https://www.youtube.com/playlist?list=PLe2eSeguida0123456');
        await expect(page.locator('#playlistSelector')).toBeVisible({ timeout: 30_000 });
        await page.click('#followPlaylistBtn');

        // Se abre la lista vinculada, con el nombre de la de YouTube, su barra y sus canciones en la nube
        await expect(page.locator('#playlistDetailView')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#playlistDetailName')).toHaveText('Lista E2E');
        await expect(page.locator('#plFollowBar')).toBeVisible();
        await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(3);
        await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(3);

        // En la biblioteca, la descargada va delante aunque las de la nube sean más nuevas
        await irA(page, 'libraryView');
        const filas = page.locator('#libraryList .library-item');
        await expect(filas).toHaveCount(4);
        await expect(filas.first()).toContainText('Tono dos');
        await expect(filas.first()).not.toHaveClass(/library-item-nube/);
        await expect(page.locator('#libraryList .library-item-nube')).toHaveCount(3);
        await irA(page, 'playlistsView');
        await page.locator('.playlist-card', { hasText: 'Lista E2E' }).click();

        // Tocar una de la nube en la lista la descarga, y la fila deja de estar en la nube al momento
        const fila = page.locator('#playlistDetailList .library-item', { hasText: 'Cancion de prueba 1' });
        await expect(fila).toHaveClass(/library-item-nube/);
        await fila.click();
        await expect(page.locator('#playerTitle')).toHaveText('Cancion de prueba 1', { timeout: 30_000 });
        await expect(fila).not.toHaveClass(/library-item-nube/, { timeout: 10_000 });
        await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(2);
        // Y sigue así después de recargar
        await page.reload();
        await irA(page, 'playlistsView');
        await page.locator('.playlist-card', { hasText: 'Lista E2E' }).click();
        await expect(fila).not.toHaveClass(/library-item-nube/);
        await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(2);

        // YouTube le añade una canción; «Buscar novedades» la trae, sin quitar nada
        fs.writeFileSync(LISTA_EXTRA, JSON.stringify([{ id: 'ddddddddddd', title: 'Tono uno', channel: 'Canal Tonos', duration: 6 }]));
        await page.click('#plFollowCheck');
        await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(4, { timeout: 30_000 });
        await expect(page.locator('#playlistDetailList')).toContainText('Tono uno');
        await expect(page.getByText('«Lista E2E»: canciones nuevas (1)')).toBeVisible();

        // Otra vez: nada nuevo
        await page.click('#plFollowCheck');
        await expect(page.getByText('No hay nada nuevo en esta lista')).toBeVisible({ timeout: 30_000 });

        // En la cuadrícula lleva el distintivo
        await irA(page, 'playlistsView');
        await expect(page.locator('.playlist-card', { hasText: 'Lista E2E' }).locator('.seguida-distintivo')).toBeVisible();

        // Dejar de seguir: queda como una lista normal, con sus 4 canciones
        await page.locator('.playlist-card', { hasText: 'Lista E2E' }).click();
        await page.click('#plFollowStop');
        await expect(page.locator('#confirmModal')).toBeVisible();
        await page.click('#confirmYesBtn');
        await expect(page.locator('#plFollowBar')).toBeHidden({ timeout: 10_000 });
        await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(4);
    } finally {
        fs.rmSync(LISTA_EXTRA, { force: true });
    }
});

test('39b · con sesión, la vigila el servidor: la tarea periódica apunta lo nuevo y la app lo recibe una vez', async ({ page, request }) => {
    const email = `sigue-${Date.now()}@e2e.test`;
    const lista = 'PLe2eServidor0123456';
    await abrirApp(page);
    fs.rmSync(LISTA_EXTRA, { force: true });
    await guardarEnApp(page, 'ytdl_seguimiento', { auto: false, soloWifi: true });
    await iniciarSesionDePrueba(page, email);
    const { id } = usuarioDePrueba(email);
    const cabeceras = { Authorization: `Bearer ${tokenDe(id)}` };

    try {
        await pedir(page, `https://www.youtube.com/playlist?list=${lista}`);
        await expect(page.locator('#playlistSelector')).toBeVisible({ timeout: 30_000 });
        await page.click('#followPlaylistBtn');
        await expect(page.locator('#playlistDetailName')).toHaveText('Lista E2E', { timeout: 15_000 });
        await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(3);

        // El servidor la tiene apuntada, sin nada pendiente de entregar
        let seguidas = await (await request.get('/api/follows', { headers: cabeceras })).json();
        expect(seguidas.listas.map((l) => [l.listId, l.nuevas.length])).toEqual([[lista, 0]]);

        // YouTube le añade una canción y pasa la tarea de cada hora (como si hubieran pasado 6 h)
        fs.writeFileSync(LISTA_EXTRA, JSON.stringify([{ id: 'eeeeeeeeeee', title: 'Tono dos', channel: 'Canal Tonos', duration: 6 }]));
        const datos = path.resolve('test/e2e/.tmp-data');
        execFileSync('python3', ['-c', [
            'import sqlite3, sys',
            'con = sqlite3.connect(sys.argv[1])',
            "con.execute(\"UPDATE followed_playlists SET last_checked = datetime('now', '-7 hours') WHERE user_id = ?\", (int(sys.argv[2]),))",
            'con.commit()',
        ].join('\n'), path.join(datos, 'youtube_downloader.db'), String(id)]);
        const salida = execFileSync('python3', ['tareas.py', 'comprobar_listas'], {
            cwd: path.resolve('backend'),
            env: { ...process.env, YTDL_DATA_DIR: datos, PYTHONPATH: path.resolve('test/e2e/fake_ytdlp') },
        }).toString();
        expect(salida).toContain("'nuevas': 1");

        // La app lo recoge con «Buscar novedades» y confirma la entrega
        await page.click('#plFollowCheck');
        await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(4, { timeout: 30_000 });
        await expect(page.locator('#playlistDetailList')).toContainText('Tono dos');
        await expect.poll(async () => {
            seguidas = await (await request.get('/api/follows', { headers: cabeceras })).json();
            return seguidas.listas[0].nuevas.length;
        }).toBe(0);

        // Dejar de seguir la quita también del servidor
        await page.click('#plFollowStop');
        await page.click('#confirmYesBtn');
        await expect(page.locator('#plFollowBar')).toBeHidden({ timeout: 10_000 });
        seguidas = await (await request.get('/api/follows', { headers: cabeceras })).json();
        expect(seguidas.listas).toEqual([]);
    } finally {
        fs.rmSync(LISTA_EXTRA, { force: true });
    }
});

test('40 · recargar a mitad de una descarga no la pierde; una que el servidor ya no tiene se avisa', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    // En cuanto está apuntada, se «cierra» la app
    await expect.poll(async () => (await pendientes(page)).length, { timeout: 10_000 }).toBe(1);
    await page.reload();

    await irA(page, 'libraryView');
    await expect(page.locator('#libraryList .library-item', { hasText: 'Tema Oficial' })).toHaveCount(1, { timeout: 30_000 });
    await expect.poll(async () => (await pendientes(page)).length, { timeout: 10_000 }).toBe(0);

    // Una descarga que el servidor ya no tiene (se reinició, pasó un día…)
    await page.evaluate(() => new Promise((ok) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const tx = r.result.transaction('kv_store', 'readwrite');
            tx.objectStore('kv_store').put([{ downloadId: 'f'.repeat(32), tipo: 'cancion', url: 'x', info: { title: 'Canción perdida' }, total: 1, creada: Date.now(), intentos: 0 }], 'descargas_pendientes');
            tx.oncomplete = ok;
        };
    }));
    await page.reload();
    await expect(page.getByText('No se pudo recuperar la descarga de «Canción perdida»')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await pendientes(page)).length).toBe(0);
});

// ============================================================
// 41 · Mix de YouTube (list=RD…)
// ============================================================

test('41 · un Mix abre el selector sin repetidas ni «Seguir», se descarga una canción, y la descarga directa se corta en 35', async ({ page, request }) => {
    const mix = 'https://www.youtube.com/watch?v=aaaaaaaaaaa&list=RDaaaaaaaaaaa';
    await abrirApp(page);
    await pedir(page, mix);

    // El simulado repite canciones, como YouTube a veces: en las 35 primeras hay 6 distintas
    await expect(page.locator('#playlistSelector')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#playlistList .selector-fila')).toHaveCount(6);
    await expect(page.locator('#playlistCount')).toHaveText('6');
    // Una Mix cambia en cada visita: no se puede seguir
    await expect(page.locator('#followPlaylistBtn')).toBeHidden();

    // Se elige una y se descarga como cualquier canción, con su propio enlace
    // Con todas marcadas, el botón del selector las desmarca (plan 23, D5)
    await page.locator('#playlistList .selector-todo').click();
    await expect(page.locator('#selectedCount')).toHaveText('0');
    await page.locator('#playlistList .selector-fila', { hasText: 'Tono uno' }).click();
    await expect(page.locator('#selectedCount')).toHaveText('1');
    await page.click('#downloadSelectedBtn');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await expect(page.locator('#libraryList')).toContainText('Tono uno');

    // Pedida entera a la descarga directa, se queda en 35 (el simulado tiene 70)
    const res = await request.post('/api/start-download', { data: { url: mix } });
    expect(res.ok()).toBe(true);
    expect((await res.json()).total).toBe(35);
});

// ============================================================
// 42-45 · Descargas en lote (plan 20)
// ============================================================

/** Abre el selector con la lista de siempre más lo que se pida (lista_extra.json). */
async function abrirListaCon(page, extra = []) {
    if (extra.length) fs.writeFileSync(LISTA_EXTRA, JSON.stringify(extra));
    else fs.rmSync(LISTA_EXTRA, { force: true });
    await pedir(page, 'https://www.youtube.com/playlist?list=PLe2eLotes01234567');
    await expect(page.locator('#playlistSelector')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#playlistList .selector-fila')).toHaveCount(3 + extra.length);
}

const LENTAS = [1, 2, 3, 4, 5, 6].map((i) => ({ id: `lentolento${i}`, title: `Lenta ${i}`, channel: 'Canal Lento', duration: 60 }));
const FALLA = { id: 'fallafalla1', title: 'Cancion que falla', channel: 'Canal Roto', duration: 60 };

test('42 · una lista en el ordenador entra en la biblioteca canción a canción, con un solo aviso «N de M»', async ({ page }) => {
    await abrirApp(page);
    try {
        await abrirListaCon(page, LENTAS.slice(0, 3));
        const peticiones = [];
        page.on('request', (r) => { if (r.url().includes('/api/start-download') || r.url().includes('/api/start-batch-download')) peticiones.push(r.url()); });
        await page.click('#downloadSelectedBtn');

        // Un solo aviso para las 6, con el nombre de la lista y el recuento
        const aviso = page.locator('.dl-banner', { hasText: 'Lista E2E' });
        await expect(aviso).toBeVisible({ timeout: 10_000 });
        await expect(aviso.locator('.dl-banner-estado')).toHaveText(/^\d de 6$/);
        await expect(page.locator('.dl-banner')).toHaveCount(1);

        // Van entrando en la biblioteca antes de que acabe el lote
        await irA(page, 'libraryView');
        await expect.poll(async () => page.locator('#libraryList .library-item').count(), { timeout: 30_000 }).toBeGreaterThan(0);
        await esperarBiblioteca(page, 6);
        await expect(aviso.locator('.dl-banner-estado')).toHaveText('6 descargadas');
        // Con una sola petición al servidor: nada de una por canción ni del lote antiguo
        expect(peticiones).toEqual([]);
        // Cada canción, como una suelta: con su artista y su canción de YouTube
        await expect(page.locator('#libraryList')).toContainText('Tema Oficial');
    } finally {
        fs.rmSync(LISTA_EXTRA, { force: true });
    }
});

test('43 · un lote con una canción que falla lo dice, y «Reintentar» vuelve a pedir solo esa', async ({ page }) => {
    await abrirApp(page);
    try {
        await abrirListaCon(page, [FALLA]);
        await page.click('#downloadSelectedBtn');
        const aviso = page.locator('.dl-banner', { hasText: 'Lista E2E' });
        await expect(aviso.locator('.dl-banner-estado')).toHaveText('3 de 4 · 1 no se pudieron', { timeout: 30_000 });
        await irA(page, 'libraryView');
        await esperarBiblioteca(page, 3);

        // Con fallos, el aviso se queda hasta que se cierra; «Reintentar» lanza otro lote solo con la que falló
        await page.waitForTimeout(4000);
        await expect(aviso).toBeVisible();
        const lotes = [];
        page.on('request', (r) => { if (r.url().endsWith('/api/lotes') && r.method() === 'POST') lotes.push(r.postDataJSON()); });
        await aviso.locator('.dl-reintentar').click();
        await expect.poll(() => lotes.length).toBe(1);
        expect(lotes[0].canciones.map((c) => c.url)).toEqual(['https://www.youtube.com/watch?v=fallafalla1']);
        // El aviso anterior sale (con su animación) y queda solo el del reintento
        await expect(page.locator('.dl-banner', { hasText: 'de 4' })).toHaveCount(0, { timeout: 5_000 });
        const otra = page.locator('.dl-banner', { hasText: 'Lista E2E' });
        await expect(otra.locator('.dl-banner-estado')).toHaveText('0 de 1 · 1 no se pudieron', { timeout: 30_000 });
        // La X lo cierra
        await otra.locator('.dl-cancelar').click();
        await expect(page.locator('.dl-banner')).toHaveCount(0, { timeout: 5_000 });
    } finally {
        fs.rmSync(LISTA_EXTRA, { force: true });
    }
});

test('44 · recargar a mitad de un lote recoge lo que terminó mientras tanto y sigue con el resto', async ({ page }) => {
    await abrirApp(page);
    try {
        await abrirListaCon(page, LENTAS);
        await page.click('#downloadSelectedBtn');
        // En cuanto hay alguna recogida y aún faltan, se «cierra» la app
        await expect.poll(async () => {
            const p = (await pendientes(page)).find((x) => x.tipo === 'lote');
            return p ? p.recogidas.length : -1;
        }, { timeout: 30_000 }).toBeGreaterThan(0);
        const antes = (await pendientes(page)).find((x) => x.tipo === 'lote');
        expect(antes.recogidas.length).toBeLessThan(9);
        await page.reload();

        await irA(page, 'libraryView');
        await esperarBiblioteca(page, 9);
        await expect.poll(async () => (await pendientes(page)).length, { timeout: 15_000 }).toBe(0);
        // Ninguna repetida
        const titulos = await page.locator('#libraryList .library-item .library-item-title').allTextContents();
        expect(new Set(titulos).size).toBe(9);
    } finally {
        fs.rmSync(LISTA_EXTRA, { force: true });
    }
});

test('45 · «Descargar como ZIP» baja los ficheros sin tocar la biblioteca', async ({ page }) => {
    await abrirApp(page);
    fs.rmSync(LISTA_EXTRA, { force: true });
    await abrirListaCon(page);
    await expect(page.locator('#downloadZipBtn')).toBeVisible();
    const descarga = page.waitForEvent('download', { timeout: 30_000 });
    await page.click('#downloadZipBtn');
    const zip = await descarga;
    expect(zip.suggestedFilename()).toBe('Lista E2E.zip');
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryList .library-item')).toHaveCount(0);
});

// ============================================================
// 70-79 · Rendimiento (plan 19)
// ============================================================

test('70 · filas ligeras: sin la canción serializada, y un toque cuenta una sola vez aunque la lista se repinte', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await irA(page, 'homeView');
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);

    // La fila solo lleva su src: nada de la canción entera en el HTML
    await expect(page.locator('#libraryList [data-song]')).toHaveCount(0);

    const corazon = () => page.locator('#libraryList .library-item', { hasText: 'Cancion de prueba 1' }).locator('.lib-fav-btn');
    for (const esperado of [true, false, true]) {
        // Cada vuelta repinta la lista (ir y volver): con escuchadores repetidos, un toque contaría dos veces
        await irA(page, 'homeView');
        await irA(page, 'libraryView');
        await corazon().click();
        if (esperado) await expect(corazon()).toHaveClass(/active/);
        else await expect(corazon()).not.toHaveClass(/active/);
    }

    // Tocar una fila la reproduce, también tras repintar
    await page.locator('#libraryList .library-item', { hasText: 'Tema Oficial' }).locator('.library-item-info').click();
    await expect(page.locator('#playerTitle')).toHaveText('Tema Oficial', { timeout: 15_000 });
});

// 75-79 · Arranque y carga (plan 19, T10-T12)

test('75 · las fuentes salen de la app, sin Google, y cada icono se ve como icono', async ({ page }) => {
    const deGoogle = [];
    // Las de la app; Roboto la pide el botón de Google Sign-In, que no es nuestro
    page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com\/.*(inter|jakarta|material)/i.test(r.url())) deGoogle.push(r.url()); });
    await abrirApp(page);

    for (const vista of ['homeView', 'libraryView', 'playlistsView']) {
        await irA(page, vista);
        await page.evaluate(() => document.fonts.ready);
        // Un icono que no está en la fuente recortada se ve como su nombre en
        // letras («library_music»): el texto ocupa varias veces su alto
        const iconos = await page.$$eval('.material-symbols-outlined', (els) => els
            .filter((el) => el.offsetParent && el.textContent.trim())
            .map((el) => {
                const rango = document.createRange();
                rango.selectNodeContents(el);
                return { nombre: el.textContent.trim(), ancho: rango.getBoundingClientRect().width, alto: parseFloat(getComputedStyle(el).fontSize) };
            }));
        expect(iconos.length, `sin iconos a la vista en ${vista}`).toBeGreaterThan(0);
        expect(iconos.filter((i) => i.ancho > i.alto * 1.5).map((i) => i.nombre), `iconos sin glifo en ${vista}`).toEqual([]);
    }
    expect(deGoogle).toEqual([]);
});

test('76 · lo que se carga aparte responde al primer toque, y cada idioma se descarga solo si se usa', async ({ page }) => {
    const idiomas = [];
    page.on('request', (r) => { const m = r.url().match(/\/assets\/(en|fr|de|pt|zh)-[\w-]+\.js$/); if (m) idiomas.push(m[1]); });
    // Importar listas tarda en llegar: el toque llega antes que su código
    await page.route(/\/assets\/import-[\w-]+\.js$/, async (ruta) => {
        await new Promise((ok) => setTimeout(ok, 1_500));
        await ruta.continue();
    });
    await abrirApp(page);
    await irA(page, 'playlistsView');
    await page.locator('#importPlaylistBtn').click();
    await expect(page.locator('#importSheet')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#importSheet')).toBeHidden();

    await irA(page, 'libraryView');
    await page.locator('#libraryDataBtn').click();
    await expect(page.locator('#dataSheet')).toBeVisible();
    await page.keyboard.press('Escape');

    // En castellano no se ha pedido ningún otro idioma
    expect(idiomas).toEqual([]);

    // Elegir inglés lo descarga y lo aplica entero; al recargar ya arranca en inglés
    await page.locator('.lang-toggle-el:visible').first().click();
    await page.locator('.lang-option[data-lang="en"]:visible').first().click();
    await expect(page.locator('.nav-btn[data-view="libraryView"]:visible').first()).toContainText('Library');
    expect(idiomas).toEqual(['en']);
    await page.reload();
    await expect(page.locator('.nav-btn[data-view="libraryView"]:visible').first()).toContainText('Library');
});

test('77 · la sonoridad de lo ya descargado se mide en un Worker, igual que en el servidor, y las migraciones no se repiten', async ({ page }) => {
    // La medición de fondo empieza 15 s después de arrancar
    test.setTimeout(90_000);
    const leerCancion = () => page.evaluate(() => new Promise((ok) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const g = r.result.transaction('kv_store').objectStore('kv_store').get('ytdl_library');
            g.onsuccess = () => ok((g.result || []).find((s) => s.title === 'Tono fuerte'));
        };
    }));

    await abrirApp(page);
    await descargarTodos(page, ['fffffffffff']);
    const delServidor = (await leerCancion()).loudness;
    expect(delServidor.fuente).toBe('servidor');
    // Tras el primer arranque, las migraciones quedan apuntadas (plan 19, T12)
    expect(await page.evaluate(() => localStorage.getItem('ytdl_migraciones_hechas_v1'))).toBe('1');

    // Como una canción de antes de que el servidor midiera: sin medida
    await page.evaluate(() => new Promise((ok) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const tx = r.result.transaction('kv_store', 'readwrite');
            const almacen = tx.objectStore('kv_store');
            const g = almacen.get('ytdl_library');
            g.onsuccess = () => almacen.put(g.result.map(({ loudness, ...s }) => s), 'ytdl_library');
            tx.oncomplete = ok;
        };
    }));
    const trabajadores = [];
    page.on('worker', (w) => trabajadores.push(w.url()));
    await page.reload();
    await expect(page.locator('#libraryCount')).toContainText('1');

    await expect.poll(async () => (await leerCancion()).loudness?.fuente, { timeout: 45_000 }).toBe('cliente');
    const delCliente = (await leerCancion()).loudness;
    expect(Math.abs(delCliente.lufs - delServidor.lufs)).toBeLessThan(1);
    expect(trabajadores.some((url) => /loudness-worker/.test(url))).toBe(true);
});

test('78 · un corazón no repinta la lista: las demás filas son los mismos nodos', async ({ page }) => {
    await abrirApp(page);
    await descargarTodos(page, ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ddddddddddd']);

    // Cada fila, marcada: si la lista se repinta entera, las marcas desaparecen
    await page.evaluate(() => document.querySelectorAll('#libraryList .library-item').forEach((fila, i) => { fila.__marca = i + 1; }));
    const fila = page.locator('#libraryList .library-item', { hasText: 'Tono uno' });
    await fila.locator('.lib-fav-btn').click();
    await expect(fila.locator('.lib-fav-btn')).toHaveClass(/active/);

    const marcas = await page.evaluate(() => [...document.querySelectorAll('#libraryList .library-item')]
        .map((f) => ({ marca: f.__marca ?? null, tono: /Tono uno/.test(f.textContent) })));
    expect(marcas).toHaveLength(3);
    // La fila tocada puede cambiar su corazón o rehacerse; las otras, ni tocarlas
    expect(marcas.filter((m) => !m.tono).every((m) => m.marca !== null), JSON.stringify(marcas)).toBe(true);
});

// ============================================================
// 80-89 · Modo radio (plan 16)
// ============================================================
//
// La semilla (`semillaradi`) dura 4 s: la cola de una canción se acaba
// enseguida. Su mezcla simulada trae doce parecidas de 20 s de audio y una
// versión «(Lyrics)» repetida de la primera (test/e2e/fake_ytdlp).

const PARECIDA = /Parecida \d+/;

/** Enciende «Radio al acabar la cola» en Ajustes. */
async function encenderRadio(page) {
    await abrirAjustes(page);
    await page.locator('label:has(#pbRadio)').click();
    await expect(page.locator('#pbRadio')).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ajustesSheet')).toBeHidden();
}

/** Biblioteca con solo la semilla, la radio encendida y la semilla sonando. */
async function empezarRadio(page) {
    await abrirApp(page);
    await descargarTodos(page, ['semillaradi']);
    await encenderRadio(page);
    await page.locator('#libraryList .library-item', { hasText: 'Empieza la radio' }).click();
    await expect(page.locator('#playerTitle')).toContainText('Empieza la radio', { timeout: 15_000 });
}

/** La hoja de la cola, desde la pantalla completa. */
async function abrirCola(page) {
    await abrirReproductor(page);
    await page.click('#fullPlayerQueue');
    await expect(page.locator('#playbackQueueSheet')).not.toHaveClass(/hidden/);
}

const titulo = async (page) => (await page.locator('#playerTitle').textContent()).trim();

/** Siguiente canción. Con la hoja de la cola abierta encima, el botón queda tapado: se pulsa sin puntero. */
const saltar = (page) => page.evaluate(() => document.getElementById('fullPlayerNext').click());

test('81 · con la radio, al acabar la cola suena una de la mezcla; «Guardar» la lleva a la biblioteca al momento, sin volver a bajarla', async ({ page }) => {
    test.setTimeout(120_000);
    await empezarRadio(page);

    // Acaba la semilla y sigue la primera de la mezcla (la semilla no se repite)
    await expect(page.locator('#playerTitle')).toHaveText(PARECIDA, { timeout: 60_000 });
    const suena = await titulo(page);
    expect(suena).toContain('Parecida 1');
    expect(await page.evaluate(() => document.getElementById('mainAudio').paused)).toBe(false);

    await abrirCola(page);
    await expect(page.locator('#pqRadioSection')).toBeVisible();
    await expect(page.locator('#pqNowPlaying')).toContainText(suena);

    // Guardar no la vuelve a bajar: el audio ya está en el dispositivo. Las
    // demás de la radio siguen bajando por detrás; ninguna petición pide esta
    const deEsta = [];
    page.on('request', (r) => {
        if (/\/api\/(start-download|lotes)/.test(r.url()) && (r.postData() ?? '').includes('parecida001')) deEsta.push(r.url());
    });
    await page.locator('#pqNowPlaying [data-radio-guardar]').click();
    await expect(page.getByText('Guardada en tu biblioteca')).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(deEsta).toEqual([]);

    await page.keyboard.press('Escape');
    await page.click('#fullPlayerClose');
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryList .library-item', { hasText: 'Parecida 1' })).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#libraryCount')).toContainText('2');
});

test('82 · «No me gusta» salta la canción y no vuelve a salir, ni en otra versión', async ({ page }) => {
    test.setTimeout(120_000);
    await empezarRadio(page);
    await expect(page.locator('#playerTitle')).toHaveText(PARECIDA, { timeout: 60_000 });
    const vetada = await titulo(page);

    await abrirCola(page);
    await page.locator('#pqNowPlaying [data-radio-vetar]').click();
    await expect.poll(() => titulo(page), { timeout: 20_000 }).not.toBe(vetada);

    // Ni en lo que viene ni al seguir saltando: la vetada (y su versión con letra) no vuelven
    // Título exacto: desde que la radio separa artista y título (plan 22),
    // «Parecida 1» también es el principio de «Parecida 10», «11» y «12»
    const esVetada = new RegExp(`${vetada}(?!\\d)`);
    const vistas = [];
    for (let i = 0; i < 4; i++) {
        const antes = await titulo(page);
        vistas.push(antes);
        await expect(page.locator('#pqRadioList')).not.toContainText(esVetada);
        await saltar(page);
        await expect.poll(() => titulo(page), { timeout: 20_000 }).not.toBe(antes);
    }
    vistas.push(await titulo(page));
    expect(vistas.filter((t) => esVetada.test(t) || /Lyrics/.test(t)), vistas.join(' · ')).toEqual([]);
});

test('83 · saltando deprisa, la radio prepara más y nunca se queda en silencio sin avisar', async ({ page }) => {
    test.setTimeout(150_000);
    await empezarRadio(page);
    await expect(page.locator('#playerTitle')).toHaveText(PARECIDA, { timeout: 60_000 });
    await abrirCola(page);

    // Tres saltos seguidos, cada uno a los pocos segundos: la ventana crece a 6
    for (let i = 0; i < 3; i++) {
        const antes = await titulo(page);
        await saltar(page);
        // O suena otra, o se ve que se está preparando: nunca un silencio mudo
        await expect.poll(async () => {
            const ahora = await titulo(page);
            const sonando = await page.evaluate(() => !document.getElementById('mainAudio').paused);
            const avisa = await page.getByText('Preparando la radio…').isVisible();
            return (ahora !== antes && sonando) || avisa;
        }, { timeout: 30_000 }).toBe(true);
        await expect(page.locator('#playerTitle')).toHaveText(PARECIDA, { timeout: 60_000 });
    }

    // Con la ventana de 6: más de las 3 de siempre listas o en camino
    await expect.poll(async () => {
        const listas = await page.locator('#pqRadioList .pq-item').count();
        const enCamino = Number((await page.locator('#pqRadioEstado').textContent()).match(/\d+/)?.[0] ?? 0);
        return listas + enCamino;
    }, { timeout: 30_000 }).toBeGreaterThan(3);
});

test('84 · sin conexión, al acabar la cola la radio avisa y para', async ({ page, context }) => {
    test.setTimeout(90_000);
    await abrirApp(page);
    await descargarTodos(page, ['semillaradi']);
    await encenderRadio(page);

    await context.setOffline(true);
    await page.locator('#libraryList .library-item', { hasText: 'Empieza la radio' }).click();
    await expect(page.locator('#playerTitle')).toContainText('Empieza la radio', { timeout: 15_000 });

    await expect(page.getByText('La radio necesita conexión')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => document.getElementById('mainAudio').paused), { timeout: 10_000 }).toBe(true);
    await expect(page.locator('#playerTitle')).toContainText('Empieza la radio');
    await context.setOffline(false);
});

// ============================================================
// 85-89 · Publicación (plan 21)
// ============================================================

test('85 · sin «repetir», la cola se vacía: lo escuchado no vuelve como siguiente y en la última no vuelve a la primera', async ({ page }) => {
    await abrirApp(page);
    // De 20 s: ninguna acaba sola mientras se mira la cola (los tonos duran 6)
    await descargarTodos(page, ['parecida001', 'parecida002', 'parecida003']);
    await page.locator('#libraryList .library-item').first().click();
    await expect(page.locator('#playerTitle')).not.toHaveText('', { timeout: 15_000 });
    const primera = await titulo(page);

    await abrirCola(page);
    await expect(page.locator('#pqQueueList .pq-item')).toHaveCount(2);

    // Al pasar, la escuchada sale de la cola y no vuelve como «siguiente»
    await saltar(page);
    await expect.poll(() => titulo(page)).not.toBe(primera);
    await expect(page.locator('#pqQueueList .pq-item')).toHaveCount(1);
    await expect(page.locator('#pqQueueList')).not.toContainText(primera);

    // El reproductor ignora toques a menos de 400 ms (evita saltos dobles)
    await page.waitForTimeout(500);
    await saltar(page);
    await expect(page.locator('#pqQueueList .pq-item')).toHaveCount(0);
    const ultima = await titulo(page);

    // En la última, «siguiente» no vuelve a la primera: la cola se acaba
    await page.waitForTimeout(500);
    await saltar(page);
    await page.waitForTimeout(800);
    expect(await titulo(page)).toBe(ultima);

    // Con «repetir todo», sí da la vuelta: las otras dos vuelven a ser «siguientes»
    await page.locator('#pqRepeatBtn').click();
    await expect(page.locator('#pqQueueList .pq-item')).toHaveCount(2);
});

test('86 · con la radio, la que suena no queda como «siguiente» y siempre hay al menos 3 listas', async ({ page }) => {
    test.setTimeout(120_000);
    await empezarRadio(page);
    await expect(page.locator('#playerTitle')).toHaveText(PARECIDA, { timeout: 60_000 });

    await abrirCola(page);
    // La semilla ya sonó: no vuelve como «siguiente»
    await expect(page.locator('#pqQueueList')).not.toContainText('Empieza la radio');
    await expect.poll(() => page.locator('#pqRadioList .pq-item').count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);

    // Al saltar, la primera de la radio pasa a sonar y la ventana se rellena
    const antes = await titulo(page);
    await saltar(page);
    await expect.poll(() => titulo(page), { timeout: 20_000 }).not.toBe(antes);
    await expect(page.locator('#pqQueueList')).not.toContainText(antes);
    await expect.poll(() => page.locator('#pqRadioList .pq-item').count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
});

test('87 · la canción de la radio se ve como tal en el reproductor y se guarda desde ahí, al momento', async ({ page }) => {
    test.setTimeout(120_000);
    await empezarRadio(page);
    // La semilla es de la biblioteca: sin marca ni botón
    await expect(page.locator('#playerBarRadioSave')).toBeHidden();
    await expect(page.locator('#playerTitle')).toHaveText(PARECIDA, { timeout: 60_000 });
    const suena = await titulo(page);

    // En el mini reproductor: la marca «Radio» y el botón de guardar
    await expect(page.locator('#playerBar .radio-marca')).toBeVisible();
    await expect(page.locator('#playerBarRadioSave')).toBeVisible();

    // En la pantalla completa, «Guardar» sin abrir la cola y sin volver a bajarla
    await abrirReproductor(page);
    await expect(page.locator('#fullPlayer .radio-marca')).toBeVisible();
    const deEsta = [];
    page.on('request', (r) => {
        if (/\/api\/(start-download|lotes)/.test(r.url()) && (r.postData() ?? '').includes('parecida001')) deEsta.push(r.url());
    });
    await page.locator('#fullPlayerRadioSave').click();
    await expect(page.getByText('Guardada en tu biblioteca')).toBeVisible();
    // Ya es de la biblioteca: la marca y el botón desaparecen
    await expect(page.locator('#fullPlayerRadioSave')).toBeHidden();
    await expect(page.locator('#fullPlayer .radio-marca')).toBeHidden();
    await expect(page.locator('#playerBarRadioSave')).toBeHidden();
    expect(deEsta).toEqual([]);

    await page.click('#fullPlayerClose');
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryCount')).toContainText('2');
    await expect(page.locator('#libraryList')).toContainText(suena.replace(/^.* - /, ''));
});

/** ¿Recibe el toque? Lo que hay en el centro del elemento es él (o algo suyo), no otra hoja encima. */
const recibeElToque = (locator) => locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === arriba || el.contains(arriba);
});

test.describe('89 · desde Ajustes', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('89 · «Cerrar sesión» y «Continuar con Google» salen encima de Ajustes y reciben el toque', async ({ page }) => {
        await abrirApp(page);
        await iniciarSesionDePrueba(page, 'pila-de-hojas@e2e.test');
        await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });

        // La confirmación de cerrar sesión va antes en el HTML que Ajustes: salía detrás
        await abrirAjustes(page);
        await page.locator('#ajustesLogoutBtn').click();
        const si = page.locator('#logoutConfirmYesBtn');
        await expect(si).toBeVisible();
        await page.waitForTimeout(400);
        expect(await recibeElToque(si)).toBe(true);
        await si.click();
        await expect.poll(() => page.evaluate(() => localStorage.getItem('auth_token'))).toBeNull();

        // Ajustes sigue abierta, ya sin sesión: «Continuar con Google» abre el
        // inicio de sesión, también encima
        await expect(page.locator('#ajustesSheet')).toBeVisible();
        await page.locator('#ajustesLoginBtn').click();
        const cerrar = page.locator('#authModal .auth-modal-close');
        await expect(cerrar).toBeVisible();
        await page.waitForTimeout(400);
        expect(await recibeElToque(cerrar)).toBe(true);
        await cerrar.click();
        await expect(page.locator('#authModal')).toBeHidden();
        // Al cerrarlo, Ajustes sigue ahí, y otra vez arriba
        await expect(page.locator('#ajustesSheet')).toBeVisible();
        expect(await recibeElToque(page.locator('#ajustesLoginBtn'))).toBe(true);
    });
});

test('88 · el botón ⋮ abre «Opciones de la canción»: añadir a una lista, compartir, abrir en YouTube e ir al artista', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await abrirApp(page);
    await descargarTodos(page, ['aaaaaaaaaaa']);
    await page.locator('#libraryList .library-item').first().click();
    await expect(page.locator('#playerBar')).toBeVisible({ timeout: 15_000 });
    await abrirReproductor(page);

    const abrirOpciones = async () => {
        await page.click('#fullPlayerMore');
        await expect(page.locator('#songOptionsSheet')).toBeVisible();
    };
    await abrirOpciones();
    const hoja = page.locator('#songOptionsSheet');
    await expect(hoja.locator('#songOptionsName')).toContainText('Cancion de prueba 1');
    // Una de la biblioteca, de YouTube: todo menos «Guardar» (eso es para las de la radio)
    for (const id of ['#optAddToPlaylist', '#optArtist', '#optShare', '#optYoutube']) await expect(hoja.locator(id)).toBeVisible();
    await expect(hoja.locator('#optRadioSave')).toBeHidden();
    // Sus iconos están en la fuente recortada (T10 del plan 19): se ven como iconos, no como palabras
    const anchos = await hoja.locator('.opciones-accion:visible .material-symbols-outlined').evaluateAll((els) => els.map((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getBoundingClientRect().width / parseFloat(getComputedStyle(el).fontSize);
    }));
    expect(anchos.length).toBe(4);
    expect(anchos.every((a) => a < 1.5), JSON.stringify(anchos)).toBe(true);

    // Abrir en YouTube: el enlace de esa canción, fuera de la app
    await expect(hoja.locator('#optYoutube')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await expect(hoja.locator('#optYoutube')).toHaveAttribute('target', '_blank');

    // Compartir: sin la hoja del sistema, copia el enlace
    await page.evaluate(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
    await hoja.locator('#optShare').click();
    await expect(page.getByText('Enlace copiado')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await expect(hoja).toBeHidden();

    // Añadir a una lista: la hoja de siempre, encima de todo
    await abrirOpciones();
    await hoja.locator('#optAddToPlaylist').click();
    await expect(hoja).toBeHidden();
    await expect(page.locator('#addToPlaylistModal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#addToPlaylistModal')).toBeHidden();

    // Ir al artista: cierra la pantalla completa y abre su vista
    await abrirOpciones();
    await hoja.locator('#optArtist').click();
    await expect(page.locator('#fullPlayer')).toHaveClass(/fp-hidden/);
    await expect(page.locator('#artistDetailView')).toBeVisible();
    await expect(page.locator('#artistDetailName')).toHaveText('Canal E2E');
    await expect(page.locator('#artistDetailList .library-item')).toHaveCount(1);
});

test('90 · «Borrar mi cuenta» en Ajustes: pide confirmación, borra la cuenta del servidor y cierra la sesión', async ({ page, request }) => {
    await abrirApp(page);
    const usuario = await iniciarSesionDePrueba(page, 'borrar-cuenta@e2e.test');
    await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect((await request.get('/api/sync', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);

    await abrirAjustes(page);
    // La política, enlazada; el botón, solo con sesión
    await expect(page.locator('#ajustesPrivacidad')).toHaveAttribute('href', /\/privacidad$/);
    const borrar = page.locator('#ajustesBorrarBtn');
    await expect(borrar).toBeVisible();

    // Cancelar no borra nada
    await borrar.click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.locator('#confirmNoBtn').click();
    await expect(page.locator('#confirmModal')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('auth_token'))).toBe(token);

    // Confirmar: la cuenta se va del servidor y la sesión se cierra
    await borrar.click();
    await expect(page.locator('#confirmYesBtn')).toBeVisible();
    await page.locator('#confirmYesBtn').click();
    await expect(page.getByText('Cuenta borrada')).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('auth_token'))).toBeNull();
    await expect(page.locator('#ajustesLoginBtn')).toBeVisible();
    await expect(borrar).toBeHidden();
    expect((await request.get('/api/sync', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
    expect(usuario.id).toBeGreaterThan(0);

    // Y la página de la política existe
    const politica = await request.get('/privacidad');
    expect(politica.status()).toBe(200);
    expect(await politica.text()).toMatch(/\/assets\/privacidad-[\w-]+\.js/);
});

test('91 · si YouTube limita al servidor o está lleno, la app lo dice claro, en su idioma', async ({ page }) => {
    await abrirApp(page);
    // La búsqueda: YouTube pide confirmar que no es un robot
    await page.route('**/api/search', (r) => r.fulfill({
        status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'YouTube está limitando las descargas. Prueba en un rato.', code: 'youtube_limit' }),
    }));
    await pedir(page, 'una canción cualquiera');
    await expect(page.locator('#statusMessage')).toContainText('YouTube está limitando las descargas');

    // La descarga: el servidor ha llegado a su tope de la hora
    await page.route('**/api/start-download', (r) => r.fulfill({
        status: 429, contentType: 'application/json',
        body: JSON.stringify({ error: 'texto del servidor', code: 'server_busy' }),
    }));
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await expect(page.locator('#statusMessage')).toContainText('Hay muchas descargas en marcha');

    // En inglés, el mismo aviso traducido (no el texto en castellano del servidor)
    await page.locator('.lang-toggle-el:visible').first().click();
    await page.locator('.lang-option[data-lang="en"]:visible').first().click();
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    await expect(page.locator('#statusMessage')).toContainText('There are a lot of downloads going on');
});

test('92 · si YouTube limita al servidor, la radio lo dice y para, en vez de quedarse callada', async ({ page }) => {
    test.setTimeout(90_000);
    await abrirApp(page);
    await descargarTodos(page, ['semillaradi']);
    await encenderRadio(page);
    let pedidas = 0;
    await page.route('**/api/radio?**', (r) => {
        pedidas++;
        return r.fulfill({
            status: 503, contentType: 'application/json',
            body: JSON.stringify({ error: 'texto del servidor', code: 'youtube_limit' }),
        });
    });

    await page.locator('#libraryList .library-item', { hasText: 'Empieza la radio' }).click();
    await expect(page.locator('#playerTitle')).toContainText('Empieza la radio', { timeout: 15_000 });

    await expect(page.getByText('YouTube está limitando las descargas')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => document.getElementById('mainAudio').paused), { timeout: 10_000 }).toBe(true);
    // Durante la pausa no insiste: una sola petición de mezcla
    expect(pedidas).toBe(1);
});

// ============================================================
// 93-97 · Letras (plan 22)
// ============================================================

/**
 * Un LRCLIB simulado que responde según lo que se le pregunta. `responder`
 * recibe los parámetros de la búsqueda y devuelve { status, body } o la lista
 * de resultados. Devuelve las consultas recibidas, para comprobarlas.
 */
async function lrclibFalso(page, responder) {
    const consultas = [];
    await page.route('**/lrclib.net/api/search**', (r) => {
        const params = Object.fromEntries(new URL(r.request().url()).searchParams);
        consultas.push(params);
        const respuesta = responder(params, consultas.length);
        const { status = 200, body = respuesta } = Array.isArray(respuesta) ? {} : respuesta;
        return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    return consultas;
}

const lrcDe = (texto) => Array.from({ length: 6 }, (_, i) => `[00:0${i}.00] ${texto} ${i + 1}`).join('\n');
const cancionUno = (extra) => ({ trackName: 'Cancion de prueba 1', artistName: 'Canal E2E', duration: 180, plainLyrics: '', ...extra });

async function verLetra(page) {
    await abrirReproductor(page);
    await page.click('#lyricsToggle');
}

test('93 · entre varias versiones de la misma canción, la letra es la de la duración del audio', async ({ page }) => {
    await lrclibFalso(page, () => [
        cancionUno({ duration: 120, syncedLyrics: lrcDe('Versión corta') }),
        cancionUno({ duration: 300, syncedLyrics: lrcDe('Versión larga') }),
        cancionUno({ duration: 181, syncedLyrics: lrcDe('Versión buena') }),
        { trackName: 'Otra cancion', artistName: 'Otro grupo', duration: 180, syncedLyrics: lrcDe('De otra canción') },
    ]);
    await sonando(page);
    await verLetra(page);
    await expect(page.locator('#lyricsSection .lyrics-line').first()).toHaveText('Versión buena 1', { timeout: 10_000 });
    await expect(page.locator('#lyricsSection .lyrics-line')).toHaveCount(6);
});

test('94 · si LRCLIB está ocupado, se reintenta solo y la letra llega', async ({ page }) => {
    const consultas = await lrclibFalso(page, (_, n) => (n === 1
        ? { status: 503, body: { message: 'The server is busy, please retry in a moment' } }
        : [cancionUno({ syncedLyrics: lrcDe('Tras reintentar') })]));
    await sonando(page);
    await verLetra(page);
    await expect(page.locator('#lyricsSection .lyrics-line').first()).toHaveText('Tras reintentar 1', { timeout: 10_000 });
    expect(consultas.length).toBe(2);
});

test('95 · si LRCLIB no responde, lo dice (no «no hay letra») y lo intenta otra vez al volver a la letra', async ({ page }) => {
    test.setTimeout(60_000);
    let caido = true;
    await lrclibFalso(page, () => (caido ? { status: 503, body: {} } : [cancionUno({ syncedLyrics: lrcDe('Ya responde') })]));
    await sonando(page);
    await verLetra(page);
    // Una consulta y dos reintentos (1,5 s y 4 s): luego, el aviso
    await expect(page.getByText('No se ha podido buscar la letra')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No hemos encontrado la letra')).toHaveCount(0);

    caido = false;
    await page.click('#lyricsBackBtn');
    await page.waitForTimeout(800);
    await page.click('#lyricsToggle');
    await expect(page.locator('#lyricsSection .lyrics-line').first()).toHaveText('Ya responde 1', { timeout: 10_000 });
});

test('96 · al cambiar el artista en el editor, se busca la letra con el nombre nuevo', async ({ page }) => {
    const consultas = await lrclibFalso(page, (p) => {
        const artista = p.artist_name ?? '';
        if (artista === 'Mi Grupo') return [cancionUno({ artistName: 'Mi Grupo', syncedLyrics: lrcDe('Letra nueva') })];
        if (artista === 'Canal E2E') return [cancionUno({ syncedLyrics: lrcDe('Letra vieja') })];
        return [];
    });
    await sonando(page);
    await verLetra(page);
    await expect(page.locator('#lyricsSection .lyrics-line').first()).toHaveText('Letra vieja 1', { timeout: 10_000 });

    await page.click('#lyricsBackBtn');
    await page.click('#fullPlayerEdit');
    await page.fill('#editSongArtist', 'Mi Grupo');
    await page.click('#editSongSave');
    await page.click('#lyricsToggle');
    await expect(page.locator('#lyricsSection .lyrics-line').first()).toHaveText('Letra nueva 1', { timeout: 10_000 });
    expect(consultas.some((c) => c.artist_name === 'Mi Grupo')).toBe(true);
});

test('97 · una canción de la radio con el artista en el título: se ve separada y su letra aparece', async ({ page }) => {
    test.setTimeout(90_000);
    // La mezcla de la radio llega como «Grupo N - Parecida N», sin artista ni título aparte
    await lrclibFalso(page, (p) => {
        const titulo = p.track_name ?? '', artista = p.artist_name ?? '';
        const n = titulo.match(/^Parecida (\d+)$/)?.[1];
        return n && artista === `Grupo ${n}`
            ? [{ trackName: titulo, artistName: artista, duration: 200 + Number(n), plainLyrics: '', syncedLyrics: lrcDe(`Letra de la parecida ${n}`) }]
            : [];
    });
    await empezarRadio(page);
    await page.evaluate(() => { const a = document.getElementById('mainAudio'); a.currentTime = Math.max(0, a.duration - 0.2); });
    await expect(page.locator('#playerTitle')).toHaveText(/^Parecida \d+$/, { timeout: 45_000 });
    await expect(page.locator('#playerArtist')).toHaveText(/^Grupo \d+$/);
    await verLetra(page);
    await expect(page.locator('#lyricsSection .lyrics-line').first()).toHaveText(/^Letra de la parecida \d+ 1$/, { timeout: 10_000 });
});

test.describe('46 · el lote en el móvil', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('46 · la isla dice «N de M» y, desplegada, enseña lo que se está bajando', async ({ page }) => {
        await abrirApp(page);
        try {
            await abrirListaCon(page, LENTAS);
            await page.click('#downloadSelectedBtn');
            const isla = page.locator('.dl-island');
            await expect(isla.locator('.dl-island-titulo')).toHaveText('Lista E2E', { timeout: 10_000 });
            await expect(isla.locator('.dl-island-estado')).toHaveText(/^\d de 9$/);
            // Desplegada: el lote y, debajo, las canciones en curso (hasta 3)
            await isla.locator('.dl-island-resumen').click();
            await expect.poll(async () => isla.locator('.dl-fila-sub').count(), { timeout: 10_000 }).toBeGreaterThan(0);
            expect(await isla.locator('.dl-fila-sub').count()).toBeLessThanOrEqual(3);
            await expect(isla.locator('.dl-island-estado')).toHaveText('9 descargadas', { timeout: 60_000 });
        } finally {
            fs.rmSync(LISTA_EXTRA, { force: true });
        }
    });
});

test('47 · importar en la web: el fichero que bajó la app sustituye a su versión en la nube, también en la lista; el resto entra como importado', async ({ page, request }) => {
    const email = `importa-${Date.now()}@e2e.test`;
    const { id: userId } = usuarioDePrueba(email);
    const auth = { Authorization: `Bearer ${tokenDe(userId)}` };
    // La cuenta ya tiene la canción (de otro dispositivo), dentro de una lista
    await request.post('/api/sync', { headers: auth, data: { dispositivo: 'ordenador-0047', cambios: [
        { tipo: 'cancion', accion: 'poner', datos: { videoId: 'aaaaaaaaaaa', title: 'Cancion de prueba 1', channel: 'Canal E2E' } },
        { tipo: 'lista', accion: 'poner', datos: { id: '1700000000047', name: 'Importadas', description: '', songs: ['aaaaaaaaaaa'] } },
    ] } });

    await abrirApp(page);
    await iniciarSesionDePrueba(page, email);
    await irA(page, 'libraryView');
    const fila = page.locator('#libraryList .library-item', { hasText: 'Cancion de prueba 1' });
    await expect(fila).toHaveClass(/library-item-nube/, { timeout: 20_000 });

    // Sin el aviso de «exclusiva de la App Nativa»: se importa
    let alerta = null;
    page.on('dialog', (d) => { alerta = d.message(); d.dismiss(); });
    await page.setInputFiles('#importAudioInput', ['test/e2e/ficheros/con-enlace.m4a', 'test/e2e/ficheros/sin-enlace.mp3']);
    await expect(page.locator('#libraryList .library-item')).toHaveCount(2, { timeout: 20_000 });
    await expect(fila).not.toHaveClass(/library-item-nube/, { timeout: 10_000 });
    await expect(page.locator('#libraryList')).toContainText('Grabacion casera');
    expect(alerta).toBeNull();

    // En la lista, también con su audio
    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Importadas' }).click();
    await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(0);

    // Suena, y lo importado sigue ahí al recargar
    await irA(page, 'libraryView');
    await page.locator('#libraryList .library-item', { hasText: 'Grabacion casera' }).click();
    await expect(page.locator('#playerTitle')).toHaveText('Grabacion casera', { timeout: 10_000 });
    await page.reload();
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryList .library-item')).toHaveCount(2);

    // Importarlo otra vez no lo duplica: se salta y se dice
    await page.setInputFiles('#importAudioInput', ['test/e2e/ficheros/con-enlace.m4a']);
    await expect(page.getByText('1 ya estaban en tu biblioteca')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#libraryList .library-item')).toHaveCount(2);
});

test('79 · el reproductor de YouTube de la vista previa no se carga al arrancar: al haber resultados, y un toque mientras carga suena al estar listo', async ({ page }) => {
    // Una API de YouTube falsa, que tarda en llegar: sin red de verdad y con tiempo para tocar antes
    const pedidas = [];
    let soltar;
    const llega = new Promise((ok) => { soltar = ok; });
    await page.route('https://www.youtube.com/iframe_api', async (r) => {
        pedidas.push(r.request().url());
        await llega;
        await r.fulfill({
            contentType: 'text/javascript',
            body: `window.__yt = { videos: [] };
                window.YT = { Player: class {
                    constructor(id, o) { setTimeout(() => o.events.onReady({ target: this }), 50); }
                    loadVideoById(v) { window.__yt.videos.push(v); }
                    unMute() {} setVolume() {} playVideo() {} stopVideo() {}
                } };
                window.onYouTubeIframeAPIReady();`,
        });
    });
    await abrirApp(page);
    await page.waitForTimeout(1500);
    expect(pedidas, 'se pidió la API de YouTube al arrancar').toHaveLength(0);

    await pedir(page, 'cancion de prueba');
    await expect(page.locator('#searchResults .result-item').first()).toBeVisible({ timeout: 30_000 });
    // Con resultados, se pide en reposo
    await expect.poll(() => pedidas.length).toBe(1);

    // Tocar la vista previa mientras llega: avisa de que carga y suena en cuanto está
    const boton = page.locator('#searchResults .result-item .preview-btn').first();
    const id = await boton.getAttribute('data-video-id');
    await boton.click();
    soltar();
    await expect.poll(() => page.evaluate(() => window.__yt?.videos ?? [])).toEqual([id]);
    await expect(boton).toHaveClass(/playing/);
    expect(pedidas).toHaveLength(1);
});

test('48 · en el ordenador, soltar ficheros sobre la Biblioteca los importa', async ({ page }) => {
    await abrirApp(page);
    await irA(page, 'libraryView');
    const bytes = [...fs.readFileSync('test/e2e/ficheros/sin-enlace.mp3')];
    const datos = await page.evaluateHandle((b) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(b)], 'sin-enlace.mp3', { type: 'audio/mpeg' }));
        return dt;
    }, bytes);
    const vista = page.locator('#libraryView');
    await vista.dispatchEvent('dragenter', { dataTransfer: datos });
    await expect(vista).toHaveClass(/soltando/);
    await expect(vista).toHaveAttribute('data-soltar', 'Suelta los ficheros para importarlos');
    await vista.dispatchEvent('drop', { dataTransfer: datos });
    await expect(vista).not.toHaveClass(/soltando/);
    await expect(page.locator('#libraryList .library-item', { hasText: 'Grabacion casera' })).toHaveCount(1, { timeout: 15_000 });
});

test.describe('en el móvil', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('80 · «Ajustes» reúne la cuenta, la reproducción y la versión de la app, con las novedades de cada una', async ({ page }) => {
        await abrirApp(page);
        await page.locator('#navProfile').click();
        const hoja = page.locator('#ajustesSheet');
        await expect(hoja).toBeVisible();

        // Sin sesión, la cuenta ofrece entrar con Google
        await expect(page.locator('#ajustesLoginBtn')).toBeVisible();
        await expect(page.locator('#ajustesConSesion')).toBeHidden();
        // La reproducción está aquí, y ya no ocupa sitio en la pantalla completa
        await expect(hoja.locator('#pbFundido')).toBeVisible();
        await expect(page.locator('#fullPlayerSettings')).toHaveCount(0);

        // En la web: la última versión de la app Android, para descargarla, y
        // las novedades de todas las publicadas
        const version = await page.request.get('/api/app/version').then((r) => r.json());
        await expect(page.locator('#ajustesVersionEstado')).toContainText(version.versionName);
        await expect(page.locator('#ajustesDescargarBtn')).toBeVisible();
        await expect(page.locator('#ajustesActualizarBtn')).toBeHidden();
        await page.locator('#ajustesHistorial summary').click();
        const conNovedades = version.historial.filter((v) => (v.novedades?.es ?? []).length).length;
        await expect(page.locator('#ajustesVersiones .actualizacion-version')).toHaveCount(conNovedades);
        await expect(page.locator('#ajustesVersiones h4').first()).toContainText(version.versionName);

        // «Continuar con Google» abre el inicio de sesión encima; al cerrarlo, siguen los ajustes
        await page.locator('#ajustesLoginBtn').click();
        await expect(page.locator('#authModal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#authModal')).toBeHidden();
        await expect(hoja).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(hoja).toBeHidden();
    });

    test('11 · el reproductor se cierra arrastrándolo hacia abajo', async ({ page, context }) => {
        await sonando(page);
        await abrirReproductor(page);

        const cdp = await context.newCDPSession(page);
        const toque = (type, y) => cdp.send('Input.dispatchTouchEvent', {
            type, touchPoints: type === 'touchEnd' ? [] : [{ x: 195, y }],
        });

        // Poco y despacio: vuelve a su sitio
        await toque('touchStart', 300);
        for (let i = 1; i <= 6; i++) { await toque('touchMove', 300 + i * 10); await page.waitForTimeout(40); }
        await toque('touchEnd');
        await page.waitForTimeout(800);
        await expect(page.locator('#fullPlayer'), 'un arrastre corto lo cerró').not.toHaveClass(/fp-hidden/);

        // Un tirón rápido: se cierra
        await toque('touchStart', 300);
        for (let i = 1; i <= 5; i++) await toque('touchMove', 300 + i * 40);
        await toque('touchEnd');
        await expect(page.locator('#fullPlayer'), 'el tirón no lo cerró').toHaveClass(/fp-hidden/, { timeout: 3_000 });
    });

    test('37 · nada se desplaza de lado en el móvil, en ningún idioma, ni con los botones de la APK', async ({ browser }) => {
        test.setTimeout(120_000);
        for (const locale of ['es-ES', 'en-US', 'fr-FR', 'de-DE', 'pt-PT', 'zh-CN']) {
            const contexto = await browser.newContext({ locale, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
            const page = await contexto.newPage();
            await page.goto('/');
            await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });
            // Lo peor que puede tocar: el botón que solo sale en la APK y una cuenta enorme
            await page.evaluate(() => {
                document.getElementById('syncLibraryBtn')?.classList.remove('hidden');
                document.getElementById('libraryCount').textContent = '12.345 canciones';
            });
            for (const vista of ['homeView', 'libraryView', 'playlistsView']) {
                await page.locator(`.nav-btn[data-view="${vista}"]:visible`).first().click();
                await page.waitForTimeout(350);
                // El desplazamiento no se ve en la página: ocurre dentro de .main-content,
                // el contenedor con scroll de la app. Se mira la vista y cualquier
                // contenedor que se pueda desplazar de lado
                const desborde = await page.evaluate((id) => {
                    const v = document.getElementById(id);
                    return {
                        pagina: document.documentElement.scrollWidth - innerWidth,
                        vista: v.scrollWidth - v.clientWidth,
                        desplazables: [...document.querySelectorAll('*')]
                            .filter((e) => e.scrollWidth > e.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX))
                            .map((e) => `${e.id || e.className} (+${e.scrollWidth - e.clientWidth})`),
                    };
                }, vista);
                expect(desborde.pagina, `${locale} ${vista}: la página se desplaza de lado`).toBeLessThanOrEqual(0);
                expect(desborde.vista, `${locale} ${vista}: la vista se sale por la derecha`).toBeLessThanOrEqual(0);
                expect(desborde.desplazables, `${locale} ${vista}: se puede desplazar de lado`).toEqual([]);
            }
            await contexto.close();
        }
    });

    test('16 · «Añadir a playlist» es una hoja anclada abajo y Escape la cierra', async ({ page }) => {
        await abrirApp(page);
        await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
        await irA(page, 'libraryView');
        await esperarBiblioteca(page, 1);

        await page.locator('#libraryList .lib-add-playlist-btn').first().tap();
        const hoja = page.locator('#addToPlaylistModal .auth-modal-content');
        await expect(hoja).toBeVisible();
        await expect.poll(async () => Math.round((await hoja.boundingBox()).y + (await hoja.boundingBox()).height),
            { message: 'la hoja no está anclada abajo', timeout: 3_000 }).toBe(844);
        expect((await hoja.boundingBox()).width).toBe(390);

        await page.keyboard.press('Escape');
        await expect(page.locator('#addToPlaylistModal')).toHaveClass(/hidden/);
    });
});

// ============================================================
// 50 · Tu año en música (plan 17)
// ============================================================

/**
 * Mete escuchas en el registro de IndexedDB, como si se hubieran ido contando a
 * lo largo del año (plan 11, T5). Una cada tres días desde el 15 de enero, en
 * hora local: así caen dentro del año en curso en cualquier huso.
 */
async function inyectarEscuchas(page, cuantas = 30) {
    await page.evaluate(async (n) => {
        const CANCIONES = [
            ['aaaaaaaaaaa', 'Rosalia', 'Malamente'],
            ['bbbbbbbbbbb', 'Rosalia', 'Saoko'],
            ['ccccccccccc', 'Kase.O', 'Mazas'],
            ['ddddddddddd', 'Nathy Peluso', 'Mafiosa'],
        ];
        const anio = new Date().getFullYear();
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('YTMusicDB');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('escuchas', 'readwrite');
        const store = tx.objectStore('escuchas');
        for (let i = 0; i < n; i++) {
            const [videoId, artista, cancion] = CANCIONES[i % CANCIONES.length];
            store.add({
                clave: videoId, videoId, artista, cancion,
                t: new Date(anio, 0, 15 + i * 3, 21, 30).getTime(),   // de noche, para la franja
                segundos: 200,
            });
        }
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }, cuantas);
}

/** Abre «Tu año hasta ahora» desde la hoja de «Tus datos». */
async function abrirResumen(page) {
    await irA(page, 'libraryView');
    await page.locator('#libraryDataBtn').click();
    await expect(page.locator('#dataSheet')).not.toHaveClass(/hidden/);
    await page.locator('#wrappedOpenBtn').click();
    await expect(page.locator('#wrappedView')).not.toHaveClass(/hidden/, { timeout: 15_000 });
}

/** Ancho y alto de un PNG, leídos de su cabecera IHDR. */
function medidasPng(ruta) {
    const b = fs.readFileSync(ruta);
    expect(b.subarray(1, 4).toString('latin1'), 'no es un PNG').toBe('PNG');
    return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
}

test('50 · con escuchas del año, «Tu año hasta ahora» cuenta la historia, avanza a toques y guarda un PNG de 1080×1920', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await abrirApp(page);
    await inyectarEscuchas(page, 30);

    // Recargar para que el resumen lea el registro recién metido
    await page.reload();
    await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });

    await abrirResumen(page);

    // Primera diapositiva: los minutos. 30 escuchas de 200 s son 100 minutos.
    const escenario = page.locator('#wrappedStage');
    await expect(escenario.locator('[data-slide="minutos"]')).toBeVisible({ timeout: 15_000 });
    await expect(escenario.locator('.wrapped-value')).toHaveText('100', { timeout: 10_000 });

    // Hay una barra de progreso por diapositiva
    const barras = page.locator('#wrappedBars .wrapped-bar');
    const total = await barras.count();
    expect(total, 'deberían salir varias diapositivas').toBeGreaterThanOrEqual(4);

    // Un toque a la derecha avanza; uno a la izquierda vuelve
    const avanzar = () => page.locator('#wrappedNext').click({ position: { x: 20, y: 300 } });
    await avanzar();
    await expect(escenario.locator('[data-slide="minutos"]')).toHaveCount(0);
    await expect(escenario.locator('[data-slide="artista"]')).toBeVisible();
    await expect(escenario).toContainText('Rosalia');

    await page.locator('#wrappedPrev').click({ position: { x: 20, y: 300 } });
    await expect(escenario.locator('[data-slide="minutos"]')).toBeVisible();

    // La franja de la noche es la que gana: todas las escuchas son a las 21:30
    await avanzar();
    for (let i = 0; i < total; i++) {
        if (await escenario.locator('[data-slide="horas"]').count()) break;
        await avanzar();
    }
    await expect(escenario.locator('.wrapped-band.is-top')).toHaveCount(1);

    // Hasta el final: ahí aparece «Guardar imagen» y la historia no se cierra sola
    for (let i = 0; i < total + 2; i++) {
        if (await escenario.locator('[data-slide="final"]').count()) break;
        await avanzar();
    }
    await expect(escenario.locator('[data-slide="final"]')).toBeVisible();
    await expect(page.locator('#wrappedView')).not.toHaveClass(/hidden/);

    const guardar = page.locator('#wrappedSave');
    await expect(guardar).toBeVisible();

    const descarga = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        guardar.click(),
    ]).then(([d]) => d);

    expect(descarga.suggestedFilename()).toMatch(/^music-downloader-\d{4}\.png$/);
    const destino = path.join(testInfo.outputDir, descarga.suggestedFilename());
    await descarga.saveAs(destino);
    expect(medidasPng(destino)).toEqual({ ancho: 1080, alto: 1920 });

    // Y se cierra con Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('#wrappedView')).toHaveClass(/hidden/);
});

test('51 · sin bastante música, el resumen lo dice en vez de enseñar una historia vacía', async ({ page }) => {
    await abrirApp(page);
    await inyectarEscuchas(page, 3);
    await page.reload();
    await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });

    await abrirResumen(page);
    await expect(page.locator('#wrappedStage .wrapped-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#wrappedBars .wrapped-bar')).toHaveCount(0);
    await expect(page.locator('#wrappedSave')).toBeHidden();
});

// ============================================================
// 60 · Importar listas de otros servicios (plan 15)
// ============================================================

/**
 * Tres canciones como las exporta Exportify. El yt_dlp simulado devuelve sus
 * tres vídeos para cualquier búsqueda, así que el reparto lo decide la
 * puntuación:
 *   - «Cancion de prueba 1» de «Canal E2E» → aaaaaaaaaaa, segura
 *   - «Tema Oficial» de «Artista Oficial» → bbbbbbbbbbb (YouTube trae artista y canción), segura
 *   - «Cancion de prueba 1» de «Nadie», con otra duración → también aaaaaaaaaaa,
 *     pero dudosa: el artista no aparece y la duración no cuadra. Como repite
 *     el vídeo de la primera, sin cambiarla la lista tendría solo dos canciones.
 */
const CSV_IMPORTAR = [
    '"Track URI","Track Name","Artist Name(s)","Album Name","Duration (ms)","ISRC"',
    '"spotify:track:1","Cancion de prueba 1","Canal E2E","Disco","180000",""',
    '"spotify:track:2","Tema Oficial","Artista Oficial","Disco","210000",""',
    '"spotify:track:3","Cancion de prueba 1","Nadie","Otro disco","190000",""',
].join('\n');

/** Abre la hoja «Importar lista» desde Listas. */
async function abrirImportar(page) {
    await irA(page, 'playlistsView');
    await page.locator('#importPlaylistBtn').click();
    await expect(page.locator('#importSheet')).not.toHaveClass(/hidden/);
}

test('60 · importar un CSV: la dudosa sale primero, al cambiarla deja de repetirse y la lista se crea con las 3 descargadas', async ({ page }) => {
    test.setTimeout(120_000);
    await abrirApp(page);

    // Lo que viaja al servidor: solo título, artista, duración e ISRC (plan 15, §3)
    const enviados = [];
    page.on('request', (r) => {
        if (r.url().endsWith('/api/import/match') && r.method() === 'POST') enviados.push(r.postDataJSON());
    });

    await abrirImportar(page);
    await page.setInputFiles('#importFile', {
        name: 'Mis_favoritas.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_IMPORTAR, 'utf8'),
    });
    await expect(page.locator('#importPreview')).toContainText('3');
    await page.click('#importSearchBtn');

    // La revisión, con la dudosa arriba
    const filas = page.locator('#importReviewList .import-row');
    await expect(filas).toHaveCount(3, { timeout: 30_000 });
    await expect(filas.first()).toHaveClass(/is-dudosa/);
    await expect(filas.first()).toContainText('Nadie');

    // El nombre sale del fichero y el botón cuenta vídeos, no filas: dos de las tres son el mismo
    await expect(page.locator('#importListName')).toHaveValue('Mis favoritas');
    await expect(page.locator('#importCreateBtn')).toContainText('2');
    await expect(page.locator('#importReviewSummary')).toContainText('1');

    // Cambiarla por la candidata que queda libre
    await filas.first().locator('[data-accion="cambiar"]').click();
    await filas.first().locator('[data-accion="elegir"][data-id="ccccccccccc"]').click();
    await expect(filas.first()).toHaveClass(/is-manual/);
    await expect(page.locator('#importCreateBtn')).toContainText('3');

    await page.click('#importCreateBtn');
    await expect(page.locator('#importSheet')).toHaveClass(/hidden/);

    // La lista está desde el principio y sus canciones dejan la nube al descargarse
    await page.locator('.playlist-card', { hasText: 'Mis favoritas' }).click();
    await expect(page.locator('#playlistDetailName')).toHaveText('Mis favoritas');
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(3);
    await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(0, { timeout: ESPERA_DESCARGA });

    // Y están en la biblioteca, cada una una vez
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 3);

    expect(enviados).toHaveLength(1);
    for (const c of enviados[0].canciones) {
        expect(Object.keys(c).sort()).toEqual(['artista', 'duracionMs', 'isrc', 'titulo']);
    }
});

test('61 · importar texto pegado: quitar una canción la deja fuera de la lista, y lo que ya estaba no se descarga otra vez', async ({ page }) => {
    test.setTimeout(120_000);
    await abrirApp(page);

    // Una de las dos ya está en la biblioteca
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);

    await abrirImportar(page);
    await page.click('#importTabText');
    await page.fill('#importText', '1. Canal E2E - Cancion de prueba 1\n2. Artista Oficial - Tema Oficial\n3. Grupo Tres - Cancion de prueba 3');
    await expect(page.locator('#importPreview')).toContainText('3');
    await page.click('#importSearchBtn');

    const filas = page.locator('#importReviewList .import-row');
    await expect(filas).toHaveCount(3, { timeout: 30_000 });

    // Quitar «Tema Oficial»: deshacer y volver a quitar, para comprobar las dos cosas
    const tema = filas.filter({ hasText: 'Tema Oficial' });
    await tema.locator('[data-accion="quitar"]').click();
    await expect(filas.filter({ hasText: 'Tema Oficial' })).toHaveClass(/is-removed/);
    await filas.filter({ hasText: 'Tema Oficial' }).locator('[data-accion="deshacer"]').click();
    await expect(filas.filter({ hasText: 'Tema Oficial' })).not.toHaveClass(/is-removed/);
    await filas.filter({ hasText: 'Tema Oficial' }).locator('[data-accion="quitar"]').click();
    await expect(page.locator('#importCreateBtn')).toContainText('2');

    await page.fill('#importListName', 'Pegada');
    await page.click('#importCreateBtn');
    await page.locator('.playlist-card', { hasText: 'Pegada' }).click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(2);
    await expect(page.locator('#playlistDetailList')).not.toContainText('Tema Oficial');
    await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(0, { timeout: ESPERA_DESCARGA });

    // Solo se ha descargado la que faltaba: en la biblioteca hay dos, no tres
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);
});

test('62 · un CSV sin columna de título lo dice y no busca nada; Escape cierra la hoja', async ({ page }) => {
    await abrirApp(page);
    let busquedas = 0;
    page.on('request', (r) => { if (r.url().includes('/api/import/match')) busquedas++; });

    await abrirImportar(page);
    await page.setInputFiles('#importFile', {
        name: 'raro.csv', mimeType: 'text/csv', buffer: Buffer.from('Foo,Bar\n1,2\n', 'utf8'),
    });
    await expect(page.locator('#importMessage')).toBeVisible();
    await expect(page.locator('#importMessage')).not.toBeEmpty();
    await expect(page.locator('#importSearchBtn')).toBeDisabled();
    expect(busquedas).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('#importSheet')).toHaveClass(/hidden/);
});

/**
 * La regla de las cabeceras es la de la Biblioteca (plan 13): en una pantalla
 * estrecha el título puede partirse en dos líneas, pero nada se sale. Medido
 * al añadir «Importar»: en castellano, inglés, francés y chino el título cabe
 * en una línea a 390 px; en portugués («As minhas playlists») a 360 px ya se
 * partía antes del botón. Así que se exige una línea donde la había y, en todos
 * los idiomas y anchos, que nada desborde.
 */
test('63 · en el móvil, la cabecera de Listas cabe con «Importar»: nada se sale y el título en castellano va en una línea', async ({ browser }) => {
    test.setTimeout(180_000);
    const UNA_LINEA = new Set(['es-ES', 'en-US', 'fr-FR', 'zh-CN']);
    for (const locale of ['es-ES', 'en-US', 'fr-FR', 'de-DE', 'pt-PT', 'zh-CN']) {
        for (const ancho of [390, 360]) {
            const contexto = await browser.newContext({ locale, viewport: { width: ancho, height: 844 }, isMobile: true, hasTouch: true });
            const page = await contexto.newPage();
            await page.goto('/');
            await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });
            await page.locator('.nav-btn[data-view="playlistsView"]:visible').first().click();
            await expect(page.locator('#importPlaylistBtn')).toBeVisible();

            const medida = await page.evaluate(() => {
                const titulo = document.querySelector('#playlistsView .view-title');
                const rango = document.createRange();
                rango.selectNodeContents(titulo);
                const cabecera = document.querySelector('#playlistsView .view-header');
                return {
                    // Una línea por cada «top» distinto de los rectángulos del texto
                    lineas: new Set([...rango.getClientRects()].map((r) => Math.round(r.top))).size,
                    desborde: Math.max(cabecera.scrollWidth - cabecera.clientWidth, document.documentElement.scrollWidth - innerWidth),
                    texto: titulo.textContent.trim(),
                };
            });
            expect(medida.desborde, `${locale} ${ancho}px: la cabecera se sale por la derecha`).toBeLessThanOrEqual(0);
            expect(medida.lineas, `${locale} ${ancho}px: «${medida.texto}» en ${medida.lineas} líneas`).toBeLessThanOrEqual(2);
            if (UNA_LINEA.has(locale)) {
                expect(medida.lineas, `${locale} ${ancho}px: «${medida.texto}» se parte en ${medida.lineas} líneas`).toBe(1);
            }
            await contexto.close();
        }
    }
});

test('101 · una letra con una marca por palabra («LRC mejorado») se lee entera, sin las marcas', async ({ page }) => {
    // Así llega «TU OLVIDO» de KAZE desde LRCLIB
    const lrc = '[00:00.00] <00:00.00>Y <00:00.20>es <00:00.46>que <00:00.62>tu <00:00.84>olvido\n[00:00.50] <00:00.50>me <00:00.70>visita';
    await lrclibFalso(page, () => [cancionUno({ syncedLyrics: lrc })]);
    await sonando(page);
    await verLetra(page);
    const lineas = page.locator('#lyricsSection .lyrics-line');
    await expect(lineas).toHaveCount(2, { timeout: 10_000 });
    await expect(lineas.first()).toHaveText('Y es que tu olvido');
    await expect(lineas.nth(1)).toHaveText('me visita');
});

test('99 · «Nueva playlist»: vacía o con canciones elegidas con el buscador, con su descripción y la portada en vivo', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);
    await irA(page, 'playlistsView');

    // Vacía: solo el nombre (plan 23: las canciones son opcionales)
    await page.click('#createPlaylistBtn');
    const ventana = page.locator('#createPlaylistModal');
    await expect(ventana).toBeVisible();
    await expect(page.locator('#savePlaylistBtn')).toBeDisabled();
    await expect(ventana.locator('.portada-vacia')).toBeVisible();
    await page.fill('#playlistNameInput', 'Para más tarde');
    await page.click('#savePlaylistBtn');
    await expect(ventana).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('.playlist-card', { hasText: 'Para más tarde' })).toBeVisible({ timeout: 10_000 });

    // Con canciones: el buscador filtra, el pie las cuenta y la portada se compone
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', 'Elegidas');
    await page.fill('#playlistDescInput', 'Con buscador');
    const filas = page.locator('#playlistCreateSongsList .selector-fila');
    await expect(filas).toHaveCount(2);
    await page.fill('#playlistCreateSongsList .selector-buscar-entrada', 'prueba 2');
    await expect(filas).toHaveCount(1);
    await filas.first().click();
    await expect(page.locator('#createPlaylistResumen')).toHaveText(/^1 seleccionada/);
    await expect(ventana.locator('.portada-mosaico img')).toHaveCount(1);
    // Con teclado: desde el buscador, flecha abajo y espacio
    await page.fill('#playlistCreateSongsList .selector-buscar-entrada', '');
    await page.focus('#playlistCreateSongsList .selector-buscar-entrada');
    await page.keyboard.press('ArrowDown');
    // Si la primera es la ya marcada, a la siguiente
    if (await page.locator('#playlistCreateSongsList .selector-fila.elegida:focus').count()) await page.keyboard.press('ArrowDown');
    await page.keyboard.press(' ');
    await expect(page.locator('#createPlaylistResumen')).toHaveText(/^2 seleccionadas/);
    await page.click('#savePlaylistBtn');
    await expect(ventana).toBeHidden({ timeout: 5_000 });

    await page.locator('.playlist-card', { hasText: 'Elegidas' }).click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(2, { timeout: 10_000 });
    await expect(page.locator('#playlistDetailDescription')).toHaveText('Con buscador');

    // Un nombre que ya existe: el aviso, dentro de la ventana y no en Inicio,
    // y se va al cambiar el nombre
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', 'elegidas');
    await page.click('#savePlaylistBtn');
    await expect(page.locator('#playlistNameError')).toBeVisible();
    await expect(page.locator('#playlistNameError')).toHaveText('Ya existe una playlist con ese nombre');
    await expect(ventana).toBeVisible();
    await page.fill('#playlistNameInput', 'Elegidas 2');
    await expect(page.locator('#playlistNameError')).toBeHidden();

    // Y lo mismo al crearla desde «Añadir a playlist»
    await page.keyboard.press('Escape');
    await irA(page, 'libraryView');
    await page.locator('#libraryList .library-item').first().locator('.lib-add-playlist-btn').click();
    await page.click('#addToPlaylistCreateNewBtn');
    await page.fill('#newPlaylistNameInput', 'Para más tarde');
    await page.click('#confirmCreateNewPlaylistBtn');
    await expect(page.locator('#newPlaylistNameError')).toHaveText('Ya existe una playlist con ese nombre');
});

test('98 · en una lista, lo descargado va primero y la nube después; la cabecera lo cuenta y sin canciones la lista se queda', async ({ page, request }) => {
    const email = `orden-${Date.now()}@e2e.test`;
    const { id: userId } = usuarioDePrueba(email);
    const auth = { Authorization: `Bearer ${tokenDe(userId)}` };
    // Guardada con la de la nube delante; la otra se descarga al importar su fichero
    await request.post('/api/sync', { headers: auth, data: { dispositivo: 'ordenador-0098', cambios: [
        { tipo: 'cancion', accion: 'poner', datos: { videoId: 'bbbbbbbbbbb', title: 'Solo en la nube', channel: 'Canal E2E' } },
        { tipo: 'cancion', accion: 'poner', datos: { videoId: 'aaaaaaaaaaa', title: 'Cancion de prueba 1', channel: 'Canal E2E' } },
        { tipo: 'lista', accion: 'poner', datos: { id: '1700000000098', name: 'Mezclada', description: '', songs: ['bbbbbbbbbbb', 'aaaaaaaaaaa'] } },
    ] } });

    await abrirApp(page);
    await iniciarSesionDePrueba(page, email);
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryList .library-item-nube')).toHaveCount(2, { timeout: 20_000 });
    await page.setInputFiles('#importAudioInput', ['test/e2e/ficheros/con-enlace.m4a']);
    await expect(page.locator('#libraryList .library-item-nube')).toHaveCount(1, { timeout: 20_000 });

    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Mezclada' }).click();
    const filas = page.locator('#playlistDetailList .library-item');
    await expect(filas).toHaveCount(2, { timeout: 10_000 });
    await expect(filas.nth(0)).not.toHaveClass(/library-item-nube/);
    await expect(filas.nth(0)).toContainText('Cancion de prueba 1');
    await expect(filas.nth(1)).toHaveClass(/library-item-nube/);
    await expect(page.locator('#playlistDetailCount')).toHaveText(/^2 canciones( · \d+ min)? · 1 en la nube$/);

    // Al quitarle todas, la lista se queda, vacía
    await page.click('#plActionReorder');
    for (let n = 2; n > 0; n--) {
        await filas.first().locator('.pl-remove-btn').click();
        await expect(filas).toHaveCount(n - 1);
    }
    await expect(page.locator('#playlistDetailCount')).toHaveText('0 canciones');
    await expect(page.locator('#playlistDetailName')).toHaveText('Mezclada');
    await irA(page, 'playlistsView');
    await expect(page.locator('.playlist-card', { hasText: 'Mezclada' })).toBeVisible();
});

test('100 · una lista de YouTube se elige con el selector común: el corazón no marca la fila y buscar no pierde la selección', async ({ page }) => {
    await abrirApp(page);
    await abrirListaCon(page);
    const filas = page.locator('#playlistList .selector-fila');
    await expect(page.locator('#playlistList .selector-fila.elegida')).toHaveCount(3);
    await expect(page.locator('#selectedCount')).toHaveText('3');

    // El corazón de la primera la hace favorita y la fila sigue marcada
    const primera = filas.first();
    const titulo = (await primera.locator('.selector-titulo').textContent()).trim();
    await primera.locator('.favorite-btn').click();
    await expect(primera.locator('.favorite-btn')).toHaveClass(/active/);
    await expect(primera).toHaveClass(/elegida/);
    await expect(page.locator('#selectedCount')).toHaveText('3');

    // Al buscar se ve solo esa, con su corazón; las demás siguen elegidas
    await page.locator('#playlistList .selector-buscar-entrada').fill(titulo);
    await expect(filas).toHaveCount(1);
    await expect(filas.first().locator('.favorite-btn')).toHaveClass(/active/);
    await page.locator('#playlistList .selector-buscar-entrada').fill('');
    await expect(filas).toHaveCount(3);
    await expect(page.locator('#selectedCount')).toHaveText('3');
});

test('102 · una canción de antes del plan 22, sin duración: la lista dice solo cuántas hasta que la duración se lee de su audio', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await page.locator('#libraryList .library-item').first().locator('.lib-add-playlist-btn').click();
    await page.locator('#addToPlaylistCreateNewBtn').click();
    await page.fill('#newPlaylistNameInput', 'De antes');
    await page.click('#confirmCreateNewPlaylistBtn');
    await expect(page.locator('#addToPlaylistModal')).toContainText('De antes', { timeout: 10_000 });
    await page.keyboard.press('Escape');

    // Como las guardaba la app antes del plan 22: sin duración en la biblioteca ni en la lista
    await page.evaluate(() => new Promise((ok) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const tx = r.result.transaction('kv_store', 'readwrite');
            const kv = tx.objectStore('kv_store');
            const sinDuracion = (s) => { const copia = { ...s }; delete copia.duration; return copia; };
            kv.get('ytdl_library').onsuccess = (e) => kv.put(e.target.result.map(sinDuracion), 'ytdl_library');
            kv.get('ytdl_playlists').onsuccess = (e) => kv.put(e.target.result.map((pl) => ({ ...pl, songs: pl.songs.map(sinDuracion) })), 'ytdl_playlists');
            tx.oncomplete = ok;
        };
    }));
    await page.reload();
    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'De antes' }).click();
    const cabecera = page.locator('#playlistDetailCount');
    await expect(cabecera).toHaveText('1 canción');

    // En segundo plano se lee de su audio, y la cabecera lo dice sin volver a abrirla
    await expect(cabecera).toHaveText(/^1 canción · \d+ min$/, { timeout: 45_000 });
});

test('103 · borrar una lista: la confirmación se cierra y no vuelve, y se queda en Playlists', async ({ page }) => {
    await abrirApp(page);
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', 'Para borrar');
    await page.click('#savePlaylistBtn');
    const tarjeta = page.locator('.playlist-card', { hasText: 'Para borrar' });
    await tarjeta.click();
    await expect(page.locator('#playlistDetailName')).toHaveText('Para borrar');

    await page.click('#plActionDelete');
    const confirmacion = page.locator('#playlistDeleteConfirmModal');
    await expect(confirmacion).toBeVisible();
    await page.click('#plDeleteConfirmYesBtn');
    await expect(confirmacion).toBeHidden();
    await expect(page.locator('#playlistsView')).toBeVisible();
    // Antes, el «atrás» de la confirmación llegaba tarde y la volvía a abrir
    await page.waitForTimeout(800);
    await expect(confirmacion).toBeHidden();
    await expect(page.locator('#playlistsView')).toBeVisible();
    await expect(tarjeta).toHaveCount(0);

    // Atrás desde Playlists va a Inicio, no al detalle de la lista borrada
    await page.goBack();
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(confirmacion).toBeHidden();

    // Con una entrada de más en el historial (una hoja que se cerró sin
    // gastar la suya), contar dos pasos atrás dejaba en el detalle de la lista
    // borrada, y parecía que había que borrarla varias veces
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', 'Otra para borrar');
    await page.click('#savePlaylistBtn');
    const otra = page.locator('.playlist-card', { hasText: 'Otra para borrar' });
    await otra.click();
    await expect(page.locator('#playlistDetailName')).toHaveText('Otra para borrar');
    await page.evaluate(() => history.pushState({ type: 'overlay', id: 'hojaYaCerrada' }, '', ''));
    await page.click('#plActionDelete');
    await page.click('#plDeleteConfirmYesBtn');
    await expect(page.locator('#playlistsView')).toBeVisible();
    await expect(page.locator('#playlistDetailView')).toBeHidden();
    await expect(otra).toHaveCount(0);
    // Y lo dice, desde cualquier vista
    await expect(page.locator('.aviso-flotante')).toHaveText('Playlist «Otra para borrar» eliminada');
});

test('104 · salir de una lista por las pestañas la olvida: editar luego una canción no vuelve a abrirla ni deja un detalle en el historial', async ({ page }) => {
    await sonando(page);
    await page.locator('#libraryList .library-item').first().locator('.lib-add-playlist-btn').click();
    await page.locator('#addToPlaylistCreateNewBtn').click();
    await page.fill('#newPlaylistNameInput', 'Abierta antes');
    await page.click('#confirmCreateNewPlaylistBtn');
    await expect(page.locator('#addToPlaylistModal')).toContainText('Abierta antes', { timeout: 10_000 });
    await page.keyboard.press('Escape');

    // Se abre la lista y se sale por la barra de pestañas, no por su flecha
    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Abierta antes' }).click();
    await expect(page.locator('#playlistDetailView')).toBeVisible();
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryView')).toBeVisible();

    // Editar lo que suena refresca la lista abierta… si la hay
    await abrirReproductor(page);
    await page.click('#fullPlayerEdit');
    await page.fill('#editSongArtist', 'Otro Grupo');
    await page.click('#editSongSave');
    await expect(page.locator('#editSongSheet')).toBeHidden({ timeout: 5_000 });
    await page.click('#fullPlayerClose');
    await expect(page.locator('#fullPlayer')).toHaveClass(/fp-hidden/);

    await expect(page.locator('#libraryView')).toBeVisible();
    await expect(page.locator('#playlistDetailView')).toBeHidden();
    expect(await page.evaluate(() => history.state?.view)).not.toBe('playlistDetailView');
});
