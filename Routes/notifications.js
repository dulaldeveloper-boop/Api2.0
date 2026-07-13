const express = require('express');
const router = express.Router();
const { getDb } = require('../config/firebase');

// Get notifications
router.get('/notifications/:userId', async (req, res) => {
    try {
        const db = getDb();
        const snap = await db.collection('notifications')
            .where('userId', '==', req.params.userId)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
        const notifications = [];
        snap.forEach(doc => notifications.push({ id: doc.id, ...doc.data() }));
        res.json(notifications);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Mark as read
router.post('/notifications/read', async (req, res) => {
    try {
        const db = getDb();
        await db.collection('notifications').doc(req.body.notificationId).update({ read: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;