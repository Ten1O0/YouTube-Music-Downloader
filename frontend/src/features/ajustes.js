/**
 * Ajustes: la cuenta, la reproducción y la versión de la app, en una hoja.
 *
 * Se abre desde «Ajustes» en la barra inferior del móvil (antes «Perfil», que
 * solo iniciaba o cerraba la sesión) y desde la barra lateral. Reúne lo que
 * antes estaba repartido y añade la versión: en la APK, la instalada y, si
 * hay una más nueva, el botón para actualizar aunque se haya dicho «Ahora no»
 * al aviso; en la web, la última de la app Android. Y las novedades de todas
 * las versiones publicadas.
 *
 * Los controles de reproducción siguen siendo de player/settings.js; aquí
 * solo se abre la hoja. Lo de la versión viene de apk.js, que se carga aparte
 * (plan 19, T11): se pide al abrir.
 */

import { apiBase } from '../config/env.js';
import { i18n } from '../i18n/language-manager.js';
import { historialDeVersiones, hayVersionNueva } from '../ui/app-update.js';
import { confirmar } from '../ui/confirm.js';
import { NavigationModule } from '../ui/navigation.js';
import { showStatus } from '../ui/status.js';
import { auth } from './auth.js';

const $ = (id) => document.getElementById(id);

/** Pinta la cuenta: con sesión, quién eres y «Cerrar sesión»; sin ella, «Continuar con Google». */
function pintarCuenta() {
    const usuario = auth.isLoggedIn() ? auth.user : null;
    $('ajustesSinSesion').hidden = Boolean(usuario);
    $('ajustesConSesion').hidden = !usuario;
    $('ajustesBorrarCuenta').hidden = !usuario;
    if (!usuario) return;
    const avatar = $('ajustesAvatar');
    avatar.hidden = !usuario.picture;
    avatar.src = usuario.picture || '';
    avatar.onerror = () => { avatar.hidden = true; };
    $('ajustesNombre').textContent = usuario.name || usuario.email || '';
    $('ajustesCorreo').textContent = usuario.name ? (usuario.email || '') : '';
}

/**
 * «Borrar mi cuenta» (plan 21, T6): la cuenta y todo lo suyo en el servidor,
 * tras confirmarlo. Lo del dispositivo se queda; la sesión se cierra.
 */
async function borrarCuenta() {
    const si = await confirmar({
        titulo: i18n.t('delete_account_title'),
        mensaje: i18n.t('delete_account_message'),
        si: i18n.t('delete_account_yes'),
        no: i18n.t('t_cancel'),
        icono: 'delete',
        peligro: true,
    });
    if (!si) return;
    const boton = $('ajustesBorrarBtn');
    boton.disabled = true;
    try {
        const res = await fetch(`${apiBase()}/api/account`, { method: 'DELETE', headers: auth.getAuthHeaders() });
        // 401 o 404: la cuenta ya no está (o el token caducó con ella); igual se cierra la sesión
        if (!res.ok && res.status !== 401 && res.status !== 404) throw new Error(`HTTP ${res.status}`);
        auth.logout();
        showStatus(i18n.t('delete_account_done'), 'success');
    } catch (e) {
        console.warn('[Cuenta] No se pudo borrar:', e);
        showStatus(i18n.t('delete_account_error'), 'error');
    } finally {
        boton.disabled = false;
    }
}

/** Fecha «2026-09-29» como «29 sept 2026» en el idioma de la interfaz. */
function fechaCorta(fecha) {
    const d = new Date(`${fecha}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    try {
        return new Intl.DateTimeFormat(i18n.currentLang, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    } catch {
        return fecha;
    }
}

function pintarHistorial(remota, instalada) {
    const versiones = historialDeVersiones(remota, i18n.currentLang);
    $('ajustesHistorial').hidden = !versiones.length;
    $('ajustesVersiones').replaceChildren(...versiones.map((version) => {
        const seccion = document.createElement('section');
        seccion.className = 'actualizacion-version';
        const titulo = document.createElement('h4');
        titulo.textContent = [i18n.t('update_version', { v: version.versionName }), fechaCorta(version.fecha)].filter(Boolean).join(' · ');
        if (instalada?.versionCode === version.versionCode) {
            const tuya = document.createElement('span');
            tuya.className = 'ajustes-tuya';
            tuya.textContent = i18n.t('version_yours');
            titulo.append(' ', tuya);
        }
        const lista = document.createElement('ul');
        lista.append(...version.notas.map((texto) => {
            const li = document.createElement('li');
            li.textContent = texto;
            return li;
        }));
        seccion.append(titulo, lista);
        return seccion;
    }));
}

/**
 * Pinta la versión. En la APK: la instalada y, si hay otra más nueva, el
 * botón para actualizar. En la web: la última de la app Android y el botón
 * para descargarla. Sin conexión, lo que se sepa.
 */
async function pintarVersion(cargarApk) {
    const estado = $('ajustesVersionEstado');
    const actualizar = $('ajustesActualizarBtn');
    const descargar = $('ajustesDescargarBtn');
    let apk;
    try { apk = await cargarApk(); } catch { apk = null; }
    const [instalada, remota] = apk ? await Promise.all([apk.versionInstalada(), apk.versionRemota()]) : [null, null];

    const frases = [];
    if (instalada) frases.push(i18n.t('version_installed', { v: instalada.versionName }));
    const nueva = Boolean(instalada && remota && hayVersionNueva({ instalada: instalada.versionCode, remota }));
    if (!remota) frases.push(i18n.t('version_unknown'));
    else if (!instalada) frases.push(i18n.t('version_web', { v: remota.versionName }));
    else frases.push(nueva ? i18n.t('version_new', { v: remota.versionName }) : i18n.t('version_latest'));
    estado.textContent = frases.join(' ');

    actualizar.hidden = !nueva;
    actualizar.onclick = () => apk?.abrirDescargaApk(remota);
    descargar.hidden = Boolean(instalada) || !remota;
    marcarVersionNueva(nueva);
    if (remota) pintarHistorial(remota, instalada);
}

/** El punto en «Ajustes» cuando hay una versión nueva de la APK. */
function marcarVersionNueva(hay) {
    for (const id of ['navProfile', 'sidebarAjustesBtn']) $(id)?.classList.toggle('con-aviso', hay);
}

export function abrirAjustes({ cargarApk }) {
    const hoja = $('ajustesSheet');
    if (!hoja || !hoja.classList.contains('hidden')) return;
    pintarCuenta();
    hoja.classList.remove('hidden');
    NavigationModule.pushOverlayState('ajustesSheet');
    const contenido = hoja.querySelector('.auth-modal-content');
    if (contenido) contenido.scrollTop = 0;
    pintarVersion(cargarApk).catch((e) => console.warn('[Ajustes] versión:', e));
}

/** @param {{ cargarApk: () => Promise<typeof import('./apk.js')> }} o */
export function initAjustes({ cargarApk }) {
    const hoja = $('ajustesSheet');
    if (!hoja) return;
    const cerrar = () => NavigationModule.closeOverlay();
    $('ajustesClose')?.addEventListener('click', cerrar);
    hoja.querySelector('.auth-modal-backdrop')?.addEventListener('click', cerrar);
    $('navProfile')?.addEventListener('click', () => abrirAjustes({ cargarApk }));
    $('sidebarAjustesBtn')?.addEventListener('click', () => abrirAjustes({ cargarApk }));
    // Iniciar y cerrar sesión, encima de los ajustes: al volver, ya pintados
    $('ajustesLoginBtn')?.addEventListener('click', () => auth.showModal());
    $('ajustesLogoutBtn')?.addEventListener('click', () => auth.showLogoutConfirm());
    $('ajustesBorrarBtn')?.addEventListener('click', borrarCuenta);
    document.addEventListener('sesion-cambiada', pintarCuenta);
    document.addEventListener('version-nueva', () => marcarVersionNueva(true));
}
