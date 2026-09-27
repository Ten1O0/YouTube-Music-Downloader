/**
 * El visualizador (plan 12, T7): barras bajo la carátula de la pantalla
 * completa, con los colores de la carátula.
 *
 * Solo **escucha** una copia del sonido (`captureStream()` → AnalyserNode): el
 * audio sigue saliendo por el <audio>, así que aunque esto falle, la música no
 * se corta. Si el navegador no sabe capturar, el lienzo no aparece.
 *
 * Solo trabaja con la pantalla completa abierta, la app visible y sin
 * «Reducir movimiento». Al dejar de verse suspende su AudioContext: en el
 * emulador se comprobó que, si no, sigue analizando con la pantalla apagada.
 */

export const BARRAS = 32;
const F_MIN = 50;
const F_MAX = 16000;
const MS_POR_CUADRO = 1000 / 30;

/**
 * Rangos de bins de la FFT para `n` bandas espaciadas en escala logarítmica.
 * Cada banda tiene al menos un bin. Pura.
 * @returns {[number, number][]} [desde, hasta] inclusivos
 */
export function bandasLog(nBins, frecuencia, n = BARRAS, fMin = F_MIN, fMax = F_MAX) {
    const anchoBin = frecuencia / 2 / nBins;
    const tope = Math.min(fMax, frecuencia / 2);
    const bandas = [];
    for (let i = 0; i < n; i++) {
        const f0 = fMin * (tope / fMin) ** (i / n);
        const f1 = fMin * (tope / fMin) ** ((i + 1) / n);
        const desde = Math.min(nBins - 1, Math.floor(f0 / anchoBin));
        const hasta = Math.min(nBins - 1, Math.max(desde, Math.ceil(f1 / anchoBin) - 1));
        bandas.push([desde, hasta]);
    }
    return bandas;
}

/** Altura 0-1 de cada banda: el máximo de sus bins. Pura. */
export function alturas(datos, bandas) {
    return bandas.map(([desde, hasta]) => {
        let m = 0;
        for (let i = desde; i <= hasta; i++) if (datos[i] > m) m = datos[i];
        return m / 255;
    });
}

/** Un color #rrggbb mezclado con blanco en proporción `t`: las barras destacan sobre el fondo. Pura. */
export function aclarar(hex, t = 0.45) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return '#DFCDAC';
    const n = Number.parseInt(m[1], 16);
    const canal = (c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
    return `#${canal((n >> 16) & 255)}${canal((n >> 8) & 255)}${canal(n & 255)}`;
}

export const puedeVisualizar = (el) => typeof el?.captureStream === 'function'
    && typeof globalThis.AudioContext === 'function';

/**
 * @param {{ lienzo: HTMLCanvasElement, colores: () => [string, string] }} o
 */
export function crearVisualizador({ lienzo, colores }) {
    let ctx = null;
    let analizador = null;
    let datos = null;
    let bandas = null;
    let fuente = null;
    let elemento = null;
    const streams = new WeakMap();
    let cuadro = null;
    let ultimo = 0;
    let activo = false;
    let cuadros = 0;

    function contexto() {
        if (ctx) return ctx;
        ctx = new AudioContext();
        analizador = ctx.createAnalyser();
        analizador.fftSize = 256;
        analizador.smoothingTimeConstant = 0.8;
        datos = new Uint8Array(analizador.frequencyBinCount);
        bandas = bandasLog(analizador.frequencyBinCount, ctx.sampleRate);
        // El analizador solo se actualiza si alguien tira de él: un nodo mudo
        // hasta la salida. Suena silencio; la música va por el <audio>
        const mudo = ctx.createGain();
        mudo.gain.value = 0;
        analizador.connect(mudo).connect(ctx.destination);
        return ctx;
    }

    /** La copia del sonido de un elemento. Al cambiar de canción, su pista se sustituye. */
    function streamDe(el) {
        if (!streams.has(el)) {
            const stream = el.captureStream();
            stream.addEventListener('addtrack', () => { if (el === elemento) enchufar(); });
            streams.set(el, stream);
        }
        return streams.get(el);
    }

    function enchufar() {
        if (!ctx || !elemento) return;
        try { fuente?.disconnect(); } catch { /* ya desconectada */ }
        fuente = null;
        try {
            const stream = streamDe(elemento);
            if (!stream.getAudioTracks().length) return; // llegará con 'addtrack'
            fuente = ctx.createMediaStreamSource(stream);
            fuente.connect(analizador);
        } catch (e) {
            console.debug('[Visualizador] No se pudo escuchar el audio:', e);
        }
    }

    function dibujar(ahora) {
        cuadro = requestAnimationFrame(dibujar);
        if (ahora - ultimo < MS_POR_CUADRO) return;
        ultimo = ahora;
        const pr = globalThis.devicePixelRatio || 1;
        const ancho = Math.round(lienzo.clientWidth * pr);
        const alto = Math.round(lienzo.clientHeight * pr);
        if (!ancho || !alto) return;
        if (lienzo.width !== ancho || lienzo.height !== alto) { lienzo.width = ancho; lienzo.height = alto; }
        const g = lienzo.getContext('2d');
        g.clearRect(0, 0, ancho, alto);
        if (!fuente) return;
        analizador.getByteFrequencyData(datos);
        const h = alturas(datos, bandas);
        const [c1, c2] = colores();
        const degradado = g.createLinearGradient(0, 0, ancho, 0);
        degradado.addColorStop(0, aclarar(c1));
        degradado.addColorStop(1, aclarar(c2));
        g.fillStyle = degradado;
        const paso = ancho / h.length;
        const barra = Math.max(1, paso * 0.55);
        h.forEach((v, i) => {
            const alturaBarra = Math.max(pr * 2, v * alto);
            const x = i * paso + (paso - barra) / 2;
            g.beginPath();
            if (g.roundRect) g.roundRect(x, alto - alturaBarra, barra, alturaBarra, barra / 2);
            else g.rect(x, alto - alturaBarra, barra, alturaBarra);
            g.fill();
        });
        lienzo.dataset.cuadros = String(++cuadros);
    }

    return {
        /** Escuchar este elemento (el motor avisa en cada cambio de canción). */
        conectar(el) {
            elemento = el;
            if (activo) enchufar();
        },
        /** Empezar a dibujar. Tras un gesto del usuario, que es cuando el navegador deja crear audio. */
        iniciar() {
            if (activo || !puedeVisualizar(elemento)) return false;
            activo = true;
            lienzo.hidden = false;
            contexto().resume().catch(() => {});
            enchufar();
            cuadro = requestAnimationFrame(dibujar);
            return true;
        },
        /** Dejar de dibujar y de analizar. `ocultar` quita además el lienzo. */
        parar({ ocultar = false } = {}) {
            if (ocultar) lienzo.hidden = true;
            if (!activo) return;
            activo = false;
            cancelAnimationFrame(cuadro);
            cuadro = null;
            try { fuente?.disconnect(); } catch { /* ya desconectada */ }
            fuente = null;
            ctx?.suspend().catch(() => {});
        },
        activo: () => activo,
    };
}
