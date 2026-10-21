import pg from 'pg';
import { neon } from '@neondatabase/serverless';
import { HttpError } from './http.js';

const unavailable = () => new HttpError(502, 'Project storage is temporarily unavailable.');
export function databaseProvider(env = process.env) {
  const driver = env.DATABASE_DRIVER ?? 'neon';
  if (!['neon', 'postgres'].includes(driver)) throw new Error('A supported database driver is required.');
  return driver;
}
export function hasDatabase(env = process.env) { return Boolean(env.DATABASE_URL); }
export function nativePoolOptions(connectionString) {
  return { connectionString, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 10000, query_timeout: 12000, application_name: '3dprint4me',
    types: { getTypeParser(oid, format) {
      if (oid === 1082) return value => value;
      if (oid === 1184) return value => new Date(value).toISOString();
      return pg.types.getTypeParser(oid, format);
    } } };
}
export function createNativeDatabase({ pool }) {
  return {
    async query(strings, ...values) {
      if (!Array.isArray(strings) || !Array.isArray(strings.raw)) throw new TypeError('Use a tagged template for database queries.');
      const text = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
      try { return (await pool.query(text, values.map(value => value === undefined ? null : value))).rows; }
      catch { throw unavailable(); }
    },
    async transaction(statements) {
      let client;
      try {
        client = await pool.connect(); await client.query('BEGIN');
        const result = [];
        for (const statement of statements) result.push((await client.query(statement.text, statement.values ?? [])).rows);
        await client.query('COMMIT'); return result;
      } catch { if (client) await client.query('ROLLBACK').catch(() => {}); throw unavailable(); }
      finally { client?.release(); }
    },
    async withTransaction(operation) {
      let client;
      try {
        client=await pool.connect();await client.query('BEGIN');
        const tx={query:async(strings,...values)=>{
          if(!Array.isArray(strings)||!Array.isArray(strings.raw))throw new TypeError('Use a tagged template for database queries.');
          const text=strings.reduce((sql,part,index)=>sql+(index?`$${index}`:'')+part,'');
          return (await client.query(text,values.map(value=>value===undefined?null:value))).rows;
        }};
        const result=await operation(tx);await client.query('COMMIT');return result;
      }catch(error){
        if(client)await client.query('ROLLBACK').catch(()=>{});
        throw error instanceof HttpError?error:unavailable();
      }finally{client?.release();}
    },
    close: () => pool.end()
  };
}
let cached;
export function getDatabase() {
  if (!hasDatabase()) throw new HttpError(503, 'Project storage is not configured.');
  const provider = databaseProvider(), connection = process.env.DATABASE_URL;
  if (cached?.connection === connection && cached.provider === provider) return cached.database;
  let database;
  if (provider === 'postgres') {
    const pool = new pg.Pool(nativePoolOptions(connection));
    pool.on('error', () => console.error('Database connection unavailable.'));
    database = createNativeDatabase({ pool });
  } else {
    const sql = neon(connection);
    database = { query: async (strings, ...values) => sql(strings, ...values),
      transaction: statements => sql.transaction(statements.map(({ text, values = [] }) => sql.query(text, values))), close: async () => {} };
  }
  const previous = cached;
  cached = { provider, connection, database };
  previous?.database.close().catch(() => {});
  return database;
}
export async function queryDatabase(strings, ...values) {
  try { return await getDatabase().query(strings, ...values); }
  catch (error) { if (error instanceof HttpError) throw error; throw unavailable(); }
}
export async function closeDatabase() { const value = cached; cached = undefined; await value?.database.close(); }
