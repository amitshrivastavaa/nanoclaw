#!/usr/bin/env node

/**
 * scan-receipt.js — Download image, OCR via Google Vision API, return raw text.
 *
 * Usage: node scan-receipt.js <image_url>
 *
 * Reads service account from /workspace/group/cleo-vision.json
 * Outputs JSON: { raw_text: "..." } or { error: "..." }
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';

const VISION_API = 'https://vision.googleapis.com/v1/images:annotate';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SA_PATH = '/workspace/group/cleo-vision.json';

function die(msg) {
  console.log(JSON.stringify({ error: msg }));
  process.exit(0);
}

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-vision',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));

  const sigInput = `${header}.${claims}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(sigInput);
  const signature = sign.sign(sa.private_key, 'base64url');

  const jwt = `${sigInput}.${signature}`;
  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = JSON.parse(res.body.toString());
  if (!data.access_token) die(`Token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function callVisionAPI(token, imageBase64) {
  const body = JSON.stringify({
    requests: [{
      image: { content: imageBase64 },
      features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
    }],
  });

  const res = await fetch(VISION_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  const data = JSON.parse(res.body.toString());
  if (data.error) die(`Vision API error: ${data.error.message}`);

  const annotations = data.responses?.[0]?.textAnnotations;
  if (!annotations || annotations.length === 0) die('No text found in image');

  return annotations[0].description;
}

async function downloadImage(url) {
  // Follow redirects (up to 5)
  let currentUrl = url;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(currentUrl, { method: 'GET' });
    if (res.status >= 300 && res.status < 400) {
      // Would need to parse Location header — simplified: just use the body
      die('Redirect not supported');
    }
    if (res.status !== 200) die(`Failed to download image: HTTP ${res.status}`);
    return res.body;
  }
  die('Too many redirects');
}

async function main() {
  const imageUrl = process.argv[2];
  if (!imageUrl) die('Usage: scan-receipt.js <image_url>');

  if (!fs.existsSync(SA_PATH)) die(`Service account not found at ${SA_PATH}`);
  const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf-8'));

  const token = await getAccessToken(sa);
  const imageBuffer = await downloadImage(imageUrl);
  const imageBase64 = imageBuffer.toString('base64');
  const rawText = await callVisionAPI(token, imageBase64);

  console.log(JSON.stringify({ raw_text: rawText }));
}

main().catch((err) => die(err.message));
