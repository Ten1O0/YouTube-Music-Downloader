/**
 * Importar una lista de otro servicio (plan 15, T4): la hoja y la revisión.
 *
 *     Importar ──► fichero CSV o texto ──► vista previa (N canciones)
 *        ──► buscar en YouTube, con progreso ──► revisar ──► «Crear lista y descargar»
 *
 * - **Nada se descarga hasta pulsar «Crear lista y descargar».**
 * - En la revisión, las dudosas y las que no se encontraron salen primero.
 *   Cada fila se puede cambiar por otra candidata o quitar.
 * - La lista se crea al momento. Lo que ya está en la biblioteca entra tal cual
 *   y lo demás entra «en la nube», que es como el plan 14 crea las listas que
 *   se siguen. Después se descarga con `descargarLote` (plan 20): una petición,
 *   un solo aviso «N de M» y «Reintentar». Si una descarga falla, esa canción
 *   se queda en la lista, en la nube, y basta con tocarla para bajarla.
 *
 * El fichero no sale del dispositivo: se lee aquí y al servidor solo van
 * título, artista, duración e ISRC (plan 15, §3).
 */

import { apiBase } from '../../config/env.js';
import { html } from '../../core/html.js';
import { formatDuration } from '../../core/utils.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { avisar } from '../../ui/toast.js';
import { auth } from '../auth.js';
import { descargarLote } from '../download/lotes.js';
import { LibraryModule } from '../library/library.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { getPlaylists, savePlaylists } from '../playlists/store.js';
import { esNube, nombreLibre, PREFIJO_NUBE } from '../sync/fusion.js';
import { LIMITES } from '../sync/limites.js';
import { esVideoId, miniaturaDe } from '../sync/validar.js';
import { ErrorImportacion, MAX_BYTES, leerCsv, leerTexto, nombreDesdeFichero, recortarImportacion } from './parse.js';
import { confianza, mejor } from './score.js';
import { initZonaFichero } from './zona.js';

/** Cuánto se espera a una búsqueda antes de darla por perdida. */
const ESPERA_MAXIMA_MS = 20 * 60 * 1000;
const SONDEO_MS = 2000;

/** Orden de la revisión: lo que pide atención, primero. */
const ORDEN_CONFIANZA = { ninguna: 0, dudosa: 1, probable: 2, segura: 3 };

// ========================================
// Lógica pura (se prueba sin DOM)
// ========================================

/**
 * Las filas de la revisión, a partir de lo que devuelve el servidor.
 *
 * Se puntúa con las canciones tal como se leyeron aquí, no con las que devuelve
 * el servidor: el servidor solo recibe título, artista, duración e ISRC, y para
 * reconocer una versión pedida hace falta también el álbum («Live at Wembley»)
 * y todos los artistas. El servidor conserva el orden, así que se emparejan por
 * posición.
 */
export function prepararRevision(resultado, leidas = []) {
    const canciones = Array.isArray(resultado?.canciones) ? resultado.canciones : [];
    const filas = canciones.map((c, i) => {
        const origen = leidas.length === canciones.length ? leidas[i] : c.origen;
        const r = mejor(origen, c.candidatas);
        return {
            posicion: i,
            origen,
            elegida: r.elegida,
            puntos: r.puntos,
            confianza: r.confianza,
            candidatas: r.candidatas,
            quitada: false,
            manual: false,
            abierta: false,
        };
    });
    // Estable: dentro de cada grupo, el orden de la lista original
    return filas.sort((a, b) => ORDEN_CONFIANZA[a.confianza] - ORDEN_CONFIANZA[b.confianza] || a.posicion - b.posicion);
}

/**
 * Cuántas hay de cada tipo, para el resumen de la revisión.
 *
 * `elegidas` cuenta **vídeos distintos**, no filas: si dos canciones de la
 * lista acabaron en el mismo vídeo, la lista lo tendrá una vez, y el botón
 * «Crear lista y descargar N» tiene que decir lo que de verdad va a pasar.
 */
export function contarRevision(filas) {
    const cuenta = { total: filas.length, ninguna: 0, dudosa: 0, probable: 0, segura: 0, quitadas: 0, elegidas: 0, repetidas: 0 };
    const ids = new Set();
    for (const f of filas) {
        if (f.quitada) { cuenta.quitadas++; continue; }
        cuenta[f.confianza]++;
        if (!f.elegida) continue;
        if (ids.has(f.elegida.id)) cuenta.repetidas++;
        ids.add(f.elegida.id);
    }
    cuenta.elegidas = ids.size;
    return cuenta;
}

/** Elige otra candidata para una fila. La decisión es del usuario: ya no se marca como dudosa. */
export function elegirCandidata(fila, videoId) {
    const c = fila.candidatas.find((x) => x.id === videoId);
    if (!c) return fila;
    return { ...fila, elegida: c, puntos: c.puntos, confianza: confianza(c.puntos), manual: true, abierta: false };
}

/** Una canción que aún no se ha descargado, en la lista: sin audio, «en la nube». */
export function entradaNube(c) {
    return {
        videoId: c.id,
        title: c.title || '',
        channel: c.channel || '',
        artist: c.artist || '',
        track: c.track || '',
        duration: Number.isFinite(c.duration) ? c.duration : 0,
        src: PREFIJO_NUBE + c.id,
        thumbnail: miniaturaDe(c.id),
        nube: true,
    };
}

/**
 * Lo que va en la lista y lo que hay que descargar.
 *
 * - Una canción que ya está en la biblioteca (con audio) entra tal cual y no
 *   se descarga otra vez (plan 15, §2.5).
 * - Si dos filas acabaron en el mismo vídeo, entra una sola vez.
 */
export function cancionesParaLista(filas, biblioteca = []) {
    const enBiblioteca = new Map(biblioteca
        .filter((s) => !esNube(s) && esVideoId(s?.videoId))
        .map((s) => [s.videoId, s]));
    const vistos = new Set();
    const songs = [];
    const pendientes = [];
    let yaEstaban = 0;
    for (const f of filas) {
        const c = f.elegida;
        if (f.quitada || !c || !esVideoId(c.id) || vistos.has(c.id)) continue;
        vistos.add(c.id);
        const tenida = enBiblioteca.get(c.id);
        if (tenida) {
            songs.push(tenida);
            yaEstaban++;
        } else {
            songs.push(entradaNube(c));
            pendientes.push(c);
        }
    }
    return { songs, pendientes, yaEstaban };
}

/** Nombre de la lista: el que haya escrito el usuario, o uno por defecto, sin chocar con los que hay. */
export function nombreParaLista(escrito, listas, porDefecto) {
    const base = String(escrito ?? '').trim().slice(0, LIMITES.nombreLista) || porDefecto;
    return nombreLibre(base, (listas ?? []).map((l) => l.name ?? ''));
}

/** El texto de un error de lectura, traducido. */
export function mensajeDeError(e) {
    const codigos = {
        vacio: 'import_err_empty',
        demasiado_grande: 'import_err_too_big',
        sin_titulo: 'import_err_no_title',
    };
    if (e instanceof ErrorImportacion && codigos[e.codigo]) return i18n.t(codigos[e.codigo]);
    return i18n.t('import_err_read');
}

// ========================================
// Servidor
// ========================================

const cabeceras = () => ({ 'Content-Type': 'application/json', ...auth.getAuthHeaders() });

/** Encarga la búsqueda. Lanza un Error con el texto para el usuario si no se puede. */
async function encargarBusqueda(canciones) {
    let res;
    try {
        res = await fetch(`${apiBase()}/api/import/match`, {
            method: 'POST',
            headers: cabeceras(),
            // Al servidor, solo lo que necesita para buscar (§3)
            body: JSON.stringify({
                canciones: canciones.map((c) => ({ titulo: c.titulo, artista: c.artista, duracionMs: c.duracionMs, isrc: c.isrc })),
            }),
        });
    } catch {
        throw new Error(i18n.t('import_err_network'));
    }
    const datos = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error(i18n.t('import_err_limit'));
    if (res.status === 503) throw new Error(i18n.t('import_err_busy'));
    if (!res.ok || typeof datos.id !== 'string') throw new Error(datos.error || i18n.t('import_err_network'));
    return datos;
}

async function pedirResultado(id) {
    try {
        const res = await fetch(`${apiBase()}/api/import/match/${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (res.status === 404) return null;
        return res.ok ? await res.json() : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Sigue la búsqueda hasta que termine. Por el SSE que ya existe para las
 * descargas (el encargo usa el mismo registro de progreso); si no hay
 * EventSource o se corta, se pregunta cada dos segundos.
 */
function seguirBusqueda(id, alProgreso) {
    return new Promise((resolve) => {
        let terminado = false;
        let fuente = null;
        let sondeo = null;
        const reloj = setTimeout(() => acabar(), ESPERA_MAXIMA_MS);

        function acabar() {
            if (terminado) return;
            terminado = true;
            clearTimeout(reloj);
            clearInterval(sondeo);
            try { fuente?.close(); } catch { /* ya cerrada */ }
            resolve();
        }

        function sondear() {
            if (sondeo || terminado) return;
            sondeo = setInterval(async () => {
                const r = await pedirResultado(id);
                if (r === null) { acabar(); return; }
                if (!r) return;
                alProgreso(r.hechas, r.total);
                if (r.estado !== 'buscando') acabar();
            }, SONDEO_MS);
        }

        if (typeof globalThis.EventSource !== 'function') { sondear(); return; }
        try {
            fuente = new globalThis.EventSource(`${apiBase()}/api/progress/stream/${encodeURIComponent(id)}`);
        } catch {
            sondear();
            return;
        }
        fuente.onmessage = (ev) => {
            let d = {};
            try { d = JSON.parse(ev.data); } catch { return; }
            alProgreso(Number(d.current) || 0, Number(d.total) || 0);
            if (['complete', 'error', 'cancelled', 'unknown'].includes(d.status)) acabar();
        };
        fuente.onerror = () => {
            try { fuente.close(); } catch { /* ya cerrada */ }
            fuente = null;
            sondear();
        };
    });
}

// ========================================
// Interfaz
// ========================================

const $ = (id) => document.getElementById(id);
const t = (clave, params) => i18n.t(clave, params);

const estado = {
    pestana: 'fichero',
    leidas: [],        // canciones leídas del fichero o del texto
    sobran: 0,
    nombre: '',        // nombre sugerido para la lista
    filas: [],         // la revisión
    buscando: false,
};

function mostrarPaso(paso) {
    for (const [id, nombre] of [['importStepInput', 'entrada'], ['importStepSearch', 'buscando'], ['importReviewView', 'revision']]) {
        $(id)?.classList.toggle('hidden', nombre !== paso);
    }
}

function avisoEnHoja(texto, tipo = 'error') {
    const el = $('importMessage');
    if (!el) return;
    el.textContent = texto || '';
    el.dataset.tipo = tipo;
    el.hidden = !texto;
}

function pintarVistaPrevia() {
    const el = $('importPreview');
    const boton = $('importSearchBtn');
    const n = estado.leidas.length;
    if (el) {
        el.textContent = n
            ? contarCanciones(n) + (estado.sobran ? ` ${t('import_preview_cut', { n: estado.sobran })}` : '')
            : '';
    }
    if (boton) boton.disabled = n === 0 || estado.buscando;
}

function leer(texto, tipo) {
    avisoEnHoja('');
    try {
        const canciones = tipo === 'csv' ? leerCsv(texto) : leerTexto(texto);
        const { canciones: dentro, sobran } = recortarImportacion(canciones);
        estado.leidas = dentro;
        estado.sobran = sobran;
        if (!dentro.length && texto.trim()) avisoEnHoja(t('import_err_none'));
    } catch (e) {
        estado.leidas = [];
        estado.sobran = 0;
        avisoEnHoja(mensajeDeError(e));
    }
    pintarVistaPrevia();
}

async function alElegirFichero(ev) {
    const fichero = ev.target.files?.[0];
    if (!fichero) return;
    if (fichero.size > MAX_BYTES) {
        estado.leidas = [];
        avisoEnHoja(t('import_err_too_big'));
        pintarVistaPrevia();
        return;
    }
    estado.nombre = nombreDesdeFichero(fichero.name);
    // Excel y algunos exportadores dan CSV; si alguien sube un .txt, se lee como texto
    const esTexto = /\.txt$/i.test(fichero.name) || fichero.type === 'text/plain';
    leer(await fichero.text(), esTexto ? 'texto' : 'csv');
}

function cambiarPestana(pestana) {
    estado.pestana = pestana;
    for (const [boton, panel, nombre] of [['importTabFile', 'importPanelFile', 'fichero'], ['importTabText', 'importPanelText', 'texto']]) {
        const activa = nombre === pestana;
        $(boton)?.setAttribute('aria-selected', String(activa));
        $(boton)?.classList.toggle('is-active', activa);
        $(panel)?.classList.toggle('hidden', !activa);
    }
    estado.leidas = [];
    estado.sobran = 0;
    avisoEnHoja('');
    // Al volver a una pestaña, se relee lo que ya tenía
    if (pestana === 'texto') {
        const texto = $('importText')?.value ?? '';
        if (texto.trim()) leer(texto, 'texto');
    } else {
        const f = $('importFile');
        if (f?.files?.[0]) alElegirFichero({ target: f });
    }
    pintarVistaPrevia();
}

function pintarProgreso(hechas, total) {
    const barra = $('importProgressBar');
    const texto = $('importProgressText');
    const pct = total ? Math.round((hechas / total) * 100) : 0;
    if (barra) barra.style.width = `${pct}%`;
    if (texto) texto.textContent = t('import_searching', { current: hechas, total });
}

async function buscar() {
    if (!estado.leidas.length || estado.buscando) return;
    estado.buscando = true;
    avisoEnHoja('');
    pintarVistaPrevia();
    mostrarPaso('buscando');
    pintarProgreso(0, estado.leidas.length);
    try {
        const { id, total } = await encargarBusqueda(estado.leidas);
        await seguirBusqueda(id, (hechas, t2) => pintarProgreso(hechas, t2 || total));
        const resultado = await pedirResultado(id);
        if (!resultado) throw new Error(t('import_err_expired'));
        estado.filas = prepararRevision(resultado, estado.leidas);
        const nombre = $('importListName');
        if (nombre) nombre.value = estado.nombre || t('import_default_name');
        pintarRevision();
        mostrarPaso('revision');
    } catch (e) {
        mostrarPaso('entrada');
        avisoEnHoja(e.message || t('import_err_network'));
    } finally {
        estado.buscando = false;
        pintarVistaPrevia();
    }
}

function filaHtml(f, i) {
    const c = f.elegida;
    const alternativas = f.candidatas.filter((x) => x.id !== c?.id).slice(0, 4);
    const insignia = f.manual ? t('import_conf_manual') : t(`import_conf_${f.confianza}`);
    if (f.quitada) {
        return html`<li class="import-row is-removed" data-fila="${i}">
            <span class="import-origin"><strong>${f.origen.titulo}</strong><small>${f.origen.artista}</small></span>
            <button type="button" class="pl-action-btn" data-accion="deshacer">${t('import_undo')}</button>
        </li>`;
    }
    return html`<li class="import-row is-${f.manual ? 'manual' : f.confianza}" data-fila="${i}">
        <div class="import-row-head">
            <span class="import-origin"><strong>${f.origen.titulo}</strong><small>${f.origen.artista}</small></span>
            <span class="import-badge">${insignia}</span>
        </div>
        ${c ? html`<div class="import-match">
            <img src="${c.thumbnail || miniaturaDe(c.id)}" alt="" loading="lazy">
            <span class="import-match-text">
                <strong>${c.title}</strong>
                <small>${c.channel}${c.duration ? ` · ${formatDuration(c.duration)}` : ''}</small>
            </span>
        </div>` : html`<p class="import-none">${t('import_no_results')}</p>`}
        <div class="import-row-actions">
            ${alternativas.length ? html`<button type="button" class="pl-action-btn" data-accion="cambiar"
                aria-expanded="${String(f.abierta)}">${t('import_change')}</button>` : ''}
            <button type="button" class="pl-action-btn" data-accion="quitar">${t('import_remove')}</button>
        </div>
        ${f.abierta ? html`<ul class="import-alternatives">${alternativas.map((a) => html`<li>
            <button type="button" data-accion="elegir" data-id="${a.id}">
                <img src="${a.thumbnail || miniaturaDe(a.id)}" alt="" loading="lazy">
                <span class="import-match-text">
                    <strong>${a.title}</strong>
                    <small>${a.channel}${a.duration ? ` · ${formatDuration(a.duration)}` : ''}</small>
                </span>
            </button>
        </li>`)}</ul>` : ''}
    </li>`;
}

function pintarRevision() {
    const lista = $('importReviewList');
    const resumen = $('importReviewSummary');
    const crear = $('importCreateBtn');
    const cuenta = contarRevision(estado.filas);
    if (lista) lista.innerHTML = html`${estado.filas.map(filaHtml)}`.toString();
    if (resumen) {
        const partes = [contarCanciones(cuenta.total - cuenta.quitadas)];
        if (cuenta.dudosa) partes.push(t('import_summary_doubtful', { n: cuenta.dudosa }));
        if (cuenta.ninguna) partes.push(t('import_summary_none', { n: cuenta.ninguna }));
        if (cuenta.repetidas) partes.push(t('import_summary_repeated', { n: cuenta.repetidas }));
        resumen.textContent = partes.join(' · ');
    }
    if (crear) {
        crear.textContent = t('import_create', { n: cuenta.elegidas });
        crear.disabled = cuenta.elegidas === 0;
    }
}

function alTocarRevision(ev) {
    const boton = ev.target.closest?.('[data-accion]');
    const li = ev.target.closest?.('[data-fila]');
    if (!boton || !li) return;
    const i = Number(li.dataset.fila);
    const fila = estado.filas[i];
    if (!fila) return;
    switch (boton.dataset.accion) {
        case 'cambiar':
            estado.filas[i] = { ...fila, abierta: !fila.abierta };
            break;
        case 'elegir':
            estado.filas[i] = elegirCandidata(fila, boton.dataset.id);
            break;
        case 'quitar':
            estado.filas[i] = { ...fila, quitada: true, abierta: false };
            break;
        case 'deshacer':
            estado.filas[i] = { ...fila, quitada: false };
            break;
        default:
            return;
    }
    pintarRevision();
}

/**
 * Crea la lista y descarga lo que falta. Devuelve la lista creada, para los
 * tests; la descarga sigue en segundo plano con su propio aviso (plan 20).
 */
export async function crearListaImportada(filas, nombreEscrito, { porDefecto = t('import_default_name') } = {}) {
    const biblioteca = await LibraryModule.getLibrary();
    const { songs, pendientes, yaEstaban } = cancionesParaLista(filas, biblioteca);
    if (!songs.length) return null;

    const listas = await getPlaylists();
    const lista = {
        id: Date.now().toString(),
        name: nombreParaLista(nombreEscrito, listas, porDefecto),
        description: '',
        songs,
        createdAt: new Date().toISOString(),
    };
    await savePlaylists([...listas, lista]);
    await PlaylistModule.renderGrid?.();

    if (pendientes.length) {
        // Cada canción que llega sustituye a su copia «en la nube» de la lista.
        // addSong no lo hace con las canciones nuevas (solo con las que ya
        // estaban en la biblioteca en la nube), así que se hace aquí.
        let ultimas = 0;
        const alDia = () => LibraryModule.sacarDeLaNubeEnListas().catch(() => 0);
        descargarLote(
            pendientes.map((c) => ({ videoId: c.id, title: c.title, channel: c.channel, duration: c.duration, thumbnail: c.thumbnail })),
            {
                nombre: lista.name,
                alProgreso: (e) => { if (e.hechas > ultimas) { ultimas = e.hechas; alDia(); } },
            },
        ).then(alDia).catch((e) => console.warn('[Importar] La descarga se interrumpió:', e));
    }
    return { lista, pendientes: pendientes.length, yaEstaban };
}

async function crear() {
    const boton = $('importCreateBtn');
    if (boton) boton.disabled = true;
    try {
        const r = await crearListaImportada(estado.filas, $('importListName')?.value, { porDefecto: estado.nombre || t('import_default_name') });
        if (!r) return;
        estado.filas = [];
        cerrar();
        avisar(r.pendientes
            ? t('import_created_downloading', { name: r.lista.name, n: r.pendientes })
            : t('import_created', { name: r.lista.name }));
    } catch (e) {
        console.error('[Importar] No se pudo crear la lista:', e);
        avisoEnHoja(t('import_err_create'));
    } finally {
        if (boton) boton.disabled = false;
    }
}

let zona = { limpiar() { const f = $('importFile'); if (f) f.value = ''; } };

function reiniciar() {
    estado.leidas = [];
    estado.sobran = 0;
    estado.nombre = '';
    estado.filas = [];
    zona.limpiar();
    const texto = $('importText');
    if (texto) texto.value = '';
    avisoEnHoja('');
    mostrarPaso('entrada');
    cambiarPestana('fichero');
}

/**
 * Abre la hoja. Mientras busca, o con una revisión a medias, no se reinicia:
 * se vuelve a donde se dejó.
 */
export function abrirImportar() {
    const hoja = $('importSheet');
    if (!hoja || !hoja.classList.contains('hidden')) return;
    if (!estado.buscando && !estado.filas.length) reiniciar();
    hoja.classList.remove('hidden');
    try { NavigationModule.pushOverlayState('importSheet'); } catch { /* sin historial */ }
}

function cerrar() {
    const hoja = $('importSheet');
    if (!hoja || hoja.classList.contains('hidden')) return;
    try {
        NavigationModule.closeOverlay();
    } catch {
        hoja.classList.add('hidden');
    }
    // La revisión se conserva al cerrar (con la ×, el fondo o Escape, que cierra
    // el sistema de modales sin pasar por aquí): repetir una búsqueda de 300
    // canciones por cerrar sin querer sería peor. Se olvida al crear la lista
    // o al pulsar «Volver».
}

/** Engancha el botón «Importar» de Listas y la hoja. Se llama una vez al arrancar. */
export function initImportarListas() {
    const hoja = $('importSheet');
    if (!hoja) return;
    $('importPlaylistBtn')?.addEventListener('click', abrirImportar);
    $('importSheetClose')?.addEventListener('click', cerrar);
    hoja.querySelector('.auth-modal-backdrop')?.addEventListener('click', cerrar);

    $('importTabFile')?.addEventListener('click', () => cambiarPestana('fichero'));
    $('importTabText')?.addEventListener('click', () => cambiarPestana('texto'));
    $('importFile')?.addEventListener('change', alElegirFichero);
    zona = initZonaFichero({ zona: $('importZona'), entrada: $('importFile'), nombre: $('importZonaNombre') });

    let espera = null;
    $('importText')?.addEventListener('input', (ev) => {
        clearTimeout(espera);
        estado.nombre = '';
        espera = setTimeout(() => leer(ev.target.value, 'texto'), 250);
    });

    $('importSearchBtn')?.addEventListener('click', buscar);
    $('importReviewList')?.addEventListener('click', alTocarRevision);
    $('importBackBtn')?.addEventListener('click', () => { estado.filas = []; mostrarPaso('entrada'); });
    $('importCreateBtn')?.addEventListener('click', crear);
}
