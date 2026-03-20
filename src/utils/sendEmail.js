const nodemailer = require('nodemailer');

const sendEmail = async ({ to, subject, text, html, attachments, fromName, replyTo }) => {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const senderName = fromName ? `${fromName} via JJCET T&P` : 'JJCET T&P';
        const mailOptions = {
            from: `"${senderName}" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text,
            html,
            attachments,
            ...(replyTo ? { replyTo } : {})
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ' + info.response);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
};

module.exports = sendEmail;
