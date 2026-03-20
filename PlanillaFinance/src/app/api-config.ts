// Configuración centralizada de la API
export const API_URL = window.location.hostname === 'localhost'
    ? 'http://15.235.16.229:7080'
    : `http://${window.location.hostname}:7080`;

// Función para obtener headers con la Llave Maestra
export const getAuthHeaders = (extraHeaders = {}) => {
    const masterKey = localStorage.getItem('hwperu_master_key') || '';
    return {
        'Content-Type': 'application/json',
        'x-hwperu-key': masterKey,
        ...extraHeaders
    };
};
