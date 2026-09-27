/**
 * La hoja con la lista de atajos de teclado (plan 10, T4).
 *
 * Aparte de shortcuts.js para que aquel siga siendo puro y se pruebe sin DOM.
 */

import { NavigationModule } from './navigation.js';

/** La hoja con la lista de atajos, que se abre con «?» o desde la barra lateral. */
export function abrirAyudaAtajos() {
    const hoja = document.getElementById('shortcutsSheet');
    if (!hoja || !hoja.classList.contains('hidden')) return;
    hoja.classList.remove('hidden');
    NavigationModule.pushOverlayState('shortcutsSheet');
}

export function initAyudaAtajos() {
    const hoja = document.getElementById('shortcutsSheet');
    if (!hoja) return;
    document.getElementById('sidebarShortcutsBtn')?.addEventListener('click', abrirAyudaAtajos);
    const cerrar = () => NavigationModule.closeOverlay();
    document.getElementById('shortcutsClose')?.addEventListener('click', cerrar);
    hoja.querySelector('.auth-modal-backdrop')?.addEventListener('click', cerrar);
}
