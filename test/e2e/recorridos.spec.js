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

/** Una acción del menú ⋮ de la lista abierta (plan 24, P2): Añadir, Editar, Ordenar, Compartir o Eliminar. */
async function menuDeLista(page, accion) {
    await page.click('#plMoreBtn');
    await expect(page.locator('#playlistMenuSheet')).toBeVisible();
    await page.click(accion);
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
    await menuDeLista(page, '#plActionEdit');
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
    await menuDeLista(page, '#plActionAdd');
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
    // En su menú ⋮ solo quedan Ordenar por (sin mover a mano) y Compartir (plan 24)
    await page.click('#plMoreBtn');
    await expect(page.locator('#plActionReorder')).toBeVisible();
    await expect(page.locator('#plActionShare')).toBeVisible();
    for (const id of ['#plActionAdd', '#plActionEdit', '#plActionSelect', '#plActionDelete']) {
        await expect(page.locator(id)).toBeHidden();
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#playlistMenuSheet')).toBeHidden();
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

test('34 · una lista y una canción de un dispositivo aparecen en el otro; la canción en la nube suena desde ahí y «Descargar las que faltan» la baja', async ({ browser, request }) => {
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

    // Tocarla la reproduce desde la nube (plan 29): sigue en la nube, con su marca
    await irA(ordenador, 'libraryView');
    await fila.click();
    await expect(ordenador.locator('#playerTitle')).toHaveText('Cancion de prueba 1', { timeout: 30_000 });
    await expect(ordenador.locator('#playerBar [data-radio-marca]')).toHaveText('Desde la nube');
    await expect(fila).toHaveClass(/library-item-nube/);
    // La primera vez que suena una desde la nube, la ventana «Tu música» (T5)
    await expect(ordenador.locator('#confirmModal')).toBeVisible({ timeout: 10_000 });
    await ordenador.click('#confirmYesBtn');
    // «Descargar las que faltan» la baja: deja de estar en la nube
    await ordenador.click('#libraryCloudBtn');
    await expect(fila).not.toHaveClass(/library-item-nube/, { timeout: 30_000 });
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

        // Su marca «Desde la nube» la descarga (plan 29: tocar la fila la reproduce
        // desde la nube), y la fila deja de estar en la nube
        const fila = page.locator('#playlistDetailList .library-item', { hasText: 'Cancion de prueba 1' });
        await expect(fila).toHaveClass(/library-item-nube/);
        await fila.locator('.nube-guardar').click();
        await expect(fila).not.toHaveClass(/library-item-nube/, { timeout: 30_000 });
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
    // La ventana «Tu música, de verdad tuya» (plan 29, T5) ya vista: la prueba el 164
    await page.evaluate(() => localStorage.setItem('nube_tuya_vista', '1'));
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
    await expect(page.getByText('Guardada: ya es tuya y suena sin conexión')).toBeVisible();
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
    await expect(page.getByText('Guardada: ya es tuya y suena sin conexión')).toBeVisible();
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
    // Sin canciones, la portada generada de la lista (plan 27), nunca vacía
    await expect(ventana.locator('.portada-mosaico--1 img')).toHaveAttribute('src', /^data:image\/svg\+xml|#gen=/);
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
    await menuDeLista(page, '#plActionReorder');
    await page.click('#plOrdenSheet [data-criterio="a-mano"]');
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

test('103 · borrar una lista: sin confirmación, se queda en Playlists, y atrás no vuelve a la lista borrada', async ({ page }) => {
    await abrirApp(page);
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', 'Para borrar');
    await page.click('#savePlaylistBtn');
    const tarjeta = page.locator('.playlist-card', { hasText: 'Para borrar' });
    await tarjeta.click();
    await expect(page.locator('#playlistDetailName')).toHaveText('Para borrar');

    // Sin ventana de confirmación (plan 24): se borra y el aviso deja deshacerlo
    await menuDeLista(page, '#plActionDelete');
    await expect(page.locator('#playlistsView')).toBeVisible();
    await expect(tarjeta).toHaveCount(0);
    const aviso = page.locator('.deshacer');
    await expect(aviso).toContainText('Para borrar');
    await expect(aviso).toContainText('Playlist eliminada');
    // La X lo da por hecho
    await aviso.locator('.deshacer-cerrar').click();
    await expect(aviso).toBeHidden();
    await expect(tarjeta).toHaveCount(0);

    // Atrás desde Playlists va a Inicio, no al detalle de la lista borrada
    await page.goBack();
    await expect(page.locator('#homeView')).toBeVisible();

    // Con una entrada de más en el historial (una hoja que se cerró sin
    // gastar la suya), contar dos pasos atrás dejaba en el detalle de la lista
    // borrada, y parecía que había que borrarla varias veces (plan 23)
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', 'Otra para borrar');
    await page.click('#savePlaylistBtn');
    const otra = page.locator('.playlist-card', { hasText: 'Otra para borrar' });
    await otra.click();
    await expect(page.locator('#playlistDetailName')).toHaveText('Otra para borrar');
    await page.evaluate(() => history.pushState({ type: 'overlay', id: 'hojaYaCerrada' }, '', ''));
    await menuDeLista(page, '#plActionDelete');
    await expect(page.locator('#playlistsView')).toBeVisible();
    await expect(page.locator('#playlistDetailView')).toBeHidden();
    await expect(otra).toHaveCount(0);
    await expect(aviso).toContainText('Otra para borrar');
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

// ============================================================
// 105-107 · Deshacer lo que se borra (plan 24, P9)
// ============================================================

/** Cuántos audios hay guardados en el navegador. */
const audiosGuardados = (page) => page.evaluate(() => new Promise((ok, mal) => {
    const req = indexedDB.open('YTMusicDB');
    req.onerror = () => mal(req.error);
    req.onsuccess = () => {
        const db = req.result;
        const cuenta = db.transaction('audio_blobs', 'readonly').objectStore('audio_blobs').count();
        cuenta.onsuccess = () => { ok(cuenta.result); db.close(); };
        cuenta.onerror = () => mal(cuenta.error);
    };
}));

test('105 · borrar de la biblioteca se deshace, y el audio solo se borra cuando el aviso acaba o la app se cierra', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);
    await expect.poll(() => audiosGuardados(page)).toBe(2);
    const filas = page.locator('#libraryList .library-item');
    const aviso = page.locator('.deshacer');

    // Sin preguntar: la fila se va, el aviso sale y el audio sigue ahí
    await filas.first().locator('.lib-del-btn').click();
    await expect(filas).toHaveCount(1);
    await expect(aviso).toContainText('Borrada de la biblioteca');
    expect(await audiosGuardados(page)).toBe(2);
    await expect(aviso.locator('.deshacer-boton')).toBeFocused();
    await aviso.locator('.deshacer-boton').click();
    await expect(aviso).toBeHidden();
    await expect(filas).toHaveCount(2);
    await page.waitForTimeout(500);
    expect(await audiosGuardados(page)).toBe(2);

    // Si se deja pasar, al acabar el aviso sí se borra el audio
    await filas.first().locator('.lib-del-btn').click();
    await expect(aviso).toBeVisible();
    await expect(aviso).toBeHidden({ timeout: 6_000 });
    await expect.poll(() => audiosGuardados(page)).toBe(1);
    await expect(filas).toHaveCount(1);

    // Y si la app pasa a segundo plano con el aviso a la vista, también
    await filas.first().locator('.lib-del-btn').click();
    await expect(aviso).toBeVisible();
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => audiosGuardados(page)).toBe(0);
});

test('106 · borrar una lista se deshace: vuelve a su sitio con sus canciones', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await irA(page, 'playlistsView');
    for (const nombre of ['Primera', 'Segunda']) {
        await page.click('#createPlaylistBtn');
        await page.fill('#playlistNameInput', nombre);
        if (nombre === 'Primera') await page.locator('#playlistCreateSongsList .selector-fila').first().click();
        await page.click('#savePlaylistBtn');
        await expect(page.locator('#createPlaylistModal')).toBeHidden();
    }
    const nombres = () => page.locator('#playlistsGrid .playlist-card').allInnerTexts();
    const antes = await nombres();

    await page.locator('.playlist-card', { hasText: 'Primera' }).click();
    await menuDeLista(page, '#plActionDelete');
    await expect(page.locator('#playlistsView')).toBeVisible();
    await expect(page.locator('.playlist-card', { hasText: 'Primera' })).toHaveCount(0);
    const aviso = page.locator('.deshacer');
    await expect(aviso).toContainText('Primera');
    await expect(aviso).toContainText('1 canción');
    await aviso.locator('.deshacer-boton').click();
    await expect(aviso).toBeHidden();
    await expect.poll(nombres).toEqual(antes);

    // Con sus canciones
    await page.locator('.playlist-card', { hasText: 'Primera' }).click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(1);
});

test('107 · quitar un favorito se deshace', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    const corazon = page.locator('#libraryList .library-item').first().locator('.lib-fav-btn');
    await corazon.click();
    await expect(corazon).toHaveClass(/active/);
    await page.waitForTimeout(500);   // el corazón ignora un segundo toque seguido
    await corazon.click();
    await expect(corazon).not.toHaveClass(/active/);
    const aviso = page.locator('.deshacer');
    await expect(aviso).toContainText('Quitada de favoritos');
    await aviso.locator('.deshacer-boton').click();
    await expect(corazon).toHaveClass(/active/);
    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Favoritos' }).click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(1);
});

// ============================================================
// 108-110 · Selección múltiple y gestos (plan 24, P8 y P10)
// ============================================================

/** Arrastra una fila de lado con el ratón (los gestos valen también con ratón). */
async function deslizarFila(page, fila, dx) {
    // Recién abierta la vista, la transición se queda con el puntero hasta que acaba
    await expect(fila).toBeVisible();
    await page.waitForFunction(() => !document.documentElement.dataset.navegacion);
    const caja = await fila.boundingBox();
    const x = caja.x + caja.width / 2, y = caja.y + caja.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + i * 0.3);
    await page.mouse.up();
}

test('108 · selección en la biblioteca: Cmd/Ctrl y Mayús + clic, a la cola y borrar varias con deshacer', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);
    const filas = page.locator('#libraryList .library-item');
    const barra = page.locator('.sel-barra');

    // Cmd/Ctrl + clic entra y marca, sin reproducir
    await filas.nth(0).click({ modifiers: ['ControlOrMeta'] });
    await expect(barra).toBeVisible();
    await expect(barra.locator('.sel-cuenta')).toHaveText('1 seleccionada');
    await expect(filas.nth(0)).toHaveClass(/seleccionada/);
    await expect(page.locator('#playerBar')).toBeHidden();
    // Mayús + clic marca el tramo
    await filas.nth(1).click({ modifiers: ['Shift'] });
    await expect(barra.locator('.sel-cuenta')).toHaveText('2 seleccionadas');
    // Un clic normal desmarca
    await filas.nth(1).click();
    await expect(barra.locator('.sel-cuenta')).toHaveText('1 seleccionada');
    await barra.locator('[data-accion="todo"]').click();
    await expect(barra.locator('.sel-cuenta')).toHaveText('2 seleccionadas');

    await barra.locator('[data-accion="cola"]').click();
    await expect(barra).toHaveCount(0);
    await expect(page.locator('.aviso-flotante')).toContainText('2 a la cola');
    await expect(filas.first()).not.toHaveClass(/seleccionada/);

    // Escape sale sin hacer nada
    await filas.nth(0).click({ modifiers: ['ControlOrMeta'] });
    await expect(barra).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(barra).toHaveCount(0);

    // Borrar varias, con deshacer
    await filas.nth(0).click({ modifiers: ['ControlOrMeta'] });
    await barra.locator('[data-accion="todo"]').click();
    await barra.locator('[data-accion="borrar"]').click();
    await expect(filas).toHaveCount(0);
    const aviso = page.locator('.deshacer');
    await expect(aviso).toContainText('2 canciones borradas de la biblioteca');
    await aviso.locator('.deshacer-boton').click();
    await expect(filas).toHaveCount(2);
    expect(await audiosGuardados(page)).toBe(2);
});

test('109 · selección en una lista: añadir las elegidas a otra lista y quitarlas con deshacer', async ({ page }) => {
    await listaConDos(page, 'Para elegir');
    const filas = page.locator('#playlistDetailList .library-item');
    const barra = page.locator('.sel-barra');
    await filas.nth(0).click({ modifiers: ['ControlOrMeta'] });
    await barra.locator('[data-accion="todo"]').click();
    await expect(barra.locator('.sel-cuenta')).toHaveText('2 seleccionadas');

    // Añadir a playlist: la ventana de siempre, con las dos
    await barra.locator('[data-accion="lista"]').click();
    const ventana = page.locator('#addToPlaylistModal');
    await expect(ventana).toBeVisible();
    await expect(page.locator('#addToPlaylistSongName')).toHaveText('2 canciones');
    await page.click('#addToPlaylistCreateNewBtn');
    await page.fill('#newPlaylistNameInput', 'Copia');
    await page.click('#confirmCreateNewPlaylistBtn');
    await expect(page.locator('.aviso-flotante')).toContainText('Copia');
    await page.click('#closeAddToPlaylistModal');
    await expect(ventana).toBeHidden();

    // La selección sigue: quitar las dos de esta lista, y deshacerlo
    await expect(barra.locator('.sel-cuenta')).toHaveText('2 seleccionadas');
    await barra.locator('[data-accion="quitar"]').click();
    await expect(filas).toHaveCount(0);
    const aviso = page.locator('.deshacer');
    await expect(aviso).toContainText('2 quitadas de «Para elegir»');
    await aviso.locator('.deshacer-boton').click();
    await expect(filas).toHaveCount(2);

    // La copia tiene las dos
    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Copia' }).click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(2);
});

test('110 · gestos: en una lista, a la izquierda quita con deshacer; en la biblioteca, a la izquierda no hace nada', async ({ page }) => {
    await listaConDos(page, 'Con gestos');
    const filas = page.locator('#playlistDetailList .library-item');
    await deslizarFila(page, filas.first(), -220);
    await expect(filas).toHaveCount(1);
    const aviso = page.locator('.deshacer');
    await expect(aviso).toContainText('Quitada de «Con gestos»');
    await aviso.locator('.deshacer-boton').click();
    await expect(filas).toHaveCount(2);
    // Un poco no basta: vuelve a su sitio y no se quita
    await deslizarFila(page, filas.first(), -40);
    await page.waitForTimeout(500);
    await expect(filas).toHaveCount(2);

    await irA(page, 'libraryView');
    const enBiblioteca = page.locator('#libraryList .library-item');
    await deslizarFila(page, enBiblioteca.first(), -220);
    await page.waitForTimeout(500);
    await expect(enBiblioteca).toHaveCount(2);
    await expect(aviso).toBeHidden();
    await expect(enBiblioteca.first().locator('.library-item-content')).not.toHaveAttribute('style', /translateX\(-/);
});

test('112 · en el móvil, una pulsación larga entra en la selección y el clic al soltar no la desmarca; moviendo el dedo, no', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    const fila = page.locator('#libraryList .library-item').first();
    await expect(fila).toBeVisible();
    await page.waitForFunction(() => !document.documentElement.dataset.navegacion);
    /** Un dedo sobre la fila: pulsa, espera, se mueve `dx` y suelta (con su clic). */
    const pulsar = (ms, dx = 0) => fila.evaluate(async (el, [ms, dx]) => {
        const r = el.querySelector('.library-item-info').getBoundingClientRect();
        const x = r.left + 10, y = r.top + r.height / 2;
        const ev = (tipo, cx) => new PointerEvent(tipo, { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: cx, clientY: y });
        el.querySelector('.library-item-info').dispatchEvent(ev('pointerdown', x));
        if (dx) document.dispatchEvent(ev('pointermove', x + dx));
        await new Promise((ok) => setTimeout(ok, ms));
        el.querySelector('.library-item-info').dispatchEvent(ev('pointerup', x + dx));
        el.querySelector('.library-item-info').click();
    }, [ms, dx]);

    // Moviendo el dedo es scroll o un gesto: ni selección ni reproducción a medias
    await pulsar(650, 30);
    await expect(page.locator('.sel-barra')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await pulsar(650);
    await expect(page.locator('.sel-barra')).toBeVisible();
    await expect(fila).toHaveClass(/seleccionada/);
    await expect(page.locator('.sel-cuenta')).toHaveText('1 seleccionada');
});

// ============================================================
// 111 · Ninguna hoja deja una entrada de más en el historial (plan 24, T6)
// ============================================================

test('111 · abrir y cerrar las hojas (con la X, el fondo o Escape) no deja entradas de más: atrás cambia de vista a la primera', async ({ page }) => {
    await abrirApp(page);
    await irA(page, 'libraryView');
    await irA(page, 'playlistsView');
    const estado = () => page.evaluate(() => history.state);
    const hojas = [
        { abrir: '#sidebarAjustesBtn', hoja: '#ajustesSheet', cerrar: '#ajustesClose' },
        { abrir: '#sidebarDataBtn', hoja: '#dataSheet', cerrar: '#dataSheetClose' },
        { abrir: '#sidebarShortcutsBtn', hoja: '#shortcutsSheet', cerrar: '#shortcutsClose' },
        { abrir: '#importPlaylistBtn', hoja: '#importSheet', cerrar: '#importSheetClose' },
        { abrir: '#createPlaylistBtn', hoja: '#createPlaylistModal', cerrar: '#closePlaylistModal' },
    ];
    for (const { abrir, hoja, cerrar } of hojas) {
        for (const como of ['x', 'fondo', 'escape']) {
            await page.click(abrir);
            await expect(page.locator(hoja)).toBeVisible();
            await page.waitForTimeout(350);
            if (como === 'x') await page.click(cerrar);
            else if (como === 'fondo') await page.locator(`${hoja} .auth-modal-backdrop`).click({ position: { x: 5, y: 5 } });
            else await page.keyboard.press('Escape');
            await expect(page.locator(hoja)).toBeHidden();
            await expect.poll(estado, { message: `${hoja} cerrada con ${como}` }).toEqual({ type: 'view', view: 'playlistsView' });
        }
    }
    // Y atrás va a la vista anterior a la primera, sin «atrás» que no hagan nada
    await page.goBack();
    await expect(page.locator('#libraryView')).toBeVisible();
});

// ============================================================
// 113-114 · Arreglos tras probarlo el usuario (plan 24)
// ============================================================

test('113 · el aviso de descarga sale al instante, aunque el servidor tarde, y un segundo toque no la descarga otra vez', async ({ page }) => {
    await abrirApp(page);
    // El servidor tarda en contestar: el aviso no puede esperarle
    await page.route('**/api/start-download', async (ruta) => {
        await new Promise((ok) => setTimeout(ok, 2500));
        await ruta.continue();
    });
    let peticiones = 0;
    page.on('request', (r) => { if (r.url().includes('/api/start-download')) peticiones++; });

    await page.fill('#youtubeUrl', 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    const antes = Date.now();
    await page.click('#downloadBtn');
    await expect(page.locator('.dl-banner').first()).toBeVisible({ timeout: 1_000 });
    expect(Date.now() - antes).toBeLessThan(1_000);

    // Otra vez mientras tanto (el botón está desactivado, pero Intro no): lo
    // dice y no pide otra descarga
    await page.fill('#youtubeUrl', 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await page.press('#youtubeUrl', 'Enter');
    await expect(page.locator('.aviso-flotante')).toHaveText('Esa canción ya se está descargando');

    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    expect(peticiones).toBe(1);
    // El mismo aviso pasa a ser el de la descarga de verdad: no se queda uno colgado
    await expect(page.locator('.dl-banner')).toHaveCount(0, { timeout: 10_000 });
});

test('114 · aleatorio y repetir se pulsan igual en la lista, la cola y la barra del reproductor', async ({ page }) => {
    await listaConDos(page, 'Con pulsación');
    // La de la barra es la que el usuario eligió: las demás, idénticas
    const pulsacion = (sel) => page.locator(sel).evaluate((b) => {
        const c = getComputedStyle(b);
        return { press: c.getPropertyValue('--press').trim(), transicion: c.transition };
    });
    const barra = await pulsacion('#playerShuffle');
    expect(Number(barra.press)).toBe(0.9);   // la build lo deja en «.9»
    for (const sel of ['#plShuffleBtn', '#plRepeatBtn', '#pqShuffleBtn', '#pqRepeatBtn', '#playerRepeat']) {
        expect(await pulsacion(sel), sel).toEqual(barra);
    }
});

test('115 · escuchar antes: si YouTube no deja incrustarla, suena por la caché, y descargarla después es instantáneo', async ({ page }) => {
    // Un reproductor de YouTube falso que responde como con un vídeo oficial: error 150
    await page.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({
        contentType: 'text/javascript',
        body: `window.__yt = { videos: [] };
            window.YT = { Player: class {
                constructor(id, o) { this.o = o; setTimeout(() => o.events.onReady({ target: this }), 50); }
                loadVideoById(v) { window.__yt.videos.push(v); setTimeout(() => this.o.events.onError({ data: 150 }), 100); }
                unMute() {} setVolume() {} playVideo() {} stopVideo() {}
            } };
            window.onYouTubeIframeAPIReady();`,
    }));
    let descargas = 0;
    page.on('request', (r) => { if (r.url().includes('/api/start-download')) descargas++; });
    await abrirApp(page);
    await pedir(page, 'cancion de prueba');
    const resultado = page.locator('#searchResults .result-item').first();
    await expect(resultado).toBeVisible({ timeout: 30_000 });

    const boton = resultado.locator('.preview-btn');
    await boton.click();
    await expect.poll(() => page.evaluate(() => window.__yt?.videos.length ?? 0)).toBe(1);
    // YouTube dice que no: se baja a la caché (una descarga), late mientras tanto y suena desde ahí
    await expect.poll(() => descargas, { timeout: 10_000 }).toBe(1);
    await expect(boton).toHaveClass(/cargando/);
    await expect(boton).toHaveClass(/playing/, { timeout: 30_000 });
    await expect(boton).not.toHaveClass(/cargando/);
    await boton.click();
    await expect(boton).not.toHaveClass(/playing/);

    // Descargarla ya no la pide otra vez: sale de la caché
    await resultado.locator('.result-info').click();
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    expect(descargas).toBe(1);
});

// ============================================================
// 130-134 · Recomendaciones variadas: la radio (plan 25, sesión A)
// ============================================================

test('130 · la radio con una semilla de nicho reparte entre artistas: como mucho dos seguidas del mismo', async ({ page }) => {
    test.setTimeout(120_000);
    const pedidas = [];
    page.on('request', (r) => { if (r.url().includes('/api/radio')) pedidas.push(r.url()); });
    await abrirApp(page);
    await descargarTodos(page, ['semillanich']);
    await encenderRadio(page);
    await page.locator('#libraryList .library-item', { hasText: 'Empieza el nicho' }).click();
    await expect(page.locator('#playerTitle')).toContainText('Empieza el nicho', { timeout: 15_000 });

    // La radio prepara su ventana de tres a partir de la mezcla de nicho
    await abrirCola(page);
    const preparadas = page.locator('#pqRadioList .pq-item');
    await expect.poll(() => preparadas.count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
    const artistas = await preparadas.locator('.pq-item-artist').allTextContents();
    // En la mezcla, las 14 primeras son de Grupo Nicho: antes salían las tres suyas.
    // Con la semilla sonando, solo cabe una más suya, y no la primera
    expect(artistas.filter((a) => a === 'Grupo Nicho').length).toBeLessThanOrEqual(1);
    expect(artistas[0]).not.toBe('Grupo Nicho');
    expect(new Set(artistas).size).toBeGreaterThanOrEqual(2);
    expect(pedidas.length).toBeGreaterThanOrEqual(1);
});

test('131 · en «Mis Playlists» la lista que suena se resalta, con cuántas canciones, la duración y las de la nube en cada tarjeta', async ({ page }) => {
    await listaConDos(page, 'La que suena');
    await page.waitForFunction(() => !document.documentElement.dataset.navegacion);
    await page.click('#plPlayBtn');
    await expect(page.locator('#playerBar')).toBeVisible({ timeout: 15_000 });

    await irA(page, 'playlistsView');
    const tarjeta = page.locator('.playlist-card', { hasText: 'La que suena' });
    await expect(tarjeta).toHaveClass(/sonando/);
    await expect(tarjeta.locator('.playlist-card-sonando')).toHaveText('Sonando');
    await expect(tarjeta.locator('.playlist-card-count')).toHaveText(/^2 canciones · \d+ min$/);
    await expect(page.locator('.playlist-card.sonando')).toHaveCount(1);

    // Desde la biblioteca, la cola ya no sale de ninguna lista
    await irA(page, 'libraryView');
    await page.locator('#libraryList .library-item').first().click();
    await irA(page, 'playlistsView');
    await expect(page.locator('.playlist-card.sonando')).toHaveCount(0);
});

test('132 · el fondo toma los colores de la carátula, frena al pausar y arranca al seguir; en Ajustes se apaga', async ({ page }) => {
    await sonando(page);
    const fondo = page.locator('#fondoAmbiente');
    await expect(fondo).toHaveClass(/activo/, { timeout: 10_000 });
    await expect(fondo).toHaveClass(/con-color/);
    const velocidad = () => fondo.evaluate((el) => el.getAnimations({ subtree: true }).map((a) => a.playbackRate));
    await expect.poll(velocidad).toEqual([1, 1]);

    // Pausa: frena poco a poco (a mitad de camino aún se mueve) hasta pararse
    await page.evaluate(() => document.getElementById('mainAudio').pause());
    await page.waitForTimeout(500);
    const frenando = await velocidad();
    expect(frenando[0]).toBeGreaterThan(0);
    expect(frenando[0]).toBeLessThan(1);
    await expect.poll(velocidad, { timeout: 3_000 }).toEqual([0, 0]);

    // Y al seguir, vuelve a su velocidad
    await page.evaluate(() => document.getElementById('mainAudio').play());
    await expect.poll(velocidad, { timeout: 3_000 }).toEqual([1, 1]);

    // «Fondo con la carátula» apagado: se va
    await abrirAjustes(page);
    await page.locator('label:has(#pbFondo)').click();
    await expect(page.locator('#pbFondo')).not.toBeChecked();
    await expect(fondo).not.toHaveClass(/activo/);
});

test('133 · una mezcla pegada empieza con 35 y «Cargar 25 más» llega a 100, sin repetidas y sin perder lo elegido', async ({ page }) => {
    await abrirApp(page);
    const pedidas = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/playlist-info')) pedidas.push(r.postDataJSON()); });
    await pedir(page, 'https://www.youtube.com/watch?v=larga000001&list=RDlarga000001');
    const filas = page.locator('#playlistList .selector-fila');
    const mas = page.locator('#cargarMasMezcla');
    await expect(filas).toHaveCount(35, { timeout: 30_000 });
    await expect(mas).toBeVisible();
    await expect(mas).toHaveText(/Cargar 25 más/);

    // Lo desmarcado y lo buscado se quedan al cargar más
    await filas.filter({ hasText: 'Larga 2' }).first().click();
    await expect(page.locator('#selectedCount')).toHaveText('34');
    await mas.click();
    // 60 leídas, pero la 40 repite la 3: entran 24
    await expect(filas).toHaveCount(59);
    await expect(page.locator('#playlistCount')).toHaveText('59');
    await expect(page.locator('#selectedCount')).toHaveText('58');
    await expect(filas.filter({ has: page.locator('.selector-titulo', { hasText: /^Larga 2$/ }) })).not.toHaveClass(/elegida/);
    await expect(filas.filter({ hasText: 'Larga 59' })).toHaveClass(/elegida/);

    await page.locator('#playlistList .selector-buscar-entrada').fill('Larga 7');
    await mas.click();
    await expect(page.locator('#playlistCount')).toHaveText('84');
    // Con el buscador escrito, solo se ven las que llevan un 7 (7, 17… 67 y 70-79)
    await expect(filas).toHaveCount(17);
    await page.locator('#playlistList .selector-buscar-entrada').fill('');

    // La última tanda trae las 15 que faltan hasta 100 y el botón se va
    await expect(mas).toHaveText(/Cargar 15 más/);
    await mas.click();
    await expect(filas).toHaveCount(99);
    await expect(mas).toBeHidden();
    expect(pedidas.map((p) => p.hasta)).toEqual([undefined, 60, 85, 100]);

    // Una mezcla que ya no trae nada nuevo lo dice y quita el botón (el simulado repite 6)
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa&list=RDaaaaaaaaaaa');
    await expect(filas).toHaveCount(6, { timeout: 30_000 });
    await mas.click();
    await expect(page.locator('#statusMessage')).toContainText('No hay más canciones en esta mezcla');
    await expect(mas).toBeHidden();
    await expect(filas).toHaveCount(6);
});

test('134 · «Otras» enseña que busca: el botón gira, las de ahora se apagan y las nuevas entran una tras otra', async ({ page }) => {
    await listaCon(page, 'Buscando otras', ['semillanich']);
    const lista = page.locator('#plRecomendadasLista');
    const filas = lista.locator('.rec-fila');
    const otras = page.locator('#plRecomendadasOtras');
    await expect(filas).toHaveCount(5, { timeout: 20_000 });
    const antes = await artistasRecomendados(page);

    await otras.click();
    // Buscando, al menos 600 ms aunque la mezcla ya esté en memoria
    await expect(otras).toHaveClass(/rec-otras--buscando/);
    await expect(otras).toBeDisabled();
    await expect(lista).toHaveClass(/rec-buscando/);
    await expect(lista).toHaveAttribute('aria-busy', 'true');
    expect(await otras.evaluate((b) => getComputedStyle(b, '::before').animationName)).toBe('rec-girar');
    await expect.poll(() => filas.first().locator('.rec-caratula').evaluate((e) => Number(getComputedStyle(e).opacity))).toBeLessThan(0.5);
    // Y no se puede pulsar ninguna mientras tanto
    expect(await filas.first().evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');

    // Llegan las otras: el botón para y entran una tras otra
    await expect(otras).not.toHaveClass(/rec-otras--buscando/);
    await expect(otras).toBeEnabled();
    await expect(lista).not.toHaveAttribute('aria-busy');
    expect((await artistasRecomendados(page)).join()).not.toBe(antes.join());
    await expect(filas.first()).toHaveClass(/rec-fila--nueva/);
    expect(await filas.nth(4).evaluate((e) => getComputedStyle(e).animationDelay)).toBe('0.32s');
});

// ============================================================
// 120-139 · La vista de una lista (plan 24, sesión B)
// ============================================================

/** Dos canciones descargadas en una lista nueva, abierta en su detalle. */
async function listaConDos(page, nombre) {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await pedir(page, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', nombre);
    for (const fila of await page.locator('#playlistCreateSongsList .selector-fila').all()) await fila.click();
    await page.click('#savePlaylistBtn');
    await page.locator('.playlist-card', { hasText: nombre }).click();
    await expect(page.locator('#playlistDetailName')).toHaveText(nombre);
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(2);
}

test('120 · la cabecera de una lista: portada, cuándo cambió, Reproducir en el orden que se ve y el resto en el menú ⋮', async ({ page }) => {
    await listaConDos(page, 'Con cabecera');
    await expect(page.locator('#plPortada > *')).toHaveCount(1);
    await expect(page.locator('#plActualizada')).toHaveText('actualizada este minuto');
    // Fuera de la vista solo quedan Reproducir, aleatorio, repetir y ⋮
    await expect(page.locator('#plActionEdit')).toBeHidden();

    const primera = (await page.locator('#playlistDetailList .library-item-title').first().textContent()).trim();
    await page.click('#plPlayBtn');
    await expect(page.locator('#playerTitle')).toHaveText(primera, { timeout: 10_000 });

    await page.click('#plShuffleBtn');
    await expect(page.locator('#plShuffleBtn')).toHaveClass(/active/);

    // El menú: todo lo de una lista propia, y Escape lo cierra sin salir de la lista
    await page.click('#plMoreBtn');
    for (const id of ['#plActionAdd', '#plActionEdit', '#plActionReorder', '#plActionShare', '#plActionSelect', '#plActionDelete']) {
        await expect(page.locator(id)).toBeVisible();
    }
    await expect(page.locator('#playlistMenuTitulo')).toHaveText('Con cabecera');
    await page.keyboard.press('Escape');
    await expect(page.locator('#playlistMenuSheet')).toBeHidden();
    await expect(page.locator('#playlistDetailView')).toBeVisible();
    expect(await page.evaluate(() => history.state?.view)).toBe('playlistDetailView');

    // Mover a mano (desde «Ordenar por») se termina con «Hecho»
    await menuDeLista(page, '#plActionReorder');
    await page.click('#plOrdenSheet [data-criterio="a-mano"]');
    await expect(page.locator('#plReorderDone')).toBeVisible();
    await expect(page.locator('#playlistDetailList .pl-drag-handle').first()).toBeVisible();
    await page.click('#plReorderDone');
    await expect(page.locator('#plReorderDone')).toBeHidden();
    await expect(page.locator('#playlistDetailList .edit-mode')).toHaveCount(0);
});

test('121 · Compartir una lista da «Artista – Canción» por línea, que Importar lista lee tal cual', async ({ page }) => {
    await listaConDos(page, 'Para compartir');
    // Sin la hoja de compartir del sistema: se copia al portapapeles
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copiado = t; } }, configurable: true });
    });
    await menuDeLista(page, '#plActionShare');
    await expect(page.getByText('Lista copiada')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#playlistMenuSheet')).toBeHidden();
    const texto = await page.evaluate(() => window.__copiado);
    expect(texto.split('\n')).toHaveLength(2);
    // La que trae artista y canción (el simulado la da como «Artista Oficial»), con la raya
    expect(texto.split('\n')).toContain('Artista Oficial – Tema Oficial');
});

test('122 · la portada elegida en «Editar» sale en la cabecera y en la tarjeta, y vuelve a la automática', async ({ page }) => {
    await listaConDos(page, 'Con portada');
    await menuDeLista(page, '#plActionEdit');
    const opciones = page.locator('#editPlaylistCovers .portadas-opcion');
    // La automática, sus dos carátulas y las 8 generadas (plan 27)
    await expect(opciones).toHaveCount(11);
    await expect(opciones.first()).toHaveAttribute('aria-checked', 'true');
    await opciones.nth(2).click();
    await expect(opciones.nth(2)).toHaveAttribute('aria-checked', 'true');
    const elegida = await opciones.nth(2).locator('img').getAttribute('src');
    await expect(page.locator('#editPlaylistCover img')).toHaveAttribute('src', elegida);
    await page.click('#confirmEditPlaylistBtn');
    await expect(page.locator('#editPlaylistModal')).toBeHidden({ timeout: 5_000 });

    await expect(page.locator('#plPortada > img')).toHaveAttribute('src', elegida);
    await irA(page, 'playlistsView');
    await expect(page.locator('.playlist-card', { hasText: 'Con portada' }).locator('.playlist-card-cover > img')).toHaveAttribute('src', elegida);

    // Otra vez la automática
    await page.locator('.playlist-card', { hasText: 'Con portada' }).click();
    await menuDeLista(page, '#plActionEdit');
    await opciones.first().click();
    await page.click('#confirmEditPlaylistBtn');
    await expect(page.locator('#editPlaylistModal')).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#plPortada > img')).toHaveCount(0);
});

test.describe('en una pantalla baja', () => {
    test.use({ viewport: { width: 1280, height: 300 } });

    test('123 · al bajar más allá de la portada, arriba quedan el nombre y Reproducir', async ({ page }) => {
        await listaConDos(page, 'Con barra fija');
        const barra = page.locator('#plBarraFija');
        await expect(barra).not.toHaveClass(/lista-fija--visible/);
        // Al abrir la lista, la transición de vista la sube arriba: se baja cuando ya ha terminado
        await expect.poll(() => page.evaluate(() => {
            if (document.activeViewTransition || document.getElementById('playlistDetailView').classList.contains('hidden')) return false;
            const contenido = document.querySelector('.main-content');
            contenido.scrollTop = 10_000;
            return contenido.scrollTop > 0 && contenido.scrollTop >= contenido.scrollHeight - contenido.clientHeight - 1;
        })).toBe(true);
        expect(await page.evaluate(() => document.getElementById('plPortada').getBoundingClientRect().bottom)).toBeLessThan(0);
        await expect(barra).toHaveClass(/lista-fija--visible/);
        await expect(page.locator('#plBarraFijaNombre')).toHaveText('Con barra fija');
        await page.click('#plBarraFijaPlay');
        await expect(page.locator('#playerBar')).toBeVisible({ timeout: 10_000 });
        await page.evaluate(() => { document.querySelector('.main-content').scrollTop = 0; });
        await expect(barra).not.toHaveClass(/lista-fija--visible/);
    });
});

test.describe('en un móvil', () => {
    test.use({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true });

    test('155 · al bajar en una lista, su barra ocupa la fila de la cabecera, con volver, y los iconos dejan su sitio', async ({ page }) => {
        await listaConDos(page, 'Lista en el móvil');
        const barra = page.locator('#plBarraFija');
        const iconos = page.locator('.mobile-header-controls');
        await expect(iconos).toHaveCSS('opacity', '1');
        await expect.poll(() => page.evaluate(() => {
            if (document.activeViewTransition || document.getElementById('playlistDetailView').classList.contains('hidden')) return false;
            const contenido = document.querySelector('.main-content');
            contenido.scrollTop = 10_000;
            return contenido.scrollTop > 0 && contenido.scrollTop >= contenido.scrollHeight - contenido.clientHeight - 1;
        })).toBe(true);
        await expect(barra).toHaveClass(/lista-fija--visible/);
        // A la altura de la cápsula de iconos, que se aparta
        // Con la vista ya entrada: su animación de llegada mueve lo que va fijo dentro
        await expect.poll(() => page.evaluate(() => document.getElementById('playlistDetailView').getAnimations().length)).toBe(0);
        await expect.poll(async () => Math.round((await barra.boundingBox()).y)).toBe(10);
        expect((await barra.boundingBox()).height).toBe(44);
        await expect(iconos).toHaveCSS('opacity', '0');
        await expect(iconos).toHaveCSS('pointer-events', 'none');
        await expect(page.locator('#plBarraFijaVolver')).toBeVisible();
        await expect(page.locator('#plBarraFijaNombre')).toHaveText('Lista en el móvil');
        // Volver lleva a las listas, y los iconos vuelven
        await page.click('#plBarraFijaVolver');
        await expect(page.locator('#playlistsView')).toBeVisible({ timeout: 5_000 });
        await expect(iconos).toHaveCSS('opacity', '1');
    });
});

test('156 · en «Editar» de una canción se elige su portada: una generada o la suya, en todas partes y tras recargar', async ({ page }) => {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    const miniatura = page.locator('#libraryList .library-item .library-item-thumb').first();
    const original = await miniatura.getAttribute('src');
    expect(original).not.toMatch(/^data:image\/svg/);
    const editar = async () => {
        await page.locator('#libraryList .library-item').first().click();
        await expect(page.locator('#playerBar')).toBeVisible({ timeout: 15_000 });
        await page.evaluate(() => { document.getElementById('mainAudio').loop = true; });
        await page.locator('#playerInfo').click();
        await expect(page.locator('#fullPlayer')).not.toHaveClass(/fp-hidden/);
        await page.click('#fullPlayerEdit');
        await expect(page.locator('#editSongSheet')).toBeVisible();
    };
    const opciones = page.locator('#editSongCovers .portadas-opcion');

    // La suya y las 8 generadas de las listas, con la suya marcada
    await editar();
    await expect(opciones).toHaveCount(9);
    await expect(opciones.first()).toHaveAttribute('aria-checked', 'true');
    await page.click('#editSongCovers [data-portada="gen:3"]');
    await expect(page.locator('#editSongCovers [data-portada="gen:3"]')).toHaveAttribute('aria-checked', 'true');
    await page.click('#editSongSave');
    await expect(page.locator('#editSongSheet')).toBeHidden({ timeout: 5_000 });
    // En la pantalla completa, la barra y la biblioteca; el nombre no queda editado
    await expect(page.locator('#fullPlayerThumb')).toHaveAttribute('src', /^data:image\/svg/);
    await expect(page.locator('#playerThumb')).toHaveAttribute('src', /^data:image\/svg/);
    await page.click('#fullPlayerClose');
    await expect(miniatura).toHaveAttribute('src', /^data:image\/svg/);

    // Sobrevive a recargar, y al volver a «Editar» sigue marcada
    await page.reload();
    await irA(page, 'libraryView');
    await expect(miniatura).toHaveAttribute('src', /^data:image\/svg/);
    await editar();
    await expect(page.locator('#editSongCovers [data-portada="gen:3"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#editSongRestore')).toBeHidden();

    // Volver a la suya
    await opciones.first().click();
    await page.click('#editSongSave');
    await expect(page.locator('#editSongSheet')).toBeHidden({ timeout: 5_000 });
    await page.click('#fullPlayerClose');
    await expect(miniatura).toHaveAttribute('src', original);
});

test('124 · «Descargar las que faltan» baja en un lote las de la nube de una lista y la deja sin nube', async ({ page, request }) => {
    const email = `faltan-${Date.now()}@e2e.test`;
    const { id: userId } = usuarioDePrueba(email);
    const auth = { Authorization: `Bearer ${tokenDe(userId)}` };
    await request.post('/api/sync', { headers: auth, data: { dispositivo: 'ordenador-0124', cambios: [
        { tipo: 'cancion', accion: 'poner', datos: { videoId: 'aaaaaaaaaaa', title: 'Cancion de prueba 1', channel: 'Canal E2E' } },
        { tipo: 'cancion', accion: 'poner', datos: { videoId: 'bbbbbbbbbbb', title: 'Cancion de prueba 2', channel: 'Canal E2E' } },
        { tipo: 'lista', accion: 'poner', datos: { id: '1700000000124', name: 'Por bajar', description: '', songs: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] } },
    ] } });

    await abrirApp(page);
    await iniciarSesionDePrueba(page, email);
    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Por bajar' }).click({ timeout: 20_000 });
    await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(2, { timeout: 20_000 });
    const boton = page.locator('#plDescargarFaltan');
    await expect(boton).toHaveText(/Descargar las 2 que faltan/);

    await boton.click();
    await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(0, { timeout: ESPERA_DESCARGA });
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(2);
    await expect(boton).toBeHidden();
    await expect(page.locator('#playlistDetailCount')).not.toContainText('en la nube');
});

test('125 · dentro de una lista se busca y se ordena: Reproducir sigue lo que se ve, y el orden se recuerda', async ({ page }) => {
    await listaConDos(page, 'Con buscador');
    const filas = page.locator('#playlistDetailList .library-item-title');

    // Ordenar por título, desde el menú ⋮
    await menuDeLista(page, '#plActionReorder');
    await expect(page.locator('#plOrdenSheet')).toBeVisible();
    await expect(page.locator('#plOrdenSheet [data-criterio="personalizado"]')).toHaveAttribute('aria-checked', 'true');
    await page.click('#plOrdenSheet [data-criterio="titulo"]');
    await expect(page.locator('#plOrdenSheet')).toBeHidden();
    const porTitulo = await filas.allTextContents();
    expect(porTitulo).toEqual([...porTitulo].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })));

    // Buscar: solo lo que coincide, y Reproducir empieza por ello
    await page.click('#plBuscarBtn');
    await page.fill('#plBuscarInput', 'Tema Oficial');
    await expect(filas).toHaveCount(1);
    await page.click('#plPlayBtn');
    await expect(page.locator('#playerTitle')).toHaveText('Tema Oficial', { timeout: 10_000 });

    // Nada: lo dice y se puede borrar la búsqueda
    await page.fill('#plBuscarInput', 'xyz');
    await expect(filas).toHaveCount(0);
    await expect(page.locator('#plSinResultados')).toContainText('Nada con «xyz» en esta lista');
    await page.click('#plSinResultadosBorrar');
    await expect(filas).toHaveCount(2);
    await expect(page.locator('#plSinResultados')).toBeHidden();

    // El orden se recuerda al volver a la lista; la búsqueda, no
    await page.click('#backToPlaylistsBtn');
    await page.locator('.playlist-card', { hasText: 'Con buscador' }).click();
    await expect(filas).toHaveText(porTitulo);
    await expect(page.locator('#plBuscarFila')).toBeHidden();

    // «Mover a mano» vuelve al orden guardado
    await menuDeLista(page, '#plActionReorder');
    await page.click('#plOrdenSheet [data-criterio="a-mano"]');
    await expect(page.locator('#plReorderDone')).toBeVisible();
    await page.click('#plReorderDone');
    await menuDeLista(page, '#plActionReorder');
    await expect(page.locator('#plOrdenSheet [data-criterio="personalizado"]')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
});

test('126 · una lista vacía propone añadir canciones, y la biblioteca vacía, buscar o importar una lista', async ({ page }) => {
    await abrirApp(page);
    await irA(page, 'libraryView');
    const biblioteca = page.locator('#libraryEmpty');
    await expect(biblioteca).toBeVisible();
    await expect(biblioteca.locator('.estado-vacio-accion')).toHaveText(['Buscar música', 'Importar lista']);
    await biblioteca.getByText('Importar lista').click();
    await expect(page.locator('#importSheet')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await page.keyboard.press('Escape');

    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', 'Sin nada');
    await page.click('#savePlaylistBtn');
    await page.locator('.playlist-card', { hasText: 'Sin nada' }).click();
    const vacia = page.locator('#playlistDetailEmpty');
    await expect(vacia).toBeVisible();
    await expect(vacia).toContainText('Esta lista está vacía');
    await vacia.getByText('Añadir canciones').click();
    await expect(page.locator('#playlistSearchModal')).toBeVisible();
});

test('127 · al final de una lista, cinco recomendadas: «Otras» enseña otras cinco y el + la descarga y la añade', async ({ page }) => {
    await abrirApp(page);
    await descargarTodos(page, ['semillaradi']);
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', 'Con recomendadas');
    await page.locator('#playlistCreateSongsList .selector-fila').first().click();
    await page.click('#savePlaylistBtn');
    await page.locator('.playlist-card', { hasText: 'Con recomendadas' }).click();

    // De la mezcla de su canción: sin ella, sin repetir la versión con letra
    const seccion = page.locator('#plRecomendadas');
    const filas = seccion.locator('.rec-fila');
    await expect(seccion).toBeVisible({ timeout: 20_000 });
    await expect(filas).toHaveCount(5);
    await expect(filas.first()).toContainText('Parecida 1');
    await expect(seccion).not.toContainText('Empieza la radio');
    await expect(seccion).not.toContainText('Lyrics');

    await page.click('#plRecomendadasOtras');
    await expect(filas.first()).toContainText('Parecida 6');

    // El +: se descarga y entra en la lista
    await filas.first().locator('.rec-anadir').click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(2, { timeout: ESPERA_DESCARGA });
    await expect(page.locator('#playlistDetailList')).toContainText('Parecida 6');
    await expect(filas.first().locator('.rec-anadir')).toBeDisabled();
});

test('128 · las recomendadas se ven siempre: en una lista vacía, a partir de lo que suena; si la radio falla, lo dicen y se reintenta', async ({ page }) => {
    await abrirApp(page);
    await descargarTodos(page, ['semillaradi']);
    await page.locator('#libraryList .library-item').first().click();
    await expect(page.locator('#playerBar')).toBeVisible({ timeout: 15_000 });
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', 'Vacía con ideas');
    await page.click('#savePlaylistBtn');
    await page.locator('.playlist-card', { hasText: 'Vacía con ideas' }).click();

    // Sin pulsar nada: la sección está y se llena (plan 25)
    const seccion = page.locator('#plRecomendadas');
    await expect(seccion).toBeVisible();
    await expect(seccion).toContainText('Parecidas a las de esta lista');
    await expect(seccion.locator('.rec-fila')).toHaveCount(5, { timeout: 20_000 });
    await expect(page.locator('#playlistDetailEmpty')).not.toContainText('Ver recomendadas');

    // Sin la radio (YouTube limita): la sección sigue, con el porqué y «Reintentar»
    let limita = true;
    await page.route('**/api/radio**', (r) => (limita
        ? r.fulfill({ status: 429, contentType: 'application/json', body: '{"code":"youtube_limit"}' })
        : r.continue()));
    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Vacía con ideas' }).click();
    await expect(seccion).toBeVisible();
    await expect(page.locator('#plRecomendadasAviso')).toContainText('YouTube no ha dado recomendadas', { timeout: 10_000 });
    await expect(seccion.locator('.rec-fila')).toHaveCount(0);
    limita = false;
    await page.click('#plRecomendadasReintentar');
    await expect(seccion.locator('.rec-fila')).toHaveCount(5, { timeout: 20_000 });
    await expect(page.locator('#plRecomendadasAviso')).toBeHidden();
});

test('129 · escuchar una recomendada que YouTube no deja incrustar la baja a la caché de la radio y suena; el + la añade sin volver a bajarla', async ({ page }) => {
    // Sin el reproductor de YouTube (como con un vídeo oficial, que no se deja incrustar): por la caché
    await page.route(/youtube\.com\/iframe_api/, (r) => r.abort());
    await abrirApp(page);
    await descargarTodos(page, ['semillaradi']);
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', 'Para escuchar');
    await page.locator('#playlistCreateSongsList .selector-fila').first().click();
    await page.click('#savePlaylistBtn');
    await page.locator('.playlist-card', { hasText: 'Para escuchar' }).click();
    const fila = page.locator('#plRecomendadas .rec-fila').first();
    await expect(fila).toContainText('Parecida 1', { timeout: 20_000 });

    const pedidas = [];
    page.on('request', (r) => { if (r.url().includes('/api/start-download')) pedidas.push(r.postDataJSON()?.url); });
    const escuchar = fila.locator('.rec-escuchar');
    await escuchar.click();
    await expect(escuchar).toHaveClass(/playing/, { timeout: ESPERA_DESCARGA });
    expect(pedidas).toHaveLength(1);
    await escuchar.click();
    await expect(escuchar).not.toHaveClass(/playing/);

    await fila.locator('.rec-anadir').click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('#playlistDetailList')).toContainText('Parecida 1');
    expect(pedidas, 'la escuchada no se vuelve a bajar').toHaveLength(1);
});

// ============================================================
// 135-139 · Recomendadas variadas (plan 25, sesión B)
// ============================================================

/** Una lista con esas canciones ya descargadas, abierta en su detalle. */
async function listaCon(page, nombre, ids, { tambienEnBiblioteca = [] } = {}) {
    await abrirApp(page);
    await descargarTodos(page, [...ids, ...tambienEnBiblioteca]);
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    await page.fill('#playlistNameInput', nombre);
    for (const id of ids) {
        const titulo = { semillanich: 'Empieza el nicho', semillaradi: 'Empieza la radio' }[id];
        await page.locator('#playlistCreateSongsList .selector-fila', { hasText: titulo }).click();
    }
    await page.click('#savePlaylistBtn');
    await page.locator('.playlist-card', { hasText: nombre }).click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(ids.length);
}

/** Los artistas de las recomendadas que se ven. */
const artistasRecomendados = (page) => page.locator('#plRecomendadas .rec-artista').evaluateAll((els) =>
    els.map((e) => e.firstChild.textContent.trim()));

test('135 · con una mezcla dominada por un artista, las recomendadas reparten: como mucho dos suyas por tanda', async ({ page }) => {
    await listaCon(page, 'De nicho', ['semillanich']);
    await expect(page.locator('#plRecomendadas .rec-fila')).toHaveCount(5, { timeout: 20_000 });
    for (const tanda of [1, 2]) {
        const artistas = await artistasRecomendados(page);
        expect(artistas.filter((a) => a === 'Grupo Nicho').length, `tanda ${tanda}: ${artistas}`).toBeLessThanOrEqual(2);
        expect(new Set(artistas).size, `tanda ${tanda}: ${artistas}`).toBeGreaterThanOrEqual(3);
        if (tanda === 1) {
            const antes = artistas.join();
            await page.click('#plRecomendadasOtras');
            await expect.poll(async () => (await artistasRecomendados(page)).join()).not.toBe(antes);
        }
    }
});

test('136 · una recomendada que ya está en la biblioteca se añade a la lista sin descargarla', async ({ page }) => {
    await listaCon(page, 'Con una tuya', ['semillanich'], { tambienEnBiblioteca: ['estilo00001'] });
    const tuya = page.locator('#plRecomendadas .rec-fila', { hasText: 'Canción del estilo 1' });
    await expect(tuya).toBeVisible({ timeout: 20_000 });
    await expect(tuya).toHaveClass(/rec-fila--tuya/);
    await expect(tuya).toContainText('En tu biblioteca');
    const boton = tuya.locator('.rec-anadir');
    await expect(boton).toHaveAttribute('aria-label', 'Añadir a la lista');
    // Las que no son tuyas se ofrecen para descargar
    await expect(page.locator('#plRecomendadas .rec-fila:not(.rec-fila--tuya) .rec-anadir').first())
        .toHaveAttribute('aria-label', 'Descargar y añadir a la lista');

    const pedidas = [];
    page.on('request', (r) => { if (r.url().includes('/api/start-download')) pedidas.push(r.url()); });
    await boton.click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(2);
    await expect(page.locator('#playlistDetailList')).toContainText('Canción del estilo 1');
    expect(pedidas, 'no se descarga lo que ya es tuyo').toHaveLength(0);
});

test('137 · las recomendadas de una lista con varios artistas parten de la mezcla de cada uno, pedidas a la vez', async ({ page }) => {
    const semillas = [];
    page.on('request', (r) => {
        const m = r.url().match(/\/api\/radio\?semilla=(\w+)/);
        if (m) semillas.push(m[1]);
    });
    await listaCon(page, 'Dos artistas', ['semillanich', 'semillaradi']);
    await expect(page.locator('#plRecomendadas .rec-fila')).toHaveCount(5, { timeout: 20_000 });
    expect([...semillas].sort()).toEqual(['semillanich', 'semillaradi']);
    const artistas = await artistasRecomendados(page);
    // Salen de las dos mezclas: del estilo de cada una
    expect(artistas.some((a) => /^Grupo \d+$/.test(a)), artistas.join()).toBe(true);
    expect(artistas.some((a) => /^(Grupo Nicho|Artista \d)$/.test(a)), artistas.join()).toBe(true);
});

// ============================================================
// 140 · El scroll de la biblioteca no salta (APK 2.1.0)
// ============================================================

test('140 · cuando el buscador de ids une una canción con su copia de la nube, la fila que se ve se queda en su sitio', async ({ page, request }) => {
    const email = `scroll-${Date.now()}@e2e.test`;
    const { id: userId } = usuarioDePrueba(email);
    const auth = { Authorization: `Bearer ${tokenDe(userId)}` };
    // La cuenta: 40 en la nube; la primera es la descargada aquí, con otro título
    const nube = [
        { videoId: 'bbbbbbbbbbb', title: 'Con otro titulo en la cuenta', channel: 'Canal', artist: 'Canal', track: 'Otro' },
        ...Array.from({ length: 39 }, (_, i) => ({ videoId: `nube${String(i).padStart(7, '0')}`, title: `En la nube ${i}`, channel: 'Canal', artist: 'Canal', track: `En la nube ${i}` })),
    ];
    await request.post('/api/sync', { headers: auth, data: { dispositivo: 'ordenador-0001', cambios: nube.map((datos) => ({ tipo: 'cancion', accion: 'poner', datos })) } });

    // Aquí, descargada y sin su id: solo el buscador la reconoce, por el título exacto
    await abrirApp(page);
    await page.evaluate(() => new Promise((ok, ko) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const tx = r.result.transaction(['kv_store', 'audio_blobs'], 'readwrite');
            tx.objectStore('audio_blobs').put(new Blob(['x'], { type: 'audio/wav' }), 'sinid');
            tx.objectStore('kv_store').put([{ src: 'idb://sinid', title: 'Cancion de prueba 2', channel: 'Canal E2E', addedAt: '2026-10-01T10:00:00Z' }], 'ytdl_library');
            tx.oncomplete = ok; tx.onerror = ko;
        };
    }));

    // La búsqueda se retiene hasta haber bajado por la lista
    let soltar;
    const suelta = new Promise((ok) => { soltar = ok; });
    await page.route('**/api/search', async (ruta) => { await suelta; await ruta.continue(); });

    await iniciarSesionDePrueba(page, email);
    await irA(page, 'libraryView');
    const filas = page.locator('#libraryList .library-item');
    await expect(filas).toHaveCount(41, { timeout: 20_000 });

    // Abajo, con «En la nube 20» a la vista
    const fila = filas.filter({ hasText: 'En la nube 20' });
    await fila.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const antes = (await fila.boundingBox()).y;

    soltar();
    // Se une con su copia de la nube: una fila menos, por encima de lo que se ve
    await expect(filas).toHaveCount(40, { timeout: 30_000 });
    await expect(page.locator('#libraryList .library-item-nube', { hasText: 'Con otro titulo' })).toHaveCount(0);
    const despues = (await fila.boundingBox()).y;
    expect(Math.abs(despues - antes), `de ${antes} a ${despues}`).toBeLessThan(2);
});

// ============================================================
// 141 · Crear una lista al descargar una lista de YouTube (plan 26)
// ============================================================

test('141 · al descargar una lista de YouTube se crea una lista propia con sus canciones; sin el interruptor no, y se recuerda', async ({ page }) => {
    const lista = 'https://www.youtube.com/playlist?list=PLe2eCrearLista01';
    await abrirApp(page);
    await pedir(page, lista);
    await expect(page.locator('#playlistSelector')).toBeVisible({ timeout: 30_000 });

    // Activado la primera vez, con el nombre de la lista de YouTube
    const activa = page.locator('#ytCrearListaActiva');
    const nombre = page.locator('#ytCrearListaNombre');
    await expect(page.locator('#ytCrearLista')).toBeVisible();
    await expect(activa).toBeChecked();
    await expect(nombre).toHaveValue('Lista E2E');
    await nombre.fill('Mi lista de YouTube');
    await page.click('#downloadSelectedBtn');

    // La lista está desde el principio, con las tres, y acaban descargadas
    await irA(page, 'playlistsView');
    const tarjeta = page.locator('.playlist-card', { hasText: 'Mi lista de YouTube' });
    await expect(tarjeta).toBeVisible({ timeout: 10_000 });
    await tarjeta.click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(3);
    await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(0, { timeout: ESPERA_DESCARGA });
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 3);

    // Apagado: no se crea otra lista, y la próxima vez sale apagado
    await irA(page, 'playlistsView');
    const tarjetas = await page.locator('.playlist-card').count();
    await irA(page, 'homeView');
    await pedir(page, lista);
    await expect(page.locator('#playlistSelector')).toBeVisible({ timeout: 30_000 });
    await page.locator('label[for="ytCrearListaActiva"]').click();
    await expect(activa).not.toBeChecked();
    await expect(nombre).toBeHidden();
    await page.click('#downloadSelectedBtn');
    await page.waitForTimeout(1500);
    await irA(page, 'playlistsView');
    await expect(page.locator('.playlist-card')).toHaveCount(tarjetas);

    await page.reload();
    await pedir(page, lista);
    await expect(page.locator('#playlistSelector')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#ytCrearLista')).toBeVisible();
    await expect(activa).not.toBeChecked();
});

// ============================================================
// 142-145 · Ninguna canción ni lista sin portada (plan 27)
// ============================================================

const SVG_GENERADA = /^data:image\/svg\+xml,/;

/** Canciones viejas sin carátula ni id de YouTube, en la biblioteca y en una lista. */
async function sembrarSinCaratula(page, { lista = null } = {}) {
    await abrirApp(page);
    await page.evaluate(({ lista }) => new Promise((ok, ko) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const tx = r.result.transaction(['kv_store', 'audio_blobs'], 'readwrite');
            const canciones = [1, 2, 3].map((i) => ({
                src: `idb://vieja${i}`, title: `Vieja sin carátula ${i}`, channel: 'Grupo Antiguo', artist: 'Grupo Antiguo',
                thumbnail: '', duration: 200, addedAt: `2026-10-0${i}T10:00:00Z`,
            }));
            canciones.forEach((c) => tx.objectStore('audio_blobs').put(new Blob(['x'], { type: 'audio/wav' }), c.src.slice(6)));
            tx.objectStore('kv_store').put(canciones, 'ytdl_library');
            if (lista) tx.objectStore('kv_store').put([{ id: lista.id, name: lista.name, description: '', songs: canciones, portada: lista.portada ?? '', createdAt: '2026-10-01T10:00:00Z' }], 'ytdl_playlists');
            tx.oncomplete = ok; tx.onerror = ko;
        };
    }), { lista });
    await page.reload();
}

test('142 · una lista solo con canciones sin carátula tiene su portada generada en la tarjeta, la cabecera y «Editar»', async ({ page }) => {
    await sembrarSinCaratula(page, { lista: { id: '1790000000142', name: 'Viejas' } });
    await irA(page, 'playlistsView');
    const tarjeta = page.locator('.playlist-card', { hasText: 'Viejas' });
    await expect(tarjeta.locator('.playlist-card-cover > img')).toHaveAttribute('src', SVG_GENERADA);
    const enTarjeta = await tarjeta.locator('.playlist-card-cover > img').getAttribute('src');

    // La misma en la cabecera, y el degradado de detrás con su color
    await tarjeta.click();
    await expect(page.locator('#plPortada img')).toHaveAttribute('src', enTarjeta);
    await expect.poll(() => page.locator('#plCabecera').evaluate((e) => e.style.getPropertyValue('--lista-color-1'))).not.toBe('');

    // En «Editar»: la automática es esa, y se puede elegir entre las 8 generadas
    await menuDeLista(page, '#plActionEdit');
    const opciones = page.locator('#editPlaylistCovers .portadas-opcion');
    await expect(page.locator('#editPlaylistCoverSection')).toBeVisible();
    await expect(opciones).toHaveCount(9);
    await expect(opciones.first().locator('img')).toHaveAttribute('src', enTarjeta);
    for (let i = 1; i < 9; i++) await expect(opciones.nth(i)).toHaveAttribute('data-portada', `gen:${i - 1}`);
});

test('143 · una portada generada elegida en «Editar» se queda al recargar, en la cabecera y en la tarjeta', async ({ page }) => {
    await sembrarSinCaratula(page, { lista: { id: '1790000000143', name: 'Elegida' } });
    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Elegida' }).click();
    await menuDeLista(page, '#plActionEdit');
    const opcion = page.locator('#editPlaylistCovers .portadas-opcion[data-portada="gen:5"]');
    await opcion.click();
    await expect(opcion).toHaveAttribute('aria-checked', 'true');
    await expect(opcion.locator('img')).toHaveAttribute('src', SVG_GENERADA);
    const elegida = await opcion.locator('img').getAttribute('src');
    await page.click('#confirmEditPlaylistBtn');
    await expect(page.locator('#editPlaylistModal')).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#plPortada img')).toHaveAttribute('src', elegida);

    await page.reload();
    await irA(page, 'playlistsView');
    const tarjeta = page.locator('.playlist-card', { hasText: 'Elegida' });
    await expect(tarjeta.locator('.playlist-card-cover > img')).toHaveAttribute('src', elegida);
    await tarjeta.click();
    await expect(page.locator('#plPortada img')).toHaveAttribute('src', elegida);
    const guardada = await page.evaluate(() => new Promise((ok) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => { const g = r.result.transaction('kv_store').objectStore('kv_store').get('ytdl_playlists'); g.onsuccess = () => ok(g.result?.[0]?.portada); };
    }));
    expect(guardada).toBe('gen:5');
});

test('144 · las canciones sin carátula tienen su portada generada en la biblioteca, la cola y el reproductor, del color de su artista', async ({ page }) => {
    await sembrarSinCaratula(page);
    await irA(page, 'libraryView');
    const miniaturas = page.locator('#libraryList .library-item-thumb');
    await expect(miniaturas).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(miniaturas.nth(i)).toHaveAttribute('src', SVG_GENERADA);
    const srcs = await miniaturas.evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src')));
    expect(new Set(srcs).size, 'cada canción, sus formas').toBe(3);
    // El mismo artista, los mismos colores
    const colores = srcs.map((s) => [...decodeURIComponent(s).matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map((m) => m[1]).join());
    expect(new Set(colores).size).toBe(1);

    // Suena: la barra, la pantalla completa y la cola
    await page.locator('#libraryList .library-item', { hasText: 'Vieja sin carátula 1' }).locator('.library-item-info').click();
    await expect(page.locator('#playerThumb')).toHaveAttribute('src', SVG_GENERADA);
    await expect(page.locator('#fullPlayerThumb')).toHaveAttribute('src', SVG_GENERADA);
    await page.locator('#playerInfo').click();
    await page.locator('#fullPlayerQueue').click();
    await expect(page.locator('#playbackQueueSheet .pq-item-thumb').first()).toHaveAttribute('src', SVG_GENERADA);
});

test('145 · una lista nueva sin canciones nace con la portada que se veía al crearla', async ({ page }) => {
    await abrirApp(page);
    await irA(page, 'playlistsView');
    await page.click('#createPlaylistBtn');
    const vistaPrevia = page.locator('#createPlaylistCover .portada-mosaico--1 img');
    await expect(vistaPrevia).toHaveAttribute('src', SVG_GENERADA);
    const vista = await vistaPrevia.getAttribute('src');
    await page.fill('#playlistNameInput', 'Recién creada');
    await page.click('#savePlaylistBtn');
    await expect(page.locator('#createPlaylistModal')).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('.playlist-card', { hasText: 'Recién creada' }).locator('.playlist-card-cover > img')).toHaveAttribute('src', vista);
});

// ============================================================
// 147-150 · La carátula real de las canciones sin carátula (plan 27, T4)
// ============================================================

/** Una miniatura cualquiera: el navegador la pinta y fetch la da por buena. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Las canciones, guardadas como lo haría la app, con su audio. Al recargar, la app las lee. */
function sembrar(page, canciones) {
    return page.evaluate((lista) => new Promise((ok, ko) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => {
            const tx = r.result.transaction(['kv_store', 'audio_blobs'], 'readwrite');
            for (const s of lista) tx.objectStore('audio_blobs').put(new Blob(['x'], { type: 'audio/wav' }), s.src.slice('idb://'.length));
            tx.objectStore('kv_store').put(lista, 'ytdl_library');
            tx.oncomplete = ok; tx.onerror = ko;
        };
    }), canciones);
}

function leerDeApp(page, clave) {
    return page.evaluate((k) => new Promise((ok) => {
        const r = indexedDB.open('YTMusicDB');
        r.onsuccess = () => { const g = r.result.transaction('kv_store').objectStore('kv_store').get(k); g.onsuccess = () => ok(g.result ?? null); };
    }), clave);
}

/** Responde por i.ytimg.com, sin salir a internet. */
function ytimgFalso(page, responder) {
    return page.route('https://i.ytimg.com/vi/**', responder);
}

const conImagen = (ruta) => ruta.fulfill({ status: 200, contentType: 'image/png', body: PNG });
const sinCaratula = (extra) => ({ title: 'Cancion de prueba 1', channel: 'Canal E2E', thumbnail: '', addedAt: '2026-10-01T10:00:00Z', ...extra });

test('147 · una canción con su id y sin carátula recibe la de YouTube al arrancar, una sola vez', async ({ page }) => {
    await ytimgFalso(page, conImagen);
    await abrirApp(page);
    await sembrar(page, [sinCaratula({ src: 'idb://conid', videoId: 'aaaaaaaaaaa' })]);
    await page.reload();

    const miniatura = 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg';
    await expect.poll(async () => (await leerDeApp(page, 'ytdl_library'))?.[0]?.thumbnail, { timeout: 15_000 }).toBe(miniatura);
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryList .library-item-thumb').first()).toHaveAttribute('src', miniatura);
    expect((await leerDeApp(page, 'ytdl_caratulas_intentadas'))?.['idb://conid']).toBeTruthy();

    // Ya la tiene: al volver a abrir, nadie la pide para comprobar nada
    await page.reload();
    await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });
    await page.waitForTimeout(3000);
    const fetchs = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.initiatorType === 'fetch' && e.name.includes('i.ytimg.com')).length);
    expect(fetchs, 'sin comprobaciones repetidas').toBe(0);
});

test('148 · si el vídeo ya no existe (404), la canción se queda sin carátula y no se vuelve a intentar', async ({ page }) => {
    await ytimgFalso(page, (ruta) => ruta.fulfill({ status: 404, contentType: 'image/jpeg', body: PNG }));
    await abrirApp(page);
    await sembrar(page, [sinCaratula({ src: 'idb://borrado', videoId: 'aaaaaaaaaaa' })]);
    await page.reload();

    await expect.poll(async () => (await leerDeApp(page, 'ytdl_caratulas_intentadas'))?.['idb://borrado'], { timeout: 15_000 }).toBeTruthy();
    expect((await leerDeApp(page, 'ytdl_library'))[0].thumbnail).toBe('');

    await page.reload();
    await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });
    await page.waitForTimeout(3000);
    const fetchs = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.initiatorType === 'fetch' && e.name.includes('i.ytimg.com')).length);
    expect(fetchs, 'sin comprobaciones repetidas').toBe(0);
});

test('149 · sin red no se gasta el intento: la próxima vez que se abre la app, la recupera', async ({ page }) => {
    let conRed = false;
    await ytimgFalso(page, (ruta) => (conRed ? conImagen(ruta) : ruta.abort('internetdisconnected')));
    await abrirApp(page);
    await sembrar(page, [sinCaratula({ src: 'idb://sinred', videoId: 'aaaaaaaaaaa' })]);
    await page.reload();
    await expect(page.locator('#libraryCount')).toContainText(/\d/, { timeout: 15_000 });
    await page.waitForTimeout(4000);
    expect((await leerDeApp(page, 'ytdl_caratulas_intentadas'))?.['idb://sinred']).toBeFalsy();

    conRed = true;
    await page.reload();
    await expect.poll(async () => (await leerDeApp(page, 'ytdl_library'))?.[0]?.thumbnail, { timeout: 15_000 })
        .toBe('https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg');
});

test('150 · sin cuenta, una canción sin id ni carátula se busca una vez: con título, artista y duración que encajan, recibe id y carátula; si no encajan, nada', async ({ page }) => {
    // El buscador sin cuenta empieza a los 20 s de arrancar, y espera 6 s entre búsqueda y búsqueda
    test.setTimeout(150_000);
    await ytimgFalso(page, conImagen);
    const buscadas = [];
    await page.route('**/api/search', async (ruta) => { buscadas.push(ruta.request().postDataJSON().query); await ruta.continue(); });
    await abrirApp(page);
    await sembrar(page, [
        // La de pruebas dura 210 s y es de «Canal E2E»
        sinCaratula({ src: 'idb://encaja', videoId: 'lib_encaja', title: 'Cancion de prueba 2', duration: 211 }),
        // Mismo título, otra duración: otra versión, no se asigna
        sinCaratula({ src: 'idb://otra', videoId: 'lib_otra', title: 'Cancion de prueba 1', duration: 300 }),
        // Ya tiene carátula: sin cuenta, no se busca
        sinCaratula({ src: 'idb://concaratula', videoId: 'lib_concar', title: 'Tono uno', thumbnail: 'data:image/png;base64,AAAA' }),
    ]);
    await page.reload();

    await expect.poll(async () => (await leerDeApp(page, 'ytdl_library'))?.find((s) => s.src === 'idb://encaja')?.thumbnail, { timeout: 60_000 })
        .toBe('https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg');
    await expect.poll(() => buscadas.length, { timeout: 30_000 }).toBe(2);
    const biblioteca = await leerDeApp(page, 'ytdl_library');
    expect(biblioteca.find((s) => s.src === 'idb://encaja').videoId).toBe('bbbbbbbbbbb');
    const otra = biblioteca.find((s) => s.src === 'idb://otra');
    expect([otra.videoId, otra.thumbnail]).toEqual(['lib_otra', '']);
    expect(buscadas.sort()).toEqual(['Cancion de prueba 1', 'Cancion de prueba 2']);

    // Una vez en la vida de cada canción: al volver a abrir, ninguna búsqueda más
    await page.reload();
    await page.waitForTimeout(30_000);
    expect(buscadas).toHaveLength(2);
});

// ============================================================
// 151 · El scroll de una lista no va a trozos mientras se descarga (tras la 2.2.0)
// ============================================================

test('151 · mientras se descarga una lista larga, no se repinta en mitad del scroll; al parar, se pone al día', async ({ page }) => {
    const extra = Array.from({ length: 40 }, (_, i) => ({ id: `scroll${String(i).padStart(5, '0')}`, title: `Lista larga ${i}`, channel: 'Canal Largo', duration: 180 }));
    fs.writeFileSync(LISTA_EXTRA, JSON.stringify(extra));
    try {
        await abrirApp(page);
        await pedir(page, 'https://www.youtube.com/playlist?list=PLe2eScrollLista1');
        await expect(page.locator('#playlistList .selector-fila')).toHaveCount(43, { timeout: 30_000 });
        await page.locator('#ytCrearListaNombre').fill('Larga');
        await page.click('#downloadSelectedBtn');

        await irA(page, 'playlistsView');
        await page.locator('.playlist-card', { hasText: 'Larga' }).click();
        const filas = page.locator('#playlistDetailList .library-item');
        await expect(filas).toHaveCount(43);
        const enNube = () => page.locator('#playlistDetailList .library-item-nube').count();
        const alEmpezar = await enNube();
        expect(alEmpezar).toBeGreaterThan(30);

        // Scroll continuo (una rueda cada 120 ms) durante 6 s, mientras siguen llegando descargas
        await page.locator('#playlistDetailList').hover();
        await page.evaluate(() => { window.__fila = document.querySelector('#playlistDetailList .library-item'); });
        const guardadas = () => page.evaluate(() => new Promise((ok) => {
            const r = indexedDB.open('YTMusicDB');
            r.onsuccess = () => { const g = r.result.transaction('kv_store').objectStore('kv_store').get('ytdl_library'); g.onsuccess = () => ok((g.result || []).length); };
        }));
        const descargadasAntes = await guardadas();
        for (let i = 0; i < 50; i++) {
            await page.mouse.wheel(0, i % 10 < 5 ? 140 : -140);
            await page.waitForTimeout(120);
        }
        // Han llegado descargas, pero la lista no se ha repintado en mitad del scroll
        expect(await page.evaluate(() => window.__fila.isConnected), 'repintada en mitad del scroll').toBe(true);
        expect(await guardadas(), 'han llegado descargas mientras tanto').toBeGreaterThan(descargadasAntes);

        // Al parar, se pone al día: acaban todas descargadas
        await expect.poll(enNube, { timeout: ESPERA_DESCARGA }).toBe(0);
        expect(await page.evaluate(() => window.__fila.isConnected)).toBe(false);
    } finally {
        fs.rmSync(LISTA_EXTRA, { force: true });
    }
});

test('152 · Sortable no se carga al arrancar ni deja un touchmove bloqueante: solo mientras se mueve a mano', async ({ page }) => {
    await listaConDos(page, 'Para mover');
    // Con un touchmove no pasivo en el documento, el scroll de toda la app
    // pasaba por el hilo principal: en la APK iba a tirones
    const cdp = await page.context().newCDPSession(page);
    const touchmoveBloqueante = async () => {
        const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
        const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
        return listeners.some((l) => l.type === 'touchmove' && !l.passive);
    };
    const titulos = async () => (await page.locator('#playlistDetailList .library-item-title').allTextContents()).map((t) => t.trim());
    expect(await page.evaluate(() => typeof window.Sortable)).toBe('undefined');
    expect(await touchmoveBloqueante()).toBe(false);

    const antes = await titulos();
    await menuDeLista(page, '#plActionReorder');
    await page.click('#plOrdenSheet [data-criterio="a-mano"]');
    await expect(page.locator('#playlistDetailList .pl-drag-handle').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => typeof window.Sortable)).toBe('function');
    await expect.poll(touchmoveBloqueante).toBe(true);

    // La segunda sube arrastrando su asa
    const asas = page.locator('#playlistDetailList .pl-drag-handle');
    const origen = await asas.nth(1).boundingBox();
    const destino = await asas.nth(0).boundingBox();
    await page.mouse.move(origen.x + origen.width / 2, origen.y + origen.height / 2);
    await page.mouse.down();
    await page.mouse.move(origen.x + origen.width / 2, origen.y + origen.height / 2 - 10, { steps: 4 });
    await page.mouse.move(destino.x + destino.width / 2, destino.y + 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(titulos).toEqual([antes[1], antes[0]]);

    await page.click('#plReorderDone');
    await expect.poll(touchmoveBloqueante).toBe(false);
    expect(await titulos()).toEqual([antes[1], antes[0]]);
});

// ============================================================
// Movimiento en el compositor (plan 28)
// ============================================================

/** Lo que queda puesto tras un vuelo: animaciones vivas, carátulas ocultas, la barra a medio fundir. */
const restosDelVuelo = (page) => page.evaluate(() => ({
    // Las de Web Animations del reproductor, la barra o el clon (ya fuera de la página)
    animaciones: document.getAnimations().filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)
        && (!a.effect.target.isConnected || a.effect.target.closest('#fullPlayer, #playerBar'))).length,
    miniatura: document.getElementById('playerThumb').style.visibility,
    caratula: document.getElementById('fullPlayerThumb').style.visibility,
    barra: getComputedStyle(document.getElementById('playerBar')).opacity,
    presencia: document.getElementById('fullPlayer').dataset.presence ?? null,
}));

const sinRestos = { animaciones: 0, miniatura: '', caratula: '', barra: '1', presencia: null };

test('153 · cerrar mientras se abre y abrir mientras se cierra terminan donde se pidió, sin restos', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await sonando(page);
    const fp = page.locator('#fullPlayer');
    const clon = page.locator('.flight-clone');

    // Cerrar mientras se abre
    await page.locator('#playerThumb').click();
    await expect(clon).toHaveCount(1, { timeout: 1_000 });
    await page.keyboard.press('Escape');
    await expect(fp).toHaveClass(/fp-hidden/, { timeout: 3_000 });
    await expect(clon).toHaveCount(0);
    expect(await restosDelVuelo(page)).toEqual(sinRestos);
    expect(await page.evaluate(() => history.state?.type)).toBe('view');

    // Abrir mientras se cierra (la F, que antes lo daba por abierto y lo volvía a cerrar)
    await abrirReproductor(page);
    await page.keyboard.press('Escape');
    await expect(clon).toHaveCount(1, { timeout: 1_000 });
    await page.keyboard.press('f');
    await expect(clon).toHaveCount(0, { timeout: 3_000 });
    await page.waitForTimeout(300);
    await expect(fp, 'terminó cerrado aunque se pidió abrir').not.toHaveClass(/fp-hidden/);
    expect(await restosDelVuelo(page)).toEqual(sinRestos);
    // Y el «atrás» lo vuelve a cerrar: se apuntó en el historial
    await page.goBack();
    await expect(fp).toHaveClass(/fp-hidden/, { timeout: 3_000 });

    // Tres veces seguidas, sin esperar: vale la última (abierto)
    for (let i = 0; i < 3; i++) { await page.keyboard.press('f'); await page.waitForTimeout(60); }
    await expect(clon).toHaveCount(0, { timeout: 3_000 });
    await page.waitForTimeout(300);
    await expect(fp).not.toHaveClass(/fp-hidden/);
    expect(await restosDelVuelo(page)).toEqual(sinRestos);
});

test('154 · pausar y reanudar sin esperar deja la carátula a su tamaño, y soltar un arrastre no deja nada puesto', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await sonando(page);
    await abrirReproductor(page);

    // La carátula cambia de rumbo a mitad: acaba donde manda el último toque
    for (let i = 0; i < 3; i++) { await page.click('#fullPlayerPlay'); await page.waitForTimeout(90); }
    await expect.poll(() => escalaCaratula(page), { message: 'en pausa no se encoge', timeout: 3_000 }).toBeCloseTo(0.82, 2);
    await page.click('#fullPlayerPlay');
    await page.waitForTimeout(90);
    await page.click('#fullPlayerPlay');
    await page.waitForTimeout(90);
    await page.click('#fullPlayerPlay');
    await expect.poll(() => escalaCaratula(page), { message: 'al reproducir no vuelve', timeout: 3_000 }).toBeCloseTo(1, 2);
    await expect.poll(() => restosDelVuelo(page).then((r) => r.animaciones), { timeout: 3_000 }).toBe(0);

    // Un arrastre corto vuelve a su sitio; uno largo cierra. Sin animaciones ni estilos de más
    const fp = page.locator('#fullPlayer');
    await page.mouse.move(760, 300);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(760, 300 + i * 10); await page.waitForTimeout(40); }
    await page.mouse.up();
    await expect.poll(() => restosDelVuelo(page).then((r) => r.animaciones), { timeout: 3_000 }).toBe(0);
    await expect(fp).not.toHaveClass(/fp-hidden/);
    expect(await fp.evaluate((el) => [el.style.transform, el.style.borderRadius, el.dataset.presence ?? null])).toEqual(['', '', null]);

    await page.mouse.move(760, 300);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(760, 300 + i * 30);
    await page.mouse.up();
    await expect(fp).toHaveClass(/fp-hidden/, { timeout: 3_000 });
    await expect.poll(() => restosDelVuelo(page), { timeout: 3_000 }).toEqual(sinRestos);
    expect(await fp.evaluate((el) => [el.style.transform, el.style.borderRadius])).toEqual(['', '']);
});

// ============================================================
// 160-161 · Lo que no se ve no se mueve, y las hojas en el compositor (plan 28, T5 y T6)
// ============================================================

test('160 · el fondo con la carátula se para con el reproductor completo abierto, y al arrastrarlo, cerrarlo o frenar la música vuelve o se para', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await sonando(page);
    const fondo = page.locator('#fondoAmbiente');
    await expect(fondo).toHaveClass(/activo/, { timeout: 10_000 });
    const estado = () => fondo.evaluate((el) => el.getAnimations({ subtree: true }).map((a) => a.playState));
    const velocidad = () => fondo.evaluate((el) => el.getAnimations({ subtree: true }).map((a) => a.playbackRate));
    await expect.poll(estado).toEqual(['running', 'running']);

    // Abierto y quieto lo tapa entero: pausado, con su velocidad de siempre
    await abrirReproductor(page);
    await expect.poll(estado, { timeout: 3_000 }).toEqual(['paused', 'paused']);
    expect(await velocidad()).toEqual([1, 1]);

    // Al arrastrarlo se ve lo de debajo: se mueve mientras dura, y al volver se para otra vez
    await page.mouse.move(760, 300);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(760, 300 + i * 10); await page.waitForTimeout(40); }
    expect(await estado()).toEqual(['running', 'running']);
    await page.mouse.up();
    await expect.poll(estado, { timeout: 3_000 }).toEqual(['paused', 'paused']);

    // Cerrado, vuelve a moverse donde estaba
    await page.keyboard.press('Escape');
    await expect(page.locator('#fullPlayer')).toHaveClass(/fp-hidden/);
    await expect.poll(estado).toEqual(['running', 'running']);

    // Con la música en pausa frena y, ya quieto, se para del todo (a velocidad 0 el compositor seguía contando)
    await page.evaluate(() => document.getElementById('mainAudio').pause());
    await expect.poll(estado, { timeout: 3_000 }).toEqual(['paused', 'paused']);
    expect(await velocidad()).toEqual([0, 0]);
    await page.evaluate(() => document.getElementById('mainAudio').play());
    await expect.poll(estado, { timeout: 3_000 }).toEqual(['running', 'running']);
});

test.describe('161 · en el móvil', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('161 · una hoja soltada a medio arrastrar vuelve a su sitio con Web Animations y no deja nada puesto', async ({ page, context }) => {
        await abrirApp(page);
        await page.locator('#navProfile').click();
        const hoja = page.locator('#ajustesSheet');
        const panel = hoja.locator('.auth-modal-content');
        await expect(hoja).toBeVisible();
        await page.waitForTimeout(800);

        const asa = await hoja.locator('.hoja-asa').boundingBox();
        const x = asa.x + asa.width / 2, y0 = asa.y + asa.height / 2;
        const cdp = await context.newCDPSession(page);
        const toque = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
        await toque('touchStart', y0);
        for (let i = 1; i <= 6; i++) { await toque('touchMove', y0 + i * 10); await page.waitForTimeout(40); }
        await toque('touchEnd');

        // La vuelta: una animación de Web Animations (no una transición de CSS), con la curva del muelle fotograma a fotograma
        const vuelta = await page.waitForFunction(() => {
            const el = document.querySelector('#ajustesSheet .auth-modal-content');
            const a = el.getAnimations().find((x) => !('transitionProperty' in x) && !('animationName' in x));
            return a && { easing: a.effect.getTiming().easing, fotogramas: a.effect.getKeyframes().length, primera: a.effect.getKeyframes()[0].transform };
        }, null, { polling: 'raf', timeout: 2_000 }).then((h) => h.jsonValue());
        expect(vuelta.easing).toBe('linear');
        expect(vuelta.fotogramas).toBeGreaterThan(5);
        expect(vuelta.primera).toMatch(/^translateY\((?!0px)/);

        // Al llegar: en su sitio, sin animaciones ni estilos de más, y abierta
        await expect.poll(() => panel.evaluate((el) => [el.getAnimations().length, el.style.transform, el.closest('.auth-modal').dataset.arrastre ?? null]), { timeout: 3_000 })
            .toEqual([0, '', null]);
        await expect(hoja).toBeVisible();
    });
});

// ============================================================
// Escuchar desde la nube (plan 29, T1-T3)
// ============================================================

/**
 * Una lista con «Tono uno» descargado y, si se pide, los otros dos tonos en la
 * nube (como los deja una importación sin descargar). Los tonos duran 6 s: se
 * ve enseguida el paso a la siguiente.
 */
async function listaConNube(page, nombre, { conDescargada = true } = {}) {
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/watch?v=ddddddddddd');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
    await page.evaluate(async ({ nombre, conDescargada }) => {
        const tx = (modo) => new Promise((ok) => { const r = indexedDB.open('YTMusicDB'); r.onsuccess = () => ok(r.result.transaction('kv_store', modo).objectStore('kv_store')); });
        const leer = async (clave) => new Promise(async (ok) => { const g = (await tx('readonly')).get(clave); g.onsuccess = () => ok(g.result); });
        const [tonoUno] = await leer('ytdl_library');
        const nube = (id, title) => ({ videoId: id, title, channel: 'Canal Tonos', artist: '', track: '', duration: 6, src: `nube://${id}`, thumbnail: '', nube: true });
        const songs = [...(conDescargada ? [{ ...tonoUno }] : []), nube('eeeeeeeeeee', 'Tono dos'), nube('fffffffffff', 'Tono fuerte')];
        const listas = (await leer('ytdl_playlists')) || [];
        await new Promise(async (ok) => { const p = (await tx('readwrite')).put([...listas, { id: '1790000000777', name: nombre, description: '', songs, createdAt: new Date().toISOString() }], 'ytdl_playlists'); p.onsuccess = ok; });
        // La ventana «Tu música, de verdad tuya» ya vista: la prueban sus recorridos (T5)
        localStorage.setItem('nube_tuya_vista', '1');
    }, { nombre, conDescargada });
    await page.reload();
    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: nombre }).click();
    await expect(page.locator('#playlistDetailName')).toHaveText(nombre);
}

test('157 · una lista mezclada suena entera: primero la descargada y después las de la nube, ya preparadas', async ({ page }) => {
    await listaConNube(page, 'Mezclada');
    await expect(page.locator('#plEnLaNube')).toHaveText('2 canciones suenan desde la nube');
    await page.click('#plPlayBtn');
    await expect(page.locator('#playerTitle')).toHaveText('Tono uno', { timeout: 10_000 });
    // Mientras suena, la siguiente de la nube se prepara y su fila lo dice
    await expect(page.locator('#playlistDetailList .library-item.nube-preparada')).not.toHaveCount(0, { timeout: 15_000 });
    // Al acabar, sigue la de la nube sin esperar, con su marca y «Guardar»
    await expect(page.locator('#playerTitle')).toHaveText('Tono dos', { timeout: 20_000 });
    await expect(page.locator('#playerBar [data-radio-marca]')).toHaveText('Desde la nube');
    await expect(page.locator('#playerBar [data-radio-marca]')).toBeVisible();
    await expect(page.locator('#playerBarRadioSave')).toBeVisible();
    await expect(page.locator('#playerTitle')).toHaveText('Tono fuerte', { timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-preparando-nube'))).toBe(false);
});

test('158 · una lista solo de nube enseña que se prepara y empieza a sonar', async ({ page }) => {
    await listaConNube(page, 'Solo nube', { conDescargada: false });
    await page.click('#plPlayBtn');
    await expect(page.locator('.nube-preparando')).toContainText('Preparando la primera canción…');
    await expect(page.locator('html')).toHaveAttribute('data-preparando-nube', '');
    await expect(page.locator('#playerTitle')).toHaveText('Tono dos');
    await expect(page.locator('.nube-preparando')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => !document.getElementById('mainAudio').paused), { timeout: 10_000 }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-preparando-nube'))).toBe(false);
});

test('159 · en aleatorio, primero suena la descargada y después las de la nube', async ({ page }) => {
    await listaConNube(page, 'Aleatoria');
    await page.click('#plShuffleBtn');
    await page.click('#plPlayBtn');
    await expect(page.locator('#playerTitle')).toHaveText('Tono uno', { timeout: 10_000 });
    await expect(page.locator('#playerTitle')).toHaveText(/Tono (dos|fuerte)/, { timeout: 20_000 });
});

test('162 · «Guardar» en el mini reproductor lleva a la biblioteca la que suena desde la nube, sin volver a descargarla', async ({ page }) => {
    await listaConNube(page, 'Para guardar', { conDescargada: false });
    await page.click('#plPlayBtn');
    await expect(page.locator('#playerTitle')).toHaveText('Tono dos');
    await expect(page.locator('#playerBarRadioSave')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { document.getElementById('mainAudio').loop = true; });
    await page.click('#playerBarRadioSave');
    await expect(page.locator('#playerBarRadioSave')).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('#playerBar [data-radio-marca]')).toBeHidden();
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 2);
    await expect(page.locator('#libraryList .library-item', { hasText: 'Tono dos' })).not.toHaveClass(/library-item-nube/);
});

test('170 · si la nube no responde, una de la nube no suena: se avisa y no se queda dando vueltas', async ({ page }) => {
    await listaConNube(page, 'Sin nube', { conDescargada: false });
    let pedidas = 0;
    await page.route('**/api/start-download', (r) => { pedidas++; return r.abort(); });
    await page.click('#plPlayBtn');
    await expect(page.locator('.aviso-flotante')).toContainText('no está descargada', { timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-preparando-nube')), { timeout: 10_000 }).toBe(false);
    // Las dos de la lista se intentan y se para: no recorre la lista una y otra vez
    await page.waitForTimeout(2000);
    expect(pedidas).toBeLessThanOrEqual(3);
});

// ============================================================
// 163-169 · Que lo tuyo sea tuyo (plan 29, T4-T7)
// ============================================================

/** tuyo.js se carga en reposo: se espera a que esté (su fichero ya pedido). */
async function tuyoCargado(page) {
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((e) => /\/assets\/tuyo-[\w-]+\.js/.test(e.name))), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(400);
}

/** Lo que avisa el reproductor cuando empieza a sonar una canción desde la nube. */
const sonarDesdeLaNube = (page, song) => page.evaluate((s) => document.dispatchEvent(new CustomEvent('suena-desde-la-nube', { detail: s })), song);

/** «Crear solo la lista, sin descargar» con la lista de pruebas: sus tres canciones, en la nube. */
async function listaSoloNube(page, nombre) {
    await pedir(page, 'https://www.youtube.com/playlist?list=PLe2eSoloNube01');
    await expect(page.locator('#playlistSelector')).toBeVisible({ timeout: 30_000 });
    await page.locator('#ytCrearListaNombre').fill(nombre);
    await page.click('#ytSoloLista');
    await expect(page.locator('#playlistSelector')).toBeHidden();
    await expect.poll(async () => ((await leerDeApp(page, 'ytdl_playlists')) ?? []).find((l) => l.name === nombre)?.songs?.length ?? 0).toBe(3);
    return (await leerDeApp(page, 'ytdl_playlists')).find((l) => l.name === nombre).songs;
}

/** Escuchas enteras ya hechas de una canción, en el registro de escuchas. */
const escuchasEnteras = (page, videoId, n, segundos) => page.evaluate(([id, cuantas, s]) => new Promise((ok, ko) => {
    const r = indexedDB.open('YTMusicDB');
    r.onsuccess = () => {
        const tx = r.result.transaction('escuchas', 'readwrite');
        for (let i = 0; i < cuantas; i++) tx.objectStore('escuchas').add({ videoId: id, segundos: s, t: Date.now() - (i + 1) * 3600_000 });
        tx.oncomplete = ok; tx.onerror = ko;
    };
}), [videoId, n, segundos]);

/** Sin la ventana de la primera vez (ya vista), para probar lo demás. */
const ventanaYaVista = (page) => page.evaluate(() => localStorage.setItem('nube_tuya_vista', '1'));

test('163 · «Crear solo la lista, sin descargar» crea la lista con todo en la nube, sin descargar nada y sin cuenta', async ({ page }) => {
    const descargas = [];
    page.on('request', (r) => { if (/\/api\/(lotes|start-download)/.test(r.url())) descargas.push(r.url()); });
    await abrirApp(page);
    await pedir(page, 'https://www.youtube.com/playlist?list=PLe2eSoloLista01');
    await expect(page.locator('#playlistSelector')).toBeVisible({ timeout: 30_000 });
    const solo = page.locator('#ytSoloLista');
    await expect(solo).toBeVisible();
    await expect(solo).toContainText('Crear solo la lista, sin descargar');
    await page.locator('#ytCrearListaNombre').fill('Para escuchar luego');
    await solo.click();
    await expect(page.locator('#playlistSelector')).toBeHidden();

    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Para escuchar luego' }).click();
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(3);
    await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(3);
    await expect(page.locator('#playlistDetailList .nube-guardar').first()).toHaveText(/desde la nube/i);
    await page.waitForTimeout(1500);
    expect(descargas, 'no se descarga nada').toEqual([]);
    expect((await leerDeApp(page, 'ytdl_library')) ?? []).toHaveLength(0);

    // Y después se descarga con «Descargar las que faltan» (antes no bajaba las que solo estaban en la lista)
    await page.locator('#plDescargarFaltan').click();
    await expect(page.locator('#playlistDetailList .library-item-nube')).toHaveCount(0, { timeout: ESPERA_DESCARGA });
    await expect(page.locator('#playlistDetailList .library-item')).toHaveCount(3);
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 3);
});

test('164 · la primera vez que algo suena desde la nube sale «Tu música, de verdad tuya», una sola vez; el texto queda en Ajustes', async ({ page }) => {
    await abrirApp(page);
    await tuyoCargado(page);
    const cancion = { videoId: 'aaaaaaaaaaa', src: 'nube://aaaaaaaaaaa', nube: true, title: 'Cancion de prueba 1', duration: 180 };
    const ventana = page.locator('#confirmModal');
    await sonarDesdeLaNube(page, cancion);
    await expect(ventana).toBeVisible();
    await expect(page.locator('#confirmTitle')).toHaveText('Tu música, de verdad tuya');
    await expect(page.locator('#confirmMessage')).toContainText('La radio y las canciones en la nube suenan desde la nube');
    await expect(page.locator('#confirmNoBtn')).toBeHidden();
    await page.locator('#confirmYesBtn').click();
    await expect(ventana).toBeHidden();

    // Una sola vez por dispositivo: ni otra vez ahora ni al volver a abrir la app
    await sonarDesdeLaNube(page, cancion);
    await page.waitForTimeout(600);
    await expect(ventana).toBeHidden();
    await page.reload();
    await tuyoCargado(page);
    await sonarDesdeLaNube(page, cancion);
    await page.waitForTimeout(600);
    await expect(ventana).toBeHidden();

    // En Ajustes, «Por qué descargar» con el mismo texto
    await abrirAjustes(page);
    await expect(page.locator('#ajustesTuMusica')).toContainText('Tu música');
    await page.locator('#ajustesPorQue summary').click();
    await expect(page.locator('#ajustesPorQue')).toContainText('Si algo te gusta, guárdalo.');
});

test('165 · tras 3 escuchas enteras desde la nube propone guardarla (nunca la primera vez que suena) y «Guardar» la lleva a la biblioteca', async ({ page }) => {
    await abrirApp(page);
    await ventanaYaVista(page);
    const [cancion] = await listaSoloNube(page, 'Tres veces');
    await escuchasEnteras(page, cancion.videoId, 3, cancion.duration || 200);
    await tuyoCargado(page);
    const aviso = page.locator('.deshacer');

    await sonarDesdeLaNube(page, cancion);
    await page.waitForTimeout(800);
    await expect(aviso, 'la primera vez que suena, nada').toBeHidden();

    await sonarDesdeLaNube(page, cancion);
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('La has escuchado 3 veces. ¿La guardas?');
    await aviso.locator('.deshacer-boton', { hasText: 'Guardar' }).click();
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
});

test('166 · darle a favorito a una canción desde la nube propone guardarla, también la primera vez que suena, sin guardarla sola; descartada, no vuelve', async ({ page }) => {
    await abrirApp(page);
    await ventanaYaVista(page);
    const [cancion] = await listaSoloNube(page, 'Con corazón');
    await tuyoCargado(page);
    // Una sola vez: el favorito no espera a la segunda (decidido el 2026-10-26)
    await sonarDesdeLaNube(page, cancion);

    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Con corazón' }).click();
    const corazon = page.locator('#playlistDetailList .library-item').first().locator('.favorite-btn');
    await corazon.click();
    const aviso = page.locator('.deshacer');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('¿La guardas? Así será tuya y sonará sin conexión');
    await page.waitForTimeout(500);
    expect((await leerDeApp(page, 'ytdl_library')) ?? [], 'no se guarda sola').toHaveLength(0);

    // Cerrado con su X: esa canción ya no se propone
    await aviso.locator('.deshacer-cerrar').click();
    await expect(aviso).toBeHidden();
    await page.waitForTimeout(500);
    await corazon.click();
    await page.waitForTimeout(500);
    await corazon.click();
    await page.waitForTimeout(800);
    await expect(page.locator('.deshacer', { hasText: '¿La guardas?' })).toHaveCount(0);
});

test('167 · como mucho 2 recordatorios de guardar al día: el tercero no sale', async ({ page }) => {
    await abrirApp(page);
    await ventanaYaVista(page);
    const canciones = await listaSoloNube(page, 'Tres recordatorios');
    for (const c of canciones) await escuchasEnteras(page, c.videoId, 3, c.duration || 200);
    await tuyoCargado(page);
    const aviso = page.locator('.deshacer');
    for (const [i, c] of canciones.entries()) {
        await sonarDesdeLaNube(page, c);
        await sonarDesdeLaNube(page, c);
        if (i < 2) {
            await expect(aviso, `el recordatorio ${i + 1}`).toBeVisible();
            await aviso.locator('.deshacer-cerrar').click();
            await expect(aviso).toBeHidden();
        } else {
            await page.waitForTimeout(1000);
            await expect(aviso, 'el tercero del día').toBeHidden();
        }
    }
});

test('168 · la marca «Desde la nube» de una fila la guarda: tocarla no la reproduce y la canción pasa a la biblioteca', async ({ page }) => {
    await abrirApp(page);
    await ventanaYaVista(page);
    await listaSoloNube(page, 'Marcas');
    await tuyoCargado(page);
    await irA(page, 'playlistsView');
    await page.locator('.playlist-card', { hasText: 'Marcas' }).click();
    const marca = page.locator('#playlistDetailList .library-item').first().locator('.nube-guardar');
    await expect(marca).toHaveText(/desde la nube/i);
    await marca.click();
    await expect(page.locator('#playerBar')).toBeHidden();
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 1);
});

test('169 · Ajustes y la biblioteca cuentan lo tuyo y lo de la nube, y «Descargar las que faltan» las baja', async ({ page }) => {
    await abrirApp(page);
    await listaSoloNube(page, 'Recuento');
    await tuyoCargado(page);
    // En la biblioteca, junto a lo descargado (también las que solo están en una lista)
    await irA(page, 'libraryView');
    await expect(page.locator('#libraryRecuento')).toHaveText(/·\s*3 desde la nube/);
    await abrirAjustes(page);
    await expect(page.locator('#ajustesRecuento')).toHaveText('0 canciones tuyas · 3 desde la nube');
    await page.locator('#ajustesFaltanBtn').click();
    await page.keyboard.press('Escape');
    await irA(page, 'libraryView');
    await esperarBiblioteca(page, 3);
    await expect(page.locator('#libraryRecuento')).toBeHidden();
    await abrirAjustes(page);
    await expect(page.locator('#ajustesRecuento')).toHaveText('3 canciones tuyas');
    await expect(page.locator('#ajustesFaltanBtn')).toHaveCount(0);
});
