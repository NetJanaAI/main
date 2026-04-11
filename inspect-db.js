const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function inspectSchema() {
    const client = await pool.connect();
    try {
        const res = await client.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `);
        console.table(res.rows);
    } finally {
        client.release();
        await pool.end();
    }
}

inspectSchema().catch(console.error);
