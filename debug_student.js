const mongoose = require('mongoose');
const User = require('./src/models/User');
const RegistrationRequest = require('./src/models/RegistrationRequest');
require('dotenv').config();

async function debugStudent() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const email = 'sharugesh28@gmail.com';
        const plainPassword = 'jjcet811324149036';

        console.log(`\n--- Checking User Model for ${email} ---`);
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            console.log('❌ User not found in User model.');
        } else {
            console.log('✅ User found in User model.');
            const isMatch = await user.comparePassword(plainPassword);
            console.log('   Password Match result:', isMatch);
            console.log('   Stored Hash:', user.password);
        }

        console.log(`\n--- Checking RegistrationRequest Model for ${email} ---`);
        const request = await RegistrationRequest.findOne({ email });
        if (!request) {
            console.log('❌ No registration request found.');
        } else {
            console.log('✅ Registration request found.');
            console.log('   Status:', request.status);
            console.log('   Stored Password in Request:', request.password);

            // If it's old, it might be hashed in RegistrationRequest too.
            // If it's new, it's plain text in RegistrationRequest.

            // Let's test if the Request password (if hashed) matches the plain password
            const bcrypt = require('bcryptjs');
            try {
                const reqPassIsHash = await bcrypt.compare(plainPassword, request.password);
                console.log('   Does plain password match request password? (if hashed):', reqPassIsHash);
            } catch (e) {
                console.log('   Request password is likely plain text.');
            }
        }

        process.exit();
    } catch (error) {
        console.error('❌ DEBUG ERROR:', error);
        process.exit(1);
    }
}

debugStudent();
