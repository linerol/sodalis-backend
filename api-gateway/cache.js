const redis = require('redis');

const client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

client.on('error', (err) => console.error('❌ Erreur Redis Cache :', err.message));
client.connect().then(() => console.log('🗄️  Gateway connectée au Cache Redis'));

module.exports = client;
