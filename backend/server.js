import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import cron from 'node-cron';
import { poolPlanilla, poolFinance } from './config/dbSql.js';
import mssql from 'mssql';
import path from 'path';
import { fileURLToPath } from 'url';
import { ipFilter } from './utils/ipFilter.js';
import dniRoutes from './routes/dniRoutes.js';
import gmailRoutes from './integrations/gmailRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', true);

const corsOptions = {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization', 'x-hwperu-key'],
    credentials: true
};
app.use(cors(corsOptions));

const port = 3005;

app.use(express.json());

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - IP: ${req.ip}`);
    next();
});

const distPath = path.join(__dirname, 'public');
app.use(express.static(distPath));


app.get('/api/debug-ip', (req, res) => {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    res.json({
        detectedIp: clientIp,
        forwardedFor: req.headers['x-forwarded-for'],
        remoteAddress: req.socket.remoteAddress
    });
});

app.use('/api/reniec', dniRoutes);
app.use('/api', gmailRoutes);

app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const now = new Date();
        const currentMonth = now.getMonth() + 1;

        const payrollRes = await pool.request()
            .query('SELECT SUM(SUELDO_BASE) as total, COUNT(*) as count FROM EMPLOYEES WHERE ACTIVO = 1 OR ACTIVO IS NULL');

        const totalPayroll = payrollRes.recordset[0].total || 0;
        const activeCount = payrollRes.recordset[0].count || 0;

        const birthdayRes = await pool.request()
            .input('month', mssql.Int, currentMonth)
            .query('SELECT NOMBRE, APELLIDOS, FECHA_NACIMIENTO FROM EMPLOYEES WHERE MONTH(FECHA_NACIMIENTO) = @month AND (ACTIVO = 1 OR ACTIVO IS NULL)');

        const birthdays = birthdayRes.recordset.map(emp => ({
            name: `${emp.NOMBRE} ${emp.APELLIDOS}`,
            date: emp.FECHA_NACIMIENTO ? new Date(emp.FECHA_NACIMIENTO).toLocaleDateString('es-ES', { day: '2-digit', month: 'long' }) : 'N/A'
        }));

        const expiryRes = await pool.request()
            .query(`
                SELECT NOMBRE, APELLIDOS, FECHA_FIN_CONTRATO 
                FROM EMPLOYEES 
                WHERE FECHA_FIN_CONTRATO >= GETDATE() 
                AND FECHA_FIN_CONTRATO <= DATEADD(day, 30, GETDATE())
                AND (ACTIVO = 1 OR ACTIVO IS NULL)
            `);

        const contractExpirations = expiryRes.recordset.map(emp => ({
            name: `${emp.NOMBRE} ${emp.APELLIDOS}`,
            expiryDate: new Date(emp.FECHA_FIN_CONTRATO).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
        }));

        res.json({
            stats: [
                { title: 'Total Empleados', value: activeCount.toString(), change: 'Activos actualmente', icon: '👥', color: 'blue' },
                { title: 'Nómina Total (Base)', value: `S/ ${totalPayroll.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`, change: 'Inversión mensual', icon: '💰', color: 'green' },
                { title: 'Vencimientos 30d', value: contractExpirations.length.toString(), change: 'Contratos por vencer', icon: '⚠️', color: 'orange' }
            ],
            birthdays: birthdays,
            contractExpirations: contractExpirations
        });
    } catch (error) {
        console.error('Error al obtener dashboard stats:', error);
        res.status(500).json({ error: 'Error interno al cargar estadísticas' });
    }
});

let lastSyncTime = null;
const SYNC_COOLDOWN = 5 * 60 * 1000;
let cachedThisMonthPaid = 0;
let cachedThisMonthTotalGross = 0;

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const pool = await poolPlanilla;

        const checkBlockRes = await pool.request()
            .input('email', mssql.VarChar, email)
            .input('ip', mssql.VarChar, ip)
            .query(`
                SELECT COUNT(*) as attempts 
                FROM LOGIN_ATTEMPTS 
                WHERE EMAIL = @email AND IP_ADDRESS = @ip 
                AND SUCCESS = 0 
                AND ATTEMPT_TIME > DATEADD(minute, -30, GETDATE())
            `);

        if (checkBlockRes.recordset[0].attempts >= 3) {
            return res.status(429).json({
                success: false,
                message: 'Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intente de nuevo en 30 minutos o contacte al administrador.'
            });
        }

        const result = await pool.request()
            .input('email', mssql.VarChar, email)
            .input('password', mssql.VarChar, password)
            .query('SELECT * FROM USERS WHERE EMAIL = @email AND PASSWORD = @password');

        const success = result.recordset.length > 0;

        await pool.request()
            .input('email', mssql.VarChar, email)
            .input('ip', mssql.VarChar, ip)
            .input('success', mssql.Bit, success ? 1 : 0)
            .query('INSERT INTO LOGIN_ATTEMPTS (EMAIL, IP_ADDRESS, SUCCESS) VALUES (@email, @ip, @success)');

        if (success) {
            const user = result.recordset[0];

            await pool.request()
                .input('email', mssql.VarChar, email)
                .input('ip', mssql.VarChar, ip)
                .query('DELETE FROM LOGIN_ATTEMPTS WHERE EMAIL = @email AND IP_ADDRESS = @ip AND SUCCESS = 0');

            res.json({
                success: true,
                message: 'Login exitoso',
                user: {
                    email: user.EMAIL,
                    fullName: user.FULL_NAME,
                    rol: user.ROL,
                    permissions: {
                        planilla: !!user.CAN_PLANILLA || user.ROL === 'SUPER_ADMIN',
                        movimientos: !!user.CAN_MOVIMIENTOS || user.ROL === 'SUPER_ADMIN',
                        finanzas: !!user.CAN_FINANZAS || user.ROL === 'SUPER_ADMIN',
                        empleados: !!user.CAN_EMPLEADOS || user.ROL === 'SUPER_ADMIN',
                        archivados: !!user.CAN_ARCHIVADOS || user.ROL === 'SUPER_ADMIN'
                    }
                }
            });
        } else {
            res.status(401).json({ success: false, message: 'Credenciales inválidas' });
        }
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
});

app.get('/api/admin/security/blocked', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query(`
            SELECT EMAIL, IP_ADDRESS, COUNT(*) as Fails, MAX(ATTEMPT_TIME) as LastAttempt
            FROM LOGIN_ATTEMPTS
            WHERE SUCCESS = 0 AND ATTEMPT_TIME > DATEADD(minute, -30, GETDATE())
            GROUP BY EMAIL, IP_ADDRESS
            HAVING COUNT(*) >= 3
        `);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener bloqueos' });
    }
});

app.post('/api/admin/security/unblock', async (req, res) => {
    try {
        const { email, ip } = req.body;
        const pool = await poolPlanilla;
        await pool.request()
            .input('email', mssql.VarChar, email)
            .input('ip', mssql.VarChar, ip)
            .query('DELETE FROM LOGIN_ATTEMPTS WHERE EMAIL = @email AND IP_ADDRESS = @ip');
        res.json({ success: true, message: 'Usuario desbloqueado correctamente' });
    } catch (error) {
        console.error('Error al desbloquear:', error);
        res.status(500).json({ success: false, message: 'Error al desbloquear: ' + error.message });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query('SELECT ID_USERS, EMAIL, FULL_NAME, ROL, CAN_PLANILLA, CAN_MOVIMIENTOS, CAN_FINANZAS, CAN_EMPLEADOS, CAN_ARCHIVADOS FROM USERS');
        res.json(result.recordset);
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ success: false, message: 'Error al obtener usuarios: ' + error.message });
    }
});

app.post('/api/admin/update-permissions', async (req, res) => {
    try {
        const { id, full_name, can_planilla, can_movimientos, can_finanzas, can_empleados, can_archivados } = req.body;
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, id)
            .input('name', mssql.VarChar, full_name)
            .input('p1', mssql.Bit, can_planilla ? 1 : 0)
            .input('p2', mssql.Bit, can_movimientos ? 1 : 0)
            .input('p3', mssql.Bit, can_finanzas ? 1 : 0)
            .input('p4', mssql.Bit, can_empleados ? 1 : 0)
            .input('p5', mssql.Bit, can_archivados ? 1 : 0)
            .query('UPDATE USERS SET FULL_NAME = @name, CAN_PLANILLA = @p1, CAN_MOVIMIENTOS = @p2, CAN_FINANZAS = @p3, CAN_EMPLEADOS = @p4, CAN_ARCHIVADOS = @p5 WHERE ID_USERS = @id');

        res.json({ success: true, message: 'Permisos actualizados correctamente' });
    } catch (error) {
        console.error('Error al actualizar permisos:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar permisos: ' + error.message });
    }
});

app.post('/api/admin/create-user', async (req, res) => {
    console.log('Recibida petición de creación de usuario:', req.body);
    try {
        const { email, password, full_name, role, permissions = {} } = req.body;
        const pool = await poolPlanilla;

        const checkUser = await pool.request()
            .input('email', mssql.VarChar, email)
            .query('SELECT ID_USERS FROM USERS WHERE EMAIL = @email');

        if (checkUser.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'El usuario ya existe' });
        }

        await pool.request()
            .input('email', mssql.VarChar, email)
            .input('pass', mssql.VarChar, password)
            .input('name', mssql.VarChar, full_name)
            .input('role', mssql.VarChar, role || 'ADMIN')
            .input('p1', mssql.Bit, permissions.planilla ? 1 : 0)
            .input('p2', mssql.Bit, permissions.movimientos ? 1 : 0)
            .input('p3', mssql.Bit, permissions.finanzas ? 1 : 0)
            .input('p4', mssql.Bit, permissions.empleados ? 1 : 0)
            .input('p5', mssql.Bit, permissions.archivados ? 1 : 0)
            .query(`
                INSERT INTO USERS (EMAIL, PASSWORD, FULL_NAME, ROL, CAN_PLANILLA, CAN_MOVIMIENTOS, CAN_FINANZAS, CAN_EMPLEADOS, CAN_ARCHIVADOS)
                VALUES (@email, @pass, @name, @role, @p1, @p2, @p3, @p4, @p5)
            `);

        res.json({ success: true, message: 'Usuario creado correctamente' });
    } catch (error) {
        console.error('Error al crear usuario:', error);
        res.status(500).json({ success: false, message: 'Error al crear usuario: ' + error.message });
    }
});

app.get('/api/empleados', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query('SELECT * FROM EMPLOYEES WHERE ACTIVO = 1 OR ACTIVO IS NULL');
        const empleados = result.recordset.map(emp => ({
            _id: emp.ID_EMPLOYEE,
            id: emp.ID_EMPLOYEE,
            nombre: emp.NOMBRE,
            apellidos: emp.APELLIDOS,
            dni: emp.DNI,
            sexo: emp.GENERO,
            nacionalidad: emp.NACIONALIDAD,
            telefono: emp.TELEFONO,
            contactoEmergencia: emp.NOMBRE_CONTACTO,
            numeroEmergencia: emp.NUMERO_EMERGENCIA,
            fechaNacimiento: emp.FECHA_NACIMIENTO,
            direccion: emp.DIRECCION,
            cargo: emp.CARGO,
            departamento: emp.DEPARTAMENTO,
            tipoTrabajador: emp.TIPO_TRABAJADOR,
            regimenPensionario: emp.ENTIDAD_PREVISIONAL,
            sueldo: emp.SUELDO_BASE,
            calculoAfpMinimo: !!emp.DESCUENTO_AFP_MINIMO,
            fechaInicio: emp.FECHA_INGRESO,
            fechaFinContrato: emp.FECHA_FIN_CONTRATO,
            horarioTrabajo: emp.JORNADA_LABORAL,
            banco: emp.BANCO,
            tipoCuenta: emp.TIPO_CUENTA,
            numeroCuenta: emp.NUMERO_CUENTA,
            cci: emp.CCI,
            email: emp.CORREO,
            estado: 'Activo'
        }));
        res.json(empleados);
    } catch (error) {
        console.error('Error al obtener empleados de SQL:', error);
        res.status(500).json({ error: 'Error al obtener empleados' });
    }
});

app.get('/api/empleados-archivados', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query("SELECT * FROM EMPLOYEES WHERE ACTIVO = 0 AND CAST(ID_EMPLOYEE AS NVARCHAR(50)) NOT IN (SELECT EmpleadoOriginalId FROM EMPLEADOS_ARCHIVADOS WHERE EmpleadoOriginalId IS NOT NULL)");
        const empleados = result.recordset.map(emp => ({
            _id: emp.ID_EMPLOYEE,
            id: emp.ID_EMPLOYEE,
            nombre: emp.NOMBRE,
            apellidos: emp.APELLIDOS,
            dni: emp.DNI,
            sexo: emp.GENERO,
            nacionalidad: emp.NACIONALIDAD,
            telefono: emp.TELEFONO,
            contactoEmergencia: emp.NOMBRE_CONTACTO,
            numeroEmergencia: emp.NUMERO_EMERGENCIA,
            fechaNacimiento: emp.FECHA_NACIMIENTO,
            direccion: emp.DIRECCION,
            cargo: emp.CARGO,
            departamento: emp.DEPARTAMENTO,
            tipoTrabajador: emp.TIPO_TRABAJADOR,
            regimenPensionario: emp.ENTIDAD_PREVISIONAL,
            sueldo: emp.SUELDO_BASE,
            calculoAfpMinimo: !!emp.DESCUENTO_AFP_MINIMO,
            fechaInicio: emp.FECHA_INGRESO,
            fechaFinContrato: emp.FECHA_FIN_CONTRATO,
            horarioTrabajo: emp.JORNADA_LABORAL,
            banco: emp.BANCO,
            tipoCuenta: emp.TIPO_CUENTA,
            numeroCuenta: emp.NUMERO_CUENTA,
            cci: emp.CCI,
            email: emp.CORREO,
            estado: 'Inactivo',
            tabla: 'EMPLOYEES'
        }));

        const resultArchived = await pool.request().query('SELECT * FROM EMPLEADOS_ARCHIVADOS');
        const historicosMongo = resultArchived.recordset.map(emp => ({
            _id: emp.MongoId || emp.Id,
            id: emp.Id,
            nombre: emp.Nombre,
            apellidos: emp.Apellido,
            dni: (emp.DNI === '-' ? null : emp.DNI) || null,
            sexo: (emp.GENERO === '-' ? null : emp.GENERO) || null,
            nacionalidad: (emp.NACIONALIDAD === '-' ? null : emp.NACIONALIDAD) || null,
            telefono: (emp.Telefono === '-' ? null : emp.Telefono) || null,
            contactoEmergencia: (emp.NOMBRE_CONTACTO === '-' ? null : emp.NOMBRE_CONTACTO) || null,
            numeroEmergencia: (emp.NUMERO_EMERGENCIA === '-' ? null : emp.NUMERO_EMERGENCIA) || null,
            fechaNacimiento: (emp.FECHA_NACIMIENTO === '-' ? null : emp.FECHA_NACIMIENTO) || null,
            direccion: (emp.DIRECCION === '-' ? null : emp.DIRECCION) || null,
            cargo: emp.Cargo,
            departamento: emp.Departamento,
            tipoTrabajador: emp.Tipo,
            regimenPensionario: (emp.ENTIDAD_PREVISIONAL === '-' ? null : emp.ENTIDAD_PREVISIONAL) || null,
            sueldo: emp.Sueldo,
            calculoAfpMinimo: !!emp.DESCUENTO_AFP_MINIMO,
            fechaInicio: (emp.FECHA_INGRESO === '-' ? null : emp.FECHA_INGRESO) || null,
            fechaFinContrato: emp.FechaArchivado,
            horarioTrabajo: (emp.JORNADA_LABORAL === '-' ? null : emp.JORNADA_LABORAL) || null,
            banco: (emp.BANCO === '-' ? null : emp.BANCO) || null,
            tipoCuenta: (emp.TIPO_CUENTA === '-' ? null : emp.TIPO_CUENTA) || null,
            numeroCuenta: (emp.NUMERO_CUENTA === '-' ? null : emp.NUMERO_CUENTA) || null,
            cci: (emp.CCI === '-' ? null : emp.CCI) || null,
            email: (emp.Correo === '-' ? null : emp.Correo) || null,
            estado: 'Inactivo (Histórico)',
            motivo: emp.Motivo,
            tabla: 'EMPLEADOS_ARCHIVADOS'
        }));

        const allArchived = [...empleados, ...historicosMongo];

        allArchived.sort((a, b) => {
            const dateA = a.fechaFinContrato ? new Date(a.fechaFinContrato).getTime() : 0;
            const dateB = b.fechaFinContrato ? new Date(b.fechaFinContrato).getTime() : 0;
            return dateB - dateA;
        });

        res.json(allArchived);
    } catch (error) {
        console.error('Error al obtener empleados archivados de SQL:', error);
        res.status(500).json({ error: 'Error al obtener empleados archivados' });
    }
});

app.delete('/api/empleados-archivados/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { tabla } = req.query;
        const pool = await poolPlanilla;

        if (tabla === 'EMPLOYEES') {
            await pool.request()
                .input('id', mssql.Int, id)
                .query('DELETE FROM EMPLOYEES WHERE ID_EMPLOYEE = @id');
        } else if (tabla === 'EMPLEADOS_ARCHIVADOS') {
            await pool.request()
                .input('id', mssql.Int, id)
                .query('DELETE FROM EMPLEADOS_ARCHIVADOS WHERE Id = @id');
        } else {
            return res.status(400).json({ error: 'Tabla no válida especificada' });
        }

        res.json({ message: 'Empleado eliminado permanentemente' });
    } catch (error) {
        console.error('Error al eliminar empleado permanentemente:', error);
        res.status(500).json({ error: 'Error al eliminar empleado' });
    }
});

app.post('/api/empleados', async (req, res) => {
    try {
        console.log('Recibiendo solicitud de registro:', req.body);
        const pool = await poolPlanilla;
        const data = req.body;

        const checkDni = await pool.request()
            .input('dni', mssql.VarChar(8), data.dni)
            .query('SELECT NOMBRE FROM EMPLOYEES WHERE DNI = @dni');

        if (checkDni.recordset.length > 0) {
            console.log('Error: El DNI ya existe:', data.dni);
            return res.status(400).json({ error: 'El empleado con este DNI ya está registrado.' });
        }

        const request = pool.request();
        request.input('nombre', mssql.VarChar(100), data.nombre);
        request.input('apellidos', mssql.VarChar(100), data.apellidos);
        request.input('dni', mssql.VarChar(20), data.dni);
        request.input('genero', mssql.VarChar(50), data.sexo || null);
        request.input('nac', mssql.VarChar(100), data.nacionalidad || null);
        request.input('tel', mssql.VarChar(50), data.telefono || null);
        request.input('nomCont', mssql.VarChar(200), data.contactoEmergencia || null);
        request.input('numEmerg', mssql.VarChar(50), data.numeroEmergencia || null);
        request.input('fechaNac', mssql.Date, data.fechaNacimiento ? new Date(data.fechaNacimiento) : null);
        request.input('dir', mssql.VarChar(255), data.direccion || null);
        request.input('cargo', mssql.VarChar(100), data.cargo || null);
        request.input('dept', mssql.VarChar(100), data.departamento || null);
        request.input('tipo', mssql.VarChar(50), data.tipoTrabajador || 'PLANILLA');
        request.input('sueldo', mssql.Decimal(10, 2), data.sueldo || 0);
        request.input('entPrevis', mssql.VarChar(100), data.regimenPensionario || 'SNP/ONP');
        request.input('descAfpMin', mssql.Bit, data.calculoAfpMinimo ? 1 : 0);
        request.input('jorLab', mssql.VarChar(100), data.horarioTrabajo || null);
        request.input('fechaIng', mssql.Date, data.fechaInicio ? new Date(data.fechaInicio) : null);
        request.input('fechaFin', mssql.Date, data.fechaFinContrato ? new Date(data.fechaFinContrato) : null);
        request.input('correo', mssql.VarChar(150), data.email || null);
        request.input('banco', mssql.VarChar(100), data.banco || null);
        request.input('tipoCta', mssql.VarChar(50), data.tipoCuenta || null);
        request.input('numCta', mssql.VarChar(50), data.numeroCuenta || null);
        request.input('cci', mssql.VarChar(50), data.cci || null);
        request.input('activo', mssql.Bit, 1);

        const query = `
            INSERT INTO EMPLOYEES (
                NOMBRE, APELLIDOS, DNI, GENERO, NACIONALIDAD, TELEFONO, NOMBRE_CONTACTO, 
                NUMERO_EMERGENCIA, FECHA_NACIMIENTO, DIRECCION, CARGO, DEPARTAMENTO, 
                TIPO_TRABAJADOR, SUELDO_BASE, ENTIDAD_PREVISIONAL, DESCUENTO_AFP_MINIMO,
                JORNADA_LABORAL, FECHA_INGRESO, FECHA_FIN_CONTRATO, CORREO, BANCO, 
                TIPO_CUENTA, NUMERO_CUENTA, CCI, ACTIVO
            )
            OUTPUT INSERTED.*
            VALUES (
                @nombre, @apellidos, @dni, @genero, @nac, @tel, @nomCont, 
                @numEmerg, @fechaNac, @dir, @cargo, @dept, @tipo, @sueldo, @entPrevis,
                @descAfpMin, @jorLab, @fechaIng, @fechaFin, @correo, @banco, @tipoCta, @numCta, @cci, @activo
            )
        `;

        const result = await request.query(query);
        const saved = result.recordset[0];
        console.log('Empleado guardado exitosamente:', saved.ID_EMPLOYEE);
        res.status(201).json({
            _id: saved.ID_EMPLOYEE,
            ...saved
        });
    } catch (error) {
        console.error('--- ERROR DETALLADO DE SQL ---');
        console.error('Mensaje:', error.message);
        console.error('Código:', error.code);
        if (error.originalError) console.error('Original:', error.originalError.message);
        res.status(500).json({ error: 'Error al guardar empleado', details: error.message });
    }
});

app.put('/api/empleados/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPlanilla;
        const data = req.body;

        const request = pool.request();
        request.input('id', mssql.Int, id);
        request.input('nombre', mssql.VarChar(100), data.nombre);
        request.input('apellidos', mssql.VarChar(100), data.apellidos);
        request.input('dni', mssql.VarChar(20), data.dni);
        request.input('genero', mssql.VarChar(50), data.sexo || null);
        request.input('nac', mssql.VarChar(100), data.nacionalidad || null);
        request.input('tel', mssql.VarChar(50), data.telefono || null);
        request.input('nomCont', mssql.VarChar(200), data.contactoEmergencia || null);
        request.input('numEmerg', mssql.VarChar(50), data.numeroEmergencia || null);
        request.input('fechaNac', mssql.Date, data.fechaNacimiento ? new Date(data.fechaNacimiento) : null);
        request.input('dir', mssql.VarChar(255), data.direccion || null);
        request.input('cargo', mssql.VarChar(100), data.cargo || null);
        request.input('dept', mssql.VarChar(100), data.departamento || null);
        request.input('tipo', mssql.VarChar(50), data.tipoTrabajador || 'PLANILLA');
        request.input('sueldo', mssql.Decimal(10, 2), data.sueldo || 0);
        request.input('entPrevis', mssql.VarChar(100), data.regimenPensionario || 'SNP');
        request.input('descAfpMin', mssql.Bit, data.calculoAfpMinimo ? 1 : 0);
        request.input('jorLab', mssql.VarChar(100), data.horarioTrabajo || null);
        request.input('fechaIng', mssql.Date, data.fechaInicio ? new Date(data.fechaInicio) : null);
        request.input('fechaFin', mssql.Date, data.fechaFinContrato ? new Date(data.fechaFinContrato) : null);
        request.input('correo', mssql.VarChar(150), data.email || null);
        request.input('banco', mssql.VarChar(100), data.banco || null);
        request.input('tipoCta', mssql.VarChar(50), data.tipoCuenta || null);
        request.input('numCta', mssql.VarChar(50), data.numeroCuenta || null);
        request.input('cci', mssql.VarChar(50), data.cci || null);

        await request.query(`
            UPDATE EMPLOYEES 
            SET NOMBRE = @nombre, APELLIDOS = @apellidos, DNI = @dni, GENERO = @genero, 
                NACIONALIDAD = @nac, TELEFONO = @tel, NOMBRE_CONTACTO = @nomCont,
                NUMERO_EMERGENCIA = @numEmerg, FECHA_NACIMIENTO = @fechaNac, DIRECCION = @dir,
                CARGO = @cargo, DEPARTAMENTO = @dept, TIPO_TRABAJADOR = @tipo, 
                SUELDO_BASE = @sueldo, ENTIDAD_PREVISIONAL = @entPrevis,
                DESCUENTO_AFP_MINIMO = @descAfpMin, JORNADA_LABORAL = @jorLab,
                FECHA_INGRESO = @fechaIng, FECHA_FIN_CONTRATO = @fechaFin, 
                CORREO = @correo, BANCO = @banco, TIPO_CUENTA = @tipoCta, 
                NUMERO_CUENTA = @numCta, CCI = @cci
            WHERE ID_EMPLOYEE = @id
        `);
        res.json({ message: 'Empleado actualizado correctamente' });
    } catch (error) {
        console.error('Error al actualizar empleado:', error);
        res.status(500).json({ error: 'Error al actualizar empleado' });
    }
});

app.get('/api/planilla-borrador', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const now = new Date();
        const currentMes = (now.getMonth() + 1).toString().padStart(2, '0');
        const currentAnio = now.getFullYear();

        const result = await pool.request()
            .input('mes', mssql.VarChar, currentMes)
            .input('anio', mssql.Int, currentAnio)
            .query(`
            SELECT e.*, 
                   ISNULL(pb.HORAS_EXTRAS, 0) as HORAS_EXTRAS,
                   ISNULL(pb.FALTAS_DIAS, 0) as FALTAS_DIAS,
                   ISNULL(pb.FALTAS_HORAS, 0) as FALTAS_HORAS,
                   ISNULL(pb.DESCUENTO_ADICIONAL, 0) as DESCUENTO_ADICIONAL,
                   pb.DESCUENTOS_JSON,
                   pb.BONOS_JSON,
                   pb.OBSERVACIONES as BORRADOR_OBSERVACIONES,
                   (SELECT ISNULL(SUM(Monto), 0) FROM ADVANCES 
                    WHERE CAST(EmpleadoNumId AS VARCHAR) = e.DNI 
                    AND Tipo = 'ADELANTO' AND Mes = @mes AND Anio = @anio) as TOTAL_ADELANTO,
                   (SELECT ISNULL(SUM(Monto), 0) FROM ADVANCES 
                    WHERE CAST(EmpleadoNumId AS VARCHAR) = e.DNI 
                    AND Tipo = 'PRESTAMO' AND Mes = @mes AND Anio = @anio) as TOTAL_PRESTAMO,
                    (SELECT TOP 1 CAST(NumeroAdelanto AS VARCHAR) + '/' + ISNULL(CAST(TotalCuotas AS VARCHAR), '?') 
                     FROM ADVANCES 
                     WHERE CAST(EmpleadoNumId AS VARCHAR) = e.DNI 
                     AND Tipo = 'PRESTAMO' AND Mes = @mes AND Anio = @anio
                     ORDER BY CreatedAt DESC) as CUOTA_DETALLE,
                   ISNULL(pb.ESTADO, 'PENDIENTE') as ESTADO
            FROM EMPLOYEES e
            LEFT JOIN PLANILLA_BORRADOR pb ON e.ID_EMPLOYEE = pb.ID_EMPLOYEE
            WHERE e.ACTIVO = 1 OR e.ACTIVO IS NULL
        `);

        const empleados = result.recordset.map(emp => {
            let descuentosAdicionales = [];
            try {
                if (emp.DESCUENTOS_JSON) descuentosAdicionales = JSON.parse(emp.DESCUENTOS_JSON);
            } catch (e) { }

            let bonosDetalle = [];
            try {
                if (emp.BONOS_JSON) bonosDetalle = JSON.parse(emp.BONOS_JSON);
            } catch (e) { }

            return {
                _id: emp.ID_EMPLOYEE,
                id: emp.ID_EMPLOYEE,
                nombre: emp.NOMBRE,
                apellidos: emp.APELLIDOS,
                cargo: emp.CARGO,
                tipoTrabajador: emp.TIPO_TRABAJADOR,
                regimenPensionario: emp.ENTIDAD_PREVISIONAL,
                sueldo: emp.SUELDO_BASE,
                calculoAfpMinimo: !!emp.DESCUENTO_AFP_MINIMO,
                estado: 'Activo',
                adelanto: emp.TOTAL_ADELANTO || 0,
                prestamo: emp.TOTAL_PRESTAMO || 0,
                faltasDias: emp.FALTAS_DIAS,
                faltasHoras: emp.FALTAS_HORAS,
                descuentoAdicional: emp.DESCUENTO_ADICIONAL,
                descuentosAdicionales: descuentosAdicionales,
                bonosDetalle: bonosDetalle,
                cuotaDetalle: emp.CUOTA_DETALLE || '',
                estado: emp.ESTADO || 'PENDIENTE',
                observaciones: emp.BORRADOR_OBSERVACIONES || ''
            };
        });
        res.json(empleados);
    } catch (error) {
        console.error('Error al obtener planilla borrador:', error);
        res.status(500).json({ error: 'Error al obtener planilla borrador' });
    }
});

app.put('/api/planilla-borrador/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const pool = await poolPlanilla;
        const request = pool.request();

        request.input('id', mssql.Int, id);
        request.input('horasExtras', mssql.Decimal(10, 2), data.horasExtras || 0);
        request.input('faltasDias', mssql.Int, data.faltasDias || 0);
        request.input('faltasHoras', mssql.Int, data.faltasHoras || 0);
        request.input('descuentoAdicional', mssql.Decimal(10, 2), data.descuentoAdicional || 0);
        request.input('descuentosJson', mssql.NVarChar(mssql.MAX), JSON.stringify(data.descuentosAdicionales || []));
        request.input('bonosJson', mssql.NVarChar(mssql.MAX), JSON.stringify(data.bonosDetalle || []));
        request.input('estado', mssql.VarChar(20), data.estado || 'PENDIENTE');
        request.input('obs', mssql.NVarChar(mssql.MAX), data.observaciones || '');

        await request.query(`
            IF EXISTS (SELECT 1 FROM PLANILLA_BORRADOR WHERE ID_EMPLOYEE = @id)
                UPDATE PLANILLA_BORRADOR 
                SET HORAS_EXTRAS = @horasExtras,
                    FALTAS_DIAS = @faltasDias,
                    FALTAS_HORAS = @faltasHoras,
                    DESCUENTO_ADICIONAL = @descuentoAdicional,
                    DESCUENTOS_JSON = @descuentosJson,
                    BONOS_JSON = @bonosJson,
                    ESTADO = @estado,
                    OBSERVACIONES = @obs,
                    ULTIMA_MODIFICACION = GETDATE()
                WHERE ID_EMPLOYEE = @id
            ELSE
                INSERT INTO PLANILLA_BORRADOR (ID_EMPLOYEE, HORAS_EXTRAS, FALTAS_DIAS, FALTAS_HORAS, DESCUENTO_ADICIONAL, DESCUENTOS_JSON, BONOS_JSON, ESTADO, OBSERVACIONES)
                VALUES (@id, @horasExtras, @faltasDias, @faltasHoras, @descuentoAdicional, @descuentosJson, @bonosJson, @estado, @obs)
        `);
        res.json({ message: 'Borrador actualizado correctamente' });
    } catch (error) {
        console.error('Error al actualizar borrador:', error);
        res.status(500).json({ error: 'Error al actualizar borrador' });
    }
});

app.delete('/api/planilla-borrador', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        await pool.request().query('DELETE FROM PLANILLA_BORRADOR');
        res.json({ message: 'Borrador limpiado correctamente' });
    } catch (error) {
        console.error('Error al limpiar borrador:', error);
        res.status(500).json({ error: 'Error al limpiar borrador' });
    }
});

app.put('/api/empleados/:id/reactivar', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPlanilla;
        const data = req.body;

        const request = pool.request();
        request.input('id', mssql.Int, id);
        request.input('nombre', mssql.VarChar(100), data.nombre);
        request.input('apellidos', mssql.VarChar(100), data.apellidos);
        request.input('dni', mssql.VarChar(20), data.dni);
        request.input('genero', mssql.VarChar(50), data.sexo || null);
        request.input('nac', mssql.VarChar(100), data.nacionalidad || null);
        request.input('tel', mssql.VarChar(50), data.telefono || null);
        request.input('nomCont', mssql.VarChar(200), data.contactoEmergencia || null);
        request.input('numEmerg', mssql.VarChar(50), data.numeroEmergencia || null);
        request.input('fechaNac', mssql.Date, data.fechaNacimiento ? new Date(data.fechaNacimiento) : null);
        request.input('dir', mssql.VarChar(255), data.direccion || null);
        request.input('cargo', mssql.VarChar(100), data.cargo || null);
        request.input('dept', mssql.VarChar(100), data.departamento || null);
        request.input('tipo', mssql.VarChar(50), data.tipoTrabajador || 'PLANILLA');
        request.input('sueldo', mssql.Decimal(10, 2), data.sueldo || 0);
        request.input('entPrevis', mssql.VarChar(100), data.regimenPensionario || 'SNP/ONP');
        request.input('descAfpMin', mssql.Bit, data.calculoAfpMinimo ? 1 : 0);
        request.input('jorLab', mssql.VarChar(100), data.horarioTrabajo || null);
        request.input('fechaIng', mssql.Date, data.fechaInicio ? new Date(data.fechaInicio) : null);
        request.input('fechaFin', mssql.Date, null);
        request.input('correo', mssql.VarChar(150), data.email || null);
        request.input('banco', mssql.VarChar(100), data.banco || null);
        request.input('tipoCta', mssql.VarChar(50), data.tipoCuenta || null);
        request.input('numCta', mssql.VarChar(50), data.numeroCuenta || null);
        request.input('cci', mssql.VarChar(50), data.cci || null);
        request.input('activo', mssql.Bit, 1);

        const query = `
            UPDATE EMPLOYEES 
            SET NOMBRE = @nombre, APELLIDOS = @apellidos, DNI = @dni, GENERO = @genero, 
                NACIONALIDAD = @nac, TELEFONO = @tel, NOMBRE_CONTACTO = @nomCont, 
                NUMERO_EMERGENCIA = @numEmerg, FECHA_NACIMIENTO = @fechaNac, 
                DIRECCION = @dir, CARGO = @cargo, DEPARTAMENTO = @dept, 
                TIPO_TRABAJADOR = @tipo, SUELDO_BASE = @sueldo, 
                ENTIDAD_PREVISIONAL = @entPrevis, DESCUENTO_AFP_MINIMO = @descAfpMin,
                JORNADA_LABORAL = @jorLab, FECHA_INGRESO = @fechaIng, 
                FECHA_FIN_CONTRATO = @fechaFin, CORREO = @correo, BANCO = @banco, 
                TIPO_CUENTA = @tipoCta, NUMERO_CUENTA = @numCta, CCI = @cci, ACTIVO = @activo
            WHERE ID_EMPLOYEE = @id
        `;

        await request.query(query);
        res.json({ message: 'Empleado re-contratado exitosamente' });
    } catch (error) {
        console.error('Error al re-contratar empleado:', error);
        res.status(500).json({ error: 'Error al re-contratar empleado' });
    }
});


app.delete('/api/empleados/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo } = req.body;
        const pool = await poolPlanilla;

        const empRes = await pool.request()
            .input('id', mssql.Int, id)
            .query('SELECT * FROM EMPLOYEES WHERE ID_EMPLOYEE = @id');

        if (empRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Empleado no encontrado' });
        }

        const emp = empRes.recordset[0];

        await pool.request()
            .input('idOriginal', mssql.Int, id)
            .input('nombre', mssql.NVarChar, emp.NOMBRE)
            .input('apellido', mssql.NVarChar, emp.APELLIDOS)
            .input('dni', mssql.NVarChar, emp.DNI)
            .input('sueldo', mssql.Decimal(18, 2), emp.SUELDO_BASE)
            .input('depto', mssql.NVarChar, emp.DEPARTAMENTO)
            .input('cargo', mssql.NVarChar, emp.CARGO)
            .input('tipo', mssql.NVarChar, emp.TIPO_TRABAJADOR)
            .input('telefono', mssql.NVarChar, emp.TELEFONO)
            .input('correo', mssql.NVarChar, emp.CORREO)
            .input('motivo', mssql.NVarChar, motivo || 'Sin motivo especificado')
            .query(`
                INSERT INTO EMPLEADOS_ARCHIVADOS (
                    EmpleadoOriginalId, Nombre, Apellido, Sueldo, Departamento, 
                    Cargo, Tipo, Telefono, Motivo, FechaArchivado, CreatedAt
                ) VALUES (
                    @idOriginal, @nombre, @apellido, @sueldo, @depto, 
                    @cargo, @tipo, @telefono, @motivo, GETDATE(), GETDATE()
                )
            `);
        await pool.request()
            .input('id', mssql.Int, id)
            .query("UPDATE EMPLOYEES SET ACTIVO = 0, FECHA_FIN_CONTRATO = GETDATE() WHERE ID_EMPLOYEE = @id");

        res.json({ message: 'Empleado dado de baja y archivado exitosamente' });
    } catch (error) {
        console.error('Error al dar de baja y archivar empleado:', error);
        res.status(500).json({ error: 'Error al procesar la baja del empleado', details: error.message });
    }
});


app.get('/api/adelantos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();

        const mesStr = mes.toString();
        const mesPad = mes.toString().padStart(2, '0');
        const yearMonth = `${anio}-${mesPad}`;

        const result = await pool.request()
            .input('mesStr', mssql.VarChar, mesStr)
            .input('mesPad', mssql.VarChar, mesPad)
            .input('anio', mssql.Int, anio)
            .input('yearMonth', mssql.VarChar, yearMonth)
            .query(`
                SELECT * FROM ADVANCES 
                WHERE Tipo = 'ADELANTO'
                AND (
                    (Mes = @mesStr OR Mes = @mesPad OR Mes = @yearMonth) 
                    AND (Anio = @anio OR Anio IS NULL)
                    OR (MONTH(CreatedAt) = ${mes} AND YEAR(CreatedAt) = ${anio})
                )
                ORDER BY CreatedAt DESC
            `);

        const mapped = result.recordset.map(r => ({
            _id: r.Id,
            dni: r.EmpleadoNumId,
            monto: r.Monto,
            observaciones: r.Observaciones,
            estado: r.Estado,
            tipo: r.Tipo,
            nombreEmpleado: r.NombreEmpleado,
            cargo: r.Cargo,
            departamento: r.Departamento,
            fecha: r.CreatedAt,
            esPrestamo: r.EsPrestamo,
            numeroAdelanto: r.NumeroAdelanto
        }));
        res.json(mapped);
    } catch (error) {
        console.error('Error al obtener adelantos:', error);
        res.status(500).json({ error: 'Error al obtener adelantos' });
    }
});

app.post('/api/adelantos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const data = req.body;
        const now = new Date();
        const request = pool.request();
        request.input('dni', mssql.NVarChar, data.dni);
        request.input('monto', mssql.Decimal(18, 2), data.monto);
        request.input('obs', mssql.NVarChar, data.observaciones);
        request.input('estado', mssql.NVarChar, data.estado || 'PENDIENTE');
        request.input('tipo', mssql.NVarChar, data.tipo || 'ADELANTO');
        request.input('nombre', mssql.NVarChar, data.nombreEmpleado);
        request.input('cargo', mssql.NVarChar, data.cargo);
        request.input('dep', mssql.NVarChar, data.departamento);
        request.input('mes', mssql.VarChar, (now.getMonth() + 1).toString().padStart(2, '0'));
        request.input('anio', mssql.Int, now.getFullYear());

        await request.query(`
            INSERT INTO ADVANCES (EmpleadoNumId, Monto, Observaciones, Estado, Tipo, NombreEmpleado, Cargo, Departamento, CreatedAt, Mes, Anio)
            VALUES (@dni, @monto, @obs, @estado, @tipo, @nombre, @cargo, @dep, GETDATE(), @mes, @anio)
        `);
        res.status(201).json({ message: 'Movimiento guardado' });
    } catch (error) {
        console.error('Error al guardar movimiento:', error);
        res.status(500).json({ error: 'Error al guardar movimiento' });
    }
});

app.delete('/api/adelantos/:id', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, req.params.id)
            .query('DELETE FROM ADVANCES WHERE Id = @id');
        res.json({ message: 'Eliminado de SQL' });
    } catch (error) {
        console.error('Error al eliminar movimiento:', error);
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

app.get('/api/prestamos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();
        const mesPad = mes.toString().padStart(2, '0');
        const yearMonth = `${anio}-${mesPad}`;

        const result = await pool.request()
            .input('mesPad', mssql.VarChar, mesPad)
            .input('anio', mssql.Int, anio)
            .input('yearMonth', mssql.VarChar, yearMonth)
            .query(`
                SELECT * FROM ADVANCES 
                WHERE Tipo = 'PRESTAMO' 
                AND (
                    (Mes = @mesPad OR Mes = @yearMonth) 
                    AND (Anio = @anio OR Anio IS NULL)
                    OR (MONTH(CreatedAt) = ${mes} AND YEAR(CreatedAt) = ${anio})
                )
                ORDER BY CreatedAt DESC
            `);

        const mapped = result.recordset.map(r => ({
            _id: r.Id,
            dni: r.EmpleadoNumId,
            monto: r.Monto,
            observaciones: r.Observaciones,
            estado: r.Estado,
            nombreEmpleado: r.NombreEmpleado,
            cargo: r.Cargo,
            fecha: r.CreatedAt,
            cuotaNumero: r.NumeroAdelanto,
            esCuota: r.EsCuota
        }));
        res.json(mapped);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener prestamos' });
    }
});

app.post('/api/prestamos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const data = req.body;
        const now = new Date();
        const cuotas = parseInt(data.cuotas) || 1;
        const montoTotal = parseFloat(data.monto);
        const montoPorCuota = Math.round((montoTotal / cuotas) * 100) / 100;

        for (let i = 1; i <= cuotas; i++) {
            const installmentDate = new Date(now.getFullYear(), now.getMonth() + (i - 1), 1);
            const instMes = (installmentDate.getMonth() + 1).toString().padStart(2, '0');
            const instAnio = installmentDate.getFullYear();

            const request = pool.request();
            request.input('dni', mssql.Int, parseInt(data.dni) || 0);
            request.input('monto', mssql.Decimal(18, 2), montoPorCuota);
            request.input('obs', mssql.NVarChar, data.observaciones || null);
            request.input('estado', mssql.NVarChar, 'PENDIENTE');
            request.input('nombre', mssql.NVarChar, data.nombreEmpleado);
            request.input('cargo', mssql.NVarChar, data.cargo);
            request.input('dep', mssql.NVarChar, data.departamento);
            request.input('mes', mssql.VarChar, instMes);
            request.input('anio', mssql.Int, instAnio);
            request.input('esPrestamo', mssql.Bit, 1);
            request.input('esCuota', mssql.Bit, cuotas > 1 ? 1 : 0);
            request.input('numAdelanto', mssql.Int, i);
            request.input('totalCuotas', mssql.Int, cuotas);

            await request.query(`
                INSERT INTO ADVANCES (EmpleadoNumId, Monto, Observaciones, Estado, Tipo, NombreEmpleado, Cargo, Departamento, CreatedAt, Mes, Anio, EsPrestamo, EsCuota, NumeroAdelanto, TotalCuotas)
                VALUES (@dni, @monto, @obs, @estado, 'PRESTAMO', @nombre, @cargo, @dep, GETDATE(), @mes, @anio, @esPrestamo, @esCuota, @numAdelanto, @totalCuotas)
            `);
        }
        res.status(201).json({ message: `Prestamo guardado en ${cuotas} cuota(s)` });
    } catch (error) {
        console.error('Error al guardar prestamo:', error);
        res.status(500).json({ error: 'Error al guardar prestamo' });
    }
});

app.get('/api/movilidad', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();
        const mesPad = mes.toString().padStart(2, '0');
        const yearMonth = `${anio}-${mesPad}`;

        const result = await pool.request()
            .input('mesPad', mssql.VarChar, mesPad)
            .input('anio', mssql.Int, anio)
            .input('yearMonth', mssql.VarChar, yearMonth)
            .query(`
                SELECT * FROM ADVANCES 
                WHERE Tipo = 'MOVILIDAD' 
                AND (
                    (Mes = @mesPad OR Mes = @yearMonth) 
                    AND (Anio = @anio OR Anio IS NULL)
                    OR (MONTH(CreatedAt) = ${mes} AND YEAR(CreatedAt) = ${anio})
                )
                ORDER BY CreatedAt DESC
            `);

        const mapped = result.recordset.map(r => ({
            _id: r.Id,
            dni: r.EmpleadoNumId,
            monto: r.Monto,
            observaciones: r.Observaciones,
            estado: r.Estado,
            nombreEmpleado: r.NombreEmpleado,
            fecha: r.CreatedAt
        }));
        res.json(mapped);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener movilidad' });
    }
});

app.post('/api/movilidad', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const data = req.body;
        const now = new Date();
        const request = pool.request();
        request.input('dni', mssql.NVarChar, data.dni);
        request.input('monto', mssql.Decimal(18, 2), data.monto);
        request.input('obs', mssql.NVarChar, data.observaciones);
        request.input('estado', mssql.NVarChar, data.estado || 'PENDIENTE');
        request.input('nombre', mssql.NVarChar, data.nombreEmpleado);
        request.input('cargo', mssql.NVarChar, data.cargo);
        request.input('dep', mssql.NVarChar, data.departamento);
        request.input('mes', mssql.VarChar, (now.getMonth() + 1).toString().padStart(2, '0'));
        request.input('anio', mssql.Int, now.getFullYear());

        await request.query(`
            INSERT INTO ADVANCES (EmpleadoNumId, Monto, Observaciones, Estado, Tipo, NombreEmpleado, Cargo, Departamento, CreatedAt, Mes, Anio)
            VALUES (@dni, @monto, @obs, @estado, 'MOVILIDAD', @nombre, @cargo, @dep, GETDATE(), @mes, @anio)
        `);
        res.status(201).json({ message: 'Movilidad guardada' });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar movilidad' });
    }
});

app.get('/api/viaticos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();
        const mesPad = mes.toString().padStart(2, '0');
        const yearMonth = `${anio}-${mesPad}`;

        const result = await pool.request()
            .input('mesPad', mssql.VarChar, mesPad)
            .input('anio', mssql.Int, anio)
            .input('yearMonth', mssql.VarChar, yearMonth)
            .query(`
                SELECT * FROM ADVANCES 
                WHERE Tipo = 'VIATICO' 
                AND (
                    (Mes = @mesPad OR Mes = @yearMonth) 
                    AND (Anio = @anio OR Anio IS NULL)
                    OR (MONTH(CreatedAt) = ${mes} AND YEAR(CreatedAt) = ${anio})
                )
                ORDER BY CreatedAt DESC
            `);

        const mapped = result.recordset.map(r => ({
            _id: r.Id,
            dni: r.EmpleadoNumId,
            monto: r.Monto,
            observaciones: r.Observaciones,
            estado: r.Estado,
            nombreEmpleado: r.NombreEmpleado,
            fecha: r.CreatedAt
        }));
        res.json(mapped);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener viaticos' });
    }
});

app.post('/api/viaticos', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const data = req.body;
        const now = new Date();
        const request = pool.request();
        request.input('dni', mssql.NVarChar, data.dni);
        request.input('monto', mssql.Decimal(18, 2), data.monto);
        request.input('obs', mssql.NVarChar, data.observaciones);
        request.input('estado', mssql.NVarChar, data.estado || 'PENDIENTE');
        request.input('nombre', mssql.NVarChar, data.nombreEmpleado);
        request.input('cargo', mssql.NVarChar, data.cargo);
        request.input('dep', mssql.NVarChar, data.departamento);
        request.input('mes', mssql.VarChar, (now.getMonth() + 1).toString().padStart(2, '0'));
        request.input('anio', mssql.Int, now.getFullYear());

        await request.query(`
            INSERT INTO ADVANCES (EmpleadoNumId, Monto, Observaciones, Estado, Tipo, NombreEmpleado, Cargo, Departamento, CreatedAt, Mes, Anio)
            VALUES (@dni, @monto, @obs, @estado, 'VIATICO', @nombre, @cargo, @dep, GETDATE(), @mes, @anio)
        `);
        res.status(201).json({ message: 'Viatico guardado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar viatico' });
    }
});


app.post('/api/historial-pago', async (req, res) => {
    try {
        const { periodo, mes, año, empleados } = req.body;
        const pool = await poolPlanilla;

        const transaction = new mssql.Transaction(pool);
        await transaction.begin();

        try {
            const deleteRequest = new mssql.Request(transaction);
            deleteRequest.input('periodo', mssql.NVarChar, periodo);
            await deleteRequest.query('DELETE FROM HistorialPagos WHERE Periodo = @periodo');

            for (const emp of empleados) {
                const insertRequest = new mssql.Request(transaction);
                insertRequest.input('nombres', mssql.NVarChar, emp.nombre + (emp.apellidos ? ' ' + emp.apellidos : ''));
                insertRequest.input('cargo', mssql.NVarChar, emp.cargo);
                insertRequest.input('tipo', mssql.NVarChar, emp.tipoTrabajador);
                insertRequest.input('sueldo', mssql.Decimal(18, 2), emp.sueldo);
                insertRequest.input('bonos', mssql.Decimal(18, 2), emp.bonos);
                insertRequest.input('hrsExtra', mssql.Decimal(18, 2), emp.montoHorasExtras);
                insertRequest.input('afp', mssql.Decimal(18, 2), emp.descuentoAfp);
                insertRequest.input('adelanto', mssql.Decimal(18, 2), emp.adelanto);
                insertRequest.input('prestamo', mssql.Decimal(18, 2), emp.prestamo);
                insertRequest.input('faltas', mssql.Decimal(18, 2), emp.montoFaltas);
                insertRequest.input('adic', mssql.Decimal(18, 2), emp.descuentoAdicional);
                insertRequest.input('totalDesc', mssql.Decimal(18, 2), emp.totalDescuento);
                insertRequest.input('neto', mssql.Decimal(18, 2), emp.remuneracionNeta);
                insertRequest.input('obs', mssql.NVarChar, emp.observaciones || null);
                insertRequest.input('periodo', mssql.NVarChar, periodo);

                await insertRequest.query(`
                    INSERT INTO HistorialPagos (Nombres, Cargo, Tipo, SueldoBase, Bonos, HrsExtra, PensionAFP, Adelanto, Prestamo, Faltas, DescAdic, TotalDesc, NetoAPagar, Observaciones, Periodo)
                    VALUES (@nombres, @cargo, @tipo, @sueldo, @bonos, @hrsExtra, @afp, @adelanto, @prestamo, @faltas, @adic, @totalDesc, @neto, @obs, @periodo)
                `);
            }

            await transaction.commit();
            res.status(201).json({ message: 'Planilla guardada correctamente en SQL Server' });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (error) {
        console.error('Error guardando historial de pago en SQL:', error);
        res.status(500).json({ error: 'Error al guardar historial de pago en SQL Server' });
    }
});


app.get('/api/historial-pago', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request().query('SELECT DISTINCT Periodo FROM HistorialPagos ORDER BY Periodo DESC');

        const periods = result.recordset.map(row => row.Periodo);

        const formattedPeriods = periods.map(p => {
            if (!p || typeof p !== 'string' || !p.includes('-')) return null;
            const [year, month] = p.split('-');
            const monthNames = [
                'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
                'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
            ];
            const monthIndex = parseInt(month) - 1;
            return {
                periodo: p,
                mes: monthNames[monthIndex] || 'Desconocido',
                año: parseInt(year),
                estado: 'GUARDADA'
            };
        }).filter(p => p !== null);

        res.json(formattedPeriods);
    } catch (error) {
        console.error('Error obteniendo lista historial desde SQL:', error);
        res.status(500).json({ error: 'Error al obtener historial desde SQL Server' });
    }
});


app.get('/api/historial-pago/:periodo', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const result = await pool.request()
            .input('periodo', mssql.NVarChar, req.params.periodo)
            .query('SELECT * FROM HistorialPagos WHERE Periodo = @periodo');

        const docs = result.recordset;

        if (docs.length === 0) return res.status(404).json({ error: 'No se encontró planilla para este periodo en SQL Server' });

        const [year, month] = req.params.periodo.split('-');
        const monthNames = [
            'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
            'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
        ];

        const payrollData = {
            periodo: req.params.periodo,
            mes: monthNames[parseInt(month) - 1],
            año: parseInt(year),
            empleados: docs.map(d => ({
                empleadoId: d.Id,
                nombre: d.Nombres,
                apellidos: d.Apellidos || null,
                cargo: d.Cargo,
                tipoTrabajador: d.Tipo,
                sueldo: d.SueldoBase,
                bonos: d.Bonos,
                montoHorasExtras: d.HrsExtra,
                descuentoAfp: d.PensionAFP,
                adelanto: d.Adelanto,
                prestamo: d.Prestamo,
                montoFaltas: d.Faltas,
                descuentoAdicional: d.DescAdic,
                totalDescuento: d.TotalDesc,
                remuneracionNeta: d.NetoAPagar,
                observaciones: d.Observaciones || null
            }))
        };

        res.json(payrollData);
    } catch (error) {
        console.error('Error obteniendo detalle desde SQL:', error);
        res.status(500).json({ error: 'Error al obtener detalle del historial desde SQL Server' });
    }
});


import { getSecret } from './utils/secrets.js';

const WHMCS_API_URL = getSecret('whmcs_api_url', 'http://cliente.hwperu.com/includes/api.php');
const WHMCS_IDENTIFIER = getSecret('whmcs_identifier', 'Pb55YUTQVfK73P5U1xLu9yF0jbKvZTeq');
const WHMCS_SECRET = getSecret('whmcs_secret', 'hu8U5fQ80TVCHMW4ZBwBR7mYi1Iuw7HR');

const CUENTAS_DESTINO = {
    '2003002697856': 'INTERBANK',
    '1939839336030': 'BCP'
};

function identifyBankFromText(text) {
    const banks = identifyAllBanks(text);
    return banks.length > 0 ? banks[0] : null;
}

function identifyAllBanks(text) {
    if (!text) return [];
    const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const identified = [];

    if (t.includes('yape')) identified.push('Yape');
    if (t.includes('plin')) identified.push('Plin');

    if (t.includes('bcp') || t.includes('credito') || t.includes('1939839336030') || t.includes('viabcp')) identified.push('BCP');
    if (t.includes('interbank') || t.includes('ibk') || t.includes('ibnk') || t.includes('2003002697856')) identified.push('INTERBANK');
    if (t.includes('bbva') || t.includes('continental') || t.includes('0011')) identified.push('BBVA');
    if (t.includes('izipay') || t.includes('pos')) identified.push('Izipay');
    if (t.includes('paypal')) identified.push('PayPal');
    if (t.includes('caja') || t.includes('efectivo')) identified.push('Efectivo');

    return [...new Set(identified)];
}

async function getWhmcsInvoiceDetails(invoiceId) {
    const params = new URLSearchParams();
    params.append('identifier', WHMCS_IDENTIFIER);
    params.append('secret', WHMCS_SECRET);
    params.append('action', 'GetInvoice');
    params.append('invoiceid', invoiceId.toString());
    params.append('responsetype', 'json');

    try {
        const res = await axios.post(WHMCS_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return res.data;
    } catch (err) {
        console.error(`Error fetching invoice ${invoiceId}:`, err.message);
        return null;
    }
}

function mapBankToDebitAccount(bank) {
    if (!bank) return '1031';
    const b = bank.toUpperCase();
    if (b === 'BCP' || b === 'INTERBANK' || b === 'BBVA') return '1041';
    if (b === 'IZIPAY' || b === 'PAYPAL') return '1031';
    if (b === 'CAJA VIRTUAL') return '1011';
    return '1031';
}

export async function syncWhmcsInvoices() {
    console.log('Starting WHMCS Absolute Sync (Transaction-First/100% Accuracy)...');
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    try {
        const targetMonthStr = `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}`;
        console.log(`[WHMCS Sync] Analyzing transactions for ${targetMonthStr}...`);

        // --- FASE 1: Obtener TODAS las transacciones del mes ---
        const txParams = new URLSearchParams();
        txParams.append('identifier', WHMCS_IDENTIFIER);
        txParams.append('secret', WHMCS_SECRET);
        txParams.append('action', 'GetTransactions');
        txParams.append('limitnum', '2000'); // Suficiente para capturar el mes
        txParams.append('responsetype', 'json');

        const txRes = await axios.post(WHMCS_API_URL, txParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!txRes.data.transactions || !txRes.data.transactions.transaction) {
            console.warn('[WHMCS Sync] No transactions found in the response.');
            return;
        }

        const allTrans = Array.isArray(txRes.data.transactions.transaction) ? txRes.data.transactions.transaction : [txRes.data.transactions.transaction];
        const marchTrans = allTrans.filter(t => t.date.startsWith(targetMonthStr));

        if (marchTrans.length === 0) {
            console.log(`[WHMCS Sync] No transactions found for ${targetMonthStr}.`);
            return;
        }

        // Calcular total exacto (PEN)
        const totalGrossPEN = marchTrans.reduce((sum, t) => {
            const amt = parseFloat(t.amountin || 0);
            const r = parseFloat(t.rate || 1);
            return sum + (r > 0 ? (amt / r) : amt);
        }, 0);

        console.log(`[WHMCS Sync] WHMCS Total Match: S/ ${totalGrossPEN.toFixed(2)} (${marchTrans.length} transacciones)`);

        // Identificar facturas únicas a sincronizar basándonos en las transacciones de este mes
        const invoiceIds = [...new Set(marchTrans.map(t => parseInt(t.invoiceid)).filter(id => id > 0))];
        console.log(`[WHMCS Sync] Syncing ${invoiceIds.length} unique invoices involved in these transactions.`);

        const pool = await poolFinance;
        let syncedCount = 0;

        const chunkSize = 10;
        for (let i = 0; i < invoiceIds.length; i += chunkSize) {
            const chunk = invoiceIds.slice(i, i + chunkSize);
            await Promise.all(chunk.map(async (invId) => {
                try {
                    // Obtener detalles completos de la factura
                    const detRes = await getWhmcsInvoiceDetails(invId);
                    if (!detRes || detRes.result !== 'success') return;

                    const invBase = detRes;
                    const invoiceTxsInPeriod = marchTrans.filter(t => parseInt(t.invoiceid) === invId);

                    // Monto bruto para esta factura en este periodo
                    const totalMonthPENForInvoice = invoiceTxsInPeriod.reduce((sum, t) => {
                        const amt = parseFloat(t.amountin || 0);
                        const r = parseFloat(t.rate || 1);
                        return sum + (r > 0 ? (amt / r) : amt);
                    }, 0);

                    const fullName = `${invBase.firstname || ''} ${invBase.lastname || ''}`.trim();
                    const companyDisp = (invBase.companyname && invBase.companyname.trim()) ? invBase.companyname.trim() : null;
                    const clienteName = fullName || companyDisp || 'Cliente WHMCS';

                    const invItems = invBase.items?.item || [];
                    let firstItem = invItems[0]?.description || 'Servicio WHMCS';
                    const techKeywords = ['IP Adicionales:', 'Sistema Operativo:', 'Pre-Instalación:', 'Ubicación:', 'Panel de Control:'];
                    for (const kw of techKeywords) {
                        if (firstItem.includes(kw)) firstItem = firstItem.split(kw)[0].trim();
                    }
                    firstItem = firstItem.split('\n')[0].trim();

                    let cat = 'Otros';
                    const allItemsText = invItems.map(i => (i.description || '').toLowerCase()).join(' ');
                    if (allItemsText.includes('hosting') && allItemsText.includes('dom')) cat = 'Hosting y Dominio';
                    else if (allItemsText.includes('hosting')) cat = 'Hosting';
                    else if (allItemsText.includes('dom')) cat = 'Dominio';

                    let cleanConcept = `${clienteName}\n${firstItem} (${cat})`;
                    cleanConcept = cleanConcept.replace(/\(\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}\)/g, '').replace(/\s+/g, ' ').trim();
                    const clienteConcepto = cleanConcept.substring(0, 255);

                    // Reconstruir origen/destino bancario desde la última transacción
                    let bankSource = '--';
                    let bankDestination = '--';
                    if (invoiceTxsInPeriod.length > 0) {
                        const lastT = invoiceTxsInPeriod[invoiceTxsInPeriod.length - 1];
                        const banksInId = identifyAllBanks(lastT.transid);
                        if (banksInId[0]) bankSource = banksInId[0];
                        if (banksInId.length > 1) bankDestination = banksInId[1];
                        else {
                            bankDestination = identifyBankFromText(lastT.description) || identifyBankFromText(invBase.paymentmethod) || bankSource;
                        }
                    }

                    const codigoContable = mapBankToDebitAccount(bankDestination);
                    const pm = (invBase.paymentmethod || '').toLowerCase();
                    let tipoMov = 'Transferencia';
                    if (pm.includes('izipay')) tipoMov = 'Izipay';
                    else if (pm.includes('yape')) tipoMov = 'Yape';
                    else if (pm.includes('plin')) tipoMov = 'Plin';
                    else if (pm.includes('tarjeta') || pm.includes('paypal') || pm.includes('stripe')) tipoMov = 'Tarjeta';
                    else if (pm.includes('efectivo')) tipoMov = 'Efectivo';

                    const request = pool.request();
                    request.input('whmcsId', mssql.Int, invId);
                    request.input('fecha', mssql.Date, invBase.date);
                    request.input('cliente', mssql.NVarChar(255), clienteConcepto);
                    request.input('numFactura', mssql.NVarChar(50), invBase.invoicenum);
                    request.input('total', mssql.Decimal(18, 2), totalMonthPENForInvoice);
                    request.input('estado', mssql.NVarChar(50), invBase.status);
                    request.input('pagado', mssql.Decimal(18, 2), totalMonthPENForInvoice);
                    request.input('moneda', mssql.NVarChar(10), invBase.currencycode || 'PEN');
                    request.input('banco', mssql.NVarChar(50), bankSource);
                    request.input('cuentaDebito', mssql.NVarChar(100), bankDestination);
                    request.input('tipoMovimiento', mssql.NVarChar(50), tipoMov);
                    request.input('codContable', mssql.NVarChar(50), codigoContable);
                    request.input('now', mssql.DateTime, new Date());

                    await request.query(`
                        IF EXISTS (SELECT 1 FROM FINANCE_INVOICES WHERE WHMCS_InvoiceID = @whmcsId)
                        BEGIN
                            UPDATE FINANCE_INVOICES SET 
                                ClienteConcepto = @cliente,
                                EstadoWHMCS = @estado, 
                                Pagado = @pagado, 
                                MontoBruto = @total,
                                DepositoSalida = @pagado,
                                EstadoLocal = 'Conciliado',
                                Banco = @banco,
                                CuentaDebito = @cuentaDebito,
                                UpdatedAt = @now
                            WHERE WHMCS_InvoiceID = @whmcsId
                        END
                        ELSE
                        BEGIN
                            INSERT INTO FINANCE_INVOICES (WHMCS_InvoiceID, Fecha, ClienteConcepto, NumFactura, MontoBruto, EstadoWHMCS, Pagado, DepositoSalida, Moneda, EstadoLocal, Banco, CuentaDebito, TipoMovimiento, CodigoContable, CreatedAt, UpdatedAt)
                            VALUES (@whmcsId, @fecha, @cliente, @numFactura, @total, @estado, @pagado, @pagado, @moneda, 'Conciliado', @banco, @cuentaDebito, @tipoMovimiento, @codContable, @now, @now)
                        END
                    `);
                    syncedCount++;
                } catch (err) {
                    console.error(`Error syncing invoice ${invId}:`, err.message);
                }
            }));
        }

        // Cache final
        cachedThisMonthPaid = totalGrossPEN;
        cachedThisMonthTotalGross = totalGrossPEN;
        lastSyncTime = Date.now();
        console.log(`[WHMCS Sync] Sync Complete. Final Cached Gross: S/ ${cachedThisMonthTotalGross.toFixed(2)} (${syncedCount} facturas listadas)`);

    } catch (error) {
    }
}

app.get('/api/whmcs/invoices', async (req, res) => {
    try {
        const now = new Date();
        const forceSync = req.query.sync === 'true';

        const currentMonth = parseInt(req.query.mes) || (now.getMonth() + 1);
        const currentYear = parseInt(req.query.anio) || now.getFullYear();

        if (forceSync) {
            await syncWhmcsInvoices();
        } else if (!lastSyncTime || (Date.now() - lastSyncTime > SYNC_COOLDOWN)) {
            console.log('[WHMCS] Starting background sync...');
            syncWhmcsInvoices().catch(err => console.error('Background sync failed:', err));
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const offset = (page - 1) * limit;

        const pool = await poolFinance;

        const countResult = await pool.request()
            .input('month', mssql.Int, currentMonth)
            .input('year', mssql.Int, currentYear)
            .query(`
                SELECT COUNT(*) as total FROM FINANCE_INVOICES 
                WHERE MONTH(Fecha) = @month AND YEAR(Fecha) = @year
                AND EstadoLocal = 'Conciliado'
            `);

        const totalRecords = countResult.recordset[0].total;

        const result = await pool.request()
            .input('month', mssql.Int, currentMonth)
            .input('year', mssql.Int, currentYear)
            .input('offset', mssql.Int, offset)
            .input('limit', mssql.Int, limit)
            .query(`
                SELECT * FROM FINANCE_INVOICES 
                WHERE MONTH(Fecha) = @month AND YEAR(Fecha) = @year
                AND EstadoLocal = 'Conciliado'
                ORDER BY Fecha DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);

        const invoices = result.recordset.map(inv => ({
            id: inv.WHMCS_InvoiceID,
            localId: inv.ID,
            fecha: inv.Fecha,
            clienteConcepto: inv.ClienteConcepto,
            numFactura: inv.NumFactura || inv.WHMCS_InvoiceID,
            montoBruto: inv.MontoBruto,
            estado: inv.EstadoWHMCS,
            pagado: inv.Pagado,
            moneda: inv.Moneda,
            tipoMovimiento: inv.TipoMovimiento,
            comision: inv.Comision,
            depositoSalida: inv.DepositoSalida,
            banco: inv.Banco,
            cuentaDebito: inv.CuentaDebito,
            cuentaCredito: inv.CuentaCredito,
            codigoContable: inv.CodigoContable,
            estadoLocal: inv.EstadoLocal || 'Pendiente'
        }));

        const penInvoices = invoices.filter(inv => {
            const m = (inv.moneda || '').toString().toUpperCase();
            return m === 'PEN' || m === '1' || m === '' || m === 'SOLES' || m.includes('S/');
        });
        const thisMonthPaid = cachedThisMonthPaid;
        const thisMonthTotalGross = cachedThisMonthTotalGross > 0
            ? cachedThisMonthTotalGross
            : penInvoices.reduce((sum, inv) => sum + (Number(inv.montoBruto) || 0), 0);

        const thisMonthUnpaid = penInvoices.filter(inv => {
            const st = (inv.estado || '').toLowerCase();
            return st.includes('unpaid') || st.includes('pendien');
        }).reduce((sum, inv) => sum + (Number(inv.montoBruto) || 0), 0);

        console.log(`[Finance Debug] This Month Paid (caché datepaid): ${thisMonthPaid}`);
        console.log(`[Finance Debug] This Month Total Gross: ${thisMonthTotalGross}`);

        res.json({
            totalresults: totalRecords,
            totalPages: Math.ceil(totalRecords / limit),
            currentPage: page,
            thisMonthPaid,
            thisMonthTotal: thisMonthPaid,
            thisMonthTotalGross,
            thisMonthUnpaid,
            invoices: invoices
        });
    } catch (error) {
        console.error('Error fetching invoices:', error.message);
        res.status(500).json({ error: 'Error al obtener facturas' });
    }
});

app.get('/api/whmcs/invoice/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const params = new URLSearchParams();
        params.append('identifier', WHMCS_IDENTIFIER);
        params.append('secret', WHMCS_SECRET);
        params.append('action', 'GetInvoice');
        params.append('invoiceid', id);
        params.append('responsetype', 'json');

        const response = await axios.post(WHMCS_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (response.data.result === 'success') {
            const inv = response.data;
            const items = inv.items?.item || [];
            res.json({
                success: true,
                invoice: {
                    id: inv.invoiceid,
                    invoicenum: inv.invoicenum || inv.invoiceid,
                    date: inv.date,
                    duedate: inv.duedate,
                    datepaid: inv.datepaid,
                    status: inv.status,
                    paymentmethod: inv.paymentmethod,
                    subtotal: parseFloat(inv.subtotal || 0),
                    tax: parseFloat(inv.tax || 0),
                    tax2: parseFloat(inv.tax2 || 0),
                    total: parseFloat(inv.total || 0),
                    credit: parseFloat(inv.credit || 0),
                    balance: parseFloat(inv.balance || 0),
                    notes: inv.notes || '',
                    client: {
                        name: `${inv.firstname || ''} ${inv.lastname || ''}`.trim(),
                        company: inv.companyname || '',
                        email: inv.email || ''
                    },
                    items: items.map(it => ({
                        id: it.id,
                        type: it.type,
                        description: it.description,
                        amount: parseFloat(it.amount || 0),
                        taxed: it.taxed
                    }))
                }
            });
        } else {
            res.status(404).json({ success: false, error: 'Factura no encontrada en WHMCS' });
        }
    } catch (error) {
        console.error('Error fetching invoice detail:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


app.get('/api/finance/invoices/:id/pdf-info', async (req, res) => {
    const { id } = req.params;
    try {
        const params = new URLSearchParams();
        params.append('identifier', WHMCS_IDENTIFIER);
        params.append('secret', WHMCS_SECRET);
        params.append('action', 'GetInvoice');
        params.append('invoiceid', id);
        params.append('responsetype', 'json');

        const response = await axios.post(WHMCS_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (response.data.result === 'success') {
            const inv = response.data;
            let detectedBank = identifyBankFromText(inv.paymentmethod) || identifyBankFromText(inv.notes);

            if (!detectedBank && inv.transactions?.transaction) {
                const txs = Array.isArray(inv.transactions.transaction) ? inv.transactions.transaction : [inv.transactions.transaction];
                for (const tx of txs) {
                    detectedBank = identifyBankFromText(tx.description) || identifyBankFromText(tx.transid);
                    if (detectedBank) break;
                }
            }

            res.json({ success: true, data: { banco: detectedBank } });
        } else {
            res.status(404).json({ success: false, error: 'Invoice not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/finance/invoices/:id/metadata', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const pool = await poolFinance;

        const request = pool.request();
        request.input('id', mssql.Int, id);
        request.input('tipo', mssql.NVarChar(100), data.tipoMovimiento || '');
        request.input('comision', mssql.Decimal(18, 2), data.comision || 0);
        request.input('deposito', mssql.Decimal(18, 2), data.depositoSalida || 0);
        request.input('banco', mssql.NVarChar(100), data.banco || '');
        request.input('debit', mssql.NVarChar(100), data.cuentaDebito || '');
        request.input('credit', mssql.NVarChar(100), data.cuentaCredito || '');
        request.input('codigo', mssql.NVarChar(100), data.codigoContable || '');
        request.input('estado', mssql.NVarChar(50), data.estadoLocal || '');
        request.input('now', mssql.DateTime, new Date());

        await request.query(`
            UPDATE FINANCE_INVOICES SET 
                TipoMovimiento = @tipo,
                Comision = @comision,
                DepositoSalida = @deposito,
                Banco = @banco,
                CuentaDebito = @debit,
                CuentaCredito = @credit,
                CodigoContable = @codigo,
                EstadoLocal = @estado,
                UpdatedAt = @now
            WHERE ID = @id
        `);

        res.json({ message: 'Metadata actualizada correctamente' });
    } catch (error) {
        console.error('Error updating invoice metadata:', error);
        res.status(500).json({ error: 'Error al actualizar metadata' });
    }
});

app.get('/api/finance/movement-types', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM movement_types');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        console.error('Error movement_types:', error);
        res.status(500).json({ error: 'Error al obtener tipos de movimiento' });
    }
});

app.get('/api/finance/bancos', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM BANCOS');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        console.error('Error bancos:', error);
        res.status(500).json({ error: 'Error al obtener bancos' });
    }
});

app.get('/api/finance/debit-accounts', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM debit_accounts');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        console.error('Error debit_accounts:', error);
        res.status(500).json({ error: 'Error al obtener cuentas débito' });
    }
});

app.get('/api/finance/credit-accounts', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM credit_accounts');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        console.error('Error credit_accounts:', error);
        res.status(500).json({ error: 'Error al obtener cuentas crédito' });
    }
});

app.get('/api/finance/codigo-contable', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM CODIGO_CONTABLE');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        console.error('Error CODIGO_CONTABLE:', error);
        res.status(500).json({ error: 'Error al obtener códigos contables' });
    }
});

app.get('/api/finance/transaction-status', async (req, res) => {
    try {
        const pool = await poolFinance;
        const result = await pool.request().query('SELECT * FROM transaction_status');
        res.json(result.recordset.map(r => ({ id: r.id || r.Id || r.ID, name: r.name || r.Nombre || r.NOMBRE || r[Object.keys(r)[1]] })));
    } catch (error) {
        console.error('Error transaction_status:', error);
        res.status(500).json({ error: 'Error al obtener estados de transacción' });
    }
});


app.get('/api/finance/egresos', async (req, res) => {
    try {
        const pool = await poolFinance;
        const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
        const anio = parseInt(req.query.anio) || new Date().getFullYear();

        const result = await pool.request()
            .input('month', mssql.Int, mes)
            .input('year', mssql.Int, anio)
            .query(`
                SELECT * FROM FINANCE_EGRESOS 
                WHERE MONTH(Fecha) = @month AND YEAR(Fecha) = @year
                ORDER BY Fecha DESC, CreatedAt DESC
            `);

        console.log(`[EGRESOS DEBUG] Mes: ${mes}, Anio: ${anio} -> Filas encontradas: ${result.recordset.length}`);

        const egresos = result.recordset.map(e => ({
            id: e.ID,
            fecha: e.Fecha,
            monto: e.Monto,
            banco: e.Banco,
            tipoEgreso: e.TipoEgreso,
            comercio: e.Comercio,
            categoria: e.Categoria,
            referencia: e.Referencia,
            origen: e.Origen,
            observacion: e.Observacion
        }));

        const totalMes = egresos.reduce((sum, e) => sum + (Number(e.monto) || 0), 0);

        res.json({
            total: egresos.length,
            totalMonto: totalMes,
            egresos
        });
    } catch (error) {
        console.error('Error fetching egresos:', error);
        res.status(500).json({ error: 'Error al obtener egresos' });
    }
});

app.post('/api/finance/egresos', async (req, res) => {
    try {
        const data = req.body;
        const pool = await poolFinance;
        const request = pool.request();

        request.input('fecha', mssql.Date, data.fecha ? new Date(data.fecha) : new Date());
        request.input('monto', mssql.Decimal(18, 2), data.monto || 0);
        request.input('banco', mssql.NVarChar(100), data.banco || '');
        request.input('tipo', mssql.NVarChar(100), data.tipoEgreso || 'MANUAL');
        request.input('comercio', mssql.NVarChar(255), data.comercio || '');
        request.input('categoria', mssql.NVarChar(100), data.categoria || '');
        request.input('ref', mssql.NVarChar(255), data.referencia || '');
        request.input('origen', mssql.NVarChar(50), data.origen || 'MANUAL');
        request.input('obs', mssql.NVarChar(500), data.observacion || '');

        await request.query(`
            INSERT INTO FINANCE_EGRESOS (Fecha, Monto, Banco, TipoEgreso, Comercio, Categoria, Referencia, Origen, Observacion, CreatedAt, UpdatedAt)
            VALUES (@fecha, @monto, @banco, @tipo, @comercio, @categoria, @ref, @origen, @obs, GETDATE(), GETDATE())
        `);

        res.status(201).json({ success: true, message: 'Egreso registrado correctamente' });
    } catch (error) {
        console.error('Error creating egreso:', error);
        res.status(500).json({ error: 'Error al registrar egreso' });
    }
});

app.delete('/api/finance/egresos/:id', async (req, res) => {
    try {
        const pool = await poolFinance;
        await pool.request()
            .input('id', mssql.Int, req.params.id)
            .query('DELETE FROM FINANCE_EGRESOS WHERE ID = @id');
        res.json({ success: true, message: 'Egreso eliminado' });
    } catch (error) {
        console.error('Error deleting egreso:', error);
        res.status(500).json({ error: 'Error al eliminar egreso' });
    }
});


app.get('/api/vacaciones', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const employeeId = req.query.employeeId;

        let query = `
            SELECT v.*, e.NOMBRE, e.APELLIDOS 
            FROM EMPLOYEE_VACATIONS v
            JOIN EMPLOYEES e ON v.ID_EMPLOYEE = e.ID_EMPLOYEE
        `;

        const request = pool.request();
        if (employeeId) {
            query += ' WHERE v.ID_EMPLOYEE = @empId';
            request.input('empId', mssql.Int, employeeId);
        }

        query += ' ORDER BY v.FECHA_INICIO DESC';

        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Error fetching vacations:', error);
        res.status(500).json({ error: 'Error al obtener vacaciones' });
    }
});

app.post('/api/vacaciones', async (req, res) => {
    try {
        const data = req.body;
        const pool = await poolPlanilla;
        const request = pool.request();

        request.input('empId', mssql.Int, data.idEmployee);
        request.input('start', mssql.Date, new Date(data.fechaInicio));
        request.input('end', mssql.Date, new Date(data.fechaFin));
        request.input('days', mssql.Int, data.diasUtiles);
        request.input('status', mssql.VarChar(50), data.estado || 'PROGRAMADO');
        request.input('obs', mssql.NVarChar(mssql.MAX), data.observaciones || '');

        await request.query(`
            INSERT INTO EMPLOYEE_VACATIONS (ID_EMPLOYEE, FECHA_INICIO, FECHA_FIN, DIAS_UTILES, ESTADO, OBSERVACIONES, CREATED_AT, UPDATED_AT)
            VALUES (@empId, @start, @end, @days, @status, @obs, GETDATE(), GETDATE())
        `);

        res.status(201).json({ success: true, message: 'Vacaciones registradas correctamente' });
    } catch (error) {
        console.error('Error creating vacation:', error);
        res.status(500).json({ error: 'Error al registrar vacaciones' });
    }
});

app.put('/api/vacaciones/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const pool = await poolPlanilla;
        const request = pool.request();

        request.input('id', mssql.Int, id);
        request.input('start', mssql.Date, new Date(data.fechaInicio));
        request.input('end', mssql.Date, new Date(data.fechaFin));
        request.input('days', mssql.Int, data.diasUtiles);
        request.input('status', mssql.VarChar(50), data.estado);
        request.input('obs', mssql.NVarChar(mssql.MAX), data.observaciones || '');

        await request.query(`
            UPDATE EMPLOYEE_VACATIONS 
            SET FECHA_INICIO = @start,
                FECHA_FIN = @end,
                DIAS_UTILES = @days,
                ESTADO = @status,
                OBSERVACIONES = @obs,
                UPDATED_AT = GETDATE()
            WHERE ID = @id
        `);

        res.json({ success: true, message: 'Vacaciones actualizadas correctamente' });
    } catch (error) {
        console.error('Error updating vacation:', error);
        res.status(500).json({ error: 'Error al actualizar vacaciones' });
    }
});

app.delete('/api/vacaciones/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, id)
            .query('DELETE FROM EMPLOYEE_VACATIONS WHERE ID = @id');
        res.json({ success: true, message: 'Vacaciones eliminadas' });
    } catch (error) {
        console.error('Error deleting vacation:', error);
        res.status(500).json({ error: 'Error al eliminar vacaciones' });
    }
});



cron.schedule('*/30 * * * *', async () => {
    try {
        console.log('[CRON] Starting automatic Gmail synchronization...');
        const portToUse = process.env.PORT || port;
        const response = await axios.get(`http://localhost:${portToUse}/api/gmail/process?autoCreate=true&days=3`, {
            timeout: 60000
        });

        if (response.data && response.data.success) {
            console.log(`[CRON] Gmail sync complete. Scanned: ${response.data.totalScanned}, Saved: ${response.data.totalSaved}`);
        } else {
            console.error('[CRON] Gmail sync returned failure:', response.data);
        }
    } catch (error) {
        console.error('[CRON] Critical error in Gmail sync job:', error.message);
    }
});

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(distPath, 'index.html'), (err) => {
            if (err) {
                res.status(404).send("Frontend not found in 'public' folder. Check volumes.");
            }
        });
    }
});

app.use((err, req, res, next) => {
    console.error('SERVER_ERROR:', err);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED_REJECTION:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT_EXCEPTION:', err);
});
