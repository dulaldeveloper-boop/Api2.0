const express = require('express');
const router = express.Router();
const { getDb, getBucket } = require('../config/firebase');
const { sessions, sessionStates, sessionUserMap } = require('../modules/session');
const admin = require('firebase-admin');

// Disconnect via /api/disconnect/:id
router.delete('/disconnect/:id', async (req, res) => {
    try {
        await disconnectAccount(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Disconnect via /api/accounts/:id (Replit compatibility)
router.delete('/accounts/:id', async (req, res) => {
    try {
        await disconnectAccount(req.params.id);
        res.json({ success: true, message: 'Device disconnected' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

async function disconnectAccount(id) {
    const db = getDb();
    const bucket = getBucket();
    const sock = sessions.get(id);
    if (sock) { await sock.logout(); await sock.end(); }
    sessions.delete(id);
    sessionStates.delete(id);
    sessionUserMap.delete(id);

    await db.collection('whatsapp_accounts').doc(id).update({
        status: 'disconnected',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    try {
        const [files] = await bucket.getFiles({ prefix: `sessions/${id}/` });
        for (const file of files) await file.delete();
    } catch (e) {}
}

module.exports = router;