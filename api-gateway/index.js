require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@as-integrations/express5');
const jwt = require('jsonwebtoken');
const pinoHttp = require('pino-http');
const logger = require('./logger');
const cache = require('./cache');
const typeDefs = require('./schema');
const resolvers = require('./resolvers');

if (!process.env.JWT_SECRET) throw new Error('[FATAL] JWT_SECRET non défini — démarrage refusé');
const JWT_SECRET = process.env.JWT_SECRET;

function parseCorsOriginsFromEnv() {
    const rawList = process.env.CORS_ORIGINS;
    const rawSingle = process.env.CORS_ORIGIN;

    const list = (rawList || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    if (list.length > 0) return new Set(list);
    if (rawSingle && rawSingle.trim()) return new Set([rawSingle.trim()]);

    return new Set(['http://localhost:3000']);
}

const CORS_ORIGINS = parseCorsOriginsFromEnv();
function corsOriginValidator(origin, cb) {
    // Autorise les requêtes sans header Origin (curl / server-to-server)
    if (!origin) return cb(null, true);
    if (CORS_ORIGINS.has(origin)) return cb(null, true);
    return cb(new Error(`CORS refusé pour l'origine: ${origin}`));
}

async function start() {
    const app = express();

    const server = new ApolloServer({ typeDefs, resolvers });
    await server.start();

    app.use(pinoHttp({ logger }));

    app.use(
        '/graphql',
        cors({
            origin: corsOriginValidator,
            credentials: true,
            optionsSuccessStatus: 204,
        }),
        express.json(),
        expressMiddleware(server, {
            context: async ({ req }) => {
                const authHeader = req.headers.authorization;
                let user = null;

                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const token = authHeader.split(' ')[1];
                    try {
                        user = jwt.verify(token, JWT_SECRET);
                    } catch {
                        logger.warn('Token invalide ignoré');
                    }
                }

                return { user, req };
            },
        }),
    );

    app.get('/health', (_req, res) => res.json({ status: 'ok' }));

    const PORT = process.env.PORT || 4000;
    const httpServer = app.listen(PORT, () =>
        logger.info(`API Gateway démarrée → http://localhost:${PORT}/graphql`),
    );

    async function shutdown(signal) {
        logger.info({ signal }, 'Arrêt en cours...');
        await server.stop();
        await new Promise((resolve) => httpServer.close(resolve));
        await cache.quit();
        logger.info('Shutdown complet');
        process.exit(0);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
}

start();
