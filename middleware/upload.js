const multer = require('multer')

// Define the Multer instance
const upload = multer({ 
    dest: 'uploads/', 
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
})

// Export specific middleware functions
module.exports = {
    // Middleware for checking polyglots (single file)
    checkSingleFile: upload.single('file'), 
    
    // Middleware for creating polyglots (multiple fields/files)
    createPolyglotFiles: upload.fields([
        { name: 'imagefile', maxCount: 1 }, // Used for both PNG and JPG
        { name: 'zipfile', maxCount: 1 }
    ])
}