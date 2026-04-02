#!/usr/bin/env node

/**
 * store-receipt.js — Store a parsed receipt with line items in SQLite.
 *
 * Usage: node store-receipt.js '<json>'
 *
 * JSON fields:
 *   store_name, store_address, date, total_amount, currency, payment_method,
 *   items: [{ item_name, quantity, unit, price_per_unit, total_price }]
 *
 * Database: /workspace/group/receipts.db
 */

import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

const DB_PATH = '/workspace/group/receipts.db';

function die(msg) {
  console.log(JSON.stringify({ error: msg }));
  process.exit(0);
}

async function main() {
  const input = process.argv[2];
  if (!input) die('Usage: store-receipt.js \'<json>\'');

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    die('Invalid JSON input');
  }

  const SQL = await initSqlJs();

  let db;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // Migrate: if old schema exists (has 'merchant' column), drop and recreate
  try {
    const tableInfo = db.exec("PRAGMA table_info(receipts)");
    if (tableInfo.length > 0) {
      const columns = tableInfo[0].values.map(row => row[1]);
      if (columns.includes('merchant') && !columns.includes('store_name')) {
        db.run('DROP TABLE IF EXISTS receipts');
      }
    }
  } catch {
    // Table doesn't exist yet, that's fine
  }

  db.run(`CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_name TEXT,
    store_address TEXT,
    date TEXT,
    total_amount REAL,
    currency TEXT DEFAULT 'EUR',
    payment_method TEXT,
    created_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS receipt_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id INTEGER NOT NULL,
    item_name TEXT,
    quantity REAL DEFAULT 1,
    unit TEXT DEFAULT 'piece',
    price_per_unit REAL,
    total_price REAL,
    created_at TEXT,
    FOREIGN KEY (receipt_id) REFERENCES receipts(id)
  )`);

  const now = new Date().toISOString();

  db.run(
    `INSERT INTO receipts (store_name, store_address, date, total_amount, currency, payment_method, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.store_name || 'Unknown',
      data.store_address || null,
      data.date || null,
      parseFloat(data.total_amount) || 0,
      data.currency || 'EUR',
      data.payment_method || null,
      now,
    ]
  );

  const receiptId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

  const items = data.items || [];
  let itemCount = 0;
  for (const item of items) {
    db.run(
      `INSERT INTO receipt_items (receipt_id, item_name, quantity, unit, price_per_unit, total_price, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        receiptId,
        item.item_name || 'Unknown',
        parseFloat(item.quantity) || 1,
        item.unit || 'piece',
        item.price_per_unit != null ? parseFloat(item.price_per_unit) : null,
        parseFloat(item.total_price) || 0,
        now,
      ]
    );
    itemCount++;
  }

  // Write database back to disk
  const dbData = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(dbData));
  db.close();

  console.log(JSON.stringify({ success: true, receipt_id: receiptId, items_stored: itemCount }));
}

main().catch((err) => die(err.message));
