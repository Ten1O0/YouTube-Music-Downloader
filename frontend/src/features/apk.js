/**
 * Lo que la web dice de la APK: la ventana de descarga, el aviso de versión
 * nueva y lo que necesitan los ajustes para enseñar la versión.
 */

import { apiBase, isNative } from '../config/env.js';
import { i18n } from '../i18n/language-manager.js';
import { CLAVE_DESCARTE, hayActualizacion, hayVersionNueva, novedadesDesde } from '../ui/app-update.js';
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

let pedida = null;
/**
 * La última versión y su historial (/api/app/version, que lee
 * public/app-version.json). Una petición por arranque, compartida por el aviso
 * y los ajustes; si falla (sin conexión), la siguiente vez se vuelve a pedir.
 */
export function versionRemota() {
    if (navigator.onLine === false) return Promise.resolve(null);
    pedida ??= fetch(`${apiBase()}/api/app/version`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((remota) => {
            if (!remota) pedida = null;
            return remota;
        });
    return pedida;
}

/** La versión instalada de la APK, `{ versionName, versionCode }`, o null en la web. */
export async function versionInstalada() {
    const plugin = globalThis.Capacitor?.Plugins?.App;
    if (!isNative() || !plugin?.getInfo) return null;
    try {
        const info = await plugin.getInfo();
        return { versionName: String(info?.version ?? ''), versionCode: Number(info?.build) };
    } catch {
        return null;
    }
}

/** Abre la descarga de la última APK en el navegador del sistema. */
export function abrirDescargaApk(remota) {
    const url = remota?.url || `${apiBase()}/download`;
    const navegador = globalThis.Capacitor?.Plugins?.Browser;
    if (navegador?.open) navegador.open({ url });
    else globalThis.open(url, '_blank');
}

// ========================================
// Aviso de nueva versión de la APK (src/ui/app-update.js)
// ========================================
// La APK lleva la web dentro y no se actualiza al desplegar. Al arrancar, si
// hay conexión, pregunta al servidor por la última versión y, si es más nueva
// que la instalada, la anuncia con sus novedades. En la web no hace nada.
// Aunque se haya dicho «Ahora no», la versión nueva queda señalada en
// «Ajustes», desde donde se puede actualizar cuando se quiera.
export async function comprobarActualizacionApk() {
    if (!isNative() || navigator.onLine === false) return;
    try {
        const [instalada, remota] = await Promise.all([versionInstalada(), versionRemota()]);
        if (!instalada || !remota) return;
        if (hayVersionNueva({ instalada: instalada.versionCode, remota })) {
            document.dispatchEvent(new CustomEvent('version-nueva', { detail: remota }));
        }
        let descartada = null;
        try { descartada = JSON.parse(localStorage.getItem(CLAVE_DESCARTE)); } catch { /* sin datos */ }
        if (hayActualizacion({ instalada: instalada.versionCode, remota, descartada })) mostrarActualizacion(remota, instalada.versionCode);
    } catch (e) {
        // Sin conexión o servidor caído: se comprobará en el próximo arranque
        console.debug('[Actualización] no se pudo comprobar:', e);
    }
}

function mostrarActualizacion(remota, instalada, intentos = 0) {
    const modal = document.getElementById('appUpdateModal');
    if (!modal) return;
    // Si hay otro modal abierto (los permisos, por ejemplo), espera a que se cierre
    if (modales.arriba()) {
        if (intentos < 30) setTimeout(() => mostrarActualizacion(remota, instalada, intentos + 1), 4000);
        return;
    }
    // Lo nuevo de todas las versiones que faltan, cada una con su título, en
    // una zona con scroll: los botones quedan siempre a la vista
    const versiones = novedadesDesde(remota, instalada, i18n.currentLang);
    document.getElementById('appUpdateVersion').textContent = versiones.length > 1
        ? i18n.t('update_since', { v: remota.versionName, n: versiones.length })
        : i18n.t('update_version', { v: remota.versionName });
    const zona = document.getElementById('appUpdateNotes');
    zona.replaceChildren(...versiones.map((version) => {
        const seccion = document.createElement('section');
        seccion.className = 'actualizacion-version';
        if (versiones.length > 1) {
            const titulo = document.createElement('h3');
            titulo.textContent = i18n.t('update_version', { v: version.versionName });
            seccion.append(titulo);
        }
        const lista = document.createElement('ul');
        lista.append(...version.notas.map((texto) => {
            const li = document.createElement('li');
            li.textContent = texto;
            return li;
        }));
        seccion.append(lista);
        return seccion;
    }));
    zona.scrollTop = 0;

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
        abrirDescargaApk(remota);
        cerrar();
    };

    modal.classList.remove('hidden');
    NavigationModule.pushOverlayState('appUpdateModal');
}
