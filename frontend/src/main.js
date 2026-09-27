/**
 * Arranque de la web y de la APK: el orden en que se inicia todo.
 *
 * Cada módulo declara lo suyo y no hace nada al cargarse más allá de crear sus
 * piezas; lo que enlaza eventos o toca la página se llama desde aquí, en el
 * mismo orden que tenía cuando todo vivía en un único app.js.
 */

// Orden de evaluación. Varios módulos crean al cargarse su instancia (el
// reproductor, la navegación, las listas…) y registran sus escuchadores: se
// importan en el orden que tenían dentro del antiguo app.js para conservarlo.
import './ui/navigation.js';
import './features/player/player.js';
import './native/media-session.js';
import './features/library/library.js';
import './features/player/ui.js';
import './features/playlists/helpers.js';
import './features/library/recovery.js';
import './features/library/importer.js';
import './features/library/swipe.js';
import './features/permissions.js';
import './core/storage.js';
import './features/favorites/store.js';
import './features/download/download.js';
import './features/search.js';
import './features/youtube-playlist.js';
import './features/history.js';
import './features/favorites/panel.js';
import './i18n/language-manager.js';
import './features/auth.js';
import './core/audio-url-cache.js';
import './features/download/progress.js';
import './features/preview.js';
import './features/download/queue.js';
import './features/playlists/playlists.js';
import './features/apk.js';
import './features/lyrics.js';

import { repairLegacyBlobEntries } from './core/audio-store.js';
import { alQuedarseSinEspacio, migrarTitulos, migrateStorage, StorageModule } from './core/storage.js';
import { comprobarActualizacionApk, setupDownloadModal } from './features/apk.js';
import { auth } from './features/auth.js';
import { initFormularioDescarga, initSelectorFormato, urlInput } from './features/download/download.js';
import { initPanelFavoritos, renderFavorites } from './features/favorites/panel.js';
import { FavoritesModule } from './features/favorites/store.js';
import { initHistorial, renderHistory } from './features/history.js';
import { LibraryModule } from './features/library/library.js';
import { initArtistas } from './features/library/artists.js';
import { initEditor } from './features/library/editor.js';
import { initSwipeEvents } from './features/library/swipe.js';
import { enlazarMiniReproductor, PlayerModule } from './features/player/player.js';
import { PlaylistModule } from './features/playlists/playlists.js';
import { initVistaPrevia } from './features/preview.js';
import { initListaYoutube } from './features/youtube-playlist.js';
import { i18n } from './i18n/language-manager.js';
import { initComportamientoNativo, ocultarArranque } from './native/app-shell.js';
import { initDeepLinks } from './native/deep-link.js';
import { setupNativeImporter } from './features/library/importer.js';
import { runNativeRecovery } from './features/library/recovery.js';
import { initAlertaPropia } from './ui/alert.js';
import { FLAGS } from './ui/flags.js';
import { modales, NavigationModule } from './ui/navigation.js';
import { rellenarEstadoVacio } from './ui/empty-states.js';
import { initAtajos } from './ui/shortcuts.js';
import { abrirAyudaAtajos, initAyudaAtajos } from './ui/shortcuts-help.js';
import { showStatus } from './ui/status.js';
import { enlazarBotonTema, initTheme } from './ui/theme.js';

// Banderas propias en lugar de PNG de flagcdn.com (plan 09, T6)
document.querySelectorAll('img[data-flag]').forEach(img => { img.src = FLAGS[img.dataset.flag] ?? ''; });

// Equipos modestos: cristal con la mitad de desenfoque y sin grano (plan 09, T21)
if ((navigator.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4) {
    document.documentElement.dataset.glass = 'lite';
}

alQuedarseSinEspacio(() => showStatus(i18n.t('storage_full'), 'error'));
// Otra pestaña con una versión anterior impide actualizar la base de datos (plan 11, T5)
globalThis.addEventListener('almacenamiento-bloqueado', () => showStatus(i18n.t('storage_blocked'), 'error'));
initComportamientoNativo();
initDeepLinks();
initAlertaPropia();

// Pantalla de inicio: descarga, lista de YouTube, favoritos e historial
initFormularioDescarga();
initListaYoutube();
initPanelFavoritos();
initHistorial();
enlazarBotonTema();
initVistaPrevia();

// Estados vacíos con ilustración (plan 10, T7). Los contenedores ya están en
// index.html y las listas los muestran u ocultan como siempre
rellenarEstadoVacio(document.getElementById('libraryEmpty'), {
    ilustracion: 'biblioteca', titulo: 'empty_lib_t', texto: 'empty_lib_d',
    accion: { clave: 'act_search_music', alPulsar: () => { NavigationModule.switchView('homeView'); urlInput.focus(); } },
});
rellenarEstadoVacio(document.getElementById('playlistsEmpty'), {
    ilustracion: 'listas', titulo: 'empty_pls_t', texto: 'empty_pls_d',
    accion: { clave: 'act_create_playlist', alPulsar: () => document.getElementById('createPlaylistBtn')?.click() },
});
rellenarEstadoVacio(document.getElementById('playlistDetailEmpty'), {
    ilustracion: 'lista', titulo: 'empty_pl_t', texto: 'empty_pl_d',
    accion: { clave: 'act_add_songs', alPulsar: () => document.getElementById('plActionAdd')?.click() },
});

// Atajos de teclado (plan 10, T4)
initAyudaAtajos();
initEditor();
initAtajos({
    reproducir: () => PlayerModule.togglePlay(),
    atras: () => PlayerModule.seekBy(-10),
    adelante: () => PlayerModule.seekBy(10),
    anterior: () => PlayerModule.prev(),
    siguiente: () => PlayerModule.next(),
    volumenMas: () => PlayerModule.cambiarVolumen(5),
    volumenMenos: () => PlayerModule.cambiarVolumen(-5),
    silencio: () => PlayerModule.alternarSilencio(),
    favorito: () => PlayerModule.alternarFavoritoActual(),
    pantallaCompleta: () => (PlayerModule.pantallaCompletaAbierta() ? PlayerModule.hideFullPlayer() : PlayerModule.showFullPlayer()),
    buscar: () => {
        if (PlayerModule.pantallaCompletaAbierta()) PlayerModule.hideFullPlayer();
        NavigationModule.switchView('homeView');
        urlInput.focus();
    },
    ayuda: abrirAyudaAtajos,
}, () => ({ modalAbierto: Boolean(modales.arriba()), hayCancion: PlayerModule.hayCancion() }));

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    renderHistory();
    renderFavorites();
    // Solo con ratón y teclado físico. En el móvil, enfocar por código no abre el
    // teclado pero sí activa la regla que oculta la barra de pestañas mientras
    // se escribe: la app arrancaba sin pestañas hasta tocar en otro sitio
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
        setTimeout(() => urlInput.focus(), 600);
    }
});

// El resplandor del fondo sigue al ratón
document.addEventListener('mousemove', (e) => {
    const glow = document.querySelector('.background-glow');
    if (glow) {
        const moveX = (e.clientX - window.innerWidth / 2) * 0.02;
        const moveY = (e.clientY - window.innerHeight / 2) * 0.02;
        glow.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    await migrateStorage();
    await repairLegacyBlobEntries();
    await migrarTitulos();

    // Interruptor para desactivar SSE sin desplegar código nuevo:
    //   StorageModule.set('use_sse', false)
    globalThis.USE_SSE = (await StorageModule.get('use_sse')) !== false;
    StorageModule.requestPersistence(); // sin await: no debe retrasar el arranque
    // Una sola instancia: antes se creaba aquí una segunda que traducía la
    // interfaz, mientras i18n —la que usan los 70 textos generados desde
    // JavaScript: avisos, contadores, descargas— se quedaba siempre en castellano
    await i18n.init();

    await FavoritesModule.init();

    // La sesión, una sola vez y aquí: después del idioma y de los favoritos,
    // que es lo que necesita la sincronización (plan 10, T2)
    auth.init();

    setTimeout(runNativeRecovery, 800);

    await LibraryModule.render();
    ocultarArranque();
    await initArtistas();
    PlaylistModule.layoutMode = await StorageModule.get('ytdl_playlist_layout') || 'grid';
    await PlaylistModule.renderGrid();
    await LibraryModule.updateCount();

    setupNativeImporter();
    setupDownloadModal();
    // Tras el arranque, para no competir con el aviso de permisos
    setTimeout(comprobarActualizacionApk, 3000);
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initSwipeEvents();
} else {
    document.addEventListener('DOMContentLoaded', initSwipeEvents);
}

document.addEventListener('DOMContentLoaded', () => {
    enlazarMiniReproductor();
    initSelectorFormato();
});
