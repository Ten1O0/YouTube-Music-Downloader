/**
 * Cola de descargas en curso y su panel.
 */

import { apiBase } from '../../config/env.js';
import { i18n } from '../../i18n/language-manager.js';
import { createBannerView, createIslandView } from '../../ui/downloads-hud.js';
import { avisarHaptico } from '../../ui/haptics.js';

// ========================================
// Queue Manager (Visual Panel)
// ========================================
const queuePanel = document.getElementById('queuePanel');

/**
 * Estado de las descargas en curso (plan 09, T13).
 *
 * Aquí vive solo el estado; lo pinta una vista de src/ui/downloads-hud.js:
 * la isla en el móvil y los banners en el escritorio. Si cambia el ancho de
 * la ventana, se cambia de vista en vivo con las mismas descargas.
 */
class QueueManager {
    constructor() {
        this.items = new Map(); // id -> { id, info, status, percent, message }
        this.vista = null;
        this.anunciador = document.getElementById('dlAnuncios');
        this.movil = globalThis.matchMedia?.('(max-width: 767px)');
        this.montarVista();
        this.movil?.addEventListener?.('change', () => this.montarVista());
    }

    montarVista() {
        this.vista?.destroy();
        if (!queuePanel) return;
        const opciones = {
            root: queuePanel,
            t: (clave, params) => i18n.t(clave, params),
            onCancel: (id) => this.cancel(id),
            onHaptic: (tipo) => avisarHaptico(tipo),
        };
        this.vista = this.movil?.matches ? createIslandView(opciones) : createBannerView(opciones);
        for (const item of this.items.values()) this.vista.add(item);
    }

    /** Anuncio para lectores de pantalla (región aria-live). */
    anunciar(texto) {
        if (!this.anunciador) return;
        this.anunciador.textContent = '';
        setTimeout(() => { this.anunciador.textContent = texto; }, 50);
    }

    /**
     * `alCancelar`: para tareas que no son descargas del servidor (importar
     * audios del móvil). Cancelarlas es cosa de quien las lanzó.
     */
    add(id, videoInfo, { alCancelar } = {}) {
        const item = { id, info: { ...videoInfo }, status: 'starting', percent: 0, message: '', alCancelar };
        this.items.set(id, item);
        this.vista?.add(item);
        this.anunciar(i18n.t('hud_announce_start', { title: videoInfo?.title || '' }));
    }

    update(id, percent, message, extras) {
        const item = this.items.get(id);
        if (!item || item.status === 'cancelling') return;
        item.percent = percent;
        item.status = 'downloading';
        item.message = message || i18n.t('downloading');
        if (extras?.title) item.info.title = extras.title;
        if (extras?.thumbnail) item.info.thumbnail = extras.thumbnail;
        this.vista?.update(item);
    }

    complete(id, { textoHecho } = {}) {
        const item = this.items.get(id);
        if (!item) return;
        if (textoHecho) item.info.textoHecho = textoHecho;
        item.status = 'complete';
        item.percent = 100;
        this.vista?.complete(item);
        this.anunciar(i18n.t('hud_announce_done', { title: item.info?.title || '' }));
        this.retirarTras(id, this.vista?.dwell.complete ?? 1500);
    }

    fail(id) {
        const item = this.items.get(id);
        if (!item) return;
        item.status = 'error';
        this.vista?.fail(item);
        this.retirarTras(id, this.vista?.dwell.error ?? 2000);
    }

    /** Deja ver el aviso terminado un momento; con el ratón encima, espera. */
    retirarTras(id, ms) {
        const intentar = () => {
            if (!this.items.has(id)) return;
            if (this.vista?.retener()) { setTimeout(intentar, 400); return; }
            this.remove(id);
        };
        setTimeout(intentar, ms);
    }

    async cancel(id) {
        const item = this.items.get(id);
        if (!item || item.status === 'cancelling') return;
        if (item.alCancelar) {
            item.alCancelar();
            this.remove(id);
            return;
        }
        const anterior = item.status;
        item.status = 'cancelling';
        this.vista?.update(item);
        try {
            const response = await fetch(`${apiBase()}/api/cancel/${id}`, { method: 'POST' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.remove(id);
        } catch (error) {
            console.error('Cancel error:', error);
            item.status = anterior;
            item.message = i18n.t('error_download');
            this.vista?.update(item);
        }
    }

    remove(id) {
        if (!this.items.has(id)) return;
        this.items.delete(id);
        this.vista?.remove(id);
    }
}

export const queueManager = new QueueManager();
