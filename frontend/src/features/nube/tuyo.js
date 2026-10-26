/**
 * Que lo tuyo sea tuyo (plan 29, T5-T7): la ventana «Tu música, de verdad
 * tuya», los recordatorios para guardar y lo que se ve en Ajustes.
 *
 * Se carga aparte: main.js lo carga en reposo, con lo demás que se carga así, y
 * también features/nube/puente.js (avisarQueSuena) antes de avisar de una
 * canción que suena desde la nube. Al cargarse se queda escuchando:
 *
 * - 'suena-desde-la-nube' (radio o nube): la primera vez en este dispositivo,
 *   la ventana; después, el recordatorio de las 3 escuchas enteras;
 * - los favoritos: dar a favorito una canción desde la nube propone guardarla;
 * - la marca «Desde la nube» de las filas (library.js la pinta como botón):
 *   tocarla la guarda, sin código en el arranque;
 * - Ajustes: al abrirse, «Tu música» con el recuento y «Por qué descargar».
 *
 * Los recordatorios siguen las reglas de recordatorios.js (2 al día, nunca la
 * primera vez, una descartada no vuelve) y nunca pisan un «Deshacer» a la vista.
 */

import { html } from '../../core/html.js';
import { StorageModule } from '../../core/storage.js';
import { i18n } from '../../i18n/language-manager.js';
import { confirmar } from '../../ui/confirm.js';
import { FavoritesModule } from '../favorites/store.js';
import { LibraryModule } from '../library/library.js';
import { getPlaylists } from '../playlists/store.js';
import { suenaDesdeLaNube } from './modelo.js';
import { guardarDesdeLaNube } from './puente.js';
import * as R from './recordatorios.js';
import { recuento, textoRecuento } from './recuento.js';
import { textoTuyo } from './textos-tuyo.js';

/** La ventana ya se vio en este dispositivo. */
const CLAVE_VISTA = 'nube_tuya_vista';
/** El estado de los recordatorios (recordatorios.js). */
const CLAVE_ESTADO = 'nube_recordatorios';
/** Lo que se deja ver un recordatorio: da tiempo a leer la frase. */
export const DURACION_RECORDATORIO = 8_000;

// ── T5 · «Tu música, de verdad tuya» ──

/** La ventana, con un solo botón: «Entendido». */
export async function ventanaTuya() {
    const no = document.getElementById('confirmNoBtn');
    if (no) no.style.display = 'none';
    try {
        await confirmar({ titulo: textoTuyo('tuyaTitulo'), mensaje: textoTuyo('tuyaTexto'), si: textoTuyo('entendido'), no: '', icono: 'verified_user' });
    } finally {
        if (no) no.style.display = '';
    }
}

function yaVista() {
    try { return localStorage.getItem(CLAVE_VISTA) === '1'; } catch { return false; }
}

/** La primera vez en este dispositivo, la ventana. Devuelve si salió. */
async function explicarUnaVez() {
    if (yaVista()) return false;
    try { localStorage.setItem(CLAVE_VISTA, '1'); } catch { /* sin almacenamiento: saldría otra vez */ }
    await ventanaTuya();
    return true;
}

// ── T6 · Recordarlo justo cuando importa ──

let cola = Promise.resolve();
/** Lee, cambia y guarda el estado de uno en uno: dos avisos seguidos no se pisan. */
function conEstado(fn) {
    cola = cola.then(async () => {
        const estado = R.leerEstado(await StorageModule.get(CLAVE_ESTADO).catch(() => null));
        const { nuevo, resultado } = await fn(estado);
        if (nuevo) await StorageModule.set(CLAVE_ESTADO, nuevo).catch(() => {});
        return resultado;
    }).catch((e) => { console.warn('[Nube] Recordatorios:', e); return null; });
    return cola;
}

/** «¿La guardas?», con «Guardar». Cerrarlo o dejarlo pasar la descarta para siempre. */
async function proponer(song, texto, id) {
    const { conDeshacer, hayPendiente } = await import('../../ui/deshacer.js');
    // Un «Deshacer» a la vista se daría por hecho antes de tiempo: esta vez no
    if (hayPendiente()) return false;
    conDeshacer({
        titulo: song.track || song.title || '',
        texto,
        miniatura: song.thumbnail || '',
        duracionMs: DURACION_RECORDATORIO,
        boton: textoTuyo('guardar'),
        bloquear: false,
        deshacer: () => guardarDesdeLaNube(song),
        confirmar: () => conEstado((e) => ({ nuevo: R.descartar(e, id, Date.now()) })),
    });
    return true;
}

/** Si toca, propone guardarla y lo cuenta para hoy. */
function siToca(song, texto, condicion = async () => true, opciones = {}) {
    const id = R.idDe(song);
    return conEstado(async (estado) => {
        if (!R.puedeRecordar(estado, id, Date.now(), opciones) || !(await condicion(id))) return {};
        if (!(await proponer(song, texto, id))) return {};
        return { nuevo: R.anotarRecordatorio(estado, Date.now()), resultado: true };
    });
}

/** Empieza a sonar una desde la nube: la ventana la primera vez; si no, ¿lleva 3 escuchas enteras? */
export async function alSonar(song) {
    if (!suenaDesdeLaNube(song)) return;
    const id = R.idDe(song);
    if (id) await conEstado((e) => ({ nuevo: R.anotarQueSuena(e, id) }));
    if (await explicarUnaVez()) return;
    await siToca(song, textoTuyo('tresVeces'), async (clave) => {
        const filas = await StorageModule.leerEscuchas?.().catch(() => []) ?? [];
        return R.escuchasEnteras(filas, clave, song.duration) >= R.ESCUCHAS_PARA_RECORDAR;
    });
}

/**
 * Le ha dado a favorito: si suena desde la nube, propone guardarla (sin
 * guardarla sola), también la primera vez que suena (decidido el 2026-10-26).
 */
export function alDarFavorito(song) {
    if (!suenaDesdeLaNube(song)) return null;
    return siToca(song, textoTuyo('favorito'), undefined, { aunqueSeaLaPrimera: true });
}

/**
 * Se entera de los favoritos sin tocar el arranque: envuelve toggleFavorite,
 * que devuelve true al añadir. Quien lo llama lo hace siempre por el módulo.
 */
function escucharFavoritos() {
    const original = FavoritesModule.toggleFavorite;
    if (original.envuelto) return;
    const envuelto = async (video, boton) => {
        const anadido = await original(video, boton);
        if (anadido === true) alDarFavorito(video);
        return anadido;
    };
    envuelto.envuelto = true;
    FavoritesModule.toggleFavorite = envuelto;
}

// ── T7 · Qué es tuyo y qué no ──


let faltan = [];

/** «Tu música», delante de «Reproducción»: el recuento, «Descargar las que faltan» y «Por qué descargar». */
export async function pintarEnAjustes() {
    const antes = document.getElementById('ajustesReproduccion');
    if (!antes) return;
    let caja = document.getElementById('ajustesTuMusica');
    if (!caja) {
        caja = document.createElement('div');
        caja.id = 'ajustesTuMusica';
        antes.before(caja);
        caja.addEventListener('click', (e) => { if (e.target.closest('#ajustesFaltanBtn')) descargarLasQueFaltan(); });
    }
    const r = recuento(await LibraryModule.getLibrary(), await getPlaylists());
    faltan = r.nube;
    const n = r.nube.length;
    caja.innerHTML = html`
        <h3 class="ajustes-seccion">${textoTuyo('tuMusica')}</h3>
        <section class="ajuste">
            <span class="ajuste-nombre" id="ajustesRecuento">${textoRecuento(r)}</span>
            <span class="ajuste-ayuda">${textoTuyo('tuyasAyuda')}</span>
            ${n ? html`<div class="datos-botones"><button id="ajustesFaltanBtn" type="button" class="pl-action-btn primary">${n === 1 ? i18n.t('pl_download_missing_one') : i18n.t('pl_download_missing', { n })}</button></div>` : ''}
            <details class="ajustes-historial" id="ajustesPorQue">
                <summary>${textoTuyo('porQue')}</summary>
                <p class="ajuste-ayuda">${textoTuyo('tuyaTexto')}</p>
            </details>
        </section>`;
}

async function descargarLasQueFaltan() {
    const { descargarCanciones } = await import('../playlists/detalle/descargar.js');
    await descargarCanciones(faltan);
}

/**
 * En la biblioteca, junto a «14 canciones» (las descargadas): «· 3 desde la
 * nube», contando también las que solo están en una lista (decidido el
 * 2026-10-26). Sin nada en la nube, no sale.
 */
export async function pintarEnBiblioteca() {
    const cuenta = document.getElementById('libraryCount');
    if (!cuenta) return;
    let resto = document.getElementById('libraryRecuento');
    if (!resto) {
        // En la misma línea que «14 canciones» (los títulos de la cabecera van uno
        // debajo de otro): los dos, en una fila que solo se parte si no cabe
        const fila = document.createElement('span');
        fila.style.cssText = 'display: flex; flex-wrap: wrap; column-gap: 0.3em';
        cuenta.before(fila);
        resto = document.createElement('span');
        resto.id = 'libraryRecuento';
        resto.className = 'view-count';
        fila.append(cuenta, resto);
    }
    const { nube } = recuento(await LibraryModule.getLibrary(), await getPlaylists());
    resto.hidden = nube.length === 0;
    resto.textContent = nube.length ? `· ${textoTuyo('desdeNube', { n: nube.length })}` : '';
}

function escucharAjustes() {
    const hoja = document.getElementById('ajustesSheet');
    if (!hoja) return;
    new MutationObserver(() => {
        if (!hoja.classList.contains('hidden')) pintarEnAjustes().catch((e) => console.warn('[Nube] Ajustes:', e));
    }).observe(hoja, { attributes: true, attributeFilter: ['class'] });
}

// ── Al cargarse ──

if (globalThis.document) {
    document.addEventListener('suena-desde-la-nube', (e) => { alSonar(e.detail).catch((err) => console.warn('[Nube]', err)); });
    escucharFavoritos();
    escucharAjustes();
    const biblioteca = () => pintarEnBiblioteca().catch((e) => console.warn('[Nube] Biblioteca:', e));
    document.addEventListener('biblioteca-pintada', biblioteca);
    // Las listas cambian sin repintar la biblioteca (importar sin descargar): al entrar en ella
    document.addEventListener('vista-cambiada', (e) => { if (e.detail === 'libraryView') biblioteca(); });
    biblioteca();
}
