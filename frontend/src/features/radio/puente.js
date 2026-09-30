/**
 * El puente de la radio (plan 16): lo que el reproductor y la hoja de la cola
 * necesitan de ella, sin cargarla.
 *
 * La radio (radio.js, la caché, elegir y la red) solo hace falta con la radio
 * encendida: se carga aparte con import() en cuanto se enciende, o al tocar
 * «Iniciar radio», como el resto de lo que no se usa al arrancar (plan 19,
 * T11 y el presupuesto de la T16). Mientras tanto, el puente contesta «nada»:
 * no hay siguiente de radio, nada que esperar y ninguna canción es de la radio.
 */

import { ajustesReproduccion, alCambiarAjustes } from '../player/settings.js';

let radio = null;
let carga = null;
let jugador = null;
const suscritos = new Set();

function cargarRadio() {
    carga ??= import('./radio.js').then(async ({ Radio }) => {
        Radio.conectar(jugador);
        for (const fn of suscritos) Radio.alCambiar(fn);
        await Radio.init();
        radio = Radio;
        for (const fn of suscritos) fn(Radio.estado());
        return Radio;
    }).catch((e) => {
        carga = null;
        throw e;
    });
    return carga;
}

export const radioActiva = () => ajustesReproduccion().radio === true;

export function conectarRadio(j) {
    jugador = j;
    radio?.conectar(j);
}

export function alCambiarRadio(fn) {
    suscritos.add(fn);
    radio?.alCambiar(fn);
}

export const estadoRadio = () => radio?.estado() ?? { activa: radioActiva(), listas: [], preparando: 0, esperando: false };
export const esDeRadio = (song) => (radio ? radio.esDeRadio(song) : Boolean(song?.radio));
export const proximaDeRadio = () => radio?.proxima() ?? null;
export const tomar = () => radio?.tomar() ?? null;
export const consumir = (song) => radio?.consumir(song);
export const saltadaEnRadio = (song, escuchado) => radio?.saltada(song, escuchado);
export const terminadaEnRadio = (song) => radio?.terminada(song);

/** Con cada canción: con la radio encendida, que se prepare si a la cola le queda poco. */
export function revisarRadio(datos) {
    if (!radioActiva()) return;
    if (radio) radio.revisar(datos);
    else cargarRadio().then((r) => r.revisar(datos)).catch(() => {});
}

/** Al acabar la cola sin nada listo. Devuelve si la radio se queda esperando. */
export function esperarRadio(actual) {
    if (!radioActiva()) return false;
    if (radio) return radio.esperar(actual);
    cargarRadio().then((r) => r.esperar(actual)).catch(() => {});
    return true;
}

export async function guardarDeRadio(song) {
    (await cargarRadio()).guardar(song);
}

export async function noMeGustaRadio(song) {
    (await cargarRadio()).noMeGusta(song);
}

/** Al arrancar: si la radio estaba encendida, se carga; y cuando se encienda. */
export function initRadio() {
    if (radioActiva()) cargarRadio().catch(() => {});
    alCambiarAjustes(() => { if (radioActiva()) cargarRadio().catch(() => {}); });
    document.getElementById('fullPlayerRadio')?.addEventListener('click', () => {
        cargarRadio().then((r) => r.iniciarDesdeActual()).catch(() => {});
    });
}
