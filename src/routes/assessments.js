const express = require('express');
const router = express.Router();
const Assessment = require('../models/Assessment');
const Attempt = require('../models/Attempt');
const User = require('../models/User');
const { protect, isAdmin, isStudent } = require('../middleware/auth');
const sendEmail = require('../utils/sendEmail');

// GET /api/assessments - Get assessments for current user
router.get('/', protect, async (req, res) => {
    try {
        const now = new Date();
        const { type, status } = req.query;

        let query = {
            isActive: true,
            isGloballydisabled: false
        };

        if (req.user.role === 'student') {
            const escape = (s) => s.replace(/[.*+?^${}$()|[\]\\]/g, '\\$&');
            const userDept = (req.user.department || '').trim();
            const userBatch = (req.user.trainingBatch || req.user.academicBatch || req.user.batch || '').trim();
            const userYear = String(req.user.year || '').trim();

            query.$and = [];
            
            // Department Filter (Case-Insensitive & Robust)
            const deptRegex = new RegExp(`^(${escape(userDept)}|All)$`, 'i');
            query.$and.push({
                $or: [
                    { departments: { $regex: deptRegex } },
                    { department: { $regex: new RegExp(`^${escape(userDept)}$`, 'i') } },
                    { departments: { $size: 0 } },
                    { departments: { $exists: false } }
                ]
            });

            // Batch Filter (Case-Insensitive & Robust)
            const batchToMatch = (userBatch || 'No Batch Assigned').trim();
            const batchRegex = new RegExp(`^(${escape(batchToMatch)}|All|All Batches)$`, 'i');
            query.$and.push({
                $or: [
                    { batches: { $regex: batchRegex } },
                    { batch: { $regex: batchRegex } },
                    { batches: { $size: 0 } },
                    { batches: { $exists: false } }
                ]
            });

            // Year Filter (Case-Insensitive & Robust)
            if (userYear) {
                const yearRegex = new RegExp(`^(${escape(userYear)}|All)$`, 'i');
                query.$and.push({
                    $or: [
                        { years: { $regex: yearRegex } },
                        { year: { $regex: yearRegex } },
                        { years: { $size: 0 } },
                        { years: { $exists: false } }
                    ]
                });
            }
        } else if (req.user.role === 'admin') {
            if (req.user.department && req.user.department !== 'All') {
                query.$or = [
                    { departments: { $in: ['All', req.user.department] } },
                    { department: req.user.department } // backward compat
                ];
            }
        }

        if (type) query.type = type;

        if (status === 'upcoming') {
            query.endTime = { $gt: now };
        } else if (status === 'past') {
            query.endTime = { $lt: now };
        }

        console.log(`DEBUG: Dashboard Query for ${req.user.name}:`, JSON.stringify(query));

        const assessments = await Assessment.find(query)
            .populate('createdBy', 'name')
            .sort({ startTime: -1 });

        console.log(`DEBUG: Found ${assessments.length} assessments`);

        if (req.user.role === 'student') {
            const student = await User.findById(req.user._id);
            const assessmentsWithAttempts = await Promise.all(assessments.map(async a => {
                const finishedCount = await Attempt.countDocuments({
                    studentId: req.user._id,
                    assessmentId: a._id,
                    status: { $in: ['completed', 'auto_submitted', 'time_expired', 'kicked'] }
                });

                const specificExtra = (student.extraAssessmentAttempts || [])
                    .find(ex => ex.assessmentId.toString() === a._id.toString())?.extraCount || 0;

                const totalAllowed = (a.allowedAttempts || 1) + specificExtra + (student.extraAttempts || 0);

                const obj = a.toObject();
                obj.attemptsLeft = Math.max(0, totalAllowed - finishedCount);
                obj.isAttempted = finishedCount > 0;

                if (obj.questions) {
                    obj.questions = obj.questions.map(q => {
                        const { correctAnswer, ...rest } = q;
                        return { ...rest, testCases: q.testCases?.filter(tc => !tc.isHidden) };
                    });
                }
                return obj;
            }));
            return res.json({ success: true, assessments: assessmentsWithAttempts });
        }

        res.json({ success: true, assessments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/assessments/:id
router.get('/:id', protect, async (req, res) => {
    try {
        const assessment = await Assessment.findById(req.params.id).populate('createdBy', 'name');
        if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

        // Access control
        if (req.user.role === 'admin' && assessment.department !== req.user.department) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        res.json({ success: true, assessment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/assessments - Create assessment (admin)
router.post('/', protect, isAdmin, async (req, res) => {
    try {
        const assessmentData = {
            ...req.body,
            createdBy: req.user._id
        };

        // Admin can only create for their department (unless superadmin)
        if (req.user.role === 'admin' && req.user.department !== 'All') {
            assessmentData.departments = [req.user.department];
        }
        if (!assessmentData.departments || assessmentData.departments.length === 0) {
            assessmentData.departments = ['All'];
        }

        // Auto-populate programmingLanguagesAllowed from questions
        if (!assessmentData.programmingLanguagesAllowed || assessmentData.programmingLanguagesAllowed.length === 0) {
            const progQuestions = (assessmentData.questions || []).filter(q => q.type === 'programming');
            const langs = [...new Set(progQuestions.map(q => q.language).filter(Boolean))];
            assessmentData.programmingLanguagesAllowed = langs.length > 0 ? langs : ['python', 'c', 'cpp', 'java'];
        }

        const assessment = await Assessment.create(assessmentData);

        // --- NEW: Email Notification Logic ---
        try {
            // Build student query
            const studentQuery = { role: 'student', isActive: true };

            if (assessment.departments && assessment.departments.length > 0 && !assessment.departments.includes('All')) {
                studentQuery.department = { $in: assessment.departments };
            }

            if (assessment.batches && assessment.batches.length > 0 && !assessment.batches.includes('All') && !assessment.batches.includes('All Batches')) {
                studentQuery.$or = [
                    { academicBatch: { $in: assessment.batches } },
                    { trainingBatch: { $in: assessment.batches } }
                ];
            }

            if (assessment.years && assessment.years.length > 0 && !assessment.years.includes('All')) {
                studentQuery.year = { $in: assessment.years };
            }

            const students = await User.find(studentQuery).select('email name');
            console.log(`DEBUG: Sending emails to ${students.length} students for assessment ${assessment._id}`);

            if (students.length > 0) {
                const assessmentLink = `${process.env.CLIENT_URL}/assessment/${assessment._id}`;
                const subject = `New Assessment Assigned: ${assessment.title}`;
                
                const formatTime = (date) => new Date(date).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    dateStyle: 'medium',
                    timeStyle: 'short'
                });

                const html = `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
                        <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 30px 20px; text-align: center;">
                            <h1 style="color: white; margin: 0; font-size: 24px;">New Assessment Assigned</h1>
                        </div>
                        <div style="padding: 30px; color: #1f2937;">
                            <p style="font-size: 16px; line-height: 1.6;">Hello,</p>
                            <p style="font-size: 16px; line-height: 1.6;">A new assessment <strong>"${assessment.title}"</strong> has been assigned to you. Here are the details:</p>
                            
                            <div style="background-color: #f9fafb; border: 1px solid #f3f4f6; border-radius: 8px; padding: 20px; margin: 24px 0;">
                                <table style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 100px;">Duration</td>
                                        <td style="padding: 8px 0; color: #111827; font-weight: 600;">${assessment.duration} Minutes</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Starts On</td>
                                        <td style="padding: 8px 0; color: #111827; font-weight: 600;">${formatTime(assessment.startTime)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Ends On</td>
                                        <td style="padding: 8px 0; color: #111827; font-weight: 600;">${formatTime(assessment.endTime)}</td>
                                    </tr>
                                </table>
                            </div>

                            <div style="text-align: center; margin-top: 32px;">
                                <a href="${assessmentLink}" 
                                   style="background-color: #4f46e5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; transition: background-color 0.2s;">
                                   View Assessment
                                </a>
                            </div>
                            
                            <p style="margin-top: 32px; font-size: 13px; color: #9ca3af; text-align: center;">
                                If you cannot click the button, copy and paste this link: <br/>
                                <span style="color: #4f46e5;">${assessmentLink}</span>
                            </p>
                        </div>
                        <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
                            <p style="margin: 0; font-size: 12px; color: #9ca3af;">JJCET Training & Placement Cell</p>
                        </div>
                    </div>
                `;

                const text = `Hello, A new assessment "${assessment.title}" has been assigned. Duration: ${assessment.duration} mins. Starts: ${formatTime(assessment.startTime)}. Link: ${assessmentLink}`;

                // Send emails in background
                students.forEach(student => {
                    sendEmail({
                        to: student.email,
                        subject: `[Assessment] ${assessment.title}`,
                        text,
                        html
                    }).catch(err => console.error(`Failed to send email to ${student.email}:`, err));
                });
            }
        } catch (emailError) {
            console.error('Error in assessment email notification trigger:', emailError);
        }

        res.status(201).json({ success: true, assessment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/assessments/:id - Update assessment
router.put('/:id', protect, isAdmin, async (req, res) => {
    try {
        const assessment = await Assessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

        if (req.user.role === 'admin' && assessment.department !== req.user.department) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // Update fields
        const updatableFields = ['title', 'description', 'departments', 'batches', 'years', 'type', 'startTime', 'endTime',
            'duration', 'questions', 'strictMode', 'allowViewAnswers', 'maxWarnings', 'allowedAttempts', 'isActive',
            'programmingLanguagesAllowed', 'shuffleQuestions', 'overallCutoff', 'sectionCutoffs', 'recordingEnabled'];
        updatableFields.forEach(field => {
            if (req.body[field] !== undefined) {
                assessment[field] = req.body[field];
            }
        });

        // Auto-populate programmingLanguagesAllowed from questions
        if (!assessment.programmingLanguagesAllowed || assessment.programmingLanguagesAllowed.length === 0) {
            const progQuestions = (assessment.questions || []).filter(q => q.type === 'programming');
            const langs = [...new Set(progQuestions.map(q => q.language).filter(Boolean))];
            assessment.programmingLanguagesAllowed = langs.length > 0 ? langs : ['python', 'c', 'cpp', 'java'];
        }

        await assessment.save(); // Triggers pre-save hook to recalculate totalMarks
        res.json({ success: true, assessment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/assessments/:id
router.delete('/:id', protect, isAdmin, async (req, res) => {
    try {
        await Assessment.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Assessment deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/assessments/:id/toggle-global
router.post('/:id/toggle-global', protect, async (req, res) => {
    try {
        if (req.user.role !== 'superadmin') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        const assessment = await Assessment.findById(req.params.id);
        assessment.isGloballydisabled = !assessment.isGloballydisabled;
        await assessment.save();
        res.json({ success: true, assessment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/assessments/:id/stats - Get assessment statistics
router.get('/:id/stats', protect, isAdmin, async (req, res) => {
    try {
        const attempts = await Attempt.find({ assessmentId: req.params.id })
            .populate('studentId', 'name email registerNo department batch');

        const stats = {
            total: attempts.length,
            active: attempts.filter(a => a.status === 'active').length,
            completed: attempts.filter(a => a.status === 'completed').length,
            kicked: attempts.filter(a => a.status === 'kicked').length,
            avgScore: attempts.length ? attempts.reduce((s, a) => s + a.score, 0) / attempts.length : 0,
            attempts
        };

        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
