const mongoose = require('mongoose');

const placementSchema = new mongoose.Schema({
    companyName: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: ['IT', 'Core', 'Product', 'Service', 'Other'],
        default: 'Service'
    },
    logo: {
        type: String,
        default: ''
    },
    // New hierarchical structure: Company -> Folders -> Students
    folders: [{
        folderName: { type: String, required: true },
        selectedStudents: [{
            studentId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
                required: true
            },
            role: {
                type: String,
                required: true
            },
            package: {
                type: Number,
                required: true
            },
            placedAt: {
                type: Date,
                default: Date.now
            }
        }]
    }],
    academicBatch: {
        type: String,
        default: '' 
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Placement', placementSchema);
