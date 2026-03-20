import fetch from 'node-fetch';

async function checkApi() {
    try {
        const response = await fetch('http://localhost:3005/api/empleados-archivados');
        const data = await response.json();
        if (data.length > 0) {
            console.log('Sample record (first):', {
                nombre: data[0].nombre,
                tabla: data[0].tabla
            });
            console.log('Sample record (last):', {
                nombre: data[data.length - 1].nombre,
                tabla: data[data.length - 1].tabla
            });
        }
        console.log('Total records:', data.length);
        console.log('Has tabla field in ALL records:', data.every(emp => emp.tabla !== undefined));
        process.exit(0);
    } catch (err) {
        console.error('Error fetching API:', err.message);
        process.exit(1);
    }
}

checkApi();
