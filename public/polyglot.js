let createResultDiv = document.getElementById('createResult'); 
if (!createResultDiv) {
    createResultDiv = document.createElement('div');
    createResultDiv.id = 'createResult';
    document.getElementById('createPolyglotForm').insertAdjacentElement('afterend', createResultDiv);
}

document.getElementById('checkPolyglotForm').addEventListener('submit', async (event) => {
  event.preventDefault()
  const resultDiv = document.getElementById('checkResult')
  resultDiv.innerHTML = 'Checking...'
  const formData = new FormData(event.target)
  const fileInput = document.getElementById('checkfile');
  const uploadedFile = fileInput.files[0];
  
  let previewArea = document.getElementById('imagePreviewArea');
  if (!previewArea) { 
    previewArea = document.createElement('div');
    previewArea.id = 'imagePreviewArea';
    resultDiv.insertAdjacentElement('beforebegin', previewArea);
  }
  previewArea.innerHTML = ''; 
  
  if (uploadedFile && uploadedFile.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = function(e) {
      previewArea.innerHTML = `
        <div style="text-align: center; margin-bottom: 10px;">
          <strong>Image Preview (as detected):</strong>
          <img src="${e.target.result}" style="max-width: 100%; height: auto; border: 1px solid #ccc; margin-top: 5px;" alt="Polyglot Preview">
        </div>
      `;
    };
    reader.readAsDataURL(uploadedFile);
  }


  try {
    const response = await fetch('/check-polyglot', { method: 'POST', body: formData })
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server Check Failed: ${errorText}`);
    }
    const data = await response.json() 
    
    let outputHtml = ''
    
    if (data.isPolyglot) {
      const formats = Object.entries(data.foundFormats)
        .map(([fmt, positions]) => `<li>${fmt}: ${positions.join(', ')}</li>`)
        .join('')
      
      let interpretation = `
        <div style="margin-bottom: 15px; padding: 10px; border: 1px solid #0078d4; border-radius: 6px; background: #e9f0fb;">
          <strong>🔥 Polyglot Detected!</strong> This file is valid under multiple formats simultaneously.
          <p style="margin-top: 5px; font-size: 0.9em;">
            The file starts with a primary image signature. Signatures for other formats (like ZIP) indicate embedded content.
          </p>
          <button id="downloadComponentsBtn" type="button" style="width: 100%; margin-top: 10px; background: #00a0e3;">
              Download Separate Components (.zip)
          </button>
        </div>
      `;
      
      outputHtml += interpretation;
      outputHtml += `<strong>Technical Signatures Found:</strong><ul style="margin-top: 5px;">${formats}</ul>`;

    } else {
      const detected = Object.keys(data.foundFormats).join(', ') || 'None'
      outputHtml += `<strong>Not polyglot.</strong> Formats: ${detected}`
    }

    if (data.embeddedTexts && data.embeddedTexts.length > 0) {
        const textBlocks = data.embeddedTexts.map((text, index) => {
            let display_text = text;
            if (text.length > 50) {
                display_text = text.substring(0, 50) + '... (full text in downloaded components)';
            }
            
            return `
                <p style="white-space: pre-wrap; margin-top: 5px; padding: 5px; border: 1px dashed #0078d4; background: #fff;">
                    ${display_text}
                </p>
            `;
        }).join('');

        outputHtml += `
            <hr style="margin: 10px 0;">
            <strong>Embedded Text(s) Found (${data.embeddedTexts.length}):</strong>
            ${textBlocks}
        `;
    }

    resultDiv.innerHTML = outputHtml
    
    if (data.isPolyglot) {
        setTimeout(() => { 
            const downloadBtn = document.getElementById('downloadComponentsBtn');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', () => {
                    resultDiv.innerHTML = `<p style="color: #0078d4;">Preparing components for download...</p>`;
                    fetch('/extract-polyglot', { method: 'POST', body: formData })
                        .then(response => {
                            if (!response.ok) throw new Error('Extraction failed');
                            return response.blob();
                        })
                        .then(blob => {
                            const downloadUrl = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = downloadUrl;
                            a.download = 'polyglot_extracted_components.zip';
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            window.URL.revokeObjectURL(downloadUrl);
                            resultDiv.innerHTML = `<p style="color: green;">✅ Components downloaded successfully!</p>`;
                        })
                        .catch(error => {
                            resultDiv.innerHTML = `<p style="color: red;">❌ Error during component download. See console.</p>`;
                            console.error(error);
                        });
                });
            }
        }, 0);
    }

  } catch (error) {
    resultDiv.innerHTML = `<p style="color: red;">❌ Error checking polyglot file. Details: ${error.message}</p>`;
    console.error('Check Polyglot Error:', error);
  }
})

document.getElementById('createPolyglotForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  createResultDiv.innerHTML = `<p style="color: #0078d4;">Creating polyglot file...</p>`;
  
  const imageType = e.target.imagetype.value
  if (!imageType) {
    createResultDiv.innerHTML = `<p style="color: red;">❌ Please select image type.</p>`;
    return
  }
  
  const formData = new FormData(e.target) 
  
  const url = imageType === 'png' ? '/create-png-polyglot' : '/create-jpg-polyglot'
  
  try {
    const response = await fetch(url, { method: 'POST', body: formData })
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to create polyglot');
    }
    
    const blob = await response.blob()
    const downloadUrl = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = imageType === 'png' ? 'polyglot.png' : 'polyglot.jpg'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(downloadUrl)
    
    createResultDiv.innerHTML = `<p style="color: green;">✅ Polyglot file created and downloaded successfully! Now try checking it.</p>`;
    
  } catch (error) {
    createResultDiv.innerHTML = `<p style="color: red;">❌ Error creating polyglot: ${error.message}</p>`;
    console.error('Create Polyglot Error:', error);
  }
})