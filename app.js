/**
 * YouTube Downloader - Frontend JavaScript
 * Handles form validation, API communication, progress tracking via polling
 */

// ========================================
// DOM Elements
// ========================================
const urlInput = document.getElementById('youtubeUrl');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const statusMessage = document.getElementById('statusMessage');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const searchResults = document.getElementById('searchResults');
const resultsList = document.getElementById('resultsList');
const themeToggle = document.getElementById('themeToggle');
const qualitySelect = document.getElementById('qualitySelect');

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

function isUrl(input) {
    return YOUTUBE_URL_PATTERN.test(input.trim());
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

function showSearchResults() {
    searchResults.classList.remove('hidden');
}

function hideSearchResults() {
    searchResults.classList.add('hidden');
    resultsList.innerHTML = '';
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
    hideSearchResults();

    // If it's a URL, download directly. If it's a search query, show results
    if (isUrl(input)) {
        await downloadFromUrl(input);
    } else {
        await searchAndShowResults(input);
    }
}

async function searchAndShowResults(query) {
    setLoading(true);
    showProgress();
    updateProgress(30, 'Buscando en YouTube...');

    try {
        const response = await fetch(`${API_URL}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al buscar');
        }

        const { results } = await response.json();
        hideProgress();
        renderSearchResults(results);

    } catch (error) {
        console.error('Search error:', error);
        hideProgress();
        showStatus(error.message || 'Error al buscar. Inténtalo de nuevo', 'error');
    } finally {
        setLoading(false);
    }
}

function renderSearchResults(results) {
    resultsList.innerHTML = '';

    results.forEach(video => {
        const item = document.createElement('div');
        item.className = 'result-item';

        // Extract video ID from URL
        const videoId = extractVideoId(video.url);

        item.innerHTML = `
            <button class="preview-btn" data-video-id="${videoId}" title="Escuchar preview">
                <svg class="music-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
            </button>
            <img class="result-thumbnail" src="${video.thumbnail}" alt="${video.title}" loading="lazy">
            <div class="result-info">
                <div class="result-title">${video.title}</div>
                <div class="result-meta">
                    <span class="result-channel">${video.channel}</span>
                    ${video.duration ? `<span class="result-duration">${formatDuration(video.duration)}</span>` : ''}
                </div>
            </div>
        `;

        // Preview click handler (on preview button)
        const previewBtn = item.querySelector('.preview-btn');
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePreview(videoId, previewBtn);
        });

        // Download click handler (on rest of the item)
        const thumbnail = item.querySelector('.result-thumbnail');
        const infoArea = item.querySelector('.result-info');

        const startDownload = () => {
            stopPreview();
            hideSearchResults();
            urlInput.value = video.url;
            downloadFromUrl(video.url);
        };

        thumbnail.style.cursor = 'pointer';
        thumbnail.addEventListener('click', startDownload);
        infoArea.style.cursor = 'pointer';
        infoArea.addEventListener('click', startDownload);

        resultsList.appendChild(item);
    });

    showSearchResults();
}

// Extract video ID from YouTube URL
function extractVideoId(url) {
    const match = url.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/);
    return match ? match[1] : null;
}

async function downloadFromUrl(url) {
    setLoading(true);
    showProgress();
    updateProgress(5, 'Conectando con YouTube...');

    try {
        // Step 1: Start the download
        const quality = qualitySelect.value;
        const startResponse = await fetch(`${API_URL}/api/start-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, quality }),
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

        // Show success animation
        showSuccessAnimation();

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

// Clear button functionality
clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    hideStatus();
    urlInput.focus();
});

// ========================================
// Theme Toggle
// ========================================

function getPreferredTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) return savedTheme;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

function initTheme() {
    const theme = getPreferredTheme();
    setTheme(theme);
}

// Theme toggle click handler
themeToggle.addEventListener('click', toggleTheme);

// ========================================
// Audio Preview (YouTube IFrame API)
// ========================================

let ytPlayer = null;
let currentPreviewId = null;
let currentThumbnailWrapper = null;

// Called automatically by YouTube IFrame API when ready
function onYouTubeIframeAPIReady() {
    ytPlayer = new YT.Player('youtubePlayer', {
        height: '1',
        width: '1',
        playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0
        },
        events: {
            onStateChange: onPlayerStateChange
        }
    });
}

// Make it globally available
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function onPlayerStateChange(event) {
    // YT.PlayerState.ENDED = 0
    if (event.data === 0) {
        stopPreview();
    }
}

function togglePreview(videoId, thumbnailWrapper) {
    if (!ytPlayer || !ytPlayer.loadVideoById) {
        console.warn('YouTube player not ready yet');
        return;
    }

    // If same video is playing, pause it
    if (currentPreviewId === videoId) {
        stopPreview();
        return;
    }

    // Stop any current preview
    if (currentPreviewId) {
        stopPreview();
    }

    // Start new preview
    currentPreviewId = videoId;
    currentThumbnailWrapper = thumbnailWrapper;

    ytPlayer.loadVideoById(videoId);
    ytPlayer.playVideo();

    updatePlayingUI(thumbnailWrapper, true);
}

function stopPreview() {
    if (ytPlayer && ytPlayer.stopVideo) {
        ytPlayer.stopVideo();
    }

    if (currentThumbnailWrapper) {
        updatePlayingUI(currentThumbnailWrapper, false);
    }

    currentPreviewId = null;
    currentThumbnailWrapper = null;
}

function updatePlayingUI(wrapper, isPlaying) {
    if (!wrapper) return;

    const musicIcon = wrapper.querySelector('.music-icon');
    const pauseIcon = wrapper.querySelector('.pause-icon');

    if (isPlaying) {
        wrapper.classList.add('playing');
        if (musicIcon) musicIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'block';
    } else {
        wrapper.classList.remove('playing');
        if (musicIcon) musicIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
    }
}

// ========================================
// Animations
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setTimeout(() => urlInput.focus(), 600);
});

// ========================================
// Success Animations
// ========================================

const CONFETTI_COLORS = ['#FF0000', '#ff3333', '#ff6666', '#2ed573', '#ffa502', '#ff6b81', '#70a1ff', '#7bed9f'];

function createConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    // Create 50 confetti pieces
    for (let i = 0; i < 50; i++) {
        const piece = document.createElement('div');
        piece.className = `confetti-piece ${Math.random() > 0.5 ? 'circle' : 'square'}`;

        // Random position
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.top = '-10px';

        // Random color
        piece.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];

        // Random size
        const size = 5 + Math.random() * 10;
        piece.style.width = `${size}px`;
        piece.style.height = `${size}px`;

        // Random animation delay and duration
        piece.style.animationDelay = `${Math.random() * 0.5}s`;
        piece.style.animationDuration = `${2 + Math.random() * 2}s`;

        container.appendChild(piece);
    }

    // Cleanup after animation
    setTimeout(() => container.remove(), 4000);
}

function showSuccessAnimation() {
    // Create success overlay
    const overlay = document.createElement('div');
    overlay.className = 'success-overlay';
    overlay.innerHTML = `
        <div class="success-checkmark">
            <svg viewBox="0 0 24 24">
                <path d="M5 12l5 5L20 7"/>
            </svg>
        </div>
    `;
    document.body.appendChild(overlay);

    // Create confetti
    createConfetti();

    // Fade out and remove
    setTimeout(() => {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 500);
    }, 1500);
}

document.addEventListener('mousemove', (e) => {
    const glow = document.querySelector('.background-glow');
    if (glow) {
        const moveX = (e.clientX - window.innerWidth / 2) * 0.02;
        const moveY = (e.clientY - window.innerHeight / 2) * 0.02;
        glow.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    }
});
