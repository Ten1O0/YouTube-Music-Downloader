/**
 * Dónde aparece «Tu año en música» (plan 17, T6).
 *
 * - **Del 1 de diciembre al 15 de enero:** una tarjeta en Inicio, «Tu 2026 en
 *   música». Hasta el 15 de enero sigue siendo la del año anterior, que es
 *   cuando la gente mira estas cosas.
 * - **El resto del año:** desde «Tus datos», como «Tu año hasta ahora».
 * - La tarjeta se puede cerrar y no vuelve hasta el año siguiente.
 *
 * Las fechas se deciden con funciones puras sobre una fecha que se puede pasar,
 * para poder probar los límites sin tocar el reloj del sistema.
 */

import { StorageModule } from '../../core/storage.js';
import { i18n } from '../../i18n/language-manager.js';
import { HistoriaModule } from './historia.js';

/** Último día de enero en que la tarjeta sigue enseñando el año anterior. */
export const ULTIMO_DIA_ENERO = 15;

const DICIEMBRE = 11;
const ENERO = 0;

/** true si toca enseñar la tarjeta en Inicio. Se mira en la fecha local. */
export function tarjetaVisible(fecha = new Date()) {
    const mes = fecha.getMonth();
    return mes === DICIEMBRE || (mes === ENERO && fecha.getDate() <= ULTIMO_DIA_ENERO);
}

/**
 * El año que enseña la tarjeta: en diciembre, el que acaba; en enero, el que
 * acaba de terminar. Fuera de la temporada no significa nada, y por eso solo se
 * usa cuando `tarjetaVisible` dice que sí.
 */
export function anioDeCampana(fecha = new Date()) {
    return fecha.getMonth() === DICIEMBRE ? fecha.getFullYear() : fecha.getFullYear() - 1;
}

/** El año de «hasta ahora»: el que está en curso. */
export const anioEnCurso = (fecha = new Date()) => fecha.getFullYear();

/** La clave del descarte, por año: cerrarla un año no la calla para siempre. */
export const claveDescarte = (anio) => `resumen_descartado_${anio}`;

const $ = (id) => document.getElementById(id);

async function estaDescartada(anio) {
    try {
        return (await StorageModule.get(claveDescarte(anio))) === true;
    } catch {
        return false;   // sin almacenamiento, mejor enseñarla que esconderla
    }
}

async function descartar(anio) {
    try {
        await StorageModule.set(claveDescarte(anio), true);
    } catch { /* si no se puede guardar, volverá a salir: no es grave */ }
}

/**
 * Decide si la tarjeta se enseña y con qué año.
 * Pura salvo la consulta del descarte, que se le pasa.
 */
export async function estadoTarjeta(fecha = new Date(), { yaDescartada = estaDescartada } = {}) {
    if (!tarjetaVisible(fecha)) return { visible: false, anio: null };
    const anio = anioDeCampana(fecha);
    if (await yaDescartada(anio)) return { visible: false, anio };
    return { visible: true, anio };
}

/** Pinta la tarjeta con el año que toque, o la esconde. */
async function refrescarTarjeta(fecha = new Date()) {
    const tarjeta = $('wrappedCard');
    if (!tarjeta) return null;
    const { visible, anio } = await estadoTarjeta(fecha);
    tarjeta.classList.toggle('hidden', !visible);
    if (!visible) return null;
    const titulo = $('wrappedCardTitle');
    if (titulo) titulo.textContent = i18n.t('wrapped_card_title', { anio });
    return anio;
}

/**
 * Engancha las dos entradas. Se llama una vez al arrancar.
 * Devuelve el año de la tarjeta si se ha enseñado, para los tests.
 */
export async function initEntradaResumen(fecha = new Date()) {
    const anioTarjeta = await refrescarTarjeta(fecha);

    const abrir = (anio) => HistoriaModule.abrir(anio).catch((e) => console.warn('[Resumen] No se pudo abrir:', e));

    $('wrappedCardOpen')?.addEventListener('click', () => abrir(anioDeCampana(fecha)));

    $('wrappedCardDismiss')?.addEventListener('click', async () => {
        const anio = anioDeCampana(fecha);
        await descartar(anio);
        $('wrappedCard')?.classList.add('hidden');
    });

    // La entrada del resto del año: siempre el año en curso, «hasta ahora».
    // La hoja de «Tus datos» se cierra antes por su propio botón, para que su
    // contabilidad del historial quede bien y no se quede debajo de la historia.
    $('wrappedOpenBtn')?.addEventListener('click', () => {
        $('dataSheetClose')?.click();
        abrir(anioEnCurso(fecha));
    });

    return anioTarjeta;
}
