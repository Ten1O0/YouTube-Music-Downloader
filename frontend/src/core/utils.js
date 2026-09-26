/**
 * Utilidades sin estado: validar entradas, formatear, convertir datos.
 */

import { AUDIO_EXTENSIONS_CLIENT } from './songs.js';
import { i18n } from '../i18n/language-manager.js';

// ========================================
// Utilities
// ========================================
export function sanitizeFilename(name) {
    if (!name) return 'audio_unknown';
    // Remove unwanted characters for Android/Windows filesystems
    return name.replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200);
}

// Global/Module-level Utility Helpers to resolve SonarQube complexity/nesting warnings
export function addOptionalEventListener(element, event, callback) {
    if (element) {
        element.addEventListener(event, callback);
    }
}

export const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/;

// ========================================
// Utility Functions
// ========================================
export function isValidInput(input) {
    const trimmed = input.trim();
    return YOUTUBE_URL_PATTERN.test(trimmed) || trimmed.length >= 2;
}

export function isUrl(input) {
    return YOUTUBE_URL_PATTERN.test(input.trim());
}

export function isPlaylistUrl(input) {
    const url = input.trim();
    // Check for playlist URL (list=PL... or list=RD...)
    const hasPlaylistParam = /[?&]list=/.test(url);
    // Allow any playlist including RD (Mixes)
    return hasPlaylistParam;
}

export function formatDuration(seconds) {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Convierte un ArrayBuffer a Base64 de forma eficiente sin saturar la pila
 */
export function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCodePoint(bytes[i]);
    }
    return globalThis.btoa(binary);
}

// Extract video ID from YouTube URL or Local Stream Path
export function extractVideoId(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('blob:')) return null; // Cannot extract from blob URLs

    // Check for app-specific local stream format /api/stream/ID
    if (url.includes('/api/stream/')) {
        const parts = url.split('/');
        return parts.at(-1);
    }

    // Check for app-specific local path format ytmusic_VIDEOID.m4a
    if (url.includes('ytmusic_')) {
        const localMatch = /ytmusic_([\w-]{8,11})/.exec(url);
        if (localMatch) return localMatch[1];
    }

    const match = /(?:v=|\/)([\w-]{8,11})(?:\?|&|$)/.exec(url);
    return match ? match[1] : null;
}

export function getErrorMessage(error) {
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        return 'No se puede conectar al servidor. Asegúrate de que está ejecutándose';
    }
    if (error.message === 'MIX_PLAYLIST_ERROR') return i18n.t('mix_error');
    return error.message || 'Error al descargar. Inténtalo de nuevo';
}

/**
 * Extensión real del fichero que ha devuelto el servidor.
 *
 * Se deriva de la cabecera Content-Disposition y no de lo que se pidió: si la
 * conversión a mp3 falla, yt-dlp cae al formato original, y guardar un m4a
 * llamado .mp3 (o al revés) rompe el lector de metadatos y la importación.
 * El servidor expone esa cabecera con expose_headers en su configuración CORS.
 */
export function extFromResponse(response, fallback = '.m4a') {
    const cd = response?.headers?.get?.('Content-Disposition') || '';
    const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
    if (!m?.[1]) return fallback;

    let name = m[1];
    try { name = decodeURIComponent(name); } catch { /* nombre sin codificar */ }

    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    return AUDIO_EXTENSIONS_CLIENT.includes(ext) ? ext : fallback;
}

export function base64ToBlob(base64, type) {
    if (!base64) return null;
    try {
        const bin = atob(base64);
        const len = bin.length;
        const arr = new Uint8Array(len);
        for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: type });
    } catch (e) { return null; }
}
