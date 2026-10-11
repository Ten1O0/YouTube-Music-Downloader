/**
 * Cola de descargas en curso y su panel.
 */

import { apiBase } from '../../config/env.js';
import { i18n } from '../../i18n/language-manager.js';
import { createBannerView, createIslandView } from '../../ui/downloads-hud.js';

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
            // Un lote que terminó con fallos (plan 20)
            onRetry: (id) => this.items.get(id)?.alReintentar?.(),
            onDismiss: (id) => this.remove(id),
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

    /**
     * El aviso sale al pulsar, antes de que el servidor conteste (plan 24): con
     * un id provisional que, al llegar el de verdad, cambia por él sin que el
     * aviso se mueva. La isla guarda el propio objeto y le basta con su id.
     */
    renombrar(viejo, nuevo, info) {
        const item = this.items.get(viejo);
        if (!item) return false;
        this.items.delete(viejo);
        item.id = nuevo;
        item.alCancelar = undefined;   // desde ya se cancela en el servidor
        if (info) item.info = { ...item.info, ...info };
        this.items.set(nuevo, item);
        this.vista?.renombrar?.(viejo, nuevo);
        this.vista?.update(item);
        return true;
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

    // ─── Lotes (plan 20): un solo aviso para muchas canciones ───

    /** Un lote: «Lista · 0 de 35». Cancelarlo es cosa de quien lo lanzó. */
    addLote(id, info, { alCancelar } = {}) {
        const item = {
            id, tipo: 'lote', info: { ...info }, status: 'starting', percent: 0, message: '', alCancelar,
            lote: { total: info.total ?? 0, hechas: 0, fallidas: 0, enCurso: [] },
        };
        this.items.set(id, item);
        this.vista?.add(item);
        this.anunciar(i18n.t('hud_announce_start', { title: info?.title || '' }));
    }

    /** `estado`: el de estadoDelLote; `resumen`: el del servidor (qué se está bajando ahora). */
    actualizarLote(id, estado, resumen) {
        const item = this.items.get(id);
        if (!item || item.status === 'cancelling') return;
        item.status = 'downloading';
        item.percent = estado.percent;
        item.lote = {
            total: estado.total,
            hechas: estado.hechas,
            fallidas: estado.fallidas,
            enCurso: (resumen?.canciones ?? []).filter((c) => c.estado === 'descargando')
                .map((c) => ({ titulo: c.titulo, videoId: c.videoId })),
        };
        this.vista?.update(item);
    }

    /**
     * Fin del lote. Todo bien: «35 descargadas», un momento. Con fallos: se
     * queda a la vista, con «Reintentar», hasta que se cierra.
     */
    terminarLote(id, { hechas, fallidas, total, cancelado }, { alReintentar } = {}) {
        const item = this.items.get(id);
        if (!item) return;
        if (cancelado) { this.remove(id); return; }
        item.lote = { ...item.lote, total, hechas, fallidas: fallidas.length, enCurso: [], nombresFallidas: fallidas.map((f) => f.title) };
        item.percent = 100;
        if (fallidas.length) {
            item.status = 'error';
            item.alReintentar = alReintentar ? () => { this.remove(id); alReintentar(); } : null;
            this.vista?.fail(item);
            this.anunciar(i18n.t('hud_batch_partial', { n: hechas, total, fallidas: fallidas.length }));
            return;
        }
        item.status = 'complete';
        item.info.textoHecho = i18n.t('hud_batch_done', { n: hechas });
        this.vista?.complete(item);
        this.anunciar(i18n.t('hud_batch_done', { n: hechas }));
        this.retirarTras(id, (this.vista?.dwell.complete ?? 1500) + 1200);
    }

    /** Si alguna descarga está en marcha (para no medir sonoridad a la vez, plan 12). */
    hayActivas() {
        return [...this.items.values()].some((i) => i.status === 'starting' || i.status === 'downloading');
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
