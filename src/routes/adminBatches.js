const express = require('express');
const router = express.Router();
const Batch = require('../models/Batch');
const User = require('../models/User');
const { protect, isAdmin, isSuperAdmin } = require('../middleware/auth');

// @route   GET /api/admin/batches
// @desc    Get all batches
router.get('/', protect, isAdmin, async (req, res) => {
    try {
        const batches = await Batch.find().sort({ createdAt: -1 });
        res.json({ success: true, batches });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   POST /api/admin/batches
// @desc    Create a new batch
router.post('/', protect, isSuperAdmin, async (req, res) => {
    try {
        const { name, description, studentIdentifiers } = req.body;
        const exists = await Batch.findOne({ name });
        if (exists) return res.status(400).json({ success: false, message: 'Batch name already exists' });

        const batch = await Batch.create({
            name,
            description,
            createdBy: req.user._id
        });

        // Handle bulk student addition
        if (studentIdentifiers && Array.isArray(studentIdentifiers) && studentIdentifiers.length > 0) {
            const result = await User.updateMany(
                {
                    $or: [
                        { email: { $in: studentIdentifiers } },
                        { registerNo: { $in: studentIdentifiers } }
                    ]
                },
                { $set: { batch: batch.name } }
            );
            console.log(`Updated ${result.modifiedCount} students to batch ${batch.name}`);
        }

        res.status(201).json({ success: true, batch });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   PUT /api/admin/batches/:id
// @desc    Update batch
router.put('/:id', protect, isSuperAdmin, async (req, res) => {
    try {
        const { name, description, studentIdentifiers } = req.body;
        const oldBatch = await Batch.findById(req.params.id);
        if (!oldBatch) return res.status(404).json({ success: false, message: 'Batch not found' });

        const batch = await Batch.findByIdAndUpdate(req.params.id, { name, description }, { new: true });

        // If batch name changed, update all students previously in that batch
        if (name && name !== oldBatch.name) {
            await User.updateMany({ batch: oldBatch.name }, { $set: { batch: name } });
        }

        // Handle additional bulk student addition
        if (studentIdentifiers && Array.isArray(studentIdentifiers) && studentIdentifiers.length > 0) {
            await User.updateMany(
                {
                    $or: [
                        { email: { $in: studentIdentifiers } },
                        { registerNo: { $in: studentIdentifiers } }
                    ]
                },
                { $set: { batch: batch.name } }
            );
        }

        res.json({ success: true, batch });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   DELETE /api/admin/batches/:id
// @desc    Delete batch
router.delete('/:id', protect, isSuperAdmin, async (req, res) => {
    try {
        const batch = await Batch.findById(req.params.id);
        if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });

        // Check if students are assigned to this batch
        const studentCount = await User.countDocuments({ batch: batch.name });
        if (studentCount > 0) {
            return res.status(400).json({ success: false, message: `Cannot delete batch. ${studentCount} students are assigned to it.` });
        }

        await Batch.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Batch deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   POST /api/admin/batches/:id/clear-students
// @desc    Remove all students in this batch (Super Admin only)
router.post('/:id/clear-students', protect, isSuperAdmin, async (req, res) => {
    try {
        const batch = await Batch.findById(req.params.id);
        if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });

        const result = await User.updateMany(
            { role: 'student', batch: batch.name },
            { $set: { batch: '' } }
        );

        res.json({
            success: true,
            message: `Cleared ${result.modifiedCount} students from ${batch.name}. They remain in the system.`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
