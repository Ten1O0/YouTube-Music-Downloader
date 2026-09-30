/**
 * Idioma de la interfaz: detectarlo, cambiarlo y traducir.
 */

import { StorageModule } from '../core/storage.js';
import es from './translations/es.js';
import { flagImg } from '../ui/flags.js';


export const SUPPORTED_LANGS = ['es', 'en', 'fr', 'de', 'pt', 'zh'];

export const FALLBACK_LANG = 'es';

// Solo viaja con la app el castellano, que es el de respaldo; cada uno de los
// otros se descarga aparte al elegirlo (plan 19, T11): son 85 KB de textos que
// casi nadie usa a la vez
const TABLAS = { es };
const CARGAR = {
    en: () => import('./translations/en.js'),
    fr: () => import('./translations/fr.js'),
    de: () => import('./translations/de.js'),
    pt: () => import('./translations/pt.js'),
    zh: () => import('./translations/zh.js'),
};

/** Deja lista la tabla de `lang`. false si no se ha podido (sin conexión, por ejemplo). */
export async function cargarIdioma(lang) {
    if (TABLAS[lang]) return true;
    try {
        TABLAS[lang] = (await CARGAR[lang]()).default;
        return true;
    } catch (e) {
        console.warn('[Idioma] No se pudo cargar', lang, e);
        return false;
    }
}

/**
 * Primer idioma del navegador que la aplicación sepa hablar.
 *
 * Traducir seis idiomas y arrancar siempre en castellano es trabajo hecho y no
 * entregado: la mayoría de usuarios nunca abren el selector.
 */
export function detectBrowserLang() {
    const etiquetas = navigator.languages?.length
        ? navigator.languages
        : [navigator.language || ''];

    for (const etiqueta of etiquetas) {
        const base = String(etiqueta).toLowerCase().split('-')[0];
        if (SUPPORTED_LANGS.includes(base)) return base;
    }
    return FALLBACK_LANG;
}

export class LanguageManager {
    constructor() {
        this.currentLang = FALLBACK_LANG;
    }

    async init() {
        // Casi siempre el idioma guardado es el del navegador: se va pidiendo
        // mientras se lee, para no esperar una descarga detrás de la otra
        cargarIdioma(detectBrowserLang());
        // La elección explícita del usuario tiene prioridad sobre el navegador
        const guardado = await StorageModule.get('language');
        this.currentLang = SUPPORTED_LANGS.includes(guardado)
            ? guardado
            : detectBrowserLang();

        await this.setLanguage(this.currentLang);

        // Bind all language selectors in the DOM (Desktop & Mobile)
        document.querySelectorAll('.lang-toggle-el').forEach(toggleEl => {
            toggleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const menuEl = toggleEl.nextElementSibling;
                if (menuEl) menuEl.classList.toggle('hidden');
                toggleEl.parentElement.classList.toggle('open');
            });
        });

        document.addEventListener('click', () => {
            document.querySelectorAll('.lang-menu-el').forEach(menuEl => {
                menuEl.classList.add('hidden');
            });
            document.querySelectorAll('.lang-toggle-el').forEach(toggleEl => {
                toggleEl.parentElement.classList.remove('open');
            });
        });

        document.querySelectorAll('.lang-option').forEach(btn => {
            btn.addEventListener('click', async () => {
                await this.setLanguage(btn.dataset.lang);
                // Lo elige el usuario: viaja con la cuenta (plan 13)
                document.dispatchEvent(new CustomEvent('idioma-elegido'));
            });
        });
    }

    async setLanguage(lang) {
        // Un valor corrupto en IndexedDB dejaba la aplicación en blanco con un
        // TypeError al indexar la tabla de textos
        if (!SUPPORTED_LANGS.includes(lang)) lang = FALLBACK_LANG;
        // Sin su tabla, en castellano; se reintentará al volver a elegirlo
        if (!(await cargarIdioma(lang))) lang = FALLBACK_LANG;

        this.currentLang = lang;
        await StorageModule.set('language', lang);

        // Update UI Flag
        document.querySelectorAll('.current-lang').forEach(el => {
            el.innerHTML = flagImg(lang, 'lang-flag-current');
        });

        const tabla = TABLAS[lang];

        // Update Static Text
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (!tabla[key]) return;
            // Parámetros opcionales, p. ej. el formato del botón de descarga
            let params = {};
            try { params = el.dataset.i18nParams ? JSON.parse(el.dataset.i18nParams) : {}; }
            catch { /* parámetros mal formados: se pinta sin ellos */ }
            el.textContent = this.t(key, params);
        });

        // Update Placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            if (tabla[key]) el.placeholder = tabla[key];
        });

        // Update Titles (tooltips)
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.dataset.i18nTitle;
            if (tabla[key]) el.title = tabla[key];
        });

        // Update active state in menu
        document.querySelectorAll('.lang-option').forEach(btn => {
            if (btn.dataset.lang === lang) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }

    t(key, params = {}) {
        let text = TABLAS[this.currentLang]?.[key]
            ?? TABLAS[FALLBACK_LANG][key]
            ?? key;
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, v);
        }
        return text;
    }
}

export const i18n = new LanguageManager();

/** «1 canción», «2 canciones»: en el idioma de la interfaz y bien escrito. */
export function contarCanciones(n) {
    return i18n.t(n === 1 ? 'song_count_one' : 'song_count_other', { n });
}
