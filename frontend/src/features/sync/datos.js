/**
 * La hoja «Tus datos» (plan 13, T7): el estado de la sincronización, la copia
 * de seguridad y las canciones eliminadas en los últimos 30 días.
 */

import { apiBase } from '../../config/env.js';
import { html } from '../../core/html.js';
import { nombreDe } from '../../core/titles.js';
import { i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { auth } from '../auth.js';
import { aplicarCopia, exportarCopia, leerCopia } from './backup.js';
import { alCambiarEstado, estadoSincronizacion, sincronizar } from './sync.js';

const $ = (id) => document.getElementById(id);
let copiaLeida = null;

/** «hace 2 min», en el idioma de la app. */
function hace(ms) {
    const segundos = Math.round((ms - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(i18n.currentLang, { numeric: 'auto' });
    const tramos = [[60, 'second'], [60, 'minute'], [24, 'hour'], [Infinity, 'day']];
    let valor = segundos;
    for (const [tope, unidad] of tramos) {
        if (Math.abs(valor) < tope) return rtf.format(Math.round(valor), unidad);
        valor /= tope;
    }
    return '';
}

function pintarEstado({ conSesion, ultima, pendientes }) {
    const el = $('dataSyncStatus');
    if (!el) return;
    if (!conSesion) el.textContent = i18n.t('data_sync_off');
    else if (pendientes > 0) el.textContent = i18n.t('data_sync_pending', { n: pendientes });
    else if (ultima) el.textContent = i18n.t('data_sync_done', { cuando: hace(ultima) });
    else el.textContent = i18n.t('data_sync_never');
}

async function pintarPapelera() {
    const seccion = $('dataTrash');
    const lista = $('dataTrashList');
    const vacio = $('dataTrashEmpty');
    if (!seccion || !lista) return;
    seccion.hidden = !auth.isLoggedIn();
    if (seccion.hidden) return;
    lista.innerHTML = '';
    vacio.textContent = '…';
    let canciones = [];
    try {
        const res = await fetch(`${apiBase()}/api/sync/eliminadas`, { headers: auth.getAuthHeaders() });
        if (res.ok) canciones = (await res.json()).canciones ?? [];
    } catch { /* sin red: se queda vacía */ }
    vacio.textContent = canciones.length ? '' : i18n.t('trash_empty');
    lista.innerHTML = canciones.map((c) => html`
        <li class="papelera-fila">
            <span class="papelera-texto">
                <span class="papelera-titulo">${nombreDe(c).titulo}</span>
                <span class="papelera-artista">${nombreDe(c).artista}</span>
            </span>
            <button type="button" class="pl-action-btn papelera-restaurar" data-id="${c.videoId}">${i18n.t('trash_restore')}</button>
        </li>`).join('');
}

async function restaurar(boton) {
    boton.disabled = true;
    try {
        const res = await fetch(`${apiBase()}/api/sync/restaurar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...auth.getAuthHeaders() },
            body: JSON.stringify({ videoIds: [boton.dataset.id] }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await sincronizar();
        showStatus(i18n.t('trash_restored'), 'success');
        await pintarPapelera();
    } catch {
        boton.disabled = false;
        showStatus(i18n.t('data_error'), 'error');
    }
}

function mostrarResumen(copia) {
    copiaLeida = copia;
    const { canciones, listas, favoritos, escuchas, descartadas } = copia.resumen;
    const fmt = (n) => n.toLocaleString(i18n.currentLang);
    $('backupSummaryText').textContent = i18n.t('backup_summary', {
        canciones: fmt(canciones), listas: fmt(listas), favoritos: fmt(favoritos), escuchas: fmt(escuchas),
    }) + (descartadas ? ` ${i18n.t('backup_discarded', { n: fmt(descartadas) })}` : '');
    $('backupSummary').hidden = false;
    $('backupReplaceConfirm').hidden = true;
    $('backupReplaceInput').value = '';
    $('backupReplaceGo').disabled = true;
}

function ocultarResumen() {
    copiaLeida = null;
    $('backupSummary').hidden = true;
}

async function aplicar(modo) {
    if (!copiaLeida) return;
    const copia = copiaLeida;
    ocultarResumen();
    try {
        await aplicarCopia(copia, modo);
        showStatus(i18n.t('backup_done'), 'success');
    } catch (e) {
        console.error('[Copia] No se pudo aplicar:', e);
        showStatus(i18n.t('data_error'), 'error');
    }
}

export async function abrirTusDatos() {
    const hoja = $('dataSheet');
    if (!hoja || !hoja.classList.contains('hidden')) return;
    ocultarResumen();
    pintarEstado(await estadoSincronizacion());
    hoja.classList.remove('hidden');
    NavigationModule.pushOverlayState('dataSheet');
    pintarPapelera();
}

export function initTusDatos() {
    const hoja = $('dataSheet');
    if (!hoja) return;
    const cerrar = () => NavigationModule.closeOverlay();
    $('dataSheetClose')?.addEventListener('click', cerrar);
    hoja.querySelector('.auth-modal-backdrop')?.addEventListener('click', cerrar);
    for (const id of ['libraryDataBtn', 'sidebarDataBtn']) $(id)?.addEventListener('click', abrirTusDatos);

    $('backupExportBtn')?.addEventListener('click', async () => {
        try {
            showStatus(i18n.t('backup_saved', { donde: await exportarCopia() }), 'success');
        } catch (e) {
            console.error('[Copia] No se pudo exportar:', e);
            showStatus(i18n.t('data_error'), 'error');
        }
    });

    const entrada = $('backupImportInput');
    $('backupImportBtn')?.addEventListener('click', () => entrada?.click());
    entrada?.addEventListener('change', async () => {
        const fichero = entrada.files?.[0];
        entrada.value = '';
        try {
            mostrarResumen(await leerCopia(fichero));
        } catch (e) {
            ocultarResumen();
            showStatus(e.message, 'error');
        }
    });

    $('backupMergeBtn')?.addEventListener('click', () => aplicar('combinar'));
    $('backupReplaceBtn')?.addEventListener('click', () => {
        $('backupReplaceLabel').textContent = i18n.t('backup_replace_label', { palabra: i18n.t('backup_replace_word') });
        $('backupReplaceConfirm').hidden = false;
        $('backupReplaceInput').focus();
    });
    $('backupReplaceInput')?.addEventListener('input', (e) => {
        $('backupReplaceGo').disabled = e.target.value.trim().toLowerCase() !== i18n.t('backup_replace_word').toLowerCase();
    });
    $('backupReplaceGo')?.addEventListener('click', () => aplicar('sustituir'));

    $('dataTrashList')?.addEventListener('click', (e) => {
        const boton = e.target.closest('.papelera-restaurar');
        if (boton) restaurar(boton);
    });

    alCambiarEstado((estado) => { if (!hoja.classList.contains('hidden')) pintarEstado(estado); });
}
