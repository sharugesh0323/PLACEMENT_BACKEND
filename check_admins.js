const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

async function checkAdmins() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const admins = await User.find({ role: { $in: ['admin', 'superadmin'] } }).select('+password');
        console.log(`Found ${admins.length} admins/superadmins:`);

        admins.forEach(admin => {
            console.log({
                id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
                isActive: admin.isActive,
                hasPassword: !!admin.password
            });
        });

        process.exit();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkAdmins();
