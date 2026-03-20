const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Assessment = require('../models/Assessment');
const Attempt = require('../models/Attempt');
const Batch = require('../models/Batch');
const Note = require('../models/Note');
const { protect, isSuperAdmin, isAdmin } = require('../middleware/auth');
const sendEmail = require('../utils/sendEmail');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadFileToDrive } = require('../utils/driveService');

// Multer config for attachments (Memory Storage for Drive uploads)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// GET /api/admin/dashboard - Dashboard stats
router.get('/dashboard', protect, isAdmin, async (req, res) => {
    try {
        const deptFilter = req.user.role === 'admin' ? { department: req.user.department } : {};

        const [totalStudents, totalAssessments, totalAttempts, totalNotes, recentAttempts, activeAttempts] = await Promise.all([
            User.countDocuments({ role: 'student', ...deptFilter }),
            Assessment.countDocuments(deptFilter),
            Attempt.countDocuments(deptFilter.department ? {
                assessmentId: { $in: await Assessment.find(deptFilter).distinct('_id') }
            } : {}),
            Note.countDocuments({}),
            Attempt.aggregate([
                {
                    $match: {
                        status: { $ne: 'active' },
                        ...(deptFilter.department ? {
                            assessmentId: { $in: await (require('../models/Assessment').find(deptFilter).distinct('_id')) }
                        } : {})
                    }
                },
                { $sort: { createdAt: -1 } },
                {
                    $group: {
                        _id: { studentId: '$studentId', assessmentId: '$assessmentId' },
                        latest: { $first: '$$ROOT' }
                    }
                },
                { $replaceRoot: { newRoot: '$latest' } },
                { $sort: { createdAt: -1 } },
                { $limit: 10 },
                { $lookup: { from: 'users', localField: 'studentId', foreignField: '_id', as: 'studentId' } },
                { $unwind: '$studentId' },
                { $lookup: { from: 'assessments', localField: 'assessmentId', foreignField: '_id', as: 'assessmentId' } },
                { $unwind: '$assessmentId' }
            ]),
            Attempt.find({ status: 'active' })
                .populate('studentId', 'name registerNo department trainingBatch academicBatch')
                .populate('assessmentId', 'title')
                .sort({ entryTime: -1 })
        ]);

        // Filter active attempts by department and prevent duplicates
        const uniqueEntries = new Set();
        const liveStudents = [];

        activeAttempts.forEach(a => {
            if (req.user.role !== 'superadmin' && a.studentId?.department !== req.user.department) return;

            const key = `${a.studentId?._id}-${a.assessmentId?._id}`;
            if (uniqueEntries.has(key)) return;
            uniqueEntries.add(key);

            liveStudents.push({
                attemptId: a._id,
                studentId: a.studentId?._id,
                studentName: a.studentId?.name,
                registerNo: a.studentId?.registerNo,
                department: a.studentId?.department,
                batch: a.studentId?.trainingBatch,
                academicBatch: a.studentId?.academicBatch,
                assessmentId: a.assessmentId?._id,
                assessmentName: a.assessmentId?.title,
                entryTime: a.entryTime,
                lastEvent: a.activityLog?.length > 0 ? a.activityLog[a.activityLog.length - 1].event : null
            });
        });

        // Department-wise student count (superadmin)
        let deptStats = [];
        if (req.user.role === 'superadmin') {
            const rawDepts = await User.aggregate([
                { $match: { role: 'student' } },
                { $project: { department: { $toUpper: { $trim: { input: "$department" } } } } },
                { $group: { _id: '$department', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]);
            deptStats = rawDepts;
        }

        // Filter recent attempts by cleared list
        const user = await User.findById(req.user._id);
        const clearedIds = user.clearedRecentSubmissions || [];

        const filteredRecentAttempts = recentAttempts.filter(a => !clearedIds.includes(a._id.toString()));

        res.json({ success: true, stats: { totalStudents, totalAssessments, totalAttempts, totalNotes, recentAttempts: filteredRecentAttempts, deptStats, liveStudents } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/clear-recent-submissions
router.post('/clear-recent-submissions', protect, isAdmin, async (req, res) => {
    console.log('Clearing recent submissions for user:', req.user._id);
    try {
        const { attemptIds } = req.body;
        if (!attemptIds || !Array.isArray(attemptIds)) {
            return res.status(400).json({ success: false, message: 'Invalid attempt IDs' });
        }

        await User.findByIdAndUpdate(req.user._id, {
            $addToSet: { clearedRecentSubmissions: { $each: attemptIds.map(id => id.toString()) } }
        });

        res.json({ success: true, message: 'Recent submissions cleared' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/analytics - Graph analytics (both admin and superadmin)
router.get('/analytics', protect, isAdmin, async (req, res) => {
    try {
        const isSuper = req.user.role === 'superadmin';
        const authDept = req.user.department;

        // Parse multi-select filters
        const parseMulti = (val) => {
            if (!val || val === 'All' || val === '') return null;
            const arr = Array.isArray(val) ? val : val.split(',').filter(x => x && x !== 'All' && x !== '');
            return arr.length > 0 ? arr : null;
        };

        const fDepts = parseMulti(req.query.dept);
        const fYears = parseMulti(req.query.year);
        const fBatches = parseMulti(req.query.batch);
        const fAssessments = parseMulti(req.query.assessments);

        // Define match objects for filtering students
        const userMatch = { role: 'student' };
        if (!isSuper) userMatch.department = authDept;
        if (fDepts) userMatch.department = { $in: fDepts };
        if (fYears) userMatch.year = { $in: fYears };

        if (req.query.viewMode === 'splitting') {
            userMatch.trainingBatch = { $in: [null, '', 'All', 'All Batches'] };
        } else if (fBatches) {
            userMatch.trainingBatch = { $in: fBatches };
        }

        // Define match objects for filtering attempts/assessments
        const attemptMatch = {};
        if (fAssessments) {
            attemptMatch.assessmentId = { $in: fAssessments.map(id => new mongoose.Types.ObjectId(id)) };
        }

        // Assessment match for participation stats
        const outerAssessmentMatch = isSuper ? {} : { 'assessment.department': authDept };
        if (fAssessments) {
            outerAssessmentMatch.assessmentId = { $in: fAssessments.map(id => new mongoose.Types.ObjectId(id)) };
        }

        // 1. Participation per assessment
        const participationByAssessment = await Attempt.aggregate([
            { $match: attemptMatch },
            {
                $lookup: {
                    from: 'assessments',
                    localField: 'assessmentId',
                    foreignField: '_id',
                    as: 'assessment'
                }
            },
            { $unwind: '$assessment' },
            { $match: outerAssessmentMatch },
            {
                $group: {
                    _id: '$assessmentId',
                    title: { $first: '$assessment.title' },
                    count: { $sum: 1 },
                    avgScore: { $avg: '$score' }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        // 2. Comprehensive Student List with dynamic filtering
        const topStudents = await User.aggregate([
            { $match: userMatch },
            {
                $lookup: {
                    from: 'attempts',
                    localField: '_id',
                    foreignField: 'studentId',
                    as: 'attempts'
                }
            },
            {
                $project: {
                    name: 1,
                    registerNo: 1,
                    department: 1,
                    batch: '$trainingBatch',
                    year: 1,
                    totalScore: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: '$attempts',
                                        as: 'att',
                                        cond: {
                                            $and: [
                                                { $in: ['$$att.status', ['completed', 'auto_submitted', 'time_expired']] },
                                                (fAssessments ? { $in: ['$$att.assessmentId', fAssessments.map(id => new mongoose.Types.ObjectId(id))] } : { $literal: true })
                                            ]
                                        }
                                    }
                                },
                                as: 'att',
                                in: '$$att.score'
                            }
                        }
                    },
                    attemptsCount: {
                        $size: {
                            $filter: {
                                input: '$attempts',
                                as: 'att',
                                cond: {
                                    $and: [
                                        { $in: ['$$att.status', ['completed', 'auto_submitted', 'time_expired']] },
                                        (fAssessments ? { $in: ['$$att.assessmentId', fAssessments.map(id => new mongoose.Types.ObjectId(id))] } : { $literal: true })
                                    ]
                                }
                            }
                        }
                    }
                }
            },
            { $sort: { totalScore: -1, name: 1 } },
            { $limit: 100 }
        ]);

        // 3. Performance Rankings (Respecting multi-filters)
        const attemptRankMatch = {};
        if (fAssessments) attemptRankMatch.assessmentId = { $in: fAssessments.map(id => new mongoose.Types.ObjectId(id)) };

        const joinStudentMatch = {};
        if (!isSuper) joinStudentMatch['student.department'] = authDept;
        if (fDepts) joinStudentMatch['student.department'] = { $in: fDepts };
        if (fYears) joinStudentMatch['student.year'] = { $in: fYears };
        if (fBatches) joinStudentMatch['student.trainingBatch'] = { $in: fBatches };

        const getRankingPipeline = (groupByField) => [
            { $match: attemptRankMatch },
            {
                $lookup: {
                    from: 'users',
                    localField: 'studentId',
                    foreignField: '_id',
                    as: 'student'
                }
            },
            { $unwind: '$student' },
            { $match: joinStudentMatch },
            {
                $group: {
                    _id: `$student.${groupByField}`,
                    avgScore: { $avg: '$percentage' },
                    totalAttempts: { $sum: 1 },
                    participationCount: { $sum: 1 }
                }
            }
        ];

        const [deptRank, batchRank, yearRank, allBatches, allDepts, deptCounts, batchCounts, yearCounts, allYears, allAssessments] = await Promise.all([
            Attempt.aggregate(getRankingPipeline('department')),
            Attempt.aggregate(getRankingPipeline('trainingBatch')),
            Attempt.aggregate(getRankingPipeline('year')),
            Batch.distinct('name'),
            isSuper ? User.aggregate([
                { $match: { role: 'student' } },
                { $project: { department: { $toUpper: { $trim: { input: "$department" } } } } },
                { $group: { _id: "$department" } },
                { $project: { _id: 0, department: "$_id" } }
            ]).then(res => res.map(r => r.department)) : Promise.resolve([authDept.toUpperCase()]),
            User.aggregate([
                { $match: userMatch },
                { $project: { department: { $toUpper: { $trim: { input: "$department" } } } } },
                { $group: { _id: '$department', count: { $sum: 1 } } }
            ]),
            User.aggregate([
                { $match: userMatch },
                { $group: { _id: '$trainingBatch', count: { $sum: 1 } } }
            ]),
            User.aggregate([
                { $match: userMatch },
                { $group: { _id: '$year', count: { $sum: 1 } } }
            ]),
            User.distinct('year', userMatch),
            Assessment.find(isSuper ? {} : { department: authDept }).select('title department')
        ]);

        // Merge logic
        const deptRanking = allDepts.filter(d => d).map(d => {
            const found = deptRank.find(r => r._id === d);
            const count = deptCounts.find(c => c._id === d)?.count || 0;
            return { _id: d, avgScore: found?.avgScore || 0, totalAttempts: found?.totalAttempts || 0, participationCount: found?.participationCount || 0, studentCount: count };
        }).sort((a, b) => b.avgScore - a.avgScore);

        const batchRanking = allBatches.filter(b => b).map(b => {
            const found = batchRank.find(r => r._id === b);
            const count = batchCounts.find(c => c._id === b)?.count || 0;
            return { _id: b, avgScore: found?.avgScore || 0, totalAttempts: found?.totalAttempts || 0, participationCount: found?.participationCount || 0, studentCount: count };
        }).sort((a, b) => b.avgScore - a.avgScore);

        const yearRanking = allYears.filter(y => y).map(y => {
            const found = yearRank.find(r => r._id === y);
            const count = yearCounts.find(c => c._id === y)?.count || 0;
            return { _id: y, avgScore: found?.avgScore || 0, totalAttempts: found?.totalAttempts || 0, participationCount: found?.participationCount || 0, studentCount: count };
        }).sort((a, b) => b._id.localeCompare(a._id));

        // Score distribution
        const scoreDistribution = await Attempt.aggregate([
            { $match: { status: { $in: ['completed', 'auto_submitted', 'time_expired'] }, ...attemptMatch } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'studentId',
                    foreignField: '_id',
                    as: 'student'
                }
            },
            { $unwind: '$student' },
            { $match: joinStudentMatch },
            {
                $bucket: {
                    groupBy: '$percentage',
                    boundaries: [0, 20, 40, 60, 80, 101],
                    default: 'Other',
                    output: { count: { $sum: 1 } }
                }
            }
        ]);

        // Monthly activity
        const monthlyActivity = await Attempt.aggregate([
            { $match: attemptMatch },
            {
                $lookup: {
                    from: 'users',
                    localField: 'studentId',
                    foreignField: '_id',
                    as: 'student'
                }
            },
            { $unwind: '$student' },
            { $match: joinStudentMatch },
            {
                $group: {
                    _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            { $limit: 12 }
        ]);

        res.json({
            success: true,
            analytics: { participationByAssessment, topStudents, deptRanking, batchRanking, yearRanking, scoreDistribution, monthlyActivity, allAssessments }
        });
    } catch (error) {
        console.error('Analytics Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/students/:id/extra-attempt (Global bonus - superadmin)
router.post('/students/:id/extra-attempt', protect, isSuperAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { $inc: { extraAttempts: 1 } },
            { new: true }
        );
        res.json({ success: true, user, message: 'Global extra attempt granted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/students/:id/grant-assessment-attempt (Specific assessment - admin/superadmin)
router.post('/students/:id/grant-assessment-attempt', protect, isAdmin, async (req, res) => {
    try {
        const { assessmentId } = req.body;
        if (!assessmentId) return res.status(400).json({ success: false, message: 'Assessment ID is required' });

        const student = await User.findById(req.params.id);
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const grantIndex = (student.extraAssessmentAttempts || []).findIndex(
            a => a.assessmentId.toString() === assessmentId.toString()
        );

        if (grantIndex > -1) {
            student.extraAssessmentAttempts[grantIndex].extraCount += 1;
        } else {
            student.extraAssessmentAttempts.push({ assessmentId, extraCount: 1 });
        }

        await student.save();
        res.json({ success: true, message: 'Extra attempt granted for this assessment' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/bulk-update-batch - Move multiple students to a batch
router.post('/bulk-update-batch', protect, isSuperAdmin, async (req, res) => {
    try {
        const { studentIds, batchName } = req.body;
        if (!studentIds || !Array.isArray(studentIds) || !batchName) {
            return res.status(400).json({ success: false, message: 'Invalid data provided' });
        }

        await User.updateMany(
            { _id: { $in: studentIds } },
            { $set: { trainingBatch: batchName } }
        );

        res.json({ success: true, message: `Successfully moved ${studentIds.length} students to ${batchName}` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/list
router.get('/list', protect, isSuperAdmin, async (req, res) => {
    try {
        const { role } = req.query;
        let filter;
        if (role === 'department_admin') {
            filter = { role: { $in: ['admin', 'department_admin'] } };
        } else if (role) {
            filter = { role };
        } else {
            filter = { role: { $in: ['admin', 'department_admin', 'batch_admin'] } };
        }
        const admins = await User.find(filter).select('-password');
        res.json({ success: true, admins });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/create
router.post('/create', protect, isSuperAdmin, async (req, res) => {
    try {
        const { name, email, registerNo, department, trainingBatch, academicBatch, password } = req.body;

        const userData = {
            name, email,
            password: password || 'admin123',
            department,
            trainingBatch,
            academicBatch,
            role: req.body.role || 'department_admin',
            mobileNo: req.body.phone, // Map phone to mobileNo
            createdBy: req.user._id
        };

        if (registerNo && registerNo.trim()) {
            userData.registerNo = registerNo.trim();
        }

        const user = await User.create(userData);

        if (trainingBatch && trainingBatch.trim() && trainingBatch !== 'All' && trainingBatch !== 'All Batches') {
            const batchName = trainingBatch.trim();
            const batchExists = await Batch.findOne({ name: batchName });
            if (!batchExists) {
                await Batch.create({
                    name: batchName,
                    description: `Automatically created for admin: ${name}`,
                    createdBy: req.user._id
                });
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

// PATCH /api/admin/toggle-active/:id
router.patch('/toggle-active/:id', protect, isSuperAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        const adminRoles = ['admin', 'department_admin', 'batch_admin'];
        if (!user || !adminRoles.includes(user.role)) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }
        user.isActive = !user.isActive;
        await user.save();
        res.json({ success: true, message: `Admin status toggled to ${user.isActive ? 'active' : 'inactive'}` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PATCH /api/admin/update/:id
router.patch('/update/:id', protect, isSuperAdmin, async (req, res) => {
    try {
        const { name, email, department, trainingBatch, phone, password } = req.body;
        const user = await User.findById(req.params.id);
        const adminRoles = ['admin', 'department_admin', 'batch_admin'];
        
        if (!user || !adminRoles.includes(user.role)) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }

        if (name) user.name = name;
        if (email) user.email = email;
        if (department) user.department = department;
        if (trainingBatch !== undefined) user.trainingBatch = trainingBatch;
        if (phone) user.mobileNo = phone; // Correct mapping to schema field
        if (password && password.trim() !== '') {
            user.password = password;
        }

        await user.save();

        if (trainingBatch && trainingBatch.trim() && trainingBatch !== 'All' && trainingBatch !== 'All Batches') {
            const batchName = trainingBatch.trim();
            const batchExists = await Batch.findOne({ name: batchName });
            if (!batchExists) {
                await Batch.create({
                    name: batchName,
                    description: `Automatically updated for admin: ${user.name}`,
                    createdBy: req.user._id
                });
            }
        }

        res.json({ success: true, message: 'Admin details updated successfully' });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/admin/revoke/:id
router.delete('/revoke/:id', protect, isSuperAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        const adminRoles = ['admin', 'department_admin', 'batch_admin'];
        if (!user || !adminRoles.includes(user.role)) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Admin access revoked' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/send-opportunity - Send bulk email and save to Opportunities page
router.post('/send-opportunity', protect, isAdmin, upload.single('attachment'), async (req, res) => {
    try {
        const { studentIds, subject, body } = req.body;
        const studentIdArray = JSON.parse(studentIds || '[]');

        if (!studentIdArray.length || !subject || !body) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const students = await User.find({ _id: { $in: studentIdArray } }).select('email name');
        if (!students.length) {
            return res.status(404).json({ success: false, message: 'No valid students found' });
        }

        const driveAttachments = [];
        const mailAttachments = [];

        if (req.file) {
            // 1. Upload to Google Drive for the Opportunities Portal
            const driveData = await uploadFileToDrive({
                fileBuffer: req.file.buffer,
                fileName: `opp-${Date.now()}-${req.file.originalname}`,
                mimeType: req.file.mimetype
            });

            driveAttachments.push({
                filename: req.file.originalname,
                url: driveData.viewLink,
                driveId: driveData.fileId
            });

            // 2. Prepare for Email
            mailAttachments.push({
                filename: req.file.originalname,
                content: req.file.buffer
            });
        }

        // 3. Save to Opportunity/Announcement Portal (So students see it in the app)
        const note = await Note.create({
            title: subject,
            content: body,
            type: 'opportunity',
            targetStudents: studentIdArray,
            attachments: driveAttachments,
            isPinned: true,
            createdBy: req.user._id,
            isActive: true
        });

        // 4. Send personalized emails
        const isSuperAdmin = req.user.role === 'superadmin';
        const senderFromName = isSuperAdmin ? 'Placement Cell' : req.user.name;

        const results = await Promise.all(students.map(async (student) => {
            return await sendEmail({
                to: student.email,
                subject: `[Placement Opportunity] ${subject}`,
                fromName: senderFromName,
                html: `
                    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                        <div style="background: #2563eb; padding: 30px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">New Job Opportunity</h1>
                        </div>
                        <div style="padding: 40px;">
                            <p style="font-size: 16px;">Dear <strong>${student.name}</strong>,</p>
                            <p style="font-size: 16px; color: #4b5563;">You have been shortlisted or targeted for a specific recruitment opportunity on the JJCET Training & Placement Portal.</p>
                            
                            <div style="margin: 30px 0; padding: 25px; background: #f0f7ff; border-left: 5px solid #2563eb; border-radius: 8px;">
                                <h3 style="margin-top: 0; color: #1e40af; font-size: 18px;">${subject}</h3>
                                <p style="font-size: 15px; color: #1e3a8a; white-space: pre-wrap;">${body}</p>
                            </div>

                            ${driveAttachments.length > 0 ? `
                            <div style="margin-top: 24px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 1px dashed #d1d5db;">
                                <p style="margin: 0; font-size: 14px; color: #6b7280; display: flex; align-items: center; gap: 8px;">
                                    📎 Attached: <strong>${driveAttachments[0].filename}</strong> (Included in this email)
                                </p>
                            </div>
                            ` : ''}

                            <div style="text-align: center; margin-top: 40px;">
                                <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/opportunities" style="background: #2563eb; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">View in Portal</a>
                            </div>
                        </div>
                        <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
                            &copy; ${new Date().getFullYear()} JJCET Placement Cell • Trichy, Tamil Nadu
                        </div>
                    </div>
                `,
                attachments: mailAttachments
            });
        }));

        const successCount = results.filter(r => r).length;
        res.json({ success: true, message: `Successfully sent to ${successCount} out of ${students.length} students. Added to Opportunities dashboard.`, note });

    } catch (error) {
        console.error('Send Opportunity Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
