/**
 * La imagen para guardar de «Tu año en música» (plan 17, T5).
 *
 * La diapositiva final dibujada en un lienzo de 1080 × 1920 (el formato de las
 * historias). En la web se descarga como PNG; en la APK se guarda en
 * `Documentos/YTMusic/`.
 *
 * Dos cuidados que no son opcionales:
 *
 * - **Se espera a `document.fonts.ready`** antes de dibujar. El lienzo no espera
 *   a las fuentes: si se dibuja antes, el texto sale con la tipografía de
 *   respaldo y con otras medidas, así que además descuadra.
 * - **La carátula solo se dibuja si se puede leer.** Una imagen de otro origen
 *   sin CORS «contamina» el lienzo y a partir de ahí `toBlob` falla, así que no
 *   habría imagen ninguna. Si no se puede, va un cuadro con el color de la
 *   paleta en su lugar (plan 17, §2.5).
 *
 * Todo el texto va con `fillText`, que no interpreta nada: los nombres vienen de
 * YouTube o de lo que haya escrito el usuario al editarlos (plan 17, §3). Y en la
 * imagen solo está lo que se ve en pantalla: ni el correo ni la foto de la cuenta.
 */

import { isNative } from '../../config/env.js';
import { sanitizeFilename } from '../../core/utils.js';
import { i18n } from '../../i18n/language-manager.js';
import { FALLBACK } from '../../ui/palette.js';
import { entregarFichero } from '../download/save.js';

/** El formato de las historias. */
export const ANCHO = 1080;
export const ALTO = 1920;

const FUENTE = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
const MARGEN = 90;
const LADO_CARATULA = 460;

/** Texto recortado con puntos suspensivos si no cabe en `ancho`. */
export function recortar(ctx, texto, ancho) {
    const limpio = String(texto ?? '');
    if (!limpio || ctx.measureText(limpio).width <= ancho) return limpio;
    let corto = limpio;
    while (corto.length > 1 && ctx.measureText(`${corto}…`).width > ancho) {
        corto = corto.slice(0, -1);
    }
    return `${corto}…`;
}

/** Lo que va en la imagen, sacado del resumen. */
export function datosDeImagen(resumen, t = (k, p) => i18n.t(k, p)) {
    return {
        titulo: t('wrapped_final_title', { anio: resumen?.anio ?? '' }),
        minutos: resumen?.minutos ?? 0,
        unidadMinutos: t('wrapped_minutes_unit'),
        artistasTitulo: t('wrapped_artists_title'),
        cancionesTitulo: t('wrapped_songs_title'),
        artistas: (resumen?.artistas ?? []).slice(0, 5).map((a) => a.artista).filter(Boolean),
        canciones: (resumen?.canciones ?? []).slice(0, 5).map((c) => c.cancion).filter(Boolean),
        pie: 'music.dannarita.es',
    };
}

function fondo(ctx, paleta) {
    const [claro, medio, oscuro] = paleta;
    const vertical = ctx.createLinearGradient(0, 0, 0, ALTO);
    vertical.addColorStop(0, medio);
    vertical.addColorStop(1, oscuro);
    ctx.fillStyle = vertical;
    ctx.fillRect(0, 0, ANCHO, ALTO);

    // Un halo del color claro arriba, como el degradado de las diapositivas
    const halo = ctx.createRadialGradient(ANCHO / 2, 0, 0, ANCHO / 2, 0, ALTO * 0.62);
    halo.addColorStop(0, claro);
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, ANCHO, ALTO * 0.62);
    ctx.globalAlpha = 1;
}

function caratula(ctx, imagen, paleta) {
    const x = (ANCHO - LADO_CARATULA) / 2;
    const y = 300;
    if (imagen) {
        ctx.drawImage(imagen, x, y, LADO_CARATULA, LADO_CARATULA);
        return;
    }
    // Sin carátula legible: un cuadro con el color de la paleta, no un hueco
    ctx.fillStyle = paleta[1];
    ctx.fillRect(x, y, LADO_CARATULA, LADO_CARATULA);
}

function lista(ctx, titulo, valores, x, y, anchoMax) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.font = `600 30px ${FUENTE}`;
    ctx.fillText(recortar(ctx, titulo, anchoMax), x, y);

    ctx.fillStyle = '#ffffff';
    valores.forEach((valor, i) => {
        const fila = y + 62 + i * 58;
        ctx.font = `800 34px ${FUENTE}`;
        ctx.fillText(`${i + 1}`, x, fila);
        ctx.font = `500 34px ${FUENTE}`;
        ctx.fillText(recortar(ctx, valor, anchoMax - 52), x + 52, fila);
    });
}

/**
 * Dibuja el resumen. Solo usa `fillRect`, `fillText` y `drawImage`, así que
 * funciona con cualquier contexto 2D (y se puede probar con uno de mentira).
 *
 * @param imagen Carátula ya cargada y legible, o null para el cuadro de color.
 */
export function dibujarResumen(ctx, resumen, paleta = FALLBACK, { imagen = null, t } = {}) {
    const d = datosDeImagen(resumen, t);
    const colores = Array.isArray(paleta) && paleta.length === 3 ? paleta : FALLBACK;

    fondo(ctx, colores);
    caratula(ctx, imagen, colores);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 58px ${FUENTE}`;
    ctx.fillText(recortar(ctx, d.titulo, ANCHO - MARGEN * 2), ANCHO / 2, 190);

    ctx.fillStyle = colores[0];
    ctx.font = `800 150px ${FUENTE}`;
    ctx.fillText(String(d.minutos), ANCHO / 2, 960);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = `600 38px ${FUENTE}`;
    ctx.fillText(d.unidadMinutos, ANCHO / 2, 1015);

    const anchoColumna = (ANCHO - MARGEN * 2 - 60) / 2;
    lista(ctx, d.artistasTitulo, d.artistas, MARGEN, 1150, anchoColumna);
    lista(ctx, d.cancionesTitulo, d.canciones, MARGEN + anchoColumna + 60, 1150, anchoColumna);

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = `500 30px ${FUENTE}`;
    ctx.fillText(d.pie, ANCHO / 2, ALTO - 80);
}

/**
 * Carga la carátula solo si se va a poder leer. Devuelve null si no: dibujarla
 * contaminaría el lienzo y entonces no habría imagen ninguna que guardar.
 */
export async function cargarCaratula(url) {
    if (!url) return null;
    try {
        const img = new Image();
        if (!/^(data|blob):/.test(url)) img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return img;
    } catch {
        return null;
    }
}

/** El lienzo con el resumen dibujado, ya con las fuentes cargadas. */
export async function construirLienzo(resumen, paleta, { miniatura = '' } = {}) {
    // Las fuentes primero: el lienzo no las espera y el texto saldría con la
    // tipografía de respaldo, con otras medidas
    try { await document.fonts?.ready; } catch { /* sin API de fuentes */ }

    const lienzo = document.createElement('canvas');
    lienzo.width = ANCHO;
    lienzo.height = ALTO;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return null;

    dibujarResumen(ctx, resumen, paleta, { imagen: await cargarCaratula(miniatura) });
    return lienzo;
}

const aBlob = (lienzo) => new Promise((resolve) => {
    try {
        lienzo.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
        resolve(null);   // lienzo contaminado, cuota, navegador antiguo…
    }
});

const nombreFichero = (anio) => `${sanitizeFilename(`music-downloader-${anio}`)}.png`;

/** Base64 de un blob, sin la cabecera `data:`, que es lo que quiere Filesystem. */
async function aBase64(blob) {
    const lector = new FileReader();
    const texto = await new Promise((resolve, reject) => {
        lector.onloadend = () => resolve(String(lector.result ?? ''));
        lector.onerror = () => reject(lector.error ?? new Error('FileReader'));
        lector.readAsDataURL(blob);
    });
    return texto.slice(texto.indexOf(',') + 1);
}

/**
 * Guarda la imagen del resumen.
 *
 * @returns Dónde quedó, para poder avisar, o null si no se pudo.
 */
export async function guardarImagen(resumen, paleta, { miniatura = '' } = {}) {
    const lienzo = await construirLienzo(resumen, paleta, { miniatura });
    if (!lienzo) return null;
    const blob = await aBlob(lienzo);
    if (!blob) return null;

    const nombre = nombreFichero(resumen?.anio ?? new Date().getFullYear());
    const fs = globalThis.Capacitor?.Plugins?.Filesystem;
    if (isNative() && fs) {
        const ruta = `YTMusic/${nombre}`;
        await fs.writeFile({ path: ruta, data: await aBase64(blob), directory: 'DOCUMENTS', recursive: true });
        return `Documentos/${ruta}`;
    }
    entregarFichero(blob, nombre);
    return nombre;
}
