/**
 * Atajos de teclado (plan 10, T4): qué hace cada tecla y cuándo no hace nada.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { accionDeTecla, focoOcupado } from '../../frontend/src/ui/shortcuts.js';

const tecla = (key, extra = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...extra });
const conCancion = { hayCancion: true };
const elemento = (tagName, { editable = false, dentroDe = null } = {}) => ({
    tagName, isContentEditable: editable,
    closest: (sel) => (dentroDe && sel.includes(dentroDe) ? {} : null),
});

describe('cada tecla, su acción', () => {
    const casos = [
        [' ', 'reproducir'], ['k', 'reproducir'], ['K', 'reproducir'],
        ['ArrowLeft', 'atras'], ['ArrowRight', 'adelante'],
        ['p', 'anterior'], ['n', 'siguiente'],
        ['ArrowUp', 'volumenMas'], ['ArrowDown', 'volumenMenos'],
        ['m', 'silencio'], ['l', 'favorito'], ['f', 'pantallaCompleta'],
        ['/', 'buscar'], ['?', 'ayuda'],
    ];
    for (const [key, accion] of casos) {
        test(`«${key}» → ${accion}`, () => assert.equal(accionDeTecla(tecla(key), conCancion), accion));
    }
    test('Mayús + flechas cambian de canción', () => {
        assert.equal(accionDeTecla(tecla('ArrowLeft', { shiftKey: true }), conCancion), 'anterior');
        assert.equal(accionDeTecla(tecla('ArrowRight', { shiftKey: true }), conCancion), 'siguiente');
    });
    test('una tecla sin atajo no hace nada', () => {
        assert.equal(accionDeTecla(tecla('x'), conCancion), null);
        assert.equal(accionDeTecla(tecla('Enter'), conCancion), null);
    });
});

describe('cuándo no se hace nada', () => {
    test('con Ctrl, ⌘ o Alt: es del navegador', () => {
        for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
            assert.equal(accionDeTecla(tecla('k', { [mod]: true }), conCancion), null, mod);
        }
    });
    test('escribiendo en un campo', () => {
        for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
            assert.equal(accionDeTecla(tecla(' '), { ...conCancion, enfocado: elemento(tag) }), null, tag);
        }
        assert.equal(accionDeTecla(tecla('m'), { ...conCancion, enfocado: elemento('DIV', { editable: true }) }), null);
    });
    test('Espacio sobre un botón o un enlace lo pulsa, no pausa', () => {
        assert.equal(accionDeTecla(tecla(' '), { ...conCancion, enfocado: elemento('BUTTON') }), null);
        assert.equal(accionDeTecla(tecla(' '), { ...conCancion, enfocado: elemento('A') }), null);
        // Pero otras teclas sí funcionan con un botón enfocado
        assert.equal(accionDeTecla(tecla('m'), { ...conCancion, enfocado: elemento('BUTTON') }), 'silencio');
    });
    test('las flechas dentro de un control con rol son de ese control', () => {
        const barra = elemento('DIV', { dentroDe: 'slider' });
        assert.equal(accionDeTecla(tecla('ArrowUp'), { ...conCancion, enfocado: barra }), null);
    });
    test('con un modal abierto, nada (Escape lo lleva el modal)', () => {
        assert.equal(accionDeTecla(tecla(' '), { ...conCancion, modalAbierto: true }), null);
        assert.equal(accionDeTecla(tecla('?'), { ...conCancion, modalAbierto: true }), null);
    });
    test('sin canción, las del reproductor no hacen nada; buscar y ayuda sí', () => {
        assert.equal(accionDeTecla(tecla(' ')), null);
        assert.equal(accionDeTecla(tecla('ArrowRight')), null);
        assert.equal(accionDeTecla(tecla('/')), 'buscar');
        assert.equal(accionDeTecla(tecla('?')), 'ayuda');
    });
    test('mientras se compone un carácter (acentos, chino)', () => {
        assert.equal(accionDeTecla(tecla('k', { isComposing: true }), conCancion), null);
    });
    test('focoOcupado sin foco', () => {
        assert.equal(focoOcupado(null, ' '), false);
    });
});
