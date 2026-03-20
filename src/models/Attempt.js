const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
    questionId: { type: mongoose.Schema.Types.ObjectId },
    questionIndex: { type: Number },
    answer: { type: String },
    submittedCode: { type: String },
    language: { type: String },
    isCorrect: { type: Boolean },
    marksObtained: { type: Number, default: 0 },
    executionResult: { type: Object }
});

const activityLogSchema = new mongoose.Schema({
    event: { type: String },
    timestamp: { type: Date, default: Date.now },
    details: { type: String }
});

const attemptSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', required: true },
    entryTime: { type: Date, default: Date.now },
    exitTime: { type: Date },
    duration: { type: Number }, // in seconds
    score: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    status: {
        type: String,
        enum: ['active', 'completed', 'kicked', 'auto_submitted', 'time_expired'],
        default: 'active'
    },
    kickoutReason: { type: String },
    kickoutOverridden: { type: Boolean, default: false },
    answers: [answerSchema],
    activityLog: [activityLogSchema],
    tabSwitchCount: { type: Number, default: 0 },
    fullscreenExitCount: { type: Number, default: 0 },
    windowBlurCount: { type: Number, default: 0 },
    warningCount: { type: Number, default: 0 },
    warnings: [{
        reason: String,
        timestamp: { type: Date, default: Date.now }
    }],
    permanentlyDisqualified: { type: Boolean, default: false },
    ipAddress: { type: String },
    userAgent: { type: String },
    isExtraAttempt: { type: Boolean, default: false },
    lastSavedQuestionIndex: { type: Number, default: 0 },
    recordingUrl: { type: String },
    recordingStatus: { type: String, enum: ['none', 'pending', 'completed', 'failed'], default: 'none' }
}, { timestamps: true });

module.exports = mongoose.model('Attempt', attemptSchema);
