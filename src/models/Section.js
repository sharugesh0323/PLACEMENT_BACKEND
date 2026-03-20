const mongoose = require('mongoose');

const sectionSchema = new mongoose.Schema({
    name: { type: String, required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', default: null },
    description: { type: String },
    type: { type: String, enum: ['MCQ', 'PROGRAMMING', 'DESCRIPTIVE', 'SQL', 'SHORT_ANSWER', 'MIXED'], default: 'MIXED' },
    isActive: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('Section', sectionSchema);
