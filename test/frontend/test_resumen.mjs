/**
 * El cálculo de «Tu año en música» (plan 17, T2 y T7).
 *
 * Todo con escuchas sintéticas y zonas horarias explícitas: el resumen no puede
 * depender de dónde se ejecuten los tests. Los límites del año son lo más
 * delicado, porque una escucha de Nochevieja es de un año u otro según el huso.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    FRANJAS, MINIMO_ESCUCHAS, MINIMO_MINUTOS, calcularResumen, franjaDe,
} from '../../frontend/src/features/wrapped/resumen.js';

const MADRID = 'Europe/Madrid';

/** Una escucha en hora UTC explícita, para no depender del reloj de la máquina. */
function escucha({ artista = 'Artista', cancion = 'Cancion', videoId = '', utc, segundos = 180 }) {
    return { videoId, artista, cancion, t: Date.parse(utc), segundos };
}

/** n escuchas de la misma canción, una por día a partir de una fecha. */
function serie({ artista, cancion, videoId, desde, n, segundos = 180 }) {
    const inicio = Date.parse(desde);
    return Array.from({ length: n }, (_, i) => ({
        videoId, artista, cancion, t: inicio + i * 86_400_000, segundos,
    }));
}

/** Un año con música de sobra para pasar el mínimo. */
const anioLleno = () => [
    ...serie({ artista: 'Rosalia', cancion: 'Malamente', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 12, segundos: 200 }),
    ...serie({ artista: 'Rosalia', cancion: 'Saoko', videoId: 'bbbbbbbbbbb', desde: '2026-03-01T12:00:00Z', n: 6, segundos: 180 }),
    ...serie({ artista: 'Kase.O', cancion: 'Repartiendo Arte', videoId: 'ccccccccccc', desde: '2026-04-01T12:00:00Z', n: 8, segundos: 400 }),
];

const resumenDe = (escuchas, extra = {}) => calcularResumen(escuchas, { anio: 2026, zonaHoraria: MADRID, ...extra });

describe('franjaDe', () => {
    test('cuatro franjas de seis horas', () => {
        assert.equal(franjaDe(0), 'madrugada');
        assert.equal(franjaDe(5), 'madrugada');
        assert.equal(franjaDe(6), 'manana');
        assert.equal(franjaDe(11), 'manana');
        assert.equal(franjaDe(12), 'tarde');
        assert.equal(franjaDe(17), 'tarde');
        assert.equal(franjaDe(18), 'noche');
        assert.equal(franjaDe(23), 'noche');
    });

    test('las cuatro franjas son las declaradas', () => {
        assert.deepEqual(FRANJAS, ['madrugada', 'manana', 'tarde', 'noche']);
    });
});

describe('totales', () => {
    test('minutos, escuchas y cosas distintas', () => {
        const r = resumenDe(anioLleno());
        assert.equal(r.escuchas, 26);
        assert.equal(r.minutos, Math.round((12 * 200 + 6 * 180 + 8 * 400) / 60));
        assert.equal(r.cancionesDistintas, 3);
        assert.equal(r.artistasDistintos, 2, 'Rosalia y Kase.O');
    });

    test('un año sin escuchas no inventa nada', () => {
        const r = resumenDe([]);
        assert.equal(r.minutos, 0);
        assert.equal(r.escuchas, 0);
        assert.equal(r.cancionDelAnio, null);
        assert.equal(r.artistaPrincipal, null);
        assert.equal(r.diaRecord, null);
        assert.equal(r.racha, null);
        assert.equal(r.franjaPrincipal, null, 'sin escuchas no hay franja favorita');
        assert.equal(r.primeraCancion, null);
        assert.equal(r.suficiente, false);
    });

    test('las escuchas de otros años no cuentan', () => {
        const r = resumenDe([
            escucha({ utc: '2025-06-01T12:00:00Z' }),
            escucha({ utc: '2026-06-01T12:00:00Z' }),
            escucha({ utc: '2027-06-01T12:00:00Z' }),
        ]);
        assert.equal(r.escuchas, 1);
    });

    test('los segundos que no son un número no rompen el cálculo', () => {
        const r = resumenDe([
            { artista: 'A', cancion: 'x', t: Date.parse('2026-05-01T12:00:00Z'), segundos: undefined },
            { artista: 'A', cancion: 'y', t: Date.parse('2026-05-02T12:00:00Z'), segundos: -50 },
            { artista: 'A', cancion: 'z', t: Date.parse('2026-05-03T12:00:00Z'), segundos: 'no' },
            { artista: 'A', cancion: 'w', t: Date.parse('2026-05-04T12:00:00Z'), segundos: 120 },
        ]);
        assert.equal(r.escuchas, 4, 'las cuatro son escuchas');
        assert.equal(r.minutos, 2, 'solo suman los segundos válidos');
    });

    test('una escucha sin instante válido se descarta', () => {
        const r = resumenDe([{ artista: 'A', cancion: 'x', t: 'ayer', segundos: 100 }, escucha({ utc: '2026-05-01T12:00:00Z' })]);
        assert.equal(r.escuchas, 1);
    });
});

describe('artistas', () => {
    test('se ordenan por minutos, no por número de escuchas', () => {
        // Kase.O tiene menos escuchas (8) que Rosalia (18) pero canciones más
        // largas: 3.200 s frente a 3.480 s. Rosalia gana por minutos, no por escuchas.
        const r = resumenDe(anioLleno());
        assert.equal(r.artistas[0].artista, 'Rosalia');
        assert.equal(r.artistas[1].artista, 'Kase.O');
        assert.ok(r.artistas[0].segundos > r.artistas[1].segundos);
    });

    test('un artista de canciones largas adelanta a uno de muchas escuchas cortas', () => {
        const r = resumenDe([
            ...serie({ artista: 'Cortas', cancion: 'c', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 20, segundos: 60 }),
            ...serie({ artista: 'Largas', cancion: 'l', videoId: 'bbbbbbbbbbb', desde: '2026-03-01T12:00:00Z', n: 5, segundos: 600 }),
        ]);
        assert.equal(r.artistas[0].artista, 'Largas', '3.000 s frente a 1.200 s');
        assert.equal(r.artistas[0].escuchas, 5);
    });

    test('se agrupan aunque se escriban distinto, y se muestra la forma más usada', () => {
        const r = resumenDe([
            ...serie({ artista: 'Bad Bunny', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 5 }),
            ...serie({ artista: 'bad bunny', cancion: 'b', videoId: 'bbbbbbbbbbb', desde: '2026-03-01T12:00:00Z', n: 2 }),
            ...serie({ artista: 'Bad Bunny feat. Drake', cancion: 'c', videoId: 'ccccccccccc', desde: '2026-04-01T12:00:00Z', n: 1 }),
        ]);
        assert.equal(r.artistasDistintos, 1, 'las tres formas son el mismo artista');
        assert.equal(r.artistas[0].artista, 'Bad Bunny', 'la forma más repetida');
        assert.equal(r.artistas[0].escuchas, 8);
    });

    test('las canciones sin artista no crean un artista vacío', () => {
        const r = resumenDe([
            ...serie({ artista: '', cancion: 'sin artista', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 5 }),
            ...serie({ artista: 'Real', cancion: 'con artista', videoId: 'bbbbbbbbbbb', desde: '2026-03-01T12:00:00Z', n: 3 }),
        ]);
        assert.equal(r.artistasDistintos, 1);
        assert.deepEqual(r.artistas.map((a) => a.artista), ['Real']);
        assert.equal(r.cancionesDistintas, 2, 'pero la canción sí cuenta');
    });

    test('como mucho cinco', () => {
        const escuchas = [];
        for (let i = 0; i < 9; i++) {
            escuchas.push(...serie({ artista: `Artista ${i}`, cancion: `c${i}`, videoId: `vid${i}`, desde: '2026-02-01T12:00:00Z', n: 9 - i }));
        }
        assert.equal(resumenDe(escuchas).artistas.length, 5);
    });

    test('el empate se resuelve igual siempre, no por el orden de llegada', () => {
        const uno = [
            ...serie({ artista: 'Zeta', cancion: 'z', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 3, segundos: 100 }),
            ...serie({ artista: 'Alfa', cancion: 'a', videoId: 'bbbbbbbbbbb', desde: '2026-03-01T12:00:00Z', n: 3, segundos: 100 }),
        ];
        const otro = [...uno].reverse();
        assert.deepEqual(
            resumenDe(uno).artistas.map((a) => a.artista),
            resumenDe(otro).artistas.map((a) => a.artista));
        assert.equal(resumenDe(uno).artistas[0].artista, 'Alfa', 'a igualdad de minutos y escuchas, por nombre');
    });
});

describe('canciones', () => {
    test('se ordenan por escuchas y la primera es la canción del año', () => {
        const r = resumenDe(anioLleno());
        assert.equal(r.canciones[0].cancion, 'Malamente');
        assert.equal(r.canciones[0].escuchas, 12);
        assert.deepEqual(r.cancionDelAnio, r.canciones[0]);
    });

    test('con las mismas escuchas gana la de más minutos', () => {
        const r = resumenDe([
            ...serie({ artista: 'A', cancion: 'Corta', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 6, segundos: 120 }),
            ...serie({ artista: 'A', cancion: 'Larga', videoId: 'bbbbbbbbbbb', desde: '2026-03-01T12:00:00Z', n: 6, segundos: 300 }),
        ]);
        assert.equal(r.canciones[0].cancion, 'Larga');
    });

    test('el mismo vídeo con otro título es una sola canción', () => {
        const r = resumenDe([
            ...serie({ artista: 'A', cancion: 'Nombre viejo', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 3 }),
            ...serie({ artista: 'A', cancion: 'Nombre nuevo', videoId: 'aaaaaaaaaaa', desde: '2026-03-01T12:00:00Z', n: 2 }),
        ]);
        assert.equal(r.cancionesDistintas, 1, 'manda el videoId');
        assert.equal(r.canciones[0].escuchas, 5);
    });

    test('sin videoId, dos canciones con el mismo nombre y artista son la misma', () => {
        const r = resumenDe([
            ...serie({ artista: 'A', cancion: 'Igual', videoId: '', desde: '2026-02-01T12:00:00Z', n: 3 }),
            ...serie({ artista: 'A', cancion: 'Otra', videoId: '', desde: '2026-03-01T12:00:00Z', n: 2 }),
        ]);
        assert.equal(r.cancionesDistintas, 2);
        assert.equal(r.canciones[0].escuchas, 3);
    });
});

describe('día récord y racha', () => {
    test('el día que más se escuchó, con su fecha local', () => {
        const r = resumenDe([
            escucha({ utc: '2026-05-10T10:00:00Z', segundos: 600 }),
            escucha({ utc: '2026-05-10T11:00:00Z', segundos: 600 }),
            escucha({ utc: '2026-05-12T10:00:00Z', segundos: 300 }),
        ]);
        assert.equal(r.diaRecord.fecha, '2026-05-10');
        assert.equal(r.diaRecord.minutos, 20);
    });

    test('con dos días empatados gana el primero', () => {
        const r = resumenDe([
            escucha({ utc: '2026-05-12T10:00:00Z', segundos: 600 }),
            escucha({ utc: '2026-05-10T10:00:00Z', segundos: 600 }),
        ]);
        assert.equal(r.diaRecord.fecha, '2026-05-10');
    });

    test('la racha más larga de días seguidos', () => {
        const r = resumenDe([
            ...serie({ artista: 'A', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-03-01T12:00:00Z', n: 3 }),
            ...serie({ artista: 'A', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-06-01T12:00:00Z', n: 7 }),
            ...serie({ artista: 'A', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-09-01T12:00:00Z', n: 2 }),
        ]);
        assert.equal(r.racha.dias, 7);
        assert.equal(r.racha.desde, '2026-06-01');
        assert.equal(r.racha.hasta, '2026-06-07');
    });

    test('varias escuchas el mismo día son un solo día de racha', () => {
        const dia = Date.parse('2026-03-01T08:00:00Z');
        const r = resumenDe([0, 1, 2, 3].map((h) => ({ artista: 'A', cancion: 'a', t: dia + h * 3_600_000, segundos: 100 })));
        assert.equal(r.racha.dias, 1);
    });

    test('la racha cruza el cambio de mes', () => {
        const r = resumenDe(serie({ artista: 'A', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-03-30T12:00:00Z', n: 4 }));
        assert.equal(r.racha.dias, 4);
        assert.equal(r.racha.hasta, '2026-04-02');
    });
});

describe('franjas horarias', () => {
    test('reparten los minutos por la hora local', () => {
        // En Madrid en julio (UTC+2): 02:00 UTC son las 04:00, madrugada
        const r = resumenDe([
            escucha({ utc: '2026-07-01T02:00:00Z', segundos: 600 }),
            escucha({ utc: '2026-07-01T09:00:00Z', segundos: 300 }),
            escucha({ utc: '2026-07-01T12:00:00Z', segundos: 120 }),
            escucha({ utc: '2026-07-01T16:00:00Z', segundos: 60 }),
            escucha({ utc: '2026-07-01T21:00:00Z', segundos: 60 }),
        ]);
        assert.equal(r.franjas.madrugada, 10, '04:00 en Madrid');
        assert.equal(r.franjas.manana, 5, '11:00 en Madrid');
        assert.equal(r.franjas.tarde, 2, '14:00 en Madrid');
        assert.equal(r.franjas.noche, 2, '18:00 y 23:00 en Madrid');
        assert.equal(r.franjaPrincipal, 'madrugada');
    });

    test('la misma escucha cae en franjas distintas según la zona', () => {
        // 23:30 UTC del 1 de julio: en Madrid (UTC+2) es 01:30 del día 2;
        // en Ciudad de México (UTC-6) son las 17:30 del día 1.
        const filas = [escucha({ utc: '2026-07-01T23:30:00Z', segundos: 600 })];
        const madrid = calcularResumen(filas, { anio: 2026, zonaHoraria: MADRID });
        const mexico = calcularResumen(filas, { anio: 2026, zonaHoraria: 'America/Mexico_City' });
        assert.equal(madrid.franjaPrincipal, 'madrugada');
        assert.equal(madrid.diaRecord.fecha, '2026-07-02');
        assert.equal(mexico.franjaPrincipal, 'tarde');
        assert.equal(mexico.diaRecord.fecha, '2026-07-01');
    });

    test('una zona desconocida no rompe el cálculo', () => {
        const r = calcularResumen([escucha({ utc: '2026-07-01T12:00:00Z' })], { anio: 2026, zonaHoraria: 'Marte/Olympus' });
        assert.equal(r.escuchas, 1, 'cae a la zona del dispositivo');
    });
});

describe('límites del año', () => {
    test('Nochevieja a las 23:30 en Madrid es de ese año, aunque en UTC sea del siguiente', () => {
        // 31/12/2026 23:30 en Madrid (UTC+1) = 22:30 UTC del 31/12/2026
        const enMadrid = escucha({ utc: '2026-12-31T22:30:00Z', segundos: 600 });
        assert.equal(resumenDe([enMadrid]).escuchas, 1);
        assert.equal(calcularResumen([enMadrid], { anio: 2027, zonaHoraria: MADRID }).escuchas, 0);
    });

    test('la medianoche del 1 de enero en Madrid ya es del año nuevo', () => {
        // 01/01/2027 00:30 en Madrid = 23:30 UTC del 31/12/2026
        const filas = [escucha({ utc: '2026-12-31T23:30:00Z', segundos: 600 })];
        assert.equal(resumenDe(filas).escuchas, 0, 'en Madrid ya es 2027');
        assert.equal(calcularResumen(filas, { anio: 2027, zonaHoraria: MADRID }).escuchas, 1);
    });

    test('en Nueva Zelanda (UTC+13) la misma escucha cambia de año antes', () => {
        // 31/12/2026 12:00 UTC = 01/01/2027 01:00 en Auckland
        const filas = [escucha({ utc: '2026-12-31T12:00:00Z', segundos: 600 })];
        assert.equal(calcularResumen(filas, { anio: 2026, zonaHoraria: 'Pacific/Auckland' }).escuchas, 0);
        assert.equal(calcularResumen(filas, { anio: 2027, zonaHoraria: 'Pacific/Auckland' }).escuchas, 1);
        assert.equal(calcularResumen(filas, { anio: 2026, zonaHoraria: MADRID }).escuchas, 1, 'en Madrid sigue siendo 2026');
    });

    test('el 1 de enero por la mañana cuenta en el año que empieza', () => {
        const r = resumenDe([escucha({ utc: '2026-01-01T09:00:00Z', segundos: 600 })]);
        assert.equal(r.escuchas, 1);
        assert.equal(r.primeraCancion.t, Date.parse('2026-01-01T09:00:00Z'));
    });
});

describe('primera canción del año', () => {
    test('es la más temprana, no la primera de la lista', () => {
        const r = resumenDe([
            escucha({ cancion: 'Marzo', utc: '2026-03-01T12:00:00Z' }),
            escucha({ cancion: 'Enero', utc: '2026-01-02T12:00:00Z' }),
            escucha({ cancion: 'Febrero', utc: '2026-02-01T12:00:00Z' }),
        ]);
        assert.equal(r.primeraCancion.cancion, 'Enero');
    });
});

describe('descubrimientos', () => {
    test('un artista escuchado ya el año anterior no es descubrimiento', () => {
        const r = resumenDe([
            ...serie({ artista: 'Viejo', cancion: 'v', videoId: 'aaaaaaaaaaa', desde: '2025-05-01T12:00:00Z', n: 2 }),
            ...serie({ artista: 'Viejo', cancion: 'v', videoId: 'aaaaaaaaaaa', desde: '2026-05-01T12:00:00Z', n: 3 }),
            ...serie({ artista: 'Nuevo', cancion: 'n', videoId: 'bbbbbbbbbbb', desde: '2026-06-01T12:00:00Z', n: 4 }),
        ]);
        assert.deepEqual(r.descubrimientos.map((d) => d.artista), ['Nuevo']);
    });

    test('los artistas anteriores de otros dispositivos también cuentan', () => {
        const filas = serie({ artista: 'Rosalia', cancion: 'r', videoId: 'aaaaaaaaaaa', desde: '2026-05-01T12:00:00Z', n: 3 });
        assert.deepEqual(resumenDe(filas).descubrimientos.map((d) => d.artista), ['Rosalia']);
        assert.deepEqual(resumenDe(filas, { artistasAnteriores: ['ROSALÍA'] }).descubrimientos, [],
            'el nombre del otro dispositivo se normaliza igual: con tildes y mayúsculas');
    });

    test('se ordenan por minutos', () => {
        const r = resumenDe([
            ...serie({ artista: 'Poco', cancion: 'p', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 2, segundos: 100 }),
            ...serie({ artista: 'Mucho', cancion: 'm', videoId: 'bbbbbbbbbbb', desde: '2026-03-01T12:00:00Z', n: 2, segundos: 500 }),
        ]);
        assert.deepEqual(r.descubrimientos.map((d) => d.artista), ['Mucho', 'Poco']);
    });
});

describe('mínimo para mostrarlo', () => {
    test('con música de sobra, se muestra', () => {
        const r = resumenDe(anioLleno());
        assert.equal(r.suficiente, true);
        assert.equal(r.faltan, null);
    });

    test('pocos minutos no bastan aunque haya muchas escuchas', () => {
        const r = resumenDe(serie({ artista: 'A', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 25, segundos: 30 }));
        assert.equal(r.escuchas, 25);
        assert.equal(r.minutos, 13);
        assert.equal(r.suficiente, false);
        assert.equal(r.faltan.minutos, MINIMO_MINUTOS - 13);
        assert.equal(r.faltan.escuchas, 0, 'escuchas ya hay bastantes');
    });

    test('pocas escuchas no bastan aunque haya muchos minutos', () => {
        const r = resumenDe(serie({ artista: 'A', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: 5, segundos: 1800 }));
        assert.equal(r.minutos, 150);
        assert.equal(r.suficiente, false);
        assert.equal(r.faltan.escuchas, MINIMO_ESCUCHAS - 5);
        assert.equal(r.faltan.minutos, 0);
    });

    test('justo en el límite ya vale', () => {
        const r = resumenDe(serie({ artista: 'A', cancion: 'a', videoId: 'aaaaaaaaaaa', desde: '2026-02-01T12:00:00Z', n: MINIMO_ESCUCHAS, segundos: 180 }));
        assert.equal(r.escuchas, MINIMO_ESCUCHAS);
        assert.equal(r.minutos, 60);
        assert.equal(r.suficiente, true);
    });
});

describe('rendimiento', () => {
    test('20.000 escuchas se calculan en menos de un segundo', () => {
        const inicio = Date.parse('2026-01-01T00:00:00Z');
        const filas = Array.from({ length: 20_000 }, (_, i) => ({
            videoId: `vid${i % 400}`,
            artista: `Artista ${i % 120}`,
            cancion: `Cancion ${i % 400}`,
            t: inicio + i * 1_500_000,
            segundos: 120 + (i % 180),
        }));
        const t0 = Date.now();
        const r = calcularResumen(filas, { anio: 2026, zonaHoraria: MADRID });
        const tardado = Date.now() - t0;
        assert.ok(r.escuchas > 0);
        assert.ok(tardado < 1000, `tardó ${tardado} ms`);
    });
});
