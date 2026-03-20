const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    registerNo: { type: String, unique: true, sparse: true, trim: true, lowercase: true, index: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['student', 'admin', 'superadmin', 'department_admin', 'batch_admin'], default: 'student' },
    department: { type: String, trim: true },
    academicBatch: { type: String, trim: true }, // Institutional batch
    trainingBatch: { type: String, trim: true }, // Admin-defined batch
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
    isActive: { type: Boolean, default: true },
    extraAttempts: { type: Number, default: 0 }, // Global extra attempts (optional bonus)
    extraAssessmentAttempts: [{
        assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment' },
        extraCount: { type: Number, default: 0 }
    }],
    kickoutOverridden: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastLogin: { type: Date },
    profileImage: { type: String },           // public view link
    profileImageDriveId: { type: String },    // Drive fileId for deletion

    // Resume stored on Google Drive
    resume: {
        driveFileId: { type: String },
        viewLink: { type: String },
        downloadLink: { type: String },
        fileName: { type: String },
        uploadedAt: { type: Date }
    },

    // Certificates stored on Google Drive
    certificates: [{
        driveFileId: { type: String },
        viewLink: { type: String },
        downloadLink: { type: String },
        fileName: { type: String },
        tags: { type: String }, // Store descriptive tags like "CCNA", "Java", etc.
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

    clearedRecentSubmissions: [{ type: String, default: [] }],

    // IP Security Features
    firstLoginIp: { type: String },
    ipLogs: [{
        ip: String,
        timestamp: { type: Date, default: Date.now },
        device: String,
        status: { type: String, enum: ['success', 'blocked'] }
    }],
    securityAlerts: [{
        reason: String,
        ip: String,
        timestamp: { type: Date, default: Date.now },
        resolved: { type: Boolean, default: false }
    }],
    isPlaced: { type: Boolean, default: false },
    placementData: [{
        company: String,
        role: String,
        package: Number,
        date: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON response
userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};

module.exports = mongoose.model('User', userSchema);
