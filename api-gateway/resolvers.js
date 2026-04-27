const axios = require('axios');
const logger = require('./logger');
const cache = require('./cache');

const { DOMUS_URL, LABOR_URL } = process.env;
const CACHE_TTL = 30;

const resolvers = {
    Query: {
        usersByColoc: async (_, { colocId }, { user, req }) => {
            if (!user || (user.role !== 'ADMIN' && user.coloc_id !== colocId)) {
                throw new Error('Non autorisé — Vous n\'appartenez pas à cette colocation');
            }

            const { data } = await axios.get(`${DOMUS_URL}/colocs/${colocId}/users`, {
                headers: { Authorization: req.headers.authorization },
            });
            return data;
        },

        tasksByColoc: async (_, { colocId }, { user, req }) => {
            if (!user || (user.role !== 'ADMIN' && user.coloc_id !== colocId)) {
                throw new Error('Non autorisé — Vous n\'appartenez pas à cette colocation');
            }

            const { data } = await axios.get(`${LABOR_URL}/tasks/coloc/${colocId}`, {
                headers: { Authorization: req.headers.authorization },
            });
            return data.data || data;
        },

        getColocDashboard: async (_, { colocId }, { user, req }) => {
            if (!user || (user.role !== 'ADMIN' && user.coloc_id !== colocId)) {
                throw new Error('Non autorisé — Vous n\'appartenez pas à cette colocation');
            }

            const cacheKey = `dashboard_coloc_${colocId}`;

            const cached = await cache.get(cacheKey);
            if (cached) {
                logger.info('Dashboard depuis le cache Redis');
                return JSON.parse(cached);
            }

            logger.info('Cache miss — appel des microservices...');

            const [usersRes, tasksRes] = await Promise.all([
                axios.get(`${DOMUS_URL}/colocs/${colocId}/users`, {
                    headers: { Authorization: req.headers.authorization },
                }),
                axios.get(`${LABOR_URL}/tasks/coloc/${colocId}`, {
                    headers: { Authorization: req.headers.authorization },
                }),
            ]);

            const dashboard = {
                users: usersRes.data,
                tasks: tasksRes.data.data || tasksRes.data,
            };

            await cache.setEx(cacheKey, CACHE_TTL, JSON.stringify(dashboard));

            return dashboard;
        },
    },

    Mutation: {
        createColoc: async (_, { name }, { req }) => {
            const { data } = await axios.post(
                `${DOMUS_URL}/colocs`,
                { name },
                { headers: { Authorization: req.headers.authorization } },
            );
            return data;
        },

        joinColoc: async (_, { invite_code }, { user, req }) => {
            if (!user) throw new Error('Non autorisé');
            const { data } = await axios.post(
                `${DOMUS_URL}/colocs/join`,
                { invite_code },
                { headers: { Authorization: req.headers.authorization } },
            );
            return data;
        },

        createTask: async (_, { title, assignee_id, coloc_id }, { req }) => {
            const { data } = await axios.post(
                `${LABOR_URL}/tasks`,
                { title, assignee_id, coloc_id },
                { headers: { Authorization: req.headers.authorization } },
            );
            return data;
        },

        updateTaskStatus: async (_, { id, status }, { user, req }) => {
            if (!user) throw new Error('Non autorisé');
            const { data } = await axios.patch(
                `${LABOR_URL}/tasks/${id}/status`,
                { status },
                { headers: { Authorization: req.headers.authorization } },
            );
            return data;
        },
    },
};

module.exports = resolvers;
