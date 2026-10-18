/* ============================================================
 *  モーニングセミナー運営 ― 共通ロジック
 *  通信 / 合言葉 / 年間カレンダー取込 / 名簿 / タスク生成
 * ============================================================ */
(function (global) {
  "use strict";

  const WDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const AUTH_KEY = "rinri-ms-auth-v1";
  const STORE_KEY = "rinri-ms-store-v1";
  const ANNUAL_KEY = "rinri-ms-annual-v1";
  const HISTORY_KEY = "rinri-ms-history-v1";

  const HOLIDAYS = {
    "2026-08-11": "山の日", "2026-09-21": "敬老の日", "2026-09-22": "国民の休日",
    "2026-09-23": "秋分の日", "2026-10-12": "スポーツの日", "2026-11-03": "文化の日",
    "2026-11-23": "勤労感謝の日", "2027-01-01": "元日", "2027-01-11": "成人の日",
    "2027-02-11": "建国記念の日", "2027-02-23": "天皇誕生日", "2027-03-21": "春分の日",
    "2027-03-22": "振替休日", "2027-04-29": "昭和の日", "2027-05-03": "憲法記念日",
    "2027-05-04": "みどりの日", "2027-05-05": "こどもの日", "2027-07-19": "海の日",
    "2027-08-11": "山の日", "2027-09-20": "敬老の日", "2027-09-23": "秋分の日",
    "2027-10-11": "スポーツの日", "2027-11-03": "文化の日", "2027-11-23": "勤労感謝の日"
  };

  const emptyState = () => ({
    sessions: [],
    slots: [],
    tasks: [],
    records: [],
    config: {},
    speechRoster: null
  });

  const MS = {
    state: emptyState(),
    annual: { events: [], categories: [], savedAt: 0, error: "" },
    roster: { sheetName: "", rows: [], history: [], error: "", notice: "", savedAt: 0, source: "" },
    meibo: [],
    who: { name: "", key: "" },
    saving: false,
    localOnly: true
  };

  /* ---------- 日付 ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymd(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
  function todayYmd() {
    const n = new Date();
    return ymd(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }
  function parseYmd(s) {
    const p = String(s || "").split("-").map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  }
  function addDays(s, n) {
    const dt = parseYmd(s);
    dt.setDate(dt.getDate() + n);
    return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function weekday(s) { return parseYmd(s).getDay(); }
  function jaDate(s, withWeek) {
    if (!s) return "";
    const dt = parseYmd(s);
    const t = dt.getFullYear() + "年" + (dt.getMonth() + 1) + "月" + dt.getDate() + "日";
    return withWeek ? t + "（" + WDAYS[dt.getDay()] + "）" : t;
  }
  function cmpDate(a, b) { return String(a).localeCompare(String(b)); }

  /* 倫理法人会の期：9月1日〜翌8月31日。令和n年 = (期の開始年 - 2017) */
  function nendoStartYear(date) {
    const y = Number(String(date || "").slice(0, 4));
    const m = Number(String(date || "").slice(5, 7));
    if (!y) return 0;
    return m >= 9 ? y : y - 1;
  }
  function nendoKey(date) {
    const y = nendoStartYear(date);
    return y ? String(y) : "";
  }
  function nendoReiwa(startYear) {
    const y = Number(startYear);
    return y ? y - 2017 : 0;
  }
  function nendoLabel(startYearOrDate) {
    const start = String(startYearOrDate || "").indexOf("-") >= 0
      ? nendoStartYear(startYearOrDate)
      : Number(startYearOrDate);
    const n = nendoReiwa(start);
    if (n <= 1) return "令和元年";
    return "令和" + n + "年";
  }
  function nendoRangeLabel(startYearOrDate) {
    const start = String(startYearOrDate || "").indexOf("-") >= 0
      ? nendoStartYear(startYearOrDate)
      : Number(startYearOrDate);
    if (!start) return "";
    return start + "年9月〜" + (start + 1) + "年8月";
  }
  function nendosOf(rows) {
    const set = new Set();
    (rows || []).forEach(r => {
      const k = nendoKey(r && r.date);
      if (k) set.add(k);
    });
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }
  function currentNendoKey() {
    return nendoKey(todayYmd());
  }

  function tuesdaysInNendo(startYear) {
    const y = Number(startYear);
    if (!y) return [];
    let d = ymd(y, 9, 1);
    const end = ymd(y + 1, 8, 31);
    while (weekday(d) !== 2) d = addDays(d, 1);
    const list = [];
    while (d <= end) {
      list.push(d);
      d = addDays(d, 7);
    }
    return list;
  }

  function fillTuesdaySlots(rows, nendoKeys) {
    const byDate = {};
    (rows || []).forEach(r => { if (r && r.date) byDate[r.date] = r; });
    const keys = (nendoKeys && nendoKeys.length) ? nendoKeys.slice() : nendosOf(rows);
    const out = [];
    keys.forEach(k => {
      tuesdaysInNendo(k).forEach(date => {
        if (byDate[date]) {
          out.push(byDate[date]);
          return;
        }
        const sess = emptySession(date);
        const hol = HOLIDAYS[date];
        if (hol) {
          sess.recess = true;
          sess.eventTag = "休会（" + hol + "）";
        }
        out.push(sess);
      });
    });
    return out.sort((a, b) => cmpDate(a.date, b.date));
  }

  function nextSessionDate(rows, today) {
    const day = today || todayYmd();
    const upcoming = (rows || []).filter(r => r && r.date >= day);
    const held = upcoming.filter(r => !r.recess).sort((a, b) => cmpDate(a.date, b.date));
    if (held[0]) return held[0].date;
    const any = upcoming.slice().sort((a, b) => cmpDate(a.date, b.date));
    return any[0] ? any[0].date : "";
  }

  function monthSpan(count) {
    const n = new Date();
    const out = [];
    let y = n.getFullYear(), m = n.getMonth() + 1;
    for (let i = 0; i < (count || 3); i++) {
      out.push({ y, m });
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  function eachDate(months) {
    const list = [];
    months.forEach(({ y, m }) => {
      const last = daysInMonth(y, m);
      for (let d = 1; d <= last; d++) list.push(ymd(y, m, d));
    });
    return list;
  }

  /* ---------- 設定の合成 ---------- */
  function cfg() {
    const remote = MS.state.config || {};
    return {
      lanes: remote.lanes && remote.lanes.length ? remote.lanes : MS_CONFIG.lanes,
      templates: mergeTemplates(remote.templates),
      formats: remote.formats && remote.formats.length ? mergeFormats(remote.formats) : MS_CONFIG.formats,
      roles: remote.roles && remote.roles.length ? remote.roles : MS_CONFIG.roles,
      assignees: remote.assignees || []
    };
  }

  function mergeTemplates(remote) {
    const local = MS_CONFIG.templates || [];
    if (!remote || !remote.length) return local;
    const byKey = {};
    remote.forEach(t => { byKey[t.key] = t; });
    if (byKey.approach && !byKey.contact) {
      byKey.contact = Object.assign({}, byKey.approach, { key: "contact", title: "連絡を取る" });
    }
    return local.map(t => {
      const merged = Object.assign({}, t, byKey[t.key] || {});
      if (t.key === "ask") merged.title = "決まった";
      if (t.key === "contact") merged.title = "連絡を取る";
      return merged;
    });
  }

  function mergeFormats(list) {
    const local = {};
    MS_CONFIG.formats.forEach(f => { local[f.id] = f; });
    return list.map(f => {
      const base = local[f.id] || {};
      return Object.assign({}, base, f, { slots: f.slots || base.slots || [] });
    });
  }

  function formatById(id) {
    return cfg().formats.find(f => f.id === id) || cfg().formats[0];
  }
  function formatName(id) {
    const f = formatById(id || "unset");
    return f ? f.name : "未定";
  }
  function laneById(id) {
    return cfg().lanes.find(l => l.id === id) || { id: id || "other", name: "その他", kinds: [] };
  }
  function laneOfKind(kind) {
    const hit = cfg().lanes.find(l => (l.kinds || []).indexOf(kind) >= 0);
    return hit ? hit.id : "other";
  }

  /* ---------- 名簿 ---------- */
  function loadMeibo() {
    const snap = global.MEIBO_SNAPSHOT;
    const rows = (snap && snap.koukai) || [];
    MS.meibo = rows.map(r => ({
      id: String(r["会員番号"] || "").trim(),
      name: String(r["氏名"] || "").replace(/\s+/g, " ").trim(),
      kana: String(r["読み仮名"] || "").trim(),
      company: String(r["会社名"] || "").trim(),
      role: String(r["役職"] || "").trim()
    })).filter(m => m.name);
  }

  function memberById(id) {
    return MS.meibo.find(m => m.id === id) || null;
  }

  function searchMembers(q) {
    const s = String(q || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!s) return MS.meibo.slice(0, 20);
    return MS.meibo.filter(m => {
      const blob = (m.name + m.kana + m.company + m.id).replace(/\s+/g, "").toLowerCase();
      return blob.indexOf(s) >= 0;
    }).slice(0, 20);
  }

  /* ---------- 認証 ---------- */
  function loadAuth() {
    try {
      const raw = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
      if (raw && raw.name) MS.who = { name: String(raw.name), key: String(raw.key || "") };
    } catch (e) { /* ignore */ }
  }

  function saveAuth() {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(MS.who)); } catch (e) { /* ignore */ }
  }

  function endpointReady() {
    const url = (MS_CONFIG.api && MS_CONFIG.api.endpoint) || "";
    return /^https:\/\//.test(url);
  }

  function needsAuthGate() {
    if (!endpointReady()) return !MS.who.name;
    return !MS.who.name || !MS.who.key;
  }

  /* ---------- 通信 ---------- */
  const pendingContact = {};
  let saveTail = Promise.resolve();

  function applyRemote(data) {
    if (!data) return;
    MS.state = {
      sessions: data.sessions || [],
      slots: data.slots || [],
      tasks: data.tasks || [],
      records: data.records || [],
      config: data.config || {},
      speechRoster: data.speechRoster || null
    };
    applyPendingContacts();
  }

  function cacheState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(MS.state)); } catch (e) { /* ignore */ }
  }

  function loadCachedState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (raw) applyRemote(raw);
    } catch (e) { /* ignore */ }
  }

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(label || "時間切れ")), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  async function fetchState() {
    MS.localOnly = !endpointReady();
    if (!endpointReady()) {
      loadCachedState();
      return { ok: true, local: true };
    }
    const url = MS_CONFIG.api.endpoint + "?action=state&key=" + encodeURIComponent(MS.who.key) + "&_=" + Date.now();
    const res = await fetch(url);
    const j = await res.json();
    if (!j || !j.ok) {
      if (j && j.error === "unauthorized") return { ok: false, error: "unauthorized" };
      throw new Error((j && j.error) || "読み込みに失敗しました");
    }
    applyRemote(j.data);
    cacheState();
    return { ok: true };
  }

  async function saveOps(ops) {
    const run = () => saveOpsNow(ops);
    const next = saveTail.then(run, run);
    saveTail = next.catch(function () { /* keep the queue moving */ });
    return next;
  }

  function dropPendingContactRows(ops) {
    const blocked = pendingContact;
    if (!ops || !ops.length || !Object.keys(blocked).length) return ops;
    return ops.map(op => {
      if (op.op !== "upsert" || op.sheet !== "tasks") return op;
      const rows = (op.rows || []).filter(r => {
        if (r.templateKey !== "contact" && r.templateKey !== "approach") return true;
        const pending = blocked[r.slotId];
        if (!pending) return true;
        return pending.status === r.status;
      });
      return Object.assign({}, op, { rows: rows });
    }).filter(op => op.op !== "upsert" || op.sheet !== "tasks" || (op.rows && op.rows.length));
  }

  async function saveOpsNow(ops) {
    ops = dropPendingContactRows(ops);
    if (!ops || !ops.length) return { ok: true };
    if (!endpointReady()) {
      applyLocalOps(ops);
      cacheState();
      return { ok: true, local: true };
    }
    MS.saving = true;
    setSaveFlag(true);
    try {
      const res = await fetch(MS_CONFIG.api.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          key: MS.who.key,
          updatedBy: MS.who.name,
          ops: ops
        })
      });
      const j = await res.json();
      if (!j || !j.ok) {
        if (j && j.error === "unauthorized") return { ok: false, error: "unauthorized" };
        throw new Error((j && j.error) || "保存に失敗しました");
      }
      applyRemote(j.data);
      cacheState();
      return { ok: true };
    } finally {
      MS.saving = false;
      setSaveFlag(false);
    }
  }

  function applyLocalOps(ops) {
    const now = todayYmd() + " " + new Date().toTimeString().slice(0, 5);
    const by = MS.who.name;
    ops.forEach(op => {
      if (op.op === "upsert") {
        const list = MS.state[op.sheet];
        if (!Array.isArray(list)) return;
        const specId = op.sheet === "sessions" || op.sheet === "records" ? "date"
          : op.sheet === "config" ? "key" : "id";
        (op.rows || []).forEach(row => {
          const copy = Object.assign({}, row);
          if (copy.updatedAt == null) copy.updatedAt = now;
          if (copy.updatedBy == null) copy.updatedBy = by;
          const id = String(copy[specId] || "");
          const idx = list.findIndex(r => String(r[specId]) === id);
          if (idx >= 0) list[idx] = Object.assign({}, list[idx], copy);
          else list.push(copy);
        });
      } else if (op.op === "delete") {
        const list = MS.state[op.sheet];
        if (!Array.isArray(list)) return;
        const specId = op.sheet === "sessions" || op.sheet === "records" ? "date"
          : op.sheet === "config" ? "key" : "id";
        const drop = new Set((op.ids || []).map(String));
        MS.state[op.sheet] = list.filter(r => !drop.has(String(r[specId])));
      } else if (op.op === "purgeDate") {
        (op.sheets || ["slots", "tasks"]).forEach(name => {
          MS.state[name] = (MS.state[name] || []).filter(r => r.date !== op.date);
        });
      }
    });
  }

  /* ---------- 年間カレンダー ---------- */
  async function fetchAnnual() {
    const url = MS_CONFIG.annual && MS_CONFIG.annual.endpoint;
    if (!url) return;
    try {
      const res = await fetch(url);
      const j = await res.json();
      if (j && Array.isArray(j.events)) {
        MS.annual = {
          events: j.events,
          categories: j.categories || [],
          savedAt: Date.now(),
          error: ""
        };
        try { localStorage.setItem(ANNUAL_KEY, JSON.stringify(MS.annual)); } catch (e) { /* ignore */ }
        return;
      }
    } catch (e) {
      MS.annual.error = e.message || "年間スケジュールを読めませんでした";
    }
    try {
      const cached = JSON.parse(localStorage.getItem(ANNUAL_KEY) || "null");
      if (cached && cached.events) {
        MS.annual = Object.assign({}, cached, { error: MS.annual.error || "キャッシュを表示しています" });
      }
    } catch (e) { /* ignore */ }
  }

  function annualByDate() {
    const map = {};
    (MS.annual.events || []).forEach(ev => {
      (map[ev.date] = map[ev.date] || []).push(ev);
    });
    return map;
  }

  function catById(id) {
    return (MS.annual.categories || []).find(c => c.id === id) || { name: "予定", color: "#8a93a3" };
  }

  function isMsEvent(ev) {
    return ev && ev.catId === ((MS_CONFIG.annual && MS_CONFIG.annual.msCatId) || "c1");
  }

  function msKindOn(date) {
    const row = rosterOf(date);
    if (row) return row.recess ? "recess" : "held";
    const evs = (annualByDate()[date] || []).filter(isMsEvent);
    if (!evs.length) return "";
    if (evs.some(e => /休会/.test(e.title || ""))) return "recess";
    return "held";
  }

  /* ---------- R9 会員スピーチシート ---------- */
  function parseSheetDate(s) {
    const t = String(s || "").trim();
    const m = t.match(/^(\d{2,4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    if (!m) return "";
    let y = Number(m[1]);
    if (y < 100) y += 2000;
    return ymd(y, Number(m[2]), Number(m[3]));
  }

  function compactName(s) {
    return String(s || "").replace(/[\s　]/g, "");
  }

  function matchMember(text) {
    const hay = compactName(text);
    if (!hay) return null;
    let best = null;
    MS.meibo.forEach(m => {
      const n = compactName(m.name);
      if (n && hay.indexOf(n) >= 0) {
        if (!best || n.length > compactName(best.name).length) best = m;
      }
    });
    return best;
  }

  function cleanMultiline(s) {
    return String(s == null ? "" : s).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  }

  const ROLE_SUFFIX_RE = /(名誉委員長|副委員長|委員長|名誉法人アドバイザー|法人スーパーバイザー|スーパーバイザー|法人アドバイザー|近畿方面副方面長|副方面長|方面長|ブロック長|地区長|副専任幹事|専任幹事|副幹事長|幹事長|副事務長|事務長|副会長|会長|実行委員|相談役|監査|研究員|塾長|会員)$/;

  function looksLikeRoleOnly(s) {
    const t = String(s || "").replace(/[\s　]/g, "");
    if (!t) return false;
    return ROLE_SUFFIX_RE.test(t) && t.replace(ROLE_SUFFIX_RE, "").length === 0;
  }

  function peelRole(name) {
    const s = String(name || "").replace(/[\s　]+/g, " ").trim();
    const m = s.match(new RegExp("^(.*?)\\s*" + ROLE_SUFFIX_RE.source));
    if (!m) return { name: s, role: "" };
    const head = String(m[1] || "").trim();
    if (!head) return { name: s, role: "" };
    return { name: head, role: m[2] };
  }

  function normalizeAffiliation(org, mem) {
    let s = cleanMultiline(org).replace(/[（）()]/g, "").replace(/[\s　]+/g, " ").trim();
    const compact = s.replace(/[\s　]/g, "");
    if (mem) {
      if (compact && (compact === compactName(mem.name) || compact === compactName(mem.company))) s = "";
    }
    if (looksLikeRoleOnly(s)) s = "";
    if (!s) return mem ? "大阪みなと倫理法人会" : "";
    const shorts = {
      "大阪みなと": "大阪みなと倫理法人会",
      "みなと": "大阪みなと倫理法人会",
      "西区会員": "大阪西区倫理法人会",
      "大阪西区": "大阪西区倫理法人会"
    };
    if (shorts[compact]) return shorts[compact];
    if (shorts[s]) return shorts[s];
    return s;
  }

  function splitPeople(raw) {
    return String(raw || "").split(/[・／/、,＆&]+/).map(s => s.trim()).filter(Boolean);
  }

  function isEventTag(s) {
    return /^【.+】$/.test(String(s || "").trim());
  }

  function isRecessText(s) {
    return /休会/.test(String(s || ""));
  }

  function isNoneSpeech(s) {
    const t = String(s || "").replace(/\s+/g, "");
    if (!t) return true;
    if (/^(無し|なし|ー|-)$/.test(t)) return true;
    if (/なし[）)]?$/.test(t) && /ため|のため|第1週|W講|ダブル|トリプル|自単会|スピーチ大会/.test(t)) return true;
    return false;
  }

  function isBlankPersonName(s) {
    const t = cleanMultiline(s).replace(/\s+/g, "");
    if (!t) return true;
    if (isEventTag(t)) return true;
    if (isRecessText(t)) return true;
    if (/^(無し|なし|ー|-)$/.test(t)) return true;
    if (/^(w講[話和]|W講[話和]|ダブル講話|トリプル講話|会員スピーチ大会|会員スピーチ|夢を語る会|抱負をかたる会)$/i.test(t)) return true;
    return false;
  }

  function parsePersonCell(raw, extra) {
    extra = extra || {};
    let s = cleanMultiline(raw);
    if (!s || isBlankPersonName(s)) return null;
    let org = cleanMultiline(extra.org);
    let role = cleanMultiline(extra.role);
    let callAs = cleanMultiline(extra.callAs);
    let title = cleanMultiline(extra.title);
    const orgM = s.match(/[（(]([^）)]+)[）)]/);
    if (orgM) {
      if (!org) org = orgM[1].trim();
      s = s.replace(orgM[0], "").trim();
    }
    s = s.replace(/さん$/u, "").trim();
    const peeled = peelRole(s);
    if (peeled.role) {
      if (!role) role = peeled.role;
      s = peeled.name;
    }
    const mem = matchMember(s);
    return {
      speakerName: mem ? mem.name : s,
      speakerOrg: normalizeAffiliation(org, mem),
      speakerRole: role || (mem ? mem.role : ""),
      callAs: callAs,
      title: title,
      memberId: mem ? mem.id : "",
      speakerType: mem ? "会員" : "外部"
    };
  }

  function splitLecturers(raw) {
    return splitPeople(raw);
  }

  function emptySession(date) {
    return {
      date: date,
      recess: false,
      format: "unset",
      eventTag: "",
      kowa: [],
      speech: [],
      checker: "",
      askOn: "",
      profileDue: "",
      draftDue: ""
    };
  }

  function sessionFormat(sess) {
    if (sess.recess) return "unset";
    if (sess.kowa.length >= 2) return "double";
    if (sess.eventTag) return "kowa_only";
    if (sess.kowa.length && sess.speech.length) return "normal";
    if (sess.kowa.length) return "kowa_only";
    if (sess.speech.length) return "normal";
    return "unset";
  }

  function finalizeSession(sess) {
    if (!sess) return null;
    sess.kowa = (sess.kowa || []).filter(Boolean).slice(0, 3);
    sess.speech = (sess.speech || []).filter(Boolean);
    sess.format = sessionFormat(sess);
    return sess;
  }

  function addSpeakers(sess, raw, extra) {
    splitPeople(raw).forEach(bit => {
      const p = parsePersonCell(bit, extra);
      if (p) sess.kowa.push(p);
    });
  }

  function addSpeeches(sess, raw, extra) {
    if (isEventTag(raw)) {
      if (!sess.eventTag) sess.eventTag = cleanMultiline(raw);
      return;
    }
    if (isNoneSpeech(raw) || isRecessText(raw)) return;
    splitPeople(raw).forEach(bit => {
      if (isNoneSpeech(bit) || isBlankPersonName(bit)) return;
      const p = parsePersonCell(bit, extra);
      if (p) sess.speech.push(p);
    });
  }

  function parseOpsValues(values) {
    const sessions = [];
    if (!values || !values.length) return sessions;
    let headerIdx = -1;
    let headers = [];
    for (let i = 0; i < Math.min(values.length, 8); i++) {
      const line = (values[i] || []).map(c => String(c || "").trim());
      if (line.some(c => c === "担当日")) {
        headerIdx = i;
        headers = line;
        break;
      }
    }
    if (headerIdx < 0) return sessions;
    const col = name => headers.findIndex(h => h.indexOf(name) >= 0);
    const iDate = col("担当日");
    const iKowa = headers.findIndex(h => h.indexOf("講師") >= 0 || h.indexOf("講話") >= 0);
    const iSpeech = headers.findIndex(h => h.indexOf("会員スピーチ") >= 0);
    const iCheck = col("チェック担当");
    const iAsk = col("依頼書");
    const iProf = col("プロフ");
    const iDraft = col("原稿");
    let current = null;
    const flush = () => {
      if (current) sessions.push(finalizeSession(current));
      current = null;
    };
    for (let r = headerIdx + 1; r < values.length; r++) {
      const line = values[r] || [];
      const date = parseSheetDate(iDate >= 0 ? line[iDate] : "");
      const kowaRaw = String(iKowa >= 0 ? line[iKowa] : "").trim();
      const speechRaw = String(iSpeech >= 0 ? line[iSpeech] : "").trim();
      if (date) {
        flush();
        current = emptySession(date);
        current.recess = isRecessText(kowaRaw) || isRecessText(speechRaw);
        current.checker = String(iCheck >= 0 ? line[iCheck] : "").trim();
        current.askOn = parseSheetDate(iAsk >= 0 ? line[iAsk] : "");
        current.profileDue = parseSheetDate(iProf >= 0 ? line[iProf] : "");
        current.draftDue = parseSheetDate(iDraft >= 0 ? line[iDraft] : "");
        if (isEventTag(speechRaw)) current.eventTag = speechRaw;
        if (!current.recess) {
          addSpeakers(current, kowaRaw);
          addSpeeches(current, speechRaw);
        }
      } else if (current && kowaRaw) {
        addSpeakers(current, kowaRaw);
      }
    }
    flush();
    return sessions;
  }

  function headerNorm(c) {
    return String(c || "").replace(/\s+/g, "");
  }

  function parseDetailValues(values) {
    const sessions = [];
    if (!values || !values.length) return sessions;
    let headerIdx = -1;
    for (let i = 0; i < Math.min(values.length, 5); i++) {
      const line = (values[i] || []).map(headerNorm);
      if (line.some(h => h.indexOf("呼び出し方") >= 0) && line.some(h => h === "講師" || h.indexOf("講師") >= 0)) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return sessions;
    const headers = (values[headerIdx] || []).map(headerNorm);
    const findFrom = (name, from) => {
      for (let i = from || 0; i < headers.length; i++) {
        if (headers[i].indexOf(name) >= 0) return i;
      }
      return -1;
    };
    const iDate = findFrom("担当日", 0);
    const iKowa = findFrom("講師", 0);
    const iCall1 = findFrom("呼び出し方", iKowa >= 0 ? iKowa : 0);
    const iRole1 = findFrom("研究所辞令", iKowa >= 0 ? iKowa : 0);
    const iOrg1 = findFrom("所属", iKowa >= 0 ? iKowa : 0);
    const iTitle1 = findFrom("タイトル", iKowa >= 0 ? iKowa : 0);
    const iW = findFrom("W講話", 0);
    const iCall2 = iW >= 0 ? findFrom("呼び出し方", iW) : -1;
    const iRole2 = iW >= 0 ? findFrom("研究所辞令", iW) : -1;
    const iOrg2 = iW >= 0 ? findFrom("所属", iW) : -1;
    const iTitle2 = iW >= 0 ? findFrom("タイトル", iW) : -1;
    const iSpeech = findFrom("会員スピーチ", 0);
    const iSpeechRole = iSpeech >= 0 ? findFrom("役職", iSpeech) : -1;
    const iProf = findFrom("プロフ", 0);
    const iDraft = findFrom("原稿", 0);
    const cell = (line, i) => (i >= 0 && line[i] != null) ? line[i] : "";
    let start = headerIdx + 1;
    if (values[start] && !parseSheetDate(values[start][iDate >= 0 ? iDate : 0])) start += 1;
    for (let r = start; r < values.length; r++) {
      const line = values[r] || [];
      const date = parseSheetDate(cell(line, iDate >= 0 ? iDate : 0));
      if (!date) continue;
      const tag = cleanMultiline(line[1] || "");
      const sess = emptySession(date);
      sess.eventTag = isEventTag(tag) || isRecessText(tag) ? tag.replace(/\n/g, "") : tag;
      sess.recess = isRecessText(tag) || isRecessText(cell(line, iKowa));
      sess.profileDue = parseSheetDate(cell(line, iProf));
      sess.draftDue = parseSheetDate(cell(line, iDraft));
      if (!sess.recess) {
        const p1 = parsePersonCell(cell(line, iKowa), {
          callAs: cell(line, iCall1),
          role: cell(line, iRole1),
          org: cell(line, iOrg1),
          title: cell(line, iTitle1)
        });
        if (p1) sess.kowa.push(p1);
        const p2 = parsePersonCell(cell(line, iW), {
          callAs: cell(line, iCall2),
          role: cell(line, iRole2),
          org: cell(line, iOrg2),
          title: cell(line, iTitle2)
        });
        if (p2) sess.kowa.push(p2);
        addSpeeches(sess, cell(line, iSpeech), { role: cell(line, iSpeechRole) });
      }
      sessions.push(finalizeSession(sess));
    }
    return sessions;
  }

  function parseLooseDate(raw, ctx) {
    const t = String(raw || "").trim();
    if (!t) return "";
    let m = t.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    if (m) {
      ctx.year = Number(m[1]);
      ctx.month = Number(m[2]);
      return ymd(ctx.year, ctx.month, Number(m[3]));
    }
    m = t.match(/^(\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    if (m) {
      ctx.year = 2000 + Number(m[1]);
      ctx.month = Number(m[2]);
      return ymd(ctx.year, ctx.month, Number(m[3]));
    }
    m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})$/);
    if (m) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      if (ctx.month === 12 && month === 1) ctx.year += 1;
      else if (month < ctx.month && month <= 3 && ctx.month >= 10) ctx.year += 1;
      ctx.month = month;
      return ymd(ctx.year, month, day);
    }
    m = t.match(/^(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      if (ctx.month === 12 && month === 1) ctx.year += 1;
      else if (month < ctx.month && month <= 3 && ctx.month >= 10) ctx.year += 1;
      ctx.month = month;
      return ymd(ctx.year, month, day);
    }
    m = t.match(/^(\d{1,2})$/);
    if (m && ctx.month) {
      return ymd(ctx.year, ctx.month, Number(m[1]));
    }
    return parseSheetDate(t);
  }

  function parseDatedNameValues(values, yearStart, kind) {
    const sessions = [];
    if (!values || !values.length) return sessions;
    let start = 0;
    const first = (values[0] || []).map(c => String(c || "").trim());
    if (first.some(c => c === "日付" || c === "担当日" || c.indexOf("講和") >= 0 || c.indexOf("講話") >= 0)) start = 1;
    const ctx = { year: yearStart || 2019, month: 9 };
    if (kind === "archive") { ctx.year = 2019; ctx.month = 7; }
    for (let r = start; r < values.length; r++) {
      const line = values[r] || [];
      const date = parseLooseDate(line[0], ctx);
      if (!date) continue;
      if (kind === "archive" && date >= "2023-09-05") continue;
      const kowaRaw = String(line[1] || "").trim();
      const orgRaw = String(line[2] || "").trim();
      const speechRaw = String(line[3] || "").trim();
      const speechExtra = String(line[4] || "").trim();
      const sess = emptySession(date);
      sess.recess = isRecessText(kowaRaw) || isRecessText(speechRaw) || isRecessText(String(line[0] || ""));
      if (isEventTag(kowaRaw) || /^(会員スピーチ大会|会員スピーチ|夢を語る会|抱負をかたる会)$/.test(kowaRaw) || (/W講|ダブル|トリプル/.test(kowaRaw) && isBlankPersonName(kowaRaw))) {
        sess.eventTag = kowaRaw;
      }
      if (/w講/i.test(orgRaw) || /W講/.test(orgRaw)) {
        if (!sess.eventTag) sess.eventTag = orgRaw;
      }
      if (!sess.recess) {
        const extra = {};
        if (orgRaw && !/w講/i.test(orgRaw)) {
          if (looksLikeRoleOnly(orgRaw)) extra.role = orgRaw;
          else extra.org = orgRaw;
        }
        if (!sess.eventTag || sess.eventTag !== kowaRaw) addSpeakers(sess, kowaRaw, extra);
        addSpeeches(sess, speechRaw);
        if (speechExtra && !isNoneSpeech(speechExtra)) addSpeeches(sess, speechExtra);
      }
      sessions.push(finalizeSession(sess));
    }
    return sessions;
  }

  function parseTabValues(tab, values) {
    const kind = (tab && tab.kind) || "ops";
    if (kind === "detail") return parseDetailValues(values);
    if (kind === "simple") return parseDatedNameValues(values, tab.year, "simple");
    if (kind === "archive") return parseDatedNameValues(values, tab.year, "archive");
    return parseOpsValues(values);
  }

  function sessionHasContent(sess) {
    if (!sess || !sess.date) return false;
    if (sess.recess) return true;
    if (sess.eventTag) return true;
    if ((sess.kowa || []).length) return true;
    if ((sess.speech || []).length) return true;
    return false;
  }

  function enrichPerson(p) {
    if (!p) return p;
    const mem = p.memberId ? memberById(p.memberId) : matchMember(p.speakerName);
    if (mem) {
      p.memberId = mem.id;
      p.speakerType = "会員";
      if (!p.speakerRole) p.speakerRole = mem.role;
    }
    p.speakerOrg = normalizeAffiliation(p.speakerOrg, mem);
    p.callAs = cleanMultiline(p.callAs);
    return p;
  }

  function mergeSessions(parsedTabs) {
    const byDate = {};
    parsedTabs.forEach(pack => {
      (pack.sessions || []).forEach(sess => {
        if (!sessionHasContent(sess)) return;
        sess.kowa = (sess.kowa || []).map(enrichPerson);
        sess.speech = (sess.speech || []).map(enrichPerson);
        byDate[sess.date] = sess;
      });
    });
    return Object.keys(byDate).sort(cmpDate).map(d => byDate[d]);
  }

  function sessionsToLegacyRows(sessions) {
    return (sessions || []).map(sess => ({
      date: sess.date,
      recess: !!sess.recess,
      format: sess.format || "unset",
      eventTag: sess.eventTag || "",
      kowaRaw: (sess.kowa || []).map(p => p.speakerName).join("・"),
      speechRaw: (sess.speech || []).map(p => p.speakerName).join("・"),
      lecturers: sess.kowa || [],
      speaker: (sess.speech && sess.speech[0]) || null,
      checker: sess.checker || "",
      askOn: sess.askOn || "",
      profileDue: sess.profileDue || "",
      draftDue: sess.draftDue || ""
    }));
  }

  function parseRosterValues(values) {
    return sessionsToLegacyRows(parseOpsValues(values));
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cur = "", q = false;
    const src = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (ch !== "\r") cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  async function fetchCsvGid(id, gid) {
    const url = "https://docs.google.com/spreadsheets/d/" + id + "/export?format=csv&gid=" + gid;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok || /<html/i.test(text.slice(0, 80))) throw new Error("sheet-denied");
    return parseCsv(text);
  }

  function applyHistory(sessions, meta) {
    const history = (sessions || []).filter(s => s && s.date);
    MS.roster.history = history;
    MS.roster.rows = sessionsToLegacyRows(history);
    MS.roster.sheetName = "大阪みなと会員スピーチ";
    MS.roster.savedAt = (meta && meta.savedAt) || MS.roster.savedAt || 0;
    MS.roster.source = (meta && meta.source) || MS.roster.source || "";
    if (history.length) MS.roster.error = "";
  }

  function personFilled(p) {
    return !!(p && String(p.speakerName || "").trim());
  }

  function peopleScore(sess) {
    return ((sess && sess.kowa) || []).filter(personFilled).length
      + ((sess && sess.speech) || []).filter(personFilled).length;
  }

  function mergePersonKeep(prev, next) {
    prev = prev || {};
    next = next || {};
    return {
      speakerName: next.speakerName || prev.speakerName || "",
      speakerOrg: next.speakerOrg || prev.speakerOrg || "",
      speakerRole: next.speakerRole || prev.speakerRole || "",
      callAs: next.callAs || prev.callAs || "",
      title: next.title || prev.title || "",
      memberId: next.memberId || prev.memberId || "",
      speakerType: next.speakerType || prev.speakerType || ""
    };
  }

  function mergePeopleKeep(prevList, nextList) {
    const prev = (prevList || []).filter(personFilled);
    const next = (nextList || []).filter(personFilled);
    if (!next.length) return prev;
    if (!prev.length) return next;
    const longer = next.length >= prev.length ? next : prev;
    const other = next.length >= prev.length ? prev : next;
    return longer.map((p, i) => next.length >= prev.length ? mergePersonKeep(other[i], p) : mergePersonKeep(p, other[i]));
  }

  function mergeSessionKeep(prev, next) {
    if (!prev) return next;
    if (!next) return prev;
    const prevPeople = peopleScore(prev);
    const nextPeople = peopleScore(next);
    if (next.recess && !nextPeople && prevPeople) return prev;
    const kowa = mergePeopleKeep(prev.kowa, next.kowa);
    const speech = mergePeopleKeep(prev.speech, next.speech);
    const recess = (nextPeople || kowa.length || speech.length) ? false : !!(next.recess || prev.recess);
    const eventTag = next.eventTag || prev.eventTag || "";
    const merged = Object.assign({}, prev, next, {
      kowa: kowa,
      speech: speech,
      recess: recess,
      eventTag: eventTag,
      checker: next.checker || prev.checker || "",
      askOn: next.askOn || prev.askOn || "",
      profileDue: next.profileDue || prev.profileDue || "",
      draftDue: next.draftDue || prev.draftDue || ""
    });
    merged.format = sessionFormat(merged);
    return merged;
  }

  function mergeProtectedHistory(cached, incoming) {
    const byDate = {};
    (cached || []).forEach(s => {
      if (s && s.date) byDate[s.date] = s;
    });
    (incoming || []).forEach(s => {
      if (!s || !s.date) return;
      if (!sessionHasContent(s) && byDate[s.date]) return;
      if (!sessionHasContent(s)) return;
      byDate[s.date] = mergeSessionKeep(byDate[s.date], s);
    });
    return Object.keys(byDate).sort(cmpDate).map(d => byDate[d]);
  }

  function readLocalHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "null");
      if (raw && Array.isArray(raw.sessions) && raw.sessions.length) return raw;
    } catch (e) { /* ignore */ }
    return null;
  }

  function saveHistoryCache(sessions, savedAt) {
    const pack = { savedAt: savedAt || Date.now(), sessions: sessions || [] };
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(pack)); } catch (e) { /* ignore */ }
    return pack;
  }

  function hydrateHistory() {
    let sessions = [];
    let savedAt = 0;
    const bundle = global.MS_HISTORY_SNAPSHOT;
    if (bundle && Array.isArray(bundle.sessions) && bundle.sessions.length) {
      sessions = mergeProtectedHistory(sessions, bundle.sessions);
      savedAt = Number(bundle.savedAt || 0);
    }
    const local = readLocalHistory();
    if (local) {
      sessions = mergeProtectedHistory(sessions, local.sessions);
      savedAt = Math.max(savedAt, Number(local.savedAt || 0));
    }
    if (!sessions.length) return false;
    applyHistory(sessions, { savedAt: savedAt, source: local ? "cache" : "bundle" });
    if (!local) saveHistoryCache(sessions, savedAt || Date.now());
    return true;
  }

  async function pullSessionsFromSheet() {
    const spec = MS_CONFIG.speechSheet || {};
    const tabs = spec.tabs || [];
    const parsed = [];
    if (tabs.length && spec.id) {
      const results = await Promise.all(tabs.map(async tab => {
        try {
          const values = await fetchCsvGid(spec.id, tab.gid);
          return { tab: tab, sessions: parseTabValues(tab, values) };
        } catch (e) {
          return { tab: tab, sessions: [], error: e.message || String(e) };
        }
      }));
      results.forEach(pack => parsed.push(pack));
    }
    if (!parsed.some(p => p.sessions && p.sessions.length) && MS.state.speechRoster) {
      const pack = MS.state.speechRoster;
      if (pack.tabs && pack.tabs.length) {
        pack.tabs.forEach(t => {
          const tab = tabs.find(x => x.name === t.name) || { name: t.name, kind: "ops" };
          parsed.push({ tab: tab, sessions: parseTabValues(tab, t.values || []) });
        });
      } else if (pack.values) {
        parsed.push({ tab: { kind: "ops", name: pack.sheetName }, sessions: parseTabValues({ kind: "ops" }, pack.values) });
      }
    }
    if (!parsed.some(p => p.sessions && p.sessions.length) && spec.id && spec.gid) {
      const values = await fetchCsvGid(spec.id, spec.gid);
      parsed.push({ tab: { kind: "detail", name: spec.gid }, sessions: parseTabValues({ kind: "detail" }, values) });
    }
    return mergeSessions(parsed);
  }

  async function fetchRoster(opts) {
    opts = opts || {};
    MS.roster.notice = "";
    if (!opts.force && hydrateHistory()) return;
    const prev = (MS.roster.history || []).slice();
    const prevSavedAt = MS.roster.savedAt || 0;
    try {
      const incoming = await pullSessionsFromSheet();
      if (!incoming.length) {
        if (prev.length) {
          applyHistory(prev, { savedAt: prevSavedAt, source: "cache" });
          MS.roster.notice = "担当表に今回のデータがありませんでした。保存してある履歴を表示しています。";
          return;
        }
        MS.roster.error = "担当表を読めませんでした";
        return;
      }
      const merged = mergeProtectedHistory(prev, incoming);
      const pack = saveHistoryCache(merged, Date.now());
      applyHistory(merged, { savedAt: pack.savedAt, source: "sheet" });
    } catch (e) {
      if (prev.length) {
        applyHistory(prev, { savedAt: prevSavedAt, source: "cache" });
        MS.roster.notice = "担当表を読めませんでした。保存してある履歴を表示しています。";
        return;
      }
      MS.roster.error = e.message || "担当表を読めませんでした";
    }
  }

  async function refreshHistory() {
    await fetchRoster({ force: true });
    return {
      savedAt: MS.roster.savedAt,
      count: (MS.roster.history || []).length,
      notice: MS.roster.notice || "",
      error: MS.roster.error || ""
    };
  }

  function rosterOf(date) {
    return MS.roster.rows.find(r => r.date === date) || null;
  }

  function rosterSlots(row) {
    if (!row || row.recess) return [];
    const date = row.date;
    const slots = [];
    if (row.format === "double") {
      (row.lecturers.length ? row.lecturers : [null, null]).slice(0, 2).forEach((p, i) => {
        const person = p || { speakerName: "", speakerOrg: "", memberId: "", speakerType: "会員" };
        slots.push(Object.assign({
          id: slotId(date, "ハーフ講話", i + 1),
          date, kind: "ハーフ講話", order: i + 1,
          title: "", status: "未依頼", note: row.eventTag || ""
        }, person));
      });
      if (slots.length === 1) {
        slots.push({
          id: slotId(date, "ハーフ講話", 2), date, kind: "ハーフ講話", order: 2,
          speakerType: "会員", memberId: "", speakerName: "", speakerOrg: "",
          title: "", status: "未依頼", note: row.eventTag || ""
        });
      }
      return slots;
    }
    if (row.lecturers[0]) {
      slots.push(Object.assign({
        id: slotId(date, "講話", 1),
        date, kind: "講話", order: 1,
        title: "", status: "未依頼", note: row.eventTag || ""
      }, row.lecturers[0]));
    }
    if (row.speaker) {
      slots.push(Object.assign({
        id: slotId(date, "会員スピーチ", 1),
        date, kind: "会員スピーチ", order: 1,
        title: "", status: "未依頼", note: ""
      }, row.speaker));
    }
    return slots;
  }

  function buildRosterOps(start, end) {
    const opsSessions = [];
    const opsSlots = [];
    const opsTasks = [];
    const deleteTaskIds = [];
    MS.roster.rows.forEach(row => {
      if (start && row.date < start) return;
      if (end && row.date > end) return;
      const existing = sessionOf(row.date) || { date: row.date, venue: "", note: "" };
      const status = row.recess ? "休会" : (existing.status && existing.status !== "休会" ? existing.status : "予定");
      const noteParts = [existing.note, row.eventTag].filter(Boolean);
      const note = Array.from(new Set(noteParts)).join(" ");
      const format = row.recess ? "unset" : (row.format === "unset" ? (existing.format || "unset") : row.format);
      if (!existing.date || existing.status !== status || existing.format !== format || (row.eventTag && (existing.note || "").indexOf(row.eventTag) < 0)) {
        opsSessions.push(Object.assign({}, existing, { date: row.date, status, format, note }));
      }
      if (row.recess || format === "unset") return;
      const desired = rosterSlots(row);
      const current = slotsOf(row.date);
      desired.forEach(d => {
        const old = current.find(c => c.id === d.id) || {};
        const next = Object.assign({}, old, d, {
          speakerName: d.speakerName,
          speakerOrg: d.speakerOrg,
          memberId: d.memberId,
          speakerType: d.speakerType,
          note: d.note || old.note || ""
        });
        if (!old.id || old.speakerName !== next.speakerName || old.speakerOrg !== next.speakerOrg || old.memberId !== next.memberId) {
          opsSlots.push(next);
        }
        tasksForSlot(row.date, next).forEach(t => {
          const prev = taskById(t.id);
          let due = t.dueDate;
          if ((t.templateKey === "resume_due" || t.templateKey === "resume_check") && row.profileDue) due = row.profileDue;
          if ((t.templateKey === "handout") && row.draftDue) due = row.draftDue;
          const assignee = (prev && prev.assignee) || row.checker || "";
          const merged = Object.assign({}, t, prev || {}, {
            title: t.title,
            lane: t.lane,
            dueDate: prev && prev.dueDate && !row.profileDue && !row.draftDue ? prev.dueDate : due,
            assignee: assignee,
            status: (prev && prev.status) || t.status,
            doneAt: (prev && prev.doneAt) || "",
            doneBy: (prev && prev.doneBy) || "",
            note: (prev && prev.note) || ""
          });
          if (t.templateKey === "ask") {
            const synced = applyAskStatus(merged, next);
            merged.status = synced.status;
            merged.doneAt = synced.doneAt;
            merged.doneBy = synced.doneBy;
          }
          if (t.templateKey === "contact" && !prev) {
            const oldApp = taskById(taskId(row.date, "approach", next.id));
            if (oldApp) {
              merged.status = oldApp.status;
              merged.doneAt = oldApp.doneAt || "";
              merged.doneBy = oldApp.doneBy || "";
              merged.assignee = oldApp.assignee || merged.assignee;
              merged.note = oldApp.note || merged.note;
              deleteTaskIds.push(oldApp.id);
            }
          }
          if (!prev || prev.title !== merged.title || prev.dueDate !== merged.dueDate || prev.assignee !== merged.assignee || prev.status !== merged.status) {
            opsTasks.push(merged);
          }
        });
      });
      const decide = taskById(taskId(row.date, "format_decide"));
      if (decide && decide.status !== "完了" && format !== "unset") {
        opsTasks.push(Object.assign({}, decide, {
          status: "完了", doneAt: todayYmd(), doneBy: MS.who.name || "担当表"
        }));
      }
    });
    const ops = [];
    if (opsSessions.length) ops.push({ op: "upsert", sheet: "sessions", rows: opsSessions });
    if (opsSlots.length) ops.push({ op: "upsert", sheet: "slots", rows: opsSlots });
    if (opsTasks.length) ops.push({ op: "upsert", sheet: "tasks", rows: opsTasks });
    if (deleteTaskIds.length) ops.push({ op: "delete", sheet: "tasks", ids: deleteTaskIds });
    return ops;
  }

  /* ---------- 状態ヘルパ ---------- */
  function sessionOf(date) {
    return MS.state.sessions.find(s => s.date === date) || null;
  }
  function slotsOf(date) {
    return MS.state.slots.filter(s => s.date === date).sort((a, b) => Number(a.order) - Number(b.order) || a.kind.localeCompare(b.kind, "ja"));
  }
  function tasksOf(date) {
    return MS.state.tasks.filter(t => t.date === date);
  }
  function recordOf(date) {
    return MS.state.records.find(r => r.date === date) || null;
  }
  function slotById(id) {
    return MS.state.slots.find(s => s.id === id) || null;
  }
  function taskById(id) {
    return MS.state.tasks.find(t => t.id === id) || null;
  }

  function slotId(date, kind, order) {
    const k = ({ "講話": "kowa", "ハーフ講話": "half", "会員スピーチ": "speech" })[kind] || "x";
    return "s_" + date + "_" + k + "_" + order;
  }
  function taskId(date, templateKey, slotIdVal) {
    return "t_" + date + "_" + templateKey + (slotIdVal ? "_" + slotIdVal : "");
  }

  function taskTone(task) {
    if (!task) return "open";
    if (task.status === "完了" || task.status === "不要") return "done";
    if (!task.dueDate) return "open";
    const today = todayYmd();
    if (task.dueDate < today) return "overdue";
    if (task.dueDate <= addDays(today, 3)) return "soon";
    return "open";
  }

  function openTasks() {
    return MS.state.tasks.filter(t => t.status !== "完了" && t.status !== "不要");
  }

  function assignees() {
    const set = new Set(cfg().assignees || []);
    MS.state.tasks.forEach(t => { if (t.assignee) set.add(t.assignee); });
    if (MS.who.name) set.add(MS.who.name);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }

  /* ---------- 自動生成 ---------- */
  function buildBootstrapOps(dates) {
    const opsSessions = [];
    const opsTasks = [];
    dates.forEach(date => {
      const kind = msKindOn(date);
      if (!kind) return;
      const existing = sessionOf(date);
      const status = kind === "recess" ? "休会" : (existing && existing.status) || "予定";
      if (!existing) {
        opsSessions.push({
          date, status, format: kind === "recess" ? "unset" : "unset",
          venue: "", note: ""
        });
      } else if (kind === "recess" && existing.status !== "休会") {
        opsSessions.push(Object.assign({}, existing, { status: "休会" }));
      }
      if (kind === "held") {
        const fmt = (existing && existing.format) || "unset";
        if (fmt === "unset" || !fmt) {
          const id = taskId(date, "format_decide");
          if (!taskById(id)) {
            const tmpl = cfg().templates.find(t => t.key === "format_decide");
            opsTasks.push({
              id, date, lane: "other", slotId: "", templateKey: "format_decide",
              title: tmpl ? tmpl.title : "この回の構成を決める",
              dueDate: addDays(date, tmpl ? tmpl.offset : -100),
              assignee: "", status: "未着手", doneAt: "", doneBy: "", note: ""
            });
          }
        }
      }
    });
    const ops = [];
    if (opsSessions.length) ops.push({ op: "upsert", sheet: "sessions", rows: opsSessions });
    if (opsTasks.length) ops.push({ op: "upsert", sheet: "tasks", rows: opsTasks });
    return ops;
  }

  function speakerDecided(slot) {
    return !!(slot && String(slot.speakerName || "").trim());
  }

  function applyAskStatus(task, slot) {
    if (!task || task.templateKey !== "ask") return task;
    const decided = speakerDecided(slot);
    return Object.assign({}, task, {
      status: decided ? "完了" : "未着手",
      doneAt: decided ? (task.doneAt || todayYmd()) : "",
      doneBy: decided ? (task.doneBy || "担当表") : ""
    });
  }

  function isRosterDriven(task) {
    return !!(task && task.templateKey === "ask");
  }

  function isDecidePart(task) {
    return !!(task && (task.templateKey === "ask" || task.templateKey === "contact" || task.templateKey === "approach"));
  }

  function speechSheetUrl() {
    return (MS_CONFIG.speechSheet && MS_CONFIG.speechSheet.url) || "#";
  }

  function personLabel(p) {
    if (!p) return "";
    return String(p.speakerName || "").trim();
  }

  function historyRows() {
    const rows = (MS.roster.history || []).slice();
    const have = new Set(rows.map(r => r.date));
    (MS.state.slots || []).forEach(s => {
      if (have.has(s.date)) return;
      have.add(s.date);
      const sess = emptySession(s.date);
      const p = {
        speakerName: s.speakerName || "",
        speakerOrg: s.speakerOrg || "",
        speakerRole: "",
        callAs: "",
        memberId: s.memberId || "",
        speakerType: s.speakerType || ""
      };
      if (s.kind === "会員スピーチ") sess.speech.push(p);
      else sess.kowa.push(p);
      rows.push(finalizeSession(sess));
    });
    return rows.filter(sessionHasContent).sort((a, b) => cmpDate(a.date, b.date));
  }

  function decideTitle(kind) {
    return (kind === "会員スピーチ" ? "会員スピーチ者" : "講話者") + "を決める";
  }

  function decideDueOffset() {
    const t = cfg().templates.find(x => x.key === "contact") || cfg().templates.find(x => x.key === "ask");
    return t ? t.offset : -90;
  }

  function decideBundle(slot) {
    if (!slot) return null;
    const ask = taskById(taskId(slot.date, "ask", slot.id));
    const contact = taskById(taskId(slot.date, "contact", slot.id))
      || taskById(taskId(slot.date, "approach", slot.id));
    return {
      slot: slot,
      ask: ask,
      contact: contact,
      title: decideTitle(slot.kind),
      dueDate: (contact && contact.dueDate) || (ask && ask.dueDate) || addDays(slot.date, decideDueOffset())
    };
  }

  function decideTone(bundle) {
    if (!bundle || !bundle.slot) return "open";
    const decided = speakerDecided(bundle.slot);
    const contactDone = !!(bundle.contact && (bundle.contact.status === "完了" || bundle.contact.status === "不要"));
    if (decided && contactDone) return "done";
    const today = todayYmd();
    if (bundle.dueDate && bundle.dueDate < today) return "overdue";
    if (bundle.dueDate && bundle.dueDate <= addDays(today, 3)) return "soon";
    return "open";
  }

  function openDecideBundles() {
    const today = todayYmd();
    return (MS.state.slots || [])
      .filter(s => s.date && s.date >= today)
      .map(decideBundle)
      .filter(b => b && decideTone(b) !== "done");
  }

  function decideChecksHtml(slot) {
    const b = decideBundle(slot);
    const decided = speakerDecided(slot);
    const contactDone = !!(b && b.contact && (b.contact.status === "完了" || b.contact.status === "不要"));
    const speaker = String(slot.speakerName || "").trim();
    return '<div class="subchecks">' +
      '<label class="subcheck locked' + (decided ? " on" : "") + '">' +
        '<input type="checkbox" tabindex="-1" disabled' + (decided ? " checked" : "") + ">" +
        "<span>決まった" + (speaker ? "（" + escapeHtml(speaker) + "）" : "（担当表にまだ名前がない）") + "</span>" +
      "</label>" +
      '<label class="subcheck' + (contactDone ? " on" : "") + '">' +
        '<input type="checkbox" data-toggle-contact="' + escapeHtml(slot.id) + '"' + (contactDone ? " checked" : "") + ">" +
        "<span>連絡を取る</span>" +
      "</label>" +
      "</div>";
  }

  function ensureContactTask(slot) {
    const generated = tasksForSlot(slot.date, slot).find(t => t.templateKey === "contact");
    const existing = taskById(generated.id) || taskById(taskId(slot.date, "approach", slot.id));
    if (!existing) return generated;
    if (existing.templateKey === "approach") {
      return Object.assign({}, generated, {
        status: existing.status,
        doneAt: existing.doneAt || "",
        doneBy: existing.doneBy || "",
        assignee: existing.assignee || "",
        note: existing.note || ""
      });
    }
    return Object.assign({}, generated, existing, { title: generated.title, templateKey: "contact", id: generated.id });
  }

  async function setContactDone(slotId, done) {
    const slot = slotById(slotId);
    if (!slot) throw new Error("枠が見つかりません");
    const task = ensureContactTask(slot);
    const prev = {
      status: task.status,
      doneAt: task.doneAt || "",
      doneBy: task.doneBy || ""
    };
    const next = Object.assign({}, task, {
      status: done ? "完了" : "未着手",
      doneAt: done ? todayYmd() : "",
      doneBy: done ? (MS.who.name || "") : ""
    });
    const ops = [{ op: "upsert", sheet: "tasks", rows: [next] }];
    const oldApp = taskById(taskId(slot.date, "approach", slot.id));
    if (oldApp) ops.push({ op: "delete", sheet: "tasks", ids: [oldApp.id] });
    pendingContact[slotId] = next;
    applyLocalOps(ops);
    try {
      await saveOps(ops);
    } catch (e) {
      applyLocalOps([{ op: "upsert", sheet: "tasks", rows: [Object.assign({}, next, prev)] }]);
      throw e;
    } finally {
      delete pendingContact[slotId];
    }
  }

  function hasPendingContact() {
    return Object.keys(pendingContact).length > 0;
  }

  function contactBoxes(slotId) {
    return Array.prototype.filter.call(document.querySelectorAll("[data-toggle-contact]"), function (el) {
      return el.getAttribute("data-toggle-contact") === slotId;
    });
  }

  function paintContactPending(slotId, done) {
    contactBoxes(slotId).forEach(box => {
      box.checked = !!done;
      box.disabled = true;
      const root = box.closest(".todo.decide-item, .chip.slot-block, .decide-box");
      if (!root) return;
      if (done) {
        root.classList.add("pending-done");
        root.classList.remove("overdue", "soon");
        root.classList.add("done");
      }
    });
  }

  function paintContactSettled(slotId, done, ok) {
    contactBoxes(slotId).forEach(box => {
      const root = box.closest(".todo.decide-item, .chip.slot-block, .decide-box");
      if (!ok) {
        box.checked = !done;
        box.disabled = false;
        if (root) root.classList.remove("pending-done", "done");
        return;
      }
      if (root && root.classList.contains("decide-item") && done) {
        root.classList.add("leaving");
        requestAnimationFrame(function () { root.classList.add("gone"); });
        return;
      }
      box.disabled = false;
      if (root) root.classList.remove("pending-done");
    });
  }

  function tasksForSlot(date, slot) {
    const lane = laneOfKind(slot.kind);
    return cfg().templates.filter(t => t.stage === 2).map(t => {
      const task = {
        id: taskId(date, t.key, slot.id),
        date,
        lane: t.lane === "slot" ? lane : t.lane,
        slotId: slot.id,
        templateKey: t.key,
        title: taskAction({ templateKey: t.key, title: t.title }, slot.kind),
        dueDate: addDays(date, t.offset),
        assignee: "",
        status: "未着手",
        doneAt: "",
        doneBy: "",
        note: ""
      };
      return t.key === "ask" ? applyAskStatus(task, slot) : task;
    });
  }

  const TASK_ACTIONS = {
    format_decide: "この回の構成を決める",
    ask: "決まった",
    contact: "連絡を取る",
    approach: "連絡を取る",
    confirm: "依頼を確定し、レジュメ作成を依頼する",
    resume_due: "事前レジュメの提出期限",
    resume_check: "レジュメが届いたか確認する",
    title_fill: "演題をカレンダーに記入する",
    handout: "当日配布資料のデータを受け取る",
    print: "印刷を完了する"
  };

  function slotKindOf(task) {
    if (!task || task.templateKey === "format_decide") return "";
    const slot = task.slotId ? slotById(task.slotId) : null;
    if (slot && slot.kind) return slot.kind;
    const lane = laneById(task.lane);
    if (lane && lane.name && lane.name !== "その他") return lane.name;
    return "";
  }

  function taskAction(task, kindHint) {
    const kind = kindHint || slotKindOf(task);
    const base = TASK_ACTIONS[task.templateKey];
    if (!base) {
      const raw = String(task.title || "");
      return raw.replace(/^[^：:]{1,40}[：:]/, "") || raw;
    }
    if (!kind) return base;
    if (task.templateKey === "ask") return "決まった";
    if (task.templateKey === "contact" || task.templateKey === "approach") return "連絡を取る";
    return kind + "の" + base;
  }

  function taskView(task, compact) {
    const kind = slotKindOf(task);
    const dt = task && task.date ? parseYmd(task.date) : null;
    const sessionTag = !dt ? "モーニングセミナー"
      : compact
        ? (dt.getMonth() + 1) + "月" + dt.getDate() + "日（" + WDAYS[dt.getDay()] + "）MS"
        : jaDate(task.date, true) + "のモーニングセミナー";
    return { sessionTag, kindTag: kind, action: taskAction(task) };
  }

  function taskTagsHtml(task, compact) {
    const v = taskView(task, compact);
    return '<span class="tags">' +
      '<span class="tag">' + escapeHtml(v.sessionTag) + '</span>' +
      (v.kindTag ? '<span class="tag kind">' + escapeHtml(v.kindTag) + '</span>' : "") +
      "</span>";
  }

  function applyFormatOps(date, formatId) {
    const format = formatById(formatId);
    const desired = (format.slots || []).map(s => ({
      id: slotId(date, s.kind, s.order),
      date,
      kind: s.kind,
      order: s.order,
      speakerType: "会員",
      memberId: "",
      speakerName: "",
      speakerOrg: "",
      title: "",
      status: "未依頼",
      note: ""
    }));
    const current = slotsOf(date);
    const keep = [];
    const create = [];
    desired.forEach(d => {
      const old = current.find(c => c.kind === d.kind && String(c.order) === String(d.order));
      if (old) {
        keep.push(Object.assign({}, old, { id: old.id }));
      } else {
        create.push(d);
      }
    });
    const keptIds = new Set(keep.map(s => s.id).concat(create.map(s => s.id)));
    const removeSlots = current.filter(s => !keptIds.has(s.id));
    const removeSlotIds = new Set(removeSlots.map(s => s.id));

    const nextSlots = keep.concat(create);
    const existingTasks = tasksOf(date);
    const nextTasks = [];
    nextSlots.forEach(slot => {
      tasksForSlot(date, slot).forEach(t => {
        const old = existingTasks.find(x => x.id === t.id);
        let merged = old ? Object.assign({}, t, {
          assignee: old.assignee,
          status: old.status,
          doneAt: old.doneAt,
          doneBy: old.doneBy,
          note: old.note
        }) : t;
        if (t.templateKey === "ask") merged = applyAskStatus(merged, slot);
        if (t.templateKey === "contact" && !old) {
          const oldApp = existingTasks.find(x => x.templateKey === "approach" && x.slotId === slot.id);
          if (oldApp) {
            merged = Object.assign({}, merged, {
              status: oldApp.status,
              doneAt: oldApp.doneAt,
              doneBy: oldApp.doneBy,
              assignee: oldApp.assignee || merged.assignee,
              note: oldApp.note || merged.note
            });
          }
        }
        nextTasks.push(merged);
      });
    });

    const session = sessionOf(date) || { date, status: "予定", venue: "", note: "" };
    const deleteTaskIds = existingTasks
      .filter(t => t.templateKey === "approach" || (t.templateKey !== "format_decide" && (removeSlotIds.has(t.slotId) || (t.slotId && !keptIds.has(t.slotId)))))
      .map(t => t.id);
    const formatTask = existingTasks.find(t => t.templateKey === "format_decide");

    const ops = [
      { op: "upsert", sheet: "sessions", rows: [Object.assign({}, session, { format: formatId, status: session.status === "休会" ? "休会" : session.status || "予定" })] }
    ];
    if (removeSlots.length) ops.push({ op: "delete", sheet: "slots", ids: removeSlots.map(s => s.id) });
    if (nextSlots.length) ops.push({ op: "upsert", sheet: "slots", rows: nextSlots });
    if (deleteTaskIds.length) ops.push({ op: "delete", sheet: "tasks", ids: deleteTaskIds });
    if (nextTasks.length) ops.push({ op: "upsert", sheet: "tasks", rows: nextTasks });
    if (formatTask && formatId !== "unset" && formatTask.status !== "完了") {
      ops.push({
        op: "upsert", sheet: "tasks", rows: [Object.assign({}, formatTask, {
          status: "完了",
          doneAt: todayYmd(),
          doneBy: MS.who.name
        })]
      });
    }
    return ops;
  }

  function refreshSlotTaskTitles(slot) {
    const date = slot.date;
    const generated = tasksForSlot(date, slot);
    return generated.map(t => {
      const old = taskById(t.id);
      if (!old) return t;
      const next = Object.assign({}, old, { title: t.title, lane: t.lane });
      return t.templateKey === "ask" ? applyAskStatus(next, slot) : next;
    });
  }

  /* ---------- 依頼文 ---------- */
  function messageVars(date, slot) {
    const tmpls = cfg().templates;
    const off = key => {
      const t = tmpls.find(x => x.key === key);
      return addDays(date, t ? t.offset : 0);
    };
    return {
      name: (slot && slot.speakerName) || "〇〇",
      date: jaDate(date, false),
      weekday: WDAYS[weekday(date)],
      kind: (slot && slot.kind) || "講話",
      title: (slot && slot.title) || "（演題未定）",
      org: (slot && slot.speakerOrg) || "",
      resumeDue: jaDate(off("resume_due"), true),
      handoutDue: jaDate(off("handout"), true),
      printDue: jaDate(off("print"), true)
    };
  }

  function fillMessage(kind, date, slot) {
    let text = (MS_CONFIG.messages && MS_CONFIG.messages[kind]) || "";
    const vars = messageVars(date, slot);
    Object.keys(vars).forEach(k => {
      text = text.split("{" + k + "}").join(vars[k]);
    });
    return text;
  }

  /* ---------- UI 共通 ---------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function setSaveFlag(on) {
    const el = document.getElementById("ms-save-flag");
    if (el) el.hidden = !on;
  }

  function toast(msg) {
    let el = document.getElementById("ms-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ms-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = "show";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = ""; }, 2200);
  }

  function showAuthGate(onFail) {
    return new Promise(resolve => {
      const overlay = document.getElementById("auth-overlay");
      if (!overlay) { resolve(false); return; }
      overlay.hidden = false;
      const nameEl = document.getElementById("auth-name");
      const keyEl = document.getElementById("auth-key");
      const errEl = document.getElementById("auth-error");
      const keyRow = document.getElementById("auth-key-row");
      if (nameEl) nameEl.value = MS.who.name || "";
      if (keyEl) keyEl.value = MS.who.key || "";
      if (keyRow) keyRow.hidden = !endpointReady();
      if (errEl) errEl.textContent = onFail ? "合言葉が違います。もう一度入力してください。" : "";
      const form = document.getElementById("auth-form");
      form.onsubmit = ev => {
        ev.preventDefault();
        MS.who.name = (nameEl.value || "").trim();
        MS.who.key = (keyEl ? keyEl.value : "") || "";
        if (!MS.who.name) { if (errEl) errEl.textContent = "お名前を入れてください。"; return; }
        if (endpointReady() && !MS.who.key) { if (errEl) errEl.textContent = "合言葉を入れてください。"; return; }
        saveAuth();
        overlay.hidden = true;
        resolve(true);
      };
    });
  }

  async function boot() {
    loadAuth();
    loadMeibo();
    if (needsAuthGate()) {
      await showAuthGate(false);
    }
    try {
      const r = await withTimeout(fetchState(), 20000, "保存データの読み込みが遅いです");
      if (r.error === "unauthorized") {
        MS.who.key = "";
        saveAuth();
        await showAuthGate(true);
        const r2 = await withTimeout(fetchState(), 20000, "合言葉を確認できませんでした");
        if (r2.error === "unauthorized") throw new Error("合言葉が違います");
      }
    } catch (e) {
      loadCachedState();
      toast(e.message || "保存データの読み込みに失敗しました");
    }
    await Promise.all([
      withTimeout(fetchAnnual(), 12000, "年間スケジュールを読めませんでした").catch(e => { MS.annual.error = e.message; }),
      withTimeout(fetchRoster(), 25000, "担当表を読めませんでした").catch(e => { MS.roster.error = MS.roster.error || e.message; })
    ]);
    const dates = eachDate(monthSpan(MS_CONFIG.months || 3));
    const start = dates[0];
    const end = dates[dates.length - 1];
    const extra = (MS.annual.events || []).filter(isMsEvent).map(e => e.date)
      .concat(MS.roster.rows.map(r => r.date))
      .filter(d => d >= start && d <= end);
    const bootDates = Array.from(new Set(dates.concat(extra)));
    const ops = buildBootstrapOps(bootDates).concat(buildRosterOps(start, end));
    if (ops.length) applyLocalOps(ops);
    MS._pendingOps = ops;
    const whoEl = document.getElementById("who-name");
    if (whoEl) whoEl.textContent = MS.who.name || "";
    const modeEl = document.getElementById("store-mode");
    if (modeEl) {
      if (MS.localOnly) {
        modeEl.hidden = false;
        modeEl.className = "banner";
        modeEl.textContent = "この端末にだけ保存されています。みんなで共有するにはスプレッドシート連携が必要です。";
      } else if (MS.roster.notice) {
        modeEl.hidden = false;
        modeEl.className = "banner";
        modeEl.textContent = MS.roster.notice;
      } else if (MS.roster.error && !MS.roster.rows.length) {
        modeEl.hidden = false;
        modeEl.className = "banner";
        modeEl.textContent = "担当表を読めませんでした。ページを再読み込みするか、「更新」で再度取り込んでください。";
      } else {
        modeEl.hidden = true;
      }
    }
  }

  async function persistGenerated() {
    const ops = MS._pendingOps;
    MS._pendingOps = null;
    if (!ops || !ops.length) return { ok: true };
    if (!endpointReady()) {
      cacheState();
      return { ok: true, local: true };
    }
    try {
      return await saveOps(ops);
    } catch (e) {
      toast(e.message || "保存に時間がかかっています。カレンダーはそのまま使えます。");
      return { ok: false, error: e.message };
    }
  }

  function logout() {
    MS.who = { name: "", key: "" };
    saveAuth();
    location.reload();
  }

  MS.WDAYS = WDAYS;
  MS.HOLIDAYS = HOLIDAYS;
  MS.ymd = ymd;
  MS.todayYmd = todayYmd;
  MS.addDays = addDays;
  MS.daysInMonth = daysInMonth;
  MS.weekday = weekday;
  MS.jaDate = jaDate;
  MS.cmpDate = cmpDate;
  MS.nendoStartYear = nendoStartYear;
  MS.nendoKey = nendoKey;
  MS.nendoLabel = nendoLabel;
  MS.nendoRangeLabel = nendoRangeLabel;
  MS.nendosOf = nendosOf;
  MS.currentNendoKey = currentNendoKey;
  MS.tuesdaysInNendo = tuesdaysInNendo;
  MS.fillTuesdaySlots = fillTuesdaySlots;
  MS.nextSessionDate = nextSessionDate;
  MS.monthSpan = monthSpan;
  MS.eachDate = eachDate;
  MS.cfg = cfg;
  MS.formatById = formatById;
  MS.formatName = formatName;
  MS.laneById = laneById;
  MS.laneOfKind = laneOfKind;
  MS.searchMembers = searchMembers;
  MS.memberById = memberById;
  MS.annualByDate = annualByDate;
  MS.catById = catById;
  MS.isMsEvent = isMsEvent;
  MS.msKindOn = msKindOn;
  MS.rosterOf = rosterOf;
  MS.sessionOf = sessionOf;
  MS.slotsOf = slotsOf;
  MS.tasksOf = tasksOf;
  MS.recordOf = recordOf;
  MS.slotById = slotById;
  MS.taskById = taskById;
  MS.slotId = slotId;
  MS.taskTone = taskTone;
  MS.openTasks = openTasks;
  MS.assignees = assignees;
  MS.applyFormatOps = applyFormatOps;
  MS.taskView = taskView;
  MS.taskAction = taskAction;
  MS.taskTagsHtml = taskTagsHtml;
  MS.refreshSlotTaskTitles = refreshSlotTaskTitles;
  MS.tasksForSlot = tasksForSlot;
  MS.isRosterDriven = isRosterDriven;
  MS.isDecidePart = isDecidePart;
  MS.decideTitle = decideTitle;
  MS.decideBundle = decideBundle;
  MS.decideTone = decideTone;
  MS.openDecideBundles = openDecideBundles;
  MS.decideChecksHtml = decideChecksHtml;
  MS.setContactDone = setContactDone;
  MS.paintContactPending = paintContactPending;
  MS.paintContactSettled = paintContactSettled;
  MS.hasPendingContact = hasPendingContact;
  MS.speechSheetUrl = speechSheetUrl;
  MS.historyRows = historyRows;
  MS.refreshHistory = refreshHistory;
  MS.loadMeibo = loadMeibo;
  MS.fillMessage = fillMessage;
  MS.escapeHtml = escapeHtml;
  MS.toast = toast;
  MS.boot = boot;
  MS.persistGenerated = persistGenerated;
  MS.saveOps = saveOps;
  MS.logout = logout;
  MS.endpointReady = endpointReady;

  global.MS = MS;
})(typeof window !== "undefined" ? window : globalThis);
