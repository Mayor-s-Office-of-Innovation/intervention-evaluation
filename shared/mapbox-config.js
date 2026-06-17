// Mapbox GL JS configuration — token and styles shared across all maps.
// The token is read from window.MAPBOX_TOKEN, which should be set in each
// HTML file's <head> before loading the map scripts.

export const MAPBOX_TOKEN = window.MAPBOX_TOKEN || '';
export const STYLE_LIGHT = 'mapbox://styles/mapbox/light-v11';
export const STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';

export const isDark = () => document.documentElement.classList.contains('wa-dark');
export const getStyle = () => (isDark() ? STYLE_DARK : STYLE_LIGHT);
