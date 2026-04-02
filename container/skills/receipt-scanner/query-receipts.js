#!/usr/bin/env node

/**
 * query-receipts.js — Query the receipts database with item-level detail.
 *
 * Usage: node query-receipts.js '<json>'
 *
 * Optional JSON fields: store, item, since, until, limit
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

function rowsToObjects(result) {
  if (!result || !result.columns || !result.values) return [];
  return result.values.map((row) =>
    Object.fromEntries(result.columns.map((c, i) => [c, row[i]]))
  );
}

async function main() {
  const input = process.argv[2] || '{}';

  let filters;
  try {
    filters = JSON.parse(input);
  } catch {
    die('Invalid JSON input');
  }

  if (!fs.existsSync(DB_PATH)) die('No receipts database found');

  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  // Build receipt-level filters
  const conditions = [];
  const params = [];

  if (filters.store) {
    conditions.push('r.store_name LIKE ?');
    params.push(`%${filters.store}%`);
  }
  if (filters.since) {
    conditions.push('r.date >= ?');
    params.push(filters.since);
  }
  if (filters.until) {
    conditions.push('r.date <= ?');
    params.push(filters.until);
  }

  // If filtering by item, join on receipt_items
  let itemJoin = '';
  if (filters.item) {
    itemJoin = 'INNER JOIN receipt_items fi ON fi.receipt_id = r.id';
    conditions.push('fi.item_name LIKE ?');
    params.push(`%${filters.item}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = parseInt(filters.limit) || 50;

  // Get matching receipts
  const receiptRows = db.exec(
    `SELECT DISTINCT r.id, r.store_name, r.store_address, r.date, r.total_amount, r.currency, r.payment_method, r.created_at
     FROM receipts r ${itemJoin}
     ${where}
     ORDER BY r.date DESC, r.created_at DESC
     LIMIT ?`,
    [...params, limit]
  );

  const receipts = rowsToObjects(receiptRows[0]);

  // Get items for each receipt
  for (const receipt of receipts) {
    const itemRows = db.exec(
      `SELECT id, item_name, quantity, unit, price_per_unit, total_price
       FROM receipt_items WHERE receipt_id = ?
       ORDER BY id`,
      [receipt.id]
    );
    receipt.items = rowsToObjects(itemRows[0]);
  }

  // Spending summary by store
  const storeSummary = db.exec(
    `SELECT r.store_name, SUM(r.total_amount) as total, COUNT(*) as receipt_count, r.currency
     FROM receipts r ${itemJoin}
     ${where}
     GROUP BY r.store_name, r.currency
     ORDER BY total DESC`,
    params
  );

  // Item-level summary if item filter is used
  let itemSummary = [];
  if (filters.item) {
    const itemSum = db.exec(
      `SELECT ri.item_name, SUM(ri.total_price) as total_spent, SUM(ri.quantity) as total_qty, ri.unit
       FROM receipt_items ri
       INNER JOIN receipts r ON r.id = ri.receipt_id
       ${where.replace('fi.', 'ri.')}
       GROUP BY ri.item_name, ri.unit
       ORDER BY total_spent DESC`,
      params
    );
    itemSummary = rowsToObjects(itemSum[0]);
  }

  db.close();

  console.log(JSON.stringify({
    receipts,
    store_summary: rowsToObjects(storeSummary[0]),
    item_summary: itemSummary,
    total_count: receipts.length,
  }));
}

main().catch((err) => die(err.message));
