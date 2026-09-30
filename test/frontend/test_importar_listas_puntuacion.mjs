/**
 * Importar listas (plan 15): puntuar las candidatas de YouTube (T3).
 *
 * El caso que motiva todo el plan: buscar «Queen - Bohemian Rhapsody» a mano y
 * quedarse con el directo de Live Aid o con un karaoke. La tabla de casos
 * comprueba que la versión oficial gana y que las demás salen marcadas.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    PROBABLE, SEGURA, artistaPresente, confianza, esOficial, jaroWinkler, mejor, normalizar,
    parecidoTitulo, puntosDuracion, puntuar, versionesNoPedidas,
} from '../../frontend/src/features/import/score.js';

/** Lo que sale de un CSV de Exportify para Bohemian Rhapsody. */
const DESDE_CSV = {
    titulo: 'Bohemian Rhapsody - Remastered 2011', artista: 'Queen', artistas: ['Queen'],
    duracionMs: 354_320, isrc: 'GBUM71029604', album: 'A Night At The Opera',
};

/** Lo mismo, pegado como texto: sin duración ni ISRC. */
const DESDE_TEXTO = { titulo: 'Bohemian Rhapsody', artista: 'Queen', artistas: ['Queen'], duracionMs: null, isrc: null };

const TOPIC = { id: 'aaaaaaaaaaa', title: 'Bohemian Rhapsody (Remastered 2011)', channel: 'Queen - Topic', duration: 355, artist: 'Queen', track: 'Bohemian Rhapsody', porIsrc: true };
const VIDEO = { id: 'bbbbbbbbbbb', title: 'Queen – Bohemian Rhapsody (Official Video Remastered)', channel: 'Queen Official', duration: 359 };
const DIRECTO = { id: 'ccccccccccc', title: 'Queen - Bohemian Rhapsody (Live Aid 1985)', channel: 'Queen Official', duration: 250 };
const COVER = { id: 'ddddddddddd', title: 'Bohemian Rhapsody - Acoustic Cover', channel: 'Música de Pedro', duration: 330 };
const KARAOKE = { id: 'eeeeeeeeeee', title: 'Bohemian Rhapsody (Karaoke Version) - Queen', channel: 'Sing King', duration: 360 };

describe('jaroWinkler', () => {
    test('los valores de referencia de la literatura', () => {
        assert.ok(Math.abs(jaroWinkler('martha', 'marhta') - 0.961) < 0.001);
        assert.ok(Math.abs(jaroWinkler('dwayne', 'duane') - 0.84) < 0.001);
        assert.ok(Math.abs(jaroWinkler('dixon', 'dicksonx') - 0.813) < 0.001);
    });

    test('iguales, 1; sin nada en común o vacíos, 0', () => {
        assert.equal(jaroWinkler('abc', 'abc'), 1);
        assert.equal(jaroWinkler('abc', 'xyz'), 0);
        assert.equal(jaroWinkler('', 'abc'), 0);
        assert.equal(jaroWinkler('', ''), 0);
    });

    test('es simétrica', () => {
        assert.equal(jaroWinkler('bohemian rhapsody', 'bohemian rapsody'), jaroWinkler('bohemian rapsody', 'bohemian rhapsody'));
    });
});

describe('normalizar', () => {
    test('sin mayúsculas, tildes ni signos', () => {
        assert.equal(normalizar('¡Canción  Á-B!'), 'cancion a b');
        assert.equal(normalizar(null), '');
    });
});

describe('señales', () => {
    test('el título se compara sin lo que cuelga', () => {
        assert.ok(parecidoTitulo(DESDE_CSV, TOPIC) > 0.95, '«- Remastered 2011» no debe restar');
        assert.equal(parecidoTitulo({ titulo: 'Bohemian Rhapsody' }, { title: 'Despacito', channel: 'Luis Fonsi' }), 0,
            'títulos distintos no suman nada, aunque Jaro-Winkler dé 0,5');
    });

    test('el artista en el canal, en el artista de YouTube o en el título', () => {
        assert.equal(artistaPresente(DESDE_TEXTO, TOPIC), true, 'canal «Queen - Topic»');
        assert.equal(artistaPresente(DESDE_TEXTO, VIDEO), true, 'canal «Queen Official»');
        assert.equal(artistaPresente(DESDE_TEXTO, KARAOKE), true, 'en el título');
        assert.equal(artistaPresente(DESDE_TEXTO, COVER), false);
    });

    test('el artista tiene que ser una palabra entera', () => {
        assert.equal(artistaPresente({ artista: 'Queen' }, { title: 'Queensryche - Silent Lucidity', channel: 'Queensryche' }), false);
    });

    test('cualquiera de los artistas del origen vale', () => {
        const o = { artista: 'Bad Bunny', artistas: ['Bad Bunny', 'Jhay Cortez'] };
        assert.equal(artistaPresente(o, { title: 'DÁKITI', channel: 'Jhay Cortez' }), true);
    });

    test('sin artista en el origen no se puede medir: null', () => {
        assert.equal(artistaPresente({ titulo: 'x', artista: '', artistas: [] }, TOPIC), null);
    });

    test('la duración, por tramos', () => {
        const o = { duracionMs: 200_000 };
        assert.equal(puntosDuracion(o, { duration: 203 }), 20);
        assert.equal(puntosDuracion(o, { duration: 190 }), 12);
        assert.equal(puntosDuracion(o, { duration: 220 }), 5);
        assert.equal(puntosDuracion(o, { duration: 221 }), 0);
    });

    test('sin duración en alguno de los dos: null, no cero', () => {
        assert.equal(puntosDuracion({ duracionMs: null }, { duration: 200 }), null);
        assert.equal(puntosDuracion({ duracionMs: 200_000 }, { duration: 0 }), null);
    });

    test('canal oficial: Topic, VEVO o verificado', () => {
        assert.equal(esOficial(TOPIC), true);
        assert.equal(esOficial({ channel: 'QueenVEVO' }), true);
        assert.equal(esOficial({ channel: 'Alguien', verificado: true }), true);
        assert.equal(esOficial(VIDEO), false);
        assert.equal(esOficial({ channel: 'Topic Records' }), false, '«Topic» tiene que ir tras « - » y al final');
    });

    test('las versiones no pedidas se detectan en el título original de YouTube', () => {
        assert.deepEqual(versionesNoPedidas(DESDE_CSV, DIRECTO), ['live']);
        assert.deepEqual(versionesNoPedidas(DESDE_CSV, COVER), ['cover']);
        assert.deepEqual(versionesNoPedidas(DESDE_CSV, KARAOKE), ['karaoke']);
        assert.deepEqual(versionesNoPedidas(DESDE_CSV, TOPIC), []);
    });

    test('«live» no salta con «Alive» ni con «Oliver»', () => {
        assert.deepEqual(versionesNoPedidas({ titulo: 'Alive' }, { title: 'Pearl Jam - Alive' }), []);
        assert.deepEqual(versionesNoPedidas({ titulo: 'x' }, { title: 'Oliver Tree - Life Goes On' }), []);
    });

    test('también en castellano: «en vivo», «en directo»', () => {
        assert.deepEqual(versionesNoPedidas({ titulo: 'Malamente' }, { title: 'Rosalía - Malamente (En Directo)' }), ['live']);
    });
});

describe('versión pedida', () => {
    test('un remix que se pidió no se penaliza', () => {
        const o = { titulo: 'Blinding Lights - Chromatics Remix', artista: 'The Weeknd', artistas: ['The Weeknd'] };
        const c = { id: 'x', title: 'The Weeknd - Blinding Lights (Chromatics Remix)', channel: 'The Weeknd - Topic' };
        assert.deepEqual(versionesNoPedidas(o, c), []);
        assert.ok(puntuar(o, c).puntos >= SEGURA);
    });

    test('un remix que no se pidió, sí', () => {
        const o = { titulo: 'Blinding Lights', artista: 'The Weeknd', artistas: ['The Weeknd'] };
        const c = { id: 'x', title: 'The Weeknd - Blinding Lights (Chromatics Remix)', channel: 'The Weeknd - Topic' };
        assert.deepEqual(versionesNoPedidas(o, c), ['remix']);
        assert.ok(puntuar(o, c).puntos < PROBABLE);
    });

    test('un directo que se pidió, en el álbum, tampoco', () => {
        const o = { titulo: 'Bohemian Rhapsody', artista: 'Queen', artistas: ['Queen'], album: 'Live at Wembley 86' };
        assert.deepEqual(versionesNoPedidas(o, DIRECTO), []);
    });
});

describe('puntuar', () => {
    test('la oficial por ISRC, con todo a favor: 100', () => {
        const { puntos, detalle } = puntuar(DESDE_CSV, TOPIC);
        assert.equal(puntos, 100);
        assert.equal(detalle.isrc, true);
        assert.equal(detalle.duracion, 20);
    });

    test('el videoclip oficial es probable, y queda por debajo del audio de YouTube Music', () => {
        // El videoclip no es del canal «- Topic» y dura 5 s más (entradillas):
        // con los pesos del plan se queda en «probable». Es correcto: no es la
        // pista del disco, y por eso pierde frente a ella.
        const video = puntuar(DESDE_CSV, VIDEO).puntos;
        assert.equal(confianza(video), 'probable');
        assert.ok(video < puntuar(DESDE_CSV, TOPIC).puntos);
    });

    test('una versión no pedida es dudosa aunque todo lo demás coincida', () => {
        const karaokeOficial = { id: 'x', title: 'Bohemian Rhapsody (Karaoke)', channel: 'Queen - Topic', duration: 354 };
        assert.equal(confianza(puntuar(DESDE_CSV, karaokeOficial).puntos), 'dudosa');
    });

    test('el directo, el cover y el karaoke son dudosos', () => {
        for (const c of [DIRECTO, COVER, KARAOKE]) {
            assert.equal(confianza(puntuar(DESDE_CSV, c).puntos), 'dudosa', c.title);
        }
    });

    test('lo que no se sabe no cuenta en contra: desde texto, la oficial es segura', () => {
        const { puntos, detalle } = puntuar(DESDE_TEXTO, TOPIC);
        assert.equal(detalle.duracion, null);
        assert.ok(puntos >= SEGURA, `quedó en ${puntos}: sin duración no puede ser un fallo`);
    });

    test('sin artista en el origen, como mucho probable', () => {
        const soloTitulo = { titulo: 'Bohemian Rhapsody', artista: '', artistas: [], duracionMs: null, isrc: null };
        const p = puntuar(soloTitulo, TOPIC).puntos;
        assert.ok(p < SEGURA, `quedó en ${p}: con un título solo hay que revisarla`);
        assert.ok(p >= PROBABLE, 'pero no dudosa: el título coincide y el canal es oficial');
    });

    test('sin artista pero con ISRC, sí puede ser segura', () => {
        const conIsrc = { titulo: 'Bohemian Rhapsody', artista: '', artistas: [], duracionMs: null, isrc: 'GBUM71029604' };
        assert.ok(puntuar(conIsrc, TOPIC).puntos >= SEGURA);
    });

    test('el ISRC solo suma si lo tienen los dos', () => {
        const sinIsrc = { ...DESDE_CSV, isrc: null };
        assert.equal(puntuar(sinIsrc, TOPIC).detalle.isrc, false);
        assert.equal(puntuar(DESDE_CSV, { ...TOPIC, porIsrc: false }).detalle.isrc, false);
    });

    test('dos versiones no pedidas restan dos veces', () => {
        const c = { id: 'x', title: 'Bohemian Rhapsody (Live Karaoke)', channel: 'Queen - Topic', duration: 354 };
        const { puntos, detalle } = puntuar(DESDE_CSV, c);
        assert.deepEqual(detalle.versiones, ['live', 'karaoke']);
        assert.equal(puntos, 35, '95 − 60');
    });

    test('siempre entre 0 y 100', () => {
        const peor = { id: 'x', title: 'Live Cover Karaoke Remix 8D Nightcore', channel: 'Nadie', duration: 10 };
        assert.equal(puntuar(DESDE_CSV, peor).puntos, 0);
        assert.equal(puntuar(DESDE_CSV, TOPIC).puntos, 100);
    });

    test('datos que faltan no rompen', () => {
        assert.equal(puntuar(null, TOPIC).puntos, 0);
        assert.equal(puntuar(DESDE_CSV, null).puntos, 0);
        assert.doesNotThrow(() => puntuar({ titulo: 'x' }, { id: 'y' }));
    });
});

describe('confianza', () => {
    test('los tres tramos', () => {
        assert.equal(confianza(100), 'segura');
        assert.equal(confianza(SEGURA), 'segura');
        assert.equal(confianza(SEGURA - 1), 'probable');
        assert.equal(confianza(PROBABLE), 'probable');
        assert.equal(confianza(PROBABLE - 1), 'dudosa');
        assert.equal(confianza(0), 'dudosa');
    });
});

describe('mejor', () => {
    test('entre la oficial, el directo, el cover y el karaoke, gana la oficial', () => {
        // Aunque YouTube ponga el directo primero, que es lo que pasa al buscar a mano
        const r = mejor(DESDE_CSV, [DIRECTO, KARAOKE, COVER, VIDEO, TOPIC]);
        assert.equal(r.elegida.id, TOPIC.id);
        assert.equal(r.confianza, 'segura');
        assert.equal(r.candidatas.length, 5);
        assert.equal(r.candidatas.at(-1).puntos <= r.candidatas[0].puntos, true);
    });

    test('las candidatas salen ordenadas por puntos', () => {
        const r = mejor(DESDE_CSV, [DIRECTO, KARAOKE, COVER, VIDEO, TOPIC]);
        const puntos = r.candidatas.map((c) => c.puntos);
        assert.deepEqual(puntos, [...puntos].sort((a, b) => b - a));
    });

    test('el mismo vídeo por ISRC y por búsqueda se junta, y conserva el ISRC', () => {
        const r = mejor(DESDE_CSV, [{ ...TOPIC, porIsrc: false }, { ...TOPIC, porIsrc: true }]);
        assert.equal(r.candidatas.length, 1);
        assert.equal(r.candidatas[0].porIsrc, true);
    });

    test('a igualdad de puntos gana la oficial y, si no, la que YouTube puso antes', () => {
        const a = { id: 'aaaaaaaaaaa', title: 'Canción', channel: 'Alguien' };
        const b = { id: 'bbbbbbbbbbb', title: 'Canción', channel: 'Alguien' };
        const o = { titulo: 'Canción', artista: '', artistas: [] };
        assert.equal(mejor(o, [a, b]).elegida.id, 'aaaaaaaaaaa');
        assert.equal(mejor(o, [a, { ...b, channel: 'Alguien - Topic' }]).elegida.id, 'bbbbbbbbbbb');
    });

    test('sin candidatas: ninguna', () => {
        const r = mejor(DESDE_CSV, []);
        assert.equal(r.elegida, null);
        assert.equal(r.confianza, 'ninguna');
        assert.deepEqual(r.candidatas, []);
        assert.equal(mejor(DESDE_CSV, null).confianza, 'ninguna');
    });

    test('las candidatas sin id se ignoran', () => {
        assert.equal(mejor(DESDE_CSV, [{ title: 'x' }, null, TOPIC]).candidatas.length, 1);
    });
});
