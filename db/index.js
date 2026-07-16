const path = require('path');
const fs = require('fs');
const deasync = require('deasync');

function isPostgresConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function normalizeSql(sql) {
  let normalized = sql
    .replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/datetime\("now"\)/gi, 'CURRENT_TIMESTAMP')
    .replace(
      /\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi,
      'BIGSERIAL PRIMARY KEY'
    )
    .replace(/\bAUTOINCREMENT\b/gi, '')
    .replace(
      /DEFAULT\s+\(\s*datetime\('now'\)\s*\)/gi,
      'DEFAULT CURRENT_TIMESTAMP'
    );

  normalized = normalized.replace(
    /\b(is_active|email_verified|used|is_deleted|is_admin)\s*=\s*1\b/gi,
    '$1 = TRUE'
  );

  normalized = normalized.replace(
    /\b(is_active|email_verified|used|is_deleted|is_admin)\s*=\s*0\b/gi,
    '$1 = FALSE'
  );

  return normalized;
}

function bindParams(sql, params = []) {
  let index = 0;
  let counter = 1;

  const text = sql.replace(/\?/g, () => {
    return `$${counter++}`;
  });

  return {
    text,
    values: params
  };
}

let db;

//
// POSTGRES MODE
//
if (isPostgresConfigured()) {

  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    },
    max: 10
  });
      console.log("Using PostgreSQL database");



  let initialized = false;


  async function initializeDatabase() {

    if (initialized) return;

    const client = await pool.connect();

    try {

      const schemaPath = path.join(
        __dirname,
        'schema.postgres.sql'
      );

      const schema = fs.readFileSync(
        schemaPath,
        'utf8'
      );

      await client.query(schema);

      initialized = true;

    } finally {

      client.release();

    }
  }


  function runQuery(sql, params = []) {

    let result;
    let error;


    deasync.runLoopOnce();


    pool.query(
      bindParams(
        normalizeSql(sql),
        params
      ).text,
      bindParams(
        normalizeSql(sql),
        params
      ).values
    )
    .then(res => {
      result = res;
    })
    .catch(err => {
      error = err;
    });


    while (!result && !error) {
      deasync.runLoopOnce();
    }


    if (error) {
      throw error;
    }

    return result;
  }



  db = {


    init() {

      return new Promise((resolve, reject) => {

        initializeDatabase()
          .then(resolve)
          .catch(reject);

      });

    },


    prepare(sql) {

      const normalized = normalizeSql(sql);


      return {


        get(...params) {

          initializeDatabase();

          const result = runQuery(
            normalized,
            params
          );

          return result.rows[0] || undefined;

        },


        all(...params) {

          initializeDatabase();

          const result = runQuery(
            normalized,
            params
          );

          return result.rows;

        },


        run(...params) {

          initializeDatabase();


          let query = normalized;


          if (
            /^\s*INSERT\b/i.test(query)
            &&
            !/RETURNING\b/i.test(query)
          ) {

            query += ' RETURNING id';

          }


          const result = runQuery(
            query,
            params
          );


          return {

            lastInsertRowid:
              result.rows?.[0]?.id ?? null,

            changes:
              result.rowCount || 0,

            rowCount:
              result.rowCount || 0

          };

        }


      };

    },


    exec(sql) {

      initializeDatabase();

      return runQuery(
        normalizeSql(sql)
      );

    },


    transaction(fn) {

      return (...args) => {

        let result;
        let error;


        deasync.runLoopOnce();


        (async () => {

          const client = await pool.connect();

          try {

            await client.query('BEGIN');

            result = await fn(...args);

            await client.query('COMMIT');


          } catch(err) {

            await client.query('ROLLBACK');

            error = err;


          } finally {

            client.release();

          }

        })();


        while (!result && !error) {

          deasync.runLoopOnce();

        }


        if(error) throw error;


        return result;

      };

    }


  };



//
// SQLITE FALLBACK
//
} else {


  const { DatabaseSync } = require('node:sqlite');


  const DB_PATH =
    process.env.DB_PATH ||
    path.join(__dirname, 'store.db');


  const SCHEMA_PATH =
    path.join(__dirname, 'schema.sql');


  const raw = new DatabaseSync(DB_PATH);


  raw.exec(
    'PRAGMA journal_mode=WAL;'
  );


  raw.exec(
    'PRAGMA foreign_keys=ON;'
  );


  const schema =
    fs.readFileSync(
      SCHEMA_PATH,
      'utf8'
    );


  raw.exec(schema);



  db = {


    prepare(sql) {

      const stmt =
        raw.prepare(sql);


      return {


        get(...params) {

          return stmt.get(...params);

        },


        all(...params) {

          return stmt.all(...params);

        },


        run(...params) {

          return stmt.run(...params);

        }


      };

    },


    exec(sql) {

      return raw.exec(sql);

    },


    transaction(fn) {

      return (...args) => {

        raw.exec('BEGIN');


        try {

          const result =
            fn(...args);


          raw.exec('COMMIT');

          return result;


        } catch(err) {

          raw.exec('ROLLBACK');

          throw err;

        }

      };

    }


  };


}


module.exports = db;
