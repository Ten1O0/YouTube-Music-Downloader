/**
 * HTML sin inyección (plan 10, T1): la etiqueta html`…` de core/html.js.
 *
 * Los títulos de YouTube, los canales, las letras y los nombres de las listas
 * se insertaban en innerHTML sin escapar: un título preparado ejecutaba código,
 * y en la APK con los plugins nativos a mano.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escapar, html, Seguro, seguro, urlSegura } from '../../frontend/src/core/html.js';

const hostil = '<img src=x onerror="alert(1)">';

describe('escapar', () => {
    test('escapa los seis caracteres peligrosos', () => {
        assert.equal(escapar(`<>&"'\``), '&lt;&gt;&amp;&quot;&#39;&#96;');
    });
    test('null e undefined son cadena vacía; los números se convierten', () => {
        assert.equal(escapar(null), '');
        assert.equal(escapar(undefined), '');
        assert.equal(escapar(0), '0');
    });
});

describe('html`…`', () => {
    test('escapa lo interpolado', () => {
        assert.equal(String(html`<b>${hostil}</b>`), '<b>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</b>');
    });
    test('devuelve un Seguro, que al anidarse no se escapa dos veces', () => {
        const dentro = html`<i>${'Simon & Garfunkel'}</i>`;
        assert.ok(dentro instanceof Seguro);
        assert.equal(String(html`<b>${dentro}</b>`), '<b><i>Simon &amp; Garfunkel</i></b>');
    });
    test('las listas se unen sin separador y sin escapar lo que ya es seguro', () => {
        const filas = ['a', '<b>'].map(t => html`<li>${t}</li>`);
        assert.equal(String(html`<ul>${filas}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
    });
    test('false, null y undefined no pintan nada', () => {
        assert.equal(String(html`${false}${null}${undefined}x`), 'x');
    });
    test('un valor no puede cerrar el atributo en el que va', () => {
        assert.equal(String(html`<div title="${'" onmouseover="alert(1)'}">`), '<div title="&quot; onmouseover=&quot;alert(1)">');
    });
    test('en src y href, las URLs peligrosas se cambian por el icono', () => {
        assert.equal(String(html`<a href="${'javascript:alert(1)'}">`), '<a href="favicon.png">');
        assert.equal(String(html`<img src='${'data:text/html,<script>'}'>`), "<img src='favicon.png'>");
        assert.equal(String(html`<img src="${'https://i.ytimg.com/vi/x/mqdefault.jpg'}">`), '<img src="https://i.ytimg.com/vi/x/mqdefault.jpg">');
    });
    test('seguro() marca HTML fijo del propio código', () => {
        assert.equal(String(html`<svg>${seguro('<path d="M0 0"/>')}</svg>`), '<svg><path d="M0 0"/></svg>');
    });
});

describe('urlSegura', () => {
    for (const buena of ['https://i.ytimg.com/a.jpg', 'http://localhost/x', 'blob:https://x/1', 'data:image/jpeg;base64,AAAA',
        'favicon.png', '/api/stream/abc', 'https://localhost/_capacitor_file_/data/x.jpg']) {
        test(`deja pasar ${buena.slice(0, 40)}`, () => assert.equal(urlSegura(buena), buena));
    }
    for (const mala of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'vbscript:x', 'data:text/html,<b>', 'file:///etc/passwd']) {
        test(`rechaza ${mala}`, () => assert.equal(urlSegura(mala), 'favicon.png'));
    }
    test('vacía → el respaldo', () => {
        assert.equal(urlSegura(''), 'favicon.png');
        assert.equal(urlSegura(null, 'x.png'), 'x.png');
    });
});
