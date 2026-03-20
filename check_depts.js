const mongoose = require('mongoose');
require('dotenv').config();

async function checkAdmins() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/placement');
        console.log('Connected to MongoDB');

        const User = mongoose.model('User', new mongoose.Schema({
            role: String,
            department: String
        }));

        const admins = await User.find({ role: 'admin' });
        console.log(`Found ${admins.length} admins`);
        
        const depts = await User.find({ role: 'admin' }).distinct('department');
        console.log('Distinct Departments for Admins:', depts);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkAdmins();
