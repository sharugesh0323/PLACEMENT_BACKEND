const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Question = require('./src/models/Question');

async function fixRefs() {
    try {
        console.log("Connecting using URI:", process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI);

        // Find questions where referenceId starts with 'QN-'
        const questions = await Question.find({ referenceId: { $regex: /^QN-/ } });
        console.log('Migrating ' + questions.length + ' questions from QN- to purely numeric...');

        for (let q of questions) {
            if (q.referenceId.startsWith('QN-')) {
                const num = parseInt(q.referenceId.replace('QN-', ''), 10);
                if (!isNaN(num)) {
                    q.referenceId = String(num);
                    await q.save();
                }
            }
        }
        console.log('Migration complete.');
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        process.exit(0);
    }
}
fixRefs();
