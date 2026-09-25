/**
 * Los recorridos críticos de la aplicación (plan 06, T7), más los avisos de
 * descarga (8 y 9) y los del movimiento (10 a 17, plan 09).
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

import { test, expect } from '@playwright/test';

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

    // "Nueva Playlist" abre un modal propio con su campo de texto
    await modal.locator('#addToPlaylistCreateNewBtn').click();

    const modalCrear = page.locator('#createNewPlaylistModal');
    await expect(modalCrear).toBeVisible({ timeout: 10_000 });
    await page.fill('#newPlaylistNameInput', 'Mi lista E2E');
    await page.click('#confirmCreateNewPlaylistBtn');

    // El modal de crear se cierra solo. El de "añadir a playlist" se queda
    // abierto a propósito, con la lista recién creada ya marcada, así que se
    // cierra como lo haría el usuario.
    await expect(modalCrear).toBeHidden({ timeout: 10_000 });
    await expect(modal).toContainText('Mi lista E2E', { timeout: 10_000 });
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
    await page.route('**/lrclib.net/**', r => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ syncedLyrics: lrc, plainLyrics: 'x' }]),
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

test.describe('en el móvil', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

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
