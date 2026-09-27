/**
 * HTML construido con plantillas, sin inyección (plan 10, T1).
 *
 * Los títulos y canales llegan de YouTube, y los nombres de las listas los
 * escribe quien las crea: interpolados tal cual en innerHTML, un título como
 * `<img src=x onerror=…>` ejecutaba código, y en la APK ese código tenía a mano
 * los plugins nativos. Con la etiqueta `html`, todo lo interpolado se escapa.
 *
 *     el.innerHTML = html`<div class="fila">${song.title}</div>`;
 *
 * - Lo que ya es HTML seguro (otra plantilla `html`) se inserta tal cual, así
 *   que anidar plantillas no escapa dos veces.
 * - Los arrays se unen sin separador: `${lista.map(s => html`…`)}` sin `.join('')`.
 * - En los atributos `src` y `href`, la URL pasa además por `urlSegura`.
 */

const ENTIDADES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Texto listo para ir dentro de HTML, como contenido o como valor de atributo. */
export const escapar = (valor) => String(valor ?? '').replace(/[&<>"'`]/g, (c) => ENTIDADES[c]);

/** HTML que ya se sabe seguro: el resultado de una plantilla `html`. */
export class Seguro {
    constructor(texto) { this.texto = texto; }
    toString() { return this.texto; }
}

/**
 * URLs que pueden ir en un `src` o un `href`. Todo lo que no sea http(s),
 * blob:, una imagen en data: o una ruta relativa se sustituye por el icono.
 */
export function urlSegura(url, respaldo = 'favicon.png') {
    const texto = String(url ?? '').trim();
    if (!texto) return respaldo;
    if (/^(https?:|blob:)/i.test(texto)) return texto;
    if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(texto)) return texto;
    // Relativa: sin esquema (nada de «javascript:», «vbscript:», «data:text/html»…)
    if (!/^[a-z][a-z0-9+.-]*:/i.test(texto)) return texto;
    return respaldo;
}

const ATRIBUTO_URL = /\s(?:src|href)=["']$/i;

function convertir(valor, esUrl) {
    if (valor instanceof Seguro) return valor.texto;
    if (Array.isArray(valor)) return valor.map((v) => convertir(v, false)).join('');
    if (valor === false || valor === null || valor === undefined) return '';
    return escapar(esUrl ? urlSegura(valor) : valor);
}

/** Etiqueta de plantilla: escapa todo lo interpolado salvo lo que ya es `Seguro`. */
export function html(partes, ...valores) {
    let texto = partes[0];
    for (let i = 0; i < valores.length; i++) {
        texto += convertir(valores[i], ATRIBUTO_URL.test(partes[i])) + partes[i + 1];
    }
    return new Seguro(texto);
}

/** Marca como seguro un HTML fijo del propio código (iconos, textos con etiquetas). */
export const seguro = (texto) => new Seguro(String(texto));
