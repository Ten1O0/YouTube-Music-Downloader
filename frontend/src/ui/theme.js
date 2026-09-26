/**
 * Tema claro u oscuro.
 */

export const themeToggle = document.getElementById('themeToggle');

// ========================================
// Theme Toggle
// ========================================
function getPreferredTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) return savedTheme;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
}

export function toggleTheme() {
    const currentTheme = document.documentElement.dataset.theme || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

export function initTheme() {
    const theme = getPreferredTheme();
    setTheme(theme);
}

export function enlazarBotonTema() {
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
}
