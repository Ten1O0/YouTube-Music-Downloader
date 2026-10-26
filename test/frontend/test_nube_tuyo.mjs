/**
 * Que lo tuyo sea tuyo (plan 29, T4-T7): importar sin descargar, la ventana
 * «Tu música, de verdad tuya», los recordatorios para guardar, la marca
 * «Desde la nube» y el recuento de Ajustes.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TEXTOS_TUYO, textoTuyo } from '../../frontend/src/features/nube/textos-tuyo.js';
import * as R from '../../frontend/src/features/nube/recordatorios.js';
import { recuento, textoRecuento } from '../../frontend/src/features/nube/recuento.js';
import { leer } from './fuentes.mjs';

const DIA = 24 * 3600 * 1000;
const HOY = new Date(2026, 9, 25, 12, 0).getTime();

describe('textos', () => {
    test('en los seis idiomas, con las mismas claves y ninguna vacía', () => {
        assert.deepEqual(Object.keys(TEXTOS_TUYO).sort(), ['de', 'en', 'es', 'fr', 'pt', 'zh']);
        const claves = Object.keys(TEXTOS_TUYO.es).sort();
        for (const [idioma, textos] of Object.entries(TEXTOS_TUYO)) {
            assert.deepEqual(Object.keys(textos).sort(), claves, idioma);
            for (const [k, t] of Object.entries(textos)) assert.ok(t.trim(), `${idioma}.${k} vacío`);
        }
    });

    test('nunca «el servidor»: siempre «la nube»', () => {
        for (const [idioma, textos] of Object.entries(TEXTOS_TUYO)) {
            for (const [k, t] of Object.entries(textos)) assert.doesNotMatch(t, /servidor|server|serveur|服务器/i, `${idioma}.${k}`);
        }
        assert.match(TEXTOS_TUYO.es.tuyaTexto, /suenan desde la nube/);
    });

    test('el texto de la ventana es el del plan', () => {
        assert.equal(TEXTOS_TUYO.es.tuyaTitulo, 'Tu música, de verdad tuya');
        assert.equal(TEXTOS_TUYO.es.tuyaTexto, 'Lo que descargas se queda en tu móvil: suena sin conexión y no depende de nadie. La radio y las canciones en la nube suenan desde la nube: son para descubrir música, y si un día la nube deja de estar, no se podrán escuchar. Si algo te gusta, guárdalo.');
        assert.equal(TEXTOS_TUYO.es.tresVeces, 'La has escuchado 3 veces. ¿La guardas? Así será tuya y sonará sin conexión');
        assert.equal(TEXTOS_TUYO.es.guardada, 'Guardada: ya es tuya y suena sin conexión');
    });

    test('textoTuyo rellena los huecos y, sin el idioma, va en castellano', () => {
        assert.equal(textoTuyo('tuyas', { n: 230 }, 'es'), '230 canciones tuyas');
        assert.equal(textoTuyo('tuyas', { n: 3 }, 'xx'), '3 canciones tuyas');
        assert.equal(textoTuyo('soloListaHecha', { nombre: 'Verano' }, 'en'), 'Playlist “Verano” created. Listen from the cloud or download it whenever you like.');
    });
});

describe('recordatorios: cuándo proponer guardar', () => {
    const conSonadas = (n, extra = {}) => ({ ...R.leerEstado(null), sonadas: { a: n }, ...extra });

    test('nunca la primera vez que suena', () => {
        assert.equal(R.puedeRecordar(conSonadas(1), 'a', HOY), false);
        assert.equal(R.puedeRecordar(conSonadas(2), 'a', HOY), true);
    });

    test('salvo al darle a favorito: también la primera vez (decidido el 2026-10-26), sin saltarse el resto', () => {
        assert.equal(R.puedeRecordar(conSonadas(1), 'a', HOY, { aunqueSeaLaPrimera: true }), true);
        assert.equal(R.puedeRecordar(conSonadas(0), 'a', HOY, { aunqueSeaLaPrimera: true }), true);
        assert.equal(R.puedeRecordar(conSonadas(1, { descartadas: { a: HOY } }), 'a', HOY, { aunqueSeaLaPrimera: true }), false, 'una descartada, tampoco');
        const lleno = R.anotarRecordatorio(R.anotarRecordatorio(conSonadas(1), HOY), HOY);
        assert.equal(R.puedeRecordar(lleno, 'a', HOY, { aunqueSeaLaPrimera: true }), false, 'ni más de 2 al día');
    });

    test('como mucho 2 al día; al día siguiente, otra vez', () => {
        let e = conSonadas(5);
        e = R.anotarRecordatorio(e, HOY);
        assert.equal(R.puedeRecordar(e, 'a', HOY), true, 'el segundo sí');
        e = R.anotarRecordatorio(e, HOY);
        assert.equal(R.puedeRecordar(e, 'a', HOY), false, 'el tercero del día no');
        assert.equal(R.puedeRecordar(e, 'a', HOY + DIA), true, 'mañana sí');
        assert.equal(R.anotarRecordatorio(e, HOY + DIA).hoy, 1);
    });

    test('una canción descartada no se vuelve a proponer', () => {
        const e = R.descartar(conSonadas(5), 'a', HOY);
        assert.equal(R.puedeRecordar(e, 'a', HOY + 30 * DIA), false);
    });

    test('anotar que suena cuenta las veces de cada canción', () => {
        const e = R.anotarQueSuena(R.anotarQueSuena(R.leerEstado(null), 'a'), 'a');
        assert.equal(e.sonadas.a, 2);
    });

    test('un estado guardado roto empieza de cero', () => {
        assert.deepEqual(R.leerEstado({ hoy: -3, sonadas: [1], dia: 7 }), { dia: '', hoy: 0, sonadas: {}, descartadas: {} });
    });

    test('escuchas enteras: el 90 % de la canción; sin duración, 30 s', () => {
        assert.equal(R.esEntera(180, 200), true);
        assert.equal(R.esEntera(179, 200), false);
        assert.equal(R.esEntera(30, 0), true);
        const filas = [
            { videoId: 'a', segundos: 200 }, { videoId: 'a', segundos: 185 }, { videoId: 'a', segundos: 40 },
            { videoId: 'b', segundos: 200 }, { videoId: 'a', segundos: 199 },
        ];
        assert.equal(R.escuchasEnteras(filas, 'a', 200), 3);
        assert.ok(R.escuchasEnteras(filas, 'a', 200) >= R.ESCUCHAS_PARA_RECORDAR);
    });
});

describe('el recuento de Ajustes', () => {
    test('las tuyas y las de la nube, sin repetir las que están en la biblioteca y en una lista', () => {
        const biblioteca = [{ src: 'idb://1', videoId: 'aaaaaaaaaaa' }, { src: 'nube://bbbbbbbbbbb', videoId: 'bbbbbbbbbbb', nube: true }];
        const listas = [{ songs: [{ src: 'nube://bbbbbbbbbbb', videoId: 'bbbbbbbbbbb', nube: true }, { src: 'nube://ccccccccccc', videoId: 'ccccccccccc', nube: true }] }];
        const r = recuento(biblioteca, listas);
        assert.equal(r.tuyas, 1);
        assert.deepEqual(r.nube.map((s) => s.videoId), ['bbbbbbbbbbb', 'ccccccccccc']);
        assert.equal(textoRecuento(r, 'es'), '1 canción tuya · 2 desde la nube');
    });

    test('la copia de una lista aún «en la nube» de una canción ya descargada cuenta como tuya', () => {
        // Las listas se ponen al día un momento después que la biblioteca
        const biblioteca = [{ src: 'idb://1', videoId: 'aaaaaaaaaaa' }];
        const listas = [{ songs: [{ src: 'nube://aaaaaaaaaaa', videoId: 'aaaaaaaaaaa', nube: true }] }];
        assert.deepEqual(recuento(biblioteca, listas), { tuyas: 1, nube: [] });
    });

    test('sin nada en la nube, solo lo tuyo', () => {
        assert.equal(textoRecuento({ tuyas: 230, nube: [] }, 'es'), '230 canciones tuyas');
    });
});

describe('importar sin descargar (T4)', () => {
    const importar = leer('frontend/src/features/import/import.js');
    const lista = leer('frontend/src/features/lista-al-descargar.js');

    test('crearListaImportada con descargar: false no lanza el lote', () => {
        assert.match(importar, /descargar = true \} = \{\}\) \{/);
        assert.match(importar, /if \(pendientes\.length && descargar\) \{/);
    });

    test('«Crear solo la lista» pasa por la creación de siempre, sin descargar y con el aviso de la nube', () => {
        assert.match(lista, /descargar: !soloLista/);
        assert.match(lista, /textoTuyo\('soloListaHecha'/);
        assert.match(lista, /soloListaPedida = true; descargar\.click\(\);/);
    });
});

describe('sin coste de arranque', () => {
    test('tuyo.js se carga en reposo desde main.js, y nada del arranque lo importa sin import()', () => {
        assert.match(leer('frontend/src/main.js'), /\(\) => import\('\.\/features\/nube\/tuyo\.js'\)\]\) \{\s*tarea\(cargar, \{ prioridad: PRIORIDAD\.baja \}\)/);
        for (const f of ['frontend/src/main.js', 'frontend/src/features/library/library.js', 'frontend/src/features/ajustes.js', 'frontend/src/features/favorites/store.js']) {
            assert.doesNotMatch(leer(f), /^import .*nube\/(tuyo|recordatorios|textos-tuyo|recuento)/m, f);
        }
    });

    test('la marca de la fila es un botón que guarda sin reproducir, también antes de cargar tuyo.js', () => {
        // tuyo.js se carga en un momento de calma: si el clic dependiera de él, al
        // principio se perdía (recorrido 39). Lo atienden la biblioteca y la lista
        const BIBLIOTECA = leer('frontend/src/features/library/library.js');
        assert.match(BIBLIOTECA, /class="library-item-btn nube-guardar"/);
        assert.match(BIBLIOTECA, /else if \(boton\.classList\.contains\('nube-guardar'\)\) \{[^}]*await guardarDesdeLaNube\(song\);/);
        assert.match(leer('frontend/src/features/playlists/playlists.js'), /else if \(e\.target\.closest\('\.nube-guardar'\)\) \{[^}]*e\.stopPropagation\(\);\s*guardarDesdeLaNube\(song\);/);
        assert.doesNotMatch(leer('frontend/src/features/nube/tuyo.js'), /\.nube-guardar/, 'se guardaría dos veces');
    });
});
