const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
    referenceId: { type: String }, // Format: QN-00001
    type: { type: String, enum: ['mcq', 'descriptive', 'programming', 'sql', 'short_answer'], required: true },
    sectionType: { type: String, default: 'Default' }, // Link to section mapping
    question: { type: String, required: true },
    options: [{ type: String }], // For MCQ
    correctAnswer: { type: String }, // For MCQ
    maxMarks: { type: Number, default: 1 },
    language: { type: String }, // For programming questions
    dbSchema: { type: String }, // For SQL
    dbSeed: { type: String },   // For SQL
    tableImage: { type: String }, // For SQL image structure
    testCases: [{
        input: String,
        expectedOutput: String,
        isHidden: { type: Boolean, default: false }
    }],
    sampleCode: { type: String },
    keywords: [{ type: String }]
});

const assessmentSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String },
    departments: [{ type: String }],  // e.g. ['CSE', 'ECE'] or ['All']
    batches: [{ type: String }],      // e.g. ['Batch 1'] or ['All']
    years: [{ type: String }],        // e.g. ['1', '2', '3', '4'] or ['All']
    section: { type: String },
    type: { type: String, enum: ['main', 'daily'], required: true, default: 'daily' },
    programmingLanguagesAllowed: [{ type: String }],
    strictMode: { type: Boolean, default: false },
    allowViewAnswers: { type: Boolean, default: false },
    maxWarnings: { type: Number, default: 3 }, // Max warnings before auto-submit in strict mode
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    duration: { type: Number, default: 0 }, // in minutes; for daily quiz: computed from start/end; for main: sum of parts
    questions: [questionSchema],
    totalMarks: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isGloballydisabled: { type: Boolean, default: false },
    allowedAttempts: { type: Number, default: 1 },
    shuffleQuestions: { type: Boolean, default: false },
    shuffleOptions: { type: Boolean, default: false },
    passingMarks: { type: Number, default: 0 },
    recordingEnabled: { type: Boolean, default: false },

    // Phase 3 Features: Cutoff Settings
    sectionCutoffs: [{
        sectionType: { type: String },
        cutoffMarks: { type: Number, default: 0 },
        duration: { type: Number, default: 0 }
    }],
    overallCutoff: { type: Number, default: 0 },

    // Navigation Mode
    // 'nonlinear'       – Student can jump to any question, any part freely
    // 'linear-question' – Must answer in order Q1→Q2→Q3... across all parts
    // 'linear-part'     – Within a part, jump freely. But must finish a part before unlocking the next
    navigationMode: { type: String, enum: ['nonlinear', 'linear-question', 'linear-part'], default: 'nonlinear' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instructions: { type: String }
}, { timestamps: true });

// Auto-calculate total marks
assessmentSchema.pre('save', function (next) {
    this.totalMarks = this.questions.reduce((sum, q) => sum + (q.maxMarks || 1), 0);
    next();
});

module.exports = mongoose.model('Assessment', assessmentSchema);
