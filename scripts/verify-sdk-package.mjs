import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sdkRoot = join(repositoryRoot, 'packages/sdk')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'agentkeeper-sdk-package-'))
const packageDirectory = join(temporaryRoot, 'node_modules/@agentkeeper/sdk')

const packedName = execFileSync('pnpm', ['pack', '--pack-destination', temporaryRoot], {
  cwd: sdkRoot,
  encoding: 'utf8',
}).trim().split('\n').at(-1)
if (!packedName) throw new Error('pnpm pack did not report an archive')

await mkdir(packageDirectory, { recursive: true })
const archivePath = isAbsolute(packedName) ? packedName : join(temporaryRoot, packedName)
execFileSync('tar', ['-xzf', archivePath, '-C', packageDirectory, '--strip-components=1'])

const packed = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
for (const target of [
  packed.main,
  packed.types,
  packed.exports?.['.']?.import,
  packed.exports?.['.']?.types,
  packed.exports?.['./testing']?.import,
  packed.exports?.['./testing']?.types,
]) {
  if (typeof target !== 'string' || target.includes('/src/')) {
    throw new Error(`invalid packed SDK entry: ${String(target)}`)
  }
  await readFile(join(packageDirectory, target))
}

for (const dependency of ['semver', 'zod']) {
  const source = await realpath(join(sdkRoot, 'node_modules', dependency))
  await symlink(source, join(temporaryRoot, 'node_modules', dependency), 'dir')
}

await writeFile(join(temporaryRoot, 'consumer.mjs'), `
import { PluginManifestSchema, definePlugin } from '@agentkeeper/sdk'
import { createMockContext } from '@agentkeeper/sdk/testing'

const manifest = PluginManifestSchema.parse({
  schema_version: 1,
  id: 'packed-consumer',
  name: 'Packed consumer',
  version: '1.0.0',
  entry: 'dist/index.js',
})
if (manifest.id !== 'packed-consumer') throw new Error('root export failed')
if (definePlugin({ activate() {} }).activate === undefined) throw new Error('helper export failed')
if (!createMockContext()._inspect) throw new Error('testing export failed')
`)
execFileSync(process.execPath, [join(temporaryRoot, 'consumer.mjs')], { stdio: 'inherit' })

await writeFile(join(temporaryRoot, 'consumer.ts'), `
import { definePlugin, type PluginManifest } from '@agentkeeper/sdk'
import { createMockContext, type MockContext } from '@agentkeeper/sdk/testing'

const plugin = definePlugin({ activate(context) { context.logger.info('ready') } })
const manifest: PluginManifest = {
  schema_version: 1,
  id: 'typed-consumer',
  name: 'Typed consumer',
  version: '1.0.0',
  entry: 'dist/index.js',
  activation_events: ['onStartup'],
  permissions: [],
}
const context: MockContext = createMockContext()
void [plugin, manifest, context]
`)
execFileSync(join(repositoryRoot, 'node_modules/.bin/tsc'), [
  '--noEmit',
  '--strict',
  '--skipLibCheck',
  '--target', 'ES2022',
  '--module', 'NodeNext',
  '--moduleResolution', 'NodeNext',
  join(temporaryRoot, 'consumer.ts'),
], { cwd: temporaryRoot, stdio: 'inherit' })

console.log('verified @agentkeeper/sdk: packed root and testing exports provide runnable JavaScript and declarations')
