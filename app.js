const express = require('express')
const os = require('os')
const { exec } = require('child_process')
const polyglotRoutes = require('./routes/polyglotRoutes')

const app = express()

app.use(express.urlencoded({ extended: true }))
app.use(express.static('public'))
app.use('/', polyglotRoutes)

const PORT = process.env.PORT || 3000
const HOST = '0.0.0.0' 

app.listen(PORT, HOST, () => {
  const localIP =
    Object.values(os.networkInterfaces())
      .flat()
      .find(iface => iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('192.168'))
      ?.address || 'localhost'

  console.log(`Server running:`)
  console.log(`→ Local:     http://localhost:${PORT}`)
  console.log(`→ LAN:       http://${localIP}:${PORT}`)
  console.log(`→ External:  use your server's public IP or domain in production`)

  if (process.env.NODE_ENV !== 'production') {
    const url = `http://localhost:${PORT}`
    const platform = os.platform()
    if (platform === 'win32') exec(`start ${url}`)
    else if (platform === 'darwin') exec(`open ${url}`)
    else exec(`xdg-open ${url}`)
  }
})