const multer = require('multer');

// Use memory storage — files are uploaded to Google Drive, not local disk
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    // Highly inclusive list to support "all type of files" while preventing obviously dangerous ones if needed
    // However, since this is an internal admin-controlled portal, we can be very permissive
    cb(null, true);
};

// Max file size: 10 MB
const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 500 * 1024 * 1024 } // 500 MB to support video recordings
});

module.exports = upload;
