const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => console.error('❌ Erreur inattendue PostgreSQL :', err.message));

module.exports = pool;
