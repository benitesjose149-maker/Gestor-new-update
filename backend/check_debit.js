import { poolFinance } from './config/dbSql.js';

async function check() {
    const pool = await poolFinance;
    const res = await pool.request().query('SELECT * FROM debit_accounts ORDER BY ID_Account');
    console.log("--- Debit Accounts ---");
    res.recordset.forEach(r => {
        console.log(JSON.stringify(r));
    });
    process.exit(0);
}

check().catch(e => {
    console.log("Error querying ID_Account. Trying id instead.");
    poolFinance.then(pool => 
        pool.request().query('SELECT * FROM debit_accounts')
    ).then(res => {
         res.recordset.forEach(r => console.log(JSON.stringify(r)));
         process.exit(0);
    }).catch(e => console.error(e));
});
