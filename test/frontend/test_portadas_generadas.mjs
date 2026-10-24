/**
 * Portadas generadas (plan 27): ninguna lista ni canción sin portada.
 *
 * Lo que se fija: el generador da siempre la misma portada para la misma
 * semilla y 8 distintas para elegir; las canciones de un artista comparten
 * colores; la portada elegida `gen:N` viaja con la cuenta y lo demás cae a la
 * automática; y el ayudante del arranque no guarda nada en la canción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { desdeMarca, fnv1a, portadaDeCancion, portadaGenerada, VARIANTES } from '../../frontend/src/core/portadas-generadas.js';
import { caratulaDe, caratulaSegura, cargarPortadas, portadaDeListaGenerada, varianteDe } from '../../frontend/src/core/portada-generada.js';
import { caratulaElegida } from '../../frontend/src/features/playlists/portada.js';
import { validarCancion, validarLista, portadaValida } from '../../frontend/src/features/sync/validar.js';
import { cancionACuenta, cancionEnLaNube, listaACuenta } from '../../frontend/src/features/sync/fusion.js';
import { repararIds } from '../../frontend/src/features/sync/identidad.js';
import { cancionEditada, conPortada } from '../../frontend/src/features/library/editor-modelo.js';

const svgDe = (src) => decodeURIComponent(src.slice('data:image/svg+xml,'.length));

describe('el generador', () => {
    test('siempre la misma portada para la misma lista, y otra para otra lista', () => {
        assert.equal(portadaGenerada('1790000000001').src, portadaGenerada('1790000000001').src);
        assert.notEqual(portadaGenerada('1790000000001').src, portadaGenerada('1790000000002').src);
    });

    test('8 variantes para elegir, todas distintas, y fuera de rango vale la automática', () => {
        assert.equal(VARIANTES, 8);
        const todas = Array.from({ length: VARIANTES }, (_, i) => portadaGenerada('lista', i).src);
        assert.equal(new Set(todas).size, 8);
        assert.equal(portadaGenerada('lista', 99).src, portadaGenerada('lista').src);
        assert.equal(portadaGenerada('lista', -1).src, portadaGenerada('lista').src);
    });

    test('un SVG bien formado, pequeño, sin texto, con tamaño propio y sin coordenadas negativas', () => {
        for (let i = 0; i < 300; i++) {
            const { src, colores } = portadaGenerada(`semilla-${i}`);
            assert.match(src, /^data:image\/svg\+xml,/);
            const svg = svgDe(src);
            assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="512" height="512" viewBox="0 0 100 100"[^>]*>.*<\/svg>$/);
            assert.doesNotMatch(svg, /<text|<script|="-|,-| -\d/);
            assert.ok(src.length < 1500, `${src.length} bytes`);
            assert.equal(colores.length, 2);
        }
    });

    test('las canciones de un artista comparten colores; cada canción, sus formas', () => {
        const a = portadaDeCancion('Luna Costa', 'aaaaaaaaaaa');
        const b = portadaDeCancion('  luna costa ', 'bbbbbbbbbbb');
        assert.deepEqual(a.colores, b.colores);
        assert.notEqual(a.src, b.src);
    });

    test('el hash es estable (FNV-1a de 32 bits)', () => {
        assert.equal(fnv1a(''), 0x811c9dc5);
        assert.equal(fnv1a('a'), 0xe40c292c);
    });

    test('una marca del arranque da la misma portada que el generador', () => {
        const lista = `favicon.png#gen=${encodeURIComponent('l\n1790000000001\n')}`;
        const elegida = `favicon.png#gen=${encodeURIComponent('l\n1790000000001\n3')}`;
        const cancion = `favicon.png#gen=${encodeURIComponent('c\nLuna Costa\naaaaaaaaaaa')}`;
        assert.equal(desdeMarca(lista), portadaGenerada('1790000000001').src);
        assert.equal(desdeMarca(elegida), portadaGenerada('1790000000001', 3).src);
        assert.equal(desdeMarca(cancion), portadaDeCancion('Luna Costa', 'aaaaaaaaaaa').src);
    });
});

describe('el ayudante del arranque', () => {
    test('con carátula, la carátula; sin ella, la generada, y nunca se guarda en la canción', async () => {
        assert.equal(caratulaDe({ thumbnail: 'https://i.ytimg.com/vi/x/mqdefault.jpg' }), 'https://i.ytimg.com/vi/x/mqdefault.jpg');
        const sin = { title: 'Vieja', artist: 'Luna Costa', src: 'file://vieja.mp3' };
        const antes = caratulaDe(sin);
        assert.ok(antes.startsWith('favicon.png#gen=') || antes.startsWith('data:image/svg+xml,'));
        assert.equal(await caratulaSegura(sin), portadaDeCancion('Luna Costa', 'file://vieja.mp3').src);
        assert.equal(caratulaDe(sin), portadaDeCancion('Luna Costa', 'file://vieja.mp3').src);
        assert.deepEqual(sin, { title: 'Vieja', artist: 'Luna Costa', src: 'file://vieja.mp3' }, 'la canción no cambia');
    });

    test('la portada de una lista, automática o elegida; varianteDe solo entiende gen:0 … gen:7', async () => {
        await cargarPortadas();
        assert.equal(portadaDeListaGenerada('l1'), portadaGenerada('l1').src);
        assert.equal(portadaDeListaGenerada('l1', 5), portadaGenerada('l1', 5).src);
        assert.equal(varianteDe('gen:0'), 0);
        assert.equal(varianteDe('gen:7'), 7);
        for (const raro of ['gen:8', 'gen:x', ' gen:3', 'gen:3 ', 'aaaaaaaaaaa', '', null, undefined]) assert.equal(varianteDe(raro), null);
    });
});

describe('la portada elegida, con las generadas', () => {
    const cancion = (videoId, thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`) => ({ videoId, thumbnail, src: `idb://${videoId}` });

    test('caratulaElegida da la generada elegida, también en una lista sin carátulas', async () => {
        await cargarPortadas();
        const pl = { id: 'l1', portada: 'gen:2', songs: [cancion('aaaaaaaaaaa', '')] };
        assert.equal(caratulaElegida(pl), portadaGenerada('l1', 2).src);
        assert.equal(caratulaElegida({ ...pl, portada: '' }), null, 'sin elegir: la automática');
    });

    test('gen:N viaja a la cuenta y vuelve; lo demás cae a la automática', () => {
        const pl = { id: 'l1', name: 'Viejas', songs: [cancion('aaaaaaaaaaa', '')], portada: 'gen:4', createdAt: '2026-10-01T00:00:00.000Z' };
        assert.equal(listaACuenta(pl).portada, 'gen:4');
        assert.equal(validarLista(listaACuenta(pl)).portada, 'gen:4');
        for (const raro of ['gen:8', 'gen:99', 'gen:x', ' gen:3', 42]) {
            assert.equal(listaACuenta({ ...pl, portada: raro }).portada, '');
            assert.equal(validarLista({ ...listaACuenta(pl), portada: raro }).portada, '');
        }
        assert.equal(portadaValida('aaaaaaaaaaa', ['aaaaaaaaaaa']), 'aaaaaaaaaaa', 'la de una canción, como antes');
        assert.equal(portadaValida('bbbbbbbbbbb', ['aaaaaaaaaaa']), '');
    });
});

describe('la portada elegida de una canción, en «Editar»', () => {
    const conCaratula = { videoId: 'aaaaaaaaaaa', src: 'idb://aaaaaaaaaaa', title: 'Luna Costa - Mar', artist: 'Luna Costa', track: 'Mar', thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg' };

    test('una generada elegida manda sobre su carátula; sin elegir, la suya', async () => {
        await cargarPortadas();
        assert.equal(caratulaDe({ ...conCaratula, portada: 'gen:5' }), portadaGenerada('aaaaaaaaaaa', 5).src);
        assert.equal(caratulaDe({ ...conCaratula, portada: '' }), conCaratula.thumbnail);
        assert.equal(caratulaDe({ ...conCaratula, portada: 'gen:9' }), conCaratula.thumbnail, 'lo que no es gen:0 … gen:7 no cuenta');
        // También en una sin carátula, y la misma en cualquier sitio que la pinte
        const sin = { src: 'file://vieja.mp3', title: 'Vieja', artist: 'Luna Costa', portada: 'gen:1' };
        assert.equal(caratulaDe(sin), portadaGenerada('file://vieja.mp3', 1).src);
        assert.equal(await caratulaSegura(sin), caratulaDe(sin));
    });

    test('conPortada pone la generada o la quita para volver a la suya', () => {
        assert.equal(conPortada(conCaratula, 'gen:3').portada, 'gen:3');
        assert.equal('portada' in conPortada({ ...conCaratula, portada: 'gen:3' }, ''), false);
        assert.equal('portada' in conPortada(conCaratula, 'gen:8'), false);
        assert.equal(conCaratula.portada, undefined, 'no cambia la canción que recibe');
    });

    test('cambiar solo la portada no marca el nombre como editado; cambiar el nombre, sí', () => {
        const solo = cancionEditada(conCaratula, { artista: ' Luna  Costa ', cancion: 'Mar', portada: 'gen:2' });
        assert.equal(solo.portada, 'gen:2');
        assert.equal(solo.editado, undefined, 'saldría «Volver a lo automático» sin haber tocado el nombre');
        const ambos = cancionEditada(conCaratula, { artista: 'Luna Costa', cancion: 'Mar (directo)', portada: 'gen:2' });
        assert.deepEqual([ambos.track, ambos.editado, ambos.portada], ['Mar (directo)', true, 'gen:2']);
        assert.equal(cancionEditada(conCaratula, { artista: '', cancion: 'Otra', portada: '' }), null, 'un nombre que no vale, como antes');
    });

    test('viaja a la cuenta y vuelve; lo que no es una generada, la suya', () => {
        assert.equal(cancionACuenta({ ...conCaratula, portada: 'gen:6' }).portada, 'gen:6');
        assert.equal(cancionACuenta(conCaratula).portada, '');
        assert.equal(validarCancion(cancionACuenta({ ...conCaratula, portada: 'gen:6' })).portada, 'gen:6');
        for (const raro of ['gen:8', 'gen:x', 42, 'https://x/y.jpg']) assert.equal(validarCancion({ ...cancionACuenta(conCaratula), portada: raro }).portada, '');
        assert.equal(cancionEnLaNube(validarCancion(cancionACuenta({ ...conCaratula, portada: 'gen:6' }))).portada, 'gen:6');
    });

    test('la elegida en la cuenta pasa a la descargada al unirlas, aunque el nombre no se editara', () => {
        const descargada = { src: 'idb://local1', title: conCaratula.title, videoId: 'aaaaaaaaaaa' };
        const nube = { ...cancionEnLaNube(validarCancion(cancionACuenta({ ...conCaratula, portada: 'gen:4' }))) };
        const { biblioteca } = repararIds([descargada, nube]);
        assert.equal(biblioteca.length, 1);
        assert.equal(biblioteca[0].src, 'idb://local1');
        assert.equal(biblioteca[0].portada, 'gen:4');
    });
});
