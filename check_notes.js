const mongoose = require('mongoose');
const Note = require('./src/models/Note');
require('dotenv').config();

async function checkNotes() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const notes = await Note.find({ attachments: { $exists: true, $not: { $size: 0 } } });
        console.log(`Found ${notes.length} notes with attachments:`);

        notes.forEach(note => {
            console.log({
                title: note.title,
                type: note.type,
                attachments: note.attachments
            });
        });

        process.exit();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkNotes();
