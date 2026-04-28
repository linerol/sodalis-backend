require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const redis = require('redis');
const pinoHttp = require('pino-http');
const logger = require('./logger');
const Notification = require('./models/Notification');
const auth = require('./middleware/auth');
const socialRoutes = require('./routes/social');
const karmaRoutes  = require('./routes/karma');
const publisher    = require('./redis-publisher');

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

const app = express();
app.use(
    cors({
        origin: corsOriginValidator,
        credentials: true,
        optionsSuccessStatus: 204,
    }),
);
app.use(pinoHttp({ logger }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: corsOriginValidator,
        credentials: true,
    },
});

app.use('/api', auth, socialRoutes);
app.use('/api', auth, karmaRoutes);

// ── MongoDB ──────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost:27017/concordia_db')
    .then(() => logger.info('Concordia connecté à MongoDB'))
    .catch((err) => logger.error({ err }, 'Erreur MongoDB'));

// ── Redis Subscriber ─────────────────────────────────────────
const subscriber = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

subscriber.on('error', (err) => logger.error({ err }, 'Erreur Redis'));

subscriber.connect().then(async () => {
    logger.info('Concordia écoute les événements Redis');

    await subscriber.subscribe('sodalis_events', async (message) => {
        let event;
        try {
            event = JSON.parse(message);
        } catch (err) {
            logger.error({ err }, 'Événement Redis malformé — message ignoré');
            return;
        }
        logger.info({ type: event.type, coloc_id: event.coloc_id }, 'Événement reçu');

        try {
            await Notification.create({
                coloc_id: event.coloc_id,
                type: event.type,
                message: event.message,
            });
        } catch (err) {
            logger.error({ err }, 'Erreur persistence notification');
        }

        if (event.type === 'NEW_TASK' || event.type === 'TASK_UPDATED') {
            io.emit(`coloc_${event.coloc_id}_notifications`, {
                type: event.type,
                message: event.message,
                ...(event.task_id && { task_id: event.task_id }),
                ...(event.status  && { status: event.status }),
            });
        }

        const MAINTENANCE_EVENTS = ['NEW_MAINTENANCE_TICKET', 'MAINTENANCE_TICKET_UPDATED', 'MAINTENANCE_TICKET_ASSIGNED'];
        if (MAINTENANCE_EVENTS.includes(event.type)) {
            io.emit(`coloc_${event.coloc_id}_notifications`, {
                type: event.type,
                message: event.message,
                ...(event.ticket_id   && { ticket_id: event.ticket_id }),
                ...(event.priority    && { priority: event.priority }),
                ...(event.status      && { status: event.status }),
                ...(event.assigned_to && { assigned_to: event.assigned_to }),
            });
        }

        if (['NEW_COMPLAINT', 'COMPLAINT_RESOLVED', 'COMPLAINT_DELETED'].includes(event.type)) {
            io.emit(`coloc_${event.coloc_id}_notifications`, {
                type: event.type,
                message: event.message,
                ...(event.complaint_id && { complaint_id: event.complaint_id }),
            });
        }

        if (event.type === 'COMPLAINT_TARGETED') {
            io.emit(`user_${event.target_id}_notifications`, {
                type: event.type,
                message: event.message,
                ...(event.complaint_id && { complaint_id: event.complaint_id }),
            });
        }

        if (['NEW_POLL', 'POLL_UPDATED'].includes(event.type)) {
            io.emit(`coloc_${event.coloc_id}_notifications`, {
                type: event.type,
                message: event.message,
                ...(event.poll_id  && { poll_id: event.poll_id }),
                ...(event.question && { question: event.question }),
            });
        }

        if (event.type === 'KARMA_UPDATED') {
            io.emit(`coloc_${event.coloc_id}_notifications`, {
                type: event.type,
                message: event.message,
                user_id: event.user_id,
                new_score: event.new_score,
            });
        }
    });
});

// ── Routes ───────────────────────────────────────────────────
app.get('/notifications/coloc/:id', auth, async (req, res) => {
    if (req.user.role !== 'ADMIN' && req.user.coloc_id !== req.params.id) {
        return res.status(403).json({ error: 'Non autorisé — Vous n\'appartenez pas à cette colocation' });
    }

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    try {
        const [notifications, total] = await Promise.all([
            Notification.find({ coloc_id: req.params.id })
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit),
            Notification.countDocuments({ coloc_id: req.params.id }),
        ]);
        res.json({ data: notifications, pagination: { page, limit, total } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── WebSockets ───────────────────────────────────────────────
io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Client connecté');
    socket.on('disconnect', () => logger.info({ socketId: socket.id }, 'Client déconnecté'));
});

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    });
});

// ── Global Error Handler ─────────────────────────────────────
app.use((err, _req, res, _next) => {
    logger.error({ err }, 'Erreur non gérée');
    res.status(err.status || 500).json({
        error: err.message || 'Erreur interne du serveur',
    });
});

// ── Démarrage ────────────────────────────────────────────────
const PORT = process.env.PORT || 3003;
server.listen(PORT, () => logger.info(`Service Concordia démarré → http://localhost:${PORT}`));

async function shutdown(signal) {
    logger.info({ signal }, 'Arrêt en cours...');
    io.close();
    await new Promise((resolve) => server.close(resolve));
    await publisher.quit();
    await subscriber.quit();
    await mongoose.connection.close();
    logger.info('Shutdown complet');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
