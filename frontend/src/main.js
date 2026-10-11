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
import './features/lyrics.js';

import { repairLegacyBlobEntries } from './core/audio-store.js';
import { alQuedarseSinEspacio, migrarTitulos, migrateStorage, MIGRATION_FLAG_KEY, StorageModule, TITLES_FLAG_KEY } from './core/storage.js';
import { migrarMiniaturasAlArrancar } from './core/miniaturas.js';
import { auth } from './features/auth.js';
import { initFormularioDescarga, initSelectorFormato, recogerPendientes, urlInput } from './features/download/download.js';
import { recogerLotesPendientes } from './features/download/lotes.js';
import { initPanelFavoritos, renderFavorites } from './features/favorites/panel.js';
import { FavoritesModule } from './features/favorites/store.js';
import { initHistorial, renderHistory } from './features/history.js';
import { LibraryModule } from './features/library/library.js';
import { initArtistas } from './features/library/artists.js';
import { initSwipeEvents } from './features/library/swipe.js';
import { initEntradaSeleccion } from './features/seleccion/entrada.js';
import { PlayerModule } from './features/player/player.js';
import { initNube } from './features/sync/nube.js';
import { iniciarSincronizacion } from './features/sync/sync.js';
import { cargarAjustes, initAjustesReproduccion } from './features/player/settings.js';
import { initAjustes } from './features/ajustes.js';
import { initRadio } from './features/radio/puente.js';
import { PlaylistModule } from './features/playlists/playlists.js';
import { initListaYoutube } from './features/youtube-playlist.js';
import { i18n } from './i18n/language-manager.js';
import { initComportamientoNativo, ocultarArranque } from './native/app-shell.js';
import { initDeepLinks } from './native/deep-link.js';
import { initAvisosSistema } from './native/notifications.js';
import { initSeguimiento } from './features/follows.js';
import { setupNativeImporter } from './features/library/importar-entrada.js';
import { cargarHistoria, initEntradaResumen } from './features/wrapped/entrada.js';
import { initAlertaPropia } from './ui/alert.js';
import { alPrimerToque, diferido } from './ui/diferido.js';
import { FLAGS } from './ui/flags.js';
import { modales, NavigationModule } from './ui/navigation.js';
import { rellenarEstadoVacio } from './ui/empty-states.js';
import { initAtajos } from './ui/shortcuts.js';
import { abrirAyudaAtajos, initAyudaAtajos } from './ui/shortcuts-help.js';
import { showStatus } from './ui/status.js';
import { PRIORIDAD, soltarHilo, tarea } from './ui/tareas.js';
import { enlazarBotonTema, initTheme } from './ui/theme.js';

// Lo que no hace falta para arrancar se carga aparte (plan 19, T11): al primer
// toque o, antes, cuando la app queda en reposo
const cargarEditor = diferido(() => import('./features/library/editor.js').then((m) => m.initEditor()));
// El botón ⋮ de la pantalla completa (plan 21, T5)
const cargarOpciones = diferido(() => import('./features/player/opciones.js').then((m) => m.initOpciones()));
const cargarTusDatos = diferido(() => import('./features/sync/datos.js').then((m) => m.initTusDatos()));
const cargarImportar = diferido(() => import('./features/import/import.js').then((m) => m.initImportarListas()));
const cargarApk = diferido(() => import('./features/apk.js').then((m) => { m.setupDownloadModal(); return m; }));
alPrimerToque('#fullPlayerEdit', cargarEditor);
alPrimerToque('#fullPlayerMore', cargarOpciones);
alPrimerToque('#libraryDataBtn, #sidebarDataBtn', cargarTusDatos);
alPrimerToque('#importPlaylistBtn', cargarImportar);
alPrimerToque('.android-app-btn-el', cargarApk);

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
// Avisos del sistema en la APK (plan 14, T5): tocarlos abre la lista o la biblioteca
initAvisosSistema({
    nombre: () => i18n.t('notif_channel'),
    alTocar: (destino) => {
        if (destino?.vista === 'playlist' && typeof destino.id === 'string') PlaylistModule.openPlaylistDetail(destino.id);
        else NavigationModule.switchView('libraryView');
    },
});

// Pantalla de inicio: descarga, lista de YouTube, favoritos e historial
initFormularioDescarga();
initListaYoutube();
initPanelFavoritos();
initHistorial();
enlazarBotonTema();

// Estados vacíos con ilustración (plan 10, T7). Los contenedores ya están en
// index.html y las listas los muestran u ocultan como siempre
rellenarEstadoVacio(document.getElementById('libraryEmpty'), {
    ilustracion: 'biblioteca', titulo: 'empty_lib_t', texto: 'empty_lib_d',
    accion: { clave: 'act_search_music', alPulsar: () => { NavigationModule.switchView('homeView'); urlInput.focus(); } },
    // Y traer una lista de otra app (plan 24, P12)
    acciones: [{ clave: 'import_list_title', secundaria: true, alPulsar: () => { NavigationModule.switchView('playlistsView'); document.getElementById('importPlaylistBtn')?.click(); } }],
});
rellenarEstadoVacio(document.getElementById('playlistsEmpty'), {
    ilustracion: 'listas', titulo: 'empty_pls_t', texto: 'empty_pls_d',
    accion: { clave: 'act_create_playlist', alPulsar: () => document.getElementById('createPlaylistBtn')?.click() },
});
// El de una lista vacía lo rellena su vista al abrir la primera (playlists/detalle/vista.js, plan 24)

// Atajos de teclado (plan 10, T4)
initAyudaAtajos();
initAjustesReproduccion();
initAjustes({ cargarApk });
initRadio();
initNube();
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

// Las migraciones de una sola vez, apuntadas cuando las tres están hechas: los
// arranques siguientes no vuelven a leer sus tres marcas (plan 19, T12). Si se
// borra localStorage, se comprueban otra vez, que no hace daño
const MIGRACIONES_HECHAS = 'ytdl_migraciones_hechas_v1';

async function migraciones() {
    try {
        if (localStorage.getItem(MIGRACIONES_HECHAS)) return;
    } catch { /* sin localStorage: se comprueban */ }
    await migrateStorage();
    await repairLegacyBlobEntries();
    await migrarTitulos();
    // Una que falló no deja su marca y se reintenta en el próximo arranque
    const marcas = await Promise.all([MIGRATION_FLAG_KEY, 'ytdl_blob_repair_v1', TITLES_FLAG_KEY]
        .map((clave) => StorageModule.get(clave).catch(() => null)));
    if (marcas.every(Boolean)) {
        try { localStorage.setItem(MIGRACIONES_HECHAS, '1'); } catch { /* se comprobarán otra vez */ }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Primer tiempo (plan 19, T12): solo lo que hace falta para pintar la
    // biblioteca con su idioma y sus corazones
    await migraciones();
    await Promise.all([
        cargarAjustes(),
        // Interruptor para desactivar SSE sin desplegar código nuevo:
        //   StorageModule.set('use_sse', false)
        StorageModule.get('use_sse').then((v) => { globalThis.USE_SSE = v !== false; }),
        // Una sola instancia: antes se creaba aquí una segunda que traducía la
        // interfaz, mientras i18n —la que usan los 70 textos generados desde
        // JavaScript: avisos, contadores, descargas— se quedaba siempre en castellano
        i18n.init(),
    ]);
    StorageModule.requestPersistence(); // sin await: no debe retrasar el arranque

    await FavoritesModule.init();

    // La sesión, una sola vez y aquí: después del idioma y de los favoritos,
    // que es lo que necesita la sincronización (plan 10, T2)
    auth.init().then(() => iniciarSincronizacion());

    // Recuperar y limpiar la biblioteca de la APK: se carga aparte (plan 25), en la web no hace nada
    if (globalThis.Capacitor?.isNative) {
        setTimeout(() => tarea(() => import('./features/library/recovery.js').then((m) => m.runNativeRecovery())), 800);
    }

    await LibraryModule.render();
    ocultarArranque();

    // Segundo tiempo: lo demás, en el mismo orden que siempre, pero cediendo
    // entre paso y paso a quien ya está tocando la biblioteca
    await soltarHilo();
    await initArtistas();
    await soltarHilo();
    // Lo que se quedó a medias o sin recoger al cerrar la app (plan 14, T2)
    recogerPendientes().catch((e) => console.warn('[Pendientes]', e));
    // Y los lotes que se quedaron a medias (plan 20)
    recogerLotesPendientes().catch((e) => console.warn('[Lotes]', e));
    // Medir en segundo plano la sonoridad de lo ya descargado (plan 12, T5)
    // Se carga aparte (plan 24): trabaja en segundo plano y no hace falta para arrancar
    import('./features/player/loudness-backfill.js').then((m) => m.iniciarMedicionSonoridad())
        .catch((e) => console.warn('[Sonoridad]', e));
    // Y la duración de lo descargado antes del plan 22, que no la guardaba (plan 23): se carga aparte
    import('./features/library/duraciones.js').then((m) => m.iniciarRellenoDuraciones())
        .catch((e) => console.warn('[Duración]', e));
    PlaylistModule.layoutMode = await StorageModule.get('ytdl_playlist_layout') || 'grid';
    // Canciones ya descargadas que en alguna lista seguían «en la nube» (arreglado tras el plan 14)
    await LibraryModule.sacarDeLaNubeEnListas().catch((e) => console.warn('[Listas]', e));
    await soltarHilo();
    // Las miniaturas de la APK, fuera de las canciones (plan 19, T2): una vez y en segundo plano
    migrarMiniaturasAlArrancar(StorageModule).then(async ({ hechas }) => {
        if (hechas) { await LibraryModule.render(); await PlaylistModule.renderGrid(); }
    }).catch((e) => console.warn('[Miniaturas]', e));
    await PlaylistModule.renderGrid();
    await LibraryModule.updateCount();
    // Listas de YouTube seguidas: lo nuevo, poco después de arrancar (plan 14, T4)
    initSeguimiento();

    setupNativeImporter();
    // Tu año en música: la tarjeta de Inicio y la entrada de «Tus datos» (plan 17, T6)
    initEntradaResumen().catch((e) => console.warn('[Resumen]', e));
    // Tras el arranque, para no competir con el aviso de permisos
    setTimeout(() => tarea(async () => (await cargarApk()).comprobarActualizacionApk()).catch(() => {}), 3000);

    // Lo que se carga aparte, ya en reposo: el primer toque no espera, y en la
    // web queda en la caché para cuando no haya conexión
    for (const cargar of [cargarTusDatos, cargarEditor, cargarOpciones, cargarImportar, cargarApk, cargarHistoria]) {
        tarea(cargar, { prioridad: PRIORIDAD.baja }).catch((e) => console.warn('[Carga]', e));
    }
});

// Los gestos de las filas y la entrada a la selección múltiple (plan 24)
const initFilas = () => { initSwipeEvents(); initEntradaSeleccion(); };
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initFilas();
} else {
    document.addEventListener('DOMContentLoaded', initFilas);
}

document.addEventListener('DOMContentLoaded', () => {
    initSelectorFormato();
});
