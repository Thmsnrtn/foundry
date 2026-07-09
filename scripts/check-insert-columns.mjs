#!/usr/bin/env node
// Schema-vs-code INSERT column checker (schema drift audit).
// Builds the real schema from migrations, then verifies every
// `INSERT INTO <table> (cols...)` in src references only real columns.
// Usage: node scripts/check-insert-columns.mjs
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
const DB = '/tmp/_foundry_colcheck.db';
execSync(`rm -f ${DB}`);
for (const f of readdirSync('src/db/migrations').filter(f=>f.endsWith('.sql')).sort()) {
  try { execSync(`sqlite3 ${DB} < src/db/migrations/${f} 2>/dev/null`); } catch {}
}
const tbls = execSync(`sqlite3 ${DB} "SELECT name FROM sqlite_master WHERE type='table'"`).toString().trim().split('\n');
const cols = {};
for (const t of tbls) cols[t.toLowerCase()] = new Set(
  execSync(`sqlite3 ${DB} "PRAGMA table_info('${t}')"`).toString().trim().split('\n').map(l=>l.split('|')[1]?.toLowerCase()).filter(Boolean));
function walk(d){let o=[];for(const e of readdirSync(d)){const p=join(d,e);const s=statSync(p);if(s.isDirectory())o=o.concat(walk(p));else if(e.endsWith('.ts'))o.push(p);}return o;}
// Known false positives: tables self-created at runtime with a different schema
// than any migration declares (migrate.ts creates schema_migrations(filename)
// before applying migration files).
const ALLOW = new Set(['schema_migrations.filename']);
const re = /INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi;
const bad = [];
for (const file of walk('src')) {
  const txt = readFileSync(file,'utf8'); let m; re.lastIndex=0;
  while((m=re.exec(txt))!==null){
    const table=m[1].toLowerCase(); if(!cols[table])continue;
    const list=m[2].split(',').map(c=>c.trim().toLowerCase().replace(/["'`]/g,'')).filter(c=>/^[a-z_][a-z0-9_]*$/.test(c));
    for(const c of list) if(!cols[table].has(c) && !ALLOW.has(`${table}.${c}`)) bad.push(`${file}:${txt.slice(0,m.index).split('\n').length}  ${table}.${c}`);
  }
}
execSync(`rm -f ${DB}`);
console.log(bad.length ? bad.join('\n')+`\n\n${bad.length} INSERT column mismatches` : 'CLEAN');
process.exit(bad.length?1:0);
