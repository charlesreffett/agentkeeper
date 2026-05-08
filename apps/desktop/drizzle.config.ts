import { defineConfig } from 'drizzle-kit'
import { resolve } from 'node:path'

export default defineConfig({
  dialect: 'sqlite',
  schema: resolve(__dirname, 'src/main/db/schema.ts'),
  out: resolve(__dirname, 'src/main/db/migrations'),
})
