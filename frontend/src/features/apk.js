/**
 * Lo que la web dice de la APK: la ventana de descarga y el aviso de versión
 * nueva.
 */

import { apiBase, isNative } from '../config/env.js';
import { i18n } from '../i18n/language-manager.js';
import { CLAVE_DESCARTE, hayActualizacion, novedadesEn } from '../ui/app-update.js';
import { closeOverlayOrHideModal, modales, NavigationModule } from '../ui/navigation.js';

export function setupDownloadModal() {
    const modal = document.getElementById('downloadApkModal');
    const closeBtn = document.getElementById('downloadModalClose');
    const backdrop = modal?.querySelector('.auth-modal-backdrop');

    if (!modal) return;

    document.querySelectorAll('.android-app-btn-el').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            modal.classList.remove('hidden');
            NavigationModule.pushOverlayState('downloadApkModal');
        });
    });

    const close = () => closeOverlayOrHideModal(modal);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
}

// ========================================
// Aviso de nueva versión de la APK (src/ui/app-update.js)
// ========================================
// La APK lleva la web dentro y no se actualiza al desplegar. Al arrancar, si
// hay conexión, pregunta al servidor por la última versión y, si es más nueva
// que la instalada, la anuncia con sus novedades. En la web no hace nada.
export async function comprobarActualizacionApk() {
    const plugin = globalThis.Capacitor?.Plugins?.App;
    if (!isNative() || !plugin?.getInfo || navigator.onLine === false) return;
    try {
        const [info, remota] = await Promise.all([
            plugin.getInfo(),
            fetch(`${apiBase()}/api/app/version`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)),
        ]);
        let descartada = null;
        try { descartada = JSON.parse(localStorage.getItem(CLAVE_DESCARTE)); } catch { /* sin datos */ }
        if (hayActualizacion({ instalada: info?.build, remota, descartada })) mostrarActualizacion(remota);
    } catch (e) {
        // Sin conexión o servidor caído: se comprobará en el próximo arranque
        console.debug('[Actualización] no se pudo comprobar:', e);
    }
}

function mostrarActualizacion(remota, intentos = 0) {
    const modal = document.getElementById('appUpdateModal');
    if (!modal) return;
    // Si hay otro modal abierto (los permisos, por ejemplo), espera a que se cierre
    if (modales.arriba()) {
        if (intentos < 30) setTimeout(() => mostrarActualizacion(remota, intentos + 1), 4000);
        return;
    }
    document.getElementById('appUpdateVersion').textContent = i18n.t('update_version', { v: remota.versionName });
    document.getElementById('appUpdateNotes').replaceChildren(...novedadesEn(remota, i18n.currentLang).map((texto) => {
        const li = document.createElement('li');
        li.textContent = texto;
        return li;
    }));

    const cerrar = () => closeOverlayOrHideModal(modal);
    const aparcar = () => {
        try {
            localStorage.setItem(CLAVE_DESCARTE, JSON.stringify({ versionCode: Number(remota.versionCode), fecha: Date.now() }));
        } catch { /* sin almacenamiento: volverá a salir */ }
        cerrar();
    };
    document.getElementById('appUpdateLater').onclick = aparcar;
    document.getElementById('appUpdateClose').onclick = aparcar;
    modal.querySelector('.auth-modal-backdrop').onclick = aparcar;
    document.getElementById('appUpdateDownload').onclick = () => {
        const url = remota.url || `${apiBase()}/download`;
        const navegador = globalThis.Capacitor?.Plugins?.Browser;
        if (navegador?.open) navegador.open({ url });
        else globalThis.open(url, '_blank');
        cerrar();
    };

    modal.classList.remove('hidden');
    NavigationModule.pushOverlayState('appUpdateModal');
}
