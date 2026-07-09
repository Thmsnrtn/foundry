#!/usr/bin/env node
// UPDATE-SET column checker (schema drift audit, write paths).
// `UPDATE <table> SET col = ...` — table + assigned columns are explicit and
// unambiguous. Verifies each assigned column exists in the real schema.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
const DB = '/tmp/_sqlcol.db'; execSync(`rm -f ${DB}`);
for (const f of readdirSync('src/db/migrations').filter(f=>f.endsWith('.sql')).sort())
  try { execSync(`sqlite3 ${DB} < src/db/migrations/${f} 2>/dev/null`); } catch {}
const tbls = execSync(`sqlite3 ${DB} "SELECT name FROM sqlite_master WHERE type='table'"`).toString().trim().split('\n');
const cols = {};
for (const t of tbls) cols[t.toLowerCase()] = new Set(execSync(`sqlite3 ${DB} "PRAGMA table_info('${t}')"`).toString().trim().split('\n').map(l=>l.split('|')[1]?.toLowerCase()).filter(Boolean));
execSync(`rm -f ${DB}`);
function walk(d){let o=[];for(const e of readdirSync(d)){const p=join(d,e);const s=statSync(p);if(s.isDirectory())o=o.concat(walk(p));else if(e.endsWith('.ts'))o.push(p);}return o;}
const bad=[];
for (const file of walk('src')) {
  const txt=readFileSync(file,'utf8');
  const upd=/UPDATE\s+([a-z_][a-z0-9_]*)\s+SET\s+([\s\S]*?)\s+WHERE\s/gi;
  let m;
  while((m=upd.exec(txt))!==null){
    const t=m[1].toLowerCase(); if(!cols[t])continue;
    // Only the LHS of each assignment: a column name immediately followed by '='.
    // Split on commas at top level; take token before first '='.
    for(const assign of m[2].split(/,(?![^(]*\))/)){
      const lhs=assign.split('=')[0].trim().replace(/["'`]/g,'').toLowerCase();
      if(!/^[a-z_][a-z0-9_]*$/.test(lhs))continue;
      if(!cols[t].has(lhs)){const ln=txt.slice(0,m.index).split('\n').length;bad.push(`${file}:${ln}  ${t}.${lhs}`);}
    }
  }
}
const seen=new Set(); const out=bad.filter(b=>{const k=b.split('  ')[1];if(seen.has(k))return false;seen.add(k);return true;});
console.log(out.length?out.join('\n')+`\n\n${out.length} UPDATE-SET column mismatches`:'CLEAN — all UPDATE SET columns exist');
