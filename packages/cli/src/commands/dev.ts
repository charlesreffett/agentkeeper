import { Command } from 'commander'
import * as net from 'node:net'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

function getSocketPath(): string {
  const platform = process.platform
  if (platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'desktop', 'agentkeeper-cli.sock')
  }
  // macOS
  return path.join(os.homedir(), 'Library', 'Application Support', 'desktop', 'agentkeeper-cli.sock')
}

function sendCommand(sockPath: string, cmd: object): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sockPath)
    socket.on('error', reject)
    socket.on('connect', () => {
      socket.write(JSON.stringify(cmd) + '\n')
    })
    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      try {
        resolve(JSON.parse(buf.slice(0, nl)))
      } catch {
        reject(new Error('invalid response'))
      }
      socket.destroy()
    })
  })
}

export const devCommand = new Command('dev')
  .description('Load a plugin into a running AgentKeeper instance for development')
  .option('-d, --dir <path>', 'Plugin directory (default: cwd)', process.cwd())
  .option('--unload <pluginId>', 'Unload a dev plugin by id')
  .action(async (options: { dir: string; unload?: string }) => {
    const sockPath = getSocketPath()
    if (!fs.existsSync(sockPath)) {
      console.error('AgentKeeper does not appear to be running (socket not found at', sockPath + ')')
      process.exit(1)
    }

    let cmd: object
    if (options.unload) {
      cmd = { cmd: 'unloadDev', pluginId: options.unload }
    } else {
      const dir = path.resolve(options.dir)
      cmd = { cmd: 'loadDev', dirPath: dir }
    }

    try {
      const res = await sendCommand(sockPath, cmd)
      if (res.ok) {
        if (options.unload) {
          console.log(`Plugin ${options.unload} unloaded.`)
        } else {
          console.log(`Plugin loaded from ${(cmd as { dirPath: string }).dirPath}. AgentKeeper will watch for changes.`)
        }
      } else {
        console.error('Error:', res.error)
        process.exit(1)
      }
    } catch (err) {
      console.error('Failed to connect to AgentKeeper:', err)
      process.exit(1)
    }
  })
