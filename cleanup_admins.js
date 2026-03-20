const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

async function cleanupAndReset() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const admins = await User.find({ role: { $in: ['admin', 'superadmin'] } });

        for (const admin of admins) {
            admin.password = 'admin123';
            // Clean up empty registerNo
            if (admin.registerNo === '') {
                admin.registerNo = undefined;
            }
            await admin.save();
            console.log(`Reset password for ${admin.email} (${admin.role})`);
        }

        process.exit();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

cleanupAndReset();
