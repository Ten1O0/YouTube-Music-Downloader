/**
 * Las ocho diapositivas de «Tu año en música» (plan 17, T4 y T7).
 *
 * `diapositivas.js` es puro: se importa directamente. Lo que se comprueba aquí
 * es qué se enseña y en qué orden, y que una diapositiva que no tendría nada que
 * decir no aparezca en blanco.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ORDEN, construirDiapositivas } from '../../frontend/src/features/wrapped/diapositivas.js';
import { calcularResumen } from '../../frontend/src/features/wrapped/resumen.js';

/** Traducción de pruebas: devuelve la clave y los parámetros, para poder afirmar sobre ellos. */
const t = (clave, params) => (params ? `${clave}(${JSON.stringify(params)})` : clave);

/** n escuchas de una canción, una por día. */
function serie({ artista, cancion, videoId, desde, n, segundos = 200 }) {
    const inicio = Date.parse(desde);
    return Array.from({ length: n }, (_, i) => ({ videoId, artista, cancion, t: inicio + i * 86_400_000, segundos }));
}

const resumenDe = (escuchas) => calcularResumen(escuchas, { anio: 2026, zonaHoraria: 'Europe/Madrid' });

/** Un año con música de sobra y variedad: pasa el mínimo y llena las ocho. */
const anioCompleto = () => resumenDe([
    ...serie({ artista: 'Rosalia', cancion: 'Malamente', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 12 }),
    ...serie({ artista: 'Rosalia', cancion: 'Saoko', videoId: 'bbbbbbbbbbb', desde: '2026-03-01T20:00:00Z', n: 6 }),
    ...serie({ artista: 'Kase.O', cancion: 'Mazas', videoId: 'ccccccccccc', desde: '2026-04-01T12:00:00Z', n: 8, segundos: 400 }),
]);

const porId = (ds) => ds.map((d) => d.id);

describe('orden y presencia', () => {
    test('las ocho, en el orden del plan', () => {
        assert.deepEqual(ORDEN, ['minutos', 'artista', 'artistas', 'cancion', 'canciones', 'horas', 'racha', 'final']);
        assert.deepEqual(porId(construirDiapositivas(anioCompleto(), t)), ORDEN);
    });

    test('sin bastante música no hay diapositivas', () => {
        const pobre = resumenDe(serie({ artista: 'A', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 3 }));
        assert.equal(pobre.suficiente, false);
        assert.deepEqual(construirDiapositivas(pobre, t), []);
    });

    test('con un solo artista se salta la lista de cinco, pero no la del artista principal', () => {
        const r = resumenDe(serie({ artista: 'Solo', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 22 }));
        const ids = porId(construirDiapositivas(r, t));
        assert.ok(ids.includes('artista'), 'sí hay artista principal');
        assert.ok(!ids.includes('artistas'), 'con uno solo, la lista de cinco no aporta');
        assert.ok(!ids.includes('canciones'), 'con una sola canción, tampoco');
    });

    test('la primera y la última nunca se saltan', () => {
        const r = resumenDe(serie({ artista: '', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 22 }));
        const ids = porId(construirDiapositivas(r, t));
        assert.equal(ids[0], 'minutos');
        assert.equal(ids.at(-1), 'final');
        assert.ok(!ids.includes('artista'), 'sin artista conocido no hay diapositiva de artista');
    });

    test('un resumen nulo no rompe nada', () => {
        assert.deepEqual(construirDiapositivas(null, t), []);
        assert.deepEqual(construirDiapositivas(undefined, t), []);
    });
});

describe('minutos', () => {
    test('el número cuenta hasta su valor y lleva las canciones y artistas', () => {
        const r = anioCompleto();
        const d = construirDiapositivas(r, t).find((x) => x.id === 'minutos');
        assert.equal(d.destacado.valor, r.minutos);
        assert.equal(d.destacado.contar, true, 'este número se anima contando');
        assert.match(d.detalle, /"canciones":3/);
        assert.match(d.detalle, /"artistas":2/);
    });
});

describe('artista principal', () => {
    test('lleva su nombre, sus minutos y una carátula', () => {
        const d = construirDiapositivas(anioCompleto(), t).find((x) => x.id === 'artista');
        assert.equal(d.destacado.valor, 'Rosalia');
        assert.equal(d.destacado.contar, false, 'un nombre no se cuenta');
        assert.match(d.detalle, /"escuchas":18/);
        assert.match(d.miniatura, /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/mqdefault\.jpg$/);
    });
});

describe('listas de cinco', () => {
    test('los artistas van numerados desde 1 y con sus minutos', () => {
        const d = construirDiapositivas(anioCompleto(), t).find((x) => x.id === 'artistas');
        assert.deepEqual(d.lista.map((f) => f.posicion), [1, 2]);
        assert.equal(d.lista[0].principal, 'Rosalia');
        assert.match(d.lista[0].secundario, /wrapped_minutes_short/);
    });

    test('las canciones llevan el número de veces', () => {
        const d = construirDiapositivas(anioCompleto(), t).find((x) => x.id === 'canciones');
        assert.equal(d.lista[0].principal, 'Malamente');
        assert.match(d.lista[0].secundario, /"n":12/);
        assert.match(d.lista[0].miniatura, /aaaaaaaaaaa/);
    });

    test('una canción sin vídeo (audio importado) se queda sin miniatura, no con una rota', () => {
        const r = resumenDe(serie({ artista: 'A', cancion: 'Importada', videoId: '', desde: '2026-02-01T12:00:00Z', n: 22 }));
        const d = construirDiapositivas(r, t).find((x) => x.id === 'minutos');
        assert.ok(d, 'el resumen se construye igual');
        const final = construirDiapositivas(r, t).at(-1);
        assert.equal(final.resumen.miniatura, '');
    });
});

describe('canción del año', () => {
    test('es la única diapositiva que trae canción, para el fragmento', () => {
        const ds = construirDiapositivas(anioCompleto(), t);
        const conCancion = ds.filter((d) => d.cancion);
        assert.equal(conCancion.length, 1);
        assert.equal(conCancion[0].id, 'cancion');
        assert.equal(conCancion[0].cancion.videoId, 'aaaaaaaaaaa');
    });
});

describe('franjas horarias', () => {
    test('trae las cuatro barras y marca la principal', () => {
        const d = construirDiapositivas(anioCompleto(), t).find((x) => x.id === 'horas');
        assert.deepEqual(d.barras.map((b) => b.clave), ['madrugada', 'manana', 'tarde', 'noche']);
        assert.equal(d.barras.filter((b) => b.destacada).length, 1);
        const destacada = d.barras.find((b) => b.destacada);
        assert.ok(destacada.minutos >= Math.max(...d.barras.map((b) => b.minutos)));
    });

    test('las etiquetas salen de las traducciones, no del código', () => {
        const d = construirDiapositivas(anioCompleto(), t).find((x) => x.id === 'horas');
        for (const b of d.barras) assert.match(b.etiqueta, /^wrapped_band_/);
    });
});

describe('racha y día récord', () => {
    test('los días cuentan y la fecha récord va en el detalle', () => {
        const r = anioCompleto();
        const d = construirDiapositivas(r, t).find((x) => x.id === 'racha');
        assert.equal(d.destacado.valor, r.racha.dias);
        assert.equal(d.destacado.contar, true);
        assert.match(d.detalle, /"fecha":"2026-/);
    });
});

describe('diapositiva final', () => {
    test('resume todo, que es lo que se dibuja en la imagen', () => {
        const r = anioCompleto();
        const d = construirDiapositivas(r, t).at(-1);
        assert.equal(d.id, 'final');
        assert.match(d.titulo, /"anio":2026/);
        assert.equal(d.resumen.minutos, r.minutos);
        assert.equal(d.resumen.artista, 'Rosalia');
        assert.equal(d.resumen.cancion, 'Malamente');
        assert.deepEqual(d.resumen.artistas, ['Rosalia', 'Kase.O']);
        assert.equal(d.resumen.canciones.length, 3);
        assert.equal(typeof d.resumen.descubrimientos, 'number');
    });
});
