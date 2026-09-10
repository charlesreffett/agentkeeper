import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const root = process.cwd()
const docsRoot = path.join(root, 'docs', 'plugin-author')
const markdownFiles = []

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(target)
    else if (entry.name.endsWith('.md')) markdownFiles.push(target)
  }
}

walk(docsRoot)
const failures = []
const samples = []

for (const file of markdownFiles) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#', 1)[0]
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target))
    if (!fs.existsSync(resolved)) failures.push(`${path.relative(root, file)}: broken link ${match[1]}`)
  }
  for (const match of source.matchAll(/```json manifest\n([\s\S]*?)\n```/g)) {
    try { JSON.parse(match[1]) } catch (error) {
      failures.push(`${path.relative(root, file)}: invalid manifest JSON: ${error.message}`)
    }
  }
  for (const match of source.matchAll(/```ts compile\n([\s\S]*?)\n```/g)) {
    samples.push({ file, source: match[1] })
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkeeper-plugin-docs-'))
try {
  const sampleFiles = samples.map((sample, index) => {
    const target = path.join(temp, `sample-${index}.ts`)
    fs.writeFileSync(target, sample.source)
    return target
  })
  if (sampleFiles.length) {
    const program = ts.createProgram(sampleFiles, {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      baseUrl: root,
      paths: { '@agentkeeper/sdk': ['packages/sdk/src/index.ts'] },
      skipLibCheck: true,
    })
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      const index = diagnostic.file ? sampleFiles.indexOf(diagnostic.file.fileName) : -1
      const owner = index >= 0 ? path.relative(root, samples[index].file) : 'plugin docs'
      failures.push(`${owner}: TypeScript sample: ${message}`)
    }
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`Verified ${markdownFiles.length} plugin-author documents and ${samples.length} TypeScript samples.`)
