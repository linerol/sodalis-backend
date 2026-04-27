const { Router } = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const pool = require('../db');
const validate = require('../middleware/validate');

if (!process.env.JWT_SECRET) throw new Error('[FATAL] JWT_SECRET non défini — démarrage refusé');
const JWT_SECRET = process.env.JWT_SECRET;

const router = Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de tentatives — réessayez dans 15 minutes' },
});

// POST /auth/register — Inscription
router.post('/register',
    authLimiter,
    body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Nom requis (1-100 caractères)'),
    body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
    body('password').isLength({ min: 8 }).withMessage('Mot de passe : 8 caractères minimum'),
    validate,
    async (req, res) => {
        const { name, email, password, coloc_id } = req.body;

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const { rows } = await pool.query(
                'INSERT INTO users (name, email, password, coloc_id) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
                [name, email, hashedPassword, coloc_id || null],
            );

            res.status(201).json(rows[0]);
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Cet email est déjà utilisé' });
            }
            throw err;
        }
    },
);

// POST /auth/login — Connexion
router.post('/login',
    authLimiter,
    body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
    body('password').notEmpty().withMessage('Mot de passe requis'),
    validate,
    async (req, res) => {
        const { email, password } = req.body;

        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, coloc_id: user.coloc_id, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' },
        );

        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
        });
    },
);

module.exports = router;
