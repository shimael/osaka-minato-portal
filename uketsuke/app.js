/* ============================================================
 *  モーニングセミナー受付 ― 共通ロジック
 *  かな検索 / 受付登録 / 集計 / 通信・合言葉 / 回（日付＋イベント名）管理
 *
 *  保存の考え方（重要）:
 *  画面の操作は「まずこの端末にすぐ反映」→「裏でスプレッドシートへ
 *  少しずつ同期」の2段構えにしてある。ネットが遅い・切れていても、
 *  受付の入力そのものは一切待たされない。同期は裏で自動リトライする。
 *
 *  「回」の考え方:
 *  受付は「日付＋イベント名」の組み合わせ（＝1回）ごとに分けて保存する。
 *  例：2026-09-11／モーニングセミナー。既定のイベント名は「モーニングセミナー」。
 * ============================================================ */
(function (global) {
  "use strict";

  const AUTH_KEY = "rinri-uketsuke-auth-v1";
  const STORE_KEY = "rinri-uketsuke-store-v2";     // 端末内キャッシュ（{ [date__event]: record[] }）
  const OUTBOX_KEY = "rinri-uketsuke-outbox-v2";   // まだサーバーに届いていない変更の待ち行列
  const SESSIONS_CACHE_KEY = "rinri-uketsuke-sessions-v1"; // 「過去の受付履歴」一覧のキャッシュ
  const LAST_SESSION_KEY = "rinri-uketsuke-last-session-v1"; // 直前に見ていた回
  const MEMBERS_KEY = "rinri-uketsuke-members-v1"; // 「名簿を更新」で取り込んだ会員名簿
  const DEFAULT_EVENT = "モーニングセミナー";

  const U = {
    members: [],
    membersFetchedAt: "",  // 名簿をシートから取り込んだ日時（ISO文字列）
    who: { name: "", key: "" },
    localOnly: true,
    date: todayYmd(),      // 受付タブが対象にする日付
    event: DEFAULT_EVENT,  // 受付タブが対象にするイベント名
    statDate: todayYmd(),  // 集計タブが対象にする日付
    statEvent: DEFAULT_EVENT,
    records: [],            // 今の回の受付データ（会員・他単会。ゲストは含まない）
    guests: [],             // 今の回のゲストデータ
    sessions: [],           // 「過去の受付履歴」一覧のキャッシュ
    sessionStatus: "",      // "" 未登録（新規） / "受付中" / "締切済み"
    attendance: [],         // 今の回の丸ボタン [{key,label}]。空ならモーニングセミナーの3項目
    selected: null,         // 選択中の会員 { id, name, kana, gender, joined } / null なら他単会入力
    tankaiMode: false,      // 他単会として手入力中か
    attend: {},             // { chourei:true, ms:false, share:true }
    syncError: ""           // 同期が構造的に失敗している場合のメッセージ（合言葉不一致など）
  };

  function loadAttendanceDefaults() {
    UKETSUKE_CONFIG.attendance.forEach(a => { U.attend[a.key] = false; });
  }
  loadAttendanceDefaults();

  /* ---------- 日付 ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayYmd() {
    const n = new Date();
    return n.getFullYear() + "-" + pad(n.getMonth() + 1) + "-" + pad(n.getDate());
  }
  function nowHm() {
    const n = new Date();
    return pad(n.getHours()) + ":" + pad(n.getMinutes());
  }
  function nowDateTime() {
    return todayYmd() + " " + nowHm();
  }
  function jaDate(s) {
    if (!s) return "";
    const p = s.split("-").map(Number);
    const dt = new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
    const w = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
    return dt.getFullYear() + "年" + (dt.getMonth() + 1) + "月" + dt.getDate() + "日（" + w + "）";
  }
  function jaDateShort(s) {
    if (!s) return "";
    const p = String(s).split("-").map(Number);
    if (!p[1]) return String(s);
    return p[1] + "月" + (p[2] || 1) + "日";
  }
  function padHm(s) {
    const p = String(s || "").split(":");
    if (p.length < 2) return "";
    return pad(p[0]) + ":" + pad(p[1]);
  }
  /* 受付時刻は「入力した日時」。古いデータは時分だけなので、その回の日付と組み合わせる。 */
  function normalizeRecordTime(r) {
    const raw = String((r && r.time) || "").trim();
    const fallbackDate = String((r && r.date) || todayYmd());
    let ymd = fallbackDate;
    let hm = "";
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/);
    if (m) {
      ymd = m[1];
      hm = padHm(m[2]);
    } else if (/^\d{1,2}:\d{2}$/.test(raw)) {
      hm = padHm(raw);
    } else if (raw) {
      hm = raw;
    }
    return { ymd, hm, sortKey: (ymd || "0000-00-00") + " " + (hm || "99:99") };
  }
  function formatRecordTimeText(r) {
    const t = normalizeRecordTime(r);
    if (!t.hm && !t.ymd) return "";
    return [t.ymd ? jaDateShort(t.ymd) : "", t.hm].filter(Boolean).join(" ");
  }
  function compareRecordTime(a, b) {
    return normalizeRecordTime(a).sortKey.localeCompare(normalizeRecordTime(b).sortKey);
  }
  function recordHasAttendance(r, items) {
    const list = items && items.length ? items : msAttendance();
    return list.some(a => r && r[a.key]);
  }
  function attendLabelsFromItems(items) {
    const list = items || [];
    return ["chourei", "ms", "share"].map(key => {
      const hit = list.find(a => a.key === key);
      return hit ? String(hit.label || "").trim() : "";
    });
  }

  /* iOS の type=date は中身の最小幅が広く、カードからはみ出す。
     見た目は自前の枠、タップだけ本体の日付ピッカーに渡す。 */
  function paintDateFace(input) {
    const wrap = input && input.closest(".date-wrap");
    const face = wrap && wrap.querySelector(".date-face");
    if (!face) return;
    face.textContent = jaDate(input.value) || "日付を選ぶ";
  }
  function bindDateFaces(root) {
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    (root || document).querySelectorAll(".date-wrap input[type='date']").forEach(input => {
      if (input.dataset.dateFaceBound) return;
      input.dataset.dateFaceBound = "1";
      const paint = () => paintDateFace(input);
      input.addEventListener("input", paint);
      input.addEventListener("change", paint);
      if (proto && proto.set) {
        Object.defineProperty(input, "value", {
          get() { return proto.get.call(this); },
          set(v) { proto.set.call(this, v); paint(); }
        });
      }
      paint();
    });
  }

  /* アテンドは画面では2枠（アテンド1・アテンド2）だが、保存先の列は1つ。
     2人いるときは「／」でつなぎ、表示するときは番号を付けずに「、」で並べる。 */
  function splitAttendants(s) {
    const parts = String(s || "").split(/[／/、,]+/).map(x => x.trim()).filter(Boolean);
    return [parts[0] || "", parts[1] || ""];
  }
  function joinAttendants(a, b) {
    return [a, b].map(x => String(x || "").trim()).filter(Boolean).join("／");
  }
  function formatAttendants(s) {
    return splitAttendants(s).filter(Boolean).join("、");
  }

  /* 丸を付ける項目。保存先の列は今までどおり chourei / ms / share の3つ。
     モーニングセミナーはその3つの名前で固定。その他のイベントは、
     回を始めたときに付けた名前を使う（空の枠は出さない）。 */
  const ATTEND_KEYS = ["chourei", "ms", "share"];
  function msAttendance() {
    return (UKETSUKE_CONFIG.attendance || []).map(a => ({ key: a.key, label: a.label }));
  }
  function attendanceFromLabels(event, labels) {
    if (!event || event === DEFAULT_EVENT) return msAttendance();
    const items = [];
    ATTEND_KEYS.forEach((key, i) => {
      const label = String((labels && labels[i]) || "").trim();
      if (label) items.push({ key, label });
    });
    return items.length ? items : [{ key: "chourei", label: "参加" }];
  }
  const ATTEND_CACHE_KEY = "rinri-uketsuke-attend-v1";
  function saveAttendCache(date, event, labels) {
    try {
      const all = JSON.parse(localStorage.getItem(ATTEND_CACHE_KEY) || "{}");
      all[(date || "") + "__" + (event || "")] = labels;
      localStorage.setItem(ATTEND_CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }
  function readAttendCache(date, event) {
    try {
      const all = JSON.parse(localStorage.getItem(ATTEND_CACHE_KEY) || "{}");
      return all[(date || "") + "__" + (event || "")] || null;
    } catch (e) { return null; }
  }
  function attendanceForSession(info, event) {
    event = event || (info && info.event) || DEFAULT_EVENT;
    if (!event || event === DEFAULT_EVENT) return msAttendance();
    let labels = [info && info.attend1, info && info.attend2, info && info.attend3];
    if (!labels.some(x => String(x || "").trim())) {
      const cached = readAttendCache((info && info.date) || U.date, event);
      if (cached) labels = cached;
    }
    return attendanceFromLabels(event, labels);
  }
  function currentAttendance() {
    return (U.attendance && U.attendance.length)
      ? U.attendance
      : attendanceForSession(findSessionInfo(U.date, U.event), U.event);
  }
  function attendShort(a, event) {
    if ((event || U.event) === DEFAULT_EVENT && a.key === "ms") return "MS";
    return a.label;
  }

  /* ---------- かな正規化・検索 ---------- */
  function toHiragana(s) {
    return String(s || "").replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }
  function flatten(s) {
    return toHiragana(String(s || "")).replace(/[\s　]+/g, "").toLowerCase();
  }

  /* ---------- 会員名簿（事前に読み込んでおき、更新ボタンで取り込み直す） ----------
   * 名簿は members-data.js に焼き込んである。ページを開いた時点で候補が出せるので、
   * 受付の最中に電波が切れても名前出しは止まらない。「名簿を更新」を押したときだけ
   * 公開シートの CSV を読みに行き、成功したら端末に保存して以後はそちらを使う。
   * 取り込みに失敗したときは、今持っている名簿をそのまま使い続ける。 */
  function readMembersCache() {
    try {
      const p = JSON.parse(localStorage.getItem(MEMBERS_KEY) || "null");
      if (p && p.members && p.members.length) return p;
    } catch (e) { /* ignore */ }
    return null;
  }
  function writeMembersCache(pack) {
    try { localStorage.setItem(MEMBERS_KEY, JSON.stringify(pack)); } catch (e) { /* ignore */ }
  }
  function newerPack(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (Date.parse(b.fetchedAt || "") || 0) > (Date.parse(a.fetchedAt || "") || 0) ? b : a;
  }

  function applyMembersPack(pack) {
    const rows = (pack && pack.members) || [];
    U.membersFetchedAt = (pack && pack.fetchedAt) || "";
    U.members = rows.map(r => {
      const kana = String(r.kana || "").trim();
      return {
        id: String(r.id || "").trim(),
        name: String(r.name || "").replace(/\s+/g, " ").trim(),
        kana,
        kanaSegs: toHiragana(kana).split(/[\s　]+/).filter(Boolean),
        kanaFlat: flatten(kana),
        nameFlat: flatten(r.name),
        gender: String(r.gender || "").trim(),
        joined: String(r.joined || "").trim(),
        role: String(r.role || "").trim(),
        roleKen: String(r.roleKen || "").trim()
      };
    }).filter(m => m.name);
  }

  function packHasRoles(p) {
    const m = p && p.members && p.members[0];
    return !!(m && Object.prototype.hasOwnProperty.call(m, "role"));
  }

  function loadMembers() {
    const snap = global.UKETSUKE_MEMBERS_SNAPSHOT || null;
    const cache = readMembersCache();
    let pack = newerPack(snap, cache);
    if (pack === cache && cache && !packHasRoles(cache) && snap && packHasRoles(snap)) pack = snap;
    applyMembersPack(pack);
  }

  function membersAgeDays() {
    const t = Date.parse(U.membersFetchedAt || "");
    if (!t) return 999;
    return Math.floor((Date.now() - t) / 86400000);
  }
  function membersAreStale() {
    return membersAgeDays() >= (UKETSUKE_CONFIG.membersStaleDays || 14);
  }

  /* CSV の読み取り。名簿シートは列の並びが変わることがあるので、まず見出し名で
   * 探し、見つからなければ「値の見た目」（男性/女性、YYYY/MM）で当てる。
   * update-uketsuke-members.py と同じ考え方。 */
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else quoted = false;
        } else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(v => (v || "").trim()));
  }

  const GENDER_RE = /^(男性|女性|男|女)$/;
  const JOINED_RE = /^\d{4}[/\-]\d{1,2}$/;

  function colByHeader(header, names) {
    for (let i = 0; i < header.length; i++) {
      if (names.indexOf(String(header[i] || "").replace(/[\s　]+/g, "")) >= 0) return i;
    }
    return -1;
  }
  function colByPattern(rows, re, exclude) {
    const ncols = rows.reduce((n, r) => Math.max(n, r.length), 0);
    let best = -1, bestHits = 0;
    for (let c = 0; c < ncols; c++) {
      if (exclude.indexOf(c) >= 0) continue;
      const vals = rows.map(r => String(r[c] || "").trim()).filter(Boolean);
      if (!vals.length) continue;
      const hits = vals.filter(v => re.test(v)).length;
      if (hits && hits / vals.length > 0.6 && hits > bestHits) { best = c; bestHits = hits; }
    }
    return best;
  }

  function csvToMembers(rows) {
    if (!rows.length) return [];
    const header = rows[0];
    const body = rows.slice(1);
    const idxId = colByHeader(header, ["会員番号"]);
    const idxName = colByHeader(header, ["氏名", "名前"]);
    const idxKana = colByHeader(header, ["読み仮名", "ふりがな", "フリガナ"]);
    if (idxName < 0 || idxKana < 0) return [];

    const known = [idxId, idxName, idxKana].filter(i => i >= 0);
    let idxGender = colByHeader(header, ["性別"]);
    if (idxGender < 0) idxGender = colByPattern(body, GENDER_RE, known);
    let idxJoined = colByHeader(header, ["入会月"]);
    if (idxJoined < 0) idxJoined = colByPattern(body, JOINED_RE, known.concat(idxGender >= 0 ? [idxGender] : []));
    const idxRole = colByHeader(header, ["単会の役職", "役職（単会）", "単会役職", "役職"]);
    let idxRoleKen = colByHeader(header, ["研究所辞令の役職", "研究所辞令役職", "役職（研究所辞令）", "研究所辞令"]);
    if (idxRoleKen === idxRole) idxRoleKen = -1;

    const cell = (r, i) => (i >= 0 && i < r.length ? String(r[i] || "").trim() : "");
    const out = [];
    body.forEach(r => {
      const name = cell(r, idxName).replace(/\s+/g, " ").trim();
      if (!name) return;
      const g = cell(r, idxGender);
      out.push({
        id: cell(r, idxId),
        name,
        kana: cell(r, idxKana).replace(/\s+/g, " ").trim(),
        gender: (g === "女性" || g === "女") ? "女性" : ((g === "男性" || g === "男") ? "男性" : ""),
        joined: cell(r, idxJoined).replace(/-/g, "/"),
        role: cell(r, idxRole),
        roleKen: cell(r, idxRoleKen)
      });
    });
    return out;
  }

  async function refreshMembers() {
    const url = (UKETSUKE_CONFIG.membersCsvUrl || "").trim();
    if (!url) throw new Error("名簿の取り込み元が設定されていません（config.js の membersCsvUrl）。");
    let text;
    try {
      const res = await withTimeout(fetch(url + "&_=" + Date.now(), { cache: "no-store" }), 25000, "timeout");
      if (!res.ok) throw new Error("http " + res.status);
      text = await res.text();
    } catch (e) {
      throw new Error("名簿シートに届きませんでした。今の名簿のまま受付を続けられます。");
    }
    if (!text || text.trim().charAt(0) === "<") {
      throw new Error("名簿シートの公開設定が変わっているようです。今の名簿のまま受付を続けられます。");
    }
    const members = csvToMembers(parseCsv(text));
    if (!members.length) {
      throw new Error("名簿を読み取れませんでした（氏名・読み仮名の列が見つかりません）。今の名簿のままです。");
    }
    const pack = { fetchedAt: new Date().toISOString(), members };
    writeMembersCache(pack);
    applyMembersPack(pack);
    return members.length;
  }

  function searchMembers(q) {
    const s = flatten(q);
    if (!s) return [];
    const hits = [];
    U.members.forEach(m => {
      let score = 0;
      if (m.kanaSegs.some(seg => seg.indexOf(s) === 0)) score = 3;
      else if (m.kanaFlat.indexOf(s) >= 0) score = 2;
      else if (m.nameFlat.indexOf(s) >= 0) score = 1;
      else if (m.id && m.id.indexOf(s) >= 0) score = 1;
      if (score) hits.push({ m, score });
    });
    hits.sort((a, b) => b.score - a.score || a.m.kanaFlat.localeCompare(b.m.kanaFlat, "ja"));
    return hits.slice(0, 12).map(h => h.m);
  }

  /* ---------- 重複受付の検知 ----------
   * 複数の受付担当が同時に入力するので、同じ人が二重に登録されることがある。
   * 会員番号があればそれで、なければ氏名（空白・カナ表記の揺れを無視）で照合する。 */
  function findExisting(list, target, excludeId) {
    const wantId = String((target && target.memberId) || "").trim();
    const wantName = flatten(target && target.name);
    return (list || []).find(r => {
      if (excludeId && r.id === excludeId) return false;
      const rid = String(r.memberId || "").trim();
      if (wantId && rid) return rid === wantId;
      return !!wantName && flatten(r.name) === wantName;
    }) || null;
  }

  /* ---------- 新入会員判定 ---------- */
  function newMemberCutoff() {
    const anchor = UKETSUKE_CONFIG.newMemberAnchorMonth || 5;
    const n = new Date();
    let y = n.getFullYear();
    if (n.getMonth() + 1 < anchor) y -= 1;
    return new Date(y, anchor - 1, 1);
  }
  function isNewMemberJoin(joined) {
    if (!joined) return false;
    const p = String(joined).split(/[\/\-]/).map(Number);
    if (!p[0] || !p[1]) return false;
    const d = new Date(p[0], p[1] - 1, 1);
    return d >= newMemberCutoff();
  }
  function hasRoleText(s) {
    const v = String(s || "").replace(/[\s　]/g, "");
    if (!v) return false;
    return !/^(なし|無し|無|ー|—|-|－|会員|一般)$/.test(v);
  }
  function isOfficerMember(m) {
    return !!(m && (hasRoleText(m.role) || hasRoleText(m.roleKen)));
  }
  function sameMemberId(a, b) {
    const x = String(a || "").trim();
    const y = String(b || "").trim();
    if (!x || !y) return false;
    if (x === y) return true;
    const nx = x.replace(/^0+/, "") || "0";
    const ny = y.replace(/^0+/, "") || "0";
    return nx === ny;
  }
  function findMemberForRecord(r) {
    if (!r) return null;
    const id = String(r.memberId || "").trim();
    if (id) {
      const byId = U.members.find(x => sameMemberId(x.id, id));
      if (byId) return byId;
    }
    const name = flatten(r.name);
    if (!name) return null;
    return U.members.find(x => x.nameFlat === name) || null;
  }
  function recordIsOfficer(r) {
    if (!r || r.type !== "member") return false;
    if (r.isOfficer === true || r.isOfficer === "true") return true;
    if (r.isOfficer === false || r.isOfficer === "false") return false;
    return isOfficerMember(findMemberForRecord(r));
  }

  /* ---------- 認証 ---------- */
  function loadAuth() {
    try {
      const raw = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
      if (raw && raw.name) U.who = { name: String(raw.name), key: currentKey() };
    } catch (e) { /* ignore */ }
  }
  function saveAuth() {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify({ name: U.who.name })); } catch (e) { /* ignore */ }
  }
  function endpointReady() {
    return /^https:\/\//.test((UKETSUKE_CONFIG.api && UKETSUKE_CONFIG.api.endpoint) || "");
  }
  // 合言葉は画面では入力させない。config.js に埋め込んだ固定の鍵をそのまま使う。
  function currentKey() {
    return (UKETSUKE_CONFIG.api && UKETSUKE_CONFIG.api.key) || "";
  }
  function needsAuthGate() {
    return !U.who.name;
  }

  /* ---------- 回（日付＋イベント名）の識別 ---------- */
  function sessionKey(date, event) {
    return String(date || "") + "__" + String(event || DEFAULT_EVENT);
  }

  /* ---------- 端末内キャッシュ ---------- */
  function readLocalStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (e) { return {}; }
  }
  function writeLocalStore(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
  }
  function upsertLocalCache(key, record) {
    const store = readLocalStore();
    const list = store[key] || [];
    const i = list.findIndex(r => r.id === record.id);
    if (i >= 0) list[i] = record; else list.push(record);
    store[key] = list;
    writeLocalStore(store);
  }
  function deleteLocalCache(key, id) {
    const store = readLocalStore();
    store[key] = (store[key] || []).filter(r => r.id !== id);
    writeLocalStore(store);
  }

  /* ---------- 同期待ち行列（オフラインでも受付を止めないための仕組み） ---------- */
  function readOutbox() {
    try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeOutbox(list) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  function opTargetId(op) {
    if (op.op === "upsert") return "rec:" + op.record.id;
    if (op.op === "delete") return "rec:" + op.id;
    return "session"; // close / reopen はその回につき1件に集約
  }

  let syncListener = null;
  function onSyncChange(cb) { syncListener = cb; }
  function notifySyncChange() {
    if (syncListener) { try { syncListener(pendingCount(), U.syncError); } catch (e) { /* ignore */ } }
  }
  function pendingCount() { return readOutbox().length; }

  function queueOp(op) {
    op.opId = uid();
    const outbox = readOutbox().filter(o => !(o.key === op.key && opTargetId(o) === opTargetId(op)));
    outbox.push(op);
    writeOutbox(outbox);
    notifySyncChange();
    flushOutbox();
  }

  let flushing = false;
  let flushTimer = null;

  function opPayload(op) {
    if (op.op === "upsert") return { op: "upsert", record: op.record };
    if (op.op === "delete") return { op: "delete", date: op.date, event: op.event, id: op.id };
    return {
      op: op.op, date: op.date, event: op.event,
      attend1: op.attend1 || "", attend2: op.attend2 || "", attend3: op.attend3 || ""
    };
  }

  let batchUnsupported = false;
  const POST_TIMEOUT_MS = 30000;
  // 待ち行列は最大20件ずつ、1回の通信で送る。21件以上あれば送り終わってから次の20件。
  const BATCH_SIZE = 20;

  async function postOp(body) {
    return withTimeout(apiPost(Object.assign({ updatedBy: U.who.name }, body)), POST_TIMEOUT_MS, "timeout");
  }

  async function flushOne(op) {
    const j = await postOp(opPayload(op));
    if (j && j.ok) return { ok: true };
    const code = j && j.error;
    return {
      ok: false,
      hardError: code === "unauthorized" ? friendlyError("unauthorized") : "",
      rejected: !!code && code !== "busy" && code !== "unauthorized"
    };
  }

  /* まとめて送るのに失敗したら1件ずつ送る。スプレッドシートに断られた1件は
     後ろに回して、その後ろに並んでいる受付（ゲストの到着など）を先に届ける。 */
  async function flushOneByOne(batch) {
    const done = [];
    const rejected = [];
    let hardError = "";
    for (const op of batch) {
      let one;
      try { one = await flushOne(op); } catch (e) { break; }
      if (one.ok) { done.push(op.opId); continue; }
      if (one.hardError) { hardError = one.hardError; break; }
      if (one.rejected) { rejected.push(op.opId); continue; }
      break;
    }
    return { done, rejected, hardError };
  }

  async function flushOutbox() {
    if (flushing || !endpointReady()) { notifySyncChange(); return; }
    flushing = true;
    const skipped = new Set();
    try {
      while (true) {
        const outbox = readOutbox();
        if (!outbox.length) { U.syncError = ""; break; }
        const batch = outbox.filter(o => !skipped.has(o.opId)).slice(0, BATCH_SIZE);
        if (!batch.length) break;
        let doneIds = [];
        let hardError = "";
        let progressed = false;
        try {
          if (!batchUnsupported) {
            const j = await postOp({ op: "batch", ops: batch.map(opPayload) });
            if (j && j.error === "unknown op") batchUnsupported = true;
            else if (j && j.ok) { doneIds = batch.map(o => o.opId); progressed = true; }
            else if (j && j.error === "unauthorized") hardError = friendlyError("unauthorized");
          }
          if (!progressed && !hardError) {
            const r = await flushOneByOne(batch);
            doneIds = r.done;
            hardError = r.hardError;
            r.rejected.forEach(id => skipped.add(id));
            progressed = r.done.length > 0 || r.rejected.length > 0;
          }
        } catch (e) {
          progressed = false;
        }
        if (doneIds.length) {
          const done = new Set(doneIds);
          writeOutbox(readOutbox().filter(o => !done.has(o.opId)));
          notifySyncChange();
        }
        if (hardError) { U.syncError = hardError; break; }
        if (!progressed) break;
      }
      if (skipped.size && !U.syncError) {
        U.syncError = "スプレッドシートに受け付けられない記録が " + skipped.size + " 件あります（この端末には残っています）。内容を修正するか、担当者にお知らせください。";
      }
    } finally {
      flushing = false;
      notifySyncChange();
      if (readOutbox().length) scheduleRetry(skipped.size ? 15000 : 2000);
    }
  }

  function scheduleRetry(ms) {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flushOutbox(); }, ms || 2000);
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => flushOutbox());
    setInterval(() => { if (pendingCount()) flushOutbox(); }, 15000);
  }

  /* ---------- 通信の下請け ---------- */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(label || "時間切れ")), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }
  async function apiGet(params) {
    const url = UKETSUKE_CONFIG.api.endpoint + "?" + new URLSearchParams(
      Object.assign({}, params, { key: U.who.key, _: Date.now() })
    ).toString();
    const res = await fetch(url);
    return res.json();
  }
  async function apiPost(body) {
    const res = await fetch(UKETSUKE_CONFIG.api.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ key: U.who.key }, body))
    });
    return res.json();
  }

  function applyOutboxTo(key, records) {
    const outbox = readOutbox().filter(o => o.key === key);
    const byId = {};
    records.forEach(r => { byId[r.id] = r; });
    outbox.forEach(op => {
      if (op.op === "upsert") byId[op.record.id] = op.record;
      else if (op.op === "delete") delete byId[op.id];
    });
    return Object.keys(byId).map(k => byId[k]);
  }

  /* ---------- 受付履歴（回の一覧） ---------- */
  // Google Apps Script は混み合っている時（コールドスタート等）に応答が
  // 15秒を超えることがある。その場合に無言でキャッシュへ落ちてしまうと
  // 「集計ができていない」ように見えてしまうため、(1) タイムアウトを延長し、
  // (2) 1回だけ自動リトライし、(3) それでも失敗したら返り値に _stale フラグを
  // 立てて呼び出し側（集計画面など）が利用者にはっきり伝えられるようにする。
  const API_TIMEOUT_MS = 25000;
  async function fetchSessions() {
    if (!endpointReady()) return U.sessions || [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const j = await withTimeout(apiGet({ action: "sessions" }), API_TIMEOUT_MS, "timeout");
        if (j && j.ok) {
          U.sessions = applyOutboxToSessions(j.sessions || []);
          persistSessions();
          return U.sessions;
        }
        if (j && j.error === "unauthorized") { U.syncError = friendlyError("unauthorized"); break; }
      } catch (e) { /* ネット不調・タイムアウト。1回だけリトライしてから諦める */ }
    }
    try { U.sessions = applyOutboxToSessions(JSON.parse(localStorage.getItem(SESSIONS_CACHE_KEY) || "[]")); } catch (e) { U.sessions = []; }
    U.sessions._stale = true;
    return U.sessions;
  }
  function persistSessions() {
    try { localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(U.sessions || [])); } catch (e) { /* ignore */ }
  }
  function sessionsFromLocal() {
    try {
      U.sessions = applyOutboxToSessions(JSON.parse(localStorage.getItem(SESSIONS_CACHE_KEY) || "[]"));
    } catch (e) {
      U.sessions = [];
    }
    return U.sessions;
  }
  /* まだスプレッドシートに届いていない「締め切る／開始する」を、一覧の状態に重ねる。
     締め切った直後に一覧を取り直すと、届く前の「受付中」で上書きされてしまうため。 */
  function applyOutboxToSessions(sessions) {
    const list = (sessions || []).slice();
    readOutbox().forEach(op => {
      if (op.op !== "close" && op.op !== "reopen") return;
      const status = op.op === "close" ? "締切済み" : "受付中";
      const found = list.find(s => s.date === op.date && s.event === op.event);
      if (found) {
        found.status = status;
        if (op.op === "reopen") {
          if (op.attend1 != null) found.attend1 = op.attend1;
          if (op.attend2 != null) found.attend2 = op.attend2;
          if (op.attend3 != null) found.attend3 = op.attend3;
        }
      } else {
        list.unshift({
          date: op.date, event: op.event, status, total: "0",
          attend1: op.attend1 || "", attend2: op.attend2 || "", attend3: op.attend3 || ""
        });
      }
    });
    return list;
  }
  function findSessionInfo(date, event) {
    return (U.sessions || []).find(s => s.date === date && s.event === event) || null;
  }
  function findOpenSessions() {
    return (U.sessions || []).filter(s => s.status === "受付中");
  }
  function rememberSession(date, event) {
    try {
      localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({
        date: date || "",
        event: event || DEFAULT_EVENT
      }));
    } catch (e) { /* ignore */ }
  }
  function newestSession() {
    const list = (U.sessions || []).slice();
    if (!list.length) return null;
    list.sort((a, b) => {
      const ka = (a.date || "") + "\t" + (a.closedAt || a.createdAt || "") + "\t" + (a.event || "");
      const kb = (b.date || "") + "\t" + (b.closedAt || b.createdAt || "") + "\t" + (b.event || "");
      return ka < kb ? 1 : (ka > kb ? -1 : 0);
    });
    return list[0];
  }
  /* 受付中があればそれ。なければ日付のいちばん新しい回（締切済みとして見せる）。
     締め切った回を入力できる状態で開くのは、利用者が自分で選んだときだけ。 */
  function pickCurrentSession() {
    const open = findOpenSessions();
    if (open.length) return open[0];
    return newestSession() || { date: todayYmd(), event: DEFAULT_EVENT };
  }
  /* ---------- 読み込み（サーバーが繋がらなければ端末内キャッシュで表示を続ける） ---------- */
  async function fetchRecords(date, event) {
    event = event || DEFAULT_EVENT;
    const key = sessionKey(date, event);
    U.localOnly = !endpointReady();
    const localCache = (readLocalStore()[key]) || [];
    if (!endpointReady()) {
      const out = applyOutboxTo(key, localCache);
      out._stale = true;
      return out;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const j = await withTimeout(apiGet({ action: "list", date, event }), API_TIMEOUT_MS, "timeout");
        if (!j || !j.ok) {
          if (j && j.error === "unauthorized") { U.syncError = friendlyError("unauthorized"); break; }
          continue; // 想定外のレスポンス形。1回だけリトライ
        }
        const store = readLocalStore();
        store[key] = j.records || [];
        writeLocalStore(store);
        return applyOutboxTo(key, j.records || []);
      } catch (e) { /* ネット不調・タイムアウト。1回だけリトライしてから諦める */ }
    }
    // ここまで来たら、サーバーから正しく取得できなかった。
    // 手元のキャッシュ＋未同期分で表示を続けるが、呼び出し側が分かるように
    // 「最新でないかもしれない」ことを示すフラグを立てる。
    const out = applyOutboxTo(key, localCache);
    out._stale = true;
    return out;
  }

  function recordsFromLocal(date, event) {
    event = event || DEFAULT_EVENT;
    const key = sessionKey(date, event);
    return applyOutboxTo(key, (readLocalStore()[key]) || []);
  }

  /* ---------- 保存・削除（即時ローカル反映。サーバーへは裏で同期） ---------- */
  function saveRecordLocal(record) {
    record.event = record.event || DEFAULT_EVENT;
    const key = sessionKey(record.date, record.event);
    upsertLocalCache(key, record);
    queueOp({ op: "upsert", key, date: record.date, event: record.event, record, ts: Date.now() });
    return record;
  }
  function deleteRecordLocal(date, event, id) {
    event = event || DEFAULT_EVENT;
    const key = sessionKey(date, event);
    deleteLocalCache(key, id);
    queueOp({ op: "delete", key, date, event, id, ts: Date.now() });
  }

  /* ---------- 締め切り／再開 ---------- */
  function closeSessionLocal(date, event, closed, labels) {
    event = event || DEFAULT_EVENT;
    const key = sessionKey(date, event);
    const attend = {
      attend1: labels ? String(labels[0] || "") : "",
      attend2: labels ? String(labels[1] || "") : "",
      attend3: labels ? String(labels[2] || "") : ""
    };
    queueOp(Object.assign({ op: closed ? "close" : "reopen", key, date, event, ts: Date.now() }, attend));
    const info = findSessionInfo(date, event);
    if (info) {
      info.status = closed ? "締切済み" : "受付中";
      if (labels) {
        info.attend1 = attend.attend1;
        info.attend2 = attend.attend2;
        info.attend3 = attend.attend3;
      }
    } else {
      U.sessions = [Object.assign({
        date, event, status: closed ? "締切済み" : "受付中", total: "0"
      }, attend)].concat(U.sessions || []);
    }
    persistSessions();
    rememberSession(date, event);
    if (labels) saveAttendCache(date, event, [attend.attend1, attend.attend2, attend.attend3]);
  }

  /* 過去の日付の回を、いま受付中の回を締めずに作る。
     古いスプレッドシート（backfill 未対応）では作らず、呼び出し側が案内する。 */
  async function backfillSession(date, event, labels) {
    event = event || DEFAULT_EVENT;
    const attend = {
      attend1: labels ? String(labels[0] || "") : "",
      attend2: labels ? String(labels[1] || "") : "",
      attend3: labels ? String(labels[2] || "") : ""
    };
    if (!endpointReady()) {
      closeSessionLocal(date, event, true, labels);
      return { ok: true, status: "締切済み" };
    }
    let j;
    try {
      j = await withTimeout(apiPost(Object.assign({ op: "backfill", date, event }, attend)), 20000, "timeout");
    } catch (e) {
      return { ok: false, error: "timeout" };
    }
    if (!j || !j.ok) return { ok: false, error: (j && j.error) || "failed" };
    const status = j.status || "締切済み";
    const info = findSessionInfo(date, event);
    if (info) {
      info.status = status;
      info.attend1 = attend.attend1;
      info.attend2 = attend.attend2;
      info.attend3 = attend.attend3;
    } else {
      U.sessions = [Object.assign({ date, event, status, total: "0" }, attend)].concat(U.sessions || []);
    }
    persistSessions();
    saveAttendCache(date, event, [attend.attend1, attend.attend2, attend.attend3]);
    rememberSession(date, event);
    return { ok: true, status };
  }

  // 回をまるごと削除する（間違えて作った回の削除用）。個々の受付データの
  // 取消とは違い、頻繁には行わない操作なので、あえて即時オンライン実行にしている
  // （裏で溜めて後で再試行、という扱いにはしない）。
  async function deleteSession(date, event) {
    if (!endpointReady()) throw new Error("スプレッドシート連携が設定されていないため削除できません。");
    const j = await withTimeout(apiPost({ op: "deleteSession", date, event: event || DEFAULT_EVENT }), 15000, "timeout");
    if (!j || !j.ok) throw new Error(friendlyError(j && j.error, "削除に失敗しました"));
    U.sessions = (U.sessions || []).filter(s => !(s.date === date && s.event === event));
    try { localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(U.sessions)); } catch (e) { /* ignore */ }
    const store = readLocalStore();
    delete store[sessionKey(date, event)];
    writeLocalStore(store);
  }

  /* ---------- 見る用ページの読み込み（会長・六役のスマホ） ----------
   * 受付中の回・その回の受付データ・その日のバッジ贈呈を、1回の通信でまとめて読む。
   * スプレッドシートがまだ古い（action=live を知らない）ときは、今までの2回の読み込みで代わりにする。 */
  const LIVE_TIMEOUT_MS = 15000;
  let liveUnsupported = false;
  async function fetchLive(date, event) {
    if (!endpointReady()) throw new Error("not-configured");
    if (!liveUnsupported) {
      const params = { action: "live" };
      if (date) params.date = date;
      if (date && event) params.event = event;
      const j = await withTimeout(apiGet(params), LIVE_TIMEOUT_MS, "timeout");
      if (j && j.ok) {
        const s = j.session || null;
        let records = j.records || [];
        if (s) {
          const key = sessionKey(s.date, s.event);
          const store = readLocalStore();
          store[key] = records;
          writeLocalStore(store);
          records = applyOutboxTo(key, records);
          mergeSessionInfo(s);
        }
        return { session: s, records, badges: j.badges || [], badgeDate: j.badgeDate || (s && s.date) || date || todayYmd() };
      }
      if (j && j.error === "unauthorized") throw new Error(friendlyError("unauthorized"));
      if (!(j && j.error === "unknown action")) throw new Error((j && j.error) || "failed");
      liveUnsupported = true;
    }
    const sessions = await fetchSessions();
    if (sessions._stale) throw new Error("timeout");
    let s = null;
    if (date) s = (sessions || []).find(x => x.date === date && (!event || x.event === event)) || null;
    else s = findOpenSessions()[0] || null;
    if (!s) return { session: null, records: [], badges: [], badgeDate: date || todayYmd() };
    const records = await fetchRecords(s.date, s.event);
    if (records._stale) throw new Error("timeout");
    return { session: s, records, badges: [], badgeDate: s.date };
  }
  function mergeSessionInfo(s) {
    if (!U.sessions || !U.sessions.length) sessionsFromLocal();
    const found = findSessionInfo(s.date, s.event);
    if (found) Object.assign(found, s);
    else U.sessions = [Object.assign({ total: "" }, s)].concat(U.sessions || []);
    if (s.status === "受付中") {
      U.sessions.forEach(x => { if (x !== found && x.status === "受付中" && !(x.date === s.date && x.event === s.event)) x.status = "締切済み"; });
    }
    persistSessions();
  }

  /* 開いたとき・画面に戻ったとき・つながり直したときに読む（「更新」は now() を呼ぶ）。
     intervalMs を渡したときだけ定期的にも読む。読めなかったときは retryMs 後にやり直す。
     画面が隠れている間は何もしない。 */
  function startLivePolling(opts) {
    const interval = opts.intervalMs || 0;
    const retry = opts.retryMs || 15000;
    let timer = null;
    let running = null;
    function schedule(failed) {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      const wait = failed ? retry : interval;
      if (wait) timer = setTimeout(tick, wait);
    }
    function tick() {
      if (running) return running;
      clearTimeout(timer);
      running = (async () => {
        let failed = false;
        try { await opts.load(); if (opts.onOk) opts.onOk(); }
        catch (e) { failed = true; if (opts.onError) opts.onError(e); }
        finally { running = null; schedule(failed); }
      })();
      return running;
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") tick();
      else clearTimeout(timer);
    });
    window.addEventListener("online", tick);
    window.addEventListener("pageshow", e => { if (e.persisted) tick(); });
    tick();
    return { now: tick };
  }

  function nowHms() {
    const n = new Date();
    return pad(n.getHours()) + ":" + pad(n.getMinutes()) + ":" + pad(n.getSeconds());
  }

  /* 来ているかどうか。ゲストは事前に登録するので丸ボタンで見る。
     会員・他単会は受付に来たときにだけ登録されるので、行があれば来ている。 */
  function recordArrived(r, items) {
    if (!r) return false;
    if (r.type !== "guest") return true;
    return (items && items.length ? items : msAttendance()).some(a => r[a.key]);
  }
  function findMemberRecord(records, member) {
    const list = (records || []).filter(r => r.type === "member");
    if (member.id || member.memberId) {
      const id = member.id || member.memberId;
      const byId = list.find(r => sameMemberId(r.memberId, id));
      if (byId) return byId;
    }
    const n = flatten(member.name);
    return n ? (list.find(r => flatten(r.name) === n) || null) : null;
  }

  /* ---------- 新入会員バッジ贈呈（事前に入力。急がないので、その場で送って結果を待つ） ---------- */
  const BADGE_CACHE_KEY = "rinri-uketsuke-badges-v1";
  function readBadgeCache(date) {
    try { return (JSON.parse(localStorage.getItem(BADGE_CACHE_KEY) || "{}"))[date] || []; } catch (e) { return []; }
  }
  function writeBadgeCache(date, list) {
    try {
      const all = JSON.parse(localStorage.getItem(BADGE_CACHE_KEY) || "{}");
      all[date] = list;
      localStorage.setItem(BADGE_CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }
  async function fetchBadges(date) {
    const j = await withTimeout(apiGet({ action: "badges", date }), LIVE_TIMEOUT_MS, "timeout");
    if (!j || !j.ok) throw new Error(friendlyError(j && j.error, "読み込めませんでした"));
    writeBadgeCache(date, j.badges || []);
    return j.badges || [];
  }
  async function saveBadge(badge) {
    const j = await withTimeout(apiPost({ op: "badgeUpsert", badge, updatedBy: U.who.name || "" }), POST_TIMEOUT_MS, "timeout");
    if (!j || !j.ok) {
      if (j && j.error === "unknown op") throw new Error("スプレッドシート側のスクリプトがまだ古いため、保存できません。");
      throw new Error(friendlyError(j && j.error, "保存できませんでした"));
    }
    return j.badge;
  }
  async function deleteBadge(id) {
    const j = await withTimeout(apiPost({ op: "badgeDelete", id, updatedBy: U.who.name || "" }), POST_TIMEOUT_MS, "timeout");
    if (!j || !j.ok) throw new Error(friendlyError(j && j.error, "取り消せませんでした"));
  }

  function friendlyError(code, fallback) {
    if (code === "unauthorized") return "スプレッドシートに接続できません（config.js の api.key と Code.gs の ADMIN_KEY をご確認ください）。入力データはこの端末に保存され続けています。";
    if (code === "busy") return "混み合っています。少し待ってから、もう一度お試しください。";
    return code || fallback || "処理に失敗しました";
  }

  global.UKETSUKE = {
    U, DEFAULT_EVENT,
    loadMembers, searchMembers, refreshMembers, membersAgeDays, membersAreStale,
    findExisting,
    isNewMemberJoin, newMemberCutoff, isOfficerMember, recordIsOfficer,
    loadAuth, saveAuth, endpointReady, needsAuthGate, currentKey,
    fetchRecords, recordsFromLocal, saveRecordLocal, deleteRecordLocal,
    fetchSessions, sessionsFromLocal, findSessionInfo, findOpenSessions, pickCurrentSession, rememberSession,    closeSessionLocal, deleteSession, backfillSession,
    pendingCount, onSyncChange, flushOutbox,
    uid, todayYmd, jaDate, jaDateShort, bindDateFaces, nowHm, nowDateTime,
    normalizeRecordTime, formatRecordTimeText, compareRecordTime, recordHasAttendance, attendLabelsFromItems,
    splitAttendants, joinAttendants, formatAttendants,
    msAttendance, attendanceForSession, currentAttendance, attendShort,
    fetchLive, startLivePolling, nowHms, recordArrived, findMemberRecord,
    readBadgeCache, writeBadgeCache, fetchBadges, saveBadge, deleteBadge
  };
})(window);
