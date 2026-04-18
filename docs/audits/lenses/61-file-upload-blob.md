# Lens 61 — File Upload / Blob Storage

**Auditor perspective:** File upload endpoints, size limits, type validation, storage location, and blob handling in a server-rendered Hono application.

**Date:** 2026-04-16
**Codebase snapshot:** ~288 TypeScript files, server-rendered HTML via Hono, no frontend framework

---

## Executive Summary

Foundry has no file upload functionality. There are no multer/formidable imports, no multipart form processing beyond CSRF token extraction, no blob storage integration, and no file-serving endpoints beyond static assets. This is appropriate for the current product (a server-rendered intelligence dashboard with AI-generated content). However, the CSRF middleware does reference `multipart/form-data` content type for parsing, and the static file route has a path traversal concern that was partially mitigated. The absence of file upload is notable because several features could benefit from it (logo upload for board packets, CSV import for metric data, document upload for audit evidence), and adding it later without a pre-existing security framework would be risky.

---

## Findings

### BLOB-01. No File Upload Capability ��� By Design, but Limits Product Features

**Severity: P3 (informational)**

The codebase has zero file upload endpoints. Form submissions use `application/x-www-form-urlencoded` or `application/json`. The `multipart/form-data` reference in CSRF middleware (`src/middleware/csrf.ts:49`) is only for parsing form fields that happen to use multipart encoding, not for file uploads.

**Evidence:**
- No imports of `multer`, `formidable`, `busboy`, or any file-handling library in `package.json`
- No `<input type="file">` in any HTML template
- No blob storage integration (S3, R2, GCS)
- The CSRF middleware at `src/middleware/csrf.ts:49` handles `multipart/form-data` for CSRF token extraction only
- Board packet generation (`src/routes/dashboard/board-packet.ts`) generates content server-side; no document upload

**Remediation:** No immediate action needed. When file upload is added in the future, ensure: (1) file size limits (e.g., 10MB), (2) MIME type validation against allowlist, (3) storage in external blob storage (not local filesystem on Fly.io ephemeral disk), (4) virus scanning for uploaded documents, (5) content-disposition headers on downloads to prevent XSS via uploaded HTML.

**Target phase:** Future (no current risk)

---

### BLOB-02. Static File Route Has Partial Path Traversal Protection

**Severity: P2**

`src/index.ts:183-184` — `const fileName = c.req.param('file'); if (!/^[\w.-]+$/.test(fileName)) return c.notFound()`. This regex allows alphanumeric characters, underscores, dots, and hyphens. It prevents `../` traversal. However, it allows filenames like `....` (multiple dots) or `.env` (dotfiles). The `readFileSync` at line 188-189 reads from a fixed directory (`public/`), so the risk is limited to files within that directory, but the regex could be tightened.

**Evidence:**
- `src/index.ts:183` — `if (!/^[\w.-]+$/.test(fileName)) return c.notFound()`
- Allows: `styles.css` (good), `app.js` (good), `.env` (bad — if .env existed in public/), `....` (weird but harmless)
- Line 188-189: `resolve(__dirname, 'public', fileName)` — confined to public directory
- The `readFileSync` would fail on non-existent files, falling through to the production path

**Remediation:** Tighten the regex: `/^[a-zA-Z0-9][\w.-]*\.[a-z]{2,4}$/.test(fileName)` — require the filename to start with alphanumeric and end with a file extension. Explicitly reject dotfiles.

**Target phase:** P2

---

### BLOB-03. `readFileSync` in Static Route Is Synchronous — Blocks Event Loop

**Severity: P2**

`src/index.ts:188-189` uses `readFileSync` to serve static files. This blocks the Node.js event loop during file I/O. For small CSS/JS files, the impact is negligible. But if a large file were placed in the public directory, it would block all concurrent requests during the read.

**Evidence:**
- `src/index.ts:188` — `readFileSync(filePath)` — synchronous file read
- Line 193: `readFileSync(filePath, 'utf-8')` — reads entire file into memory
- Called on every static file request (CSS, JS, SVG, manifest, service worker)
- No caching: the file is read from disk on every request (no in-memory cache, no ETag, no 304 support)

**Remediation:** Use Hono's built-in `serveStatic` middleware or `readFile` (async) instead of `readFileSync`. Add in-memory caching with ETag support for static files. In production, serve static files from Fly.io's proxy or a CDN.

**Target phase:** P2

---

### BLOB-04. PWA Manifest and Service Worker Served Without Integrity Checks

**Severity: P3**

`src/index.ts:201-213` serves `manifest.json` and `sw.js` from the filesystem. These files control the PWA installation and service worker behavior. They are served with `Cache-Control: public, max-age=3600` (manifest) and `Cache-Control: no-cache` (service worker). The service worker is served from the root scope (`/sw.js`), which gives it control over all routes.

**Evidence:**
- `src/index.ts:201-206` — manifest served with 1-hour cache
- `src/index.ts:208-213` — service worker served with no-cache
- `src/public/sw.js:16-115` — service worker caches static assets and handles push notifications
- No Subresource Integrity (SRI) on the service worker registration
- If the sw.js file were compromised (unlikely but high-impact), it would intercept all network requests

**Remediation:** Low risk since the file is served from the application's own filesystem. For defense-in-depth, add a `Content-Security-Policy: worker-src 'self'` header to restrict service worker origins.

**Target phase:** P3

---

## Embarrassment Test

1. **"Static files are served via synchronous `readFileSync` on every request with no caching, ETag support, or CDN — a file request blocks the entire Node.js event loop"** — Every CSS/JS request is a blocking file read.

2. **"The static file regex allows `.env` as a filename — if a .env file were accidentally placed in the public directory, it would be served"** — The path traversal protection has a dotfile gap.

3. **"No file upload capability exists, which means board packets can't include uploaded logos, metric CSV imports are impossible, and any future file feature must be built from scratch without security precedent"** — Missing capability that multiple product features would benefit from.

## Pride Test

1. The static file route correctly validates filenames with a regex that prevents path traversal (`../` attacks), which is the most critical security concern for file serving.

2. The service worker is correctly served with `Cache-Control: no-cache`, ensuring browsers always check for updates rather than serving a stale service worker.

3. The MIME type mapping (`src/index.ts:193`) correctly maps file extensions to content types, preventing content-type confusion attacks.

## Distinct-Value Declaration

This lens examines file I/O safety, blob storage architecture, and static asset serving patterns — concerns that fall outside both the security lens (which focuses on auth/crypto) and the performance lens (which focuses on query optimization). The synchronous file read pattern, the dotfile regex gap, and the absence of a blob storage strategy are unique findings.

## Tenancy-Critical Flag

No tenancy-critical findings. Static files are shared assets, not tenant-specific. No file upload means no risk of cross-tenant file access.
