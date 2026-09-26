/**
 * Carátula cuadrada para lo que suena ahora: pantalla de bloqueo,
 * notificación, centro de control y las islas del sistema (Now Bar,
 * HyperIsland…).
 *
 * Las miniaturas de YouTube no sirven tal cual: son 16:9 y pequeñas
 * (mqdefault, 320×180), o 4:3 con bandas negras arriba y abajo (hqdefault,
 * 480×360). El sistema las recorta en cuadrado y las amplía, y se ven
 * pixeladas o con franjas. Aquí se busca la mejor que haya, se le quitan las
 * bandas y se recorta el cuadrado central.
 *
 * Dos tamaños: 512 px para el navegador y 320 px para la APK. El plugin nativo
 * pasa la imagen al sistema por Binder, con un límite de 1 MB por
 * transacción: un mapa de bits de 512×512 ya ocupa 1 MB y cerraría la app.
 */

export const LADO_WEB = 512;
export const LADO_SISTEMA = 320;
const MAX_CACHE = 20;
const cache = new Map();

/**
 * Filas de banda negra arriba y abajo (las de las miniaturas 4:3 de YouTube).
 * Como mucho un 20 % por cada lado: una portada oscura no es una banda.
 */
export function bandasNegras(pixeles, ancho, alto, umbral = 18) {
    const brillo = (y) => {
        let suma = 0, n = 0;
        for (let x = 0; x < ancho; x += 4) {
            const i = (y * ancho + x) * 4;
            suma += (pixeles[i] + pixeles[i + 1] + pixeles[i + 2]) / 3;
            n++;
        }
        return n ? suma / n : 0;
    };
    const limite = Math.floor(alto * 0.2);
    let arriba = 0;
    while (arriba < limite && brillo(arriba) < umbral) arriba++;
    let abajo = 0;
    while (abajo < limite && brillo(alto - 1 - abajo) < umbral) abajo++;
    return { arriba, abajo };
}

/** El mayor cuadrado centrado dentro de la zona con contenido. */
export function recorteCuadrado(ancho, alto, { arriba = 0, abajo = 0 } = {}) {
    const altoUtil = Math.max(1, alto - arriba - abajo);
    const lado = Math.min(ancho, altoUtil);
    return { x: (ancho - lado) / 2, y: arriba + (altoUtil - lado) / 2, lado };
}

/**
 * Imágenes a probar, de mejor a peor. De un vídeo de YouTube, la de máxima
 * resolución (no siempre existe) y la de alta; al final, la original, que es
 * la única disponible sin conexión.
 */
export function candidatas(src) {
    const id = /i\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\//.exec(src ?? '')?.[1];
    if (!id) return [src];
    return [
        `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        src,
    ];
}

function cargar(url, { minimo = 1, esperaMs = 4000 } = {}) {
    return new Promise((resolve) => {
        const img = new Image();
        if (!/^(data|blob):/.test(url)) img.crossOrigin = 'anonymous';
        const fin = (valor) => { clearTimeout(reloj); resolve(valor); };
        const reloj = setTimeout(() => fin(null), esperaMs);
        img.onload = () => fin(img.naturalWidth >= minimo ? img : null);
        img.onerror = () => fin(null);
        img.src = url;
    });
}

function dibujar(img, recorte, lado) {
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = lado;
    const ctx = lienzo.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, recorte.x, recorte.y, recorte.lado, recorte.lado, 0, 0, lado, lado);
    return lienzo.toDataURL('image/jpeg', 0.85);
}

async function generar(src) {
    const lista = candidatas(src);
    for (const [i, url] of lista.entries()) {
        // YouTube responde a una versión que no existe con un gris de 120×90:
        // a las mejoradas se les pide tamaño; la original, la que haya
        const mejorada = i < lista.length - 1;
        const img = await cargar(url, { minimo: mejorada ? 200 : 1 });
        if (!img) continue;
        try {
            const ancho = img.naturalWidth, alto = img.naturalHeight;
            const lienzo = document.createElement('canvas');
            lienzo.width = ancho;
            lienzo.height = alto;
            const ctx = lienzo.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            // Lanza si la imagen llegó sin CORS: entonces se prueba la siguiente
            const { data } = ctx.getImageData(0, 0, ancho, alto);
            const recorte = recorteCuadrado(ancho, alto, bandasNegras(data, ancho, alto));
            return { web: dibujar(img, recorte, LADO_WEB), sistema: dibujar(img, recorte, LADO_SISTEMA) };
        } catch {
            // Lienzo contaminado o sin memoria: la siguiente candidata
        }
    }
    return null;
}

/**
 * `{ web, sistema }` como data URL JPEG, o null si no hay forma de sacarla.
 * Se guarda por canción: al volver a una, no se repite el trabajo.
 */
export function caratulaCuadrada(src) {
    if (!src || !globalThis.document) return Promise.resolve(null);
    if (cache.has(src)) return cache.get(src);
    const promesa = generar(src).catch(() => null);
    cache.set(src, promesa);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return promesa;
}
