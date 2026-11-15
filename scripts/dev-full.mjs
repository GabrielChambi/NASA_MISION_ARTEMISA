import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
try { process.loadEnvFile(path.join(root,'.env')) } catch(error) { if(error.code!=='ENOENT') throw error }
const python = path.join(root, 'api', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
if (!existsSync(python)) {
  console.error('Set up the API first: python -m venv api/.venv, then api/.venv/Scripts/python.exe -m pip install -r api/requirements.txt (Windows). See README for Linux/macOS.')
  process.exit(1)
}
const api = spawn(python, ['-m', 'uvicorn', 'api.app.main:app', '--host', '127.0.0.1', '--port', '8000'], { cwd: root, stdio: 'inherit' })
const web = spawn(process.execPath, [path.join(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { cwd: path.join(root, 'frontend'), stdio: 'inherit' })
let closing = false
function stop(code = 0) { if (closing) return; closing = true; api.kill(); web.kill(); process.exitCode = code }
for (const child of [api, web]) {
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', code => stop(code ?? 0))
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
