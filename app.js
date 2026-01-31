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

// Playlist Selector Elements
const playlistSelector = document.getElementById('playlistSelector');
const playlistList = document.getElementById('playlistList');
const playlistCount = document.getElementById('playlistCount');
const selectedCount = document.getElementById('selectedCount');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');

// History Elements
const historyToggle = document.getElementById('historyToggle');
const historyContent = document.getElementById('historyContent');
const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Store playlist videos for selection
let currentPlaylistVideos = [];

// ========================================
// Configuration
// ========================================
const API_URL = 'http://localhost:5000';
const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/;
const HISTORY_MAX_ITEMS = 50;
const HISTORY_STORAGE_KEY = 'downloadHistory';

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

function isPlaylistUrl(input) {
    const url = input.trim();
    // Check for playlist URL (list=PL...) but not Radio/Mix (list=RD...)
    const hasPlaylistParam = /[?&]list=([a-zA-Z0-9_-]+)/.test(url);
    const isRadioMix = /[?&]list=RD/.test(url);
    return hasPlaylistParam && !isRadioMix;
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

function showPlaylistSelector() {
    playlistSelector.classList.remove('hidden');
}

function hidePlaylistSelector() {
    playlistSelector.classList.add('hidden');
    playlistList.innerHTML = '';
    currentPlaylistVideos = [];
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
    hidePlaylistSelector();

    // Check if it's a playlist URL first
    if (isPlaylistUrl(input)) {
        await fetchAndShowPlaylist(input);
    } else if (isUrl(input)) {
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
            downloadFromUrl(video.url, video);
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

async function downloadFromUrl(url, videoInfo = null) {
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

        // Add to history
        const videoId = extractVideoId(url);
        const historyEntry = videoInfo || {
            id: videoId,
            title: filename.replace(/\.(mp3|zip)$/i, ''),
            url: url,
            channel: 'YouTube'
        };
        if (total === 1) {  // Only add single downloads to history
            addToHistory(historyEntry);
        }

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
    hidePlaylistSelector();
    urlInput.focus();
});

// ========================================
// Playlist Selector Functions
// ========================================

async function fetchAndShowPlaylist(url) {
    setLoading(true);
    showProgress();
    updateProgress(30, 'Obteniendo canciones de la playlist...');

    try {
        const response = await fetch(`${API_URL}/api/playlist-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al obtener la playlist');
        }

        const { videos, total } = await response.json();
        hideProgress();
        renderPlaylistSelector(videos);

    } catch (error) {
        console.error('Playlist fetch error:', error);
        hideProgress();
        showStatus(error.message || 'Error al obtener la playlist', 'error');
    } finally {
        setLoading(false);
    }
}

function renderPlaylistSelector(videos) {
    currentPlaylistVideos = videos;
    playlistList.innerHTML = '';
    playlistCount.textContent = videos.length;

    videos.forEach((video, index) => {
        const item = document.createElement('div');
        item.className = 'playlist-item selected';
        item.dataset.index = index;

        item.innerHTML = `
            <input type="checkbox" class="playlist-checkbox" data-index="${index}" checked>
            <button class="preview-btn" data-video-id="${video.id}" title="Escuchar preview">
                <svg class="music-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
            </button>
            <img class="playlist-thumbnail" src="${video.thumbnail}" alt="${video.title}" loading="lazy">
            <div class="playlist-info">
                <div class="playlist-item-title">${video.title}</div>
                <div class="playlist-meta">
                    <span class="playlist-channel">${video.channel}</span>
                    ${video.duration ? `<span class="playlist-duration">${formatDuration(video.duration)}</span>` : ''}
                </div>
            </div>
        `;

        // Preview button click handler
        const previewBtn = item.querySelector('.preview-btn');
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePreview(video.id, previewBtn);
        });

        // Toggle selection on click (but not on checkbox or preview button)
        item.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox' && !e.target.closest('.preview-btn')) {
                const checkbox = item.querySelector('.playlist-checkbox');
                checkbox.checked = !checkbox.checked;
            }
            item.classList.toggle('selected', item.querySelector('.playlist-checkbox').checked);
            updateSelectedCount();
        });

        playlistList.appendChild(item);
    });

    updateSelectedCount();
    showPlaylistSelector();
}

function updateSelectedCount() {
    const checkboxes = playlistList.querySelectorAll('.playlist-checkbox:checked');
    const count = checkboxes.length;
    selectedCount.textContent = count;
    downloadSelectedBtn.disabled = count === 0;
}

function selectAllPlaylistItems() {
    const items = playlistList.querySelectorAll('.playlist-item');
    items.forEach(item => {
        item.classList.add('selected');
        item.querySelector('.playlist-checkbox').checked = true;
    });
    updateSelectedCount();
}

function deselectAllPlaylistItems() {
    const items = playlistList.querySelectorAll('.playlist-item');
    items.forEach(item => {
        item.classList.remove('selected');
        item.querySelector('.playlist-checkbox').checked = false;
    });
    updateSelectedCount();
}

async function downloadSelectedPlaylistVideos() {
    const checkboxes = playlistList.querySelectorAll('.playlist-checkbox:checked');
    const selectedVideos = Array.from(checkboxes).map(cb => {
        const index = parseInt(cb.dataset.index);
        return currentPlaylistVideos[index];
    });

    if (selectedVideos.length === 0) {
        showStatus('Selecciona al menos una canción', 'error');
        return;
    }

    hidePlaylistSelector();
    setLoading(true);
    showProgress();

    const total = selectedVideos.length;

    // If only one song, use regular single download
    if (total === 1) {
        const video = selectedVideos[0];
        urlInput.value = video.url;
        await downloadFromUrl(video.url, video);
        return;
    }

    // Multiple songs: use batch download (will be packaged as ZIP)
    try {
        updateProgress(5, `Iniciando descarga de ${total} canciones...`);

        const quality = qualitySelect.value;
        const startResponse = await fetch(`${API_URL}/api/start-batch-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videos: selectedVideos, quality }),
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al iniciar la descarga');
        }

        const { download_id } = await startResponse.json();

        // Poll for progress
        await pollProgress(download_id, total);

        // Download the ZIP file
        updateProgress(95, 'Preparando archivo ZIP...');

        const downloadResponse = await fetch(`${API_URL}/api/download/${download_id}`);

        if (!downloadResponse.ok) {
            const errorData = await downloadResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al descargar el archivo');
        }

        const contentDisposition = downloadResponse.headers.get('Content-Disposition');
        let filename = 'playlist_canciones.zip';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/);
            if (match) filename = decodeURIComponent(match[1]);
        }

        const blob = await downloadResponse.blob();
        updateProgress(100, '¡Descarga completada!');
        downloadBlob(blob, filename);

        showSuccessAnimation();

        setTimeout(() => {
            hideProgress();
            showStatus(`¡${total} canciones descargadas en ZIP!`, 'success');
        }, 500);

    } catch (error) {
        console.error('Batch download error:', error);
        hideProgress();
        showStatus(error.message || 'Error al descargar. Inténtalo de nuevo', 'error');
    } finally {
        setLoading(false);
    }
}

// Playlist selector button event listeners
if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllPlaylistItems);
if (deselectAllBtn) deselectAllBtn.addEventListener('click', deselectAllPlaylistItems);
if (downloadSelectedBtn) downloadSelectedBtn.addEventListener('click', downloadSelectedPlaylistVideos);

// ========================================
// Download History
// ========================================

function getDownloadHistory() {
    try {
        const history = localStorage.getItem(HISTORY_STORAGE_KEY);
        return history ? JSON.parse(history) : [];
    } catch (e) {
        console.error('Error reading history:', e);
        return [];
    }
}

function saveDownloadHistory(history) {
    try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
        console.error('Error saving history:', e);
    }
}

function addToHistory(video) {
    const history = getDownloadHistory();

    // Create history entry
    const entry = {
        id: video.id || extractVideoId(video.url),
        title: video.title,
        thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.id || extractVideoId(video.url)}/mqdefault.jpg`,
        channel: video.channel || 'Desconocido',
        url: video.url,
        downloadedAt: new Date().toISOString()
    };

    // Remove duplicate if exists
    const filteredHistory = history.filter(item => item.id !== entry.id);

    // Add new entry at the beginning
    filteredHistory.unshift(entry);

    // Limit to max items
    const trimmedHistory = filteredHistory.slice(0, HISTORY_MAX_ITEMS);

    saveDownloadHistory(trimmedHistory);
    renderHistory();
}

function clearHistory() {
    if (confirm('¿Estás seguro de que quieres limpiar el historial?')) {
        localStorage.removeItem(HISTORY_STORAGE_KEY);
        renderHistory();
    }
}

function renderHistory() {
    const history = getDownloadHistory();
    historyCount.textContent = history.length;

    if (history.length === 0) {
        historyList.innerHTML = '<p class="history-empty">No hay descargas recientes</p>';
        return;
    }

    historyList.innerHTML = '';

    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';

        const date = new Date(item.downloadedAt);
        const dateStr = date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

        div.innerHTML = `
            <img class="history-thumbnail" src="${item.thumbnail}" alt="${item.title}" loading="lazy">
            <div class="history-info">
                <div class="history-title">${item.title}</div>
                <div class="history-meta">
                    <span class="history-channel">${item.channel}</span>
                    <span class="history-date">${dateStr}</span>
                </div>
            </div>
            <button class="history-download-btn" title="Descargar de nuevo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </button>
        `;

        // Re-download button click
        const downloadBtn = div.querySelector('.history-download-btn');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            urlInput.value = item.url;
            downloadFromUrl(item.url);
        });

        // Click on item to fill URL
        div.addEventListener('click', () => {
            urlInput.value = item.url;
            urlInput.focus();
        });

        historyList.appendChild(div);
    });
}

function toggleHistory() {
    historyToggle.classList.toggle('open');
    historyContent.classList.toggle('hidden');
}

// History event listeners
if (historyToggle) historyToggle.addEventListener('click', toggleHistory);
if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearHistory);

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
let ytPlayerReady = false;
let currentPreviewId = null;
let currentThumbnailWrapper = null;

// Called automatically by YouTube IFrame API when ready
function onYouTubeIframeAPIReady() {
    console.log('YouTube IFrame API loaded, creating player...');
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
            onReady: onPlayerReady,
            onStateChange: onPlayerStateChange,
            onError: onPlayerError
        }
    });
}

function onPlayerReady(event) {
    console.log('YouTube Player is ready!');
    ytPlayerReady = true;
}

function onPlayerError(event) {
    console.error('YouTube Player error:', event.data);
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
    console.log('togglePreview called with videoId:', videoId);

    if (!ytPlayerReady || !ytPlayer || !ytPlayer.loadVideoById) {
        console.warn('YouTube player not ready yet. ytPlayerReady:', ytPlayerReady);
        showStatus('Espera un momento, el reproductor se está cargando...', 'info');
        return;
    }

    if (!videoId) {
        console.error('No video ID provided');
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
    renderHistory();
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
