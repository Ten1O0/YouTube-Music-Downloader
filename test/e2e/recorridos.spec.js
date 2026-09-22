/**
 * Los siete recorridos críticos de la aplicación (plan 06, T7).
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
// 8 · La tarjeta flotante de progreso aparece durante la descarga
// ============================================================

/**
 * Durante mucho tiempo esta tarjeta no se mostró nunca, ni en escritorio ni en
 * móvil, porque la llamada que la crea estaba dentro de un
 * `if (globalThis.queueManager !== undefined)` que jamás se cumple. El CSS
 * estaba bien; simplemente nadie creaba el elemento. Como el fallo es
 * silencioso —la descarga termina igual— solo se nota mirando la pantalla, así
 * que conviene que lo mire alguien que no se olvide.
 */
test('8 · la tarjeta de progreso se muestra al descargar', async ({ page }) => {
    await abrirApp(page);

    const panel = page.locator('#queuePanel');
    await expect(panel).toHaveClass(/hidden/);

    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');

    // Aparece la tarjeta, con su barra de progreso
    const tarjeta = page.locator('#activeDownloads .queue-card');
    await expect(tarjeta, 'la tarjeta de progreso no apareció')
        .toBeVisible({ timeout: 20_000 });
    await expect(tarjeta.locator('.q-progress-fill')).toBeAttached();
    await expect(panel).not.toHaveClass(/hidden/);

    // Y está donde debe: fija y arriba del todo.
    const posicion = await panel.evaluate((el) => {
        const s = getComputedStyle(el);
        return { position: s.position, top: parseFloat(s.top), zIndex: parseInt(s.zIndex, 10) };
    });
    expect(posicion.position).toBe('fixed');
    expect(posicion.top).toBeLessThan(60);
    expect(posicion.zIndex).toBeGreaterThan(1000);

    // Al terminar se retira sola.
    await expect(tarjeta, 'la tarjeta se quedó pegada tras completarse')
        .toBeHidden({ timeout: 30_000 });
});

// ============================================================
// 9 · Lo mismo en pantalla de móvil
// ============================================================

test('9 · en móvil la tarjeta ocupa el ancho de la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrirApp(page);

    await pedir(page, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');

    const tarjeta = page.locator('#activeDownloads .queue-card');
    await expect(tarjeta, 'la tarjeta no apareció en móvil')
        .toBeVisible({ timeout: 20_000 });

    // La tarjeta entra con una animación que la desplaza, así que se mide
    // cuando ya ha aterrizado; si no, se comprueba una posición de paso.
    // La animación es `forwards`, así que al terminar deja la matriz identidad
    // en vez de quitar el transform: se comprueban las dos formas.
    await expect.poll(
        async () => tarjeta.evaluate((el) => {
            const t = getComputedStyle(el).transform;
            return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
        }),
        { message: 'la animación de entrada no terminó', timeout: 5_000 }
    ).toBe(true);

    // No debe salirse de la pantalla ni quedar como una columna estrecha
    // pegada a la derecha: en móvil la media query la estira de lado a lado.
    const caja = await tarjeta.boundingBox();
    expect(caja.x, 'la tarjeta se sale por la izquierda').toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width, 'la tarjeta se sale por la derecha').toBeLessThanOrEqual(390);
    expect(caja.width, 'la tarjeta es demasiado estrecha para un móvil').toBeGreaterThan(250);
});
