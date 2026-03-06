
import https from 'https';
import { Buffer } from 'buffer';

async function consultarApiPeruDev(dni) {
    try {
        const token = process.env.APIPERUDEV_TOKEN || 'N1DvhA0R9U1rssITvTVU6rM95RjnELBqii07Cayuw0ekRsKL9e';
        const url = 'https://apiperu.dev/api/dni';

        const postData = JSON.stringify({ dni: dni });
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });

                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        if (res.statusCode === 200 && jsonData.success && jsonData.data) {
                            resolve({
                                nombres: jsonData.data.nombres || '',
                                apellidoPaterno: jsonData.data.apellido_paterno || '',
                                apellidoMaterno: jsonData.data.apellido_materno || '',
                                dni: jsonData.data.numero || dni,
                                direccion: jsonData.data.direccion || '',
                                nombreCompleto: jsonData.data.nombre_completo || ''
                            });
                        } else {
                            resolve(null);
                        }
                    } catch (error) { resolve(null); }
                });
            });
            req.on('error', (err) => { resolve(null); });
            req.write(postData);
            req.end();
        });
    } catch (error) { return null; }
}

async function consultarRENIEC(dni) {
    try {
        const token = process.env.APIS_NET_PE_TOKEN || 'sk_10323.yxUjIJ95w9Eit4g0OWr19fNjQ74ypeAT';
        const url = `https://api.apis.net.pe/v1/dni?numero=${dni}`;

        const options = {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        };

        return new Promise((resolve, reject) => {
            https.get(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });

                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        if (res.statusCode === 200 && jsonData) {
                            resolve({
                                nombres: jsonData.nombres || '',
                                apellidoPaterno: jsonData.apellidoPaterno || '',
                                apellidoMaterno: jsonData.apellidoMaterno || '',
                                dni: jsonData.numeroDocumento || dni,
                                direccion: jsonData.direccion || '',
                                nombreCompleto: `${jsonData.nombres} ${jsonData.apellidoPaterno} ${jsonData.apellidoMaterno}`.trim()
                            });
                        } else {
                            resolve(null);
                        }
                    } catch (error) { resolve(null); }
                });
            }).on('error', (err) => { resolve(null); });
        });
    } catch (error) { return null; }
}

export const getDni = async (req, res) => {
    try {
        const { dni } = req.params;

        console.log(`Buscando DNI: ${dni}...`);

        console.log('Intentando con ApiPeruDev...');
        let data = await consultarApiPeruDev(dni);

        if (!data) {
            console.log('ApiPeruDev falló o no encontró datos. Intentando con RENIEC fallback...');
            data = await consultarRENIEC(dni);
        }

        if (data) {
            console.log('Datos encontrados:', data);
            res.json(data);
        } else {
            console.log('No se encontraron datos en ninguna API.');
            res.status(404).json({ error: 'No se encontraron datos para este DNI' });
        }
    } catch (error) {
        console.error('Error en controlador DNI:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};
