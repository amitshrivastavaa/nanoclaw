---
name: receipt-scanner
description: Scan receipt photos via Google Vision OCR, extract item-level data (store, items with qty/unit/price, total, payment method), store in SQLite, and reply with a one-line Cleo-style summary.
---

# Receipt Scanner

When a message contains `[Image: ... | url: ...]`, scan it as a receipt.

## Setup (once per container)

```bash
cd /home/node/.claude/skills/receipt-scanner && npm install --production 2>/dev/null
```

## Scan the receipt

```bash
node /home/node/.claude/skills/receipt-scanner/scan-receipt.js "<IMAGE_URL>"
```

This downloads the image, sends it to Google Vision API for OCR, and returns the raw text as JSON:

```json
{ "raw_text": "full OCR text here" }
```

If it returns an error, tell the user in Cleo voice (e.g., "That photo is blurrier than my future. Try again.").

## Extract receipt data

From the OCR text, extract ALL of the following:

**Receipt-level:**
- **store_name**: The store/business name (usually at the top)
- **store_address**: Full address if visible
- **date**: Transaction date in YYYY-MM-DD format
- **total_amount**: The final total paid (look for "TOTAL", "SUMME", "GESAMT", "ZU ZAHLEN")
- **currency**: Currency code (EUR, USD, GBP, etc.)
- **payment_method**: How they paid (e.g., "Visa", "Mastercard", "EC-Karte", "Cash", "Apple Pay", or null if not visible)

**Item-level (extract EVERY line item):**
- **item_name**: Product name as printed
- **quantity**: Numeric quantity (e.g., 1, 2, 0.176). Default 1 if not specified
- **unit**: Unit of measurement (e.g., "kg", "L", "piece"). Default "piece" if not specified
- **price_per_unit**: Price per unit if shown (e.g., 5.90 for "5.90 EUR/kg"). Null if not shown
- **total_price**: Total price for this line item

Tips for parsing German receipts:
- Items with weight: "0,176 kg x 5,90 EUR/kg" means qty=0.176, unit=kg, price_per_unit=5.90, total=1.04
- "2 x 1,29" means qty=2, price_per_unit=1.29, total=2.58
- Comma is decimal separator in German receipts (1,29 = 1.29)
- "SUMME" or "GESAMT" or "ZU ZAHLEN" = total
- Lines with "A" or "B" suffix typically indicate tax rate categories — ignore the letter

## Store the result

```bash
node /home/node/.claude/skills/receipt-scanner/store-receipt.js '<JSON>'
```

Where `<JSON>` is a JSON object with:

```json
{
  "store_name": "Penny",
  "store_address": "Hauptstr. 1, 10827 Berlin",
  "date": "2026-03-25",
  "total_amount": 16.24,
  "currency": "EUR",
  "payment_method": "EC-Karte",
  "items": [
    {
      "item_name": "Bio Ingwer",
      "quantity": 0.176,
      "unit": "kg",
      "price_per_unit": 5.90,
      "total_price": 1.04
    },
    {
      "item_name": "Hafermilch",
      "quantity": 1,
      "unit": "piece",
      "price_per_unit": null,
      "total_price": 1.29
    }
  ]
}
```

## Reply

Reply with exactly ONE line in Cleo's voice. Pick one interesting detail from the items — a specific product, a price-per-unit, a quantity — and riff on it. Use at most one emoji.

Examples:
- "Penny, €16.24. Bio Ingwer at €5.90/kg — very Berlin of you. 🛒"
- "€43.20 at Rewe. Groceries up this week. The broccoli economy is struggling."
- "Edeka, €8.70. Three energy drinks. I'm not judging. (I'm judging.)"

Do NOT say "I scanned your receipt" or explain what you did. Just the summary.

## Querying receipts

When the user asks about spending (e.g., "how much did I spend this week?", "show me my receipts", "what did I buy at Penny?"):

```bash
node /home/node/.claude/skills/receipt-scanner/query-receipts.js '<QUERY_JSON>'
```

Where `<QUERY_JSON>` can have optional fields:
- `store`: filter by store name (partial match)
- `item`: filter by item name (partial match)
- `since`: YYYY-MM-DD
- `until`: YYYY-MM-DD
- `limit`: max results (default 50)

The script returns receipts with their items and spending summaries.
