const { Router } = require('express');
const pool = require('../db');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');

if (!process.env.JWT_SECRET) throw new Error('[FATAL] JWT_SECRET non défini — démarrage refusé');
const JWT_SECRET = process.env.JWT_SECRET;

const router = Router();

// POST /colocs — Créer une coloc (transaction : crée + assigne le créateur comme ADMIN)
router.post('/',
    auth,
    body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Nom requis (1-100 caractères)'),
    validate,
    async (req, res) => {
        const { name } = req.body;

        const normalized = name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 15);

        const suffix = crypto.randomBytes(2).toString('hex');
        const generatedCode = `${normalized || 'coloc'}-${suffix}`;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { rows: [coloc] } = await client.query(
                'INSERT INTO colocs (name, invite_code) VALUES ($1, $2) RETURNING *',
                [name, generatedCode],
            );

            await client.query(
                'UPDATE users SET coloc_id = $1, role = $2 WHERE id = $3',
                [coloc.id, 'ADMIN', req.user.id],
            );

            await client.query('COMMIT');

            const token = jwt.sign(
                { id: req.user.id, email: req.user.email, coloc_id: coloc.id, role: 'ADMIN' },
                JWT_SECRET,
                { expiresIn: '24h' },
            );

            res.status(201).json({ coloc, token });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    },
);

// POST /colocs/join — Rejoindre une coloc via invite_code
router.post('/join',
    auth,
    body('invite_code').trim().isLength({ min: 4, max: 20 }).withMessage('Code d\'invitation invalide'),
    validate,
    async (req, res) => {
        const { invite_code } = req.body;

        if (req.user.coloc_id) {
            return res.status(409).json({ error: 'Vous êtes déjà dans une colocation' });
        }

        const { rows } = await pool.query(
            'SELECT id, name, invite_code FROM colocs WHERE invite_code = $1',
            [invite_code],
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Code d\'invitation invalide' });
        }

        const coloc = rows[0];

        await pool.query(
            'UPDATE users SET coloc_id = $1 WHERE id = $2',
            [coloc.id, req.user.id],
        );

        const token = jwt.sign(
            { id: req.user.id, email: req.user.email, coloc_id: coloc.id, role: req.user.role },
            JWT_SECRET,
            { expiresIn: '24h' },
        );

        res.json({ coloc, token });
    },
);

// GET /colocs/:id/users — Membres d'une coloc
router.get('/:id/users', auth, async (req, res) => {
    const { rows } = await pool.query(
        'SELECT id, name, email, role, created_at FROM users WHERE coloc_id = $1',
        [req.params.id],
    );

    res.json(rows);
});

module.exports = router;
