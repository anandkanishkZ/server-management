import { Pool } from "pg";

const DB_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

export interface TableRef {
  schema: string;
  table: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
}

const pools = new Map<string, Pool>();

function assertValidDbName(name: string) {
  if (!name || !DB_NAME_RE.test(name)) throw new Error(`invalid database name "${name}"`);
}

function getPool(dbName: string): Pool {
  assertValidDbName(dbName);
  let pool = pools.get(dbName);
  if (!pool) {
    pool = new Pool({
      host: process.env.DBA_HOST ?? "127.0.0.1",
      port: Number(process.env.DBA_PORT ?? 5432),
      user: process.env.DBA_USER ?? "panel_dba",
      password: process.env.DBA_PASSWORD,
      database: dbName,
      max: 3,
      idleTimeoutMillis: 30_000,
    });
    // node-pg emits "error" on the pool for any idle client that errors out
    // (dropped connection, terminated backend, network blip). With no
    // listener, Node's default EventEmitter behavior is to throw - which
    // crashes the entire API process, not just this one query.
    pool.on("error", (err) => {
      console.error(`pg pool error (${dbName}):`, err.message);
    });
    pools.set(dbName, pool);
  }
  return pool;
}

/** Closes and forgets a pool - call before dropping its database so nothing
 * of ours is left holding a connection open (or getting killed out from
 * under it). */
export async function closePool(dbName: string) {
  const pool = pools.get(dbName);
  if (!pool) return;
  pools.delete(dbName);
  await pool.end().catch(() => {});
}

/** Postgres identifier escaping - doubles any embedded quote characters. */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function listTables(dbName: string): Promise<TableRef[]> {
  const { rows } = await getPool(dbName).query(
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name`
  );
  return rows.map((r) => ({ schema: r.table_schema, table: r.table_name }));
}

async function assertTableExists(dbName: string, ref: TableRef) {
  const tables = await listTables(dbName);
  if (!tables.some((t) => t.schema === ref.schema && t.table === ref.table)) {
    throw new Error(`table "${ref.schema}.${ref.table}" not found`);
  }
}

export async function getColumns(dbName: string, ref: TableRef): Promise<ColumnInfo[]> {
  await assertTableExists(dbName, ref);
  const pool = getPool(dbName);

  const [columnsResult, pkResult] = await Promise.all([
    pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [ref.schema, ref.table]
    ),
    pool.query(
      `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary`,
      [ref.schema, ref.table]
    ),
  ]);

  const pkColumns = new Set(pkResult.rows.map((r) => r.column_name));

  return columnsResult.rows.map((r) => ({
    name: r.column_name,
    dataType: r.data_type,
    isNullable: r.is_nullable === "YES",
    columnDefault: r.column_default,
    isPrimaryKey: pkColumns.has(r.column_name),
  }));
}

export interface RowsResult {
  rows: Record<string, unknown>[];
  total: number;
}

export async function getRows(
  dbName: string,
  ref: TableRef,
  opts: { limit: number; offset: number; sortColumn?: string; sortDir?: "asc" | "desc" }
): Promise<RowsResult> {
  const columns = await getColumns(dbName, ref);
  const columnNames = new Set(columns.map((c) => c.name));

  let orderClause = "";
  if (opts.sortColumn) {
    if (!columnNames.has(opts.sortColumn)) throw new Error(`unknown column "${opts.sortColumn}"`);
    const dir = opts.sortDir === "desc" ? "DESC" : "ASC";
    orderClause = `ORDER BY ${ident(opts.sortColumn)} ${dir}`;
  }

  const pool = getPool(dbName);
  const tableSql = `${ident(ref.schema)}.${ident(ref.table)}`;

  const [rowsResult, countResult] = await Promise.all([
    pool.query(`SELECT * FROM ${tableSql} ${orderClause} LIMIT $1 OFFSET $2`, [opts.limit, opts.offset]),
    pool.query(`SELECT COUNT(*)::int AS count FROM ${tableSql}`),
  ]);

  return { rows: rowsResult.rows, total: countResult.rows[0].count };
}

function assertKnownColumns(columns: ColumnInfo[], keys: string[]) {
  const names = new Set(columns.map((c) => c.name));
  for (const key of keys) {
    if (!names.has(key)) throw new Error(`unknown column "${key}"`);
  }
}

function requirePrimaryKey(columns: ColumnInfo[]): string[] {
  const pk = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  if (pk.length === 0) throw new Error("table has no primary key - row edit/delete isn't supported");
  return pk;
}

export async function updateRow(
  dbName: string,
  ref: TableRef,
  pkValues: Record<string, unknown>,
  changes: Record<string, unknown>
) {
  const columns = await getColumns(dbName, ref);
  const pk = requirePrimaryKey(columns);
  assertKnownColumns(columns, Object.keys(pkValues));
  assertKnownColumns(columns, Object.keys(changes));

  const setEntries = Object.entries(changes);
  if (setEntries.length === 0) throw new Error("no changes provided");

  const setClause = setEntries.map(([col], i) => `${ident(col)} = $${i + 1}`).join(", ");
  const whereClause = pk.map((col, i) => `${ident(col)} = $${setEntries.length + i + 1}`).join(" AND ");

  const values = [...setEntries.map(([, v]) => v), ...pk.map((col) => pkValues[col])];
  const tableSql = `${ident(ref.schema)}.${ident(ref.table)}`;

  const { rows } = await getPool(dbName).query(`UPDATE ${tableSql} SET ${setClause} WHERE ${whereClause} RETURNING *`, values);
  return rows[0];
}

export async function insertRow(dbName: string, ref: TableRef, values: Record<string, unknown>) {
  const columns = await getColumns(dbName, ref);
  assertKnownColumns(columns, Object.keys(values));

  const entries = Object.entries(values);
  const columnsSql = entries.map(([col]) => ident(col)).join(", ");
  const placeholders = entries.map((_, i) => `$${i + 1}`).join(", ");
  const tableSql = `${ident(ref.schema)}.${ident(ref.table)}`;

  const { rows } = await getPool(dbName).query(
    `INSERT INTO ${tableSql} (${columnsSql}) VALUES (${placeholders}) RETURNING *`,
    entries.map(([, v]) => v)
  );
  return rows[0];
}

export async function deleteRow(dbName: string, ref: TableRef, pkValues: Record<string, unknown>) {
  const columns = await getColumns(dbName, ref);
  const pk = requirePrimaryKey(columns);
  assertKnownColumns(columns, Object.keys(pkValues));

  const whereClause = pk.map((col, i) => `${ident(col)} = $${i + 1}`).join(" AND ");
  const tableSql = `${ident(ref.schema)}.${ident(ref.table)}`;

  await getPool(dbName).query(`DELETE FROM ${tableSql} WHERE ${whereClause}`, pk.map((col) => pkValues[col]));
}

export interface RawQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export async function runRawQuery(dbName: string, sql: string): Promise<RawQueryResult> {
  const result = await getPool(dbName).query(sql);
  return {
    columns: result.fields?.map((f) => f.name) ?? [],
    rows: result.rows,
    rowCount: result.rowCount ?? 0,
  };
}
