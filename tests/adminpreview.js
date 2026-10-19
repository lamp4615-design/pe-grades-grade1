// 產生可直接開啟的後台預覽頁（假資料＋假後端）。用法：node adminpreview.js 輸出.html
const fs = require('fs'), path = require('path');
const { build } = require('./gas-mock');
const gas = build(); gas.ctx.setup(); gas.props.set('PASSCODE', '1');
const N = '王李張陳林黃吳劉蔡楊';
gas.sheets.get('班級名單').rows = [['班級', '座號', '姓名'], ...['101', '102', '103'].flatMap((c, ci) => Array.from({ length: 30 - ci * 2 }, (_, i) => [c, i + 1, `${N[(i + ci) % 10]}${['小明', '小華', '小美', '小強', '小玲'][i % 5]}`]))];
const acts = gas.post({ action: 'bootstrap', key: '1' }).cfg.activities.filter(a => a.on);
const recs = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const [ci, c] of ['101', '102', '103'].entries()) for (const [di, date] of ['2026-09-08', '2026-09-22', '2026-10-06', '2026-10-13'].entries()) for (const [ai, a] of acts.entries()) {
  if ((ai + di + ci) % 3 === 0) continue; const n = 30 - ci * 2;
  for (let no = 1; no <= n; no++) { if (rnd() < 0.04) { recs.push({ date, cls: c, no, aid: a.id, absent: true }); continue; }
    const base = 0.55 + ci * 0.06 + di * 0.05 + (no % 7 === 0 ? -0.3 : 0), g = rnd() < base ? (rnd() < 0.45 ? 4 : 3) : (rnd() < 0.6 ? 2 : 1);
    const v = a.mode === 'level' ? g : a.mode === 'checklist' ? [0, 1, 2, 3, 4][g] : a.dir === '低' ? [0, 9, 7.5, 6, 5][g] : [0, 0, a.t2, a.t3, a.t4][g];
    recs.push({ date, cls: c, no, aid: a.id, value: v, detail: a.mode === 'checklist' ? '1'.repeat(v).padEnd(a.items.length, '0') : '' }); } }
gas.post({ action: 'save', key: '1', records: recs });
const boot = JSON.stringify(gas.post({ action: 'bootstrap', key: '1' }));
const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
const tab = process.argv[3] || 'home';
const inject = `<script>localStorage.setItem('pe1.auth',JSON.stringify({url:'x',key:'1'}));localStorage.setItem('pe1.admin.ui',JSON.stringify({tab:'${tab}',cls:'101'}));window.fetch=async()=>({ok:true,status:200,json:async()=>(${boot})});</script>`;
fs.writeFileSync(process.argv[2], html.replace('<script>', inject + '<script>'));
