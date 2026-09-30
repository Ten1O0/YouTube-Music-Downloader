/**
 * Ajustes de reproducción (plan 12, T8): la transición entre canciones, igualar
 * el volumen y el visualizador. Se guardan en `ytdl_playback` y se aplican al
 * momento: quien los usa se suscribe con `alCambiarAjustes`.
 *
 * Los controles viven en la hoja de Ajustes (features/ajustes.js), junto con
 * la cuenta y la versión de la app.
 */

import { isNative } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';
import { AJUSTES_POR_DEFECTO, sanearAjustes } from './settings-model.js';

const CLAVE = 'ytdl_playback';
let ajustes = { ...AJUSTES_POR_DEFECTO };
const suscritos = new Set();

export const ajustesReproduccion = () => ajustes;

export function alCambiarAjustes(fn) {
    suscritos.add(fn);
}

export function cambiarAjustes(cambios) {
    ajustes = sanearAjustes({ ...ajustes, ...cambios });
    StorageModule.set(CLAVE, ajustes).catch(() => {});
    pintar();
    // Para la cuenta (plan 13): solo los cambios, no la carga al arrancar
    document.dispatchEvent(new CustomEvent('ajustes-elegidos'));
    for (const fn of suscritos) {
        try { fn(ajustes); } catch (e) { console.error('[Ajustes] Suscriptor:', e); }
    }
}

export async function cargarAjustes() {
    try { ajustes = sanearAjustes(await StorageModule.get(CLAVE)); } catch { /* sin almacenamiento: los de por defecto */ }
    pintar();
    for (const fn of suscritos) fn(ajustes);
}

function pintar() {
    document.querySelectorAll('#pbFundido [data-fundido]').forEach((b) => {
        b.setAttribute('aria-checked', String(Number(b.dataset.fundido) === ajustes.fundido));
    });
    const igualar = document.getElementById('pbIgualar');
    if (igualar) igualar.checked = ajustes.igualar;
    const visual = document.getElementById('pbVisualizador');
    if (visual) visual.checked = ajustes.visualizador;
    const radio = document.getElementById('pbRadio');
    if (radio) radio.checked = ajustes.radio;
    const wifi = document.getElementById('pbRadioWifi');
    if (wifi) wifi.checked = ajustes.radioSoloWifi;
}

export function initAjustesReproduccion() {
    document.querySelectorAll('#pbFundido [data-fundido]').forEach((b) => {
        b.addEventListener('click', () => cambiarAjustes({ fundido: Number(b.dataset.fundido) }));
    });
    document.getElementById('pbIgualar')?.addEventListener('change', (e) => cambiarAjustes({ igualar: e.target.checked }));
    document.getElementById('pbVisualizador')?.addEventListener('change', (e) => cambiarAjustes({ visualizador: e.target.checked }));
    document.getElementById('pbRadio')?.addEventListener('change', (e) => cambiarAjustes({ radio: e.target.checked }));
    document.getElementById('pbRadioWifi')?.addEventListener('change', (e) => cambiarAjustes({ radioSoloWifi: e.target.checked }));
    // «Solo con Wi-Fi», en la APK: en la web no hay datos móviles que cuidar
    const ajusteWifi = document.getElementById('pbRadioWifiAjuste');
    if (ajusteWifi) ajusteWifi.hidden = !isNative();
    pintar();
}
