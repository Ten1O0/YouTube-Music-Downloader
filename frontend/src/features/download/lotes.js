/**
 * Descargar varias canciones a la vez (plan 20, T2): listas, Mix, favoritos,
 * «Descargar las que faltan» y las listas seguidas, por un solo camino.
 *
 * El servidor organiza un lote de descargas sueltas, de 3 en 3, con una sola
 * petición (antes, una por canción, y a partir de la décima el servidor las
 * rechazaba). Cada canción se recoge en cuanto termina, con el mismo código que
 * una descarga suelta: entra en la biblioteca y, si estaba en la nube, sale de
 * ella. El lote se apunta como pendiente: si se cierra la app, al volver se
 * recoge lo que haya terminado.
 */

import { apiBase } from '../../config/env.js';
import { i18n } from '../../i18n/language-manager.js';
import { avisarSistema, avisoDeLote } from '../../native/notifications.js';
import { avisar } from '../../ui/toast.js';
import { auth } from '../auth.js';
import { guardarDescarga, progresoDe, selectedAudioFormat } from './download.js';
import { cancionDeLote, estadoDelLote } from './estado-lote.js';
import { CADUCIDAD_MS, apuntarPendiente, leerPendientes, marcarRecogida, quitarPendiente } from './pendientes.js';
import { queueManager } from './queue.js';

/** Como el servidor: más canciones van en varios lotes seguidos. */
export const MAX_POR_LOTE = 100;
const INTERVALO_MS = 1000;
const INTERVALO_SIN_RED_MS = 4000;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const cabeceras = () => ({ 'Content-Type': 'application/json', ...auth.getAuthHeaders() });

/** Lo que dice el servidor del lote: el resumen, null si ya no existe, undefined si no contesta. */
async function resumenDe(loteId) {
    try {
        const res = await fetch(`${apiBase()}/api/lotes/${encodeURIComponent(loteId)}`, { cache: 'no-store' });
        if (res.ok) return await res.json();
        return res.status === 404 ? null : undefined;
    } catch {
        return undefined;
    }
}

const enMarcha = new Map(); // loteId -> { cancelado }

/** Cancela un lote: lo que está en cola no empieza y lo que está en marcha se para. */
export async function cancelarLote(loteId) {
    const lote = enMarcha.get(loteId);
    if (lote) lote.cancelado = true;
    await fetch(`${apiBase()}/api/lotes/${encodeURIComponent(loteId)}`, { method: 'DELETE' }).catch(() => {});
}

/**
 * Descarga varias canciones. Resuelve al terminar con
 * `{ hechas, fallidas: object[], total, cancelado }` (fallidas: las canciones,
 * para reintentarlas).
 * @param {object[]} lista  canciones del selector, de favoritos o de la biblioteca
 * @param {{ nombre?: string, zip?: boolean, alProgreso?: (estado) => void, alEmpezar?: (loteId) => void,
 *   silencioso?: boolean, recoger?: (descarga) => Promise<void> }} [o]
 *   zip: no se guardan en la biblioteca; al terminar se baja un ZIP (ordenador).
 *   alEmpezar: con el id del lote, para poder cancelarlo
 *   silencioso y recoger (plan 16, la radio): sin isla, avisos ni pendientes,
 *   y cada canción terminada se entrega a `recoger` en vez de a la biblioteca
 */
export async function descargarLote(lista, { nombre = '', zip = false, alProgreso, alEmpezar, silencioso = false, recoger = null } = {}) {
    const canciones = lista.map(cancionDeLote).filter(Boolean);
    if (!canciones.length) return { hechas: 0, fallidas: [], total: 0, cancelado: false };
    // Más de 100: lotes seguidos, sumando el resultado
    if (canciones.length > MAX_POR_LOTE) {
        const total = { hechas: 0, fallidas: [], total: 0, cancelado: false };
        for (let i = 0; i < lista.length && !total.cancelado; i += MAX_POR_LOTE) {
            const r = await descargarLote(lista.slice(i, i + MAX_POR_LOTE), { nombre, zip, alProgreso, alEmpezar, silencioso, recoger });
            total.hechas += r.hechas;
            total.fallidas.push(...r.fallidas);
            total.total += r.total;
            total.cancelado = r.cancelado;
        }
        return total;
    }

    let datos;
    try {
        const res = await fetch(`${apiBase()}/api/lotes`, {
            method: 'POST',
            headers: cabeceras(),
            body: JSON.stringify({
                nombre,
                formato: selectedAudioFormat(),
                canciones: canciones.map((c) => ({
                    url: c.url, title: c.videoInfo.title, channel: c.videoInfo.channel, duration: c.videoInfo.duration,
                })),
            }),
        });
        datos = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(datos.error || i18n.t('error_download')), { status: res.status });
    } catch (e) {
        if (!silencioso) avisar(e.message || i18n.t('error_download'));
        return { hechas: 0, fallidas: lista, total: canciones.length, cancelado: false, error: true, status: e.status };
    }

    // Lo necesario para recoger cada canción, también después de cerrar la app
    const info = {
        nombre,
        zip,
        canciones: datos.canciones.map((c) => ({ downloadId: c.downloadId, ...canciones[c.i] })),
    };
    // Lo de la radio no se recoge al volver: es de paso, y la radio pide lo que necesite
    if (!silencioso) await apuntarPendiente({ downloadId: datos.loteId, tipo: 'lote', info, total: datos.total });
    alEmpezar?.(datos.loteId);
    return seguirLote(datos.loteId, info, { alProgreso, silencioso, recoger });
}

/** Sigue un lote hasta el final, recogiendo cada canción al terminar. */
async function seguirLote(loteId, info, { recogidas: yaRecogidas = [], alProgreso, silencioso = false, recoger = null } = {}) {
    const estadoLocal = { cancelado: false };
    enMarcha.set(loteId, estadoLocal);
    const recogidas = new Set(yaRecogidas);
    const porId = new Map(info.canciones.map((c) => [c.downloadId, c]));
    const titulo = info.nombre || i18n.t('batch_default_name', { n: info.canciones.length });
    // En silencio (la radio), la isla ni se entera
    const isla = silencioso ? { actualizarLote() {} } : queueManager;
    if (!silencioso) {
        queueManager.addLote(loteId, {
            title: titulo,
            thumbnail: info.canciones[0]?.videoInfo?.thumbnail || '',
            total: info.canciones.length,
        }, { alCancelar: () => cancelarLote(loteId) });
    }

    let ultimo = null;
    let perdido = false;
    try {
        while (!estadoLocal.cancelado) {
            const resumen = await resumenDe(loteId);
            if (resumen === null) { perdido = true; break; }   // el servidor se reinició
            if (resumen === undefined) { await dormir(INTERVALO_SIN_RED_MS); continue; }
            ultimo = resumen;

            let estado = estadoDelLote(resumen, recogidas);
            for (const c of estado.porRecoger) {
                if (estadoLocal.cancelado) break;
                const cancion = porId.get(c.downloadId);
                if (!info.zip && cancion) {
                    const final = await progresoDe(c.downloadId);
                    if (!final) continue; // no contesta: en la próxima vuelta
                    try {
                        await (recoger ?? guardarDescarga)({
                            download_id: c.downloadId, total: 1, url: cancion.url,
                            videoInfo: cancion.videoInfo, finalProgressData: final,
                        });
                    } catch (e) {
                        console.warn('[Lotes] No se pudo guardar', c.downloadId, e);
                        continue;
                    }
                }
                recogidas.add(c.downloadId);
                if (!silencioso) await marcarRecogida(loteId, c.downloadId);
                estado = estadoDelLote(resumen, recogidas);
                isla.actualizarLote(loteId, estado, resumen);
                alProgreso?.(estado);
            }
            estado = estadoDelLote(resumen, recogidas);
            isla.actualizarLote(loteId, estado, resumen);
            alProgreso?.(estado);
            if (estado.terminado || resumen.cancelado) break;
            await dormir(INTERVALO_MS);
        }
    } finally {
        enMarcha.delete(loteId);
    }

    const final = estadoDelLote(ultimo ?? { canciones: [] }, recogidas);
    const cancelado = estadoLocal.cancelado || Boolean(ultimo?.cancelado);
    // Las que no llegaron: para «Reintentar»
    const fallidas = info.canciones
        .filter((c) => !recogidas.has(c.downloadId))
        .map((c) => ({ ...c.videoInfo, url: c.url }));
    const resultado = {
        hechas: final.hechas,
        fallidas: cancelado ? [] : fallidas,
        total: info.canciones.length,
        cancelado,
    };
    if (info.zip && resultado.hechas) entregarZip(loteId, titulo);
    if (silencioso) return resultado;
    await quitarPendiente(loteId);

    queueManager.terminarLote(loteId, resultado, {
        alReintentar: resultado.fallidas.length
            ? () => descargarLote(resultado.fallidas, { nombre: info.nombre, zip: info.zip })
            : null,
    });
    if (!cancelado) {
        const aviso = avisoDeLote({ total: resultado.total, fallidas: resultado.fallidas.length }, (k, p) => i18n.t(k, p));
        if (aviso) avisarSistema(aviso);
    }
    if (perdido && !resultado.hechas) avisar(i18n.t('dl_lost', { title: titulo }));
    return resultado;
}

function entregarZip(loteId, titulo) {
    const a = document.createElement('a');
    a.href = `${apiBase()}/api/lotes/${loteId}/zip`;
    a.download = `${titulo}.zip`;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
}

/**
 * Al abrir la app: los lotes que se quedaron a medias. Lo terminado se recoge
 * y lo que sigue en marcha se sigue; si el servidor ya no tiene el lote, se avisa.
 */
export async function recogerLotesPendientes() {
    const lotes = (await leerPendientes()).filter((p) => p.tipo === 'lote');
    await Promise.all(lotes.map(async (p) => {
        if (Date.now() - Number(p.creada) > CADUCIDAD_MS) { await quitarPendiente(p.downloadId); return; }
        const resumen = await resumenDe(p.downloadId);
        if (resumen === undefined) return; // sin respuesta: en el próximo arranque
        if (resumen === null) {
            await quitarPendiente(p.downloadId);
            avisar(i18n.t('dl_lost', { title: p.info?.nombre || i18n.t('batch_default_name', { n: p.total }) }));
            return;
        }
        const antes = (p.recogidas ?? []).length;
        const r = await seguirLote(p.downloadId, p.info, { recogidas: p.recogidas ?? [] });
        const nuevas = r.hechas - antes;
        if (nuevas > 0) avisar(i18n.t('dl_recovered', { n: nuevas }));
    }));
}
