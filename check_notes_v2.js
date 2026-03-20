const mongoose = require('mongoose');
const Note = require('./src/models/Note');
require('dotenv').config();

async function checkNotes() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const notes = await Note.find().sort({ createdAt: -1 }).limit(5);
        notes.forEach(n => {
            console.log({
                title: n.title,
                type: n.type,
                createdAt: n.createdAt,
                attachments: n.attachments
            });
        });
        process.exit();
    } catch (e) { console.error(e); process.exit(1); }
}
checkNotes();
