const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const User = require('./src/models/User');

const createAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const userData = {
            name: 'CSE Admin',
            email: 'admin@cse.com',
            password: 'admin123',
            role: 'admin',
            department: 'CSE',
            isActive: true
        };

        // No manual hashing here, let the model handle it
        userData.password = 'admin123';

        const exists = await User.findOne({ email: userData.email });
        if (exists) {
            exists.password = userData.password;
            await exists.save();
            console.log(`✅ Admin ${userData.email} updated with password: admin123`);
        } else {
            await User.create(userData);
            console.log(`✅ Admin ${userData.email} created with password: admin123`);
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
};

createAdmin();
