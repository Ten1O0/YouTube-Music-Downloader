/**
 * La APK se comporta como una app y no como una web: sin selección de texto
 * ni menú en las imágenes, y los enlaces externos en el navegador del sistema.
 */

import { isNative } from '../config/env.js';

// Comportamiento de app en la APK (plan 09, T20): el CSS lo usa para quitar
// la selección, el menú de las imágenes y el estiramiento de la página
export function initComportamientoNativo() {
    if (!isNative()) return;
    document.documentElement.classList.add('is-native');
    // Los enlaces a otras webs (el café, p. ej.) se abren en el navegador del
    // sistema. Dentro de la app sustituían a la propia app y el botón atrás de
    // Android ya no devolvía a ella: había que cerrarla.
    document.addEventListener('click', (e) => {
        const enlace = e.target.closest?.('a[href]');
        if (!enlace || !/^https?:/i.test(enlace.href)) return;
        if (new URL(enlace.href).host === location.host) return;
        const navegador = globalThis.Capacitor?.Plugins?.Browser;
        if (!navegador?.open) return;
        e.preventDefault();
        navegador.open({ url: enlace.href });
    });
    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest?.('img, .full-player-artwork')) e.preventDefault();
    });
}

/**
 * Quita la pantalla de arranque de la APK en cuanto la web ha pintado lo
 * primero (plan 10, T6). Si algo fallara antes, la configuración nativa la
 * quita sola a los 4 s: nunca una app atascada en su arranque.
 */
export function ocultarArranque() {
    if (!isNative()) return;
    globalThis.Capacitor?.Plugins?.SplashScreen?.hide?.({ fadeOutDuration: 250 })?.catch?.(() => { /* ya estaba oculta */ });
}
