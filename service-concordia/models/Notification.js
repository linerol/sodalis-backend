const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    coloc_id: { type: String, required: true, index: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Notification', notificationSchema);
