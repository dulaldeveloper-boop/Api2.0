const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { initFirebase, getDb } = require('./config/firebase');
const { sessions, sessionStates, todayCounts, loadSessionFromCloud, createSession, sessionUserMap, SESSIONS_DIR } = require('./modules/session');
const { saveSessionToCloud } = require('./modules/session');

require('dotenv').config();

const PORT = process.env.PORT || 10000;
const { delay } = require('@whiskeysockets/baileys');

// Init Firebase
initFirebase();

// Express
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api', require('./routes/pair'));
app.use('/api', require('./routes/accounts'));
app.use('/api', require('./routes/send'));
app.use('/api', require('./routes/campaign'));
app.use('/api', require('./routes/disconnect'));
app.use('/api', require('./routes/notifications'));

// Midnight Cron
cron.schedule('0 0 * * *', async () => {
    console.log('🕛 Midnight reset');
    todayCounts.clear();
    const batch = getDb().batch();
    const snap = await getDb().collection('whatsapp_accounts').get();
    snap.forEach(doc => batch.update(doc.ref, { todaySent: 0 }));
    await batch.commit();
}, { scheduled: true, timezone: "Asia/Dhaka" });

// Auto-save sessions
setInterval(async () => {
    for (const sessionId of sessions.keys()) {
        if (sessionStates.get(sessionId)?.status === 'connected') {
            await saveSessionToCloud(sessionId);
        }
    }
}, 300000);

// Load sessions on startup
async function loadAllSessions() {
    const snap = await getDb().collection('whatsapp_accounts').where('status', '==', 'connected').get();
    for (const doc of snap.docs) {
        const data = doc.data();
        const loaded = await loadSessionFromCloud(doc.id);
        if (loaded) {
            if (data.userId) sessionUserMap.set(doc.id, data.userId);
            await createSession(doc.id, data.phone);
            await delay(2000);
        }
    }
    console.log('✅ Sessions loaded');
}

// Serve
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, async () => {
    console.log(`🚀 WS-Income v2.1 on port ${PORT}`);
    await loadAllSessions();
});