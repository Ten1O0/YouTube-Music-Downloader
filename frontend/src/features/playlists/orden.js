/**
 * El orden y el resumen de una lista (plan 23, T4).
 *
 * Como en la biblioteca: primero lo descargado y después lo de la nube, cada
 * grupo en el orden que le dio el usuario. El orden guardado no cambia: la
 * lista sigue con sus canciones como estaban, y al reordenar a mano cada
 * canción se mueve dentro de su grupo, ocupando los huecos de su grupo. Así, si
 * una de la nube se descarga, vuelve a aparecer donde la puso el usuario.
 *
 * Puro, salvo los textos, que salen de i18n.
 */

import { duracionTotal, segundosDe } from '../../core/duracion.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { esNube } from '../sync/fusion.js';

/** Las canciones en el orden en que se ven: lo descargado y, después, lo de la nube. */
export function ordenDeVista(canciones) {
    const lista = canciones ?? [];
    return [...lista.filter((s) => !esNube(s)), ...lista.filter((s) => esNube(s))];
}

/**
 * El orden guardado después de arrastrar en la vista la canción de la posición
 * `desde` a la `hasta`. Se queda dentro de su grupo: si se suelta en el otro,
 * va al extremo del suyo más cercano. Devuelve una lista nueva.
 */
export function moverEnGrupo(canciones, desde, hasta) {
    const lista = [...(canciones ?? [])];
    const vista = ordenDeVista(lista);
    const movida = vista[desde];
    if (!movida || desde === hasta) return lista;

    const nube = esNube(movida);
    // Los huecos de su grupo en el orden guardado, y el grupo tal como se ve
    const huecos = lista.map((s, i) => (esNube(s) === nube ? i : -1)).filter((i) => i >= 0);
    const grupo = huecos.map((i) => lista[i]);
    const inicioGrupo = nube ? vista.length - grupo.length : 0;
    const origen = desde - inicioGrupo;
    const destino = Math.min(grupo.length - 1, Math.max(0, hasta - inicioGrupo));

    const [quitada] = grupo.splice(origen, 1);
    grupo.splice(destino, 0, quitada);
    huecos.forEach((i, k) => { lista[i] = grupo[k]; });
    return lista;
}

/** Lo que se cuenta de una lista: cuántas, cuánto dura lo descargado y cuántas en la nube. */
export function cuentasDeLista(canciones) {
    const lista = canciones ?? [];
    const descargadas = lista.filter((s) => !esNube(s));
    return {
        total: lista.length,
        segundos: descargadas.reduce((n, s) => n + segundosDe(s), 0),
        enNube: lista.length - descargadas.length,
    };
}

/** «12 canciones · 47 min · 3 en la nube». Sin duración o sin nube, esas partes no salen. */
export function textoDeLista(canciones) {
    const { total, segundos, enNube } = cuentasDeLista(canciones);
    return [
        contarCanciones(total),
        duracionTotal(segundos),
        enNube ? i18n.t('pl_in_cloud', { n: enNube }) : '',
    ].filter(Boolean).join(' · ');
}
