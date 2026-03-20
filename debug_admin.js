const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

async function debugAdmin() {
    try {
        console.log('Connecting to MONGO_URI...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const email = 'admin@gmail.com';
        console.log(`Searching for user with email: ${email}...`);
        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            console.log('❌ Admin user NOT found in database.');
        } else {
            console.log('✅ Admin user found:');
            console.log('   ID:', user._id);
            console.log('   Email:', user.email);
            console.log('   Role:', user.role);
            console.log('   Is Active:', user.isActive);

            console.log('Testing password comparison for "admin123"...');
            const isMatch = await user.comparePassword('admin123');
            console.log('   Password Match result:', isMatch);
        }

        process.exit();
    } catch (error) {
        console.error('❌ DEBUG ERROR:', error);
        process.exit(1);
    }
}

debugAdmin();
