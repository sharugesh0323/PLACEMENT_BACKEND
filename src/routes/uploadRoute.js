const express = require('express');
const router = express.Router();
const { protect, isAdmin } = require('../middleware/auth');
const upload = require('../middleware/driveUpload');
const {
    uploadProfilePhoto,
    uploadStudentProfilePhoto,
    uploadResume,
    uploadCertificate,
    deleteCertificate,
    uploadQuestionImage,
    uploadAssessmentRecording
} = require('./uploadController');

/**
 * POST /api/upload/profile-photo
 * Upload student profile photo to Google Drive
 * Field name: "photo"
 */
router.post('/profile-photo', protect, upload.single('photo'), uploadProfilePhoto);

/**
 * POST /api/upload/student-profile-photo/:studentId
 * Upload student profile photo by admin
 */
router.post('/student-profile-photo/:studentId', protect, isAdmin, upload.single('photo'), uploadStudentProfilePhoto);

/**
 * POST /api/upload/resume
 * Upload student resume (PDF/DOC) to Google Drive
 * Field name: "resume"
 */
router.post('/resume', protect, upload.single('resume'), uploadResume);

/**
 * POST /api/upload/certificate
 * Upload a certificate to Google Drive (can call multiple times)
 * Field name: "certificate"
 */
router.post('/certificate', protect, upload.single('certificate'), uploadCertificate);

/**
 * DELETE /api/upload/certificate/:fileId
 * Delete a specific certificate from Drive + MongoDB
 */
router.delete('/certificate/:fileId', protect, deleteCertificate);

/**
 * POST /api/upload/question-image
 * Upload an image for a question (specifically SQL table structure)
 */
router.post('/question-image', protect, isAdmin, upload.single('image'), uploadQuestionImage);

/**
 * POST /api/upload/recording/:attemptId
 * Upload assessment screen recording (WebM)
 */
router.post('/recording/:attemptId', protect, upload.single('recording'), uploadAssessmentRecording);

module.exports = router;
