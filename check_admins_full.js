const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

async function checkAdmins() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const admins = await User.find({ role: { $in: ['admin', 'superadmin'] } });
        console.log(`Found ${admins.length} admins:`);

        admins.forEach(admin => {
            console.log({
                name: admin.name,
                email: admin.email,
                registerNo: admin.registerNo,
                role: admin.role
            });
        });

        process.exit();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkAdmins();
