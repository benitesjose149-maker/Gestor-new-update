import mssql from 'mssql';
import net from 'net';
import dotenv from 'dotenv';
dotenv.config();

import { getSecret } from '../utils/secrets.js';

const sqlUser = getSecret('SQL_USER', 'sa');
const sqlPassword = getSecret('SQL_PASSWORD', 'TuPasswordFuerte123!');
const sqlServer = getSecret('SQL_SERVER', '15.235.16.229');
const sqlPort = parseInt(getSecret('SQL_PORT', '1433'), 10);

// === DIAGNOSTIC LOGGING ===
console.log('========================================');
console.log('[DB CONFIG] SQL Connection Diagnostics:');
console.log(`[DB CONFIG]   Server: "${sqlServer}"`);
console.log(`[DB CONFIG]   Port: ${sqlPort}`);
console.log(`[DB CONFIG]   User: "${sqlUser}" (${sqlUser.length} chars)`);
console.log(`[DB CONFIG]   Password length: ${sqlPassword.length} chars`);
console.log(`[DB CONFIG]   SQL_SERVER source: ${process.env.SQL_SERVER ? 'ENV variable' : 'Docker secret or default'}`);
console.log(`[DB CONFIG]   SQL_USER source: ${process.env.SQL_USER ? 'ENV variable' : 'Docker secret or default'}`);
console.log(`[DB CONFIG]   Node ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log('========================================');

const baseConfig = {
    user: sqlUser,
    password: sqlPassword,
    server: sqlServer,
    port: sqlPort,
    connectionTimeout: 30000,
    requestTimeout: 30000,
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    }
};

const configPlanilla = { ...baseConfig, database: 'PLANILLA' };
const configFinance = { ...baseConfig, database: 'FINANCE' };

// TCP connectivity test — checks if the port is reachable before SQL auth
function testTcpConnection(host, port, timeoutMs = 10000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeoutMs);
        socket.on('connect', () => {
            console.log(`✅ [TCP TEST] Port ${host}:${port} is REACHABLE`);
            socket.destroy();
            resolve(true);
        });
        socket.on('timeout', () => {
            console.error(`❌ [TCP TEST] Connection to ${host}:${port} TIMED OUT (${timeoutMs}ms)`);
            socket.destroy();
            resolve(false);
        });
        socket.on('error', (err) => {
            console.error(`❌ [TCP TEST] Cannot reach ${host}:${port} — ${err.message}`);
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, host);
    });
}

// Retry logic for container environments where DB may not be immediately reachable
async function connectWithRetry(config, dbName, maxRetries = 5, delayMs = 5000) {
    // First attempt: test raw TCP connectivity
    const tcpOk = await testTcpConnection(sqlServer, sqlPort);
    if (!tcpOk) {
        console.error(`⚠️ [DB] TCP test failed for ${sqlServer}:${sqlPort} — the server may be unreachable from this container/network`);
        console.error(`⚠️ [DB] Check: firewall rules, Docker network config, and that the SQL Server is accepting remote connections`);
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[DB] Connecting to ${dbName} (attempt ${attempt}/${maxRetries})...`);
            const pool = await new mssql.ConnectionPool(config).connect();
            console.log(`✅ Connected to SQL Server - Database: ${dbName}`);
            return pool;
        } catch (err) {
            console.error(`❌ ${dbName} connection attempt ${attempt} failed: ${err.message}`);
            if (err.code) console.error(`   Error code: ${err.code}`);
            if (err.originalError) console.error(`   Original: ${err.originalError.message}`);
            if (attempt < maxRetries) {
                console.log(`[DB] Retrying in ${delayMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            } else {
                console.error(`❌ ${dbName} - All ${maxRetries} connection attempts failed.`);
                console.error(`❌ FINAL CONFIG USED: server="${config.server}", port=${config.port}, user="${config.user}", db="${config.database}"`);
                throw err;
            }
        }
    }
}

export const poolPlanilla = connectWithRetry(configPlanilla, 'PLANILLA');
export const poolFinance = connectWithRetry(configFinance, 'FINANCE');

export default mssql;
