const express = require('express');
const router = express.Router();
const Attempt = require('../models/Attempt');
const Assessment = require('../models/Assessment');
const User = require('../models/User');
const { protect, isAdmin } = require('../middleware/auth');
const sendEmail = require('../utils/sendEmail');

// Helper: convert to CSV
const toCSV = (data, fields) => {
    const header = fields.join(',');
    const rows = data.map(row => fields.map(f => {
        const val = f.split('.').reduce((o, k) => o?.[k], row);
        return `"${String(val ?? '').replace(/"/g, '""')}"`;
    }).join(','));
    return [header, ...rows].join('\n');
};

// GET /api/reports/assessment/:id/analysis - Detailed analysis categorization
router.get('/assessment/:id/analysis', protect, isAdmin, async (req, res) => {
    try {
        const assessmentId = req.params.id;
        const assessment = await Assessment.findById(assessmentId);
        if (!assessment) return res.status(404).json({ success: false, message: "Assessment not found" });

        // 1. Get all students who SHOULD take this assessment
        const studentQuery = { role: 'student' };
        
        // Use plural "departments" as defined in the schema
        if (assessment.departments && assessment.departments.length > 0 && !assessment.departments.includes('All')) {
            studentQuery.department = { $in: assessment.departments.map(d => new RegExp(`^${d}$`, 'i')) };
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

        const targetStudents = await User.find(studentQuery).select('name email registerNo department batch academicBatch trainingBatch year').lean();
        const targetStudentIds = new Set(targetStudents.map(s => s._id.toString()));

        // 2. Get all attempts for this assessment
        const attempts = await Attempt.find({ assessmentId })
            .populate('studentId', 'name email registerNo department batch academicBatch trainingBatch year')
            .lean();

        // ONLY count attempts from targeted ones
        const targetedAttempts = attempts.filter(a => a.studentId && targetStudentIds.has(a.studentId._id.toString()));

        // 3. Categorize
        const malpractice = targetedAttempts.filter(a => a.status === 'kicked' || a.kickoutReason);
        const attended = targetedAttempts.filter(a => a.status !== 'kicked' && !a.kickoutReason);

        const attemptedStudentIds = new Set(targetedAttempts.map(a => a.studentId?._id?.toString()));
        const notAttended = targetStudents.filter(s => !attemptedStudentIds.has(s._id.toString()));

        // Helper: normalize dept/batch names — acronyms (<=4 chars) stay UPPERCASE, longer words are Title Cased
        const normalizeName = (name) => {
            if (!name || !name.trim()) return 'Unknown';
            return name.trim().split(/\s+/).map(word => {
                if (word.length <= 4 && /^[a-zA-Z]+$/.test(word)) return word.toUpperCase();
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            }).join(' ');
        };

        // 4. Summary Statistics
        const deptSummary = {};
        const batchSummary = {};

        // Track unique students per category
        const deptAttendedIds = {};
        const batchAttendedIds = {};

        attended.forEach(a => {
            const sid = a.studentId?._id?.toString();
            if (!sid) return;

            const dept = normalizeName(a.studentId?.department);
            const batch = normalizeName(a.studentId?.batch || a.studentId?.academicBatch || a.studentId?.trainingBatch);

            if (!deptSummary[dept]) deptSummary[dept] = { total: 0, attended: 0, malpractice: 0, totalScore: 0, top: 0, average: 0, poor: 0 };
            if (!batchSummary[batch]) batchSummary[batch] = { total: 0, attended: 0, malpractice: 0, totalScore: 0, top: 0, average: 0, poor: 0 };

            if (!deptAttendedIds[dept]) deptAttendedIds[dept] = new Set();
            if (!batchAttendedIds[batch]) batchAttendedIds[batch] = new Set();

            // Count only unique students for 'attended' count
            if (!deptAttendedIds[dept].has(sid)) {
                deptSummary[dept].attended++;
                deptAttendedIds[dept].add(sid);
            }
            if (!batchAttendedIds[batch].has(sid)) {
                batchSummary[batch].attended++;
                batchAttendedIds[batch].add(sid);
            }

            deptSummary[dept].totalScore += a.score || 0;
            batchSummary[batch].totalScore += a.score || 0;

            const percentage = assessment.totalMarks ? (a.score / assessment.totalMarks) * 100 : 0;
            if (percentage >= 80) deptSummary[dept].top++;
            else if (percentage >= 50) deptSummary[dept].average++;
            else deptSummary[dept].poor++;

            if (percentage >= 80) batchSummary[batch].top++;
            else if (percentage >= 50) batchSummary[batch].average++;
            else batchSummary[batch].poor++;
        });

        malpractice.forEach(a => {
            const dept = normalizeName(a.studentId?.department);
            const batch = normalizeName(a.studentId?.batch || a.studentId?.academicBatch || a.studentId?.trainingBatch);
            if (!deptSummary[dept]) deptSummary[dept] = { total: 0, attended: 0, malpractice: 0, totalScore: 0, top: 0, average: 0, poor: 0 };
            if (!batchSummary[batch]) batchSummary[batch] = { total: 0, attended: 0, malpractice: 0, totalScore: 0, top: 0, average: 0, poor: 0 };
            deptSummary[dept].malpractice++;
            batchSummary[batch].malpractice++;
        });

        // ONLY Targeted students should contribute to total strength
        targetStudents.forEach(s => {
            const dept = normalizeName(s.department);
            const batch = normalizeName(s.batch || s.academicBatch || s.trainingBatch);
            if (!deptSummary[dept]) deptSummary[dept] = { total: 0, attended: 0, malpractice: 0, totalScore: 0, top: 0, average: 0, poor: 0 };
            if (!batchSummary[batch]) batchSummary[batch] = { total: 0, attended: 0, malpractice: 0, totalScore: 0, top: 0, average: 0, poor: 0 };
            deptSummary[dept].total++;
            batchSummary[batch].total++;
        });

        res.json({
            success: true,
            attended,
            malpractice,
            notAttended,
            summary: {
                departments: Object.keys(deptSummary)
                    .filter(name => deptSummary[name].total > 0) // Filter to targeted depts
                    .map(name => ({
                        name,
                        ...deptSummary[name],
                        avgScore: deptSummary[name].attended > 0 ? (deptSummary[name].totalScore / deptSummary[name].attended).toFixed(2) : 0
                    })),
                batches: Object.keys(batchSummary)
                    .filter(name => batchSummary[name].total > 0) // Filter to targeted batches
                    .map(name => ({
                        name,
                        ...batchSummary[name],
                        avgScore: batchSummary[name].attended > 0 ? (batchSummary[name].totalScore / batchSummary[name].attended).toFixed(2) : 0
                    }))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/reports/assessment/:id - Download assessment report (MOVED BELOW)
router.get('/assessment/:id', protect, isAdmin, async (req, res) => {
    try {
        const { format = 'csv' } = req.query;
        const attempts = await Attempt.find({ assessmentId: req.params.id })
            .populate('studentId', 'name email registerNo department batch')
            .populate('assessmentId', 'title type totalMarks')
            .lean();

        const assessment = await Assessment.findById(req.params.id);

        const rows = attempts.map(a => ({
            name: a.studentId?.name,
            email: a.studentId?.email,
            registerNo: a.studentId?.registerNo,
            department: a.studentId?.department,
            batch: a.studentId?.batch,
            entryTime: a.entryTime ? new Date(a.entryTime).toLocaleString() : '',
            exitTime: a.exitTime ? new Date(a.exitTime).toLocaleString() : '',
            duration: a.duration ? `${Math.floor(a.duration / 60)}m ${a.duration % 60}s` : '',
            score: a.score,
            totalMarks: a.totalMarks,
            percentage: a.percentage,
            status: a.status,
            kickoutReason: a.kickoutReason || '',
            tabSwitches: a.tabSwitchCount,
            fullscreenExits: a.fullscreenExitCount
        }));

        if (format === 'csv') {
            const fields = ['name', 'email', 'registerNo', 'department', 'batch', 'entryTime', 'exitTime', 'duration', 'score', 'totalMarks', 'percentage', 'status', 'kickoutReason', 'tabSwitches', 'fullscreenExits'];
            const csv = toCSV(rows, fields);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${assessment?.title || 'report'}_report.csv"`);
            return res.send(csv);
        }

        res.json({ success: true, rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/reports/assessment/:id/send-report - Email reports to students and admins
router.post('/assessment/:id/send-report', protect, isAdmin, async (req, res) => {
    try {
        const assessmentId = req.params.id;
        const { recipients = ['students', 'department_admin', 'batch_admin'] } = req.body;
        
        const assessment = await Assessment.findById(assessmentId);
        if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

        // Retrieve attempts to generate CSV
        const attempts = await Attempt.find({ assessmentId })
            .populate('studentId', 'name email registerNo department batch academicBatch trainingBatch year')
            .lean();

        // Find all target students 
        const studentQuery = { role: 'student', isActive: true };
        
        // Fix pluralization and handle case-insensitivity
        if (assessment.departments && assessment.departments.length > 0 && !assessment.departments.includes('All')) {
            studentQuery.department = { $in: assessment.departments.map(d => new RegExp(`^${d}$`, 'i')) };
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

        const targetedStudents = await User.find(studentQuery).select('name email department batch academicBatch trainingBatch _id');
        const targetStudentIds = new Set(targetedStudents.map(s => s._id.toString()));

        // Filter: ONLY consider attempts from targeted students for the overview
        const activeTargetedAttempts = attempts.filter(a => a.studentId && targetStudentIds.has(a.studentId?._id?.toString()));

        // 1. Generate Full Report Abstract CSV (Summary table)
        const normalizeName = (name) => {
            if (!name || !name.trim()) return 'Unknown';
            return name.trim().split(/\s+/).map(word => {
                if (word.length <= 4 && /^[a-zA-Z]+$/.test(word)) return word.toUpperCase();
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            }).join(' ');
        };

        const deptSummary = {};
        const deptAttendedIds = {}; // Use Set to track unique students per dept

        // Initialize with targeted departments only
        targetedStudents.forEach(s => {
            const dept = normalizeName(s.department);
            if (!deptSummary[dept]) deptSummary[dept] = { total: 0, attended: 0, top: 0, average: 0, poor: 0 };
            deptSummary[dept].total++;
        });

        const attended = activeTargetedAttempts.filter(a => a.status !== 'kicked' && !a.kickoutReason);

        attended.forEach(a => {
            const sid = a.studentId?._id?.toString();
            if (!sid) return;

            const dept = normalizeName(a.studentId?.department);
            if (!deptSummary[dept]) return; // Strictly restricted to targeted list
            
            if (!deptAttendedIds[dept]) deptAttendedIds[dept] = new Set();
            
            // Increment attended only if student is unique for this dept
            if (!deptAttendedIds[dept].has(sid)) {
                deptSummary[dept].attended++;
                deptAttendedIds[dept].add(sid);
            }
            
            const percentage = assessment.totalMarks ? (a.score / assessment.totalMarks) * 100 : 0;
            if (percentage >= 80) deptSummary[dept].top++;
            else if (percentage >= 50) deptSummary[dept].average++;
            else deptSummary[dept].poor++;
        });

        const summaryDepartments = Object.keys(deptSummary)
            .filter(name => deptSummary[name].total > 0) // Only show targeted ones
            .map(name => ({
                name, ...deptSummary[name]
            }));

        const dateStr = assessment.startTime ? new Date(assessment.startTime).toLocaleDateString('en-GB') : 'N/A';
        const abstractHeaders = ['DEPT', '% PARTICIPATION', 'TOTAL STRENGTH', 'NO. OF STUDENTS TAKEN', 'NO. OF STUDENTS NOT TAKEN', 'TOP PERFORMER (80%+)', 'AVG PERFORMER (50-79%)', 'POOR PERFORMER (<50%)'];
        
        const abstractRows = summaryDepartments.map(d => {
            const pct = d.total > 0 ? ((d.attended / d.total) * 100).toFixed(2) : '0.00';
            return [d.name, `${pct}%`, d.total, d.attended, d.total - d.attended, d.top || 0, d.average || 0, d.poor || 0];
        });

        const totalStrength = summaryDepartments.reduce((acc, d) => acc + d.total, 0);
        const totalAttended = summaryDepartments.reduce((acc, d) => acc + d.attended, 0);
        const totalTop = summaryDepartments.reduce((acc, d) => acc + (d.top || 0), 0);
        const totalAvg = summaryDepartments.reduce((acc, d) => acc + (d.average || 0), 0);
        const totalPoor = summaryDepartments.reduce((acc, d) => acc + (d.poor || 0), 0);
        const totalPct = totalStrength > 0 ? ((totalAttended / totalStrength) * 100).toFixed(2) : '0.00';

        const totalRow = ['TOTAL', `${totalPct}%`, totalStrength, totalAttended, totalStrength - totalAttended, totalTop, totalAvg, totalPoor];
        abstractRows.push(totalRow);

        // --- Helper: Generate HTML Table for Email ---
        const generateHtmlReport = (title, headers, rows) => {
            let html = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; max-width: 900px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                    <div style="background: #1e40af; color: white; padding: 24px; text-align: center;">
                        <h2 style="margin: 0; font-size: 22px; letter-spacing: 0.5px;">Assessment Performance Report</h2>
                        <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">${title.toUpperCase()}</p>
                    </div>
                    <div style="padding: 32px; background: white;">
                        <h3 style="color: #1e40af; font-size: 16px; margin-bottom: 20px; border-bottom: 2px solid #eff6ff; padding-bottom: 10px;">ANALYTICAL OVERVIEW</h3>
                        <div style="overflow-x: auto;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                                <thead>
                                    <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                                        ${headers.map(h => `<th style="padding: 12px 10px; font-weight: 700; color: #475569; text-transform: uppercase;">${h}</th>`).join('')}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows.map((row, idx) => {
                                        const isTotal = idx === rows.length - 1;
                                        return `<tr style="${isTotal ? 'background: #eff6ff; font-weight: 800; border-top: 2px solid #3b82f6;' : 'border-bottom: 1px solid #f1f5f9;'}">
                                            ${row.map((cell, cidx) => {
                                                let style = "padding: 12px 10px;";
                                                if (cidx === 1) style += "color: #2563eb; font-weight: 700;"; // % col
                                                if (cidx >= 5 && !isTotal) {
                                                    if (cidx === 5) style += "color: #059669;"; // Top
                                                    if (cidx === 6) style += "color: #d97706;"; // Avg
                                                    if (cidx === 7) style += "color: #dc2626;"; // Poor
                                                }
                                                return `<td style="${style}">${cell}</td>`;
                                            }).join('')}
                                        </tr>`;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
                            <p>Sent by JJCET Placement Cell • ${new Date().toLocaleDateString()}</p>
                        </div>
                    </div>
                </div>
            `;
            return html;
        };

        const reportHtml = generateHtmlReport(assessment.title, abstractHeaders, abstractRows);

        const sanitizeFn = str => (str || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
        const assessmentTitle = sanitizeFn(assessment.title);

        const fullCsvContent = [
            [`DATE: ${dateStr} - ${assessment.title.toUpperCase()} REPORT ABSTRACT`],
            [],
            abstractHeaders,
            ...abstractRows
        ].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');

        const fullAttachment = {
            filename: `${assessmentTitle}_Report_Abstract.csv`,
            content: fullCsvContent
        };

        // Reuse createCsv for dept/batch details
        const csvFields = ['Name', 'Email', 'Register No', 'Department', 'Batch', 'Score', 'Total Marks', 'Percentage', 'Status', 'Tab Switches', 'FS Exits'];
        const formatRow = (a) => {
            const s = a.studentId || {};
            return [
                s.name || 'N/A',
                s.email || 'N/A',
                s.registerNo || 'N/A',
                s.department || 'N/A',
                s.batch || s.academicBatch || s.trainingBatch || 'N/A',
                a.score || 0,
                assessment.totalMarks || 0,
                a.percentage || 0,
                a.status || 'N/A',
                a.tabSwitchCount || 0,
                a.fullscreenExitCount || 0
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        };
        const createCsv = (rows) => [csvFields.join(','), ...rows.map(formatRow)].join('\n');


        // 2. Group by Department
        const byDept = {};
        attempts.forEach(a => {
            const d = a.studentId?.department || 'Unknown';
            if (!byDept[d]) byDept[d] = [];
            byDept[d].push(a);
        });

        const deptAttachments = {};
        for (const [dept, atts] of Object.entries(byDept)) {
            deptAttachments[dept] = {
                filename: `${assessmentTitle}_Dept_${sanitizeFn(dept)}.csv`,
                content: createCsv(atts)
            };
        }

        // 3. Group by Batch
        const byBatch = {};
        attempts.forEach(a => {
            const b = a.studentId?.batch || 'Unknown';
            if (!byBatch[b]) byBatch[b] = [];
            byBatch[b].push(a);
        });

        const batchAttachments = {};
        for (const [batch, atts] of Object.entries(byBatch)) {
            batchAttachments[batch] = {
                filename: `${assessmentTitle}_Batch_${sanitizeFn(batch)}.csv`,
                content: createCsv(atts)
            };
        }

        // Send response immediately to not block the client
        res.json({ success: true, message: 'Reports are being generated and dispatched in the background.' });

        // --- BACKGROUND PROCESSING ---
        setImmediate(async () => {
            try {
                // Find Admins, Dept Heads, Batch Heads

                const adminQuery = {};
                const sendToHOD = recipients.includes('department_admin');
                const sendToBatchAdmin = recipients.includes('batch_admin');
                const sendToSuper = recipients.includes('super_admin') || recipients.includes('admin');

                const rolesToQuery = [];
                if (sendToHOD) rolesToQuery.push('department_admin');
                if (sendToBatchAdmin) rolesToQuery.push('batch_admin');
                if (sendToSuper) rolesToQuery.push('superadmin', 'admin');

                const admins = rolesToQuery.length > 0 ? await User.find({ role: { $in: rolesToQuery } }).select('name email department academicBatch trainingBatch role') : [];

                const subject = `Assessment Analytical Overview: ${assessment.title}`;
                const sentEmails = new Set();

                // 1. Send to Admins / Supervisors
                for (const admin of admins) {
                    if (sentEmails.has(admin.email)) continue;
                    sentEmails.add(admin.email);

                    const adminAtts = [fullAttachment];

                    if (admin.role === 'superadmin') {
                        Object.values(deptAttachments).forEach(a => adminAtts.push(a));
                    } else if (admin.role === 'department_admin' || (admin.role === 'admin' && admin.department)) {
                        const dept = admin.department;
                        if (dept && dept !== 'All' && deptAttachments[dept]) {
                            adminAtts.push(deptAttachments[dept]);
                        }
                    } else if (admin.role === 'batch_admin') {
                        const batch = admin.academicBatch || admin.trainingBatch;
                        if (batch && batch !== 'All' && batchAttachments[batch]) {
                            adminAtts.push(batchAttachments[batch]);
                        }
                    }

                    const uniqueAtts = Array.from(new Map(adminAtts.map(a => [a.filename, a])).values());

                    await sendEmail({
                        to: admin.email,
                        subject: `[ADMIN] ${subject}`,
                        html: `
                            <div style="margin-bottom: 20px;">
                                <p>Dear Admin,</p>
                                <p>Please find the analytical overview for the assessment <strong>${assessment.title}</strong> below. Detailed reports are attached to this email.</p>
                            </div>
                            ${reportHtml}
                        `,
                        attachments: uniqueAtts
                    }).catch(e => console.error(`Report email failed for admin ${admin.email}:`, e));
                }

                // 2. Send to Targeted Students
                if (recipients.includes('students')) {
                    for (const student of targetedStudents) {
                        if (sentEmails.has(student.email)) continue;
                        sentEmails.add(student.email);
                        
                        const studentAtts = [fullAttachment];
                        const batch = student.academicBatch || student.trainingBatch;
                        if (batch && batchAttachments[batch]) studentAtts.push(batchAttachments[batch]);
                        
                        const uniqueAtts = Array.from(new Map(studentAtts.map(a => [a.filename, a])).values());
                        
                        await sendEmail({
                            to: student.email,
                            subject: `[REPORT] ${subject}`,
                            html: `
                                <div style="margin-bottom: 20px;">
                                    <p>Dear ${student.name},</p>
                                    <p>Your assessment report for <strong>${assessment.title}</strong> has been published. Below is the analytical overview for your reference.</p>
                                </div>
                                ${reportHtml}
                            `,
                            attachments: uniqueAtts
                        }).catch(e => console.error(`Report email failed for student ${student.email}:`, e));
                    }
                }

                console.log(`[REPORT ENGINE] Finished sending reports for ${assessmentId}`);
            } catch (err) {
                console.error(`[REPORT ENGINE ERROR]`, err);
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// GET /api/reports/students - Download student list
router.get('/students', protect, isAdmin, async (req, res) => {
    try {
        const query = { role: 'student' };
        if (req.user.role === 'admin') query.department = req.user.department;

        const students = await User.find(query).lean();
        const rows = students.map(s => ({
            name: s.name,
            email: s.email,
            registerNo: s.registerNo || '',
            department: s.department || '',
            batch: s.batch || '',
            year: s.year || '',
            section: s.section || '',
            isActive: s.isActive
        }));

        const fields = ['name', 'email', 'registerNo', 'department', 'batch', 'year', 'section', 'isActive'];
        const csv = toCSV(rows, fields);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
        res.send(csv);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/reports/activity/:studentId - Student activity log
router.get('/activity/:studentId', protect, isAdmin, async (req, res) => {
    try {
        const attempts = await Attempt.find({ studentId: req.params.studentId })
            .populate('assessmentId', 'title')
            .lean();

        const rows = [];
        attempts.forEach(a => {
            a.activityLog?.forEach(log => {
                rows.push({
                    assessment: a.assessmentId?.title || '',
                    event: log.event,
                    details: log.details || '',
                    timestamp: log.timestamp ? new Date(log.timestamp).toLocaleString() : ''
                });
            });
        });

        const fields = ['assessment', 'event', 'details', 'timestamp'];
        const csv = toCSV(rows, fields);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="activity_log.csv"');
        res.send(csv);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
