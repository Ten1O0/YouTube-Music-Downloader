/**
 * Artista y canción a partir del título de YouTube (plan 11, T2).
 *
 * Títulos reales con el ruido de siempre: «(Official Video)», «[Lyrics]»,
 * «4K Remaster», canales «VEVO» y «- Topic», en los idiomas de la app.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { limpiarCanal, limpiarTitulo, normalizarArtista } from '../../frontend/src/core/titles.js';

// [título, canal, artista esperado, canción esperada, extra esperado]
const CASOS = [
    ['Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', 'RickAstleyVEVO', 'Rick Astley', 'Never Gonna Give You Up', ''],
    ['Luis Fonsi - Despacito ft. Daddy Yankee', 'LuisFonsiVEVO', 'Luis Fonsi', 'Despacito', 'feat. Daddy Yankee'],
    ['Queen – Bohemian Rhapsody (Official Video Remastered)', 'Queen Official', 'Queen', 'Bohemian Rhapsody', ''],
    ['Coldplay - Yellow (Official Video)', 'Coldplay', 'Coldplay', 'Yellow', ''],
    ['Adele - Hello (Official Music Video)', 'AdeleVEVO', 'Adele', 'Hello', ''],
    ['Ed Sheeran - Shape of You [Official Video]', 'Ed Sheeran', 'Ed Sheeran', 'Shape of You', ''],
    ['The Weeknd - Blinding Lights (Official Audio)', 'TheWeekndVEVO', 'The Weeknd', 'Blinding Lights', ''],
    ['Dua Lipa - Levitating (Official Lyrics Video)', 'Dua Lipa', 'Dua Lipa', 'Levitating', ''],
    ['Imagine Dragons - Believer (Lyrics)', 'Imagine Dragons', 'Imagine Dragons', 'Believer', ''],
    ['Billie Eilish - bad guy (Official Music Video) [HD]', 'BillieEilishVEVO', 'Billie Eilish', 'bad guy', ''],
    ['a-ha - Take On Me (Official Video) [Remastered in 4K]', 'a-ha', 'a-ha', 'Take On Me', ''],
    ['Nirvana - Smells Like Teen Spirit (Official Music Video)', 'NirvanaVEVO', 'Nirvana', 'Smells Like Teen Spirit', ''],
    ['Daft Punk - Get Lucky (feat. Pharrell Williams)', 'Daft Punk', 'Daft Punk', 'Get Lucky', 'feat. Pharrell Williams'],
    ['Avicii - Levels (Skrillex Remix)', 'Avicii', 'Avicii', 'Levels', 'Skrillex Remix'],
    ['Eclipse (Live at Wembley)', 'Pink Floyd - Topic', 'Pink Floyd', 'Eclipse', 'Live at Wembley'],
    ['Eric Clapton - Tears in Heaven (Acoustic)', 'Eric Clapton', 'Eric Clapton', 'Tears in Heaven', 'Acoustic'],
    ['Metallica - Nothing Else Matters (Live)', 'Metallica', 'Metallica', 'Nothing Else Matters', 'Live'],
    ['Someone Like You', 'Adele - Topic', 'Adele', 'Someone Like You', ''],
    ['Me at the zoo', 'jawed', 'jawed', 'Me at the zoo', ''],
    ['"Hello" - Adele', 'AdeleVEVO', 'Adele', 'Hello', ''],
    ['Artista - Tema | Official Video', 'Canal', 'Artista', 'Tema', ''],
    ['Canción [HD] | Lyrics', 'Canal', 'Canal', 'Canción', ''],
    ['Stairway to Heaven (2012 Remaster)', 'Led Zeppelin', 'Led Zeppelin', 'Stairway to Heaven', ''],
    ['Pink Floyd - Time (Part 2)', 'Pink Floyd', 'Pink Floyd', 'Time (Part 2)', ''],
    ['Oasis - Wonderwall (Official HD Remastered Video)', 'Oasis', 'Oasis', 'Wonderwall', ''],
    ['Beyoncé feat. Jay-Z - Crazy In Love', 'BeyonceVEVO', 'Beyoncé', 'Crazy In Love', 'feat. Jay-Z'],
    ['Mark Ronson - Uptown Funk (Official Video) ft. Bruno Mars', 'MarkRonsonVEVO', 'Mark Ronson', 'Uptown Funk', 'feat. Bruno Mars'],
    ['Simon & Garfunkel - The Sound of Silence (Audio)', 'Simon & Garfunkel', 'Simon & Garfunkel', 'The Sound of Silence', ''],
    // Castellano
    ['Bad Bunny - Tití Me Preguntó (Letra/Lyrics)', 'Bad Bunny', 'Bad Bunny', 'Tití Me Preguntó', ''],
    ['Rosalía - DESPECHÁ (Video Oficial)', 'Rosalía', 'Rosalía', 'DESPECHÁ', ''],
    ['Alejandro Sanz - Corazón Partío (Videoclip Oficial)', 'Alejandro Sanz', 'Alejandro Sanz', 'Corazón Partío', ''],
    ['Estopa - Como Camarón (Audio Oficial)', 'Estopa', 'Estopa', 'Como Camarón', ''],
    ['Manu Chao - Me Gustas Tú (En Directo)', 'Manu Chao', 'Manu Chao', 'Me Gustas Tú', 'En Directo'],
    ['Shakira - Hips Don\'t Lie (Official 4K Video) ft. Wyclef Jean', 'ShakiraVEVO', 'Shakira', 'Hips Don\'t Lie', 'feat. Wyclef Jean'],
    ['Juanes - La Camisa Negra (Con Letra)', 'Juanes', 'Juanes', 'La Camisa Negra', ''],
    ['Duki - Goteo (Versión Acústica)', 'Duki', 'Duki', 'Goteo', 'Versión Acústica'],
    // Francés
    ['Stromae - Alors on danse (Clip Officiel)', 'Stromae', 'Stromae', 'Alors on danse', ''],
    ['Indila - Dernière danse (Paroles)', 'Indila', 'Indila', 'Dernière danse', ''],
    ['Zaz - Je veux (Clip officiel)', 'Zaz', 'Zaz', 'Je veux', ''],
    // Alemán
    ['Rammstein - Du Hast (Official Video)', 'Rammstein Official', 'Rammstein', 'Du Hast', ''],
    ['Nena - 99 Luftballons (Offizielles Musikvideo)', 'Nena', 'Nena', '99 Luftballons', ''],
    ['Peter Fox - Haus am See (Songtext)', 'Peter Fox', 'Peter Fox', 'Haus am See', ''],
    // Portugués
    ['Anitta - Envolver (Official Music Video)', 'Anitta', 'Anitta', 'Envolver', ''],
    ['Marília Mendonça - Supera (Legendado)', 'Marília Mendonça', 'Marília Mendonça', 'Supera', ''],
    ['Ana Moura - Desfado (Videoclip)', 'Ana Moura', 'Ana Moura', 'Desfado', ''],
    // Chino
    ['周杰伦 - 晴天 (官方MV)', 'JVR Music', '周杰伦', '晴天', ''],
    ['邓紫棋 - 光年之外【高清】', 'G.E.M.', '邓紫棋', '光年之外', ''],
    // Canales
    ['Blinding Lights', 'The Weeknd - Topic', 'The Weeknd', 'Blinding Lights', ''],
    ['Bohemian Rhapsody', 'Queen Official', 'Queen', 'Bohemian Rhapsody', ''],
    ['Levels', 'AviciiVEVO', 'Avicii', 'Levels', ''],
    ['Un tema cualquiera', 'Warner Music Spain', 'Warner Music Spain', 'Un tema cualquiera', ''],
    ['Una canción', '', '', 'Una canción', ''],
    ['Tema - Remix', 'DJ', 'Tema', 'Remix', ''],
];

describe('limpiarTitulo con títulos reales', () => {
    for (const [titulo, canal, artista, cancion, extra] of CASOS) {
        test(`${titulo.slice(0, 55)}`, () => {
            assert.deepEqual(limpiarTitulo(titulo, canal), { artista, cancion, extra });
        });
    }
    test(`son ${CASOS.length} casos (el plan pedía al menos 50)`, () => assert.ok(CASOS.length >= 50));
});

describe('propiedades', () => {
    test('nunca devuelve la canción vacía: vuelve al original', () => {
        for (const t of ['(Official Video)', '[HD]', '  ', '(Lyrics) (Audio)']) {
            assert.ok(limpiarTitulo(t, 'Canal').cancion || !t.trim(), t);
        }
        assert.deepEqual(limpiarTitulo('', 'Canal'), { artista: 'Canal', cancion: '', extra: '' });
    });
    test('limpiar dos veces es lo mismo que una', () => {
        for (const [titulo, canal] of CASOS) {
            const una = limpiarTitulo(titulo, canal);
            if (!una.artista) continue;
            const dos = limpiarTitulo(`${una.artista} - ${una.cancion}`, canal);
            assert.equal(dos.cancion, una.cancion, titulo);
            assert.equal(dos.artista, una.artista, titulo);
        }
    });
    test('un paréntesis que no es ruido se conserva', () => {
        assert.equal(limpiarTitulo('Artista - Tema (Part 2)', '').cancion, 'Tema (Part 2)');
        assert.equal(limpiarTitulo('Artista - Tema (Eclipse)', '').cancion, 'Tema (Eclipse)');
    });
    test('no es una vía de inyección: el texto sale tal cual, sin interpretar', () => {
        const r = limpiarTitulo('<img src=x onerror=alert(1)> - Canción', 'Canal');
        assert.equal(r.artista, '<img src=x onerror=alert(1)>');
    });
});

describe('limpiarCanal y normalizarArtista', () => {
    const canales = [['RickAstleyVEVO', 'RickAstley'], ['Queen Official', 'Queen'], ['Adele - Topic', 'Adele'],
        ['Warner Music', 'Warner'], ['Topic', 'Topic'], ['', '']];
    for (const [c, esperado] of canales) test(`canal «${c}»`, () => assert.equal(limpiarCanal(c), esperado));
    test('RickAstleyVEVO queda sin el sufijo', () => assert.equal(limpiarCanal('RickAstleyVEVO'), 'RickAstley'));
    test('sin tildes, sin mayúsculas y sin «feat.»', () => {
        assert.equal(normalizarArtista('Beyoncé feat. Jay-Z'), 'beyonce');
        assert.equal(normalizarArtista('  BAD  BUNNY '), 'bad bunny');
    });
    test('«&» y las comas no parten a un artista', () => {
        assert.equal(normalizarArtista('Simon & Garfunkel'), 'simon & garfunkel');
        assert.equal(normalizarArtista('Tyler, The Creator'), 'tyler, the creator');
    });
});

describe('completarMetadatos (T3)', async () => {
    const { completarMetadatos, nombreDe } = await import('../../frontend/src/core/titles.js');
    const base = { src: 'idb://1', title: 'Queen - Bohemian Rhapsody (Official Video)', channel: 'Queen Official' };

    test('deduce del título lo que YouTube no dio', () => {
        const c = completarMetadatos(base);
        assert.equal(c.artist, 'Queen');
        assert.equal(c.track, 'Bohemian Rhapsody');
        assert.equal(c.title, base.title, 'el título original se conserva');
        assert.equal(c.channel, base.channel);
    });
    test('lo que dio YouTube manda sobre lo deducido', () => {
        const c = completarMetadatos({ ...base, artist: 'Queen', track: 'Bohemian Rhapsody - Remastered 2011' });
        assert.equal(c.track, 'Bohemian Rhapsody - Remastered 2011');
    });
    test('lo editado a mano no se toca', () => {
        const editada = { ...base, artist: 'Freddie', track: 'Mi versión', editado: true };
        assert.deepEqual(completarMetadatos(editada), editada);
    });
    test('completar dos veces es lo mismo que una', () => {
        const una = completarMetadatos(base);
        assert.deepEqual(completarMetadatos(una), una);
    });
    test('el extra se guarda solo si lo hay', () => {
        assert.equal(completarMetadatos({ title: 'Metallica - One (Live)', channel: 'Metallica' }).extra, 'Live');
        assert.ok(!('extra' in completarMetadatos(base)));
    });
    test('nombreDe tiene respaldo para lo no completado', () => {
        assert.deepEqual(nombreDe({ title: 'T', channel: 'C' }), { titulo: 'T', artista: 'C', extra: '' });
        assert.equal(nombreDe({}).titulo, 'Sin título');
    });
});

describe('editar y restaurar (T4)', async () => {
    const { editarCancion, restaurarCancion, MAX_NOMBRE } = await import('../../frontend/src/core/titles.js');
    const song = { src: 'idb://1', title: 'Grupo - Tema (Official Video)', channel: 'GrupoVEVO', artist: 'Grupo', track: 'Tema' };

    test('guarda lo escrito, recortado, y lo marca como editado', () => {
        assert.deepEqual(editarCancion(song, { artista: '  Mi   Grupo ', cancion: 'Mi Tema ' }),
            { ...song, artist: 'Mi Grupo', track: 'Mi Tema', editado: true });
    });
    test('vacío o demasiado largo no se guarda', () => {
        assert.equal(editarCancion(song, { artista: '', cancion: 'x' }), null);
        assert.equal(editarCancion(song, { artista: 'x', cancion: '   ' }), null);
        assert.equal(editarCancion(song, { artista: 'x'.repeat(MAX_NOMBRE + 1), cancion: 'y' }), null);
        assert.ok(editarCancion(song, { artista: 'x'.repeat(MAX_NOMBRE), cancion: 'y' }));
    });
    test('lo que se escribe se guarda como texto, sin interpretar', () => {
        assert.equal(editarCancion(song, { artista: '<b>x</b>', cancion: 'y' }).artist, '<b>x</b>');
    });
    test('restaurar vuelve a lo deducido y quita la marca', () => {
        const editada = editarCancion(song, { artista: 'Otro', cancion: 'Otra' });
        const r = restaurarCancion(editada);
        assert.equal(r.artist, 'Grupo');
        assert.equal(r.track, 'Tema');
        assert.ok(!r.editado);
        assert.equal(r.title, song.title, 'el título de YouTube se conserva');
    });
});
