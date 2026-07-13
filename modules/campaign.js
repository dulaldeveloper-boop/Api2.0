const { getDb } = require('../config/firebase');
const { sessions, sessionStates, todayCounts, dailyLimits } = require('./session');
const { delay } = require('@whiskeysockets/baileys');
const admin = require('firebase-admin');

function jid(phone) {
    return `${phone}@s.whatsapp.net`;
}

async function runCampaign(campaignId) {
    const db = getDb();
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) return;

    const campaign = campaignSnap.data();
    if (campaign.status !== 'running') return;

    // Get pending targets
    const targetsSnap = await campaignRef.collection('targets')
        .where('status', '==', 'pending').limit(50).get();
    if (targetsSnap.empty) {
        await campaignRef.update({ status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() });
        return;
    }

    // Get available accounts
    const accountsSnap = await db.collection('whatsapp_accounts')
        .where('userId', '==', campaign.userId)
        .where('status', '==', 'connected').get();

    const availableAccounts = [];
    accountsSnap.forEach(doc => {
        const d = doc.data();
        const sent = todayCounts.get(doc.id) || d.todaySent || 0;
        const limit = dailyLimits.get(doc.id) || d.dailyLimit || 5;
        if (sent < limit && sessions.has(doc.id)) availableAccounts.push({ id: doc.id, sent, limit });
    });

    if (availableAccounts.length === 0) return;

    let accIdx = 0;
    for (const targetDoc of targetsSnap.docs) {
        const curSnap = await campaignRef.get();
        if (curSnap.data()?.status !== 'running') break;

        const target = targetDoc.data();
        const acc = availableAccounts[accIdx % availableAccounts.length];
        const sock = sessions.get(acc.id);
        if (!sock) { accIdx++; continue; }

        try {
            const msg = campaign.message.replace(/\{name\}/g, target.name || '');
            const result = await sock.sendMessage(jid(target.phone), { text: msg });

            if (result?.key?.id) {
                await targetDoc.ref.update({ status: 'sent', sentAt: new Date().toISOString(), messageId: result.key.id });
                await campaignRef.update({ sentCount: admin.firestore.FieldValue.increment(1) });

                const newCount = (todayCounts.get(acc.id) || 0) + 1;
                todayCounts.set(acc.id, newCount);
                await db.collection('whatsapp_accounts').doc(acc.id).update({ todaySent: newCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

                if (campaign.pricePerMessage > 0) {
                    await db.collection('users').doc(campaign.userId).update({
                        balance: admin.firestore.FieldValue.increment(campaign.pricePerMessage),
                        totalEarned: admin.firestore.FieldValue.increment(campaign.pricePerMessage)
                    });
                }
                console.log(`✅ Sent to ${target.phone}`);
            } else {
                await targetDoc.ref.update({ status: 'failed', error: 'No ID' });
                await campaignRef.update({ failedCount: admin.firestore.FieldValue.increment(1) });
            }
        } catch (err) {
            await targetDoc.ref.update({ status: 'failed', error: err.message });
            await campaignRef.update({ failedCount: admin.firestore.FieldValue.increment(1) });
        }
        accIdx++;
        await delay(10000 + Math.floor(Math.random() * 20000));
    }

    const pendingSnap = await campaignRef.collection('targets').where('status', '==', 'pending').limit(1).get();
    if (pendingSnap.empty) await campaignRef.update({ status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() });
}

module.exports = { runCampaign };
