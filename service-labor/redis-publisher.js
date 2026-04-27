const redis = require('redis');

const publisher = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

publisher.on('error', (err) => console.error('❌ Erreur Redis :', err.message));
publisher.connect().then(() => console.log('📡 Labor connecté à Redis (Publisher)'));

module.exports = publisher;
