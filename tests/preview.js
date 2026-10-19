// 產生可直接用瀏覽器開啟的預覽頁（內含假資料與假後端），供人工／截圖檢查版面。
const fs = require('fs'), path = require('path');
const { build } = require('./gas-mock');
const out = process.argv[2];
const gas = build(); gas.ctx.setup(); gas.props.set('PASSCODE', '1');
const S = '王李張陳林黃吳劉蔡楊';
gas.sheets.get('班級名單').rows = [['班級', '座號', '姓名'], ...Array.from({ length: 35 }, (_, i) => ['101', i + 1, `${S[i % 10]}小${['明','華','美','強','玲'][i % 5]}${i + 1}`])];
const today = new Date().toISOString().slice(0, 10);
const acts = gas.post({ action: 'bootstrap', key: '1' }).cfg.activities.filter(a => a.on);
const recs = [];
acts.forEach((a, ai) => { for (let no = 1; no <= 35; no++) { if ((no * 7 + ai * 3) % 11 === 0) continue;
  const g = ((no * 5 + ai * 2) % 9 === 0) ? 1 : ((no + ai) % 4) + 1; const lv = [0, 1, 2, 3, 4][g];
  let v = a.mode === 'level' ? g : a.mode === 'checklist' ? Math.max(0, g === 1 ? 1 : g === 2 ? 2 : g === 3 ? 3 : 4) : a.dir === '低' ? [0, 9, 7.5, 6, 5][g] : [0, 0, a.t2, a.t3, a.t4][g];
  recs.push({ date: ai % 2 ? today : '2026-09-10', cls: '101', no, aid: a.id, value: v, detail: a.mode === 'checklist' ? '1'.repeat(v).padEnd(a.items.length, '0') : '' }); } });
gas.post({ action: 'save', key: '1', records: recs });
const boot = JSON.stringify(gas.post({ action: 'bootstrap', key: '1' }));
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const inject = `<script>localStorage.setItem('pe1.auth',JSON.stringify({url:'x',key:'1'}));localStorage.setItem('pe1.ui',JSON.stringify({view:window.__VIEW||location.hash.slice(1)||'reg',cls:'101',cat:'跑步',aid:'RUN01'}));window.fetch=async()=>({ok:true,status:200,json:async()=>(${boot})});</script>`;
fs.writeFileSync(out, html.replace('<script>', inject + '<script>'));
