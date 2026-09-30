/**
 * Recorta la fuente de iconos a los que usa la app (plan 19, T10).
 *
 *     node scripts/iconos.mjs
 *
 * Material Symbols completa pesa 350 KB; la app usa unos pocos cientos de
 * iconos. Se buscan en el código todas las palabras que coinciden con el
 * nombre de un icono (sobran algunas, pero no falta ninguna) y se pide a
 * Google la misma fuente, con las mismas opciones que antes
 * (opsz,wght,FILL,GRAD = 24,300,0,0), solo con esos iconos. Los glifos son
 * idénticos a los de la fuente completa.
 *
 * Hay que volver a ejecutarlo al usar un icono nuevo: sin él, el icono se ve
 * como su nombre en texto. El recorrido 75 lo detecta.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NOMBRES = 'https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints';
const CSS = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0&display=swap&icon_names=';
// Sin un navegador moderno como agente, Google responde con TTF en lugar de woff2
const AGENTE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const DESTINO = 'frontend/src/fonts/material-symbols-outlined.woff2';

function ficheros(dir) {
    return readdirSync(dir).flatMap((f) => {
        const ruta = join(dir, f);
        return statSync(ruta).isDirectory() ? ficheros(ruta) : [ruta];
    });
}

const pedir = async (url) => {
    const r = await fetch(url, { headers: { 'User-Agent': AGENTE } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r;
};

const existentes = new Set((await (await pedir(NOMBRES)).text()).split('\n').map((l) => l.split(' ')[0]).filter(Boolean));

const fuentes = [...ficheros('frontend/src'), 'frontend/index.html'].filter((f) => /\.(js|html|css)$/.test(f));
const palabras = new Set(fuentes.flatMap((f) => readFileSync(f, 'utf8').match(/[a-z0-9_]+/g) ?? []));
const iconos = [...palabras].filter((p) => existentes.has(p)).sort();

const css = await (await pedir(CSS + iconos.join(','))).text();
const url = css.match(/url\((https:[^)]+)\)/)?.[1];
if (!url) throw new Error('Google no devolvió la fuente');
writeFileSync(DESTINO, Buffer.from(await (await pedir(url)).arrayBuffer()));
console.log(`${iconos.length} iconos → ${DESTINO}`);
