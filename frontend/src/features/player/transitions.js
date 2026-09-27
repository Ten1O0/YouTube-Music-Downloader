/**
 * El paso de una canción a otra sobre el motor de dos elementos (plan 12, T3).
 *
 * Avanza con los `timeupdate` del elemento actual (llegan unas 4 veces por
 * segundo también con la pantalla apagada) y no con temporizadores, que
 * Android frena en segundo plano. El único temporizador, el del arranque sin
 * cortes, tiene de respaldo el 'ended' de la canción que acaba.
 *
 * Solo el paso natural al terminar tiene transición. Cambiar de canción a mano,
 * pausar o mover la barra la cancelan: ahí el cambio se quiere ya.
 */

import { planDeTransicion, curvaIgualPotencia, fundidoEfectivo } from './crossfade.js';

/**
 * @param {object} o
 * @param {ReturnType<import('./engine.js').createEngine>} o.engine
 * @param {() => number} o.fundido          segundos de fundido del ajuste (0 = sin cortes)
 * @param {() => boolean} o.repetirUna
 * @param {() => object|null} o.siguiente   la canción que toca después, sin moverse de la actual
 * @param {(song: object) => Promise<string|null>} o.resolver  su fuente reproducible
 * @param {(song: object) => number} o.ganancia
 * @param {(song: object) => void} o.alPasar la siguiente ya es la actual: cola, pantalla y sistema
 */
export function createTransiciones({ engine, fundido, repetirUna, siguiente, resolver, ganancia, alPasar }) {
    const { audio } = engine;
    // null: sin pedir · { song, src: null }: pidiendo o no hay siguiente · { song, src }: cargada
    let preparada = null;
    let arrancada = false;
    let temporizador = null;
    let turno = 0;
    let colaSaliente = null;

    function limpiarSaliente() {
        colaSaliente?.();
        colaSaliente = null;
    }

    /** Olvida la siguiente preparada y para lo que suene en el elemento libre. */
    function olvidar() {
        turno++;
        clearTimeout(temporizador);
        temporizador = null;
        // Lo que suene en el libre: la siguiente arrancada o la anterior que se apaga
        const suenaLibre = preparada?.src || arrancada || colaSaliente;
        limpiarSaliente();
        if (suenaLibre) engine.detenerLibre();
        preparada = null;
        arrancada = false;
        engine.mezclar(engine.actual(), { cruce: 1 });
    }

    /**
     * La cola o los ajustes han cambiado: la siguiente preparada puede no ser
     * ya la que toca. Un cruce que ya suena se deja terminar.
     */
    function replanificar() {
        if (arrancada || colaSaliente) return;
        turno++;
        clearTimeout(temporizador);
        temporizador = null;
        if (preparada?.src) engine.detenerLibre();
        preparada = null;
    }

    async function preparar() {
        const song = siguiente();
        const mio = ++turno;
        preparada = { song, src: null };
        if (!song) return;
        const src = await resolver(song);
        if (mio !== turno || !src) return;
        preparada = { song, src };
        engine.mezclar(engine.libre(), { ganancia: ganancia(song), cruce: 0 });
        engine.precargar(src);
    }

    function arrancar(cruce) {
        if (arrancada || !preparada?.src) return;
        arrancada = true;
        engine.mezclar(engine.libre(), { cruce });
        engine.libre().play().catch((e) => console.warn('[Transición] No arrancó la siguiente:', e));
    }

    /**
     * La siguiente pasa a ser la actual. La que sale termina su parte del
     * fundido por su cuenta, y hasta que acaba nadie toca su elemento: ni
     * siquiera la precarga de la canción que venga después.
     */
    function pasar() {
        const { song } = preparada;
        const saliente = engine.actual();
        const entrante = engine.libre();
        const n = fundidoEfectivo(fundido(), saliente.duration);
        clearTimeout(temporizador);
        temporizador = null;
        preparada = null;
        arrancada = false;

        // La cola de la que sale se prepara ANTES del intercambio: el
        // intercambio repite un timeupdate, y con la cola ya puesta no se
        // planifica nada hasta que el reproductor sepa qué canción suena
        const conFundido = n > 0 && !saliente.ended;
        const bajar = () => {
            const x = 1 - Math.max(0, saliente.duration - saliente.currentTime) / n;
            const { sale, entra } = curvaIgualPotencia(x);
            engine.mezclar(saliente, { cruce: sale });
            engine.mezclar(entrante, { cruce: Math.max(entra, 0) });
        };
        const fin = () => {
            limpiarSaliente();
            if (engine.libre() === saliente) engine.detenerLibre();
            engine.mezclar(entrante, { cruce: 1 });
        };
        if (conFundido) saliente.addEventListener('timeupdate', bajar);
        else engine.mezclar(entrante, { cruce: 1 });
        saliente.addEventListener('ended', fin);
        colaSaliente = () => {
            saliente.removeEventListener('timeupdate', bajar);
            saliente.removeEventListener('ended', fin);
        };

        engine.intercambiar();
        alPasar(song);
        // Por el respaldo del 'ended', la que sale puede haber acabado ya
        if (saliente.ended) fin();
    }

    function repitiendo() {
        return repetirUna() || engine.actual().loop;
    }

    audio.addEventListener('timeupdate', () => {
        if (colaSaliente) return; // aún se apaga la anterior: su elemento no se toca
        const el = engine.actual();
        if (el.paused) return;
        const plan = planDeTransicion({
            duracion: el.duration,
            actual: el.currentTime,
            fundido: fundido(),
            repetir: repitiendo(),
            haySiguiente: preparada === null || Boolean(preparada.song),
        });
        if (plan.precargar && preparada === null) preparar();
        if (!preparada?.src || plan.arrancarEn === null) return;

        if (plan.cruce === null) {
            // Sin cortes: justo al acabar. El 'ended' hace de respaldo
            if (!temporizador && !arrancada) {
                temporizador = setTimeout(() => { temporizador = null; if (preparada?.src) { arrancar(1); pasar(); } }, plan.arrancarEn * 1000);
            }
            return;
        }
        const { sale, entra } = curvaIgualPotencia(plan.cruce);
        arrancar(entra);
        engine.mezclar(el, { cruce: sale });
        engine.mezclar(engine.libre(), { cruce: entra });
        if (plan.cambiar) pasar();
    });

    // Respaldo: la actual se acaba con la siguiente ya cargada y aún sin arrancar
    engine.interceptar('ended', () => {
        if (repitiendo() || !preparada?.src) return false;
        arrancar(1);
        pasar();
        return true;
    });

    // Pausar o mover la barra cancela la transición en curso. La pausa que
    // llega justo antes del 'ended' no cuenta: es la del final de la canción
    audio.addEventListener('pause', () => {
        const el = engine.actual();
        if (el.ended || el.duration - el.currentTime < 0.3) return;
        if (arrancada || colaSaliente) olvidar();
    });
    audio.addEventListener('seeking', () => { if (arrancada || colaSaliente || preparada) olvidar(); });

    // La precargada no se puede cargar (fichero dañado, blob perdido): sin
    // transición. Al acabar, el reproductor la intenta por el camino de
    // siempre, que avisa si falta el audio, en vez de pasar a un elemento mudo
    for (const el of [engine.actual(), engine.libre()]) {
        el.addEventListener('error', () => {
            if (el === engine.libre() && preparada?.src && !arrancada) preparada = { song: null, src: null };
        });
    }

    return { olvidar, replanificar };
}
