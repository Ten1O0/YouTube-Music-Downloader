/**
 * Avisos del sistema en la APK (plan 14, T5): «Listo: 23 canciones
 * descargadas», «Lista "X": 3 canciones nuevas».
 *
 * Solo con la app fuera de la vista: con ella delante ya están la isla y el
 * banner. Fuera de la APK o sin permiso no hace nada, y nada falla. Canal
 * propio «Descargas», de importancia normal y sin sonido, para no competir con
 * la música.
 *
 * Ojo (T1): sin música sonando, Android congela la app al minuto y medio de
 * salir de ella, así que un lote largo sigue al volver y el aviso lo da la
 * propia app. Con música, el servicio del reproductor la mantiene despierta y
 * el aviso llega en el momento.
 */

import { isNative } from '../config/env.js';

const CANAL = 'descargas';
/** Un lote más corto que esto no avisa al terminar: sería ruido. */
export const MIN_LOTE_PARA_AVISAR = 5;

let preparado = null;
// Se lee al crear el canal, con el idioma ya cargado
let nombreCanal = () => 'Descargas';
let alTocar = () => {};
// Ids crecientes (enteros de 32 bits) para que un aviso no pise al anterior
let siguienteId = (Math.floor(Date.now() / 1000) % 100_000_000);

const plugin = () => (isNative() ? globalThis.Capacitor?.Plugins?.LocalNotifications ?? null : null);

/**
 * El aviso de un lote que termina, o null si no toca (§2.4). Pura.
 * @param {{ total: number, fallidas?: number }} lote
 * @param {(clave: string, p?: object) => string} t  i18n.t
 */
export function avisoDeLote({ total, fallidas = 0 }, t) {
    if (!(total >= MIN_LOTE_PARA_AVISAR)) return null;
    if (fallidas > 0) {
        return { titulo: t('notif_batch_failed_title'), texto: t('notif_batch_failed', { n: fallidas, total }), destino: { vista: 'library' } };
    }
    return { titulo: t('notif_batch_done_title'), texto: t('notif_batch_done', { n: total }), destino: { vista: 'library' } };
}

/** Permiso y canal, una vez. Si no hay permiso no se pide aquí (ya lo pide el aviso de permisos) y se vuelve a mirar la próxima vez. */
async function preparar(LN) {
    preparado ??= (async () => {
        const permiso = await LN.checkPermissions();
        if (permiso?.display !== 'granted') return false;
        await LN.createChannel?.({ id: CANAL, name: nombreCanal(), importance: 3, sound: null, vibration: false }).catch(() => {});
        return true;
    })().catch(() => false);
    const listo = await preparado;
    if (!listo) preparado = null;
    return listo;
}

/**
 * Lanza un aviso del sistema. Devuelve si se lanzó.
 * @param {{ titulo: string, texto: string, destino?: object }} aviso  texto plano: el sistema no interpreta HTML
 * @param {{ LN?: object|null, visible?: boolean }} [o]  para las pruebas
 */
export async function avisarSistema({ titulo, texto, destino = null }, {
    LN = plugin(),
    visible = globalThis.document?.visibilityState === 'visible',
} = {}) {
    if (visible || !LN || !titulo) return false;
    try {
        if (!(await preparar(LN))) return false;
        siguienteId = (siguienteId + 1) % 2_000_000_000;
        await LN.schedule({
            notifications: [{
                id: siguienteId,
                title: String(titulo).slice(0, 120),
                body: String(texto ?? '').slice(0, 300),
                channelId: CANAL,
                extra: destino ? { destino } : null,
            }],
        });
        return true;
    } catch (e) {
        console.warn('[Avisos] No se pudo avisar:', e?.message ?? e);
        return false;
    }
}

/**
 * @param {{ nombre?: () => string, alTocar?: (destino: object|null) => void }} o
 *   nombre: el del canal en Ajustes de Android; alTocar: abre el destino
 */
export function initAvisosSistema({ nombre, alTocar: abrir } = {}, LN = plugin()) {
    if (nombre) nombreCanal = nombre;
    if (abrir) alTocar = abrir;
    if (!LN?.addListener) return;
    try {
        LN.addListener('localNotificationActionPerformed', (evento) => {
            try { alTocar(evento?.notification?.extra?.destino ?? null); }
            catch (e) { console.warn('[Avisos] Destino no válido:', e); }
        });
    } catch (e) {
        console.warn('[Avisos] Sin avisos del sistema:', e);
    }
}

/** Solo para las pruebas: olvida el permiso y el canal ya preparados. */
export function _reiniciarAvisos() {
    preparado = null;
    alTocar = () => {};
}
