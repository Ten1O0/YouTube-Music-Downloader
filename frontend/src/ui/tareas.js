/**
 * Planificador del trabajo de fondo (plan 19, T12).
 *
 * Sincronizar, medir la sonoridad, reparar identidades o comprobar si hay
 * versión nueva no corre prisa; que el scroll y los toques vayan finos, sí.
 * Todo ese trabajo pide turno aquí y el planificador se lo da:
 *
 * - cuando el navegador está desocupado (`requestIdleCallback`);
 * - nunca con un dedo en la pantalla, durante un scroll ni mientras dura una
 *   animación (hasta un rato después del último gesto);
 * - por orden de prioridad: lo que el usuario echaría en falta antes, antes.
 *
 * Una tarea larga se trocea con `ceder()`: si su trozo pasa de unos
 * milisegundos o el usuario ha vuelto a tocar, espera otro turno.
 */

export const PRIORIDAD = { alta: 0, normal: 1, baja: 2 };

/** Cuánto se espera tras el último scroll o toque para volver a trabajar. */
export const QUIETO_MS = 300;
/** Lo que puede durar un trozo antes de ceder: holgado dentro de un fotograma. */
export const TROZO_MS = 8;
/** Un dedo «puesto» más tiempo que esto es un pointerup perdido, no un gesto. */
const DEDO_MAX_MS = 10_000;

const entorno = {
    ahora: () => globalThis.performance?.now?.() ?? Date.now(),
    /** Llama a `fn` en el próximo hueco del navegador. */
    hueco: (fn) => (typeof globalThis.requestIdleCallback === 'function'
        ? globalThis.requestIdleCallback(fn, { timeout: 2_000 })
        : setTimeout(fn, 50)),
    /** Animaciones con final en curso (las infinitas, como la carátula que respira, no cuentan). */
    animando: () => {
        try {
            return (globalThis.document?.getAnimations?.() ?? []).some((a) => (
                a.playState === 'running' && a.effect?.getTiming?.().iterations !== Infinity));
        } catch {
            return false;
        }
    },
};

let ultimoGesto = -Infinity;
let dedoDesde = null;
let ocupadoHasta = -Infinity;
let inicioTrozo = -Infinity;
let esperando = [];
let bombeando = false;
let escuchando = false;

function escucharGestos() {
    if (escuchando || typeof document === 'undefined') return;
    escuchando = true;
    const gesto = () => { ultimoGesto = entorno.ahora(); };
    const pasivo = { capture: true, passive: true };
    // scroll no sube por el árbol, pero se captura desde el documento
    for (const tipo of ['scroll', 'wheel', 'touchmove']) document.addEventListener(tipo, gesto, pasivo);
    document.addEventListener('pointerdown', () => { dedoDesde = entorno.ahora(); gesto(); }, pasivo);
    for (const tipo of ['pointerup', 'pointercancel']) {
        document.addEventListener(tipo, () => { dedoDesde = null; gesto(); }, pasivo);
    }
}

/**
 * Avisa de que hay algo en marcha que el trabajo de fondo no debe estorbar
 * durante `ms` (una animación en JavaScript, por ejemplo).
 */
export function marcarOcupado(ms) {
    ocupadoHasta = Math.max(ocupadoHasta, entorno.ahora() + ms);
}

/** true si el usuario está haciendo algo y conviene no ocupar el hilo. */
export function usuarioOcupado() {
    const ahora = entorno.ahora();
    if (dedoDesde != null && ahora - dedoDesde < DEDO_MAX_MS) return true;
    return ahora - ultimoGesto < QUIETO_MS || ahora < ocupadoHasta || entorno.animando();
}

function bombear() {
    if (bombeando || !esperando.length) return;
    bombeando = true;
    entorno.hueco(() => {
        bombeando = false;
        if (!esperando.length) return;
        if (usuarioOcupado()) {
            // Se vuelve a mirar cuando el gesto haya tenido tiempo de acabar
            bombeando = true;
            setTimeout(() => { bombeando = false; bombear(); }, QUIETO_MS);
            return;
        }
        // Un turno por hueco: el de más prioridad y, a igualdad, el más antiguo
        esperando.sort((a, b) => a.prioridad - b.prioridad || a.orden - b.orden);
        const { ok } = esperando.shift();
        inicioTrozo = entorno.ahora();
        ok();
        bombear();
    });
}

let orden = 0;

/** Espera a que toque trabajar. */
export function esperarTurno(prioridad = PRIORIDAD.normal) {
    escucharGestos();
    return new Promise((ok) => {
        esperando.push({ ok, prioridad, orden: orden++ });
        bombear();
    });
}

/**
 * Dentro de una tarea larga, entre paso y paso: sigue si queda trozo y el
 * usuario no está haciendo nada; si no, espera otro turno.
 */
export async function ceder(prioridad = PRIORIDAD.normal) {
    if (entorno.ahora() - inicioTrozo < TROZO_MS && !usuarioOcupado()) return;
    await esperarTurno(prioridad);
}

/**
 * Suelta el hilo un instante para que pase lo que el usuario haya tocado, sin
 * esperar a que haya calma: para trabajo que sí corre prisa (lo que se ve
 * nada más arrancar) pero no tiene por qué ir de una sola tirada.
 */
export function soltarHilo() {
    if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield();
    return new Promise((ok) => setTimeout(ok, 0));
}

/** Ejecuta `fn` cuando toque. Devuelve lo que devuelva `fn`. */
export async function tarea(fn, { prioridad = PRIORIDAD.normal } = {}) {
    await esperarTurno(prioridad);
    return fn();
}

/** Solo para los tests: otro reloj, otro hueco, estado limpio. */
export function _probar(cambios = {}) {
    Object.assign(entorno, cambios);
    ultimoGesto = -Infinity;
    dedoDesde = null;
    ocupadoHasta = -Infinity;
    inicioTrozo = -Infinity;
    esperando = [];
    bombeando = false;
    return {
        gesto: () => { ultimoGesto = entorno.ahora(); },
        dedo: (puesto) => { dedoDesde = puesto ? entorno.ahora() : null; },
        pendientes: () => esperando.length,
    };
}
