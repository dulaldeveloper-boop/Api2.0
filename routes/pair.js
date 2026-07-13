const express = require('express');
const router = express.Router();
const { generatePairingCode } = require('../modules/pairing');

router.post('/pair', async (req, res) => {
    try {
        const { phone, userId } = req.body;
        if (!phone) return res.status(400).json({ success: false, error: 'Phone required' });
        
        const result = await generatePairingCode(phone, userId);
        res.json({ success: true, ...result, message: 'Enter code in WhatsApp > Linked Devices' });
    } catch (err) {
        console.error('❌ Pair error:', err.message);
        res.status(400).json({ success: false, error: err.message });
    }
});

module.exports = router;