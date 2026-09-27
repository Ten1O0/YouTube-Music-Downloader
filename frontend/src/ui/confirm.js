/**
 * Una pregunta con dos respuestas, con el modal de la app (plan 13): borrados
 * que llegan de otro dispositivo, sustituir los datos con una copia…
 * Devuelve una promesa con true (sí) o false (no, o cerrarla).
 */

import { NavigationModule } from './navigation.js';

export function confirmar({ titulo, mensaje, si, no, icono = 'help', peligro = false }) {
    const modal = document.getElementById('confirmModal');
    if (!modal) return Promise.resolve(false);
    document.getElementById('confirmTitle').textContent = titulo;
    document.getElementById('confirmMessage').textContent = mensaje;
    document.getElementById('confirmIcon').textContent = icono;
    const botonSi = document.getElementById('confirmYesBtn');
    const botonNo = document.getElementById('confirmNoBtn');
    botonSi.textContent = si;
    botonNo.textContent = no;
    modal.classList.toggle('confirm-peligro', peligro);

    return new Promise((resolve) => {
        let respuesta = false;
        const observador = new MutationObserver(() => {
            if (!modal.classList.contains('hidden')) return;
            observador.disconnect();
            resolve(respuesta);
        });
        observador.observe(modal, { attributes: true, attributeFilter: ['class'] });
        botonSi.onclick = () => { respuesta = true; NavigationModule.closeOverlay(); };
        botonNo.onclick = () => NavigationModule.closeOverlay();
        modal.querySelector('.auth-modal-backdrop').onclick = () => NavigationModule.closeOverlay();
        modal.classList.remove('hidden');
        NavigationModule.pushOverlayState('confirmModal');
    });
}
