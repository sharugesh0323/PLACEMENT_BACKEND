const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    departments: [{ type: String, default: 'All' }],
    batches: [{ type: String, default: 'All' }],
    year: { type: String },
    targetStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // For bulk targeted announcements
    type: { type: String, enum: ['note', 'announcement', 'opportunity'], default: 'note' },
    isPinned: { type: Boolean, default: false },
    attachments: [{ filename: String, url: String, driveId: String }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Note', noteSchema);
