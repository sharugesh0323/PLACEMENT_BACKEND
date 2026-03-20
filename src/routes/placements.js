const express = require('express');
const router = express.Router();
const Placement = require('../models/Placement');
const User = require('../models/User');
const { protect, isAdmin } = require('../middleware/auth');
const multer = require('multer');
const { uploadFileToDrive } = require('../utils/driveService');

// Multer config for logo (Memory Storage)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// @desc    Get all placements
// @route   GET /api/placements
router.get('/', protect, isAdmin, async (req, res) => {
    try {
        const placements = await Placement.find({})
            .populate('folders.selectedStudents.studentId', 'name registerNo email department academicBatch year profileImage')
            .sort({ createdAt: -1 });
        res.json({ success: true, placements });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// @desc    Get placement stats (Unique students count)
// @route   GET /api/placements/stats
router.get('/stats', protect, isAdmin, async (req, res) => {
    try {
        // Updated for Folders structure
        const results = await Placement.aggregate([
            { $unwind: '$folders' },
            { $unwind: '$folders.selectedStudents' },
            { $group: { _id: '$folders.selectedStudents.studentId' } },
            { $count: 'uniqueCount' }
        ]);
        const uniqueCount = results.length > 0 ? results[0].uniqueCount : 0;
        res.json({ success: true, uniqueCount });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// @desc    Create a new company for placement
// @route   POST /api/placements
router.post('/', protect, isAdmin, upload.single('logo'), async (req, res) => {
    try {
        const { companyName, category } = req.body;
        if (!companyName || !category) {
            return res.status(400).json({ success: false, message: 'Company name and category are required' });
        }

        let logoUrl = '';
        if (req.file) {
            const driveRes = await uploadFileToDrive({
                fileBuffer: req.file.buffer,
                fileName: `logo-${Date.now()}-${req.file.originalname}`,
                mimeType: req.file.mimetype,
                folderId: process.env.GOOGLE_DRIVE_LOGO_FOLDER_ID
            });
            logoUrl = driveRes.displayLink || driveRes.viewLink;
        }

        const placement = await Placement.create({
            companyName,
            category,
            logo: logoUrl,
            folders: [{ folderName: 'Drive Selections' }], // Default folder
            createdBy: req.user._id
        });
        res.status(201).json({ success: true, placement });
    } catch (err) {
        console.error('Create Company Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// @desc    Add students to a company's specific folder
// @route   POST /api/placements/:id/add-students
router.post('/:id/add-students', protect, isAdmin, async (req, res) => {
    try {
        const { selections, folderId } = req.body; 
        if (!selections || !Array.isArray(selections)) {
            return res.status(400).json({ success: false, message: 'Invalid selections data' });
        }

        const placement = await Placement.findById(req.params.id);
        if (!placement) return res.status(404).json({ success: false, message: 'Company not found' });

        // Find the folder
        const folder = placement.folders.id(folderId);
        if (!folder) return res.status(404).json({ success: false, message: 'Recruitment folder not found' });

        for (const sel of selections) {
            folder.selectedStudents.push({
                studentId: sel.studentId,
                role: sel.role,
                package: sel.package
            });

            await User.findByIdAndUpdate(sel.studentId, {
                $set: { isPlaced: true },
                $push: { 
                    placementData: {
                        company: placement.companyName,
                        role: sel.role,
                        package: sel.package
                    }
                }
            });
        }

        await placement.save();
        res.json({ success: true, placement });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// @desc    Add a subfolder to a company
// @route   POST /api/placements/:id/folders
router.post('/:id/folders', protect, isAdmin, async (req, res) => {
    try {
        const { folderName } = req.body;
        if (!folderName) return res.status(400).json({ success: false, message: 'Folder name is required' });

        const placement = await Placement.findById(req.params.id);
        if (!placement) return res.status(404).json({ success: false, message: 'Company not found' });

        placement.folders.push({ folderName });
        await placement.save();

        res.json({ success: true, folder: placement.folders[placement.folders.length - 1] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// @desc    List all placed students across all companies (Grouped by Student)
// @route   GET /api/placements/all-students
router.get('/all-students', protect, isAdmin, async (req, res) => {
    try {
        const placements = await Placement.find({}).populate('folders.selectedStudents.studentId', 'name registerNo department academicBatch year email profileImage');
        
        let studentMap = {};

        placements.forEach(p => {
            p.folders.forEach(f => {
                f.selectedStudents.forEach(item => {
                    if (!item.studentId) return;
                    const sid = item.studentId._id.toString();
                    if (!studentMap[sid]) {
                        studentMap[sid] = {
                            student: item.studentId,
                            companies: [],
                            roles: [],
                            packages: [],
                            categories: []
                        };
                    }
                    studentMap[sid].companies.push(p.companyName);
                    studentMap[sid].roles.push(item.role);
                    studentMap[sid].packages.push(item.package);
                    studentMap[sid].categories.push(p.category);
                    
                    if (!studentMap[sid].logo && p.logo) {
                        studentMap[sid].logo = p.logo;
                    }
                });
            });
        });

        // Map aggregated results into final list format with smart deduplication for companies
        const allPlaced = Object.values(studentMap).map(s => {
            // Deduplicate company names if they are identical
            const uniqueCompanies = [...new Set(s.companies)];
            return {
                student: s.student,
                company: uniqueCompanies.join(' / '),
                role: s.roles.join(' / '),
                package: s.packages.map(p => `${p} LPA`).join(' / '),
                category: [...new Set(s.categories)].join(' / '),
                logo: s.logo
            };
        });

        res.json({ success: true, count: allPlaced.length, students: allPlaced });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// @desc    Update a subfolder name
// @route   PATCH /api/placements/:id/folders/:folderId
router.patch('/:id/folders/:folderId', protect, isAdmin, async (req, res) => {
    try {
        const { folderName } = req.body;
        if (!folderName) return res.status(400).json({ success: false, message: 'Folder name is required' });

        const placement = await Placement.findById(req.params.id);
        if (!placement) return res.status(404).json({ success: false, message: 'Company not found' });

        const folder = placement.folders.id(req.params.folderId);
        if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

        folder.folderName = folderName;
        await placement.save();

        res.json({ success: true, placement });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// @desc    Delete a subfolder from a company
// @route   DELETE /api/placements/:id/folders/:folderId
router.delete('/:id/folders/:folderId', protect, isAdmin, async (req, res) => {
    try {
        const placement = await Placement.findById(req.params.id);
        if (!placement) return res.status(404).json({ success: false, message: 'Company not found' });

        placement.folders.pull({ _id: req.params.folderId });
        await placement.save();

        res.json({ success: true, placement });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// @desc    Update a company
// @route   PATCH /api/placements/:id
router.patch('/:id', protect, isAdmin, upload.single('logo'), async (req, res) => {
    try {
        const { companyName, category } = req.body;
        const placement = await Placement.findById(req.params.id);
        if (!placement) return res.status(404).json({ success: false, message: 'Company not found' });

        if (companyName) placement.companyName = companyName;
        if (category) placement.category = category;

        if (req.file) {
            const driveRes = await uploadFileToDrive({
                fileBuffer: req.file.buffer,
                fileName: `logo-${Date.now()}-${req.file.originalname}`,
                mimeType: req.file.mimetype,
                folderId: process.env.GOOGLE_DRIVE_LOGO_FOLDER_ID
            });
            placement.logo = driveRes.displayLink || driveRes.viewLink;
        }

        await placement.save();
        res.json({ success: true, placement });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// @desc    Delete a company
// @route   DELETE /api/placements/:id
router.delete('/:id', protect, isAdmin, async (req, res) => {
    try {
        const placement = await Placement.findByIdAndDelete(req.params.id);
        if (!placement) return res.status(404).json({ success: false, message: 'Company not found' });
        res.json({ success: true, message: 'Company record excised' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
