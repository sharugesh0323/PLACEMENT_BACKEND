const express = require('express');
const router = express.Router();
const Section = require('../models/Section');
const { protect, isAdmin } = require('../middleware/auth');

// GET /api/admin/sections
router.get('/', protect, isAdmin, async (req, res) => {
    try {
        const sections = await Section.find().sort({ displayOrder: 1, createdAt: -1 });
        res.json({ success: true, sections });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/admin/sections
router.post('/', protect, isAdmin, async (req, res) => {
    try {
        const { name, description, type, isActive, displayOrder, parentId } = req.body;
        
        // Find if a section with the same name exists in the same parent
        const exists = await Section.findOne({ name, parentId: parentId || null });
        if (exists) return res.status(400).json({ success: false, message: 'Section name already exists in this folder' });

        const section = await Section.create({
            name, description, type, isActive, displayOrder, parentId: parentId || null, createdBy: req.user._id
        });
        res.status(201).json({ success: true, section });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// PUT /api/admin/sections/:id
router.put('/:id', protect, isAdmin, async (req, res) => {
    try {
        const section = await Section.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!section) return res.status(404).json({ success: false, message: 'Section not found' });
        res.json({ success: true, section });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/admin/sections/:id
router.delete('/:id', protect, isAdmin, async (req, res) => {
    try {
        const section = await Section.findByIdAndDelete(req.params.id);
        if (!section) return res.status(404).json({ success: false, message: 'Section not found' });
        res.json({ success: true, message: 'Section deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
