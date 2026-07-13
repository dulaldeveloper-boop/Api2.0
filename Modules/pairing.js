const { v4: uuidv4 } = require('uuid');
const { delay } = require('@whiskeysockets/baileys');
const { getDb } = require('../config/firebase');
const { createSession, sessions, sessionStates } = require('./session');
const admin = require('firebase-admin');

async function generatePairingCode(phone, userId) {
    // Clean phone
    let cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.slice(1);
    if (!cleanPhone.startsWith('880') && cleanPhone.length === 10) cleanPhone = '880' + cleanPhone;
    
    if (cleanPhone.length < 10) throw new Error('Invalid phone number');

    const sessionId = uuidv4();
    sessionStates.set(sessionId, { status: 'initializing', phone: cleanPhone, userId });

    // Create socket
    const sock = await createSession(sessionId, cleanPhone);

    // Wait for socket ready (FIX: wait for connection.update event)
    await new Promise((resolve) => {
        let resolved = false;
        const handler = (update) => {
            if (!resolved && update.connection) {
                resolved = true;
                sock.ev.off('connection.update', handler);
                resolve();
            }
        };
        sock.ev.on('connection.update', handler);
        setTimeout(() => { if (!resolved) { resolved = true; sock.ev.off('connection.update', handler); resolve(); } }, 8000);
    });

    await delay(2000);

    // Request pairing code with retry
    let code;
    try {
        code = await sock.requestPairingCode(cleanPhone);
    } catch (firstErr) {
        console.log('First attempt failed, retrying...');
        await delay(3000);
        try {
            code = await sock.requestPairingCode(cleanPhone);
        } catch (secondErr) {
            throw new Error('Failed to generate code. WhatsApp may be blocking. Try again in 5 minutes.');
        }
    }

    if (!code) throw new Error('Invalid pairing code');

    sessionStates.set(sessionId, { status: 'pair_ready', pairCode: code, phone: cleanPhone, userId });

    await getDb().collection('whatsapp_accounts').doc(sessionId).set({
        userId: userId || '', phone: cleanPhone, status: 'pair_ready',
        pairCode: code, dailyLimit: 5, todaySent: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { code, sessionId, phone: cleanPhone };
}

module.exports = { generatePairingCode };