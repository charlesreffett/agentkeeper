import type Database from 'better-sqlite3'

export interface ColumnInfo {
  readonly name: string
  readonly type: string
  readonly notNull: boolean
  readonly defaultValue: unknown
  readonly primaryKeyPosition: number
}

export interface AddedColumn {
  notNull(): this
  default(value: string | number | boolean | null): this
}

export interface TableAlteration {
  text(name: string): AddedColumn
  integer(name: string): AddedColumn
  real(name: string): AddedColumn
  blob(name: string): AddedColumn
  renameColumn(from: string, to: string): void
  dropColumn(name: string): void
}

export interface Schema {
  hasTable(table: string): boolean
  hasColumn(table: string, column: string): boolean
  hasIndex(index: string): boolean
  columns(table: string): readonly ColumnInfo[]
  alterTable(table: string, definition: (table: TableAlteration) => void): void
  createIndex(index: string, table: string, columns: readonly string[], options?: { unique?: boolean }): void
  dropTableIfExists(table: string): void
  exec(sql: string): void
  prepare(sql: string): Database.Statement
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

class SqliteAddedColumn implements AddedColumn {
  private required = false
  private defaultValue: string | number | boolean | null | undefined

  constructor(
    private readonly statements: string[],
    private readonly table: string,
    private readonly name: string,
    private readonly type: string,
  ) {
    this.refresh()
  }

  notNull(): this {
    this.required = true
    this.refresh()
    return this
  }

  default(value: string | number | boolean | null): this {
    this.defaultValue = value
    this.refresh()
    return this
  }

  private refresh(): void {
    const literal = this.defaultValue === undefined
      ? ''
      : ` DEFAULT ${typeof this.defaultValue === 'string'
        ? `'${this.defaultValue.replaceAll("'", "''")}'`
        : this.defaultValue === null
          ? 'NULL'
          : typeof this.defaultValue === 'boolean'
            ? this.defaultValue ? '1' : '0'
            : String(this.defaultValue)}`
    const sql = `ALTER TABLE ${identifier(this.table)} ADD COLUMN ${identifier(this.name)} ${this.type}${this.required ? ' NOT NULL' : ''}${literal}`
    this.statements[this.statements.length - 1] = sql
  }
}

class SqliteTableAlteration implements TableAlteration {
  constructor(
    private readonly table: string,
    private readonly statements: string[],
  ) {}

  text(name: string): AddedColumn { return this.add(name, 'TEXT') }
  integer(name: string): AddedColumn { return this.add(name, 'INTEGER') }
  real(name: string): AddedColumn { return this.add(name, 'REAL') }
  blob(name: string): AddedColumn { return this.add(name, 'BLOB') }

  renameColumn(from: string, to: string): void {
    this.statements.push(`ALTER TABLE ${identifier(this.table)} RENAME COLUMN ${identifier(from)} TO ${identifier(to)}`)
  }

  dropColumn(name: string): void {
    this.statements.push(`ALTER TABLE ${identifier(this.table)} DROP COLUMN ${identifier(name)}`)
  }

  private add(name: string, type: string): AddedColumn {
    this.statements.push('')
    return new SqliteAddedColumn(this.statements, this.table, name, type)
  }
}

export class SqliteSchema implements Schema {
  constructor(private readonly db: Database.Database) {}

  hasTable(table: string): boolean {
    return this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined
  }

  hasColumn(table: string, column: string): boolean {
    return this.columns(table).some((candidate) => candidate.name === column)
  }

  hasIndex(index: string): boolean {
    return this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index) !== undefined
  }

  columns(table: string): readonly ColumnInfo[] {
    const rows = this.db.prepare(`PRAGMA table_info(${identifier(table)})`).all() as Array<{
      name: string
      type: string
      notnull: number
      dflt_value: unknown
      pk: number
    }>
    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      notNull: row.notnull === 1,
      defaultValue: row.dflt_value,
      primaryKeyPosition: row.pk,
    }))
  }

  alterTable(table: string, definition: (table: TableAlteration) => void): void {
    if (!this.hasTable(table)) throw new Error(`Cannot alter missing table '${table}'`)
    const statements: string[] = []
    definition(new SqliteTableAlteration(table, statements))
    for (const statement of statements) this.db.exec(statement)
  }

  createIndex(index: string, table: string, columns: readonly string[], options?: { unique?: boolean }): void {
    const unique = options?.unique ? 'UNIQUE ' : ''
    this.db.exec(`CREATE ${unique}INDEX ${identifier(index)} ON ${identifier(table)} (${columns.map(identifier).join(', ')})`)
  }

  dropTableIfExists(table: string): void {
    this.db.exec(`DROP TABLE IF EXISTS ${identifier(table)}`)
  }

  exec(sql: string): void { this.db.exec(sql) }
  prepare(sql: string): Database.Statement { return this.db.prepare(sql) }
}
