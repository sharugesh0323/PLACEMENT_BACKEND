const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const User = require('../models/User');
const { protect, isAdmin } = require('../middleware/auth');
const sendEmail = require('../utils/sendEmail');

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadFileToDrive } = require('../utils/driveService');

// Configure multer for memory storage (for Google Drive uploads)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// GET /api/notes
router.get('/', protect, async (req, res) => {
    try {
        let query = { isActive: true };

        // Students see notes they are targeted in OR that match their dept/batch
        if (req.user.role === 'student') {
            const userDept = req.user.department || 'All';
            const userBatch = req.user.batch || 'All';
            const userId = req.user._id;

            query.$or = [
                { targetStudents: userId }, // Specifically targeted at this student
                {
                    $and: [
                        { departments: { $in: [userDept, 'All'] } },
                        {
                            $or: [
                                { batches: { $in: [userBatch, 'All', 'All Batches', null, ''] } },
                                { batches: { $exists: false } }
                            ]
                        }
                    ]
                }
            ];
        } else {
            // Admins see their own notes
            query.createdBy = req.user._id;
        }

        const notes = await Note.find(query)
            .populate('createdBy', 'name email role department')
            .populate('targetStudents', 'name email registerNo')
            .sort({ isPinned: -1, createdAt: -1 });

        // Transform superadmin name to 'Placement Cell' for students
        if (req.user.role === 'student') {
            const transformedNotes = notes.map(note => {
                const noteObj = note.toObject();
                if (noteObj.createdBy && (noteObj.createdBy.role === 'superadmin' || noteObj.createdBy.role === 'admin')) {
                    // For students, just show Placement Cell for any admin/superadmin 
                    // Or specifically superadmin as requested? 
                    // User said "from super admin make name of it placemnet cell instead of from superadmin"
                    if (noteObj.createdBy.role === 'superadmin') {
                        noteObj.createdBy.name = 'Placement Cell';
                    }
                }
                return noteObj;
            });
            return res.json({ success: true, notes: transformedNotes });
        }

        res.json({ success: true, notes });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/notes/bulk-announcement
router.post('/bulk-announcement', protect, isAdmin, upload.array('attachments'), async (req, res) => {
    try {
        const { title, content, studentIds, type } = req.body;

        let parsedStudentIds = studentIds;
        if (typeof studentIds === 'string') {
            try {
                parsedStudentIds = JSON.parse(studentIds);
            } catch (e) {
                parsedStudentIds = studentIds.split(',');
            }
        }

        if (!parsedStudentIds || !Array.isArray(parsedStudentIds) || parsedStudentIds.length === 0) {
            return res.status(400).json({ success: false, message: 'No students selected' });
        }

        const attachments = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const driveData = await uploadFileToDrive({
                    fileBuffer: file.buffer,
                    fileName: `${Date.now()}-${file.originalname}`,
                    mimeType: file.mimetype
                });
                attachments.push({
                    filename: file.originalname,
                    url: driveData.viewLink,
                    driveId: driveData.fileId
                });
            }
        }

        const note = await Note.create({
            title,
            content,
            departments: ['Specific'],
            batches: ['All'],
            targetStudents: parsedStudentIds,
            type: type || 'opportunity',
            isPinned: true,
            attachments,
            createdBy: req.user._id
        });

        // Email outreach
        const targetStudents = await User.find({ _id: { $in: parsedStudentIds } }).select('email name');

        if (targetStudents.length > 0) {
            const subject = `[Job Opportunity] ${title}`;
            const isSuperAdmin = req.user.role === 'superadmin';
            const senderFromName = isSuperAdmin ? 'Placement Cell' : req.user.name;
            const senderReplyTo = req.user.email;

            const mailAttachments = req.files ? req.files.map(file => ({
                filename: file.originalname,
                content: file.buffer
            })) : [];

            for (const student of targetStudents) {
                const firstName = student.name ? student.name.split(' ')[0] : 'Student';
                const portalUrl = process.env.CLIENT_URL || 'http://localhost:5173';

                const text = `Dear ${firstName},\n\nA new recruitment opportunity or announcement has been shared specifically with you on the JJCET TP Portal:\n\nTitle: ${title}\n\n${content}\n\n${attachments.length > 0 ? `📎 This message has ${attachments.length} attachment(s).` : ''}\n\nRegards,\n${senderFromName}`;

                sendEmail({
                    to: student.email,
                    subject,
                    text,
                    fromName: senderFromName,
                    replyTo: senderReplyTo,
                    attachments: mailAttachments
                });
            }
        }

        res.status(201).json({ success: true, message: `Announcement sent to ${parsedStudentIds.length} students`, note });
    } catch (error) {
        console.error('Bulk Announcement Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/notes - Original handler for global announcements
router.post('/', protect, isAdmin, upload.array('attachments'), async (req, res) => {
    try {
        const { title, content, departments, batches, year, isPinned, type } = req.body;
        const noteType = type || (isPinned === 'true' ? 'announcement' : 'note');

        let parsedDepts = departments;
        let parsedBatches = batches;

        if (typeof departments === 'string') {
            try { parsedDepts = JSON.parse(departments); } catch (e) { parsedDepts = [departments]; }
        }
        if (typeof batches === 'string') {
            try { parsedBatches = JSON.parse(batches); } catch (e) { parsedBatches = [batches]; }
        }

        if (!parsedDepts) parsedDepts = ['All'];
        if (!parsedBatches) parsedBatches = ['All'];

        const attachments = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const driveData = await uploadFileToDrive({
                    fileBuffer: file.buffer,
                    fileName: `${Date.now()}-${file.originalname}`,
                    mimeType: file.mimetype
                });
                attachments.push({
                    filename: file.originalname,
                    url: driveData.viewLink,
                    driveId: driveData.fileId
                });
            }
        }

        const noteData = {
            title,
            content,
            departments: parsedDepts,
            batches: parsedBatches,
            year,
            type: noteType,
            isPinned: noteType === 'announcement',
            attachments,
            createdBy: req.user._id
        };

        // If not superadmin/admin, override depts/batches
        if (req.user.role !== 'superadmin' && req.user.department !== 'All') {
            noteData.departments = [req.user.department];
            if (req.user.batch && req.user.batch !== 'All') {
                noteData.batches = [req.user.batch];
            }
        }

        const note = await Note.create(noteData);

        // Send email to target students
        try {
            const query = { role: 'student', isActive: true };
            if (!note.departments.includes('All')) query.department = { $in: note.departments };
            if (!note.batches.includes('All')) query.batch = { $in: note.batches };
            if (note.year) query.year = note.year;

            const targetStudents = await User.find(query).select('email name');

            if (targetStudents.length > 0) {
                const typeLabel = note.type === 'announcement' ? 'Announcement' : 'Notes';
                const subject = `[${typeLabel}] ${note.title}`;

                let postedBy = 'Placement Cell';
                if (req.user.role === 'admin' || req.user.role === 'batch_admin') {
                    if (req.user.department && req.user.department !== 'All') {
                        postedBy = `${req.user.name} (Department of ${req.user.department})`;
                    } else if (req.user.batch && req.user.batch !== 'All') {
                        postedBy = `${req.user.name} (${req.user.batch} Batch Admin)`;
                    } else {
                        postedBy = req.user.name;
                    }
                }

                const mailAttachments = req.files ? req.files.map(file => ({
                    filename: file.originalname,
                    content: file.buffer
                })) : [];

                // Determine sender display name and reply-to address
                const isSuperAdmin = req.user.role === 'superadmin';
                const senderFromName = isSuperAdmin ? 'Placement Cell' : req.user.name;
                const senderReplyTo = req.user.email || null;

                // Send personalized email per student (fire and forget)
                for (const student of targetStudents) {
                    const firstName = student.name ? student.name.split(' ')[0] : 'Student';
                    const portalUrl = process.env.CLIENT_URL || 'http://localhost:5173';
                    const targetPage = note.type === 'opportunity' ? 'opportunities' : 'notes';

                    const text = `Dear ${firstName},\n\nA new ${note.type === 'announcement' ? 'announcement' : 'note'} has been posted by ${postedBy}:\n\nTitle: ${note.title}\n\n${note.content}\n\n${note.attachments?.length > 0 ? `📎 This message has ${note.attachments.length} attachment(s).` : ''}\n\nRegards,\n${senderFromName}`;
                    sendEmail({ to: student.email, subject, text, attachments: mailAttachments, fromName: senderFromName, replyTo: senderReplyTo });
                }
            }
        } catch (mailErr) {
            console.error('Error sending email out:', mailErr);
        }

        res.status(201).json({ success: true, note });
    } catch (error) {
        console.error('Error creating note:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/notes/:id
router.put('/:id', protect, isAdmin, async (req, res) => {
    try {
        const note = await Note.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
        res.json({ success: true, note });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/notes/:id
router.delete('/:id', protect, isAdmin, async (req, res) => {
    try {
        await Note.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Note deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
