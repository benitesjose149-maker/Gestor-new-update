import http from 'http';

const data = JSON.stringify({
    periodo: '2026-03',
    mes: 'marzo',
    año: 2026,
    empleados: [{
        empleadoId: 'someId',
        nombre: 'Juan',
        apellidos: 'Perez',
        cargo: 'Ventas',
        tipoTrabajador: 'PLANILLA',
        sueldo: 1500,
        bonos: 200,
        montoHorasExtras: 50,
        descuentoAfp: 150,
        adelanto: 0,
        prestamo: 0,
        montoFaltas: 0,
        descuentoAdicional: 0,
        totalDescuento: 150,
        remuneracionNeta: 1600
    }]
});

const options = {
    hostname: 'localhost',
    port: 3005,
    path: '/api/historial-pago',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
    }
};

const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => { responseData += chunk; });
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Response:', responseData);
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();
