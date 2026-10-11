/**
 * «Descargar las que faltan» de una lista (plan 24, P3).
 *
 * Las canciones de la lista que están en la nube se bajan con un lote (plan
 * 20), por la misma vía que «Descargar las que faltan» de la biblioteca
 * (`descargarVarias`): una sola petición, la isla de progreso, sus avisos y el
 * tope de descargas por hora. Al bajarse, sustituyen a su versión en la nube
 * también en las listas. La usa también la selección múltiple (sesión A, P8).
 */

import { i18n } from '../../../i18n/language-manager.js';
import { showStatus } from '../../../ui/status.js';
import { esNube } from '../../sync/fusion.js';
import { descargarVarias } from '../../sync/nube.js';
import { esVideoId } from '../../sync/validar.js';

/** Las que se pueden bajar: de la nube y con su videoId. Pura. */
export const quePuedenBajarse = (canciones) => (canciones ?? []).filter((s) => esNube(s) && esVideoId(s?.videoId));

/**
 * Baja las canciones de la nube que haya en `canciones`; las demás se ignoran.
 * @param {{ alProgreso?: (estado: { hechas: number, total: number }) => void }} [o]
 * @returns {Promise<{ hechas: number, fallidas: number } | null>} null si no había nada que bajar o no hay conexión
 */
export async function descargarCanciones(canciones, { alProgreso } = {}) {
    const faltan = quePuedenBajarse(canciones);
    if (!faltan.length) return null;
    if (globalThis.navigator?.onLine === false) {
        showStatus(i18n.t('cloud_offline'), 'error');
        return null;
    }
    return descargarVarias(faltan, { inmediato: true, alProgreso });
}
