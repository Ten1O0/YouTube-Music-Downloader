/**
 * Progreso de las descargas: eventos del servidor (SSE) con sondeo de respaldo.
 */

import { apiBase } from '../../config/env.js';
import { queueManager } from './queue.js';
import { updateFavoriteItem } from '../favorites/panel.js';
import { updateHistoryItem } from '../history.js';
import { i18n } from '../../i18n/language-manager.js';
import { updateProgress } from '../../ui/status.js';

// ========================================
// Progress Polling
// ========================================
function updateBatchETA(data, total, etaState) {
    if (data.status !== 'downloading' || total <= 1) return;

    if (data.current > etaState.lastCurrent) {
        const elapsed = (Date.now() - etaState.startTime) / 1000;
        const avgTimePerItem = elapsed / data.current;
        const remaining = total - data.current;
        etaState.etaSeconds = Math.round(remaining * avgTimePerItem);
        etaState.lastCurrent = data.current;
    } else if (etaState.etaSeconds !== null && etaState.etaSeconds > 0) {
        etaState.etaSeconds--;
    }

    if (etaState.etaSeconds === null || data.current <= 0) return;

    const mins = Math.floor(etaState.etaSeconds / 60);
    const secs = etaState.etaSeconds % 60;
    const etaStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    const cleanMsg = data.message.split(' - ETA:')[0];
    data.message = `${cleanMsg} - ETA: ${etaStr}`;
}

function updateQueueUI(downloadId, data, total) {
    let qPercent = 0;
    if (data.status === 'complete') qPercent = 100;
    else if (total > 0) qPercent = (data.current / total) * 100;

    if (data.status === 'downloading') {
        if (total === 1 && data.current === 0) qPercent = 50;
        queueManager.update(downloadId, qPercent, resolveProgressText(data) || i18n.t('downloading'), data);
    } else if (data.status === 'complete') {
        queueManager.complete(downloadId);
    }
}

/**
 * Texto de progreso traducido si el servidor manda un código, y el mensaje
 * literal si no (plan 05, T6).
 *
 * Hoy el servidor solo envía `message` en castellano, así que esto se comporta
 * exactamente igual que antes. Cuando el plan 07 empiece a enviar `code` y
 * `params`, la traducción aparece sola, sin tocar el cliente.
 */
export function resolveProgressText(data) {
    if (data?.code) {
        const traducido = i18n.t(`srv_${data.code}`, data.params || {});
        if (traducido !== `srv_${data.code}`) return traducido;
    }
    return data?.message || '';
}

function handlePollStatus(data, total, downloadId, pollInterval) {
    // Con SSE no hay intervalo que parar: el flujo lo cierra streamProgress.
    const detenerSondeo = () => { if (pollInterval) clearInterval(pollInterval); };

    switch (data.status) {
        case 'downloading': {
            const percent = total > 0
                ? Math.min(10 + (data.current / total) * 80, 90)
                : 50;
            updateProgress(percent, resolveProgressText(data));
            return null;
        }
        case 'complete':
            detenerSondeo();
            updateProgress(95, resolveProgressText(data));
            if (data.video_id && (data.title || data.thumbnail)) {
                updateHistoryItem(data.video_id, { title: data.title, thumbnail: data.thumbnail });
                updateFavoriteItem(data.video_id, { title: data.title, thumbnail: data.thumbnail });
            }
            return { resolved: true, value: data };
        case 'error':
            detenerSondeo();
            queueManager.fail(downloadId);
            return { resolved: false, error: new Error(resolveProgressText(data)) };
        case 'cancelled':
            detenerSondeo();
            queueManager.remove(downloadId);
            return { resolved: true, value: { cancelled: true } };
        case 'starting':
            updateProgress(5, resolveProgressText(data));
            return null;
        default:
            return null;
    }
}

/**
 * Tratamiento común de una actualización de progreso, compartido por los dos
 * transportes (SSE y sondeo). Devuelve el resultado de handlePollStatus.
 */
function handleProgressUpdate(data, total, downloadId, etaState, pollInterval) {
    updateBatchETA(data, total, etaState);
    updateQueueUI(downloadId, data, total);
    return handlePollStatus(data, total, downloadId, pollInterval);
}

async function pollProgress(downloadId, total) {
    const etaState = { startTime: Date.now(), lastCurrent: 0, etaSeconds: null };

    return new Promise((resolve, reject) => {
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`${apiBase()}/api/progress/${downloadId}`);
                const data = await response.json();

                const result = handleProgressUpdate(data, total, downloadId, etaState, pollInterval);
                if (result?.resolved) resolve(result.value);
                else if (result && !result.resolved) reject(result.error);
            } catch (err) {
                console.warn('Poll error:', err);
            }
        }, 1000);

        // Timeout after 30 minutes
        setTimeout(() => {
            clearInterval(pollInterval);
            reject(new Error('La descarga tardó demasiado'));
        }, 30 * 60 * 1000);
    });
}

/**
 * Progreso por Server-Sent Events, con respaldo automático al sondeo.
 *
 * El camino viejo (pollProgress) queda intacto y se activa ante cualquier
 * problema: servidor sin huecos libres, EventSource no disponible, CORS, o
 * simplemente que no llegue nada en los primeros segundos. La apuesta es
 * asimétrica a propósito: si SSE funciona ganamos, y si no, no perdemos nada.
 */
export function streamProgress(downloadId, total) {
    if (typeof EventSource === 'undefined' || globalThis.USE_SSE === false) {
        return pollProgress(downloadId, total);
    }

    const etaState = { startTime: Date.now(), lastCurrent: 0, etaSeconds: null };

    return new Promise((resolve, reject) => {
        let fuente;
        try {
            fuente = new EventSource(`${apiBase()}/api/progress/stream/${downloadId}`);
        } catch (err) {
            console.warn('[SSE] No se pudo abrir el flujo, se usa sondeo:', err);
            pollProgress(downloadId, total).then(resolve, reject);
            return;
        }

        let recibidoAlgo = false;
        let cerrado = false;

        const caerASondeo = (motivo) => {
            if (cerrado) return;
            cerrado = true;
            clearTimeout(temporizador);
            fuente.close();
            console.warn(`[SSE] Respaldo a sondeo: ${motivo}`);
            pollProgress(downloadId, total).then(resolve, reject);
        };

        // Si en 5 segundos no ha llegado nada, el transporte no está funcionando
        const temporizador = setTimeout(() => {
            if (!recibidoAlgo) caerASondeo('sin eventos en 5 s');
        }, 5000);

        fuente.onmessage = (ev) => {
            recibidoAlgo = true;
            clearTimeout(temporizador);

            let data;
            try {
                data = JSON.parse(ev.data);
            } catch (err) {
                console.warn('[SSE] Evento no parseable:', err);
                return;
            }

            const result = handleProgressUpdate(data, total, downloadId, etaState, null);
            if (result?.resolved) {
                cerrado = true;
                fuente.close();
                resolve(result.value);
            } else if (result && !result.resolved) {
                cerrado = true;
                fuente.close();
                reject(result.error);
            }
        };

        fuente.onerror = () => {
            // EventSource reintenta solo, pero aquí preferimos el camino probado
            caerASondeo('error de conexión');
        };
    });
}
