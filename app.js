const express = require('express')
const os = require('os')
const { exec } = require('child_process')
const polyglotRoutes = require('./routes/polyglotRoutes') 

const app = express()

// Middleware to parse URL-encoded bodies (for form data)
app.use(express.urlencoded({ extended: true }))

// Serve static files from the 'public' directory
app.use(express.static('public')) 

// Mount the router containing all polyglot routes
app.use('/', polyglotRoutes)

const PORT = 3000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  const url = `http://localhost:${PORT}`
  const platform = os.platform()
  if (platform === 'win32') exec(`start ${url}`)
  else if (platform === 'darwin') exec(`open ${url}`)
  else exec(`xdg-open ${url}`)
})