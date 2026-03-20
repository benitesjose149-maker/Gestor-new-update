const MASTER_KEY = 'hw-peru-2025-seguro';
const ALLOWED_IPS = [
    '38.253.148.143', // Tu IP Pública
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.2',
    '10.0.0.2',
    '15.235.16.229',
    '::ffff:15.235.16.229'
];

export const ipFilter = (req, res, next) => {
    try {
        if (req.method === 'OPTIONS') {
            return next();
        }

        const forwarded = req.headers['x-forwarded-for'];
        let clientIp = req.ip || 
                       (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : forwarded) || 
                       req.socket.remoteAddress;

        // Limpiar prefijo IPv6 de IPv4 mapeada si es necesario
        if (clientIp.startsWith('::ffff:')) {
            const cleanIp = clientIp.replace('::ffff:', '');
            // Si la IP limpia está en la lista o la original está en la lista
            if (ALLOWED_IPS.includes(cleanIp) || ALLOWED_IPS.includes(clientIp)) {
                return next();
            }
        }

        const accessKey = req.headers['x-hwperu-key'] || req.query.key;

        if (req.originalUrl === '/api/debug-ip') {
            return next();
        }

        const isAuthorized =
            accessKey === MASTER_KEY ||
            ALLOWED_IPS.includes(clientIp);

        if (isAuthorized) {
            return next();
        }

        console.log(`--- ACCESO DENEGADO --- 
            IP detectada: ${clientIp}
            IP (req.ip): ${req.ip}
            X-Forwarded-For: ${forwarded}
            RemoteAddress: ${req.socket.remoteAddress}
            Llave: ${accessKey ? 'SI' : 'NO'} 
            URL: ${req.originalUrl}`);

        if (req.originalUrl.startsWith('/api/')) {
            return res.status(403).json({
                success: false,
                message: 'ACCESO_DENEGADO_IP_RESTRINGIDA',
                detectedIp: clientIp
            });
        }

        res.status(403).send(`
            <div style="text-align:center; padding: 50px; font-family: sans-serif; background-color: #f8fafc; height: 100vh;">
                <h1>🚫 Acceso No Autorizado</h1>
                <p>Tu IP (${clientIp}) no está en la lista blanca.</p>
            </div>
        `);
    } catch (error) {
        console.error('IP_FILTER_ERROR:', error);
        next();
    }
};

export default ipFilter;
