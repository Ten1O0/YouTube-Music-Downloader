/**
 * Cómo va un lote de descargas, para el cliente (plan 20). Sin DOM ni red: se
 * prueba en Node (test/frontend/test_lotes.mjs); lo usan lotes.js y el aviso.
 */

import { esIdYoutube } from '../../core/utils.js';

const FALLIDAS = new Set(['fallida', 'caducada']);

/**
 * Cómo va un lote para el cliente. Pura.
 * @param {object} resumen  respuesta de GET /api/lotes/<id>
 * @param {Iterable<string>} recogidas  downloadId ya guardados aquí
 * @returns {{ total, hechas, fallidas, enCurso, porRecoger: object[], percent, terminado }}
 */
export function estadoDelLote(resumen, recogidas = []) {
    const ya = new Set(recogidas);
    const canciones = resumen?.canciones ?? [];
    const porRecoger = canciones.filter((c) => c.estado === 'hecha' && !ya.has(c.downloadId));
    const hechas = canciones.filter((c) => ya.has(c.downloadId)).length;
    const fallidas = canciones.filter((c) => FALLIDAS.has(c.estado) && !ya.has(c.downloadId)).length;
    const enCurso = canciones.filter((c) => c.estado === 'descargando').length;
    const total = canciones.length;
    // Las que están bajándose cuentan medio: el anillo se mueve entre una y otra
    const percent = total ? Math.min(100, ((hechas + fallidas + enCurso * 0.5) / total) * 100) : 0;
    return {
        total, hechas, fallidas, enCurso, porRecoger, percent,
        terminado: Boolean(resumen?.terminado) && porRecoger.length === 0,
    };
}

/** Una canción, con lo que necesitan el servidor (url) y la biblioteca (videoInfo). */
export function cancionDeLote(v) {
    const videoId = [v?.videoId, v?.id].find(esIdYoutube) ?? null;
    const url = typeof v?.url === 'string' && v.url.trim() ? v.url.trim()
        : videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
    if (!url) return null;
    return {
        url,
        videoInfo: {
            id: videoId ?? undefined,
            videoId: videoId ?? undefined,
            title: v.title ?? '',
            channel: v.channel ?? '',
            thumbnail: v.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : ''),
            duration: Number.isFinite(v.duration) ? v.duration : 0,
        },
    };
}
