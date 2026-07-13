const admin = require('firebase-admin');

let db, bucket;

function initFirebase() {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DB_URL,
            storageBucket: "ws-income-official.firebasestorage.app"
        });
        db = admin.firestore();
        bucket = admin.storage().bucket();
        console.log('🔥 Firestore + Storage Connected');
        return { db, bucket };
    } catch (err) {
        console.error('❌ Firebase init failed:', err.message);
        process.exit(1);
    }
}

module.exports = { initFirebase, getDb: () => db, getBucket: () => bucket };
