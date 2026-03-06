import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { poolPlanilla, poolFinance } from './config/dbSql.js';
import mssql from 'mssql';

const app = express();
const port = 3005;

app.use(cors());
app.use(express.json());

import dniRoutes from './routes/dniRoutes.js';
app.use('/api/reniec', dniRoutes);

app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const pool = await poolPlanilla;
        const now = new Date();
        const currentMonth = now.getMonth() + 1;

        // 1. Nómina Total (Sueldos Base) y Conteo
        const payrollRes = await pool.request()
            .query('SELECT SUM(SUELDO_BASE) as total, COUNT(*) as count FROM EMPLOYEES WHERE ACTIVO = 1 OR ACTIVO IS NULL');

        const totalPayroll = payrollRes.recordset[0].total || 0;
        const activeCount = payrollRes.recordset[0].count || 0;

        // 2. Cumpleaños del Mes
        const birthdayRes = await pool.request()
            .input('month', mssql.Int, currentMonth)
            .query('SELECT NOMBRE, APELLIDOS, FECHA_NACIMIENTO FROM EMPLOYEES WHERE MONTH(FECHA_NACIMIENTO) = @month AND (ACTIVO = 1 OR ACTIVO IS NULL)');

        const birthdays = birthdayRes.recordset.map(emp => ({
            name: `${emp.NOMBRE} ${emp.APELLIDOS}`,
            date: emp.FECHA_NACIMIENTO ? new Date(emp.FECHA_NACIMIENTO).toLocaleDateString('es-ES', { day: '2-digit', month: 'long' }) : 'N/A'
        }));

        // 3. Vencimiento de Contrato (Próximos 30 días)
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

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const pool = await poolPlanilla;

        // 1. Verificar si está bloqueado (3 intentos fallidos en los últimos 30 min)
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

        // 2. Registrar el intento
        await pool.request()
            .input('email', mssql.VarChar, email)
            .input('ip', mssql.VarChar, ip)
            .input('success', mssql.Bit, success ? 1 : 0)
            .query('INSERT INTO LOGIN_ATTEMPTS (EMAIL, IP_ADDRESS, SUCCESS) VALUES (@email, @ip, @success)');

        if (success) {
            const user = result.recordset[0];

            // Si tiene éxito, lipiamos intentos fallidos previos para este email/ip
            await pool.request()
                .input('email', mssql.VarChar, email)
                .input('ip', mssql.VarChar, ip)
                .query('DELETE FROM LOGIN_ATTEMPTS WHERE EMAIL = @email AND IP_ADDRESS = @ip AND SUCCESS = 0');

            res.json({
                success: true,
                message: 'Login exitoso',
                user: {
                    email: user.EMAIL,
                    fullName: user.FULL_NAME, // Enviamos el nombre completo
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

// Endpoints de Administración de Seguridad
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

        // Verificar si el usuario ya existe
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
        const result = await pool.request().query("SELECT * FROM EMPLOYEES WHERE ACTIVO = 0");
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
            estado: 'Inactivo'
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
        }));

        res.json([...empleados, ...historicosMongo]);
    } catch (error) {
        console.error('Error al obtener empleados archivados de SQL:', error);
        res.status(500).json({ error: 'Error al obtener empleados archivados' });
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

// --- ENDPOINTS PLANILLA_BORRADOR ---
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
// --- END ENDPOINTS PLANILLA_BORRADOR ---

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
        request.input('fechaFin', mssql.Date, null); // Always clear end of contract when rehiring
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
        const pool = await poolPlanilla;
        await pool.request()
            .input('id', mssql.Int, req.params.id)
            .query("UPDATE EMPLOYEES SET ACTIVO = 0, FECHA_FIN_CONTRATO = GETDATE() WHERE ID_EMPLOYEE = @id");
        res.json({ message: 'Empleado dado de baja exitosamente' });
    } catch (error) {
        console.error('Error al dar de baja empleado en SQL:', error);
        res.status(500).json({ error: 'Error al dar de baja empleado' });
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
                insertRequest.input('obs', mssql.NVarChar, emp.observaciones || null); // Changed from '' to null
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
                apellidos: d.Apellidos || null, // Changed from '' to null
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
                observaciones: d.Observaciones || null // Changed from '' to null
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

async function syncWhmcsInvoices() {
    console.log('Starting WHMCS sync...');
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let allInvoices = [];
    let limitstart = 0;
    const limitnum = 100;
    let totalresults = 0;
    let stopEarly = false;

    do {
        const params = new URLSearchParams();
        params.append('identifier', WHMCS_IDENTIFIER);
        params.append('secret', WHMCS_SECRET);
        params.append('action', 'GetInvoices');
        params.append('responsetype', 'json');
        params.append('limitstart', limitstart.toString());
        params.append('limitnum', limitnum.toString());
        params.append('orderby', 'date');
        params.append('order', 'desc');

        const response = await axios.post(WHMCS_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const data = response.data;
        if (data.result !== 'success') throw new Error(`WHMCS Sync Error: ${data.message}`);

        totalresults = parseInt(data.totalresults) || 0;
        const invoices = data.invoices?.invoice || [];

        for (const inv of invoices) {
            const d = new Date(inv.date);
            if (d.getFullYear() < currentYear || (d.getFullYear() === currentYear && d.getMonth() < currentMonth)) {
                stopEarly = true;
                break;
            }
            allInvoices.push(inv);
        }

        if (stopEarly) break;
        limitstart += limitnum;
    } while (limitstart < totalresults);
    console.log(`Procesando ${allInvoices.length} facturas para insertar/actualizar en la base de datos FINANCE...`);
    const pool = await poolFinance;
    for (const inv of allInvoices) {
        const request = pool.request();
        request.input('whmcsId', mssql.Int, inv.id);
        request.input('fecha', mssql.Date, inv.date);
        request.input('cliente', mssql.NVarChar(255), inv.companyname || `${inv.firstname} ${inv.lastname}`);
        request.input('numFactura', mssql.NVarChar(50), inv.invoicenum);
        request.input('total', mssql.Decimal(18, 2), parseFloat(inv.total));
        request.input('estado', mssql.NVarChar(50), inv.status);
        request.input('pagado', mssql.Decimal(18, 2), parseFloat(inv.amountpaid || 0));
        request.input('moneda', mssql.NVarChar(10), inv.currencycode);
        request.input('now', mssql.DateTime, new Date());

        await request.query(`
            IF EXISTS (SELECT 1 FROM FINANCE_INVOICES WHERE WHMCS_InvoiceID = @whmcsId)
            BEGIN
                UPDATE FINANCE_INVOICES SET 
                    EstadoWHMCS = @estado, 
                    Pagado = @pagado, 
                    UpdatedAt = @now
                WHERE WHMCS_InvoiceID = @whmcsId
            END
            ELSE
            BEGIN
                INSERT INTO FINANCE_INVOICES (WHMCS_InvoiceID, Fecha, ClienteConcepto, NumFactura, MontoBruto, EstadoWHMCS, Pagado, Moneda, CreatedAt, UpdatedAt)
                VALUES (@whmcsId, @fecha, @cliente, @numFactura, @total, @estado, @pagado, @moneda, @now, @now)
            END
        `);
    }

    lastSyncTime = Date.now();
    console.log(`Sync complete. Processed ${allInvoices.length} current month invoices.`);
}

app.get('/api/whmcs/invoices', async (req, res) => {
    try {
        const now = new Date();
        const forceSync = req.query.sync === 'true';

        if (forceSync || !lastSyncTime || (Date.now() - lastSyncTime > SYNC_COOLDOWN)) {
            await syncWhmcsInvoices();
        }

        const pool = await poolFinance;
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        const result = await pool.request()
            .input('month', mssql.Int, currentMonth)
            .input('year', mssql.Int, currentYear)
            .query(`
                SELECT * FROM FINANCE_INVOICES 
                WHERE MONTH(Fecha) = @month AND YEAR(Fecha) = @year
                ORDER BY Fecha DESC
            `);

        const invoices = result.recordset.map(inv => ({
            id: inv.WHMCS_InvoiceID,
            localId: inv.ID,
            fecha: inv.Fecha,
            clienteConcepto: inv.ClienteConcepto,
            numFactura: inv.NumFactura,
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
            estadoLocal: inv.EstadoLocal
        }));

        const thisMonthPaid = invoices.reduce((sum, inv) => sum + (inv.pagado || 0), 0);
        const thisMonthTotal = invoices.reduce((sum, inv) => sum + (inv.montoBruto || 0), 0);

        res.json({
            totalresults: invoices.length,
            thisMonthPaid,
            thisMonthTotal,
            invoices: invoices
        });
    } catch (error) {
        console.error('Error fetching invoices:', error.message);
        res.status(500).json({ error: 'Error al obtener facturas' });
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


app.listen(port, () => {
    console.log(`Backend listening at http://localhost:${port}`);
});
