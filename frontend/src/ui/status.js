/**
 * Mensaje de estado, barra de progreso y estado de carga de la pantalla de
 * inicio.
 */

import { i18n } from '../i18n/language-manager.js';

export const statusMessage = document.getElementById('statusMessage');

const progressSection = document.getElementById('progressSection');

const progressFill = document.getElementById('progressFill');

const progressText = document.getElementById('progressText');

export function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type} visible`;
}

export function hideStatus() {
    statusMessage.className = 'status-message';
}

export function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
}

export function showProgress() {
    progressSection.classList.remove('hidden');
    updateProgress(0, i18n.t('initializing'));
}

export function hideProgress() {
    progressSection.classList.add('hidden');
}

// El botón se busca aquí y no se importa de la descarga: los avisos están por
// debajo de las funciones de la app y no deben depender de ellas
const downloadBtn = document.getElementById('downloadBtn');

export function setLoading(loading) {
    if (loading) {
        downloadBtn.classList.add('loading');
        downloadBtn.disabled = true;
    } else {
        downloadBtn.classList.remove('loading');
        downloadBtn.disabled = false;
    }
}
