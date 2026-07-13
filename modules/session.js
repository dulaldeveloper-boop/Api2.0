const fs = require('fs');
const path = require('path');
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, delay, makeWASocket } = require('@whiskeysockets/baileys');
const { getDb, getBucket } = require('../config/firebase');

const SESSIONS_DIR = process.env.RENDER ? '/tmp/sessions' : './sessions';

// Shared state
const sessions = new Map();
const sessionStates = new Map();
const todayCounts = new Map();
const dailyLimits = new Map();
const sessionUserMap = new Map();

if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Save session to Firebase Storage
async function saveSessionToCloud(sessionId) {
    try {
        const bucket = getBucket();
        const sessionPath = `${SESSIONS_DIR}/${sessionId}`;
        if (!fs.existsSync(sessionPath)) return;
        const files = fs.readdirSync(sessionPath);
        for (const file of files) {
            const filePath = `${sessionPath}/${file}`;
            if (fs.statSync(filePath).isFile()) {
                await bucket.upload(filePath, {
                    destination: `sessions/${sessionId}/${file}`,
                    metadata: { contentType: 'application/octet-stream' }
                });
            }
        }
    } catch (err) {
        console.error('💾 Session save error:', err.message);
    }
}

// Load session from Firebase Storage
async function loadSessionFromCloud(sessionId) {
    try {
        const bucket = getBucket();
        const sessionPath = `${SESSIONS_DIR}/${sessionId}`;
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
        const [files] = await bucket.getFiles({ prefix: `sessions/${sessionId}/` });
        for (const file of files) {
            const fileName = path.basename(file.name);
            const destPath = `${sessionPath}/${fileName}`;
            if (!fs.existsSync(destPath)) await file.download({ destination: destPath });
        }
        return files.length > 0;
    } catch (err) {
        console.error('📥 Session load error:', err.message);
        return false;
    }
}

// Create WhatsApp session
async function createSession(sessionId, phoneNumber) {
    const authPath = `${SESSIONS_DIR}/${sessionId}`;
    if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        logger: undefined
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            const phone = sock.user?.id?.split(':')[0] || phoneNumber;
            const name = sock.user?.name || phone;
            sessionStates.set(sessionId, { status: 'connected', phone, name, connectedAt: new Date().toISOString() });
            
            const db = getDb();
            const stored = (await db.collection('whatsapp_accounts').doc(sessionId).get()).data();
            const limit = stored?.dailyLimit || 5;
            dailyLimits.set(sessionId, limit);
            todayCounts.set(sessionId, stored?.todaySent || 0);

            await db.collection('whatsapp_accounts').doc(sessionId).update({
                phone, name, status: 'connected', dailyLimit: limit,
                todaySent: todayCounts.get(sessionId) || 0,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`✅ Connected: ${name} (${phone})`);
            await saveSessionToCloud(sessionId);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                sessionStates.set(sessionId, { ...sessionStates.get(sessionId) || {}, status: 'disconnected' });
                await getDb().collection('whatsapp_accounts').doc(sessionId).update({ status: 'disconnected', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                setTimeout(() => createSession(sessionId, phoneNumber), 5000);
            } else {
                sessions.delete(sessionId);
                sessionStates.delete(sessionId);
                await getDb().collection('whatsapp_accounts').doc(sessionId).update({ status: 'logged_out', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                
                const userId = sessionUserMap.get(sessionId);
                if (userId) {
                    await getDb().collection('notifications').add({
                        userId, type: 'account_logged_out',
                        title: '⚠️ Account Logged Out',
                        message: `Account ${phoneNumber} logged out. Reconnect needed.`,
                        sessionId, phone: phoneNumber, read: false,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
                sessionUserMap.delete(sessionId);
                try {
                    const bucket = getBucket();
                    const [files] = await bucket.getFiles({ prefix: `sessions/${sessionId}/` });
                    for (const file of files) await file.delete();
                } catch (e) {}
            }
        }
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await saveSessionToCloud(sessionId); });
    sessions.set(sessionId, sock);
    return sock;
}

module.exports = {
    sessions, sessionStates, todayCounts, dailyLimits, sessionUserMap,
    createSession, saveSessionToCloud, loadSessionFromCloud, SESSIONS_DIR
};
