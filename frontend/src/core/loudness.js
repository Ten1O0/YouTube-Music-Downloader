/**
 * Sonoridad según ITU-R BS.1770 / EBU R128 y el volumen con el que suena cada
 * canción (plan 12, T5 y T6). Sin DOM: se prueba en Node con tonos sintéticos.
 *
 * Se mide con los canales originales (decodeAudioData los conserva al
 * remuestrear), no con una mezcla a mono: con un estéreo abierto, el mono más
 * la compensación de 3 dB se quedaría corto.
 *
 * La igualación solo **atenúa**: el audio sale por el <audio> del navegador y
 * su volumen no pasa de 1 (el porqué, en el plan 12, §2.1). Por eso el
 * objetivo es algo más bajo que el de Spotify: deja iguales a más canciones.
 */

export const OBJETIVO_LUFS = -16;
const COMPUERTA_ABSOLUTA = -70;
const COMPUERTA_RELATIVA = -10;
/** Mono a partir de estéreo: al promediar los canales se pierden 3,01 dB de energía. */
export const COMPENSACION_MONO = 10 * Math.log10(2);

/**
 * Coeficientes del filtro K para cualquier frecuencia de muestreo: la
 * estantería de agudos y el paso alto de la norma, calculados desde sus
 * prototipos (los mismos valores que libebur128). A 48 kHz dan los de la tabla
 * de BS.1770.
 */
export function coeficientesFiltroK(fs) {
    let f0 = 1681.974450955533;
    const G = 3.999843853973347;
    let Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / fs);
    const Vh = 10 ** (G / 20);
    const Vb = Vh ** 0.4996667741545416;
    let a0 = 1 + K / Q + K * K;
    const estanteria = {
        b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
        a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0],
    };
    f0 = 38.13547087602444;
    Q = 0.5003270373238773;
    K = Math.tan(Math.PI * f0 / fs);
    a0 = 1 + K / Q + K * K;
    const pasoAlto = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
    return [estanteria, pasoAlto];
}

const aLufs = (energia) => -0.691 + 10 * Math.log10(energia);

/**
 * Energía filtrada con el filtro K de cada tramo de 100 ms de un canal. Filtra
 * y acumula en una sola pasada: ninguna copia de la señal, que en un móvil
 * modesto son decenas de megas por canción.
 */
function energiaPorTramos(muestras, fs, paso) {
    const [e, h] = coeficientesFiltroK(fs);
    const tramos = new Float64Array(Math.floor(muestras.length / paso));
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let i = 0; i < tramos.length * paso; i++) {
        const x = muestras[i];
        const y = e.b[0] * x + e.b[1] * x1 + e.b[2] * x2 - e.a[0] * y1 - e.a[1] * y2;
        x2 = x1; x1 = x;
        const z = h.b[0] * y + h.b[1] * y1 + h.b[2] * y2 - h.a[0] * z1 - h.a[1] * z2;
        y2 = y1; y1 = y; z2 = z1; z1 = z;
        tramos[(i / paso) | 0] += z * z;
    }
    return tramos;
}

/**
 * Sonoridad integrada (LUFS) y pico de muestra (dBFS).
 * @param {Float32Array | Float32Array[]} canales  uno (mono) o varios; la norma
 *   suma la energía de cada uno (peso 1 para izquierdo y derecho)
 * @param {number} fs  frecuencia de muestreo
 * @param {{ canalesOriginales?: number }} opciones  2 si el mono sale de
 *   promediar un estéreo: se compensan los 3,01 dB perdidos (exacto si los
 *   canales son iguales; con estéreo muy abierto, se queda corto)
 * @returns {{ lufs: number, pico: number } | null}  null si es silencio o dura menos de 400 ms
 */
export function sonoridad(canales, fs, { canalesOriginales = 1 } = {}) {
    const lista = ArrayBuffer.isView(canales) ? [canales] : (canales ?? []);
    if (!lista.length || !lista[0]?.length || !(fs > 0)) return null;

    let pico = 0;
    for (const canal of lista) for (const m of canal) { const v = Math.abs(m); if (v > pico) pico = v; }

    // Bloques de 400 ms que avanzan de 100 en 100 (solape del 75 %)
    const paso = Math.round(fs * 0.1);
    const porCanal = lista.map((c) => energiaPorTramos(c, fs, paso));
    const nTramos = Math.min(...porCanal.map((t) => t.length));
    if (nTramos < 4) return null;
    const energias = [];
    for (let k = 0; k + 4 <= nTramos; k++) {
        let suma = 0;
        for (const t of porCanal) suma += (t[k] + t[k + 1] + t[k + 2] + t[k + 3]) / (paso * 4);
        energias.push(suma);
    }

    const compensacion = lista.length === 1 && canalesOriginales >= 2 ? COMPENSACION_MONO : 0;
    const lufsDe = (e) => aLufs(e) + compensacion;
    const media = (l) => l.reduce((s, e) => s + e, 0) / l.length;

    const sobreAbsoluta = energias.filter((e) => e > 0 && lufsDe(e) > COMPUERTA_ABSOLUTA);
    if (!sobreAbsoluta.length) return null;
    const umbralRelativo = lufsDe(media(sobreAbsoluta)) + COMPUERTA_RELATIVA;
    const validos = sobreAbsoluta.filter((e) => lufsDe(e) > umbralRelativo);
    const lufs = lufsDe(media(validos.length ? validos : sobreAbsoluta));
    return { lufs: Math.round(lufs * 100) / 100, pico: Math.round(20 * Math.log10(pico || 1e-9) * 100) / 100 };
}

/**
 * La medida que se guarda en la canción, validada: { lufs, pico?, fuente } o
 * null. Lo que venga raro del servidor o de una copia antigua no se usa.
 */
export function medidaSonoridad(medida, fuente) {
    const lufs = medida?.lufs;
    if (typeof lufs !== 'number' || !Number.isFinite(lufs) || lufs < -70 || lufs > 10) return null;
    const pico = medida.pico;
    return {
        lufs,
        ...(typeof pico === 'number' && Number.isFinite(pico) && pico <= 20 ? { pico } : {}),
        fuente,
    };
}

/**
 * Ganancia de una canción para que suene al objetivo. Nunca mayor que 1: si
 * la canción es más floja que el objetivo, suena como es. Sin medida, 1.
 * (El límite de pico de la norma solo importa al subir, y aquí no se sube.)
 */
export function gananciaSonoridad(loudness, objetivo = OBJETIVO_LUFS) {
    const lufs = loudness?.lufs;
    if (typeof lufs !== 'number' || !Number.isFinite(lufs)) return 1;
    return Math.min(1, 10 ** ((objetivo - lufs) / 20));
}

/**
 * El volumen real de un elemento: el del usuario, por la ganancia de su
 * canción, por su parte del fundido. Siempre entre 0 y 1.
 */
export function volumenEfectivo({ usuario = 1, ganancia = 1, cruce = 1 } = {}) {
    const v = usuario * ganancia * cruce;
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Intentos de medir una canción en el cliente antes de darla por imposible. */
export const MAX_INTENTOS_MEDIDA = 2;

/** La primera canción de la biblioteca que falta por medir en el cliente. */
export function siguienteSinMedir(biblioteca, fallos = {}) {
    return (biblioteca ?? []).find((s) => s?.src && !s.loudness && !s.unavailable && !s.nube
        && (fallos?.[s.src] ?? 0) < MAX_INTENTOS_MEDIDA) ?? null;
}
