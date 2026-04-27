require('dotenv').config();

const express = require('express');
const pinoHttp = require('pino-http');
const logger = require('./logger');
const pool = require('./db');
const publisher = require('./redis-publisher');
const tasksRouter = require('./routes/tasks');

const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json());

app.use('/tasks', tasksRouter);

app.get('/health', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok' });
    } catch {
        res.status(503).json({ status: 'db_unreachable' });
    }
});

app.use((err, _req, res, _next) => {
    logger.error(err);

    if (err.code === 14) {
        return res.status(502).json({ error: 'Service Domus injoignable (gRPC)' });
    }

    res.status(err.status ?? 500).json({
        error: err.message ?? 'Erreur interne',
    });
});

const PORT = process.env.PORT || 3002;
const server = app.listen(PORT, () => logger.info(`Service Labor démarré → http://localhost:${PORT}`));

async function shutdown(signal) {
    logger.info({ signal }, 'Arrêt en cours...');
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await publisher.quit();
    logger.info('Shutdown complet');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
