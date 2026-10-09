/**
 * Medir las letras contra el LRCLIB real (plan 22, T6). A mano, no en CI.
 *
 *     node scripts/medir-letras.mjs [--solo conocidas|dificiles]
 *
 * Las mismas 36 muestras que el «hoy» de §4 del plan (2026-10-08): 20 canciones
 * conocidas con el título de su canal oficial y 16 casos difíciles (canales de
 * letras, «Canción - Artista», sin guion). Cada una con la duración de su vídeo
 * y la respuesta buena (artista y título), para contar no solo las que se
 * encuentran sino, sobre todo, las EQUIVOCADAS:
 *
 * - de otra canción u otro artista;
 * - sincronizada pero de otra versión (más de ±3 s): iría desacompasada.
 *
 * Compara la búsqueda de antes (S0: título y artista con la limpieza vieja de
 * lyrics.js, el primer resultado con letra) con la cascada nueva
 * (consultasDeLetra + elegirLetra). Sin cabeceras propias y con 250 ms entre
 * peticiones, para no cargar a LRCLIB; con los mismos reintentos que la app.
 */

import { completarMetadatos, limpiarTitulo } from '../frontend/src/core/titles.js';
import { consultasDeLetra, elegirLetra } from '../frontend/src/features/letras/elegir.js';

const PAUSA_MS = 250;
const REINTENTOS_MS = [1500, 4000];

// [título de YouTube, canal, duración del vídeo (s), artista bueno, título bueno]
const CONOCIDAS = [
    ['Queen – Bohemian Rhapsody (Official Video Remastered)', 'Queen Official', 360, /queen/, /bohemian rhapsody/],
    ['ROSALÍA - DESPECHÁ (Official Video)', 'ROSALÍA', 159, /rosalia/, /despecha/],
    ['Bad Bunny - Tití Me Preguntó (Video Oficial) | Un Verano Sin Ti', 'Bad Bunny', 291, /bad bunny/, /titi me pregunto/],
    ['The Weeknd - Blinding Lights (Official Audio)', 'TheWeekndVEVO', 204, /weeknd/, /blinding lights/],
    ['QUEVEDO || BZRP Music Sessions #52', 'Bizarrap', 204, /bizarrap|quevedo/, /sessions?\b.*\b52\b/],
    ['SHAKIRA || BZRP Music Sessions #53', 'Bizarrap', 218, /bizarrap|shakira/, /sessions?\b.*\b53\b/],
    ['Ed Sheeran - Shape of You (Official Music Video)', 'Ed Sheeran', 264, /ed sheeran/, /shape of you/],
    ['Daddy Yankee - Gasolina (Letra)', 'Letras Latinas', 198, /daddy yankee/, /gasolina/],
    ['Coldplay - Viva La Vida (Official Video)', 'Coldplay', 243, /coldplay/, /viva la vida/],
    ['Estopa - Como Camarón (Videoclip Oficial)', 'EstopaVEVO', 208, /estopa/, /como camaron/],
    ['Mecano - Hijo De La Luna (Videoclip)', 'Mecano', 259, /mecano/, /hijo de la luna/],
    ['KAROL G, Shakira - TQG (Official Video)', 'KAROL G', 217, /karol g/, /tqg/],
    ['Dua Lipa - Levitating Featuring DaBaby (Official Music Video)', 'Dua Lipa', 231, /dua lipa/, /levitating/],
    ['Arctic Monkeys - Do I Wanna Know? (Official Video)', 'ArcticMonkeysVEVO', 266, /arctic monkeys/, /do i wanna know/],
    ['Melendi - Caminando por la vida', 'Melendi - Topic', 204, /melendi/, /caminando por la vida/],
    ['Héroes del Silencio - Entre dos tierras (Remastered 2007)', 'Heroes del Silencio', 370, /heroes del silencio/, /entre dos tierras/],
    ['Pablo Alborán - Saturno (Videoclip Oficial)', 'Pablo Alborán', 254, /pablo alboran/, /saturno/],
    ['Imagine Dragons - Believer (Official Music Video)', 'ImagineDragonsVEVO', 217, /imagine dragons/, /believer/],
    ['Aitana - Los Ángeles (Official Video)', 'Aitana', 192, /aitana/, /los angeles/],
    ['Feid, ATL Jacob - LUNA (Official Video)', 'Feid', 200, /feid/, /\bluna\b/],
];
const DIFICILES = [
    ['Gasolina', 'Letras Latinas', 192, /daddy yankee/, /gasolina/],
    ['Hijo de la luna - Mecano | Letra', 'Letras de Canciones', 259, /mecano/, /hijo de la luna/],
    ['bohemian rhapsody lyrics', 'Lyrics Channel', 359, /queen/, /bohemian rhapsody/],
    ['Despacito ft. Daddy Yankee', 'LuisFonsiVEVO', 282, /luis fonsi/, /despacito/],
    ['Entre dos tierras', 'Rock en Español', 370, /heroes del silencio/, /entre dos tierras/],
    ['La Flaca', 'Jarabe de Palo - Topic', 262, /jarabe de palo/, /la flaca/],
    ['Mr. Brightside', 'The Killers - Topic', 223, /killers/, /mr brightside/],
    ['Dákiti', 'Bad Bunny - Topic', 214, /bad bunny|jhay cortez/, /dakiti/],
    ['Yellow - Coldplay (Lyrics)', '7clouds', 270, /coldplay/, /\byellow\b/],
    ['Corazón Partío', 'Alejandro Sanz - Topic', 301, /alejandro sanz/, /corazon partio/],
    ['Wonderwall (Remastered)', 'Oasis - Topic', 259, /oasis/, /wonderwall/],
    ['Pepas', 'Farruko - Topic', 288, /farruko/, /pepas/],
    ['La Bachata', 'Manuel Turizo', 195, /manuel turizo|mtz/, /la bachata/],
    ['Me Porto Bonito', 'Bad Bunny - Topic', 192, /bad bunny/, /me porto bonito/],
    ["Hips Don't Lie (feat. Wyclef Jean)", 'Shakira - Topic', 219, /shakira/, /hips don ?t lie/],
    ['Stairway To Heaven (Remaster)', 'Led Zeppelin - Topic', 486, /led zeppelin/, /stairway to heaven/],
];

const plano = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
let peticiones = 0;

/** Como la app: dos reintentos si LRCLIB está ocupado. null si no se pudo preguntar. */
async function buscar(params) {
    for (let intento = 0; ; intento++) {
        peticiones++;
        let res = null;
        try {
            res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(8000) });
        } catch { /* red: se reintenta */ }
        await espera(PAUSA_MS);
        if (res?.ok) return res.json();
        if (res && res.status < 500 && res.status !== 429) return [];
        if (intento >= REINTENTOS_MS.length) return null;
        await espera(REINTENTOS_MS[intento]);
    }
}

/** La búsqueda de antes (S0): título y artista con la limpieza vieja, el primer resultado con letra. */
async function antes(titulo, canal) {
    const { artista, cancion } = limpiarTitulo(titulo, canal);
    const t = cancion.replace(/\((?:official|lyric|audio|video|hd|hq|4k|visualizer|ft\.?|feat\.?).*?\)/gi, '')
        .replace(/\[(?:official|lyric|audio|video|hd|hq|4k).*?\]/gi, '').replace(/\s{2,}/g, ' ').trim();
    const a = (artista || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
    const resultados = await buscar({ track_name: t, artist_name: a });
    if (resultados === null) return { estado: 'sin respuesta' };
    const r = resultados.find((x) => x.syncedLyrics || x.plainLyrics);
    return r ? { estado: 'encontrada', candidata: r, tipo: r.syncedLyrics ? 'synced' : 'plain' } : { estado: 'sin letra' };
}

/** La cascada nueva: consultasDeLetra hasta que elegirLetra acepta una. */
async function despues(titulo, canal, duracion) {
    const song = completarMetadatos({ title: titulo, channel: canal, duration: duracion });
    let fallos = 0;
    for (const { paso, params } of consultasDeLetra(song)) {
        const resultados = await buscar(params);
        if (resultados === null) { fallos++; continue; }
        const letra = elegirLetra(resultados, song, paso);
        if (letra) {
            // Muchas entradas comparten la misma letra con otra duración: se busca por las dos
            const mismaLetra = (x) => (letra.tipo === 'synced' ? x.syncedLyrics === letra.texto : (x.plainLyrics === letra.texto || Boolean(x.syncedLyrics)));
            const candidata = resultados.find((x) => x.duration === letra.duracion && mismaLetra(x));
            return { estado: 'encontrada', candidata, tipo: letra.tipo, paso };
        }
    }
    return { estado: fallos ? 'sin respuesta' : 'sin letra' };
}

/** ¿Es la buena? Otra canción u otro artista, u otra versión si va sincronizada. */
function juzgar(r, duracion, artistaBueno, tituloBueno) {
    if (r.estado !== 'encontrada') return r.estado;
    const c = r.candidata;
    if (!c || !artistaBueno.test(plano(c.artistName)) || !tituloBueno.test(plano(c.trackName))) return 'EQUIVOCADA (otra canción)';
    if (r.tipo === 'synced' && Number.isFinite(c.duration) && Math.abs(c.duration - duracion) > 3) return 'EQUIVOCADA (otra versión)';
    return r.tipo === 'synced' ? 'buena' : 'buena, sin sincronizar';
}

async function medir(nombre, muestra) {
    const cuenta = { antes: {}, despues: {} };
    const sumar = (lado, estado) => { cuenta[lado][estado] = (cuenta[lado][estado] ?? 0) + 1; };
    console.log(`\n=== ${nombre} (${muestra.length})`);
    for (const [titulo, canal, duracion, artistaBueno, tituloBueno] of muestra) {
        const a = juzgar(await antes(titulo, canal), duracion, artistaBueno, tituloBueno);
        const d0 = await despues(titulo, canal, duracion);
        const d = juzgar(d0, duracion, artistaBueno, tituloBueno);
        sumar('antes', a);
        sumar('despues', d);
        const c = d0.candidata;
        const ficha = c ? ` «${c.trackName}» de ${c.artistName}, ${c.duration} s frente a ${duracion}` : '';
        console.log(`${titulo.slice(0, 48).padEnd(48)} | antes: ${a.padEnd(26)} | después: ${d}${d0.paso ? ` (paso ${d0.paso},${ficha})` : ''}`);
    }
    return cuenta;
}

const solo = process.argv.includes('--solo') ? process.argv[process.argv.indexOf('--solo') + 1] : null;
const total = {};
if (!solo || solo === 'conocidas') total.conocidas = await medir('Conocidas', CONOCIDAS);
if (!solo || solo === 'dificiles') total.dificiles = await medir('Difíciles', DIFICILES);

const buenas = (c) => (c.buena ?? 0) + (c['buena, sin sincronizar'] ?? 0);
const malas = (c) => Object.entries(c).filter(([k]) => k.startsWith('EQUIVOCADA')).reduce((n, [, v]) => n + v, 0);
console.log('\n=== Resumen');
for (const [nombre, c] of Object.entries(total)) {
    const n = Object.values(c.antes).reduce((a, b) => a + b, 0);
    console.log(`${nombre}: antes ${buenas(c.antes)}/${n} buenas y ${malas(c.antes)} equivocadas · después ${buenas(c.despues)}/${n} buenas (${c.despues['buena, sin sincronizar'] ?? 0} sin sincronizar) y ${malas(c.despues)} equivocadas`);
    console.log(`   antes: ${JSON.stringify(c.antes)}\n   después: ${JSON.stringify(c.despues)}`);
}
console.log(`Peticiones a LRCLIB: ${peticiones}`);
