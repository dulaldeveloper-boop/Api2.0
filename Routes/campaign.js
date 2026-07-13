const express = require('express');
const router = express.Router();
const { getDb } = require('../config/firebase');
const { runCampaign } = require('../modules/campaign');
const admin = require('firebase-admin');

// Start campaign
router.post('/campaign/start', async (req, res) => {
    try {
        const { userId, name, message, targets, pricePerMessage } = req.body;
        if (!userId || !targets || targets.length === 0) {
            return res.status(400).json({ success: false, error: 'Missing fields' });
        }

        const db = getDb();

        // Check connected accounts
        const accSnap = await db.collection('whatsapp_accounts')
            .where('userId', '==', userId)
            .where('status', '==', 'connected')
            .get();
        if (accSnap.empty) {
            return res.status(400).json({ success: false, error: 'No connected accounts. Connect first.' });
        }

        const campaignRef = db.collection('campaigns').doc();
        const campaignId = campaignRef.id;

        await campaignRef.set({
            userId, name, message,
            totalTargets: targets.length,
            sentCount: 0, failedCount: 0,
            status: 'running',
            pricePerMessage: pricePerMessage || 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Store targets in batches
        const BATCH_SIZE = 400;
        for (let i = 0; i < targets.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = targets.slice(i, i + BATCH_SIZE);
            chunk.forEach((t, idx) => {
                let cleanPhone = String(t.phone).replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.slice(1);
                if (!cleanPhone.startsWith('880')) cleanPhone = '880' + cleanPhone;
                const targetRef = campaignRef.collection('targets').doc(String(i + idx));
                batch.set(targetRef, { phone: cleanPhone, name: t.name || '', status: 'pending' });
            });
            await batch.commit();
        }

        // Start engine
        runCampaign(campaignId);

        // Listen for pause/resume
        campaignRef.onSnapshot(snapshot => {
            const data = snapshot.data();
            if (data?.status === 'running') runCampaign(campaignId);
        });

        res.json({ success: true, campaignId, totalTargets: targets.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Pause campaign
router.post('/campaign/pause', async (req, res) => {
    const { campaignId } = req.body;
    await getDb().collection('campaigns').doc(campaignId).update({ status: 'paused' });
    res.json({ success: true });
});

// Resume campaign
router.post('/campaign/resume', async (req, res) => {
    const { campaignId } = req.body;
    await getDb().collection('campaigns').doc(campaignId).update({ status: 'running' });
    res.json({ success: true });
});

module.exports = router;