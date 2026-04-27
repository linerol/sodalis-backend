const { Router } = require('express');
const { body, param } = require('express-validator');
const pool = require('../db');
const { verifyUser } = require('../grpc-client');
const publisher = require('../redis-publisher');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = Router();

const VALID_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'];

// POST /tasks — Créer une tâche
router.post('/',
    auth,
    body('title').trim().isLength({ min: 1, max: 150 }).withMessage('Titre requis (1-150 caractères)'),
    body('assignee_id').isUUID().withMessage('assignee_id doit être un UUID valide'),
    body('coloc_id').isUUID().withMessage('coloc_id doit être un UUID valide'),
    validate,
    async (req, res) => {
        const { title, assignee_id, coloc_id } = req.body;

        const { is_valid, message } = await verifyUser({ user_id: assignee_id, coloc_id });

        if (!is_valid) {
            return res.status(403).json({ error: message });
        }

        const { rows } = await pool.query(
            'INSERT INTO tasks (title, assignee_id, coloc_id) VALUES ($1, $2, $3) RETURNING *',
            [title, assignee_id, coloc_id],
        );

        await publisher.publish('sodalis_events', JSON.stringify({
            type: 'NEW_TASK',
            coloc_id,
            message: `Nouvelle tâche assignée : ${title}`,
        }));

        await publisher.del(`dashboard_coloc_${coloc_id}`);

        res.status(201).json(rows[0]);
    },
);

// PATCH /tasks/:id/status — Mettre à jour le statut d'une tâche
router.patch('/:id/status',
    auth,
    param('id').isUUID().withMessage('id doit être un UUID valide'),
    body('status').isIn(VALID_STATUSES).withMessage(`status doit être : ${VALID_STATUSES.join(', ')}`),
    validate,
    async (req, res) => {
        const { status } = req.body;

        const { rows } = await pool.query(
            'SELECT id, coloc_id, title FROM tasks WHERE id = $1',
            [req.params.id],
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Tâche introuvable' });
        }

        const task = rows[0];

        if (req.user.coloc_id !== task.coloc_id) {
            return res.status(403).json({ error: 'Non autorisé — Vous n\'appartenez pas à cette colocation' });
        }

        const { rows: updated } = await pool.query(
            'UPDATE tasks SET status = $1 WHERE id = $2 RETURNING *',
            [status, req.params.id],
        );

        await publisher.publish('sodalis_events', JSON.stringify({
            type: 'TASK_UPDATED',
            coloc_id: task.coloc_id,
            task_id: task.id,
            status,
            message: `Tâche "${task.title}" mise à jour : ${status}`,
        }));

        await publisher.del(`dashboard_coloc_${task.coloc_id}`);

        res.json(updated[0]);
    },
);

// GET /tasks?coloc_id=xxx — Lister les tâches (query param)
router.get('/', auth, async (req, res) => {
    const { coloc_id } = req.query;

    if (!coloc_id) {
        return res.status(400).json({ error: '"coloc_id" est requis en query param' });
    }

    const { rows } = await pool.query(
        'SELECT * FROM tasks WHERE coloc_id = $1 ORDER BY created_at DESC',
        [coloc_id],
    );

    res.json(rows);
});

// GET /tasks/coloc/:id — Lister les tâches avec pagination (utilisé par la Gateway)
router.get('/coloc/:id', auth, async (req, res) => {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [{ rows }, { rows: countRows }] = await Promise.all([
        pool.query(
            'SELECT * FROM tasks WHERE coloc_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
            [req.params.id, limit, offset],
        ),
        pool.query(
            'SELECT COUNT(*) AS total FROM tasks WHERE coloc_id = $1',
            [req.params.id],
        ),
    ]);

    res.json({ data: rows, pagination: { page, limit, total: parseInt(countRows[0].total) } });
});

module.exports = router;
