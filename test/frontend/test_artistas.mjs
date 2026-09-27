/**
 * La biblioteca por artistas (plan 11, T6): agrupar sin distinguir mayúsculas,
 * tildes ni «feat.», y ordenar como ordena el idioma.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { agruparPorArtista } from '../../frontend/src/features/library/artist-groups.js';

const c = (src, artist, extra = {}) => ({ src, videoId: src, title: `${artist} - x`, artist, track: `Tema ${src}`, ...extra });

describe('agruparPorArtista', () => {
    test('biblioteca vacía o ausente: sin grupos', () => {
        assert.deepEqual(agruparPorArtista([]), []);
        assert.deepEqual(agruparPorArtista(undefined), []);
    });

    test('mayúsculas, tildes y feat. no separan al artista', () => {
        const grupos = agruparPorArtista([
            c('a', 'Beyoncé'), c('b', 'beyonce'), c('c', 'Beyoncé feat. Jay-Z'), c('d', 'Adele'),
        ]);
        assert.deepEqual(grupos.map((g) => [g.nombre, g.canciones.length]), [['Adele', 1], ['Beyoncé', 3]]);
    });

    test('se muestra el nombre que más se repite', () => {
        const [g] = agruparPorArtista([c('a', 'Rosalia'), c('b', 'Rosalía'), c('c', 'Rosalía')]);
        assert.equal(g.nombre, 'Rosalía');
    });

    test('«&» y comas no parten al artista', () => {
        const grupos = agruparPorArtista([c('a', 'Simon & Garfunkel'), c('b', 'Tyler, The Creator')]);
        assert.deepEqual(grupos.map((g) => g.nombre), ['Simon & Garfunkel', 'Tyler, The Creator']);
    });

    test('orden alfabético del idioma: tildes y números naturales', () => {
        const grupos = agruparPorArtista([c('a', 'Zoé'), c('b', 'Ángel'), c('c', 'abba'), c('d', 'Grupo 10'), c('e', 'Grupo 9')]);
        assert.deepEqual(grupos.map((g) => g.nombre), ['abba', 'Ángel', 'Grupo 9', 'Grupo 10', 'Zoé']);
    });

    test('sin artista: el canal; sin nada, un grupo «—»', () => {
        const grupos = agruparPorArtista([{ src: 'a', title: 't', channel: 'Canal' }, { src: 'b', title: 't' }]);
        assert.deepEqual(grupos.map((g) => g.nombre).sort(), ['Canal', '—'].sort());
    });

    test('suma las escuchas y la portada es la de la más escuchada', () => {
        const [g] = agruparPorArtista(
            [c('a', 'Queen', { thumbnail: 'a.jpg' }), c('b', 'Queen', { thumbnail: 'b.jpg' })],
            { a: { n: 1 }, b: { n: 5 } },
        );
        assert.equal(g.escuchas, 6);
        assert.equal(g.portada, 'b.jpg');
    });

    test('sin escuchas, la portada es la de la primera canción', () => {
        const [g] = agruparPorArtista([c('a', 'Queen', { thumbnail: 'a.jpg' }), c('b', 'Queen', { thumbnail: 'b.jpg' })], null);
        assert.equal(g.escuchas, 0);
        assert.equal(g.portada, 'a.jpg');
    });

    test('conserva el orden de la biblioteca dentro de cada artista', () => {
        const [g] = agruparPorArtista([c('b', 'Queen'), c('a', 'Queen'), c('c', 'Queen')]);
        assert.deepEqual(g.canciones.map((s) => s.src), ['b', 'a', 'c']);
    });

    test('un título con HTML no cambia el agrupado (se escapa al pintar)', () => {
        const [g] = agruparPorArtista([c('a', '<img src=x onerror=alert(1)>')]);
        assert.equal(g.nombre, '<img src=x onerror=alert(1)>');
    });
});
