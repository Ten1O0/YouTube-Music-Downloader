/**
 * Buscar y ordenar dentro de una lista (plan 24, P5).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './harness.mjs';

const { api } = app();
const { ordenarPor, filtrarCanciones, CRITERIOS } = api;

const cancion = (titulo, artista, extra = {}) => ({ src: `idb://${titulo}`, title: titulo, artist: artista, track: titulo, ...extra });
const titulos = (lista) => [...lista].map((s) => s.track);

// Guardada en este orden; la de la nube, en medio
const LISTA = [
    cancion('Zeta', 'Ana', { duration: 200 }),
    cancion('alfa', 'Ñu', { duration: 90 }),
    cancion('Nube', 'Bea', { duration: 30, nube: true, src: 'nube://x' }),
    cancion('Beta', 'ana', {}),
    cancion('Canción 10', 'Ana', { duration: 150 }),
    cancion('Canción 9', 'Ana', { duration: 150 }),
];

describe('ordenar por', () => {
    test('personalizado: el guardado, con lo descargado primero', () => {
        assert.deepEqual(titulos(ordenarPor(LISTA, 'personalizado')), ['Zeta', 'alfa', 'Beta', 'Canción 10', 'Canción 9', 'Nube']);
    });

    test('título: sin distinguir mayúsculas, y los números como números', () => {
        assert.deepEqual(titulos(ordenarPor(LISTA, 'titulo')), ['alfa', 'Beta', 'Canción 9', 'Canción 10', 'Zeta', 'Nube']);
    });

    test('artista y, dentro de cada uno, título', () => {
        assert.deepEqual(titulos(ordenarPor(LISTA, 'artista')), ['Beta', 'Canción 9', 'Canción 10', 'Zeta', 'alfa', 'Nube']);
    });

    test('añadida recientemente: lo último que se añadió, primero', () => {
        assert.deepEqual(titulos(ordenarPor(LISTA, 'recientes')), ['Canción 9', 'Canción 10', 'Beta', 'alfa', 'Zeta', 'Nube']);
    });

    test('duración: de la más corta a la más larga, y las que no se sabe, al final', () => {
        assert.deepEqual(titulos(ordenarPor(LISTA, 'duracion')), ['alfa', 'Canción 10', 'Canción 9', 'Zeta', 'Beta', 'Nube']);
    });

    test('no cambia la lista guardada', () => {
        const antes = titulos(LISTA);
        for (const c of CRITERIOS) ordenarPor(LISTA, c);
        assert.deepEqual(titulos(LISTA), antes);
    });
});

describe('buscar', () => {
    test('por título y artista, sin tildes ni mayúsculas, con todas las palabras', () => {
        assert.deepEqual(titulos(filtrarCanciones(LISTA, 'cancion')), ['Canción 10', 'Canción 9']);
        assert.deepEqual(titulos(filtrarCanciones(LISTA, 'nu')), ['alfa', 'Nube']);
        assert.deepEqual(titulos(filtrarCanciones(LISTA, 'ana  beta')), ['Beta']);
    });

    test('sin nada que buscar, todas; sin coincidencias, ninguna', () => {
        assert.equal(filtrarCanciones(LISTA, '   ').length, LISTA.length);
        assert.equal(filtrarCanciones(LISTA, 'xyz').length, 0);
    });
});
