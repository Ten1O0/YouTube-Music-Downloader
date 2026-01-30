/**
 * YouTube Downloader - Frontend JavaScript
 * Handles form validation, API communication, progress tracking via polling
 */

// ========================================
// DOM Elements
// ========================================
const urlInput = document.getElementById('youtubeUrl');
const downloadBtn = document.getElementById('downloadBtn');
const statusMessage = document.getElementById('statusMessage');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// ========================================
// Configuration
// ========================================
const API_URL = 'http://localhost:5000';
const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/;

// ========================================
// Utility Functions
// ========================================

function isValidInput(input) {
    const trimmed = input.trim();
    return YOUTUBE_URL_PATTERN.test(trimmed) || trimmed.length >= 2;
}

function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type} visible`;
}

function hideStatus() {
    statusMessage.className = 'status-message';
}

function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
}

function showProgress() {
    progressSection.classList.remove('hidden');
    updateProgress(0, 'Iniciando descarga...');
}

function hideProgress() {
    progressSection.classList.add('hidden');
}

function setLoading(loading) {
    if (loading) {
        downloadBtn.classList.add('loading');
        downloadBtn.disabled = true;
    } else {
        downloadBtn.classList.remove('loading');
        downloadBtn.disabled = false;
    }
}

function downloadBlob(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// ========================================
// Progress Polling
// ========================================

async function pollProgress(downloadId, total) {
    return new Promise((resolve, reject) => {
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`${API_URL}/api/progress/${downloadId}`);
                const data = await response.json();

                if (data.status === 'downloading') {
                    const percent = total > 0
                        ? Math.min(10 + (data.current / total) * 80, 90)
                        : 50;
                    updateProgress(percent, data.message);
                } else if (data.status === 'complete') {
                    clearInterval(pollInterval);
                    updateProgress(95, data.message);
                    resolve(data);
                } else if (data.status === 'error') {
                    clearInterval(pollInterval);
                    reject(new Error(data.message));
                } else if (data.status === 'starting') {
                    updateProgress(5, data.message);
                }
            } catch (err) {
                // Continue polling on network errors
                console.warn('Poll error:', err);
            }
        }, 1000);

        // Timeout after 30 minutes
        setTimeout(() => {
            clearInterval(pollInterval);
            reject(new Error('La descarga tardó demasiado'));
        }, 30 * 60 * 1000);
    });
}

// ========================================
// Main Download Function
// ========================================

async function handleDownload() {
    const input = urlInput.value.trim();

    if (!input) {
        showStatus('Por favor, introduce un enlace de YouTube o busca una canción', 'error');
        urlInput.focus();
        return;
    }

    if (!isValidInput(input)) {
        showStatus('Introduce al menos 2 caracteres para buscar', 'error');
        urlInput.focus();
        return;
    }

    hideStatus();
    setLoading(true);
    showProgress();
    updateProgress(5, 'Conectando con YouTube...');

    try {
        // Step 1: Start the download
        const startResponse = await fetch(`${API_URL}/api/start-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: input }),
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al iniciar la descarga');
        }

        const { download_id, total } = await startResponse.json();

        updateProgress(10, total > 1
            ? `Preparando descarga de ${total} canciones...`
            : 'Descargando...');

        // Step 2: Poll for progress
        await pollProgress(download_id, total);

        // Step 3: Download the file
        updateProgress(95, 'Descargando archivo...');

        const downloadResponse = await fetch(`${API_URL}/api/download/${download_id}`);

        if (!downloadResponse.ok) {
            const errorData = await downloadResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al descargar el archivo');
        }

        const contentDisposition = downloadResponse.headers.get('Content-Disposition');
        let filename = 'youtube-download.mp3';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/);
            if (match) {
                filename = decodeURIComponent(match[1]);
            }
        }

        const blob = await downloadResponse.blob();
        updateProgress(100, '¡Descarga completada!');

        downloadBlob(blob, filename);

        setTimeout(() => {
            showStatus('¡Descarga completada! Revisa tu carpeta de descargas', 'success');
            hideProgress();
        }, 500);

    } catch (error) {
        console.error('Download error:', error);
        hideProgress();

        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            showStatus('No se puede conectar al servidor. Asegúrate de que está ejecutándose', 'error');
        } else {
            showStatus(error.message || 'Error al descargar. Inténtalo de nuevo', 'error');
        }
    } finally {
        setLoading(false);
    }
}

// ========================================
// Event Listeners
// ========================================

downloadBtn.addEventListener('click', handleDownload);

urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleDownload();
    }
});

urlInput.addEventListener('input', () => {
    if (statusMessage.classList.contains('visible')) {
        hideStatus();
    }
});

// ========================================
// Animations
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => urlInput.focus(), 600);
});

document.addEventListener('mousemove', (e) => {
    const glow = document.querySelector('.background-glow');
    if (glow) {
        const moveX = (e.clientX - window.innerWidth / 2) * 0.02;
        const moveY = (e.clientY - window.innerHeight / 2) * 0.02;
        glow.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    }
});
