const mongoose = require('mongoose');
const User = require('./src/models/User');
const RegistrationRequest = require('./src/models/RegistrationRequest');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function fixStudent() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const email = 'sharugesh28@gmail.com';
        const plainPassword = 'jjcet811324149036';

        // 1. Fix the User model
        const user = await User.findOne({ email });
        if (user) {
            console.log('Updating user password in User model...');
            user.password = plainPassword; // User model has pre-save hook to hash this
            await user.save();
            console.log('✅ User password updated.');
        } else {
            console.log('❌ User not found in User model.');
        }

        // 2. Fix the RegistrationRequest model (so Sync Password works later if needed)
        const request = await RegistrationRequest.findOne({ email });
        if (request) {
            console.log('Updating password in RegistrationRequest model...');
            request.password = plainPassword; // Now correctly stored as plain text since I removed the hook
            await request.save();
            console.log('✅ RegistrationRequest updated.');
        }

        process.exit();
    } catch (error) {
        console.error('❌ FIX ERROR:', error);
        process.exit(1);
    }
}

fixStudent();
