import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repositoryRoot = process.cwd()
const pluginsRoot = path.join(repositoryRoot, 'plugins')
const sourceExtensions = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx'])
const ignoredDirectories = new Set(['dist', 'node_modules', '.git'])
const importPattern = /(?:\b(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?|\brequire\s*\(|\bimport\s*\()\s*['"]([^'"]+)['"]/g

function collectSources(root) {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...collectSources(absolute))
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(absolute)
  }
  return files
}

const failures = []
for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pluginRoot = path.join(pluginsRoot, entry.name)
  const packagePath = path.join(pluginRoot, 'package.json')
  if (!fs.existsSync(packagePath)) continue
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
      if ((name.startsWith('@agentkeeper/') && name !== '@agentkeeper/sdk') ||
          (typeof version === 'string' && version.startsWith('workspace:') && name !== '@agentkeeper/sdk')) {
        failures.push(`${path.relative(repositoryRoot, packagePath)}: forbidden workspace dependency ${name}`)
      }
    }
  }

  for (const file of collectSources(pluginRoot)) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]
      if (specifier.startsWith('@agentkeeper/') && specifier !== '@agentkeeper/sdk') {
        failures.push(`${path.relative(repositoryRoot, file)}: forbidden AgentKeeper import ${specifier}`)
      }
      if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
        const resolved = path.resolve(path.dirname(file), specifier)
        if (resolved !== pluginRoot && !resolved.startsWith(`${pluginRoot}${path.sep}`)) {
          failures.push(`${path.relative(repositoryRoot, file)}: import escapes plugin root: ${specifier}`)
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log('verified plugin source and dependency boundaries')
}

