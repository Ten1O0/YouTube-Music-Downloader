/**
 * Importar audio (plan 20, T4): las reglas, sin DOM. Se prueban en Node
 * (test/frontend/test_importar.mjs); las usa importer.js.
 */

import { esIdYoutube } from '../../core/utils.js';

/** Un fichero más grande que esto no se importa. */
export const MAX_BYTES = 100 * 1024 * 1024;
const EXTENSIONES = /\.(m4a|mp3|mp4|aac|ogg|oga|opus|wav|flac|webm)$/i;
const RE_ENLACE = /(?:youtube\.com\/(?:watch\?(?:[^\s#]*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/;

/** ¿Es un fichero de audio que se puede importar? */
export function esAudio(fichero) {
    if (!fichero || fichero.size > MAX_BYTES) return false;
    return String(fichero.type ?? '').startsWith('audio/') || EXTENSIONES.test(String(fichero.name ?? ''));
}

/**
 * El videoId de YouTube que lleva un fichero en sus metadatos, o null. Lo que
 * descarga esta app lo lleva en el comentario (yt-dlp --add-metadata escribe
 * ahí el enlace del vídeo). En ID3 el comentario es un objeto con `text`; en
 * MP4, un texto.
 */
export function videoIdDeMetadatos(etiquetas) {
    for (const valor of [etiquetas?.comment, etiquetas?.purl, etiquetas?.url]) {
        const texto = typeof valor === 'string' ? valor : valor?.text ?? valor?.data ?? '';
        const m = RE_ENLACE.exec(String(texto));
        if (m && esIdYoutube(m[1])) return m[1];
    }
    return null;
}

/** El título del fichero sin la extensión, si no trae uno en los metadatos. */
export const tituloDeFichero = (nombre) => String(nombre ?? '').replace(/\.[^/.]+$/, '') || 'Sin título';

/**
 * ¿Caben estos bytes en el almacenamiento del navegador? Se deja un 5 % de
 * margen. Sin estimación (navegadores viejos), se intenta.
 * @returns {{ cabe: boolean, faltanMB: number }}
 */
export function cabeEnElNavegador(estimacion, bytes) {
    const { quota, usage } = estimacion ?? {};
    if (!Number.isFinite(quota) || !Number.isFinite(usage) || quota <= 0) return { cabe: true, faltanMB: 0 };
    const libre = quota * 0.95 - usage;
    if (bytes <= libre) return { cabe: true, faltanMB: 0 };
    return { cabe: false, faltanMB: Math.ceil((bytes - libre) / (1024 * 1024)) };
}

/**
 * Qué hacer con cada fichero según la biblioteca: los que ya están descargados
 * aquí (por su videoId) se saltan; el resto se importa. Pura.
 * @param {{ fichero, videoId: string|null }[]} leidos
 * @returns {{ importar: object[], saltados: number }}
 */
export function repartirImportacion(leidos, biblioteca) {
    const descargadas = new Set((biblioteca ?? []).filter((s) => s?.nube !== true && esIdYoutube(s?.videoId)).map((s) => s.videoId));
    const vistos = new Set();
    const importar = [];
    let saltados = 0;
    for (const l of leidos) {
        if (l.videoId && (descargadas.has(l.videoId) || vistos.has(l.videoId))) { saltados++; continue; }
        if (l.videoId) vistos.add(l.videoId);
        importar.push(l);
    }
    return { importar, saltados };
}
