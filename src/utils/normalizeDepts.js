/**
 * One-time migration: Normalize all student department / batch names to Title Case.
 * Run: node src/utils/normalizeDepts.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const normalizeName = (name) => {
    if (!name) return name;
    return name.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const users = await User.find({ role: 'student' }).lean();
    let updated = 0;

    for (const u of users) {
        const normalDept = normalizeName(u.department);
        const normalBatch = normalizeName(u.batch);

        if (normalDept !== u.department || normalBatch !== u.batch) {
            await User.updateOne({ _id: u._id }, {
                $set: { department: normalDept, batch: normalBatch }
            });
            updated++;
            console.log(`Fixed: ${u.name} | dept: "${u.department}" → "${normalDept}" | batch: "${u.batch}" → "${normalBatch}"`);
        }
    }

    console.log(`\n✅ Done. Fixed ${updated} of ${users.length} students.`);
    await mongoose.disconnect();
})();
