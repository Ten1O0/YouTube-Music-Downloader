/**
 * El scroll de la APK, que iba a tirones (traza en el móvil, 2026-10-23).
 *
 * Lo que se fija: Sortable ya no se carga al arrancar ni deja su `touchmove`
 * no pasivo en todo el documento (con él, cada gesto pasaba por el hilo
 * principal del WebView); la sincronización solo rehace las filas que
 * cambian; y las tareas de fondo van más despacio.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { filasCambiadas } from '../../frontend/src/features/sync/fusion.js';
import { leer } from './fuentes.mjs';

let modulo = 0;
/** arrastre.js guarda su estado en el módulo: una copia nueva para cada test. */
const arrastre = () => import(`../../frontend/src/features/playlists/detalle/arrastre.js?prueba=${++modulo}`);

/** Un documento mínimo: apunta los oyentes y deja cargar un script a mano. */
function documentoFalso() {
    const oyentes = [];
    const proto = {
        addEventListener(tipo, fn, opciones) { oyentes.push({ tipo, fn, opciones }); },
        removeEventListener(tipo, fn) {
            const i = oyentes.findIndex((o) => o.tipo === tipo && o.fn === fn);
            if (i >= 0) oyentes.splice(i, 1);
        },
    };
    const doc = Object.create(proto);
    doc.oyentes = oyentes;
    doc.createElement = () => ({});
    doc.head = { append: (script) => { doc.script = script; } };
    return doc;
}

/** Lo que hace Sortable.min.js al evaluarse: su `touchmove` no pasivo en el documento. */
function evaluarSortable(doc) {
    const suyo = () => {};
    doc.addEventListener('touchmove', suyo, { capture: false, passive: false });
    doc.addEventListener('pointerdown', () => {}, { passive: true });
    globalThis.Sortable = class {};
    doc.script.onload();
    return suyo;
}

describe('Sortable, solo mientras se mueve a mano', () => {
    beforeEach(() => { delete globalThis.Sortable; });

    test('al cargarse, su touchmove no se queda en el documento y lo demás pasa tal cual', async () => {
        const { cargarSortable } = await arrastre();
        const doc = documentoFalso();
        const carga = cargarSortable(doc);
        assert.equal(doc.script.src, '/Sortable.min.js');
        evaluarSortable(doc);
        assert.equal(await carga, globalThis.Sortable);
        assert.deepEqual(doc.oyentes.map((o) => o.tipo), ['pointerdown']);
        assert.equal(Object.hasOwn(doc, 'addEventListener'), false, 'el documento vuelve a su addEventListener');
    });

    test('su touchmove se pone al ordenar y se quita al dejar de hacerlo, una sola vez', async () => {
        const { arrastreTactil, cargarSortable } = await arrastre();
        const doc = documentoFalso();
        const carga = cargarSortable(doc);
        const suyo = evaluarSortable(doc);
        await carga;
        arrastreTactil(true, doc);
        arrastreTactil(true, doc);
        const puestos = doc.oyentes.filter((o) => o.tipo === 'touchmove');
        assert.equal(puestos.length, 1);
        assert.equal(puestos[0].fn, suyo);
        assert.equal(puestos[0].opciones.passive, false, 'mientras se arrastra, la página no se desplaza');
        arrastreTactil(false, doc);
        assert.equal(doc.oyentes.some((o) => o.tipo === 'touchmove'), false);
    });

    test('se carga una sola vez, y si falla se puede volver a intentar', async () => {
        const { cargarSortable } = await arrastre();
        const doc = documentoFalso();
        const primera = cargarSortable(doc);
        assert.equal(cargarSortable(doc), primera);
        doc.script.onerror();
        await assert.rejects(primera);
        const otra = cargarSortable(doc);
        assert.notEqual(otra, primera);
        evaluarSortable(doc);
        assert.equal(await otra, globalThis.Sortable);
    });

    test('la app no lo carga al arrancar: solo la vista de la lista, al entrar en «Editar»', () => {
        assert.doesNotMatch(leer('frontend/index.html'), /Sortable\.min\.js/);
        const vista = leer('frontend/src/features/playlists/detalle/vista.js');
        const ordenar = vista.slice(vista.indexOf('export async function ordenarAMano'), vista.indexOf('function quitarSortable'));
        assert.match(ordenar, /await cargarSortable\(\)/);
        assert.match(ordenar, /new Sortable\(lista, \{[\s\S]*\}\);\s*arrastreTactil\(true\);/);
        assert.match(ordenar, /turno !== turnoOrden/, 'si se sale de «Editar» mientras carga, no se monta');
        assert.match(vista, /function quitarSortable\(\) \{[^}]*arrastreTactil\(false\);/);
        const listas = leer('frontend/src/features/playlists/playlists.js');
        assert.doesNotMatch(listas, /playlistSortable\.destroy/, 'quitar Sortable pasa por dejarDeOrdenar');
        assert.equal(listas.match(/detalle\?\.vista\.dejarDeOrdenar\(\)/g)?.length, 2);
    });
});

describe('la sincronización solo rehace lo que cambia', () => {
    const cancion = (src, extra = {}) => ({ src, videoId: src.slice(-11), title: `T ${src}`, ...extra });
    const biblioteca = [cancion('local://aaaaaaaaaaa'), cancion('local://bbbbbbbbbbb'), cancion('nube://ccccccccccc', { nube: true })];
    const copia = () => biblioteca.map((s) => ({ ...s }));

    test('el eco de lo que subió este dispositivo no cambia ninguna fila', () => {
        assert.deepEqual(filasCambiadas(biblioteca, copia()), []);
    });

    test('una canción editada desde otro dispositivo: solo su fila', () => {
        const despues = copia();
        despues[1] = { ...despues[1], title: 'Otro título' };
        assert.deepEqual(filasCambiadas(biblioteca, despues), ['local://bbbbbbbbbbb']);
    });

    test('si entra, sale, se mueve o pasa de la nube al dispositivo alguna, la lista entera', () => {
        assert.equal(filasCambiadas(biblioteca, [...copia(), cancion('nube://ddddddddddd', { nube: true })]), null);
        assert.equal(filasCambiadas(biblioteca, copia().slice(1)), null);
        assert.equal(filasCambiadas(biblioteca, copia().reverse()), null);
        const descargada = copia();
        descargada[2] = { ...descargada[2], src: 'local://ccccccccccc', nube: undefined };
        assert.equal(filasCambiadas(biblioteca, descargada), null);
    });

    test('aplicar() las usa, fila a fila hasta FILAS_SUELTAS', () => {
        const sync = leer('frontend/src/features/sync/sync.js');
        const aplicar = sync.slice(sync.indexOf('async function aplicar('), sync.indexOf('async function enviarEscuchas('));
        assert.match(aplicar, /filasCambiadas\(local\.biblioteca, resultado\.biblioteca\)/);
        assert.match(aplicar, /if \(!cambiadas \|\| cambiadas\.length > FILAS_SUELTAS\) await LibraryModule\.render\(\);\s*else for \(const src of cambiadas\) await LibraryModule\.renderFila\(src\);/);
    });
});

describe('ninguna animación ligada al scroll en la APK', () => {
    // Con una, el WebView encola la inercia hasta el siguiente fotograma del hilo
    // principal y la lista avanza a saltos (reproducido en el móvil: 4 de 8
    // lanzamientos atascados tras un arrastre lento desde arriba; sin ella, 0 de 8)
    const css = leer('frontend/src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

    test('el título que se encoge al hacer scroll es solo de la web', () => {
        const bloque = css.slice(css.indexOf('@supports (animation-timeline: scroll())'), css.indexOf('@keyframes tituloSeCompacta'));
        assert.match(bloque, /html:not\(\.is-native\) \.app-view \.view-title \{[^}]*animation-timeline: scroll\(nearest block\)/);
    });

    test('no hay más animation-timeline en el CSS de la app, y todas excluyen la APK', () => {
        const usos = [...css.matchAll(/([^{}]+)\{[^{}]*animation-timeline:\s*(?!scroll\(\)\))[^;]+;/g)].map((m) => m[1].trim());
        assert.ok(usos.length >= 1);
        for (const selector of usos) assert.match(selector, /html:not\(\.is-native\)/, `${selector} se animaría con el scroll en la APK`);
    });
});

describe('las tareas de fondo, sin prisa', () => {
    const pausa = (ruta, nombre) => Number(leer(ruta).match(new RegExp(`const ${nombre} = ([\\d_]+);`))[1].replaceAll('_', ''));

    test('duraciones cada 4 s, sonoridad cada 10 s y carátulas cada segundo como poco', () => {
        assert.ok(pausa('frontend/src/features/library/duraciones.js', 'PAUSA') >= 4_000);
        assert.ok(pausa('frontend/src/features/player/loudness-backfill.js', 'PAUSA') >= 10_000);
        assert.ok(pausa('frontend/src/features/library/caratulas-recuperadas.js', 'PAUSA_CARATULA') >= 1_000);
    });

    test('las copias nativas de la biblioteca y las listas, una vez cada 30 s como mucho', () => {
        assert.match(leer('frontend/src/features/library/library.js'), /const copiaNativa = agrupada\([\s\S]*?\}, 30_000\);/);
        assert.match(leer('frontend/src/features/playlists/store.js'), /const copiaNativa = agrupada\([\s\S]*?\}, 30_000\);/);
    });
});
