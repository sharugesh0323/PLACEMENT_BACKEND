const User = require('../models/User');
const Attempt = require('../models/Attempt');
const { uploadFileToDrive, deleteFileFromDrive } = require('../utils/driveService');

/**
 * POST /api/upload/profile-photo
 * Upload student profile photo to Google Drive
 */
const uploadProfilePhoto = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const { buffer, originalname, mimetype } = req.file;
        const safeFileName = `profile_${req.user._id}_${Date.now()}_${originalname}`;

        // Delete old Drive file if it exists
        const existing = await User.findById(req.user._id);
        if (existing.profileImageDriveId) {
            try { await deleteFileFromDrive(existing.profileImageDriveId); } catch (e) { /* ignore */ }
        }

        const { fileId, viewLink, displayLink } = await uploadFileToDrive({
            fileBuffer: buffer,
            fileName: safeFileName,
            mimeType: mimetype,
            folderId: process.env.GOOGLE_DRIVE_PROFILE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID
        });

        // Save to MongoDB
        const user = await User.findByIdAndUpdate(req.user._id, {
            profileImage: displayLink,
            profileImageDriveId: fileId
        }, { new: true }).select('-password');

        res.json({
            success: true,
            message: 'Profile photo uploaded successfully',
            fileId,
            viewLink,
            displayLink,
            user
        });
    } catch (err) {
        console.error('Profile photo upload error:', err);
        res.status(500).json({ success: false, message: err.message || 'Upload failed' });
    }
};

/**
 * POST /api/upload/student-profile-photo/:studentId
 * Admin/Superadmin upload profile photo for a student
 */
const uploadStudentProfilePhoto = async (req, res) => {
    try {
        const { studentId } = req.params;
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const { buffer, originalname, mimetype } = req.file;
        const safeFileName = `profile_${studentId}_${Date.now()}_${originalname}`;

        // Find student and check permissions (admins only own dept)
        const student = await User.findById(studentId);
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        if (req.user.role === 'admin' && student.department !== req.user.department) {
            return res.status(403).json({ success: false, message: 'Forbidden: Student outside your department' });
        }

        // Delete old Drive file if it exists
        if (student.profileImageDriveId) {
            try { await deleteFileFromDrive(student.profileImageDriveId); } catch (e) { /* ignore */ }
        }

        const { fileId, viewLink, displayLink } = await uploadFileToDrive({
            fileBuffer: buffer,
            fileName: safeFileName,
            mimeType: mimetype,
            folderId: process.env.GOOGLE_DRIVE_PROFILE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID
        });

        // Save to MongoDB
        const updatedStudent = await User.findByIdAndUpdate(studentId, {
            profileImage: displayLink,
            profileImageDriveId: fileId
        }, { new: true }).select('-password');

        res.json({
            success: true,
            message: 'Student profile photo updated successfully',
            fileId,
            viewLink,
            displayLink,
            user: updatedStudent
        });
    } catch (err) {
        console.error('Admin student profile photo upload error:', err);
        res.status(500).json({ success: false, message: err.message || 'Upload failed' });
    }
};


/**
 * POST /api/upload/resume
 * Upload student resume PDF to Google Drive
 */
const uploadResume = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const { buffer, originalname, mimetype } = req.file;
        const safeFileName = `resume_${req.user._id}_${Date.now()}_${originalname}`;

        // Delete old resume from Drive if exists
        const existing = await User.findById(req.user._id);
        if (existing.resume?.driveFileId) {
            try { await deleteFileFromDrive(existing.resume.driveFileId); } catch (e) { /* ignore */ }
        }

        const { fileId, viewLink, downloadLink } = await uploadFileToDrive({
            fileBuffer: buffer,
            fileName: safeFileName,
            mimeType: mimetype,
            folderId: process.env.GOOGLE_DRIVE_RESUME_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID
        });

        const user = await User.findByIdAndUpdate(req.user._id, {
            resume: {
                driveFileId: fileId,
                viewLink,
                downloadLink,
                fileName: originalname,
                uploadedAt: new Date()
            }
        }, { new: true }).select('-password');

        res.json({
            success: true,
            message: 'Resume uploaded successfully',
            fileId,
            viewLink,
            downloadLink,
            user
        });
    } catch (err) {
        console.error('Resume upload error:', err);
        res.status(500).json({ success: false, message: err.message || 'Upload failed' });
    }
};

/**
 * POST /api/upload/certificate
 * Upload a certificate to Google Drive (multiple allowed)
 */
const uploadCertificate = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const { buffer, originalname, mimetype } = req.file;
        const { tags } = req.body;
        const safeFileName = `cert_${req.user._id}_${Date.now()}_${originalname}`;

        const { fileId, viewLink, downloadLink } = await uploadFileToDrive({
            fileBuffer: buffer,
            fileName: safeFileName,
            mimeType: mimetype,
            folderId: process.env.GOOGLE_DRIVE_CERT_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID
        });

        const user = await User.findByIdAndUpdate(req.user._id, {
            $push: {
                certificates: {
                    driveFileId: fileId,
                    viewLink,
                    downloadLink,
                    fileName: originalname,
                    tags: tags || '',
                    uploadedAt: new Date()
                }
            }
        }, { new: true }).select('-password');

        res.json({
            success: true,
            message: 'Certificate uploaded successfully',
            fileId,
            viewLink,
            downloadLink,
            user
        });
    } catch (err) {
        console.error('Certificate upload error:', err);
        res.status(500).json({ success: false, message: err.message || 'Upload failed' });
    }
};

/**
 * DELETE /api/upload/certificate/:fileId
 * Delete a certificate from Drive and MongoDB
 */
const deleteCertificate = async (req, res) => {
    try {
        const { fileId } = req.params;

        // Remove from Drive
        try { await deleteFileFromDrive(fileId); } catch (e) { /* already deleted or not found */ }

        // Remove from MongoDB
        const user = await User.findByIdAndUpdate(req.user._id, {
            $pull: { certificates: { driveFileId: fileId } }
        }, { new: true }).select('-password');

        res.json({ success: true, message: 'Certificate deleted', user });
    } catch (err) {
        console.error('Certificate delete error:', err);
        res.status(500).json({ success: false, message: err.message || 'Delete failed' });
    }
};

const uploadQuestionImage = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const { buffer, originalname, mimetype } = req.file;
        const safeFileName = `qimg_${Date.now()}_${originalname}`;

        const { fileId, viewLink, displayLink } = await uploadFileToDrive({
            fileBuffer: buffer,
            fileName: safeFileName,
            mimeType: mimetype,
            folderId: process.env.GOOGLE_DRIVE_FOLDER_ID
        });

        res.json({
            success: true,
            message: 'Image uploaded successfully',
            fileId,
            viewLink,
            displayLink
        });
    } catch (err) {
        console.error('Question image upload error:', err);
        res.status(500).json({ success: false, message: err.message || 'Upload failed' });
    }
};

const uploadAssessmentRecording = async (req, res) => {
    try {
        const { attemptId } = req.params;
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const { buffer, originalname, mimetype } = req.file;
        const safeFileName = `recording_${attemptId}_${Date.now()}.webm`;

        const { fileId, viewLink, downloadLink } = await uploadFileToDrive({
            fileBuffer: buffer,
            fileName: safeFileName,
            mimeType: mimetype,
            folderId: process.env.GOOGLE_DRIVE_FOLDER_ID
        });

        await Attempt.findByIdAndUpdate(attemptId, {
            recordingUrl: viewLink || downloadLink,
            recordingStatus: 'completed'
        });

        res.json({
            success: true,
            message: 'Recording uploaded successfully',
            fileId,
            viewLink
        });
    } catch (err) {
        console.error('Recording upload error:', err);
        res.status(500).json({ success: false, message: err.message || 'Upload failed' });
    }
};

module.exports = { 
    uploadProfilePhoto, 
    uploadStudentProfilePhoto, 
    uploadResume, 
    uploadCertificate, 
    deleteCertificate, 
    uploadQuestionImage,
    uploadAssessmentRecording 
};
