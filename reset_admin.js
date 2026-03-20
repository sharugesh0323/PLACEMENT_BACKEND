const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

async function resetPassword() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const email = 'admin@gmail.com';
        const user = await User.findOne({ email });

        if (!user) {
            console.log(`User ${email} not found. Creating...`);
            const newUser = new User({
                name: 'Super Admin',
                email: email,
                password: 'admin123',
                role: 'superadmin',
                isActive: true
            });
            await newUser.save();
            console.log('Super Admin created with password: admin123');
        } else {
            user.password = 'admin123';
            await user.save();
            console.log(`Password for ${email} reset to: admin123`);
            console.log('User Role:', user.role);
        }

        process.exit();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

resetPassword();
