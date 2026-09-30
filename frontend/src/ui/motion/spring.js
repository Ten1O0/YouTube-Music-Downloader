/**
 * Muelles de la interfaz (plan 09, T2).
 *
 * Cada muelle se describe como en Apple: cuánto parece durar y cuánto rebota.
 * Con masa 1:
 *
 *     rigidez        k = (2π / duración)²
 *     amortiguación  c = 4π · (1 − rebote) / duración
 *
 * La misma física genera las curvas `linear()` de styles.css (con
 * scripts/generate-springs.mjs) y mueve lo que sigue al dedo: una transición
 * CSS y un gesto se sienten igual porque salen de la misma función.
 */

/** Los tres muelles del sistema. Sus nombres en la documentación: suave, ágil y vivo. */
export const SPRINGS = {
    smooth: { duration: 0.45, bounce: 0 },     // vistas, hojas, transformación
    snappy: { duration: 0.30, bounce: 0.15 },  // pulsaciones, controles, volver a su sitio
    bouncy: { duration: 0.50, bounce: 0.32 },  // favorito, isla, carátula al reproducir
};

/** Rigidez y amortiguación a partir de duración percibida y rebote. */
export function physics({ duration, bounce }) {
    return {
        stiffness: (2 * Math.PI / duration) ** 2,
        damping: (4 * Math.PI * (1 - bounce)) / duration,
    };
}

function resolvePreset(preset) {
    if (typeof preset === 'string') {
        const p = SPRINGS[preset];
        if (!p) throw new Error(`Muelle desconocido: ${preset}`);
        return p;
    }
    return preset;
}

/**
 * Curva CSS `linear()` de un muelle que va de 0 a 1, con un punto por
 * fotograma (1/60 s), y el tiempo que tarda en asentarse.
 */
export function springToLinear(preset) {
    const { stiffness: k, damping: c } = physics(resolvePreset(preset));
    const h = 1 / 1200;
    const points = [0];
    let x = 0, v = 0, t = 0, next = 1 / 60;
    while (t < 4) {
        const a = -k * (x - 1) - c * v;
        v += a * h; x += v * h; t += h;
        if (t >= next) {
            points.push(x);
            next += 1 / 60;
            if (t > 0.1 && Math.abs(1 - x) < 0.001 && Math.abs(v) < 0.02) break;
        }
    }
    points[points.length - 1] = 1;
    return {
        easing: `linear(${points.map(n => +n.toFixed(4)).join(', ')})`,
        durationMs: Math.round(t * 1000),
    };
}

/**
 * Curva y duración de un muelle tal y como las ve CSS ahora mismo, para
 * bibliotecas que animan con transiciones propias (Sortable). Se leen los
 * tokens de styles.css porque ya incluyen el respaldo sin `linear()`, la
 * ralentización de depuración y «Reducir movimiento» (duración 1 ms).
 */
export function springTiming(preset) {
    const propia = springToLinear(preset);
    try {
        const estilo = getComputedStyle(document.documentElement);
        const easing = estilo.getPropertyValue(`--spring-${preset}`).trim();
        const durationMs = Number.parseFloat(estilo.getPropertyValue(`--spring-${preset}-duration`));
        if (easing && durationMs > 0) return { easing, durationMs };
    } catch { /* fuera del navegador */ }
    return propia;
}

let conLinear = null;
/** ¿Entiende el navegador las curvas linear()? (las WebView antiguas, no) */
function soportaLinear() {
    conLinear ??= Boolean(globalThis.CSS?.supports?.('animation-timing-function', 'linear(0, 0.5, 1)'));
    return conLinear;
}

/**
 * Anima con Web Animations y la curva del muelle (plan 19, T9): la ejecuta el
 * compositor, así que no se atasca aunque el hilo principal esté ocupado.
 * Solo para lo que va de un sitio a otro sin cambiar de rumbo a mitad; lo que
 * sigue al dedo o se redirige sigue con `Spring`. Devuelve null si el
 * navegador no entiende `linear()`: entonces se anima con `Spring`, como antes.
 */
export function animarConMuelle(el, fotogramas, preset) {
    if (typeof el?.animate !== 'function' || !soportaLinear()) return null;
    const { easing, durationMs } = curvaDeMuelle(preset);
    return el.animate(fotogramas, { duration: durationMs * scheduler.slow, easing });
}

const curvas = new Map();
/**
 * La curva `linear()` que recorre `Spring`, fotograma a fotograma: el mismo
 * integrador (pasos de 1/600 s, contados con enteros para que no se desfase)
 * y asentada con más finura que la de los tokens de CSS, porque una fila
 * puede deslizarse miles de píxeles y tiene que llegar sin saltito final.
 */
export function curvaDeMuelle(preset) {
    const clave = typeof preset === 'string' ? preset : JSON.stringify(preset);
    if (curvas.has(clave)) return curvas.get(clave);
    const { stiffness: k, damping: c } = physics(resolvePreset(preset));
    const h = 1 / 600, pasosPorFotograma = 10;
    const puntos = [0];
    let x = 0, v = 0;
    for (let fotograma = 1; fotograma <= 240; fotograma++) {
        for (let i = 0; i < pasosPorFotograma; i++) {
            const a = -k * (x - 1) - c * v;
            v += a * h; x += v * h;
        }
        puntos.push(x);
        if (fotograma > 6 && Math.abs(1 - x) < 0.0001 && Math.abs(v) < 0.002) break;
    }
    puntos[puntos.length - 1] = 1;
    const curva = {
        easing: `linear(${puntos.map(n => +n.toFixed(5)).join(', ')})`,
        durationMs: (puntos.length - 1) * 1000 / 60,
    };
    curvas.set(clave, curva);
    return curva;
}

/**
 * Planificador de fotogramas. Se sustituye en los tests por uno manual.
 * `slow` multiplica el tiempo (ayuda para depurar: localStorage
 * 'motion-debug-slow' = '4' lo ralentiza todo cuatro veces).
 */
export const scheduler = {
    now: () => (globalThis.performance ? performance.now() : Date.now()),
    request: (cb) => (globalThis.requestAnimationFrame ? requestAnimationFrame(cb) : setTimeout(() => cb(Date.now()), 16)),
    cancel: (id) => (globalThis.cancelAnimationFrame ? cancelAnimationFrame(id) : clearTimeout(id)),
    slow: 1,
};

// Solo en el navegador: en Node, tocar localStorage da un aviso.
if (globalThis.document) {
    try {
        const lento = Number(globalThis.localStorage?.getItem('motion-debug-slow'));
        if (lento > 1) {
            scheduler.slow = lento;
            // Las transiciones CSS usan estos tokens: basta con estirarlos.
            const raiz = document.documentElement;
            const estilo = getComputedStyle(raiz);
            for (const token of ['--spring-smooth-duration', '--spring-snappy-duration', '--spring-bouncy-duration', '--fade-fast', '--fade']) {
                const ms = parseFloat(estilo.getPropertyValue(token));
                if (ms > 0) raiz.style.setProperty(token, `${ms * lento}ms`);
            }
        }
    } catch { /* sin localStorage: velocidad normal */ }
}

/** true si el sistema pide reducir el movimiento. Se consulta en vivo. */
export function prefersReducedMotion() {
    try {
        return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    } catch {
        return false;
    }
}

/**
 * Un valor que se mueve con un muelle y se puede redirigir en cualquier
 * momento conservando su velocidad.
 *
 *     const s = new Spring({ value: 0, preset: 'smooth', onUpdate: v => … });
 *     await s.to(1);                       // se asienta
 *     s.to(0, { velocity: -800 });         // cambia de rumbo con velocidad
 */
export class Spring {
    constructor({ value = 0, preset = 'smooth', onUpdate = () => {}, precision = 0.01 } = {}) {
        this._x = value;
        this._target = value;
        this._v = 0;
        this._preset = resolvePreset(preset);
        this._onUpdate = onUpdate;
        this._precision = precision;
        this._frame = 0;
        this._last = 0;
        this._pending = [];
        this._step = this._step.bind(this);
    }

    get value() { return this._x; }
    get velocity() { return this._v; }
    get target() { return this._target; }
    get animating() { return this._frame !== 0; }

    /** Se mueve hacia `target`. La promesa se resuelve al asentarse (o al detenerlo). */
    to(target, { preset, velocity } = {}) {
        if (preset) this._preset = resolvePreset(preset);
        if (velocity !== undefined) this._v = velocity;
        this._target = target;
        if (prefersReducedMotion()) {
            this.jump(target);
            return Promise.resolve();
        }
        const promise = new Promise(resolve => this._pending.push(resolve));
        if (!this._frame) {
            this._last = scheduler.now();
            this._frame = scheduler.request(this._step);
        }
        return promise;
    }

    /** Coloca el valor sin animación. */
    jump(value) {
        this._cancel();
        this._x = this._target = value;
        this._v = 0;
        this._onUpdate(value);
        this._flush();
    }

    /** Se queda donde está, con velocidad 0 (p. ej. al agarrarlo con el dedo). */
    stop() {
        this._cancel();
        this._target = this._x;
        this._v = 0;
        this._flush();
    }

    _cancel() {
        if (this._frame) scheduler.cancel(this._frame);
        this._frame = 0;
    }

    _flush() {
        this._pending.splice(0).forEach(resolve => resolve());
    }

    _step(now) {
        // Con la pestaña en segundo plano el hueco entre fotogramas puede ser
        // de segundos: se limita para que el muelle no dé un salto.
        let dt = Math.min(((now ?? scheduler.now()) - this._last) / 1000, 1 / 30) / scheduler.slow;
        this._last = now ?? scheduler.now();
        const { stiffness: k, damping: c } = physics(this._preset);
        const h = 1 / 600;
        while (dt > 1e-9) {
            const s = Math.min(h, dt);
            const a = -k * (this._x - this._target) - c * this._v;
            this._v += a * s;
            this._x += this._v * s;
            dt -= s;
        }
        if (Math.abs(this._x - this._target) < this._precision && Math.abs(this._v) < this._precision * 12) {
            this._x = this._target;
            this._v = 0;
            this._frame = 0;
            this._onUpdate(this._x);
            this._flush();
            return;
        }
        this._onUpdate(this._x);
        this._frame = scheduler.request(this._step);
    }
}
