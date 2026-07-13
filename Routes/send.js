const express = require('express');
const router = express.Router();
const { getDb } = require('../config/firebase');
const { sessions, sessionStates, todayCounts } = require('../modules/session');
const admin = require('firebase-admin');

// Send single message
router.post('/send', async (req, res) => {
    try {
        const { accountId, to, text, userId } = req.body;
        const db = getDb();
        const sock = sessions.get(accountId);

        if (!sock || sessionStates.get(accountId)?.status !== 'connected') {
            return res.status(400).json({
                success: false,
                error: 'Account not connected',
                status: sessionStates.get(accountId)?.status || 'unknown'
            });
        }

        // Clean recipient phone
        let cleanTo = String(to).replace(/\D/g, '');
        if (cleanTo.startsWith('0')) cleanTo = cleanTo.slice(1);
        if (!cleanTo.startsWith('880')) cleanTo = '880' + cleanTo;
        
        const jidTo = `${cleanTo}@s.whatsapp.net`;
        const result = await sock.sendMessage(jidTo, { text });

        if (!result?.key?.id) {
            return res.status(400).json({ success: false, error: 'Message not confirmed' });
        }

        // Increment count
        const newCount = (todayCounts.get(accountId) || 0) + 1;
        todayCounts.set(accountId, newCount);
        await db.collection('whatsapp_accounts').doc(accountId).update({
            todaySent: newCount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Save log
        await db.collection('message_logs').add({
            accountId, userId: userId || '', to: jidTo, text,
            status: 'sent', messageId: result.key.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, messageId: result.key.id, todaySent: newCount });
    } catch (err) {
        // Save failed log
        const db = getDb();
        await db.collection('message_logs').add({
            accountId: req.body.accountId, userId: req.body.userId || '',
            to: req.body.to, text: req.body.text, status: 'failed',
            error: err.message, createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(400).json({ success: false, error: err.message, isLoggedOut: err.message?.includes('logged out') || false });
    }
});

module.exports = router;