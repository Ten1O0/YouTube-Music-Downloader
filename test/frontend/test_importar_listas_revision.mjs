/**
 * Importar listas (plan 15, T4): la revisión y la creación de la lista.
 *
 * `import.js` habla con la biblioteca, las listas y el servidor, así que arrastra
 * módulos que tocan el DOM al cargarse: sus funciones salen del arnés. Lo que se
 * comprueba es lo que el usuario no ve pero le afectaría: el orden de la
 * revisión, que no se descargue lo que ya tiene, que no se dupliquen canciones
 * y que la lista se cree aunque la descarga aún no haya terminado.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app, loadApp, plain } from './harness.mjs';

const arnes = app().api;
const prepararRevision = (r, l) => plain(arnes.prepararRevision(r, l));
const cancionesParaLista = (f, b) => plain(arnes.cancionesParaLista(f, b));
const { contarRevision, elegirCandidata, nombreParaLista } = arnes;

const copia = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** Una canción leída del fichero. */
const leida = (titulo, artista, extra = {}) => ({ titulo, artista, artistas: artista ? [artista] : [], duracionMs: null, isrc: null, album: '', ...extra });

/** Una candidata como la devuelve el servidor. */
const cand = (id, title, channel, extra = {}) => ({ id, title, channel, duration: 200, thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, porIsrc: false, ...extra });

const OFICIAL = cand('aaaaaaaaaaa', 'Bohemian Rhapsody', 'Queen - Topic');
const KARAOKE = cand('bbbbbbbbbbb', 'Bohemian Rhapsody (Karaoke)', 'Sing King');
const OTRA = cand('ccccccccccc', 'Mazas', 'Kase.O - Topic');

/** Lo que devuelve GET /api/import/match/<id>, en el orden de la lista. */
const resultado = (...canciones) => ({ estado: 'hecho', canciones: canciones.map(([origen, candidatas]) => ({ origen, candidatas })) });

describe('prepararRevision', () => {
    test('las que piden atención salen primero; dentro de cada grupo, el orden de la lista', () => {
        const leidas = [leida('Mazas', 'Kase.O'), leida('Desconocida', 'Nadie'), leida('Bohemian Rhapsody', 'Queen')];
        const filas = prepararRevision(resultado(
            [leidas[0], [OTRA]],
            [leidas[1], []],
            [leidas[2], [KARAOKE]],
        ), leidas);
        assert.deepEqual(filas.map((f) => f.origen.titulo), ['Desconocida', 'Bohemian Rhapsody', 'Mazas']);
        assert.deepEqual(filas.map((f) => f.confianza), ['ninguna', 'dudosa', 'segura']);
    });

    test('se puntúa con lo leído aquí, que trae el álbum y todos los artistas', () => {
        // El servidor solo recibe título, artista, duración e ISRC. Si se puntuase
        // con su copia, un directo pedido por el álbum se tomaría por no pedido.
        const aqui = leida('Bohemian Rhapsody', 'Queen', { album: 'Live at Wembley 86' });
        const directo = cand('ddddddddddd', 'Queen - Bohemian Rhapsody (Live at Wembley)', 'Queen - Topic');
        const delServidor = { titulo: 'Bohemian Rhapsody', artista: 'Queen', duracionMs: null, isrc: null };
        const [fila] = prepararRevision(resultado([delServidor, [directo]]), [aqui]);
        assert.deepEqual(fila.elegida.detalle.versiones, [], 'el directo se pidió: no se penaliza');
    });

    test('si no cuadran las posiciones, se usa lo que devolvió el servidor', () => {
        const [fila] = prepararRevision(resultado([{ titulo: 'X', artista: 'Y' }, [OFICIAL]]), [leida('a', 'b'), leida('c', 'd')]);
        assert.equal(fila.origen.titulo, 'X');
    });

    test('elige la mejor candidata aunque YouTube la ponga la última', () => {
        const [fila] = prepararRevision(resultado([leida('Bohemian Rhapsody', 'Queen'), [KARAOKE, OFICIAL]]), [leida('Bohemian Rhapsody', 'Queen')]);
        assert.equal(fila.elegida.id, OFICIAL.id);
        assert.equal(fila.candidatas.length, 2);
    });

    test('una respuesta vacía o rara no rompe', () => {
        assert.deepEqual(prepararRevision(null), []);
        assert.deepEqual(prepararRevision({}), []);
    });
});

describe('contar y elegir', () => {
    test('el resumen cuenta cada tipo y las quitadas aparte', () => {
        const filas = prepararRevision(resultado(
            [leida('Mazas', 'Kase.O'), [OTRA]],
            [leida('Desconocida', 'Nadie'), []],
            [leida('Bohemian Rhapsody', 'Queen'), [KARAOKE]],
        ));
        filas[0].quitada = true;
        const c = plain(contarRevision(filas));
        assert.equal(c.total, 3);
        assert.equal(c.quitadas, 1);
        assert.equal(c.elegidas, 2, 'la quitada y la que no tiene candidatas no cuentan');
    });

    test('dos filas en el mismo vídeo cuentan una vez: el botón dice lo que va a pasar', () => {
        const filas = prepararRevision(resultado(
            [leida('Bohemian Rhapsody', 'Queen'), [OFICIAL]],
            [leida('Bohemian Rhapsody - Remastered', 'Queen'), [OFICIAL]],
            [leida('Mazas', 'Kase.O'), [OTRA]],
        ));
        const c = plain(contarRevision(filas));
        assert.equal(c.elegidas, 2, 'tres filas, dos vídeos');
        assert.equal(c.repetidas, 1);
    });

    test('elegir otra candidata la marca como decisión del usuario', () => {
        const [fila] = prepararRevision(resultado([leida('Bohemian Rhapsody', 'Queen'), [KARAOKE, OFICIAL]]));
        const conKaraoke = plain(elegirCandidata(fila, KARAOKE.id));
        assert.equal(conKaraoke.elegida.id, KARAOKE.id);
        assert.equal(conKaraoke.manual, true);
        assert.equal(conKaraoke.abierta, false, 'se cierra la lista de alternativas');
    });

    test('elegir una candidata que no existe no cambia nada', () => {
        const [fila] = prepararRevision(resultado([leida('Bohemian Rhapsody', 'Queen'), [OFICIAL]]));
        assert.equal(plain(elegirCandidata(fila, 'zzzzzzzzzzz')).elegida.id, OFICIAL.id);
    });
});

describe('cancionesParaLista', () => {
    const filas = () => prepararRevision(resultado(
        [leida('Bohemian Rhapsody', 'Queen'), [OFICIAL]],
        [leida('Mazas', 'Kase.O'), [OTRA]],
    ));

    test('lo que no está en la biblioteca entra «en la nube» y hay que descargarlo', () => {
        const r = cancionesParaLista(filas(), []);
        assert.equal(r.songs.length, 2);
        assert.equal(r.pendientes.length, 2);
        assert.equal(r.yaEstaban, 0);
        assert.deepEqual(r.songs.map((s) => [s.src, s.nube]), [
            ['nube://aaaaaaaaaaa', true], ['nube://ccccccccccc', true],
        ]);
    });

    test('lo que ya está en la biblioteca entra tal cual y no se descarga otra vez', () => {
        const tenida = { src: 'idb://1', videoId: 'aaaaaaaaaaa', title: 'Bohemian Rhapsody', channel: 'Queen - Topic' };
        const r = cancionesParaLista(filas(), [tenida]);
        assert.deepEqual(r.songs[0], tenida, 'la misma copia de la biblioteca, con su audio');
        assert.deepEqual(r.pendientes.map((c) => c.id), ['ccccccccccc']);
        assert.equal(r.yaEstaban, 1);
    });

    test('una canción de la biblioteca que sigue en la nube sí se descarga', () => {
        const enLaNube = { src: 'nube://aaaaaaaaaaa', videoId: 'aaaaaaaaaaa', nube: true };
        assert.equal(cancionesParaLista(filas(), [enLaNube]).pendientes.length, 2);
    });

    test('las quitadas y las que no tienen candidata no entran', () => {
        const f = filas();
        f[0].quitada = true;
        const sinNada = prepararRevision(resultado([leida('Nada', 'Nadie'), []]));
        const r = cancionesParaLista([...f, ...sinNada], []);
        assert.deepEqual(r.songs.map((s) => s.videoId), ['ccccccccccc']);
    });

    test('dos filas que acaban en el mismo vídeo entran una sola vez', () => {
        const dos = prepararRevision(resultado(
            [leida('Bohemian Rhapsody', 'Queen'), [OFICIAL]],
            [leida('Bohemian Rhapsody (Remastered)', 'Queen'), [OFICIAL]],
        ));
        const r = cancionesParaLista(dos, []);
        assert.equal(r.songs.length, 1);
        assert.equal(r.pendientes.length, 1);
    });
});

describe('nombreParaLista', () => {
    test('el escrito, recortado a 40, y sin chocar con los que hay', () => {
        assert.equal(nombreParaLista('Verano', [], 'Lista importada'), 'Verano');
        assert.equal(nombreParaLista('Verano', [{ name: 'verano' }], 'Lista importada'), 'Verano (2)');
        assert.ok(nombreParaLista('x'.repeat(80), [], 'Lista importada').length <= 40);
    });

    test('vacío: el nombre por defecto', () => {
        assert.equal(nombreParaLista('   ', [], 'Lista importada'), 'Lista importada');
        assert.equal(nombreParaLista(null, [], 'Lista importada'), 'Lista importada');
    });
});

describe('crearListaImportada', () => {
    /** La app con listas, biblioteca y descargas en memoria. */
    function entorno({ biblioteca = [], listas = [] } = {}) {
        const { api } = loadApp();
        const almacen = { listas: copia(listas) };
        const descargas = [];
        let alDia = 0;
        api.LibraryModule.getLibrary = async () => copia(biblioteca);
        api.LibraryModule.sacarDeLaNubeEnListas = async () => { alDia++; return 0; };
        almacen.biblioteca = [];
        // Como la de verdad: cada una, delante
        api.LibraryModule.addSongs = async (songs) => { for (const s of copia(songs)) almacen.biblioteca.unshift(s); return songs.length; };
        api.PlaylistModule.renderGrid = async () => {};
        api.StorageModule.get = async (k) => (k === 'ytdl_playlists' ? copia(almacen.listas) : null);
        api.StorageModule.set = async (k, v) => { if (k === 'ytdl_playlists') almacen.listas = copia(v); };
        return { api, almacen, descargas, alDia: () => alDia };
    }

    test('crea la lista al momento, con lo que ya está y lo que falta en la nube', async () => {
        const tenida = { src: 'idb://1', videoId: 'aaaaaaaaaaa', title: 'Bohemian Rhapsody' };
        const { api, almacen } = entorno({ biblioteca: [tenida], listas: [{ id: '1', name: 'Otra', songs: [] }] });
        const filas = arnes.prepararRevision(resultado(
            [leida('Bohemian Rhapsody', 'Queen'), [OFICIAL]],
            [leida('Mazas', 'Kase.O'), [OTRA]],
        ));
        const r = plain(await api.crearListaImportada(filas, 'Mis favoritas'));
        assert.equal(r.lista.name, 'Mis favoritas');
        assert.equal(r.pendientes, 1);
        assert.equal(r.yaEstaban, 1);
        assert.equal(almacen.listas.length, 2, 'se añade sin tocar las que había');
        const creada = almacen.listas.find((l) => l.name === 'Mis favoritas');
        assert.deepEqual(creada.songs.map((s) => s.src), ['idb://1', 'nube://ccccccccccc']);
        assert.match(creada.id, /^[A-Za-z0-9_-]{1,64}$/, 'un id que la cuenta acepta (plan 13)');
    });

    test('si no queda ninguna canción, no crea nada', async () => {
        const { api, almacen } = entorno();
        const filas = arnes.prepararRevision(resultado([leida('Nada', 'Nadie'), []]));
        assert.equal(await api.crearListaImportada(filas, 'Vacía'), null);
        assert.equal(almacen.listas.length, 0);
    });

    test('descargándola, lo que falta no entra en la biblioteca hasta que llega su audio', async () => {
        const { api, almacen } = entorno();
        const filas = arnes.prepararRevision(resultado([leida('Mazas', 'Kase.O'), [OTRA]]));
        await api.crearListaImportada(filas, 'Con descarga');
        assert.deepEqual(almacen.biblioteca, []);
    });

    test('sin descargar, lo que falta entra en la biblioteca en la nube, en el orden de la lista (plan 29)', async () => {
        // Si no, la cuenta solo lleva sus videoId y la lista llega vacía a los otros dispositivos
        const tenida = { src: 'idb://1', videoId: 'aaaaaaaaaaa', title: 'Bohemian Rhapsody' };
        const { api, almacen } = entorno({ biblioteca: [tenida] });
        const filas = arnes.prepararRevision(resultado(
            [leida('Mazas', 'Kase.O'), [OTRA]],
            [leida('Bohemian Rhapsody', 'Queen'), [OFICIAL]],
            [leida('Otra más', 'Alguien'), [{ ...OTRA, id: 'ddddddddddd', title: 'Otra más' }]],
        ));
        const r = plain(await api.crearListaImportada(filas, 'Solo la lista', { descargar: false }));
        assert.equal(r.pendientes, 2);
        const enLaLista = almacen.listas.find((l) => l.name === 'Solo la lista').songs.map((s) => s.src).filter((src) => src.startsWith('nube://'));
        assert.equal(enLaLista.length, 2);
        assert.deepEqual(almacen.biblioteca.map((s) => s.src), enLaLista);
        assert.ok(almacen.biblioteca.every((s) => s.nube === true), 'en la nube, sin audio');
    });

    test('si todo estaba ya en la biblioteca, no se descarga nada', async () => {
        const tenida = { src: 'idb://1', videoId: 'aaaaaaaaaaa' };
        const { api } = entorno({ biblioteca: [tenida] });
        const filas = arnes.prepararRevision(resultado([leida('Bohemian Rhapsody', 'Queen'), [OFICIAL]]));
        const r = plain(await api.crearListaImportada(filas, 'Ya la tengo'));
        assert.equal(r.pendientes, 0);
    });
});
