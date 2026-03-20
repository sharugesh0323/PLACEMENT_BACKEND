const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
    referenceId: { type: String, unique: true }, // Format: 1, 2, 3...
    questionType: { type: String, enum: ['MCQ', 'PROGRAMMING', 'DESCRIPTIVE', 'SQL', 'SHORT_ANSWER'], required: true },
    sectionType: { type: String, required: true },
    sectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Section' },
    modelType: { type: String },

    // Core parameters
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Medium' },
    marks: { type: Number, default: 1 },
    negativeMarks: { type: Number, default: 0 },

    // Eligibility criteria
    eligibleYears: [{ type: String }],
    minAcademicPercentage: { type: Number, default: 0 },

    tags: [{ type: String }],
    isActive: { type: Boolean, default: true },

    content: {
        // Shared
        question: { type: String }, // MCQ, Descriptive
        marks: { type: Number }, // Backwards compatibility for front-end existing code mapping
        difficulty: { type: String }, // Backwards compatibility

        // MCQ specific
        options: [{ type: String }], // Backwards compatibility 
        correctAnswer: { type: String }, // Backwards compatibility

        // New Multi-Correct structure 
        mcqOptions: [{
            text: String,
            isCorrect: Boolean
        }],
        allowMultiple: { type: Boolean, default: false },
        shuffleOptions: { type: Boolean, default: false },

        // Programming/SQL specific
        title: { type: String },
        description: { type: String },
        inputFormat: { type: String },
        outputFormat: { type: String },
        constraints: { type: String },
        sampleInput: { type: String },
        sampleOutput: { type: String },
        allowedLanguages: [{ type: String }],
        
        // SQL specific
        dbSchema: { type: String }, // DDL statements
        dbSeed: { type: String },   // INSERT statements
        tableImage: { type: String }, // Image of the table structure
        
        testCases: [{
            input: String,
            expectedOutput: String,
            isHidden: { type: Boolean, default: false }
        }],
        timeLimit: { type: Number, default: 2000 },
        memoryLimit: { type: Number, default: 256 },

        // Descriptive specific
        wordLimit: { type: Number },
        // Short Answer specific
        keywords: [{ type: String }]
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Attempt to ensure reference IDs exist, though bulk upload defines them manually
questionSchema.pre('save', async function (next) {
    if (!this.referenceId) {
        let nextNumber = 1;

        // Try to find the max numeric referenceId
        const lastQuestions = await this.constructor.find({ referenceId: { $regex: /^\d+$/ } }, { referenceId: 1 }).lean();
        if (lastQuestions.length > 0) {
            const maxNumber = Math.max(...lastQuestions.map(q => parseInt(q.referenceId, 10)));
            if (!isNaN(maxNumber)) {
                nextNumber = maxNumber + 1;
            }
        }
        this.referenceId = String(nextNumber);
    }
    next();
});

module.exports = mongoose.model('Question', questionSchema, 'question_banks');
