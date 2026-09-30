/**
 * La cuenta de la sonoridad, fuera del hilo principal (plan 19, T12).
 *
 * Filtrar millones de muestras son cientos de milisegundos en un móvil: en el
 * hilo principal, un tirón en mitad del scroll. Aquí se hace la misma cuenta
 * (`sonoridad`, de core/loudness.js) con los canales que ya ha decodificado
 * la página, que llegan transferidos, sin copia.
 */

import { sonoridad } from '../../core/loudness.js';

self.onmessage = ({ data: { id, canales, fs } }) => {
    let medida = null;
    try {
        medida = sonoridad(canales, fs);
    } catch { /* se queda sin medida: se reintentará como cualquier fallo */ }
    self.postMessage({ id, medida });
};
