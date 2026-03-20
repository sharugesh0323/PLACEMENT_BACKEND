const mongoose = require('mongoose');
const User = require('./src/models/User');
const Assessment = require('./src/models/Assessment');
require('dotenv').config();

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    const user = await User.findOne({ name: 'sharugesh' });
    if (!user) {
        console.log('User sharugesh not found');
    } else {
        console.log('USER:', {
            name: user.name,
            role: user.role,
            department: user.department,
            batch: user.batch
        });
    }

    const assessments = await Assessment.find({ isActive: true });
    console.log('ACTIVE ASSESSMENTS:', assessments.length);
    assessments.forEach(a => {
        console.log({
            title: a.title,
            department: a.department,
            batch: a.batch,
            startTime: a.startTime,
            endTime: a.endTime,
            isActive: a.isActive,
            isGloballydisabled: a.isGloballydisabled
        });
    });

    const now = new Date();
    console.log('CURRENT SERVER TIME:', now);

    process.exit();
}

check();
