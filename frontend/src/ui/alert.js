/**
 * window.alert con el modal de la app en lugar del diálogo del navegador.
 */

import { NavigationModule } from './navigation.js';

export function initAlertaPropia() {
    window.alert = function (message) {
        const alertModal = document.getElementById('customAlertModal');
        const alertMsg = document.getElementById('customAlertMessage');
        const alertBtn = document.getElementById('customAlertOkBtn');

        if (alertModal && alertMsg && alertBtn) {
            alertMsg.textContent = message;
            alertModal.classList.remove('hidden');
            NavigationModule.pushOverlayState('customAlertModal');

            const closeAlert = () => {
                NavigationModule.closeOverlay();
            };

            alertBtn.onclick = closeAlert;
            alertModal.querySelector('.auth-modal-backdrop').onclick = closeAlert;
        } else {
            // Safe console fallback during load phases
            console.warn('[CustomAlert] DOM not ready, message:', message);
        }
    };
}
