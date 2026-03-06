// Configuración centralizada de la API
export const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3005'
    : `http://${window.location.hostname}:3200`;
