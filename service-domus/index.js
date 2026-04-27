require('dotenv').config();

const express = require('express');
const pinoHttp = require('pino-http');
const logger = require('./logger');
const pool = require('./db');
const colocsRouter = require('./routes/colocs');
const usersRouter = require('./routes/users');
const authRouter = require('./routes/auth');
const startGrpcServer = require('./grpc-server');

const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json());

app.use('/auth', authRouter);
app.use('/colocs', colocsRouter);
app.use('/users', usersRouter);

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

    if (err.code === '23505') {
        return res.status(409).json({ error: 'Doublon — cette ressource existe déjà' });
    }

    res.status(err.status ?? 500).json({
        error: err.message ?? 'Erreur interne',
    });
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
    logger.info(`Service Domus démarré → http://localhost:${PORT}`);
    startGrpcServer();
});

async function shutdown(signal) {
    logger.info({ signal }, 'Arrêt en cours...');
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    logger.info('Shutdown complet');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
