import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { RemoteSource } from '../shared/ipc-contract'

const execFileAsync = promisify(execFile)

export async function detectRemoteSources(projectPath: string): Promise<RemoteSource[]> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'remote', '-v'])
    const seen = new Set<string>()
    const results: RemoteSource[] = []

    for (const line of stdout.split('\n')) {
      // Only process fetch lines to avoid duplicates from push entries
      const match = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line)
      if (!match) continue
      const remote = match[1] as string
      const url = match[2] as string

      type HostType = RemoteSource['type']
      let type: HostType | null = null
      let slug: string | null = null

      if (url.includes('github.com')) {
        type = 'github'
        const m =
          /git@github\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url) ??
          /https:\/\/github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url)
        slug = m?.[1] ?? null
      } else if (url.includes('gitlab.com')) {
        type = 'gitlab'
        const m =
          /git@gitlab\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url) ??
          /https:\/\/gitlab\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url)
        slug = m?.[1] ?? null
      } else if (url.includes('bitbucket.org')) {
        type = 'bitbucket'
        const m =
          /git@bitbucket\.org:([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url) ??
          /https:\/\/bitbucket\.org\/([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url)
        slug = m?.[1] ?? null
      }

      if (!type || !slug) continue

      const key = `${type}:${slug}`
      if (seen.has(key)) continue
      seen.add(key)

      results.push({ type, repo: slug, remote, url })
    }

    return results
  } catch {
    return []
  }
}
