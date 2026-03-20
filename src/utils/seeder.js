const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');

const seed = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Create Super Admin
    const existing = await User.findOne({ email: 'superadmin@college.com' });
    if (!existing) {
        await User.create({
            name: 'Super Admin',
            email: 'superadmin@college.com',
            password: 'super123',
            role: 'superadmin',
            department: 'All',
            isActive: true
        });
        console.log('✅ Super Admin created: superadmin@college.com / super123');
    } else {
        console.log('ℹ️  Super Admin already exists');
    }

    // Demo admin
    const adminExists = await User.findOne({ email: 'admin@cse.com' });
    if (!adminExists) {
        await User.create({
            name: 'CSE Admin',
            email: 'admin@cse.com',
            password: 'admin123',
            role: 'admin',
            department: 'CSE',
            isActive: true
        });
        console.log('✅ Demo Admin created: admin@cse.com / admin123');
    }

    // Demo students
    const demoStudents = [
        { name: 'Alice Johnson', email: 'alice@student.com', registerNo: 'CSE001', department: 'CSE', batch: '2024', year: '2', section: 'A' },
        { name: 'Bob Smith', email: 'bob@student.com', registerNo: 'CSE002', department: 'CSE', batch: '2024', year: '2', section: 'A' },
        { name: 'Charlie Brown', email: 'charlie@student.com', registerNo: 'CSE003', department: 'CSE', batch: '2024', year: '2', section: 'B' },
    ];

    for (const s of demoStudents) {
        const exists = await User.findOne({ email: s.email });
        if (!exists) {
            await User.create({ ...s, password: `jjcet${s.registerNo}`, role: 'student' });
            console.log(`✅ Student: ${s.email} / jjcet${s.registerNo}`);
        }
    }

    console.log('\n🎉 Seeding complete!');
    process.exit(0);
};

seed().catch(err => { console.error(err); process.exit(1); });
