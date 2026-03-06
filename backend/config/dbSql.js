import mssql from 'mssql';
import dotenv from 'dotenv';
import { getSecret } from '../utils/secrets.js';
dotenv.config();

const baseConfig = {
    user: getSecret('SQL_USER', 'sa'),
    password: getSecret('SQL_PASSWORD', 'TuPasswordFuerte123!'),
    server: getSecret('SQL_SERVER', '15.235.16.229'),
    options: {
        encrypt: true,
        trustServerCertificate: true,
        cryptoCredentialsDetails: {
            checkServerIdentity: () => undefined
        }
    }
};

const configPlanilla = { ...baseConfig, database: 'PLANILLA' };
const configFinance = { ...baseConfig, database: 'FINANCE' };

export const poolPlanilla = new mssql.ConnectionPool(configPlanilla)
    .connect()
    .then(pool => {
        console.log('Connected to SQL Server - Database: PLANILLA');
        return pool;
    })
    .catch(err => {
        console.error('PLANILLA Database Connection Failed: ', err);
        throw err;
    });

export const poolFinance = new mssql.ConnectionPool(configFinance)
    .connect()
    .then(pool => {
        console.log('Connected to SQL Server - Database: FINANCE');
        return pool;
    })
    .catch(err => {
        console.error('FINANCE Database Connection Failed: ', err);
        throw err;
    });

export default mssql;
