/**
 * Colores de una carátula (plan 09, T11).
 *
 * El fondo del reproductor se pinta con tres colores de la carátula en lugar
 * de desenfocar la imagen a 80 px, que era lo más caro de toda la app en
 * Android y además menos fiel: el desenfoque apaga los colores.
 *
 * La carátula se reduce a 24 × 24 y se agrupa con k-means (k = 3): dos
 * colores para las luces y el más oscuro, llevado a una luminancia de 0,08
 * como mucho, para el fondo sobre el que se lee.
 */

/** Colores de la casa, por si no se puede leer la carátula. */
export const FALLBACK = ['#DFCDAC', '#6F8F6A', '#141A14'];

const LUMINANCIA_FONDO = 0.08;

const lineal = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

/** Luminancia relativa (WCAG) de un color [r, g, b] en 0-255. */
export function luminance([r, g, b]) {
    return 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
}

export function toHex([r, g, b]) {
    return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Oscurece un color hasta que su luminancia no pase de `max`. */
export function darkenTo(color, max = LUMINANCIA_FONDO) {
    if (luminance(color) <= max) return color;
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (luminance(color.map(c => c * mid)) > max) hi = mid; else lo = mid;
    }
    return color.map(c => c * lo);
}

/**
 * Los `k` colores dominantes de unos píxeles RGBA, ordenados para el fondo:
 * [luz principal, luz secundaria, base oscura]. Determinista: mismas
 * entradas, mismos colores, así que no parpadea al volver a abrir.
 */
export function extractPalette(pixels, k = 3) {
    const puntos = [];
    for (let i = 0; i + 3 < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) continue; // transparente
        puntos.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    }
    if (puntos.length === 0) return [...FALLBACK];

    // Semillas repartidas por luminancia: evita el azar de k-means
    const ordenados = [...puntos].sort((a, b) => luminance(a) - luminance(b));
    let centros = Array.from({ length: k }, (_, j) => ordenados[Math.floor(((2 * j + 1) / (2 * k)) * (ordenados.length - 1))].slice());
    let tamanos = new Array(k).fill(0);

    for (let iter = 0; iter < 8; iter++) {
        const sumas = Array.from({ length: k }, () => [0, 0, 0]);
        tamanos = new Array(k).fill(0);
        for (const p of puntos) {
            let mejor = 0, dist = Infinity;
            for (let j = 0; j < k; j++) {
                const d = (p[0] - centros[j][0]) ** 2 + (p[1] - centros[j][1]) ** 2 + (p[2] - centros[j][2]) ** 2;
                if (d < dist) { dist = d; mejor = j; }
            }
            sumas[mejor][0] += p[0]; sumas[mejor][1] += p[1]; sumas[mejor][2] += p[2];
            tamanos[mejor]++;
        }
        centros = centros.map((c, j) => (tamanos[j] ? sumas[j].map(v => v / tamanos[j]) : c));
    }

    // La base es el más oscuro; las luces, el resto por presencia
    const indices = centros.map((_, j) => j);
    const base = indices.reduce((a, b) => (luminance(centros[b]) < luminance(centros[a]) ? b : a));
    const luces = indices.filter(j => j !== base).sort((a, b) => tamanos[b] - tamanos[a]);
    const [c1, c2 = c1] = luces.map(j => centros[j]);
    return [toHex(c1), toHex(c2), toHex(darkenTo(centros[base]))];
}

const cache = new Map();
const CACHE_MAX = 50;

/**
 * Paleta de una imagen por su URL. Devuelve null si no se puede leer (sin
 * CORS, sin red): quien llama usa FALLBACK. Las miniaturas de YouTube
 * responden con access-control-allow-origin: *, y en la APK la carátula es
 * un data: URI, así que en la práctica se lee siempre.
 */
export async function paletteFromImage(src, { size = 24 } = {}) {
    if (!src) return null;
    if (cache.has(src)) {
        const p = cache.get(src);
        cache.delete(src); cache.set(src, p); // LRU: al final, recién usado
        return p;
    }
    try {
        const img = new Image();
        if (!/^(data|blob):/.test(src)) img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.src = src;
        await img.decode();
        const lienzo = document.createElement('canvas');
        lienzo.width = lienzo.height = size;
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        const paleta = extractPalette(ctx.getImageData(0, 0, size, size).data);
        cache.set(src, paleta);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
        return paleta;
    } catch {
        return null;
    }
}
