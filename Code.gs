/**
 * 國小一年級體育課成績登記 — 後端 (Google Apps Script)
 *
 * 使用方式：在 Google Sheet 的「擴充功能 → Apps Script」貼上本檔，執行 setup()，再部署為網頁應用程式。
 * 所有資料都存在這份試算表；學生姓名只留在試算表，不會寫進網站程式碼。
 *
 * 分頁：班級名單（您自己填）／活動設定（可隨時增刪改）／成績（網站寫入）／單元一覽
 */

var TZ = 'Asia/Taipei';
var SHEETS = { roster: '班級名單', act: '活動設定', score: '成績', unit: '單元一覽' };
var H_ROSTER = ['班級', '座號', '姓名'];
var H_ACT = ['活動ID', '類別', '單元', '活動名稱', '圖示', '登記方式', '單位', '評分方向', '目標說明',
  '勾選項目', '優(4)', '達成(3)', '接近(2)', '啟用', '來源', '優分', '達成分', '接近分', '加油分'];
var H_SCORE = ['時間戳', '日期', '班級', '座號', '姓名', '活動ID', '原始數值', '等級', '缺席', '備註', '唯一鍵', '勾選明細', '分數'];
// 等級換算成績（落在 85–100 分）。活動設定的「優分／達成分／接近分／加油分」留空時用這組預設值。
var DEFAULT_SCORES = [100, 93, 89, 85];
var H_UNIT = ['單元', '主題', '教案名稱'];
var EXAMPLE_CLASS = '範例班';
var DEFAULT_DAYS = 240;

/* ───────────────────────── 預設資料 ───────────────────────── */

// [單元, 主題, 教案名稱]；體育教案 8 主題 10 單元，健康教案 5 主題 10 單元（單元代號前加「健」）
var DEFAULT_UNITS = [
  ['1-1', '走跑跳', '快樂走跑跳'], ['1-2', '走跑跳', '跑一跑，動一動'],
  ['2-1', '新生進行曲', '新生進行曲'], ['3-1', '反應高手', '反應高手'],
  ['4-1', '全身動一動', '全身動一動'], ['5-1', '呼拉圈', '呼拉圈'], ['5-2', '呼拉圈', '呼拉圈接龍'],
  ['6-1', '氣球', '氣球好好玩'], ['7-1', '平衡木', '我是平衡高手'], ['8-1', '飛盤', '玩飛盤'],
  ['健1-1', '新生入學', '健康又安全'], ['健1-2', '新生入學', '新生進行曲'],
  ['健2-1', '性教育', '小心!危險'], ['健2-2', '性教育', '自我保護小勇士'],
  ['健3-1', '口耳鼻保健與衛生', '保護身體好健康'], ['健3-2', '口耳鼻保健與衛生', '我真的很不錯'],
  ['健4-1', '個人衛生', '健康超能力'], ['健4-2', '個人衛生', '健康防護罩'],
  ['健5-1', '飲食均衡', '營養的食物'], ['健5-2', '飲食均衡', '健康飲食聰明吃']
];

function A_(id, cat, unit, name, icon, mode, uom, dir, goal, items, t4, t3, t2, src) {
  return [id, cat, unit, name, icon, mode, uom, dir, goal, items, t4, t3, t2, 'Y', src, '', '', '', ''];
}
function health_(id, unit, name, icon) {
  return [id, '健康', unit, name, icon, 'level', '', '', '依教案「' + name + '」的學習重點，評估學生整體表現',
    '', '', '', '', 'N', '教案', '', '', '', ''];
}

// 所有門檻皆為暫定建議值，不是教案原文，可依班級實際情況調整。
var DEFAULT_ACTIVITIES = [
  A_('RUN01', '跑步', '1-1', '走跑跳基本動作', '🚶', 'checklist', '項', '高', '走、跑、跳三種動作正確，且能依指令轉換', '走路正確｜跑步正確｜雙腳跳與單腳跳正確｜能依指令轉換', 4, 3, 2, '教案'),
  A_('RUN02', '跑步', '1-1', '方向與速度變化', '🧭', 'checklist', '項', '高', '能做出前後側向與快慢變化', '前後側向移動｜快慢變化｜hop/skip/jump｜模仿動物走路', 4, 3, 2, '教案'),
  A_('RUN03', '跑步', '', '20 公尺直線快跑', '🏃', 'time', '秒', '低', '在目標秒數內跑完 20 公尺', '', 5.5, 6.5, 8.0, '自訂'),
  A_('RUN04', '跑步', '', '持續跑', '⏱️', 'time', '秒', '高', '不停下來連續跑（可穿插慢跑）', '', 180, 120, 60, '自訂'),
  A_('RUN05', '跑步', '3-1', '急停反應（急凍舞、大魔鏡）', '🛑', 'checklist', '項', '高', '聽指令急停，並做出蹲下、跳躍、轉向', '聽指令迅速急停｜依指令蹲下跳躍轉向｜能模仿同學動作｜遵守遊戲規則', 4, 3, 2, '教案'),
  A_('RUN06', '跑步', '3-1', '鬼抓人與折返', '👻', 'checklist', '項', '高', '能起跑、閃躲、折返並依狀況調整策略', '快速起跑｜轉向折返｜遵守規則不推擠｜依狀況改變策略', 4, 3, 2, '教案'),

  A_('ROPE01', '跳繩', '', '跳繩動作分解', '✋', 'checklist', '項', '高', '握繩、搖繩、落地動作都正確', '握繩正確｜用手腕搖繩｜雙腳併攏輕巧落地｜視線向前', 4, 3, 2, '自訂'),
  A_('ROPE02', '跳繩', '', '連續跳（不失誤）', '➰', 'count', '次', '高', '連續跳過繩不中斷', '', 15, 8, 3, '自訂'),
  A_('ROPE03', '跳繩', '', '30 秒跳繩', '⏲️', 'count', '次', '高', '30 秒內跳過繩的總次數', '', 25, 15, 5, '自訂'),

  A_('BALL01', '球類', '6-1', '連續擊飛氣球', '🎈', 'count', '次', '高', '用手連續擊飛氣球不落地', '', 10, 5, 2, '教案'),
  A_('BALL02', '球類', '6-1', '身體部位擊飛氣球', '🎈', 'checklist', '項', '高', '用不同身體部位擊飛並接住', '頭｜膝蓋｜手臂與肩膀｜腳', 4, 3, 2, '教案'),
  A_('BALL03', '球類', '6-1', '兩人氣球互打', '🤝', 'count', '次', '高', '兩人連續互擊不落地', '', 8, 4, 2, '教案'),
  A_('BALL04', '球類', '4-1', '沙包拋接', '🤲', 'count', '次', '高', '拋 10 次，接住次數', '', 8, 5, 3, '教案'),
  A_('BALL05', '球類', '4-1', '沙包投準', '🎯', 'count', '次', '高', '投 5 次，投入指定圈的次數', '', 4, 3, 1, '教案'),
  A_('BALL06', '球類', '8-1', '飛盤反手投擲動作', '🥏', 'checklist', '項', '高', '反手投擲動作正確且能控制力道方向', '反手握盤｜側身站姿｜手臂與手腕送出｜控制方向與力道', 4, 3, 2, '教案'),
  A_('BALL07', '球類', '8-1', '飛盤投準', '🎯', 'count', '次', '高', '投 5 次，打中目標物的次數', '', 3, 2, 1, '教案'),
  A_('BALL08', '球類', '', '原地連續拍球', '🏀', 'count', '次', '高', '原地連續拍球不失誤', '', 10, 5, 2, '自訂'),

  A_('BAL01', '平衡', '7-1', '單腳站立', '🦩', 'time', '秒', '高', '穩定單腳站立（以較弱的那隻腳為準）', '', 10, 5, 3, '教案'),
  A_('BAL02', '平衡', '7-1', '平衡木行走', '⚖️', 'checklist', '項', '高', '在平衡木上穩定行走並完成挑戰', '前進走完不落地｜後退或蟹步｜通過障礙物｜頭頂三角錐走完', 4, 3, 2, '教案'),

  A_('HULA01', '呼拉圈', '5-1', '跳呼拉圈', '⭕', 'checklist', '項', '高', '依指令跳進、跳出、左右', '跳進跳出｜左右跳｜聽指令轉換動作', 3, 2, 1, '教案'),
  A_('HULA02', '呼拉圈', '5-1', '手臂轉呼拉圈', '🌀', 'time', '秒', '高', '讓呼拉圈在手臂上持續轉動', '', 10, 5, 3, '教案'),
  A_('HULA03', '呼拉圈', '5-2', '呼拉圈接龍（團體合作）', '🤝', 'level', '', '', '能與同學合作完成接龍', '', '', '', '', '教案'),

  A_('ATT01', '安全與態度', '2-1', '遊戲場安全與規則', '🏫', 'checklist', '項', '高', '認識設施、守規則、正確操作', '認識設施名稱｜遵守規則與排隊｜正確操作設施｜能分辨安全與不安全', 4, 3, 2, '教案'),
  A_('ATT02', '安全與態度', '', '上課態度', '🙋', 'level', '', '', '專注聆聽、守規矩、合作', '', '', '', '', '自訂'),

  health_('HLT01', '健1-1', '健康又安全', '🩺'), health_('HLT02', '健1-2', '新生進行曲', '🎒'),
  health_('HLT03', '健2-1', '小心!危險', '⚠️'), health_('HLT04', '健2-2', '自我保護小勇士', '🛡️'),
  health_('HLT05', '健3-1', '保護身體好健康', '👂'), health_('HLT06', '健3-2', '我真的很不錯', '😊'),
  health_('HLT07', '健4-1', '健康超能力', '💪'), health_('HLT08', '健4-2', '健康防護罩', '🧼'),
  health_('HLT09', '健5-1', '營養的食物', '🥦'), health_('HLT10', '健5-2', '健康飲食聰明吃', '🍎')
];

var SCORE_NOTE = '【等級換算成績】留空＝用預設 優100／達成93／接近89／加油85。\n想讓某個活動的分數不同，就在該列填數字（例如 優分 98）。可依班級實際情況調整。';

var DEFAULT_CATEGORIES = ['跑步', '跳繩', '球類', '平衡', '呼拉圈', '安全與態度', '健康'];

/* ───────────────────────── 建立與維護（在 Apps Script 編輯器執行） ───────────────────────── */

/** 建立缺少的分頁、表頭與預設資料；已存在的分頁與資料一律不動。可重複執行。 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var created = [], kept = [];

  makeSheet_(ss, SHEETS.roster, H_ROSTER, [[EXAMPLE_CLASS, 1, '（範例，請刪除此列後填入真實班級與學生）']], created, kept, function (sh) {
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('A1').setNote('班級名稱，例如 101、一年一班。同一班的學生班級欄要寫一樣。\n班級為「' + EXAMPLE_CLASS + '」的列網站會忽略。');
  });
  makeSheet_(ss, SHEETS.act, H_ACT, DEFAULT_ACTIVITIES, created, kept, function (sh) {
    sh.setFrozenColumns(4);
    sh.getRange('F2:F500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['count', 'time', 'checklist', 'level'], true).build());
    sh.getRange('H2:H500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['高', '低'], true).build());
    sh.getRange('N2:N500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Y', 'N'], true).build());
    sh.getRange('F1').setNote('登記方式：count＝次數或數量、time＝秒、checklist＝動作要點勾選、level＝直接選等級');
    sh.getRange('H1').setNote('評分方向：高＝數值越大越好；低＝數值越小越好（例如跑步秒數）');
    sh.getRange('J1').setNote('勾選項目：用「｜」隔開。勾選了幾項，數值就是幾。');
    var tip = '【暫定建議值，不是教案原文，可依班級實際情況調整】\n達到「優」門檻得 4、「達成」得 3、「接近」得 2，否則得 1。\n評分方向為「低」時，數值要「小於或等於」門檻。level 類不需要門檻。';
    sh.getRange('K1:M1').setNote(tip);
    sh.getRange('N1').setNote('Y＝這學期要顯示；N＝隱藏。直接改這欄即可增減網站上的活動，不必改程式。');
    sh.getRange('O1').setNote('教案＝對應教案 PDF 單元；自訂＝老師自己加的');
    sh.getRange('P1:S1').setNote(SCORE_NOTE);
    sh.getRange('A1').setNote('新增活動：在最下面新增一列，活動ID 不可重複。改完按網站右上角 ↻ 即可看到。');
  });
  makeSheet_(ss, SHEETS.score, H_SCORE, [], created, kept, function (sh) {
    sh.getRange('B:C').setNumberFormat('@');
    sh.getRange('K:K').setNumberFormat('@');
    sh.getRange('A1').setNote('此分頁由網站寫入，請勿手動改動。唯一鍵＝日期|班級|座號|活動ID，重複送出會覆蓋同一列。');
  });
  makeSheet_(ss, SHEETS.unit, H_UNIT, DEFAULT_UNITS, created, kept, function (sh) {
    sh.getRange('A:A').setNumberFormat('@');
  });

  var upgraded = upgradeColumns_(ss);
  var pc = ensurePasscode_();
  var msg = (created.length ? '已建立分頁：' + created.join('、') + '\n' : '') +
    (kept.length ? '已存在、未更動：' + kept.join('、') + '\n' : '') +
    (upgraded.length ? '已在既有分頁補上新欄位（只加表頭，不動資料）：' + upgraded.join('、') + '\n' : '') +
    (pc.isNew ? '\n教師通行碼（請記下，網站第一次開啟要輸入）：' + pc.code + '\n之後可從選單「體育成績 → 設定通行碼」更改。' :
      '\n通行碼沿用原本設定（可從選單「體育成績 → 設定通行碼」更改）。') +
    '\n\n下一步：到「班級名單」分頁填入班級與學生，再部署為網頁應用程式。';
  Logger.log(msg);
  ui_(function (ui) { ui.alert('體育成績 — 設定完成', msg, ui.ButtonSet.OK); });
  return msg;
}

/** 舊版分頁補上新欄位表頭（只寫空白的表頭格，絕不動資料）。回傳有補的分頁名稱。 */
function upgradeColumns_(ss) {
  var done = [];
  [[SHEETS.act, H_ACT, SCORE_NOTE], [SHEETS.score, H_SCORE, null]].forEach(function (t) {
    var sh = ss.getSheetByName(t[0]);
    if (!sh) return;
    var need = t[1].length;
    if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
    var cur = sh.getRange(1, 1, 1, need).getValues()[0], changed = false;
    for (var i = 0; i < need; i++) {
      if (String(cur[i]) === '') { sh.getRange(1, i + 1).setValue(t[1][i]).setFontWeight('bold').setBackground('#e8f0fe'); changed = true; }
    }
    if (changed) { done.push(t[0]); if (t[2]) sh.getRange(1, 16, 1, 4).setNote(t[2]); }
  });
  return done;
}

/** 只補上「活動設定」裡缺少的預設活動（以活動ID 判斷），不修改任何現有列。 */
function restoreDefaultActivities() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.act);
  if (!sh) { setup(); return; }
  var have = {};
  sh.getDataRange().getValues().slice(1).forEach(function (r) { have[String(r[0])] = true; });
  var add = DEFAULT_ACTIVITIES.filter(function (r) { return !have[r[0]]; });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, H_ACT.length).setValues(add);
  var msg = add.length ? '已補上 ' + add.length + ' 個預設活動。' : '預設活動都還在，沒有需要補的。';
  ui_(function (ui) { ui.alert(msg); });
  return msg;
}

function setPasscodePrompt() {
  ui_(function (ui) {
    var r = ui.prompt('設定教師通行碼', '請輸入新的通行碼（至少 4 碼）：', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var v = String(r.getResponseText()).trim();
    if (v.length < 4) { ui.alert('通行碼至少 4 碼，未更改。'); return; }
    PropertiesService.getScriptProperties().setProperty('PASSCODE', v);
    ui.alert('已更新通行碼。');
  });
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('體育成績')
      .addItem('建立缺少的分頁（setup）', 'setup')
      .addItem('補齊預設活動', 'restoreDefaultActivities')
      .addItem('設定通行碼', 'setPasscodePrompt')
      .addToUi();
  } catch (e) { /* 非試算表介面 */ }
}

/* ───────────────────────── 網頁應用程式 ───────────────────────── */

function doGet() {
  return json_({ ok: true, service: 'pe-grades-grade1', ready: !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.score) });
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var auth = checkKey_(req.key);
    if (auth !== true) out = { ok: false, error: auth };
    else if (req.action === 'bootstrap') out = bootstrap_(req);
    else if (req.action === 'save') out = save_(req);
    else out = { ok: false, error: '不明的操作' };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return json_(out);
}

function bootstrap_(req) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEETS.score)) return { ok: false, error: '尚未執行 setup()' };
  var acts = readActivities_();
  var cats = DEFAULT_CATEGORIES.filter(function (c) { return acts.some(function (a) { return a.cat === c; }); });
  acts.forEach(function (a) { if (a.cat && cats.indexOf(a.cat) < 0) cats.push(a.cat); });

  var days = Number(req.days) > 0 ? Math.min(Number(req.days), 800) : DEFAULT_DAYS;
  var cutoff = Utilities.formatDate(new Date(Date.now() - days * 86400000), TZ, 'yyyy-MM-dd');
  var scores = [];
  var sh = ss.getSheetByName(SHEETS.score);
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, H_SCORE.length).getValues().forEach(function (r) {
      var d = dstr_(r[1]);
      if (!r[10] || d < cutoff) return;
      scores.push([d, String(r[2]), Number(r[3]), String(r[5]), r[6] === '' ? null : Number(r[6]),
        r[7] === '' ? null : Number(r[7]), r[8] === 'Y' ? 1 : 0, String(r[9] || ''), String(r[11] || '')]);
    });
  }
  var roster = readRoster_();
  return {
    ok: true,
    cfg: { activities: acts, units: readUnits_(), categories: cats },
    classOrder: roster.order, classes: roster.byClass,
    scores: scores, since: cutoff, now: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss')
  };
}

/**
 * 批次寫入。以「日期|班級|座號|活動ID」為唯一鍵 upsert，重送不會產生重複列。
 * record: {date, cls, no, aid, value, absent, note, detail, del}
 */
function save_(req) {
  var recs = req.records || [];
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEETS.score);
    if (!sh) return { ok: false, error: '尚未執行 setup()' };
    upgradeColumns_(ss);                  // 舊版試算表自動補上新欄位
    var acts = {};
    readActivities_().forEach(function (a) { acts[a.id] = a; });
    var names = rosterNames_();
    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');

    var last = sh.getLastRow();
    var rowOf = {};
    if (last > 1) sh.getRange(2, 11, last - 1, 1).getValues().forEach(function (r, i) { if (r[0]) rowOf[String(r[0])] = i + 2; });

    var updates = [], dels = [], appends = [], appendIdx = {}, saved = [], rejected = [];
    recs.forEach(function (rec) {
      var date = String(rec.date || ''), cls = String(rec.cls == null ? '' : rec.cls), no = Number(rec.no), aid = String(rec.aid || '');
      var key = [date, cls, no, aid].join('|');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !cls || !(no > 0) || !aid) { rejected.push({ key: key, reason: '欄位不完整' }); return; }
      if (rec.del) {
        if (rowOf[key]) { dels.push(rowOf[key]); delete rowOf[key]; }
        if (appendIdx[key] != null) { appends[appendIdx[key]] = null; delete appendIdx[key]; }
        saved.push(key); return;
      }
      var act = acts[aid];
      var absent = !!rec.absent;
      var value = (absent || rec.value == null || rec.value === '' || isNaN(rec.value)) ? '' : Number(rec.value);
      var grade = absent ? '' : gradeOf_(act, value);
      var row = [stamp, date, cls, no, names[cls + '|' + no] || '', aid, value, grade == null ? '' : grade,
        absent ? 'Y' : '', String(rec.note || '').slice(0, 300), key, absent ? '' : String(rec.detail || ''),
        (grade === '' || grade == null) ? '' : scoreOfGrade_(act, grade)];
      if (rowOf[key]) updates.push([rowOf[key], row]);
      else if (appendIdx[key] != null) appends[appendIdx[key]] = row;
      else { appendIdx[key] = appends.length; appends.push(row); }
      saved.push(key);
    });

    // 1) 更新既有列、刪除
    if (updates.length + dels.length > 12 && last > 1) {
      var all = sh.getRange(2, 1, last - 1, H_SCORE.length).getValues();
      updates.forEach(function (u) { all[u[0] - 2] = u[1]; });
      var dset = {};
      dels.forEach(function (r) { dset[r] = true; });
      var kept = all.filter(function (_, i) { return !dset[i + 2]; });
      sh.getRange(2, 1, last - 1, H_SCORE.length).clearContent();
      if (kept.length) sh.getRange(2, 1, kept.length, H_SCORE.length).setValues(kept);
    } else {
      updates.forEach(function (u) { sh.getRange(u[0], 1, 1, H_SCORE.length).setValues([u[1]]); });
      dels.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
    }
    // 2) 新增
    appends = appends.filter(function (r) { return r; });
    if (appends.length) {
      var start = Math.max(sh.getLastRow(), 1) + 1;
      var rng = sh.getRange(start, 1, appends.length, H_SCORE.length);
      rng.setNumberFormat('@');           // 日期、班級、唯一鍵維持純文字
      rng.setValues(appends);
    }
    SpreadsheetApp.flush();
    return { ok: true, saved: saved, rejected: rejected };
  } finally {
    lock.releaseLock();
  }
}

/* ───────────────────────── 內部工具 ───────────────────────── */

/** 與前端相同的等級規則。數值達「優」得 4、「達成」得 3、「接近」得 2，否則 1。 */
function gradeOf_(act, v) {
  if (v === '' || v == null || isNaN(v)) return null;
  v = Number(v);
  if (!act) return null;
  if (act.mode === 'level') return Math.min(4, Math.max(1, Math.round(v)));
  if (act.t4 == null || act.t3 == null || act.t2 == null) return null;
  if (act.dir === '低') return v <= act.t4 ? 4 : v <= act.t3 ? 3 : v <= act.t2 ? 2 : 1;
  return v >= act.t4 ? 4 : v >= act.t3 ? 3 : v >= act.t2 ? 2 : 1;
}

/** 等級 → 分數（該活動有自訂分數就用，否則用預設）。 */
function scoreOfGrade_(act, g) {
  var v = act && act.sc ? act.sc[4 - g] : DEFAULT_SCORES[4 - g];
  return v == null ? DEFAULT_SCORES[4 - g] : v;
}

function readActivities_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.act);
  if (!sh || sh.getLastRow() < 2) return [];
  var num = function (v) { return v === '' || v == null || isNaN(v) ? null : Number(v); };
  var out = [];
  var ncol = Math.min(H_ACT.length, sh.getMaxColumns());
  sh.getRange(2, 1, sh.getLastRow() - 1, ncol).getValues().forEach(function (r) {
    var id = String(r[0]).trim();
    if (!id) return;
    var mode = String(r[5]).trim().toLowerCase();
    if (['count', 'time', 'checklist', 'level'].indexOf(mode) < 0) mode = 'count';
    out.push({
      id: id, cat: String(r[1]).trim(), unit: String(r[2]).trim().replace(/^[—–-]$/, ''), name: String(r[3]).trim(),
      icon: String(r[4]).trim(), mode: mode, uom: String(r[6]).trim(), dir: String(r[7]).trim() === '低' ? '低' : '高',
      goal: String(r[8]).trim(),
      items: String(r[9]).split(/[｜|]/).map(function (s) { return s.trim(); }).filter(String),
      t4: num(r[10]), t3: num(r[11]), t2: num(r[12]),
      on: String(r[13]).trim().toUpperCase() !== 'N', src: String(r[14]).trim(),
      sc: [0, 1, 2, 3].map(function (i) { var v = num(r[15 + i]); return v == null ? DEFAULT_SCORES[i] : v; })
    });
  });
  return out;
}

function readUnits_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.unit);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { return { id: String(r[0]).trim(), theme: String(r[1]).trim(), name: String(r[2]).trim() }; });
}

function readRoster_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.roster);
  var byClass = {}, order = [];
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
      var cls = String(r[0]).trim(), no = Number(r[1]), name = String(r[2]).trim();
      if (!cls || cls === EXAMPLE_CLASS || !(no > 0) || !name) return;
      if (!byClass[cls]) { byClass[cls] = []; order.push(cls); }
      byClass[cls].push([no, name]);
    });
    order.forEach(function (c) { byClass[c].sort(function (a, b) { return a[0] - b[0]; }); });
  }
  return { byClass: byClass, order: order };
}

function rosterNames_() {
  var m = {}, r = readRoster_();
  r.order.forEach(function (c) { r.byClass[c].forEach(function (s) { m[c + '|' + s[0]] = s[1]; }); });
  return m;
}

function dstr_(v) {
  return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v).slice(0, 10);
}

function makeSheet_(ss, name, header, rows, created, kept, extra) {
  var sh = ss.getSheetByName(name);
  if (sh) { kept.push(name); return sh; }          // 已存在：絕不覆蓋
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#e8f0fe');
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  if (extra) extra(sh);
  created.push(name);
  return sh;
}

function ensurePasscode_() {
  var p = PropertiesService.getScriptProperties();
  var k = p.getProperty('PASSCODE');
  if (k) return { code: k, isNew: false };
  k = String(Math.floor(100000 + Math.random() * 900000));
  p.setProperty('PASSCODE', k);
  return { code: k, isNew: true };
}

function checkKey_(key) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= 10) return '嘗試次數過多，請 10 分鐘後再試';
  var real = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  if (!real) return '尚未設定通行碼，請先執行 setup()';
  if (String(key || '') === real) return true;
  cache.put('fails', String(fails + 1), 600);
  return 'auth';
}

function ui_(fn) {
  try { fn(SpreadsheetApp.getUi()); } catch (e) { /* 從編輯器以外觸發時沒有介面 */ }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
