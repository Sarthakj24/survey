'use strict';

/**
 * Absence Reason Survey — zero-dependency Node server.
 *
 * Flow:
 *   - Admin sets up the list of dates (max 20) and shares the employee link.
 *   - Each employee opens "/", fills Name + Employee Code, and picks a reason
 *     for each date (Log out / Missed regularisation / Other -> specify).
 *   - Admin opens "/admin", reviews all responses, and downloads a CSV.
 *
 * Storage: plain JSON files under ./data (no database, no npm install).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
// Change this in production: ADMIN_PASSWORD=yourpassword node server.js
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MAX_DATES = 20;

const REASONS = ['Log out', 'Missed regularisation', 'Other'];

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const RESPONSES_FILE = path.join(DATA_DIR, 'responses.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ title: 'Absence Reason Form', dates: [] }, null, 2));
  }
  if (!fs.existsSync(RESPONSES_FILE)) {
    fs.writeFileSync(RESPONSES_FILE, JSON.stringify([], null, 2));
  }
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getConfig() {
  return readJSON(CONFIG_FILE, { title: 'Absence Reason Form', dates: [] });
}

function getResponses() {
  return readJSON(RESPONSES_FILE, []);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, { 'Content-Type': contentType || 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return reject(new Error('Payload too large'));
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function isAuthed(req, parsedUrl) {
  const headerPwd = req.headers['x-admin-password'];
  const queryPwd = parsedUrl.searchParams.get('password');
  return headerPwd === ADMIN_PASSWORD || queryPwd === ADMIN_PASSWORD;
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCSV(config, responses) {
  const rows = [];
  rows.push(['Name', 'Employee Code', 'Date', 'Reason', 'Details', 'Submitted At'].map(csvEscape).join(','));
  for (const r of responses) {
    for (const e of r.entries || []) {
      rows.push([
        r.name,
        r.employeeCode,
        e.date,
        e.reason,
        e.details || '',
        r.submittedAt,
      ].map(csvEscape).join(','));
    }
  }
  return rows.join('\r\n');
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function serveStatic(res, fileName) {
  const filePath = path.join(PUBLIC_DIR, fileName);
  // Guard against path traversal.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) return sendText(res, 404, 'Not found');
    const ext = path.extname(filePath);
    sendText(res, 200, content, MIME[ext] || 'application/octet-stream');
  });
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  try {
    // --- Pages ---
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return serveStatic(res, 'index.html');
    }
    if (method === 'GET' && pathname === '/admin') {
      return serveStatic(res, 'admin.html');
    }
    if (method === 'GET' && (pathname === '/styles.css' || pathname === '/app.js' || pathname === '/admin.js')) {
      return serveStatic(res, pathname.slice(1));
    }

    // --- Public API ---
    if (method === 'GET' && pathname === '/api/config') {
      const cfg = getConfig();
      return sendJSON(res, 200, { title: cfg.title, dates: cfg.dates, reasons: REASONS });
    }

    if (method === 'POST' && pathname === '/api/responses') {
      const body = await readBody(req);
      const cfg = getConfig();
      const name = (body.name || '').toString().trim();
      const employeeCode = (body.employeeCode || '').toString().trim();
      const entries = Array.isArray(body.entries) ? body.entries : [];

      if (!name || !employeeCode) {
        return sendJSON(res, 400, { error: 'Name and Employee Code are required.' });
      }
      if (entries.length === 0) {
        return sendJSON(res, 400, { error: 'Please provide a reason for at least one date.' });
      }

      const validDates = new Set(cfg.dates);
      const cleanEntries = [];
      for (const e of entries) {
        const date = (e.date || '').toString();
        const reason = (e.reason || '').toString();
        const details = (e.details || '').toString().trim();
        if (!validDates.has(date)) {
          return sendJSON(res, 400, { error: `Unknown date: ${date}` });
        }
        if (!REASONS.includes(reason)) {
          return sendJSON(res, 400, { error: `Invalid reason for ${date}.` });
        }
        if (reason === 'Other' && !details) {
          return sendJSON(res, 400, { error: `Please specify the reason for ${date}.` });
        }
        cleanEntries.push({ date, reason, details: reason === 'Other' ? details : '' });
      }

      const responses = getResponses();
      responses.push({
        id: crypto.randomUUID(),
        name,
        employeeCode,
        entries: cleanEntries,
        submittedAt: new Date().toISOString(),
      });
      writeJSON(RESPONSES_FILE, responses);
      return sendJSON(res, 200, { ok: true });
    }

    // --- Admin API (password protected) ---
    if (pathname.startsWith('/api/admin/')) {
      if (!isAuthed(req, parsedUrl)) {
        return sendJSON(res, 401, { error: 'Unauthorized. Wrong admin password.' });
      }

      if (method === 'POST' && pathname === '/api/admin/config') {
        const body = await readBody(req);
        const title = (body.title || 'Absence Reason Form').toString().trim() || 'Absence Reason Form';
        let dates = Array.isArray(body.dates) ? body.dates : [];
        dates = dates.map((d) => (d || '').toString().trim()).filter(Boolean);
        // De-duplicate while preserving order, then sort chronologically.
        dates = [...new Set(dates)].sort();
        if (dates.length > MAX_DATES) {
          return sendJSON(res, 400, { error: `A maximum of ${MAX_DATES} dates is allowed.` });
        }
        writeJSON(CONFIG_FILE, { title, dates });
        return sendJSON(res, 200, { ok: true, title, dates });
      }

      if (method === 'GET' && pathname === '/api/admin/responses') {
        return sendJSON(res, 200, { config: getConfig(), responses: getResponses() });
      }

      if (method === 'GET' && pathname === '/api/admin/export.csv') {
        const csv = buildCSV(getConfig(), getResponses());
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="absence-responses.csv"',
        });
        // Prepend BOM so Excel reads UTF-8 correctly.
        return res.end('﻿' + csv);
      }

      if (method === 'POST' && pathname === '/api/admin/clear') {
        writeJSON(RESPONSES_FILE, []);
        return sendJSON(res, 200, { ok: true });
      }
    }

    sendText(res, 404, 'Not found');
  } catch (err) {
    sendJSON(res, 400, { error: err.message || 'Bad request' });
  }
});

ensureData();
server.listen(PORT, () => {
  console.log(`Absence Reason Survey running at http://localhost:${PORT}`);
  console.log(`  Employee form : http://localhost:${PORT}/`);
  console.log(`  Admin panel   : http://localhost:${PORT}/admin`);
  console.log(`  Admin password: ${ADMIN_PASSWORD === 'admin123' ? 'admin123 (default — set ADMIN_PASSWORD to change)' : '(from ADMIN_PASSWORD)'}`);
});
