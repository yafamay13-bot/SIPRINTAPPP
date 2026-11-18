import mysql from 'mysql2/promise';

let pool;

function getPool() {
  if (!pool) {
    const host = process.env.DB_HOST || '127.0.0.1';
    const port = Number(process.env.DB_PORT || 3306);
    const database = process.env.DB_NAME || 'siprint';
    const user = process.env.DB_USER || 'root';
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('DB_PORT must be a valid TCP port');
    }
    pool = mysql.createPool({
      host,
      port,
      database,
      user,
      password: process.env.DB_PASSWORD || '',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
  }
  return pool;
}

function taggedQuery(executor) {
  return async (strings, ...values) => {
    const statement = strings.reduce(
      (sql, part, index) => sql + (index ? '?' : '') + part,
      '',
    );
    const [result] = await executor.execute(statement, values);
    return Array.isArray(result) ? result : [result];
  };
}

export function db() {
  const connectionPool = getPool();
  const query = taggedQuery(connectionPool);
  query.begin = async (callback) => {
    const connection = await connectionPool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(taggedQuery(connection));
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Database transaction and rollback both failed.');
      }
      throw error;
    } finally {
      connection.release();
    }
  };
  query.end = () => connectionPool.end();
  return query;
}

export async function audit(userId, action, entityType, entityId = null, details = {}, ip = null) {
  await db()`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
    VALUES (${userId || null}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify(details)}, ${ip})`;
}

export async function notify(userId, title, message, link) {
  await db()`INSERT INTO notifications (user_id, title, message, link)
    VALUES (${userId}, ${title}, ${message.slice(0, 500)}, ${link})`;
}
