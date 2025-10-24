const path = require('path');
const archiver = require('archiver');
const express = require('express');
const os = require('os');
const baseFs = require('fs');
const fs = require('fs').promises;
const crc = require('crc');
const { createPolyglotFiles, checkSingleFile } = require('../middleware/upload');

function extractPngText(buffer) {
    const tEXt_signature = Buffer.from('tEXt');
    let startIndex = 0;
    let extractedTexts = [];

    while (startIndex < buffer.length) {
        const tEXt_index = buffer.indexOf(tEXt_signature, startIndex);

        if (tEXt_index === -1) break;

        const length = buffer.readUInt32BE(tEXt_index - 4);
        const dataStart = tEXt_index + 4;
        const dataEnd = dataStart + length;
        const chunkData = buffer.slice(dataStart, dataEnd);
        const nullIndex = chunkData.indexOf(0x00);

        if (nullIndex !== -1) {
            const text = chunkData.slice(nullIndex + 1).toString('latin1');
            
            if (text.trim()) {
                extractedTexts.push(text.trim());
            }
        }
        
        startIndex = dataEnd + 4;
    }

    return extractedTexts;
}

function extractJpgText(buffer) {
    const commentMarker = Buffer.from([0xFF, 0xFE]);
    let startIndex = 0;
    let extractedTexts = [];

    while (startIndex < buffer.length) {
        const markerIndex = buffer.indexOf(commentMarker, startIndex);

        if (markerIndex === -1) break;
        
        const length = buffer.readUInt16BE(markerIndex + 2);
        
        const dataStart = markerIndex + 4;
        const dataEnd = dataStart + length - 2;
        
        const text = buffer.slice(dataStart, dataEnd).toString('utf-8').trim();

        if (text) {
            extractedTexts.push(text);
        }

        startIndex = dataEnd;
    }

    return extractedTexts;
}

async function extractComponents(buffer) {
    const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const zipSig = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    
    let component = {
        image: null,
        imageType: null,
        zip: null,
        text: ''
    };
    
    let imageEndIndex = buffer.length;
    let imageType = null;
    
    if (buffer.slice(0, 8).equals(pngSig)) {
        imageType = 'png';
        const iendIdx = buffer.indexOf(Buffer.from('IEND'));
        if (iendIdx !== -1) {
            imageEndIndex = iendIdx + 8; 
        }
    } else if (buffer.readUInt16BE(0) === 0xFFD8) {
        imageType = 'jpg';
        const eoiIdx = buffer.lastIndexOf(Buffer.from([0xFF, 0xD9]));
        if (eoiIdx !== -1) {
            imageEndIndex = eoiIdx + 2; 
        }
    }
    
    component.imageType = imageType;
    
    if (imageType) {
        component.image = buffer.slice(0, imageEndIndex);
    }

    if (imageType === 'png') {
        const texts = extractPngText(buffer);
        if (texts.length) component.text = texts.join('\n\n');
    } else if (imageType === 'jpg') {
        const texts = extractJpgText(buffer);
        if (texts.length) component.text = texts.join('\n\n');
    }

    // FIX: Ensure search for zip starts strictly after the image end index
    const firstZipIdx = buffer.indexOf(zipSig, imageEndIndex);
    if (firstZipIdx !== -1) {
        component.zip = buffer.slice(firstZipIdx);
    }
    
    return component;
}

function createTextChunk(keyword, text) {
  const keywordBuf = Buffer.from(keyword, 'ascii')
  const textBuf = Buffer.from(text, 'latin1')
  const data = Buffer.concat([keywordBuf, Buffer.from([0]), textBuf])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const type = Buffer.from('tEXt')
  const crcVal = crc.crc32(Buffer.concat([type, data]))
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crcVal, 0)
  return Buffer.concat([length, type, data, crcBuf])
}

function createJpegCommentSegment(text) {
  const textBuf = Buffer.from(text, 'utf-8')
  if (textBuf.length > 65533) throw new Error('Comment too long')
  const lenBuf = Buffer.alloc(2)
  lenBuf.writeUInt16BE(textBuf.length + 2, 0)
  return Buffer.concat([Buffer.from([0xFF, 0xFE]), lenBuf, textBuf])
}

async function readFileSafe(path) {
  try { return await fs.readFile(path) } catch { return null }
}

function createJpegPolyglot(jpgBuffer, text = '', zipBuffer = null) {
  if (jpgBuffer.readUInt16BE(0) !== 0xFFD8) return null
  let commentSegment = Buffer.alloc(0)
  if (text) commentSegment = createJpegCommentSegment(text)
  const eofIndex = jpgBuffer.lastIndexOf(Buffer.from([0xFF, 0xD9]))
  const mainImage = eofIndex !== -1 ? jpgBuffer.slice(0, eofIndex + 2) : jpgBuffer
  let output = Buffer.concat([mainImage.slice(0, 2), commentSegment, mainImage.slice(2)])
  if (zipBuffer && zipBuffer.slice(0, 2).toString() === 'PK') output = Buffer.concat([output, zipBuffer])
  return output
}

function detectEmbeddedFormats(buffer) {
  const formats = {}
  const pngSig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A])
  const jpgSig = Buffer.from([0xFF,0xD8])
  const zipSig = Buffer.from([0x50,0x4B,0x03,0x04])
  let idx = 0
  while (idx < buffer.length) {
    if (buffer.slice(idx, idx + 8).equals(pngSig)) { formats.png = formats.png || []; formats.png.push(idx); idx += 8; continue }
    if (buffer.slice(idx, idx + 2).equals(jpgSig)) { formats.jpg = formats.jpg || []; formats.jpg.push(idx); idx += 2; continue }
    if (buffer.slice(idx, idx + 4).equals(zipSig)) { formats.zip = formats.zip || []; formats.zip.push(idx); idx += 4; continue }
    idx++
  }
  return formats
}

const router = express.Router()

router.post('/create-png-polyglot', createPolyglotFiles, async (req, res) => {
  try {
    const pngFile = req.files?.imagefile?.[0] 
    if (!pngFile) return res.status(400).send('PNG file required')
    const zipFile = req.files?.zipfile?.[0]
    const textInput = (req.body.textdata || '').trim()
    const pngBuffer = await readFileSafe(pngFile.path)
    if (!pngBuffer || pngBuffer.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      await fs.unlink(pngFile.path)
      return res.status(400).send('Invalid PNG')
    }
    const iendIdx = pngBuffer.indexOf(Buffer.from('IEND'))
    if (iendIdx === -1) {
      await fs.unlink(pngFile.path)
      return res.status(400).send('Invalid PNG structure')
    }
    const beforeIEND = pngBuffer.slice(0, iendIdx - 4)
    const iendChunk = pngBuffer.slice(iendIdx - 4)
    let output = textInput ? Buffer.concat([beforeIEND, createTextChunk('Comment', textInput), iendChunk]) : Buffer.concat([beforeIEND, iendChunk])
    if (zipFile) {
      const zipBuffer = await readFileSafe(zipFile.path)
      if (zipBuffer && zipBuffer.slice(0, 2).toString() === 'PK') output = Buffer.concat([output, zipBuffer])
      await fs.unlink(zipFile.path)
    }
    res.setHeader('Content-Disposition', 'attachment; filename=polyglot.png')
    res.setHeader('Content-Type', 'image/png')
    res.send(output)
    await fs.unlink(pngFile.path)
  } catch(error) {
    console.error('PNG Creation Error:', error) 
    res.status(500).send('Error creating PNG polyglot')
  }
})

router.post('/create-jpg-polyglot', createPolyglotFiles, async (req, res) => {
  try {
    const jpgFile = req.files?.imagefile?.[0]
    if (!jpgFile) return res.status(400).send('JPG file required')
    const zipFile = req.files?.zipfile?.[0]
    const textInput = (req.body.textdata || '').trim()
    const jpgBuffer = await readFileSafe(jpgFile.path)
    if (!jpgBuffer || jpgBuffer.readUInt16BE(0) !== 0xFFD8) {
      await fs.unlink(jpgFile.path)
      return res.status(400).send('Invalid JPG')
    }
    const zipBuffer = zipFile ? await readFileSafe(zipFile.path) : null
    const output = createJpegPolyglot(jpgBuffer, textInput, zipBuffer)
    if (!output) return res.status(500).send('Error creating JPG polyglot')
    res.setHeader('Content-Disposition', 'attachment; filename=polyglot.jpg')
    res.setHeader('Content-Type', 'image/jpeg')
    res.send(output)
    await fs.unlink(jpgFile.path)
    if (zipFile) await fs.unlink(zipFile.path)
  } catch(error) {
    console.error('JPG Creation Error:', error) 
    res.status(500).send('Error creating JPG polyglot')
  }
})

router.post('/check-polyglot', checkSingleFile, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const buffer = await readFileSafe(req.file.path)
    if (!buffer) return res.status(400).json({ error: 'Cannot read file' })
    
    const foundFormats = detectEmbeddedFormats(buffer)
    const isPolyglot = Object.keys(foundFormats).length > 1
    
    let embeddedTexts = [] 
    
    if (buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
        embeddedTexts = extractPngText(buffer)
    } 
    else if (buffer.readUInt16BE(0) === 0xFFD8) {
        embeddedTexts = extractJpgText(buffer)
    }

    const MAX_TEXT_LENGTH = 1024; 
    embeddedTexts = embeddedTexts
        .filter(text => text.length < MAX_TEXT_LENGTH)
        .map(text => text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim())
        .filter(text => text.length > 0)

    res.json({ isPolyglot, foundFormats, embeddedTexts }) 
    
  } catch(error) {
    console.error('Check Polyglot Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  } finally {
    await fs.unlink(req.file.path).catch(()=>{})
  }
})

router.post('/extract-polyglot', checkSingleFile, async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const tempDir = os.tmpdir();
    const outputZipPath = path.join(tempDir, `polyglot_contents_${Date.now()}.zip`);
    const fileBaseName = req.file.originalname.split('.')[0] || 'extracted_file';

    try {
        const polyglotBuffer = await readFileSafe(req.file.path);
        if (!polyglotBuffer) return res.status(400).send('Cannot read file.');

        const components = await extractComponents(polyglotBuffer);
        
        const output = baseFs.createWriteStream(outputZipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            console.log(`Archive created: ${archive.pointer()} total bytes`);
            res.download(outputZipPath, `${fileBaseName}_extracted.zip`, (err) => {
                if (err) console.error('Error sending file:', err);
                fs.unlink(outputZipPath).catch(() => {});
            });
        });

        archive.on('error', (err) => {
            console.error('Archiver error:', err);
            res.status(500).send('Error creating archive.');
        });

        archive.pipe(output);

        if (components.image && components.imageType) {
            archive.append(components.image, { name: `${fileBaseName}_image.${components.imageType}` });
        } else {
            archive.append(polyglotBuffer, { name: `${fileBaseName}_original_unknown_format.bin` });
        }

        if (components.zip) {
            archive.append(components.zip, { name: `${fileBaseName}_appended_data.zip` });
        }

        if (components.text) {
            archive.append(components.text, { name: `${fileBaseName}_embedded_text.txt` });
        }

        await archive.finalize();

    } catch (error) {
        console.error('Extraction error:', error);
        res.status(500).send('Error extracting polyglot components.');
    } finally {
        fs.unlink(req.file.path).catch(() => {});
    }
});

module.exports = router