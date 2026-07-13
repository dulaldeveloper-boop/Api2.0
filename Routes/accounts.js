const express = require('express');
const router = express.Router();
const { getDb } = require('../config/firebase');
const { sessionStates, todayCounts, dailyLimits } = require('../modules/session');

// List all accounts (filter by userId)
router.get('/accounts', async (req, res) => {
    try {
        const { userId } = req.query;
        const db = getDb();
        let query = db.collection('whatsapp_accounts').orderBy('updatedAt', 'desc');
        if (userId) query = query.where('userId', '==', userId);
        const snap = await query.get();
        const accounts = [];
        snap.forEach(doc => accounts.push({ id: doc.id, ...doc.data() }));
        res.json(accounts);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Single account status
router.get('/status/:id', (req, res) => {
    const state = sessionStates.get(req.params.id);
    if (!state) return res.json({ status: 'not_found' });
    res.json({
        id: req.params.id,
        ...state,
        todaySent: todayCounts.get(req.params.id) || 0,
        dailyLimit: dailyLimits.get(req.params.id) || 5
    });
});

// Set daily limit
router.post('/limit/:id', async (req, res) => {
    const { limit } = req.body;
    const db = getDb();
    dailyLimits.set(req.params.id, parseInt(limit) || 5);
    await db.collection('whatsapp_accounts').doc(req.params.id).update({ dailyLimit: parseInt(limit) || 5 });
    res.json({ success: true, dailyLimit: parseInt(limit) || 5 });
});

module.exports = router;