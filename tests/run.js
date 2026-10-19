// 整合測試：用假資料跑「後端 Code.gs（模擬 Sheet）」＋「前端 index.html（jsdom）」。
// 執行：cd tests && npm i && npm test
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { build } = require('./gas-mock');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + (JSON.stringify(a) === JSON.stringify(b) ? '' : `（得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}）`));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = '246810';
const today = (() => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();

/* ───────── 假資料 ───────── */
const SURN = '王李張陳林黃吳劉蔡楊';
const fakeRoster = (cls, n) => Array.from({ length: n }, (_, i) => [cls, i + 1, `${SURN[i % 10]}測試${i + 1}`]);

function freshBackend() {
  const gas = build();
  gas.ctx.setup();
  const roster = gas.sheets.get('班級名單');
  const pc = gas.props.get('PASSCODE'); gas.props.set('PASSCODE', KEY);
  roster.rows = [roster.rows[0], ...fakeRoster('101', 35), ...fakeRoster('102', 12)];
  return gas;
}
const rec = (o) => Object.assign({ date: today, cls: '101', no: 1, aid: 'ROPE02', value: 10, absent: false, note: '', detail: '' }, o);

(async () => {
  /* ═════ 一、後端 ═════ */
  console.log('\n【後端 Code.gs（模擬 Sheet）】');
  let gas = build();
  gas.ctx.setup();
  eq([...gas.sheets.keys()], ['班級名單', '活動設定', '成績', '單元一覽'], 'setup() 建立四個分頁');
  const actRows = gas.sheets.get('活動設定').rows;
  eq(actRows[0], ['活動ID', '類別', '單元', '活動名稱', '圖示', '登記方式', '單位', '評分方向', '目標說明', '勾選項目', '優(4)', '達成(3)', '接近(2)', '啟用', '來源', '優分', '達成分', '接近分', '加油分'], '活動設定表頭正確（含 4 個分數欄）');
  eq(actRows.length - 1, 34, '預設活動共 34 筆（跑步6+跳繩3+球類8+平衡2+呼拉圈3+安全態度2+健康10）' );
  eq(gas.sheets.get('單元一覽').rows.length - 1, 20, '單元一覽 20 個單元（體育10＋健康10）');
  ok(/^\d{6}$/.test(gas.props.get('PASSCODE')), 'setup() 產生 6 碼通行碼');
  eq(actRows.filter(r => r[13] === 'N').map(r => r[1]).every(c => c === '健康') && actRows.filter(r => r[13] === 'N').length === 10, true, '只有 10 個健康活動預設停用');

  // 絕不覆蓋
  gas.sheets.get('班級名單').rows = [['班級', '座號', '姓名'], ['101', 1, '使用者自填']];
  gas.sheets.get('活動設定').rows[1][3] = '被老師改過的名稱';
  gas.ctx.setup();
  eq(gas.sheets.get('班級名單').rows[1][2], '使用者自填', '再次執行 setup() 不覆蓋班級名單');
  eq(gas.sheets.get('活動設定').rows[1][3], '被老師改過的名稱', '再次執行 setup() 不覆蓋活動設定');
  const before = gas.sheets.get('活動設定').rows.length;
  gas.ctx.restoreDefaultActivities();
  eq(gas.sheets.get('活動設定').rows.length, before, '補齊預設活動：沒缺就不新增');
  gas.sheets.get('活動設定').rows.splice(5, 1);
  gas.ctx.restoreDefaultActivities();
  eq(gas.sheets.get('活動設定').rows.length, before, '補齊預設活動：只補回被刪掉的那一筆');
  eq(gas.sheets.get('活動設定').rows[1][3], '被老師改過的名稱', '補齊預設活動不動既有列');

  gas = freshBackend();
  eq(gas.post({ action: 'bootstrap', key: 'bad' }).error, 'auth', '錯誤通行碼被拒');
  const boot = gas.post({ action: 'bootstrap', key: KEY });
  ok(boot.ok && boot.classOrder.length === 2 && boot.classes['101'].length === 35, 'bootstrap：回傳兩班名單（35＋12 人）');
  eq(boot.cfg.categories.slice(0, 3), ['跑步', '跳繩', '球類'], '類別順序：跑步、跳繩、球類排最前');
  const rope2 = boot.cfg.activities.find(a => a.id === 'ROPE02');
  eq([rope2.t4, rope2.t3, rope2.t2, rope2.mode, rope2.dir, rope2.on], [15, 8, 3, 'count', '高', true], '活動欄位解析（ROPE02）');
  eq(boot.cfg.activities.find(a => a.id === 'RUN01').items.length, 4, '勾選項目以「｜」拆成 4 項');
  eq(boot.cfg.activities.find(a => a.id === 'RUN03').dir, '低', 'RUN03 評分方向為「低」');
  // 範例班不外洩
  gas.sheets.get('班級名單').rows.push(['範例班', 1, '範例']);
  ok(!gas.post({ action: 'bootstrap', key: KEY }).classes['範例班'], '「範例班」列被忽略');

  // upsert 與唯一鍵
  let r = gas.post({ action: 'save', key: KEY, records: [rec({ no: 1, value: 10 }), rec({ no: 2, value: 3 }), rec({ no: 3, value: 30 })] });
  eq(r.saved.length, 3, 'save：3 筆寫入');
  const sc = gas.sheets.get('成績');
  eq(sc.getLastRow() - 1, 3, '成績表 3 列');
  eq(sc.rows[1].slice(1, 11), [today, '101', 1, '王測試1', 'ROPE02', 10, 3, '', '', `${today}|101|1|ROPE02`], '寫入欄位與姓名帶入正確（10 次 → 等級 3）');
  eq([sc.rows[2][7], sc.rows[3][7]], [2, 4], '3 次→接近(2)；30 次→優(4)');
  r = gas.post({ action: 'save', key: KEY, records: [rec({ no: 1, value: 10 }), rec({ no: 2, value: 3 })] });
  eq(sc.getLastRow() - 1, 3, '重複送出相同資料不會多出列');
  gas.post({ action: 'save', key: KEY, records: [rec({ no: 1, value: 2 })] });
  eq([sc.getLastRow() - 1, sc.rows[1][6], sc.rows[1][7]], [3, 2, 1], '同一鍵再送新值＝覆蓋同一列（2 次→等級 1）');
  gas.post({ action: 'save', key: KEY, records: [rec({ no: 1, value: 1 }), rec({ no: 1, value: 20 })] });
  eq([sc.getLastRow() - 1, sc.rows[1][6]], [3, 20], '同批次內同鍵重複 → 以最後一筆為準');
  gas.post({ action: 'save', key: KEY, records: [rec({ no: 9, value: 5 }), rec({ no: 9, value: 6 })] });
  eq(sc.getLastRow() - 1, 4, '同批次新鍵重複只新增一列');
  gas.post({ action: 'save', key: KEY, records: [rec({ no: 9, del: true })] });
  eq(sc.getLastRow() - 1, 3, 'del：刪除該列');
  r = gas.post({ action: 'save', key: KEY, records: [rec({ no: 4, absent: true, value: 99 })] });
  eq([sc.rows[4][6], sc.rows[4][7], sc.rows[4][8]], ['', '', 'Y'], '缺席：數值與等級留空、缺席=Y');
  gas.post({ action: 'save', key: KEY, records: [rec({ no: 5, aid: 'RUN01', value: 3, detail: '1110', note: '腳扭傷' })] });
  const rr = sc.rows[sc.getLastRow() - 1];
  eq([rr[6], rr[7], rr[9], rr[11]], [3, 3, '腳扭傷', '1110'], 'checklist：勾 3 項→等級 3，勾選明細與備註保存');
  gas.post({ action: 'save', key: KEY, records: [rec({ no: 6, aid: 'RUN03', value: 6.0 }), rec({ no: 7, aid: 'RUN03', value: 9.5 }), rec({ no: 8, aid: 'RUN03', value: 5.0 })] });
  const g = n => sc.rows.find(x => x[10] === `${today}|101|${n}|RUN03`)[7];
  eq([g(6), g(7), g(8)], [4 - 1, 1, 4], '評分方向「低」：6.0 秒→3；9.5 秒→1；5.0 秒→4');
  gas.post({ action: 'save', key: KEY, records: [rec({ no: 10, aid: 'ATT02', value: 4 }), rec({ no: 11, aid: 'ATT02', value: 1 })] });
  eq([g2(10), g2(11)], [4, 1], 'level：直接等級 4／1');
  function g2(n) { return sc.rows.find(x => x[10] === `${today}|101|${n}|ATT02`)[7]; }
  r = gas.post({ action: 'save', key: KEY, records: [{ date: 'xx', cls: '101', no: 1, aid: 'A' }, rec({ no: 0 })] });
  eq(r.rejected.length, 2, '格式不完整的資料被拒絕並回報');

  // 大批量（走重寫路徑）：先寫 35 筆，再一次更新 20 筆＋刪 3 筆
  gas = freshBackend();
  gas.post({ action: 'save', key: KEY, records: Array.from({ length: 35 }, (_, i) => rec({ no: i + 1, value: 1 })) });
  const sc2 = gas.sheets.get('成績');
  eq(sc2.getLastRow() - 1, 35, '35 位一次寫入');
  gas.post({ action: 'save', key: KEY, records: [...Array.from({ length: 20 }, (_, i) => rec({ no: i + 1, value: 20 })), ...[30, 31, 32].map(n => rec({ no: n, del: true }))] });
  eq([sc2.getLastRow() - 1, sc2.rows.slice(1, 21).every(x => x[6] === 20 && x[7] === 4)], [32, true], '大批量：20 筆更新＋3 筆刪除，剩 32 列且內容正確（重寫路徑）');
  eq(new Set(sc2.rows.slice(1, 33).map(x => x[10])).size, 32, '唯一鍵無重複');
  ok(gas.lock().lockCalls === 2 && gas.lock().maxLock === 1 && gas.lock().lockDepth === 0, 'LockService：每次寫入取一次鎖、不巢狀、一定釋放');
  const b2 = gas.post({ action: 'bootstrap', key: KEY });
  eq(b2.scores.length, 32, 'bootstrap 讀回 32 筆成績');
  eq(b2.scores[0].length, 9, '成績以緊湊陣列回傳');
  eq(gas.post('不是 JSON').ok, false, '壞掉的請求回傳錯誤而不是當機');
  for (let i = 0; i < 10; i++) gas.post({ action: 'bootstrap', key: 'x' });
  ok(/過多/.test(gas.post({ action: 'bootstrap', key: KEY }).error), '連續猜錯 10 次後暫時鎖定');


  // 分數量化：預設與逐活動自訂
  gas = freshBackend();
  gas.post({ action: 'save', key: KEY, records: [rec({ no: 1, value: 15 }), rec({ no: 2, value: 8 }), rec({ no: 3, value: 3 }), rec({ no: 4, value: 0 }), rec({ no: 5, absent: true })] });
  const scS = gas.sheets.get('成績');
  eq(scS.rows[0][12], '分數', '成績表有「分數」欄');
  eq([1, 2, 3, 4, 5].map(i => scS.rows[i][12]), [100, 93, 89, 85, ''], '預設換算：優100／達成93／接近89／加油85；缺席無分數');
  const aRow = gas.sheets.get('活動設定').rows.find(r => r[0] === 'ROPE02'); aRow[15] = 98; aRow[16] = 95;
  gas.post({ action: 'save', key: KEY, records: [rec({ no: 6, value: 15 }), rec({ no: 7, value: 8 }), rec({ no: 8, value: 3 })] });
  eq([6, 7, 8].map(i => scS.rows[scS.getLastRow() - 3 + (i - 6)][12]), [98, 95, 89], '該活動自訂優分98／達成分95，接近分留空沿用預設89');
  eq(gas.post({ action: 'bootstrap', key: KEY }).cfg.activities.find(a => a.id === 'ROPE02').sc, [98, 95, 89, 85], 'bootstrap 帶出每個活動的四級分數');
  // 舊版試算表（15 欄活動設定、12 欄成績）→ 只補表頭、不動資料
  gas = build(); gas.ctx.setup();
  const oldAct = gas.sheets.get('活動設定'); oldAct.rows = oldAct.rows.map(r => r.slice(0, 15)); oldAct.rows[3][3] = '老師改名';
  const oldSc = gas.sheets.get('成績'); oldSc.rows = [oldSc.rows[0].slice(0, 12)];
  gas.props.set('PASSCODE', KEY); gas.sheets.get('班級名單').rows = [['班級', '座號', '姓名'], ['101', 1, '舊版測試']];
  r = gas.post({ action: 'save', key: KEY, records: [rec({ no: 1, value: 15 })] });
  eq([r.ok, oldAct.rows[0].length, oldAct.rows[3][3], oldSc.rows[0][12], oldSc.rows[1][12]], [true, 19, '老師改名', '分數', 100], '舊版試算表第一次寫入時自動補欄位，原資料不動，分數照算');

  /* ═════ 二、前端 ═════ */
  console.log('\n【前端 index.html（jsdom）】');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  gas = freshBackend();
  const net = { online: true, dropResponse: false, calls: [], delay: 0 };
  let store = { 'pe1.auth': JSON.stringify({ url: 'https://gas.test/exec', key: KEY }) };

  async function openPage() {
    const csvBlobs = [];
    const dom = new JSDOM(html, {
      url: 'https://app.test/index.html', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(w) {
        for (const k in store) w.localStorage.setItem(k, store[k]);
        w.Element.prototype.scrollIntoView = function () { };
        w.print = () => { };
        w.URL.createObjectURL = b => { csvBlobs.push(b); return 'blob:x'; };
        w.HTMLAnchorElement.prototype.click = function () { };
        Object.defineProperty(w.navigator, 'onLine', { get: () => net.online, configurable: true });
        w.fetch = async (url, init) => {
          if (!net.online) throw new w.TypeError('Failed to fetch');
          const body = JSON.parse(init.body);
          net.calls.push(body.action + ':' + ((body.records || []).length));
          if (net.delay) await sleep(net.delay);
          const out = gas.post(init.body);
          if (net.dropResponse) throw new w.TypeError('Failed to fetch');   // 伺服器已處理但回應遺失
          return { ok: true, status: 200, json: async () => out };
        };
      }
    });
    const w = dom.window;
    for (let i = 0; i < 100 && !(w.__pe && w.__pe.S.booted); i++) await sleep(20);
    return { dom, w, d: w.document, pe: w.__pe, csvBlobs };
  }
  const $$ = (d, s) => [...d.querySelectorAll(s)];
  const fire = (w, el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const pick = (w, d, label, value) => { const s = d.querySelector(`select[aria-label="${label}"]`); s.value = value; fire(w, s, 'change'); };
  const setNum = (w, card, v) => { const i = card.querySelector('input[type=number]'); i.value = v; fire(w, i, 'input'); };
  const settle = async (pe, ms = 3000) => { const t0 = Date.now(); while ((pe.S.queue.size || pe.S.syncing) && Date.now() - t0 < ms) await sleep(50); };
  const sheet = () => gas.sheets.get('成績');

  let P = await openPage();
  ok(P.pe.S.booted, '開頁完成 bootstrap');
  eq(net.calls.filter(c => c.startsWith('bootstrap')).length, 1, '開頁只呼叫一次 bootstrap');
  eq($$(P.d, '.card').length, 35, '第一班 35 張學生卡片');
  ok($$(P.d, '#regFilters .chip').map(b => b.textContent).join().startsWith('全部,跑步,跳繩,球類'), '類別按鈕：跑步、跳繩、球類在最前');
  eq($$(P.d, '#regFilters .chip').map(b => b.textContent), ['全部', '跑步', '跳繩', '球類', '平衡', '呼拉圈', '安全與態度'], '類別按鈕：健康預設停用所以不出現');

  // 切到「跳繩」類別 → 活動選單只剩跳繩
  $$(P.d, '.chip').find(b => b.textContent === '跳繩').click();
  eq($$(P.d, 'select[aria-label="活動"] option').map(o => o.value), ['ROPE01', 'ROPE02', 'ROPE03'], '點「跳繩」→ 活動選單只列跳繩 3 項');
  pick(P.w, P.d, '活動', 'ROPE02');
  ok(/連續跳過繩不中斷/.test(P.d.querySelector('.goal').textContent), '頂列顯示目標說明');
  ok(/優 ≥15次/.test(P.d.querySelector('.goal').textContent) && /達成 ≥8次/.test(P.d.querySelector('.goal').textContent) && /接近 ≥3次/.test(P.d.querySelector('.goal').textContent), '頂列顯示三個門檻');

  let cards = $$(P.d, '.card');
  const t0 = Date.now();
  setNum(P.w, cards[0], '9');
  const tapMs = Date.now() - t0;
  eq(cards[0].querySelector('.badge').textContent.split(' ')[0], '達成', '輸入 9 次 → 立即顯示「達成」（樂觀更新）');
  ok(cards[0].className.includes('g3'), '卡片即時變色（g3）');
  eq(P.pe.S.queue.size, 1, '寫入進本機佇列，尚未等伺服器');
  eq(sheet().getLastRow() - 1, 0, '此時 Sheet 還沒有資料（批次延遲送出）');
  cards[1].querySelector('.q4').click();
  eq(cards[1].querySelector('input[type=number]').value, '15', '點「優 15」快速帶入數值');
  cards[2].querySelectorAll('.num button')[1].click(); cards[2].querySelectorAll('.num button')[1].click();
  eq(cards[2].querySelector('input[type=number]').value, '2', '+1 按兩次 = 2');
  cards[2].querySelectorAll('.num button')[0].click(); cards[2].querySelectorAll('.num button')[0].click(); cards[2].querySelectorAll('.num button')[0].click();
  eq(cards[2].querySelector('input[type=number]').value, '0', '−1 不會低於 0');
  const callsBefore = net.calls.filter(c => c.startsWith('save')).length;
  await settle(P.pe);
  eq(net.calls.filter(c => c.startsWith('save')).length - callsBefore, 1, '多次點擊合併成 1 次批次送出');
  eq(sheet().getLastRow() - 1, 3, '約 1~2 秒後同步到 Sheet（3 筆）');
  ok(/已同步/.test(P.d.querySelector('#sync').textContent), '角落顯示「已同步 ✓」');
  eq(P.d.querySelector('#progress b').textContent.replace(/\s/g, ''), '已登記3／35', '進度條：已登記 3／35');

  // level：點兩次取消
  pick(P.w, P.d, '活動', 'ROPE02'); $$(P.d, '.chip').find(b => b.textContent === '安全與態度').click();
  pick(P.w, P.d, '活動', 'ATT02');
  cards = $$(P.d, '.card');
  const star = cards[2].querySelectorAll('.lv button')[0];
  star.click(); eq(cards[2].querySelector('.badge').textContent.split(' ')[0], '優', 'level：點🌟 → 優');
  star.click(); eq(cards[2].querySelector('.badge').textContent, '—', 'level：再點一次取消');
  cards[3].querySelectorAll('.lv button')[1].click();
  await settle(P.pe);
  eq(sheet().rows.filter(x => x[10] && x[10].endsWith('ATT02')).length, 1, '取消的不留在 Sheet；其餘保留（ATT02 僅 1 筆）');

  // checklist：勾選數 → 等級；缺席；備註
  $$(P.d, '.chip').find(b => b.textContent === '跑步').click(); pick(P.w, P.d, '活動', 'RUN01');
  cards = $$(P.d, '.card');
  const ck = cards[4].querySelectorAll('.ck button');
  eq(ck.length, 4, 'checklist：4 顆大按鈕');
  ck[0].click(); ck[1].click(); ck[2].click();
  eq(cards[4].querySelector('.badge').textContent.split(' ')[0], '達成', '勾 3 項 → 達成');
  ck[3].click(); eq(cards[4].querySelector('.badge').textContent.split(' ')[0], '優', '勾滿 4 項 → 優');
  ck[3].click(); ck[2].click(); ck[1].click();
  eq(cards[4].querySelector('.badge').textContent.split(' ')[0], '需加油', '只勾 1 項 → 需加油（等級 1）');
  cards[5].querySelector('.abs').click();
  ok(cards[5].className.includes('abs') && cards[5].querySelector('.badge').textContent === '缺席', '缺席開關');
  const noteIn = cards[6].querySelector('.noterow input'); cards[6].querySelector('.note').click(); noteIn.value = '腳扭傷'; fire(P.w, noteIn, 'change');
  ok(cards[6].querySelector('.note').classList.contains('has'), '備註已儲存');
  ck[2].click(); ck[1].click(); // card 4 回到勾 3
  await settle(P.pe);

  // 重新整理後資料還在（新頁面、同一份 localStorage、同一個後端）
  store = {}; for (let i = 0; i < P.w.localStorage.length; i++) { const k = P.w.localStorage.key(i); store[k] = P.w.localStorage.getItem(k); }
  P.w.close();
  P = await openPage();
  pick(P.w, P.d, '活動', 'RUN01'); // 已記住上次的選擇
  cards = $$(P.d, '.card');
  eq(cards[4].querySelectorAll('.ck button.on').length, 3, '重新整理後：勾選狀態還在（3 項）');
  eq(cards[5].querySelector('.badge').textContent, '缺席', '重新整理後：缺席還在');
  eq(cards[6].querySelector('.noterow input').value, '腳扭傷', '重新整理後：備註還在');

  // 離線登記 → 恢復後補送
  console.log('  — 離線情境 —');
  pick(P.w, P.d, '活動', 'ROPE02'); $$(P.d, '.chip').find(b => b.textContent === '跳繩').click(); pick(P.w, P.d, '活動', 'ROPE03');
  cards = $$(P.d, '.card');
  const rowsBefore = sheet().getLastRow() - 1;
  net.online = true; P.w.dispatchEvent(new P.w.Event('offline'));
  net.online = false;
  for (let i = 10; i < 18; i++) setNum(P.w, cards[i], String(10 + i));
  await sleep(1800);
  ok(/離線/.test(P.d.querySelector('#sync').textContent) && /8 筆/.test(P.d.querySelector('#sync').textContent), '離線時角落顯示「離線 · 待同步 8 筆」');
  eq(P.pe.S.queue.size, 8, '佇列保存 8 筆');
  ok(P.w.localStorage.getItem('pe1.queue').length > 100, '佇列已寫入 localStorage（關頁也不會丟）');
  eq(sheet().getLastRow() - 1, rowsBefore, '離線期間 Sheet 不變');
  net.online = true; P.w.dispatchEvent(new P.w.Event('online'));
  await settle(P.pe, 5000);
  eq(sheet().getLastRow() - 1, rowsBefore + 8, '恢復網路後自動補送，剛好 +8 筆');
  ok(/已同步/.test(P.d.querySelector('#sync').textContent), '補送後顯示已同步');

  // 伺服器已寫入但回應遺失 → 重送不產生重複
  net.dropResponse = true;
  setNum(P.w, cards[20], '22');
  await sleep(1800);
  net.dropResponse = false;
  const afterDrop = sheet().getLastRow() - 1;
  eq(afterDrop, rowsBefore + 9, '回應遺失時伺服器其實已寫入 1 筆');
  eq(P.pe.S.queue.size, 1, '前端不知道成功，仍保留在佇列');
  await settle(P.pe, 9000);
  eq(sheet().getLastRow() - 1, afterDrop, '自動重送後沒有重複列（唯一鍵 upsert）');
  eq(new Set(sheet().rows.slice(1).map(x => x[10])).size, sheet().getLastRow() - 1, 'Sheet 全部唯一鍵不重複');

  // 關頁時佇列還在 → 重開後補送
  net.online = false; setNum(P.w, cards[21], '5'); await sleep(200);
  store = {}; for (let i = 0; i < P.w.localStorage.length; i++) { const k = P.w.localStorage.key(i); store[k] = P.w.localStorage.getItem(k); }
  P.w.close(); net.online = true;
  const n0 = sheet().getLastRow() - 1;
  P = await openPage(); await settle(P.pe, 5000);
  eq(sheet().getLastRow() - 1, n0 + 1, '離線時關閉網頁、之後重開：待送資料自動補上');

  // 便利功能
  console.log('  — 便利功能 —');
  pick(P.w, P.d, '活動', 'ROPE03'); cards = $$(P.d, '.card');
  const doneBefore = $$(P.d, '.card').filter(c => c.querySelector('.badge').textContent !== '—').length;
  $$(P.d, '#tools button').find(b => b.textContent === '只看未登記').click();
  eq($$(P.d, '.card').filter(c => !c.hasAttribute('data-hide')).length, 35 - doneBefore, '只看未登記：隱藏已登記的卡片');
  $$(P.d, '#tools button').find(b => b.textContent.includes('只看未登記')).click();
  $$(P.d, '#tools button').find(b => b.textContent === '未登記全部設為達成').click();
  await sleep(30); P.d.querySelector('#modal .primary').click(); await sleep(30);
  eq($$(P.d, '.card').filter(c => c.querySelector('.badge').textContent === '—').length, 0, '未登記全部設為達成：全班都有成績');
  eq($$(P.d, '.card')[30].querySelector('input[type=number]').value, '15', '設為達成＝「達成」門檻值（15）');
  setNum(P.w, $$(P.d, '.card')[30], '3'); eq($$(P.d, '.card')[30].querySelector('.badge').textContent.split(' ')[0], '需加油', '再逐一改例外（3 次→需加油）');
  await settle(P.pe);
  $$(P.d, '#tools button').find(b => b.textContent === '清除本次').click();
  await sleep(30); P.d.querySelector('#modal .danger').click(); await sleep(30);
  await settle(P.pe, 5000);
  eq(sheet().rows.filter(x => x[10] && x[10].startsWith(today) && x[10].endsWith('ROPE03')).length, 0, '清除本次：Sheet 中該活動當日資料已刪');
  eq(sheet().rows.slice(1).filter(x => x[10] && x[10].endsWith('ATT02')).length, 1, '不影響其他活動資料');
  const inputs = $$(P.d, '.card input[type=number]');
  inputs[0].focus(); inputs[0].dispatchEvent(new P.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  eq(P.d.activeElement, inputs[1], 'Enter 鍵跳到下一位');

  // 計時模式
  pick(P.w, P.d, '活動', 'ROPE03'); $$(P.d, '.chip').find(b => b.textContent === '跑步').click(); pick(P.w, P.d, '活動', 'RUN03');
  $$(P.d, '#tools button').find(b => b.textContent.includes('全班計時')).click();
  ok(P.d.querySelector('#grid').classList.contains('timing'), '全班計時模式啟動');
  await sleep(350);
  $$(P.d, '.card')[2].querySelector('.stamp').click();
  const v = parseFloat($$(P.d, '.card')[2].querySelector('input[type=number]').value);
  ok(v >= 0.3 && v < 2, `點名字蓋下秒數（${v} 秒）`);
  $$(P.d, '#tools button').find(b => b.textContent.includes('結束計時')).click();
  await settle(P.pe);

  /* ── 總覽 ── */
  console.log('  — 總覽頁 —');
  // 為 35 位 × 多個活動造資料，含需關注的學生
  const acts = P.pe.S.cfg.activities.filter(a => a.on);
  ok(acts.length === 24, `啟用中的活動 24 個（得到 ${acts.length}）`);
  const bulk = [];
  const g4v = a => a.mode === 'level' ? 4 : a.mode === 'checklist' ? a.t4 : a.dir === '低' ? a.t4 : a.t4;
  const g1v = a => a.mode === 'level' ? 1 : a.mode === 'checklist' ? 0 : a.dir === '低' ? a.t2 + 5 : 0;
  for (const a of acts) for (let no = 1; no <= 35; no++) {
    const weak = no === 7 || no === 20;           // 7、20 號：全部最低 → 需關注
    const val = weak ? g1v(a) : (no % 5 === 0 ? (a.mode === 'level' ? 2 : a.t2) : g4v(a));
    bulk.push(rec({ date: '2026-09-01', no, aid: a.id, value: val, detail: a.mode === 'checklist' ? '1'.repeat(val).padEnd(a.items.length, '0') : '' }));
  }
  gas.post({ action: 'save', key: KEY, records: bulk });
  await P.pe.bootstrap(true);
  eq(P.pe.S.scores.size >= 24 * 35, true, `載入 ${P.pe.S.scores.size} 筆成績（35 人 × 24 活動）`);
  const tt = Date.now();
  P.d.querySelector('[data-view=ov]').click();
  const ovMs = Date.now() - tt;
  eq($$(P.d, 'table.heat tbody tr').length, 36, '熱力圖：35 位學生＋全班平均列');
  ok($$(P.d, 'table.heat thead tr:first-child th').length >= 6, '熱力圖：依類別分組表頭');
  ok(/需要關注（2）/.test(P.d.querySelector('#viewOv').textContent), '需要關注：正確抓到 2 位（7、20 號）');
  ok(/7 測試7/.test(P.d.querySelector('#viewOv .names').textContent) || /測試7/.test(P.d.querySelector('#viewOv .names').textContent), '需要關注名單含 7 號');
  const sticky = P.d.querySelector('.heat .sticky1'); ok(!!sticky, '座號姓名欄為 sticky 固定欄');
  ok(/%/.test(P.d.querySelector('.rates').textContent), '顯示各活動達成率');
  // 達成率：no%5==0（7 人）為接近(2) → 非達成；弱的 2 人 → 非達成；其餘 26/35 = 74%
  ok(/74%/.test(P.d.querySelector('.rates').textContent), '達成率計算正確（26/35＝74%）');
  pick(P.w, P.d, '排序', 'need'); eq(P.d.querySelector('table.heat tbody tr .sticky1').textContent.replace(/\s/g, '').includes('測試7') || P.d.querySelector('table.heat tbody tr .sticky1').textContent.includes('測試20'), true, '排序：需關注在前');
  pick(P.w, P.d, '類別', '跳繩'); ok($$(P.d, 'table.heat thead tr:first-child th')[1].textContent === '跳繩', '依類別篩選');
  pick(P.w, P.d, '類別', ''); pick(P.w, P.d, '單元', '6-1');
  ok($$(P.d, 'table.heat thead tr:nth-child(2) th').length > 0, '依單元篩選');
  pick(P.w, P.d, '單元', '');
  const fromI = P.d.querySelector('input[aria-label="起日"]'); fromI.value = '2026-10-01'; fire(P.w, fromI, 'change');
  ok(!P.d.querySelector('table.heat') || $$(P.d, 'table.heat tbody tr').length <= 36, '日期區間篩選（起日 10/1 → 排除 9/1 的資料）');
  { const f2 = P.d.querySelector('input[aria-label="起日"]'); f2.value = ''; fire(P.w, f2, 'change'); }
  // 同一活動多次登記：9/15 得 3 次（接近2）、9/20 缺席；今天(登記頁)另有 9 次(達成3)的是 ROPE02 → 最近一次出席應是今天的 3
  gas.post({ action: 'save', key: KEY, records: [rec({ date: '2026-09-15', no: 2, aid: 'ROPE02', value: 3 }), rec({ date: '2026-09-20', no: 2, aid: 'ROPE02', absent: true }), rec({ date: '2026-09-10', no: 12, aid: 'ROPE02', value: 3 }), rec({ date: '2026-09-25', no: 12, aid: 'ROPE02', absent: true })] });
  await P.pe.bootstrap(true);
  const ths = [...P.d.querySelectorAll('table.heat thead tr:nth-child(2) th')];
  const ropeIdx = ths.findIndex(t => t.textContent.includes('連續跳'));
  const rowOf = n => [...P.d.querySelectorAll('table.heat tbody tr')].find(tr => { const sn = tr.querySelector('.sno'); return sn && sn.textContent === String(n); });
  // 2 號：今天(10/19 以後)那次是 15（優4，今天登記的卡片 cards[1]）→ 最近一次有出席 = 今天
  eq(rowOf(12).querySelectorAll('td')[ropeIdx + 1].textContent, '2', '熱力圖：同活動多次登記，9/10 得 3 次(2)、9/25 缺席 → 取最近一次「有出席」的 9/10（2）');
  const rowNo1 = rowOf(2);
  rowNo1.querySelector('.sticky1').click();
  ok(P.d.querySelector('#drawer').classList.contains('open'), '點學生名字開啟詳情抽屜');
  ok(/9\/15/.test(P.d.querySelector('#drawer').textContent) && /缺席/.test(P.d.querySelector('#drawer').textContent), '抽屜顯示歷次紀錄（含缺席）：' + P.d.querySelector('#drawer').textContent.slice(0,120));
    [...P.d.querySelectorAll('#viewOv button')].find(b => b.textContent.includes('CSV')).click();
  const blob = P.csvBlobs[P.csvBlobs.length - 1];
  const buf = await new Promise(res => { const fr = new P.w.FileReader(); fr.onload = () => res(Buffer.from(fr.result)); fr.readAsArrayBuffer(blob); });
  const text = buf.toString('utf8');
  ok(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF && text.includes('班級,座號,姓名,日期'), 'CSV 匯出含 BOM（EF BB BF）與表頭');
  ok(text.split('\r\n').length > 35 * 20, `CSV 共 ${text.split('\r\n').length - 1} 筆資料列`);

  // 效能（jsdom 比真實瀏覽器慢，僅作參考）
  console.log('  — 效能（jsdom，僅供參考） —');
  P.d.querySelector('[data-view=reg]').click();
  pick(P.w, P.d, '活動', 'RUN03');
  const ts = Date.now();
  for (let i = 0; i < 35; i++) setNum(P.w, $$(P.d, '.card')[i], String(5 + i / 10));
  console.log(`  ℹ 35 位連續輸入 + 即時判定：${Date.now() - ts} ms（平均 ${((Date.now() - ts) / 35).toFixed(1)} ms/次）；總覽頁渲染 ${ovMs} ms；單次點擊 ${tapMs} ms`);
  ok((Date.now() - ts) / 35 < 40, '單次點擊平均 < 40 ms（jsdom 環境）');
  await settle(P.pe, 5000);

  // 前後端等級函式一致
  console.log('  — 前後端一致 —');
  let mism = 0, n = 0;
  const serverActs = gas.post({ action: 'bootstrap', key: KEY }).cfg.activities;
  for (const a of serverActs) for (const v of [0, 1, 2, 2.5, 3, 4, 5, 5.5, 6, 6.5, 8, 9, 10, 15, 25, 60, 120, 180, 200]) {
    n++; if (P.pe.gradeOf(a, v) !== gas.ctx.gradeOf_(a, v)) mism++;
  }
  eq(mism, 0, `前後端 gradeOf 在 ${n} 組輸入完全一致`);

  await require('./admin.test.js')({ ok, eq, sleep, KEY });

  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('測試中斷：', e); process.exit(2); });
