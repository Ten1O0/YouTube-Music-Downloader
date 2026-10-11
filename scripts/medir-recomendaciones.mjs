/**
 * Medir el reparto de las recomendaciones contra mezclas reales (plan 25, T5).
 * A mano, no en CI: necesita el servidor en marcha y habla con YouTube.
 *
 *     node scripts/medir-recomendaciones.mjs [http://127.0.0.1:5097]
 *
 * Tres listas de prueba de estilos distintos (rap español de nicho, pop latino
 * y rock), de cinco canciones cada una. Para cada lista compara:
 *
 * - antes: la mezcla de una canción de la lista, sus 35 primeros vídeos y las
 *   cinco primeras canciones distintas, en su orden;
 * - después: las mezclas de las cinco canciones (100 vídeos cada una, lo que
 *   lee ahora el servidor), juntas, y `elegir` con el reparto entre artistas
 *   (como mucho dos por artista, mitad conocidos y mitad nuevos).
 *
 * Cuenta artistas distintos, el máximo de un mismo artista y cuántas son de
 * artistas que no están en la lista. Con pausas entre peticiones, para no cargar
 * a YouTube ni pasar los límites del servidor.
 */

import { claveArtista, elegir, juntarMezclas } from '../frontend/src/features/radio/pick.js';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5097';
const PAUSA_MS = 3_500;
const ANTES_VIDEOS = 34;

const LISTAS = {
    'rap español (nicho)': ['KAZE NO SOY TUYO', 'KAZE TU OLVIDO', 'KAZE EL TECHO DE MI HABITACION', 'Natos y Waor Cicatrices', 'Foyone Mama'],
    'pop latino': ['Luis Fonsi Despacito', "Shakira Hips Don't Lie", 'Aitana Los Angeles', 'Karol G TQG', 'Bad Bunny Dakiti'],
    'rock': ['Queen Bohemian Rhapsody', 'Led Zeppelin Stairway to Heaven', 'Coldplay Viva la Vida', 'Arctic Monkeys Do I Wanna Know', 'Heroes del Silencio Entre dos tierras'],
};

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function buscar(texto) {
    const res = await fetch(`${BASE}/api/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: texto }),
    });
    const datos = await res.json();
    const primero = (datos.results ?? datos)[0];
    return { id: primero.id ?? new URL(primero.url).searchParams.get('v'), title: primero.title, channel: primero.channel };
}

async function mezcla(id) {
    const res = await fetch(`${BASE}/api/radio?semilla=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`/api/radio ${res.status}`);
    return (await res.json()).candidatas ?? [];
}

function resumen(nombre, elegidas, deLaLista) {
    const artistas = elegidas.map((s) => claveArtista(s));
    const cuenta = new Map();
    for (const a of artistas) cuenta.set(a, (cuenta.get(a) ?? 0) + 1);
    const nuevos = artistas.filter((a) => !deLaLista.has(a)).length;
    console.log(`  ${nombre.padEnd(8)} ${String(new Set(artistas).size).padStart(2)} artistas · máx. ${Math.max(...cuenta.values())} de uno · ${nuevos} de fuera de la lista`);
    console.log(`           ${elegidas.map((s) => s.artist || s.channel).join(' | ')}`);
}

for (const [nombre, consultas] of Object.entries(LISTAS)) {
    console.log(`\n=== ${nombre}`);
    const canciones = [];
    for (const q of consultas) {
        canciones.push(await buscar(q));
        await dormir(PAUSA_MS);
    }
    const deLaLista = new Set(canciones.map(claveArtista).filter(Boolean));
    const sonadas = new Set(canciones.map((c) => c.id));
    const mezclas = [];
    for (const c of canciones) {
        mezclas.push(await mezcla(c.id).catch((e) => { console.warn(`  sin mezcla de ${c.title}: ${e.message}`); return []; }));
        await dormir(PAUSA_MS);
    }

    // Antes: una semilla, 35 vídeos, en su orden y sin reparto
    const antes = elegir(mezclas[0].slice(0, ANTES_VIDEOS), { sonadas, n: 5, porArtista: Infinity });
    // Después: cinco semillas, 100 vídeos cada una, juntas y repartidas
    const despues = elegir(juntarMezclas(mezclas), { sonadas, n: 5, conocidos: deLaLista });
    const otras = elegir(juntarMezclas(mezclas), {
        sonadas: new Set([...sonadas, ...despues.map((s) => s.videoId)]), n: 5, conocidos: deLaLista,
        recientes: despues.map(claveArtista),
    });
    resumen('antes', antes, deLaLista);
    resumen('después', despues, deLaLista);
    resumen('«Otras»', otras, deLaLista);
}
