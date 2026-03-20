const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground' // Redirect URI used in Playground
);

// Setup the credentials using the refresh token from your .env
oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

/**
 * Upload a file Buffer to Google Drive using User Identity (OAuth2).
 * @param {Object} params
 * @param {Buffer} params.fileBuffer - File content
 * @param {string} params.fileName   - Name on Drive
 * @param {string} params.mimeType   - MIME type
 * @param {string} [params.folderId] - Target folder
 */
const uploadFileToDrive = async ({ fileBuffer, fileName, mimeType, folderId }) => {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const targetFolder = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID;
    const { Readable } = require('stream');

    // 1. Upload
    const uploadRes = await drive.files.create({
        requestBody: {
            name: fileName,
            mimeType,
            parents: targetFolder ? [targetFolder] : []
        },
        media: {
            mimeType,
            body: Readable.from(fileBuffer)
        },
        fields: 'id, name, webViewLink, webContentLink'
    });

    const fileId = uploadRes.data.id;

    // 2. Permission (Public link)
    await drive.permissions.create({
        fileId,
        requestBody: {
            role: 'reader',
            type: 'anyone'
        }
    });

    return {
        fileId,
        viewLink: `https://drive.google.com/file/d/${fileId}/view`,
        downloadLink: `https://drive.google.com/uc?export=download&id=${fileId}`,
        displayLink: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`
    };
};

const deleteFileFromDrive = async (fileId) => {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    await drive.files.delete({ fileId });
};

const getFileAsBase64 = async (fileId) => {
    try {
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data);
        return `data:${res.headers['content-type']};base64,${buffer.toString('base64')}`;
    } catch (e) {
        console.error("Drive fetch base64 failed", e);
        return null;
    }
};

module.exports = { uploadFileToDrive, deleteFileFromDrive, getFileAsBase64 };
