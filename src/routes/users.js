const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csvtojson = require('csvtojson');
const User = require('../models/User');
const Batch = require('../models/Batch');
const Attempt = require('../models/Attempt');
const { protect, isAdmin, isSuperAdmin } = require('../middleware/auth');
const { getFileAsBase64 } = require('../utils/driveService');

// GET /api/users/departments/list - List all departments
router.get('/departments/list', protect, isAdmin, async (req, res) => {
    try {
        const rawDepartments = await User.distinct('department');
        // Clean up historic database entries that might have trailing spaces or odd casing
        const cleanedDepartments = [...new Set(rawDepartments.filter(d => d).map(d => d.trim().toUpperCase()))];
        res.json({ success: true, departments: cleanedDepartments.filter(d => d !== 'ALL') });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/users/batches/list - List all unique training batches (Cohorts)
router.get('/batches/list', protect, isAdmin, async (req, res) => {
    try {
        const batches = await Batch.find().select('name').lean();
        const batchNames = batches.map(b => b.name);
        res.json({ success: true, batches: batchNames });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/users/academic-batches/list - List all unique institutional academic batches
router.get('/academic-batches/list', protect, isAdmin, async (req, res) => {
    try {
        const rawBatches = await User.distinct('academicBatch');
        const cleanedBatches = [...new Set(rawBatches.filter(b => b).map(b => b.trim()))].sort();
        res.json({ success: true, academicBatches: cleanedBatches });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Multer config for CSV uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/csv';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({
    storage, fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || path.extname(file.originalname) === '.csv') {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    }
});

// GET /api/users - Get all students (admin: their dept, superadmin: all)
router.get('/', protect, isAdmin, async (req, res) => {
    try {
        const query = { role: 'student' };
        if (req.user.role === 'admin') {
            if (req.user.department && req.user.department !== 'All') {
                query.department = { $regex: new RegExp(`^${req.user.department}$`, 'i') };
            }
            if (req.user.batch && req.user.batch !== 'All' && req.user.batch !== 'All Batches') {
                query.trainingBatch = req.user.batch;
            }
        }
        const { department, batch, academicBatch, year, section, search, minCgpa, maxCgpa, page = 1, limit = 50 } = req.query;
        if (department && department !== 'All') {
            query.department = { $regex: new RegExp(`^${department}$`, 'i') };
        }
        if (batch && batch !== 'All' && batch !== 'All Batches') query.trainingBatch = batch;
        if (academicBatch) query.academicBatch = academicBatch;
        if (year) query.year = year;
        if (section) query.section = section;

        // CGPA Range Filter
        if (minCgpa || maxCgpa) {
            query.cgpa = {};
            if (minCgpa) query.cgpa.$gte = parseFloat(minCgpa);
            if (maxCgpa) query.cgpa.$lte = parseFloat(maxCgpa);
        }

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { registerNo: { $regex: search, $options: 'i' } },
                { 'certificates.tags': { $regex: search, $options: 'i' } }
            ];
        }

        const total = await User.countDocuments(query);
        const activeCount = await User.countDocuments({ ...query, isActive: true });
        const students = await User.find(query)
            .select('-password')
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        res.json({ success: true, total, activeCount, page: parseInt(page), students });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});



// POST /api/users - Create student
router.post('/', protect, isAdmin, async (req, res) => {
    try {
        const { name, email, registerNo, department, trainingBatch, academicBatch, year, section, socialLinks } = req.body;
        const dept = req.user.role === 'admin' ? req.user.department : department;

        // Default password: jjcet + registerNo (lowercase for consistency)
        const defaultPassword = `jjcet${registerNo.toLowerCase()}`;

        const user = await User.create({
            name, email, registerNo,
            password: defaultPassword,
            department: dept,
            trainingBatch, academicBatch, year, section,
            socialLinks,
            role: 'student',
            createdBy: req.user._id
        });

        // Ensure batch exists in Batch collection (Training Batches)
        if (trainingBatch && trainingBatch.trim() && trainingBatch !== 'All' && trainingBatch !== 'All Batches' && req.user.role === 'superadmin') {
            const batchName = trainingBatch.trim();
            const batchExists = await Batch.findOne({ name: batchName });
            if (!batchExists) {
                await Batch.create({
                    name: batchName,
                    description: `Automatically created during student registration`,
                    createdBy: req.user._id
                });
                console.log(`✅ Batch created: ${batchName}`);
            }
        }

        res.status(201).json({ success: true, user });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Email or Register Number already exists' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/users/:id/full - Get comprehensive student profile (Admin only)
router.get('/:id/full', protect, isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // Find all attempts
        const attempts = await Attempt.find({ studentId: req.params.id })
            .populate('assessmentId', 'title type totalMarks department')
            .sort({ createdAt: -1 });

        // Get profile image as base64 for PDF embedding
        let profileImageData = null;
        if (user.profileImageDriveId) {
            profileImageData = await getFileAsBase64(user.profileImageDriveId);
        }

        // Get resume as base64 for PDF merging
        let resumeData = null;
        if (user.resume?.driveFileId) {
            resumeData = await getFileAsBase64(user.resume.driveFileId);
        }

        res.json({ success: true, user, attempts, profileImageData, resumeData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});



// PUT /api/users/:id - Update user
router.put('/:id', protect, isAdmin, async (req, res) => {
    try {
        const { name, email, registerNo, department, trainingBatch, academicBatch, year, section, isActive, extraAttempts, password, mobileNo, fatherName, fatherMobile, motherName, motherMobile, address, cgpa, currentArrears, historyOfArrears, semesterResults, socialLinks } = req.body;

        // Admin can only update their own dept students
        if (req.user.role === 'admin') {
            const user = await User.findById(req.params.id);
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });

            // Case-insensitive/trimmed department check
            const userDept = (user.department || '').trim().toLowerCase();
            const adminDept = (req.user.department || '').trim().toLowerCase();

            if (userDept !== adminDept) {
                return res.status(403).json({ success: false, message: 'Access denied: You can only edit students from your department' });
            }
        }

        const updateData = {};
        if (name) updateData.name = name;
        if (email) updateData.email = email.toLowerCase();
        if (registerNo) updateData.registerNo = registerNo.toLowerCase();
        if (department) updateData.department = department;
        if (trainingBatch !== undefined) updateData.trainingBatch = trainingBatch;
        if (academicBatch !== undefined) updateData.academicBatch = academicBatch;
        if (year !== undefined) updateData.year = year;
        if (section !== undefined) updateData.section = section;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (extraAttempts !== undefined) updateData.extraAttempts = extraAttempts;
        if (mobileNo !== undefined) updateData.mobileNo = mobileNo;
        if (fatherName !== undefined) updateData.fatherName = fatherName;
        if (fatherMobile !== undefined) updateData.fatherMobile = fatherMobile;
        if (motherName !== undefined) updateData.motherName = motherName;
        if (motherMobile !== undefined) updateData.motherMobile = motherMobile;
        if (address !== undefined) updateData.address = address;
        if (cgpa !== undefined) updateData.cgpa = cgpa;
        if (currentArrears !== undefined) updateData.currentArrears = currentArrears;
        if (historyOfArrears !== undefined) updateData.historyOfArrears = historyOfArrears;
        if (semesterResults !== undefined) updateData.semesterResults = semesterResults;
        if (socialLinks !== undefined) updateData.socialLinks = socialLinks;

        if (password && password.trim() !== '') {
            const salt = await require('bcryptjs').genSalt(12);
            updateData.password = await require('bcryptjs').hash(password, salt);
        }

        const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // Ensure training batch exists in Batch collection if updated
        if (trainingBatch && trainingBatch.trim() && trainingBatch !== 'All' && trainingBatch !== 'All Batches' && req.user.role === 'superadmin') {
            const batchName = trainingBatch.trim();
            const batchExists = await Batch.findOne({ name: batchName });
            if (!batchExists) {
                await Batch.create({
                    name: batchName,
                    description: `Automatically created during user update`,
                    createdBy: req.user._id
                });
                console.log(`✅ Batch created on update: ${batchName}`);
            }
        }

        res.json({ success: true, user });
    } catch (error) {
        console.error('Update user error:', error);
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Email or Register Number already exists' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/users/:id
router.delete('/:id', protect, isSuperAdmin, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/users/bulk-upload - CSV upload
router.post('/bulk-upload', protect, isAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const isPreview = req.body.preview === 'true';
        const rows = await csvtojson().fromFile(req.file.path);
        const results = { created: 0, skipped: 0, errors: [], validRecords: [] };

        for (const row of rows) {
            try {
                const firstName = (row.firstName || '').trim();
                const lastName = (row.lastName || '').trim();
                const email = (row.email || '').trim().toLowerCase();
                const registerNo = (row.registerNo || '').trim().toUpperCase();
                const department = req.user.role === 'admin' ? req.user.department : (row.department || req.user.department || '').trim().toUpperCase();
                const academicBatch = (row.academicBatch || '').trim();
                const year = (row.year || '').trim();
                const section = (row.section || '').trim().toUpperCase();

                if (!firstName || !lastName || !email || !registerNo) {
                    results.errors.push({ row, error: 'Missing required fields (firstName, lastName, email, registerNo)' });
                    results.skipped++;
                    continue;
                }

                console.log(`Checking duplicate for: email=${email}, registerNo=${registerNo}`);
                const exists = await User.findOne({ $or: [{ email }, { registerNo }] });
                if (exists) {
                    console.log(`Duplicate found! Conflicting User: email=${exists.email}, registerNo=${exists.registerNo}`);
                    results.errors.push({ row, error: `Duplicate email (${email}) or Register No (${registerNo}) - Collided with: ${exists.email} / ${exists.registerNo}` });
                    results.skipped++;
                    continue;
                }

                const cleanFatherName = (row.fatherName || '').replace(/[^A-Za-z\s]/g, '').trim().toUpperCase();
                const cleanMotherName = (row.motherName || '').replace(/[^A-Za-z\s]/g, '').trim().toUpperCase();
                const cleanMobile = (row.mobileNo || '').replace(/\D/g, '');
                const cleanFatherMobile = (row.fatherMobile || '').replace(/\D/g, '');
                const cleanMotherMobile = (row.motherMobile || '').replace(/\D/g, '');

                const newUserData = {
                    name: `${firstName.toUpperCase()} ${lastName.toUpperCase()}`,
                    email, 
                    registerNo,
                    password: `jjcet${registerNo.toLowerCase()}`,
                    department,
                    academicBatch, year, section,
                    mobileNo: cleanMobile,
                    fatherName: cleanFatherName,
                    fatherMobile: cleanFatherMobile,
                    motherName: cleanMotherName,
                    motherMobile: cleanMotherMobile,
                    address: (row.address || '').trim(),
                    role: 'student',
                    createdBy: req.user._id
                };

                if (isPreview) {
                    results.validRecords.push(newUserData);
                    results.created++;
                } else {
                    await User.create(newUserData);
                    results.created++;
                }

            } catch (err) {
                results.errors.push({ row, error: err.message });
                results.skipped++;
            }
        }

        // Clean up file
        fs.unlinkSync(req.file.path);

        res.json({ success: true, message: `Imported ${results.created} students`, results });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', protect, isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.password = `jjcet${user.registerNo.toLowerCase()}`;
        await user.save();

        res.json({ success: true, message: 'Password reset to default' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});



module.exports = router;
