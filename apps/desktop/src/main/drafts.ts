import { eq, lt } from 'drizzle-orm'
import { getDb } from './db/index'
import { drafts } from './db/schema'
import type { Attachment } from '../shared/ipc-contract'

export function getDraft(sessionLocalId: string): { text: string; attachments: Attachment[] } {
  const row = getDb().select().from(drafts).where(eq(drafts.sessionLocalId, sessionLocalId)).get()
  if (!row) return { text: '', attachments: [] }
  try {
    return { text: row.text, attachments: JSON.parse(row.attachments) as Attachment[] }
  } catch {
    return { text: row.text, attachments: [] }
  }
}

export function setDraft(sessionLocalId: string, text: string, attachments: Attachment[]): void {
  const db = getDb()
  if (!text && attachments.length === 0) {
    db.delete(drafts).where(eq(drafts.sessionLocalId, sessionLocalId)).run()
    return
  }
  db.insert(drafts).values({
    sessionLocalId,
    text,
    attachments: JSON.stringify(attachments),
    updatedAt: Date.now(),
  }).onConflictDoUpdate({
    target: drafts.sessionLocalId,
    set: { text, attachments: JSON.stringify(attachments), updatedAt: Date.now() },
  }).run()
}

export function clearDraft(sessionLocalId: string): void {
  getDb().delete(drafts).where(eq(drafts.sessionLocalId, sessionLocalId)).run()
}

/** Remove drafts older than 7 days — they belong to sessions that no longer exist. */
export function pruneOrphanedDrafts(): void {
  const cutoff = Date.now() - 7 * 86_400_000
  getDb().delete(drafts).where(lt(drafts.updatedAt, cutoff)).run()
}
