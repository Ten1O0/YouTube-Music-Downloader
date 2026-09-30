/**
 * Importar listas de otros servicios (plan 15): leer el CSV y el texto (T1).
 *
 * `parse.js` es puro: se importa directamente. Los ficheros de prueba imitan las
 * cabeceras reales de cada herramienta, que es lo que se rompe cuando cambian:
 * por eso las columnas se reconocen por nombre y con alias.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    ErrorImportacion, MAX_BYTES, MAX_CAMPO, MAX_CANCIONES, detectarSeparador, leerCsv, leerDuracion,
    leerTexto, limpiarCampo, limpiarIsrc, nombreDesdeFichero, partirCsv, reconocerColumnas,
    recortarImportacion, separarArtistas,
} from '../../frontend/src/features/import/parse.js';

const BOM = '﻿';

/** Exportify: comillas en todo, varios artistas con coma sin espacio, milisegundos e ISRC. */
const EXPORTIFY = [
    '"Track URI","Track Name","Artist URI(s)","Artist Name(s)","Album Name","Album Artist Name(s)","Duration (ms)","ISRC"',
    '"spotify:track:1","Malamente - Cap.1: Augurio","spotify:artist:a","Rosalía","El Mal Querer","Rosalía","150066","ES5021800299"',
    '"spotify:track:2","DÁKITI","spotify:artist:b,spotify:artist:c","Bad Bunny,Jhay Cortez","EL ÚLTIMO TOUR DEL MUNDO","Bad Bunny","205090","QM6MZ2014431"',
    '"spotify:track:3","EARFQUAKE","spotify:artist:d","Tyler, The Creator","IGOR","Tyler, The Creator","190066","USQX91900735"',
].join('\n');

/** TuneMyMusic: sin comillas salvo donde hacen falta, otras columnas y otro orden. */
const TUNEMYMUSIC = [
    'Track name,Artist name,Album,Playlist name,Type,ISRC',
    'Bohemian Rhapsody,Queen,A Night at the Opera,Favoritas,Playlist,GBUM71029604',
    '"Hey, Soul Sister",Train,Save Me San Francisco,Favoritas,Playlist,',
].join('\r\n');

/** Excel en castellano: BOM, punto y coma, cabeceras con tilde y duración como reloj. */
const EXCEL = `${BOM}Canción;Artista;Duración\r\nLa Tortura;Shakira;3:32\r\n"Me Enamoré; versión";Shakira;2:59\r\n`;

describe('limpiarCampo', () => {
    test('quita caracteres de control y une los espacios', () => {
        assert.equal(limpiarCampo('  Hola\u0000\t\nmundo​  '), 'Hola mundo');
    });

    test('recorta al máximo', () => {
        assert.equal(limpiarCampo('x'.repeat(500)).length, MAX_CAMPO);
    });

    test('lo que no es texto no rompe', () => {
        assert.equal(limpiarCampo(null), '');
        assert.equal(limpiarCampo(undefined), '');
        assert.equal(limpiarCampo(42), '42');
    });
});

describe('limpiarIsrc', () => {
    test('acepta el formato, con guiones o en minúsculas', () => {
        assert.equal(limpiarIsrc('ES5021800299'), 'ES5021800299');
        assert.equal(limpiarIsrc('es-502-18-00299'), 'ES5021800299');
    });

    test('lo que no encaja se descarta', () => {
        for (const malo of ['', 'ES50218', 'no es un isrc', '123456789012', null, 'ES502180029X']) {
            assert.equal(limpiarIsrc(malo), null, `«${malo}»`);
        }
    });
});

describe('leerDuracion', () => {
    test('con la columna en milisegundos, tal cual', () => {
        assert.equal(leerDuracion('150066', { enMs: true }), 150066);
        assert.equal(leerDuracion('500', { enMs: true }), 500);
    });

    test('como reloj', () => {
        assert.equal(leerDuracion('3:32'), 212_000);
        assert.equal(leerDuracion('1:02:03'), 3_723_000);
    });

    test('un número suelto: segundos si es pequeño, milisegundos si es grande', () => {
        assert.equal(leerDuracion('212'), 212_000);
        assert.equal(leerDuracion('212000'), 212_000);
        assert.equal(leerDuracion('212,5'), 212_500, 'con coma decimal de Excel');
    });

    test('lo que no se entiende es null, no cero', () => {
        for (const malo of ['', 'mucho', '-3', '0', '3:xx', '1:2:3:4', null]) {
            assert.equal(leerDuracion(malo), null, `«${malo}»`);
        }
    });
});

describe('separarArtistas', () => {
    test('punto y coma separa siempre', () => {
        assert.deepEqual(separarArtistas('Bad Bunny; Drake;J Balvin'), ['Bad Bunny', 'Drake', 'J Balvin']);
    });

    test('la coma de Exportify, sin espacio, separa', () => {
        assert.deepEqual(separarArtistas('Bad Bunny,Jhay Cortez'), ['Bad Bunny', 'Jhay Cortez']);
    });

    test('una coma con espacio es parte del nombre', () => {
        assert.deepEqual(separarArtistas('Tyler, The Creator'), ['Tyler, The Creator']);
        assert.deepEqual(separarArtistas('Earth, Wind & Fire'), ['Earth, Wind & Fire']);
    });

    test('el & no separa: es un solo grupo', () => {
        assert.deepEqual(separarArtistas('Simon & Garfunkel'), ['Simon & Garfunkel']);
    });

    test('vacío, nada', () => {
        assert.deepEqual(separarArtistas(''), []);
        assert.deepEqual(separarArtistas(null), []);
    });
});

describe('partirCsv (RFC 4180)', () => {
    test('comas, comillas dobladas y saltos de línea dentro de un campo', () => {
        const filas = partirCsv('a,b\n"uno, dos","dijo ""hola""\ny adiós"\n');
        assert.deepEqual(filas, [['a', 'b'], ['uno, dos', 'dijo "hola"\ny adiós']]);
    });

    test('finales de línea CRLF, LF y CR', () => {
        assert.deepEqual(partirCsv('a\r\nb\nc\rd'), [['a'], ['b'], ['c'], ['d']]);
    });

    test('las líneas vacías no son filas', () => {
        assert.deepEqual(partirCsv('a,b\n\n1,2\n\n'), [['a', 'b'], ['1', '2']]);
    });

    test('campos vacíos se conservan en su sitio', () => {
        assert.deepEqual(partirCsv('a,,c\n,,'), [['a', '', 'c'], ['', '', '']]);
    });

    test('una comilla sin cerrar se toma como texto hasta el final', () => {
        const filas = partirCsv('a,b\n"sin cerrar,x\n1,2');
        assert.equal(filas.length, 2);
        assert.equal(filas[1][0], 'sin cerrar,x\n1,2');
    });

    test('sin contenido, ninguna fila', () => {
        assert.deepEqual(partirCsv(''), []);
    });
});

describe('detectarSeparador', () => {
    test('coma, punto y coma o tabulador, por la primera línea', () => {
        assert.equal(detectarSeparador('a,b,c\n1;2'), ',');
        assert.equal(detectarSeparador('a;b;c\n1,2'), ';');
        assert.equal(detectarSeparador('a\tb\tc'), '\t');
    });

    test('lo que va entre comillas no cuenta', () => {
        assert.equal(detectarSeparador('"a,b,c,d";x;y'), ';');
    });

    test('una sola columna: coma por defecto', () => {
        assert.equal(detectarSeparador('titulo'), ',');
    });
});

describe('reconocerColumnas', () => {
    test('por nombre, sin mayúsculas ni tildes', () => {
        const c = reconocerColumnas(['CANCIÓN', 'artista', 'Duración']);
        assert.equal(c.titulo, 0);
        assert.equal(c.artista, 1);
        assert.equal(c.duracion, 2);
        assert.equal(c.isrc, -1);
    });

    test('«Album Artist Name(s)» y «Artist URI(s)» no se toman por el artista', () => {
        const c = reconocerColumnas(['Track Name', 'Artist URI(s)', 'Album Artist Name(s)', 'Artist Name(s)']);
        assert.equal(c.artista, 3);
    });

    test('se prefiere «Track Name» a «Name» si están las dos', () => {
        const c = reconocerColumnas(['Name', 'Track Name']);
        assert.equal(c.titulo, 1);
    });

    test('la duración en milisegundos se reconoce por el nombre', () => {
        assert.equal(reconocerColumnas(['Title', 'Duration (ms)']).duracionEnMs, true);
        assert.equal(reconocerColumnas(['Title', 'Track Duration (ms)']).duracionEnMs, true);
        assert.equal(reconocerColumnas(['Title', 'Duration']).duracionEnMs, false);
    });
});

describe('leerCsv', () => {
    test('Exportify', () => {
        const c = leerCsv(EXPORTIFY);
        assert.equal(c.length, 3);
        assert.deepEqual(c[0], {
            titulo: 'Malamente - Cap.1: Augurio', artista: 'Rosalía', artistas: ['Rosalía'],
            duracionMs: 150066, isrc: 'ES5021800299', album: 'El Mal Querer',
        });
        assert.equal(c[1].artista, 'Bad Bunny', 'el primero es el principal');
        assert.deepEqual(c[1].artistas, ['Bad Bunny', 'Jhay Cortez']);
        assert.equal(c[2].artista, 'Tyler, The Creator', 'la coma con espacio no parte el nombre');
    });

    test('TuneMyMusic, con otro orden de columnas y CRLF', () => {
        const c = leerCsv(TUNEMYMUSIC);
        assert.equal(c.length, 2);
        assert.equal(c[0].titulo, 'Bohemian Rhapsody');
        assert.equal(c[0].artista, 'Queen');
        assert.equal(c[0].isrc, 'GBUM71029604');
        assert.equal(c[0].duracionMs, null, 'no trae duración: null, no cero');
        assert.equal(c[1].titulo, 'Hey, Soul Sister', 'la coma entre comillas es del título');
        assert.equal(c[1].isrc, null);
    });

    test('Excel en castellano: BOM, punto y coma y duración como reloj', () => {
        const c = leerCsv(EXCEL);
        assert.equal(c.length, 2);
        assert.equal(c[0].titulo, 'La Tortura', 'el BOM no se come la primera letra de la cabecera');
        assert.equal(c[0].duracionMs, 212_000);
        assert.equal(c[1].titulo, 'Me Enamoré; versión', 'el punto y coma entre comillas es del título');
    });

    test('las filas sin título se saltan, las incompletas se aprovechan', () => {
        const c = leerCsv('Title,Artist,Duration\nSolo título\n,Sin título,200\nCompleta,Alguien,200');
        assert.deepEqual(c.map((x) => x.titulo), ['Solo título', 'Completa']);
        assert.equal(c[0].artista, '');
    });

    test('sin columna de título lanza un error con código', () => {
        assert.throws(() => leerCsv('Foo,Bar\n1,2'), (e) => e instanceof ErrorImportacion && e.codigo === 'sin_titulo');
    });

    test('vacío lanza un error con código', () => {
        assert.throws(() => leerCsv(''), (e) => e.codigo === 'vacio');
        assert.throws(() => leerCsv(null), (e) => e.codigo === 'vacio');
    });

    test('solo la cabecera: ninguna canción, sin error', () => {
        assert.deepEqual(leerCsv('Track Name,Artist Name(s)\n'), []);
    });

    test('más de 2 MB se rechaza', () => {
        assert.throws(() => leerCsv(`Title\n${'x'.repeat(MAX_BYTES)}`), (e) => e.codigo === 'demasiado_grande');
    });

    test('un título que empieza por guiones llega como texto, sin tocar', () => {
        const c = leerCsv('Title,Artist\n--exec rm -rf,Malo');
        assert.equal(c[0].titulo, '--exec rm -rf', 'el servidor lo pasará como texto de búsqueda (§3)');
    });

    test('los campos se limpian: sin control y recortados', () => {
        const c = leerCsv(`Title,Artist\n"a\u0007b","${'y'.repeat(400)}"`);
        assert.equal(c[0].titulo, 'a b');
        assert.equal(c[0].artista.length, MAX_CAMPO);
    });
});

describe('leerTexto', () => {
    test('«Artista - Canción» con guion, semirraya o raya', () => {
        const c = leerTexto('Queen - Bohemian Rhapsody\nRosalía – Malamente\nKase.O — Mazas');
        assert.deepEqual(c.map((x) => [x.artista, x.titulo]), [
            ['Queen', 'Bohemian Rhapsody'], ['Rosalía', 'Malamente'], ['Kase.O', 'Mazas'],
        ]);
    });

    test('se parte por el primer separador', () => {
        const [c] = leerTexto('Queen - Bohemian Rhapsody - Remastered 2011');
        assert.equal(c.artista, 'Queen');
        assert.equal(c.titulo, 'Bohemian Rhapsody - Remastered 2011');
    });

    test('quita la numeración con punto o paréntesis', () => {
        const c = leerTexto('1. Queen - Bohemian Rhapsody\n02) Train - Drops of Jupiter\n  3.  A - B');
        assert.deepEqual(c.map((x) => x.artista), ['Queen', 'Train', 'A']);
    });

    test('un número que es parte del nombre no se toma por numeración', () => {
        const c = leerTexto('311 - Amber\n10 Years - Wasteland\n99 Luftballons');
        assert.equal(c[0].artista, '311', '«311 - » es el grupo, no la canción 311');
        assert.equal(c[1].artista, '10 Years');
        assert.equal(c[2].titulo, '99 Luftballons', 'sin separador ni punto: es el título');
    });

    test('un guion sin espacios es parte del nombre', () => {
        const [c] = leerTexto('Jay-Z - Empire State of Mind');
        assert.equal(c.artista, 'Jay-Z');
    });

    test('sin separador, la línea es el título y no hay artista', () => {
        const [c] = leerTexto('Bohemian Rhapsody');
        assert.equal(c.titulo, 'Bohemian Rhapsody');
        assert.equal(c.artista, '');
    });

    test('las líneas vacías y los finales de línea mezclados no crean canciones', () => {
        assert.equal(leerTexto('\n\nA - B\r\n\r\n   \rC - D\n').length, 2);
    });

    test('varios artistas: el primero es el principal', () => {
        const [c] = leerTexto('Bad Bunny; Drake - MIA');
        assert.equal(c.artista, 'Bad Bunny');
        assert.deepEqual(c.artistas, ['Bad Bunny', 'Drake']);
    });

    test('sin duración ni ISRC: null', () => {
        const [c] = leerTexto('A - B');
        assert.equal(c.duracionMs, null);
        assert.equal(c.isrc, null);
    });
});

describe('recortarImportacion', () => {
    test('deja 500 y dice cuántas sobran', () => {
        const muchas = Array.from({ length: 520 }, (_, i) => ({ titulo: `c${i}` }));
        const r = recortarImportacion(muchas);
        assert.equal(r.canciones.length, MAX_CANCIONES);
        assert.equal(r.sobran, 20);
        assert.equal(r.canciones[0].titulo, 'c0', 'conserva el orden de la lista');
    });

    test('si caben todas, no sobra ninguna', () => {
        assert.equal(recortarImportacion([{ titulo: 'a' }]).sobran, 0);
        assert.deepEqual(recortarImportacion(null), { canciones: [], sobran: 0 });
    });
});

describe('nombreDesdeFichero', () => {
    test('sin extensión ni guiones bajos', () => {
        assert.equal(nombreDesdeFichero('Mis_favoritas_2026.csv'), 'Mis favoritas 2026');
        assert.equal(nombreDesdeFichero('lista.de.verano.csv'), 'lista.de.verano');
    });

    test('recortado a un nombre de lista razonable', () => {
        assert.ok(nombreDesdeFichero(`${'a'.repeat(200)}.csv`).length <= 80);
    });
});
