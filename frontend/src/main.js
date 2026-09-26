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
import { alQuedarseSinEspacio, migrateStorage, StorageModule } from './core/storage.js';
import { comprobarActualizacionApk, setupDownloadModal } from './features/apk.js';
import { auth } from './features/auth.js';
import { initFormularioDescarga, initSelectorFormato, urlInput } from './features/download/download.js';
import { initPanelFavoritos, renderFavorites } from './features/favorites/panel.js';
import { FavoritesModule } from './features/favorites/store.js';
import { initHistorial, renderHistory } from './features/history.js';
import { LibraryModule } from './features/library/library.js';
import { initSwipeEvents } from './features/library/swipe.js';
import { enlazarMiniReproductor } from './features/player/player.js';
import { PlaylistModule } from './features/playlists/playlists.js';
import { initVistaPrevia } from './features/preview.js';
import { initListaYoutube } from './features/youtube-playlist.js';
import { i18n } from './i18n/language-manager.js';
import { initComportamientoNativo } from './native/app-shell.js';
import { initDeepLinks } from './native/deep-link.js';
import { setupNativeImporter } from './features/library/importer.js';
import { runNativeRecovery } from './features/library/recovery.js';
import { initAlertaPropia } from './ui/alert.js';
import { FLAGS } from './ui/flags.js';
import { showStatus } from './ui/status.js';
import { enlazarBotonTema, initTheme } from './ui/theme.js';

// Banderas propias en lugar de PNG de flagcdn.com (plan 09, T6)
document.querySelectorAll('img[data-flag]').forEach(img => { img.src = FLAGS[img.dataset.flag] ?? ''; });

// Equipos modestos: cristal con la mitad de desenfoque y sin grano (plan 09, T21)
if ((navigator.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4) {
    document.documentElement.dataset.glass = 'lite';
}

alQuedarseSinEspacio(() => showStatus(i18n.t('storage_full'), 'error'));
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

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    renderHistory();
    renderFavorites();
    auth.init();  // Check session and load server data if logged in
    setTimeout(() => urlInput.focus(), 600);
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

    // Interruptor para desactivar SSE sin desplegar código nuevo:
    //   StorageModule.set('use_sse', false)
    globalThis.USE_SSE = (await StorageModule.get('use_sse')) !== false;
    StorageModule.requestPersistence(); // sin await: no debe retrasar el arranque
    // Una sola instancia: antes se creaba aquí una segunda que traducía la
    // interfaz, mientras i18n —la que usan los 70 textos generados desde
    // JavaScript: avisos, contadores, descargas— se quedaba siempre en castellano
    await i18n.init();

    await FavoritesModule.init();

    auth.init();

    setTimeout(runNativeRecovery, 800);

    await LibraryModule.render();
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
