import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { requirePluginFile, resolvePluginPath, validatePluginArchiveEntries } from './plugin-paths'

const temporaryRoots: string[] = []
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('plugin paths', () => {
  it('keeps package paths inside their root', () => {
    expect(resolvePluginPath('/plugins/example', 'dist/index.js', 'Entry'))
      .toBe(path.resolve('/plugins/example/dist/index.js'))
    expect(() => resolvePluginPath('/plugins/example', '../outside.js', 'Entry')).toThrow(
      'must stay inside',
    )
    expect(() => resolvePluginPath('/plugins/example', '/tmp/outside.js', 'Entry')).toThrow(
      'must be a relative path',
    )
  })

  it('rejects symlinks that escape the package root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkeeper-plugin-path-'))
    temporaryRoots.push(root)
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.js`)
    fs.writeFileSync(outside, 'outside')
    fs.symlinkSync(outside, path.join(root, 'entry.js'))
    try {
      expect(() => requirePluginFile(root, 'entry.js', 'Entry')).toThrow('resolves outside')
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('rejects traversal and platform-confused archive entries', () => {
    expect(() => validatePluginArchiveEntries(['manifest.json', '../outside'])).toThrow('unsafe path')
    expect(() => validatePluginArchiveEntries(['manifest.json', '..\\outside'])).toThrow('unsafe path')
    expect(() => validatePluginArchiveEntries(['/absolute'])).toThrow('unsafe path')
  })

  it('rejects archive paths that collide on common target filesystems', () => {
    expect(() => validatePluginArchiveEntries(['manifest.json', 'MANIFEST.JSON']))
      .toThrow('duplicate paths')

    // NFC and NFD spellings are different ZIP entry names but the same filename
    // on Unicode-normalizing filesystems such as the default macOS filesystem.
    expect(() => validatePluginArchiveEntries(['caf\u00e9.js', 'cafe\u0301.js']))
      .toThrow('duplicate paths')

    expect(() => validatePluginArchiveEntries(['dist/', 'dist']))
      .toThrow('duplicate paths')
  })
})
