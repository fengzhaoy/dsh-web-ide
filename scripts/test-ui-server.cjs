const http = require('http')
const fs = require('fs')
const path = require('path')
const PORT = 8898
const ROOT = '/Users/fengzy/Documents/gitmy/dsh-web-ide/scripts/test-ui'
const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url)
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('not found'); return }
  const ext = path.extname(filePath)
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' }
  res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
})
server.listen(PORT, () => console.log('test-ui server on http://localhost:' + PORT))
