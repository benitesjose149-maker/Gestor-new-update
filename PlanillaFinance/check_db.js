const mssql = require('mssql');
require('dotenv').config({ path: '../backend/.env' });

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

async function checkUsers() {
    try {
        let pool = await mssql.connect(config);
        let result = await pool.request().query('SELECT ID_USERS, EMAIL, FULL_NAME, ROL, CAN_PLANILLA, CAN_MOVIMIENTOS, CAN_FINANZAS, CAN_EMPLEADOS, CAN_ARCHIVADOS, CAN_DASHBOARD, CAN_HISTORIAL, CAN_VACACIONES, CAN_ASISTENCIA FROM USERS');
        console.log(JSON.stringify(result.recordset, null, 2));
        await mssql.close();
    } catch (err) {
        console.error(err);
    }
}

checkUsers();
