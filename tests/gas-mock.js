// 以記憶體模擬 Apps Script / Google Sheet，讓 Code.gs 可以在 Node 裡真的跑起來測試。
// 僅模擬 Code.gs 用到的功能；真實 Google 環境的行為（授權、配額、時區）無法在此驗證。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function colToNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.notes = {}; this.stats = { getRange: 0, setValues: 0, deleteRow: 0 }; }
  _ensure(r, c) { while (this.rows.length < r) this.rows.push([]); for (let i = 0; i < r; i++) while (this.rows[i].length < c) this.rows[i].push(''); }
  getLastRow() { let last = 0; this.rows.forEach((r, i) => { if (r.some(v => v !== '' && v != null)) last = i + 1; }); return last; }
  getMaxColumns() { return 26; }
  insertColumnsAfter() { }
  getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getRange(a, b, c, d) {
    this.stats.getRange++;
    const sh = this;
    if (typeof a === 'string') return chain();            // 'A:A' 之類只用於格式設定
    const r0 = a, c0 = b, nr = c || 1, nc = d || 1;
    const rng = {
      getValues() { sh._ensure(r0 + nr - 1, c0 + nc - 1); return Array.from({ length: nr }, (_, i) => sh.rows[r0 - 1 + i].slice(c0 - 1, c0 - 1 + nc)); },
      setValues(v) {
        sh.stats.setValues++;
        if (v.length !== nr || v.some(row => row.length !== nc)) throw new Error(`setValues 尺寸不符 ${nr}x${nc} vs ${v.length}x${v[0] && v[0].length}`);
        sh._ensure(r0 + nr - 1, c0 + nc - 1);
        v.forEach((row, i) => row.forEach((x, j) => { sh.rows[r0 - 1 + i][c0 - 1 + j] = x; }));
        return rng.self;
      },
      clearContent() { sh._ensure(r0 + nr - 1, c0 + nc - 1); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.rows[r0 - 1 + i][c0 - 1 + j] = ''; return rng.self; },
      setValue(v) { sh._ensure(r0, c0); sh.rows[r0 - 1][c0 - 1] = v; return rng.self; },
      setNote(t) { sh.notes[`${r0},${c0}`] = t; return rng.self; }
    };
    const prx = new Proxy(rng, { get: (t, p) => (p in t ? t[p] : () => prx) });
    rng.self = prx;
    return prx;
    function chain() { const p = new Proxy({}, { get: () => () => p }); return p; }
  }
  deleteRow(r) { this.stats.deleteRow++; this.rows.splice(r - 1, 1); }
  setFrozenRows() { } setFrozenColumns() { }
}

function build(opts = {}) {
  const sheets = new Map();
  const ss = {
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const s = new Sheet(n); sheets.set(n, s); return s; }
  };
  const props = new Map(), cache = new Map();
  let lockDepth = 0, maxLock = 0, lockCalls = 0;
  const tz8 = d => new Date(d.getTime() + 8 * 3600000).toISOString();
  const ctx = {
    console, Date, Math, JSON, Number, String, Object, Array, isNaN, parseFloat, Error, RegExp,
    Logger: { log: () => { } },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => { throw new Error('no ui'); },
      flush: () => { },
      newDataValidation: () => { const b = { requireValueInList: () => b, build: () => ({}) }; return b; }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { lockDepth++; lockCalls++; maxLock = Math.max(maxLock, lockDepth); if (lockDepth > 1) throw new Error('鎖被巢狀取得'); }, releaseLock: () => { lockDepth--; } }) },
    Utilities: { formatDate: (d, tz, f) => { const s = tz8(d); return f === 'yyyy-MM-dd' ? s.slice(0, 10) : s.slice(0, 19).replace('T', ' '); } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  const post = obj => JSON.parse(ctx.doPost({ postData: { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).getContent());
  return { ctx, ss, sheets, props, cache, post, lock: () => ({ maxLock, lockCalls, lockDepth }) };
}

module.exports = { build };
