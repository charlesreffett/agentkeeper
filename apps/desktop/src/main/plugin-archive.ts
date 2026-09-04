import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { resolvePluginPath, validatePluginArchiveEntries } from './plugin-paths.js'

export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 10_000
export const MAX_COMPRESSION_RATIO = 100

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => error || !zip ? reject(error ?? new Error('Invalid ZIP')) : resolve(zip)))
}

function isRegular(entry: Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff
  const type = mode & 0o170000
  return type === 0 || type === 0o100000 || entry.fileName.endsWith('/')
}

export async function inspectPluginArchive(file: string): Promise<Entry[]> {
  const stat = await fsp.stat(file)
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) throw new Error('Plugin package exceeds the 200 MiB compressed limit')
  const zip = await openZip(file)
  return new Promise((resolve, reject) => {
    const entries: Entry[] = []
    let expanded = 0
    let compressed = 0
    const fail = (error: unknown) => { zip.close(); reject(error) }
    zip.on('error', fail)
    zip.on('entry', entry => {
      try {
        if (entries.length + 1 > MAX_ARCHIVE_ENTRIES) throw new Error('Plugin archive contains too many entries')
        if ((entry.generalPurposeBitFlag & 1) !== 0 || !isRegular(entry)) throw new Error(`Unsupported archive entry: ${entry.fileName}`)
        if (entry.uncompressedSize > MAX_ARCHIVE_BYTES || expanded > MAX_ARCHIVE_BYTES - entry.uncompressedSize) throw new Error('Plugin archive expands beyond the 200 MiB limit')
        if (entry.uncompressedSize > 0 && (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)) throw new Error(`Suspicious compression ratio: ${entry.fileName}`)
        expanded += entry.uncompressedSize
        compressed += entry.compressedSize
        entries.push(entry)
        zip.readEntry()
      } catch (error) { fail(error) }
    })
    zip.on('end', () => {
      try {
        validatePluginArchiveEntries(entries.map(entry => entry.fileName))
        if (!entries.some(entry => entry.fileName === 'manifest.json' && !entry.fileName.endsWith('/'))) throw new Error('manifest.json not found in .akp package')
        if (expanded > 0 && (compressed === 0 || expanded / compressed > MAX_COMPRESSION_RATIO)) throw new Error('Plugin archive has a suspicious overall compression ratio')
        resolve(entries)
      } catch (error) { reject(error) }
    })
    zip.readEntry()
  })
}

export async function extractPluginArchive(file: string, destination: string): Promise<void> {
  await inspectPluginArchive(file)
  const zip = await openZip(file)
  let total = 0
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => { zip.close(); reject(error) }
    zip.on('error', fail)
    zip.on('entry', entry => {
      const relative = entry.fileName.replace(/\/$/, '')
      if (!relative) { zip.readEntry(); return }
      let target: string
      try { target = resolvePluginPath(destination, relative, 'Archive entry') } catch (error) { fail(error); return }
      if (entry.fileName.endsWith('/')) {
        void fsp.mkdir(target, { recursive: true, mode: 0o700 }).then(() => zip.readEntry(), fail)
        return
      }
      zip.openReadStream(entry, async (error, stream) => {
        if (error || !stream) { fail(error ?? new Error('Could not read ZIP entry')); return }
        try {
          await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
          const handle = await fsp.open(target, 'wx', 0o600)
          let actual = 0
          try {
            for await (const chunk of stream) {
              const bytes = chunk as Buffer
              actual += bytes.length
              total += bytes.length
              if (actual > entry.uncompressedSize || total > MAX_ARCHIVE_BYTES) throw new Error(`Oversized archive data: ${entry.fileName}`)
              await handle.write(bytes)
            }
            if (actual !== entry.uncompressedSize) throw new Error(`Archive size mismatch: ${entry.fileName}`)
            await handle.sync()
          } finally { await handle.close() }
          zip.readEntry()
        } catch (caught) { fail(caught) }
      })
    })
    zip.on('end', resolve)
    zip.readEntry()
  }).catch(async error => {
    await fsp.rm(destination, { recursive: true, force: true }).catch(() => {})
    throw error
  })
}

export async function readPluginArchiveFile(file: string, wanted: string, limit: number): Promise<Buffer> {
  const entries = await inspectPluginArchive(file)
  const metadata = entries.find(entry => entry.fileName === wanted)
  if (!metadata || metadata.fileName.endsWith('/') || metadata.uncompressedSize > limit) throw new Error(`Invalid or missing ${wanted}`)
  const zip = await openZip(file)
  return new Promise((resolve, reject) => {
    zip.on('error', reject)
    zip.on('entry', entry => {
      if (entry.fileName !== wanted) { zip.readEntry(); return }
      zip.openReadStream(entry, async (error, stream) => {
        if (error || !stream) { reject(error ?? new Error(`Could not read ${wanted}`)); return }
        const chunks: Buffer[] = []
        let total = 0
        try {
          for await (const chunk of stream) {
            total += (chunk as Buffer).length
            if (total > limit) throw new Error(`${wanted} exceeds its size limit`)
            chunks.push(chunk as Buffer)
          }
          zip.close()
          resolve(Buffer.concat(chunks, total))
        } catch (caught) { zip.close(); reject(caught) }
      })
    })
    zip.readEntry()
  })
}
