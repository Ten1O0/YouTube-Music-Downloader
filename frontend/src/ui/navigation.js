/**
 * Navegación entre vistas, pila de capas (modales, hojas, reproductor) y el
 * botón atrás de Android.
 */

import { i18n } from '../i18n/language-manager.js';
import { staggerIn } from './motion/list.js';
import { createTabPill, direccionDeNavegacion, initCabeceraCompacta, rebotarIcono, transicionDeVista } from './nav.js';
import { initModales } from './sheets.js';
import { showStatus } from './status.js';

// Hojas, alertas y foco de los modales (plan 09, T17)
export const modales = initModales();

// Generic modal close utility to resolve SonarQube duplicate function issues
export function closeOverlayOrHideModal(modal) {
    NavigationModule.closeOverlay();
}

// ========================================
// NavigationModule — Control de Vistas y Back Button
// ========================================
export const NavigationModule = (() => {
    let currentView = 'homeView';

    // Initialize history state on load
    try {
        if (!window.history.state) {
            window.history.replaceState({ type: 'view', view: 'homeView' }, '', '');
        }
    } catch (e) { }

    // Vistas que ya se han visto en esta sesión: solo la primera vez hay
    // aparición escalonada (plan 09, T14)
    const vistasEscalonadas = new Set();

    // Detalles y la pestaña a la que pertenecen (plan 09, T18): entrar en uno
    // es un «push» y la pestaña de su padre sigue marcada mientras se ve
    const DETALLES = { playlistDetailView: 'playlistsView', artistDetailView: 'libraryView' };
    const main = document.querySelector('.main-content');
    const scrollDeVista = new Map();

    const pildoras = [...document.querySelectorAll('.bottom-nav, .sidebar-nav')].map(nav =>
        createTabPill(nav, { margen: nav.classList.contains('bottom-nav') ? 6 : 0 }));
    const cabecera = initCabeceraCompacta({
        cabecera: document.querySelector('.mobile-header-bar'),
        scroller: main,
        vistaActiva: () => currentView,
    });

    function marcarPestana(viewId) {
        const pestana = DETALLES[viewId] ?? viewId;
        document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === pestana);
        });
        document.querySelectorAll('.bottom-nav, .sidebar-nav').forEach((nav, i) => {
            pildoras[i].mover(nav.querySelector(`.nav-btn[data-view="${pestana}"]`));
        });
    }

    function switchView(viewId, pushToHistory = true) {
        if (viewId === currentView) return;

        const outgoing = document.getElementById(currentView);
        const incoming = document.getElementById(viewId);
        const direccion = direccionDeNavegacion(currentView, viewId, DETALLES);
        if (main) scrollDeVista.set(currentView, main.scrollTop);

        // Switch views instantly without delays or overlapping animations
        const aplicar = () => {
            if (outgoing) {
                outgoing.classList.add('hidden');
                outgoing.classList.remove('view-exit', 'view-enter');
                if (outgoing.fallbackTimeout) clearTimeout(outgoing.fallbackTimeout);
            }

            if (incoming) {
                incoming.classList.remove('hidden', 'view-exit', 'view-enter');
                if (incoming.fallbackTimeout) clearTimeout(incoming.fallbackTimeout);
                if (!vistasEscalonadas.has(viewId)) {
                    vistasEscalonadas.add(viewId);
                    requestAnimationFrame(() => staggerIn(incoming, '.library-item, .playlist-card, .result-item'));
                }
            }

            // Cada pestaña conserva su scroll; un detalle nuevo empieza arriba
            if (main) main.scrollTop = direccion === 'push' ? 0 : (scrollDeVista.get(viewId) ?? 0);
            cabecera.actualizar();
        };

        currentView = viewId;
        transicionDeVista(direccion, aplicar);
        marcarPestana(viewId);
        document.dispatchEvent(new CustomEvent('vista-cambiada', { detail: viewId }));

        if (pushToHistory) {
            try {
                window.history.pushState({ type: 'view', view: viewId }, '', '');
            } catch (e) { }
        }
    }

    // Parent map: defines where "back" goes from each view
    const viewParent = {
        'playlistDetailView': 'playlistsView',
        'artistDetailView': 'libraryView',
        'playlistsView': 'homeView',
        'libraryView': 'homeView'
    };

    // Pushes overlay state to history stack to prevent app exit on Back Button
    function pushOverlayState(overlayId) {
        try {
            window.history.pushState({ type: 'overlay', id: overlayId }, '', '');
        } catch (e) { }
    }

    // Una capa que se ha cerrado sola (con su botón, Escape o un gesto) deja
    // su entrada en el historial: se consume sin que el «atrás» que provoca
    // cierre otra cosa o cambie de vista
    let popsIgnorados = 0;
    function olvidarOverlay(id) {
        if (window.history.state?.type !== 'overlay' || window.history.state.id !== id) return;
        popsIgnorados++;
        try { window.history.back(); } catch { popsIgnorados--; }
    }

    // Salir de un detalle que ya no existe (una lista recién borrada): atrás
    // hasta dejar atrás sus capas y el propio detalle, sin contar las entradas.
    // Con history.go(-2), una hoja que se cerró sin gastar la suya dejaba un
    // paso de más y se quedaba en el detalle de la lista borrada (plan 23)
    let saliendoDe = null;
    let relojSalida = 0;
    function salirDelDetalle() {
        saliendoDe = currentView;
        retroceder();
    }
    function retroceder() {
        clearTimeout(relojSalida);
        // Al principio del historial no llega popstate: se va a la vista de arriba
        relojSalida = setTimeout(() => terminarSalida(null), 600);
        try { window.history.back(); } catch { terminarSalida(null); }
    }
    function terminarSalida(estado) {
        clearTimeout(relojSalida);
        const desde = saliendoDe;
        saliendoDe = null;
        if (!desde) return;
        if (estado?.type === 'view') switchView(estado.view, false);
        else switchView(DETALLES[desde] ?? viewParent[desde] ?? 'homeView');
    }

    // Programmatically trigger a history pop when user closes overlay manually
    function closeOverlay() {
        try {
            window.history.back();
        } catch (e) {
            // Visual fallback if history back fails
            goBack();
        }
    }

    // El reproductor se registra al crearse (player.js). Así la navegación no
    // lo importa y los dos módulos no dependen el uno del otro.
    let reproductor = null;
    function registrarReproductor(r) { reproductor = r; }

    // Capas que no son ventanas ni van al historial (la selección múltiple,
    // plan 24): el «atrás» de Android las cierra antes de cambiar de vista
    const capas = new Set();
    function registrarCapa(capa) {
        capas.add(capa);
        return () => capas.delete(capa);
    }

    function goBack() {
        // High priority: Close Playback Queue if open (salvo que haya otro modal encima)
        const pqSheet = document.getElementById('playbackQueueSheet');
        const modalEncima = modales.arriba()?.matches('.auth-modal');
        if (pqSheet && !pqSheet.classList.contains('hidden') && !modalEncima) {
            if (reproductor) {
                reproductor.closeQueuePanel();
            } else {
                pqSheet.classList.add('hidden');
            }
            return true;
        }

        // First priority: Close Full Player if open
        const fullPlayer = document.getElementById('fullPlayer');
        if (fullPlayer && !fullPlayer.classList.contains('fp-hidden') && !modalEncima) {
            if (reproductor) {
                reproductor.hideFullPlayer();
            } else {
                fullPlayer.classList.add('fp-hidden');
            }
            return true;
        }

        // Second priority: Close any open modal. El de arriba, no el primero
        // del DOM: con dos abiertos, atrás cerraba el de debajo (plan 09, T17)
        const openModal = modales.arriba()?.matches('.auth-modal') ? modales.arriba()
            : document.querySelector('.modal-container:not(.hidden), .auth-modal:not(.hidden)');
        if (openModal) {
            openModal.classList.add('hidden');
            document.body.style.overflow = '';
            return true;
        }

        // Después, las capas sin ventana (la selección múltiple)
        for (const capa of capas) {
            if (capa.abierta()) { capa.cerrar(); return true; }
        }

        // Third priority: Navigate to parent view
        const parent = viewParent[currentView];
        if (parent) {
            switchView(parent, false);
            return true;
        }

        return false; // Already on homeView — signal to exit
    }

    // Browser back button (popstate) for web
    window.addEventListener('popstate', (e) => {
        if (popsIgnorados > 0) {
            popsIgnorados--;
            return;
        }
        if (saliendoDe) {
            const capaODetalle = e.state?.type === 'overlay' || (e.state?.type === 'view' && e.state.view === saliendoDe);
            if (capaODetalle) retroceder();
            else terminarSalida(e.state);
            return;
        }
        if (e.state?.type === 'view') {
            // If the state is a view state, let's see if we have overlays to close first
            const hasOverlayOpen = (
                (document.getElementById('playbackQueueSheet') && !document.getElementById('playbackQueueSheet').classList.contains('hidden')) ||
                (document.getElementById('fullPlayer') && !document.getElementById('fullPlayer').classList.contains('fp-hidden')) ||
                document.querySelector('.modal-container:not(.hidden), .auth-modal:not(.hidden)')
            );
            if (hasOverlayOpen) {
                goBack();
            } else {
                switchView(e.state.view, false);
            }
        } else {
            // Either type is overlay, or it's null (user went back)
            goBack();
        }
    });

    // Capacitor Native Back Button Handling — Double-tap to exit
    let lastBackPress = 0;
    try {
        if (globalThis.Capacitor?.Plugins?.App) {
            globalThis.Capacitor.Plugins.App.addListener('backButton', () => {
                if (!goBack()) {
                    // We're on homeView with nothing to close — require double-tap
                    const now = Date.now();
                    if (now - lastBackPress < 2000) {
                        globalThis.Capacitor.Plugins.App.exitApp();
                    } else {
                        lastBackPress = now;
                        showStatus(i18n.t('exit_confirm'), 'info');
                    }
                }
            });
        }
    } catch (e) {
        console.warn('Capacitor App plugin not available:', e);
    }

    // Bind nav buttons. El icono rebota en cada toque
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            rebotarIcono(btn);

            // Con el reproductor abierto (en escritorio la barra lateral sigue a
            // la vista), elegir una sección lo recoge al mini reproductor, como
            // en Apple Music: la orden de ir a otro sitio manda
            const fp = document.getElementById('fullPlayer');
            if (fp && !fp.classList.contains('fp-hidden') && btn.dataset.view !== currentView) {
                // Su entrada del historial pasa a ser la de la vista nueva
                if (window.history.state?.type === 'overlay' && window.history.state.id === 'fullPlayer') {
                    window.history.replaceState({ type: 'view', view: btn.dataset.view }, '', '');
                    reproductor?.hideFullPlayer();
                    switchView(btn.dataset.view, false);
                    return;
                }
                reproductor?.hideFullPlayer();
            } else if (fp && !fp.classList.contains('fp-hidden')) {
                reproductor?.hideFullPlayer();
                return;
            }
            switchView(btn.dataset.view);
        });
    });
    marcarPestana(currentView);

    return { switchView, goBack, pushOverlayState, closeOverlay, olvidarOverlay, salirDelDetalle, registrarCapa, registrarReproductor, getCurrentView: () => currentView };
})();
