const mongoose = require('mongoose');

const registrationRequestSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    registerNo: { type: String, trim: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, default: 'student' },
    department: { type: String, trim: true },
    academicBatch: { type: String, trim: true },
    trainingBatch: { type: String, trim: true },
    year: { type: String },
    section: { type: String },
    cgpa: { type: Number, default: 0 },
    mobileNo: { type: String, trim: true },
    fatherName: { type: String, trim: true },
    fatherMobile: { type: String, trim: true },
    motherName: { type: String, trim: true },
    motherMobile: { type: String, trim: true },
    address: { type: String, trim: true },
    currentArrears: { type: Number, default: 0 },
    historyOfArrears: { type: Number, default: 0 },
    semesterResults: [{
        semester: { type: Number },
        gpa: { type: Number },
        subjects: [{
            code: { type: String },
            name: { type: String },
            grade: { type: String }
        }]
    }],
    resume: {
        driveFileId: { type: String },
        viewLink: { type: String },
        downloadLink: { type: String },
        fileName: { type: String },
        uploadedAt: { type: Date }
    },
    certificates: [{
        driveFileId: { type: String },
        viewLink: { type: String },
        downloadLink: { type: String },
        fileName: { type: String },
        tags: { type: String },
        uploadedAt: { type: Date, default: Date.now }
    }],
    socialLinks: {
        github: { type: String, trim: true },
        linkedin: { type: String, trim: true },
        leetcode: { type: String, trim: true },
        hackerrank: { type: String, trim: true },
        codechef: { type: String, trim: true },
        others: { type: String, trim: true },
        extraLinks: [{
            title: { type: String, trim: true },
            url: { type: String, trim: true }
        }]
    },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

module.exports = mongoose.model('RegistrationRequest', registrationRequestSchema);
