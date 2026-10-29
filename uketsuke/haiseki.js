/* ============================================================
 *  MS・朝食会 配席
 *
 *  ゲストは受付ファイルのゲスト情報（guestBoard）から、その日の方を読む。
 *  アテンドはゲストに登録されたアテンドを候補に出し、ほかの会員は名簿のかな検索で出す。
 *  席に名前を入れるのはゲスト・アテンド・会長・講話者・司会・お役・リーダーだけで、
 *  ほかの会員は自由席（空の札のまま）。
 *  朝の挨拶などのお役は、最初の席に置いてあるだけなので、別の席へ動かしたり足したり消したりできる。
 *  朝食会の卓は、卓の「9人席にする」で下の2席のあいだに1席足せる。
 *
 *  置き方は2通り：
 *    ・マウスで名前をつかんで席へ運ぶ（席から席で入れ替え、左の一覧へ戻すと席から外れる）
 *    ・名前を押して選んでから空席を押す（スマホ・タブレットはこちら）
 *  保存先は受付ファイルの「配席」シート。読み込んだあとに他の人が保存していたら、上書きする前に聞く。
 *  ?edit=1 のときだけ編集できる。付いていなければ見るだけ。
 * ============================================================ */
(function () {
  "use strict";
  const K = window.UKETSUKE;
  const U = K.U;
  const C = UKETSUKE_CONFIG;
  const L = window.HAISEKI_LAYOUTS;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const EDIT = params.get("edit") === "1";
  const today = K.todayYmd();

  const ROLES = {
    guest: "ゲスト", attend: "アテンド", leader: "テーブルリーダー", chair: "会長",
    speaker: "講話者", mc: "司会", yaku: "お役", member: "会員"
  };
  const ROLE_SHORT = { attend: "アテンド", leader: "リーダー", chair: "会長", speaker: "講話者", mc: "司会", yaku: "お役", member: "" };
  const DUTY_PRESETS = ["朝の挨拶", "会員スピーチ", "連絡事項", "誓いの言葉", "進行", "タイムキーパー"];
  /* 印刷・画像の色。画面の CSS（haiseki.html）と同じ色にそろえる */
  const COLORS = {
    guest:   { fill: "#e3f1ff", line: "#2f86d6", band: "#2f86d6", ink: "#0d3b66" },
    attend:  { fill: "#ffffff", line: "#1f4e8c", band: "#1f4e8c", ink: "#16202e" },
    leader:  { fill: "#ffffff", line: "#3c9a4c", band: "#3c9a4c", ink: "#16202e" },
    chair:   { fill: "#fff1ef", line: "#d2493a", band: "#d2493a", ink: "#16202e" },
    speaker: { fill: "#fff0f7", line: "#cf4f95", band: "#cf4f95", ink: "#16202e" },
    mc:      { fill: "#fffaf0", line: "#b9861b", band: "#b9861b", ink: "#16202e" },
    yaku:    { fill: "#fffaf0", line: "#b9861b", band: "#b9861b", ink: "#16202e" },
    member:  { fill: "#ffffff", line: "#8a96a8", band: "#8a96a8", ink: "#16202e" }
  };

  /* ---------- 日付 ---------- */
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = s => { const p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  function nextTuesday(s) {
    const d = parse(s);
    while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
    return ymd(d);
  }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }

  /* ---------- 状態 ---------- */
  let date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date") : nextTuesday(today);
  let kind = params.get("kind") === "choshoku" ? "choshoku" : "ms";
  let board = null;            // guestBoard の結果（その年）
  let boardYear = "";
  let seats = {};              // 席ID → 座る方
  let duties = [];             // { id, name, seat } 朝の挨拶などのお役（席に置いてある／まだ置いていない）
  let extras = {};             // 卓ID → 9（朝食会で9人席にした卓）
  let server = null;           // サーバーにある配席 { version, updatedAt, updatedBy }
  let previous = null;         // 同じ種類の前の回（ひな形）
  let dirty = false;
  let loading = true;
  let loadError = "";
  let selected = null;         // 置く席を選んでいる方
  let selectedDuty = null;     // 置く席を選んでいるお役
  let notice = "";             // 上に出すお知らせ
  let noticeAction = null;     // お知らせのボタン { label, fn }
  let noticeAction2 = null;
  let programs = null;         // R9 講話＆会員スピーチ（日付の配列）
  let programError = "";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const flat = s => String(s || "").replace(/[\s　]+/g, "");
  /* 全角スペースのままだと札の中で間が空きすぎるので、半角1つにそろえる */
  const tidy = s => String(s || "").replace(/[\s　]+/g, " ").trim();
  const baseLayout = () => L[kind];
  const layout = () => L.withExtras(baseLayout(), extras);
  const seatDef = id => layout().seats.find(s => s.id === id) || null;
  function defaultDuties() {
    return baseLayout().seats.filter(s => s.hint === "yaku" && s.label)
      .map(s => ({ id: "d:" + s.id, name: s.label, seat: s.id }));
  }
  function normalizeDuties(raw) {
    if (Array.isArray(raw)) {
      return raw.map(d => ({ id: String((d && d.id) || ""), name: tidy(d && d.name), seat: String((d && d.seat) || "") }))
        .filter(d => d.name).map((d, i) => Object.assign(d, { id: d.id || ("d:x" + i) }));
    }
    if (raw && typeof raw === "object") {
      return Object.keys(raw).map(id => ({ id: "d:" + id, name: tidy(raw[id]), seat: id })).filter(d => d.name);
    }
    return defaultDuties();
  }
  function applyRecord(data) {
    extras = (data && data.extras && typeof data.extras === "object" && !Array.isArray(data.extras))
      ? Object.assign({}, data.extras) : {};
    seats = known((data && data.seats) || {});
    duties = data && Object.prototype.hasOwnProperty.call(data, "duties")
      ? normalizeDuties(data.duties) : defaultDuties();
  }
  function findDuty(id) { return duties.find(d => d.id === id) || null; }
  function dutyOn(id) { return duties.find(d => d.seat === id) || null; }
  function newDutyId() { return "d:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  /* 席の呼び名。卓や中央の列の席は番号（A3・M12 など）、講話者席・会長席などは役の名前 */
  function tableName(id) {
    const s = seatDef(id);
    if (!s) return "";
    if (!s.table) return s.label;
    if (s.no) return s.no;
    const block = (layout().blocks || []).find(b => b.id === s.table);
    return block ? block.label : s.table + "卓";
  }

  /* ---------- ゲストの印（ゲスト情報ページと同じ考え方） ---------- */
  function joinStep(g) {
    const m = String(g.meibo || "").match(/（([^・）]+)(・ふりがなで一致)?）/);
    const fromMeibo = !m ? "" : m[1] === "在籍" ? "入会済み" : m[1] === "仮" ? "入会予定" : m[1] === "入会手続き中" ? "入会手続き中" : "";
    const st = String(g.status || "");
    const fromStatus = /^入会[・済]/.test(st) || st === "入会" ? "入会済み" : st === "入会手続き中" ? "入会手続き中" : st === "入会予定" ? "入会予定" : "";
    const steps = ["入会予定", "入会手続き中", "入会済み"];
    return steps.indexOf(fromMeibo) > steps.indexOf(fromStatus) ? fromMeibo : fromStatus;
  }
  function guestMarks(g) {
    const out = [];
    const j = joinStep(g);
    if (j) out.push(j);
    if (g.msBefore > 0) out.push("みなと" + (g.msBefore + 1) + "回目");
    else out.push("初めて");
    return out;
  }
  const wantsBreakfast = g => !!g.share || String(g.plan || "").includes("朝食会");

  /* ---------- 人（ゲスト・アテンド・名簿の会員） ---------- */
  /* アテンドは「佐治さん」のように敬称付き・名字だけで入っていることがある。
     敬称を外して名簿と照らし、名字だけでも1人に決まればその方にする */
  function memberByName(name) {
    const f = flat(name).replace(/(さん|様|さま|くん|氏)$/, "");
    if (!f) return null;
    const exact = U.members.find(m => flat(m.name) === f);
    if (exact) return exact;
    const pre = U.members.filter(m => flat(m.name).indexOf(f) === 0);
    return pre.length === 1 ? pre[0] : null;
  }
  function guestPerson(g) {
    return {
      type: "guest", role: "guest", key: "g:" + (g.guestId || flat(g.name)),
      name: tidy(g.name), kana: tidy(g.kana), referrer: tidy(g.referrer),
      attendants: K.splitAttendants(g.attendant).filter(Boolean),
      marks: guestMarks(g), breakfast: wantsBreakfast(g), gender: tidy(g.gender)
    };
  }
  function memberPerson(m, role, forGuest) {
    return {
      type: "member", role: role || "member", key: "m:" + (m.id || flat(m.name)),
      name: m.name, kana: m.kana || "", memberId: m.id || "", forGuest: forGuest || ""
    };
  }
  function attendPerson(name, guestKey) {
    const m = memberByName(name);
    return memberPerson(m || { name, kana: "" }, "attend", guestKey);
  }
  function otherPerson(name, role) {
    if (role === "guest") return { type: "guest", role: "guest", key: "x:" + flat(name), name, kana: "", referrer: "", attendants: [], marks: [] };
    return { type: "member", role, key: "o:" + flat(name), name, kana: "", memberId: "" };
  }

  function dayGuests() {
    if (!board) return [];
    return board.guests.filter(g => g.date === date && g.event === K.DEFAULT_EVENT)
      .map(guestPerson)
      .sort((a, b) => a.kana.localeCompare(b.kana, "ja") || a.name.localeCompare(b.name, "ja"));
  }
  /* 席に入っているゲストの情報（ふりがな・紹介者・印）は、読み込めたゲスト情報で新しくする */
  function refreshSeatedGuests() {
    const by = {};
    dayGuests().forEach(p => { by[p.key] = p; });
    Object.keys(seats).forEach(id => {
      const p = seats[id];
      if (p.type === "guest" && by[p.key]) seats[id] = by[p.key];
    });
  }
  /* 性別：ゲストはゲスト情報、会員は名簿から。分からない方（外部の講話者など）は "" */
  function genderOf(p) {
    if (!p) return "";
    if (p.type === "guest") return p.gender || "";
    const m = (p.memberId && U.members.find(x => x.id === p.memberId)) || memberByName(p.name);
    return (m && m.gender) || "";
  }
  /* 性別の小さな印（女性はピンク、男性は青の丸） */
  function sexDot(p, cls) {
    const g = genderOf(p);
    if (g !== "女性" && g !== "男性") return "";
    return `<i class="${cls || "sx"} ${g === "女性" ? "f" : "m"}" title="${g}"></i>`;
  }
  function seatOf(key) {
    return Object.keys(seats).find(id => seats[id].key === key) || "";
  }
  /* ゲストのアテンド：受付で登録された方と、この画面で「このゲストのアテンド」として名簿から置いた方 */
  function attendantsOf(g) {
    const out = (g.attendants || []).map(n => attendPerson(n, g.key));
    Object.keys(seats).forEach(id => {
      const p = seats[id];
      if (p.role === "attend" && p.forGuest === g.key && !out.some(a => a.key === p.key)) out.push(p);
    });
    return out;
  }

  /* ---------- 置く・外す ---------- */
  function roleForSeat(p, id) {
    if (p.type === "guest") return "guest";
    const s = seatDef(id);
    if (dutyOn(id)) return "yaku";
    if (s && ["chair", "speaker", "mc"].includes(s.hint)) return s.hint;
    if (p.role && p.role !== "member" && p.role !== "yaku") return p.role;
    return s && s.hint === "leader" ? "leader" : "member";
  }
  function refreshSeatRole(id) {
    if (id && seats[id]) seats[id] = Object.assign({}, seats[id], { role: roleForSeat(seats[id], id) });
  }
  function place(p, id) {
    const from = seatOf(p.key);
    if (from === id) return;
    const here = seats[id];
    if (from) delete seats[from];
    const next = Object.assign({}, p, { role: roleForSeat(p, id) });
    seats[id] = next;
    if (here && from) seats[from] = Object.assign({}, here, { role: roleForSeat(here, from) });
    selected = null;
    selectedDuty = null;
    changed();
  }
  function moveDuty(d, id) {
    if (!d || !id || d.seat === id) { selectedDuty = null; render(); return; }
    const other = duties.find(x => x.seat === id && x.id !== d.id);
    const from = d.seat;
    d.seat = id;
    if (other) other.seat = from || "";
    refreshSeatRole(id);
    refreshSeatRole(from);
    selectedDuty = null;
    changed();
  }
  function unplaceDuty(id) {
    const d = findDuty(id);
    if (!d) return;
    const seat = d.seat;
    d.seat = "";
    refreshSeatRole(seat);
    if (selectedDuty && selectedDuty.id === id) selectedDuty = null;
    changed();
  }
  function removeDuty(id) {
    const d = findDuty(id);
    if (!d) return;
    const seat = d.seat;
    duties = duties.filter(x => x.id !== id);
    refreshSeatRole(seat);
    if (selectedDuty && selectedDuty.id === id) selectedDuty = null;
    changed();
  }
  function addDuty(name) {
    const n = tidy(name);
    if (!n) return;
    const d = { id: newDutyId(), name: n, seat: "" };
    duties.push(d);
    selected = null;
    selectedDuty = d;
    changed();
  }
  function pickDuty(id) {
    const d = findDuty(id);
    if (!d) return;
    selected = null;
    selectedDuty = selectedDuty && selectedDuty.id === id ? null : d;
    render();
  }
  function setTableSize(tableId, n) {
    if (n === 8) {
      const extraId = tableId + "-x";
      if (seats[extraId] && !confirm("増えた席に名前が入っています。8人席に戻すと、その方は席から外れます。よろしいですか？")) return;
      delete seats[extraId];
      duties.forEach(d => { if (d.seat === extraId) d.seat = ""; });
      delete extras[tableId];
    } else {
      extras[tableId] = 9;
    }
    changed();
  }
  function unseat(key) {
    const id = seatOf(key);
    if (!id) return;
    delete seats[id];
    selected = null;
    changed();
  }
  function changed() {
    dirty = true;
    saveDraft();
    render();
  }

  /* アテンドの案：席に座ったゲストのアテンドがまだ席にいなければ、同じ卓のいちばん近い空席に薄く出す */
  function suggestions() {
    const out = {};
    if (!EDIT) return out;
    Object.keys(seats).forEach(id => {
      const g = seats[id];
      if (g.type !== "guest") return;
      const s = seatDef(id);
      if (!s || !s.table) return;
      attendantsOf(g).forEach(a => {
        if (seatOf(a.key) || Object.values(out).some(x => x.key === a.key)) return;
        const free = layout().seats.filter(x => x.table === s.table && !seats[x.id] && !out[x.id] && !dutyOn(x.id) && !["chair", "speaker", "mc"].includes(x.hint))
          .sort((x, y) => Math.hypot(x.x - s.x, x.y - s.y) - Math.hypot(y.x - s.x, y.y - s.y));
        if (free.length) out[free[0].id] = a;
      });
    });
    return out;
  }

  /* 今の席図にない席（席図を作り直す前の中央の列など）に入っていた方は、席なしに戻す */
  function known(list) {
    const out = {};
    Object.keys(list || {}).forEach(id => { if (seatDef(id)) out[id] = list[id]; });
    return out;
  }

  /* 気をつけること（上の帯に出す） */
  function warnings() {
    const out = [];
    const guests = dayGuests().filter(g => kind === "ms" || g.breakfast);
    const unseated = guests.filter(g => !seatOf(g.key));
    if (unseated.length) out.push({ level: "ng", text: "まだ席がないゲスト：" + unseated.map(g => g.name + "様").join("、") });
    Object.keys(seats).forEach(id => {
      const g = seats[id];
      if (g.type !== "guest") return;
      const t = seatDef(id) ? seatDef(id).table : "";
      const atts = attendantsOf(g);
      atts.forEach(a => {
        const aid = seatOf(a.key);
        if (!aid) out.push({ level: "warn", text: g.name + "様のアテンド " + a.name + " さんの席がまだです" });
        else if (t && seatDef(aid) && seatDef(aid).table !== t) {
          out.push({ level: "warn", text: g.name + "様（" + tableName(id) + "）とアテンドの " + a.name + " さん（" + tableName(aid) + "）が別の卓です" });
        }
      });
    });
    return out;
  }

  /* ---------- 読み込み ---------- */
  const draftKey = () => "haiseki.draft." + date + "|" + kind;
  function saveDraft() {
    try { localStorage.setItem(draftKey(), JSON.stringify({ seats, duties, extras, base: server ? server.version : "", at: K.nowDateTime() })); } catch (e) { /* ignore */ }
  }
  function applyDraft(d) {
    const data = { seats: (d && d.seats) || {}, extras: (d && d.extras) || {} };
    if (d && Object.prototype.hasOwnProperty.call(d, "duties")) data.duties = d.duties;
    applyRecord(data);
  }
  function draftDiffers(d) {
    if (!d) return false;
    if (JSON.stringify(d.seats || {}) !== JSON.stringify(seats)) return true;
    if (Object.prototype.hasOwnProperty.call(d, "duties") && JSON.stringify(d.duties || []) !== JSON.stringify(duties)) return true;
    if (Object.prototype.hasOwnProperty.call(d, "extras") && JSON.stringify(d.extras || {}) !== JSON.stringify(extras)) return true;
    return false;
  }
  function readDraft() {
    try { return JSON.parse(localStorage.getItem(draftKey()) || "null"); } catch (e) { return null; }
  }
  function dropDraft() { try { localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ } }

  async function api(params) {
    const q = new URLSearchParams(Object.assign({ key: K.currentKey(), _: Date.now() }, params));
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
    try {
      const j = await (await fetch(C.api.endpoint + "?" + q, ctrl ? { signal: ctrl.signal } : {})).json();
      if (!j.ok) throw new Error(j.error || "読み込めませんでした");
      return j;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function loadBoard(fresh) {
    const year = date.slice(0, 4);
    if (boardYear !== year) {
      boardYear = year;
      try { board = JSON.parse(localStorage.getItem("uketsuke.guestBoard." + year) || "null"); } catch (e) { board = null; }
    }
    const j = await api(Object.assign({ action: "guestBoard", year }, fresh ? { fresh: "1" } : {}));
    if (boardYear !== year) return;
    board = j;
    try { localStorage.setItem("uketsuke.guestBoard." + year, JSON.stringify(j)); } catch (e) { /* ignore */ }
  }
  async function loadSeating() {
    const want = date + "|" + kind;
    let j;
    try {
      j = await api({ action: "seating", date, kind });
    } catch (e) {
      /* 受付スクリプトがまだ古いときは、席図だけ出して保存先は空のままにする */
      if (String(e && e.message) === "unknown action") {
        if (!dirty) applyRecord({});
        return;
      }
      throw e;
    }
    if (date + "|" + kind !== want) return;
    previous = j.previous;
    const s = j.seating;
    const newer = !server || !s || server.version !== s.version;
    if (dirty && server && s && server.version !== s.version) {
      notice = s.updatedBy + " さんが " + s.updatedAt + " に保存しています。いまの画面はまだ読み込んでいません。";
      noticeAction = { label: "読み込む（この画面の変更は消えます）", fn: () => { dirty = false; server = null; dropDraft(); reloadAll(); } };
      return;
    }
    if (dirty) return;
    if (!newer && server) return;
    server = s ? { version: s.version, updatedAt: s.updatedAt, updatedBy: s.updatedBy } : null;
    applyRecord((s && s.data) || {});
    const d = EDIT ? readDraft() : null;
    if (d && draftDiffers(d)) {
      if ((d.base || "") === (server ? server.version : "")) {
        applyDraft(d);
        dirty = true;
      } else {
        notice = "この端末に、保存していない配席が残っています（" + d.at + "）。そのあとに別の方が保存しています。";
        noticeAction = { label: "この端末の配席を使う", fn: () => { applyDraft(d); dirty = true; notice = ""; noticeAction = null; render(); } };
      }
    }
  }
  /* 進行表は MS の上に出すほか、朝食会の講話者の席を埋めるのにも使う（朝食会は同じ日の MS の講話者） */
  async function loadProgram(fresh) {
    if (!window.HAISEKI_PROGRAM) return;
    try {
      programs = await window.HAISEKI_PROGRAM.load(fresh);
      programError = "";
    } catch (e) {
      programError = "進行表（講話・会員スピーチ）を読めませんでした。配席はそのまま使えます。";
    }
  }
  function todayProgram() {
    if (kind !== "ms" || !window.HAISEKI_PROGRAM) return null;
    return window.HAISEKI_PROGRAM.summary(window.HAISEKI_PROGRAM.forDate(programs, date));
  }

  /* 朝食会の A1（講話者）と A2（会長）は、空いていれば自動で入れる。
     講話者は進行表のその日のいちばん目の講話者、会長は名簿で役職が「会長」の方。
     すでにどこかの席にいる方は入れない（自分で動かした席はそのまま） */
  function autoFill() {
    if (kind !== "choshoku") return;
    const empty = hint => layout().seats.find(s => s.hint === hint && !seats[s.id]);
    const taken = (role, key) => Object.keys(seats).some(id => seats[id].role === role || seats[id].key === key);
    const sess = window.HAISEKI_PROGRAM ? window.HAISEKI_PROGRAM.summary(window.HAISEKI_PROGRAM.forDate(programs, date)) : null;
    const sp = sess && !sess.recess && sess.speakers[0];
    const spSeat = empty("speaker");
    if (sp && sp.name && spSeat) {
      const p = Object.assign(otherPerson(tidy(sp.name), "speaker"), { kana: tidy(sp.kana) });
      if (!taken("speaker", p.key)) seats[spSeat.id] = p;
    }
    const chair = U.members.find(m => /^会長/.test(m.role || ""));
    const chairSeat = empty("chair");
    if (chair && chairSeat) {
      const p = memberPerson(chair, "chair");
      if (!taken("chair", p.key)) seats[chairSeat.id] = p;
    }
  }

  async function reloadAll(fresh) {
    loading = true;
    render();
    const results = await Promise.allSettled([loadBoard(fresh), loadSeating(), loadProgram(fresh)]);
    const seatFail = results[1].status === "rejected";
    const boardFail = results[0].status === "rejected";
    if (seatFail && boardFail) {
      loadError = "読み込みに時間がかかっています。少し待ってから「更新」を押してください。";
    } else {
      loadError = "";
      if (seatFail && !notice) {
        notice = "配席の保存先を読めませんでした。席図は出しますが、保存した内容はまだ入っていません。";
      }
    }
    loading = false;
    refreshSeatedGuests();
    autoFill();
    render();
  }

  /* ---------- 保存 ---------- */
  function who() { return ($("who") && $("who").value.trim()) || localStorage.getItem("haiseki.who") || ""; }
  async function save(force) {
    if (!who()) {
      $("who").focus();
      showNotice("保存する方のお名前を入れてください（だれが保存したか、ほかの方に見えます）。");
      return;
    }
    localStorage.setItem("haiseki.who", who());
    const btn = $("btn-save");
    btn.disabled = true;
    btn.textContent = "保存しています…";
    try {
      const res = await fetch(C.api.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          op: "seatingSave", key: K.currentKey(), updatedBy: who(), date, kind,
          baseVersion: server ? server.version : "", force: !!force, data: { seats, duties, extras }
        })
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "保存できませんでした");
      if (j.conflict) {
        const s = j.seating;
        notice = s.updatedBy + " さんが " + s.updatedAt + " に保存しています（この画面を開いたあとです）。";
        noticeAction = { label: "自分の配席で上書きする", fn: () => { notice = ""; noticeAction = null; save(true); } };
        noticeAction2 = { label: "相手の配席を読み込む（自分の変更は消えます）", fn: () => { dirty = false; server = null; dropDraft(); notice = ""; noticeAction = null; noticeAction2 = null; reloadAll(); } };
        render();
        return;
      }
      const s = j.seating;
      server = { version: s.version, updatedAt: s.updatedAt, updatedBy: s.updatedBy };
      dirty = false;
      dropDraft();
      notice = "";
      noticeAction = null;
      noticeAction2 = null;
      /* MS の配席では、ゲストに紐づけたアテンドを、ゲスト情報のアテンドが空欄のときだけ入れている（受付ファイル側の処理） */
      const filled = j.attendFilled || [];
      if (filled.length) {
        const nameOf = gid => (dayGuests().find(g => g.key === "g:" + gid) || {}).name || gid;
        notice = "ゲスト情報のアテンドにも入れました：" + filled.map(f => nameOf(f.guestId) + "様 → " + f.attendant).join("、");
        loadBoard(true).then(() => { refreshSeatedGuests(); render(); }).catch(() => {});
      }
      render();
    } catch (e) {
      showNotice("保存できませんでした。電波のよいところで、もう一度「保存」を押してください。変更はこの端末に残っています。");
    } finally {
      btn.disabled = false;
      renderToolbar();
    }
  }
  function showNotice(t) { notice = t; noticeAction = null; noticeAction2 = null; render(); }

  /* ---------- 描画 ---------- */
  /* お名前・ふりがなは姓と名のあいだで2行に分けられるようにしておく（1行に入らないときだけ fitSeats が分ける） */
  function nameHtml(name, suffix) {
    const t = tidy(name);
    const at = t.indexOf(" ");
    const tail = suffix ? `<small>${suffix}</small>` : "";
    if (at < 0) return `<span class="ln">${esc(t)}${tail}</span>`;
    return `<span class="ln">${esc(t.slice(0, at))}</span><span class="ln">${esc(t.slice(at + 1))}${tail}</span>`;
  }
  function emptyLayoutHint(s) {
    if (s.hint === "chair" || s.hint === "speaker" || s.hint === "mc") return s.label || "";
    if (s.hint === "leader") return "リーダー";
    return "";
  }
  function seatHtml(s, p, ghost) {
    const no = s.no ? `<i class="s-no">${esc(s.no)}</i>` : "";
    const lay = layout();
    const w = s.w || lay.seatW, h = s.h || lay.seatH;
    const style = `left:${(s.x - w / 2) / lay.width * 100}%;top:${(s.y - h / 2) / lay.height * 100}%;width:${w / lay.width * 100}%;height:${h / lay.height * 100}%`;
    const narrow = (s.w && s.w < lay.seatW ? " narrow" : "") + (s.h && s.h < lay.seatH ? " short" : "");
    const duty = dutyOn(s.id);
    const dutyAttr = duty && EDIT ? ` data-duty="${esc(duty.id)}"` : "";
    const dutyX = duty && EDIT ? `<button type="button" class="s-x" data-duty-off="${esc(duty.id)}" aria-label="お役を外す">×</button>` : "";
    if (!p) {
      const target = (selected || selectedDuty) && EDIT ? " target" : "";
      if (ghost) {
        return `<div class="seat ghost${narrow}" data-seat="${s.id}" data-ghost="${esc(ghost.key)}" style="${style}" title="押すと置きます">${no}
          <span class="s-top">アテンドの案</span><span class="s-name">${nameHtml(ghost.name)}</span><span class="s-sub">押すと置く</span></div>`;
      }
      const hint = duty ? duty.name : emptyLayoutHint(s);
      const hcls = duty ? " h-yaku" : (s.hint && ["chair", "speaker", "mc", "leader"].includes(s.hint) ? " h-" + s.hint : "");
      return `<div class="seat empty${narrow}${target}${hcls}" data-seat="${s.id}" style="${style}">${no}${dutyX}${hint ? `<span class="s-hint"${dutyAttr}>${esc(hint)}</span>` : ""}</div>`;
    }
    const sel = selected && selected.key === p.key ? " picked" : "";
    const dot = sexDot(p, "s-sex");
    if (p.type === "guest") {
      return `<div class="seat r-guest${narrow}${sel}" data-seat="${s.id}" data-drag="${esc(p.key)}" style="${style}">${no}${dot}
        ${p.kana ? `<span class="s-top">${nameHtml(p.kana)}</span>` : ""}
        <span class="s-name">${nameHtml(p.name, "様")}</span>
        <span class="s-sub">${p.referrer ? "紹介 " + esc(p.referrer) : "ゲスト"}</span></div>`;
    }
    const tag = duty ? duty.name : ROLE_SHORT[p.role] || "";
    return `<div class="seat r-${p.role}${narrow}${sel}" data-seat="${s.id}" data-drag="${esc(p.key)}" style="${style}">${no}${dot}
      ${tag ? `<span class="s-top"${dutyAttr}>${esc(tag)}</span>` : ""}<span class="s-name">${nameHtml(p.name)}</span></div>`;
  }

  function renderBoard() {
    const lay = layout();
    const sug = suggestions();
    const counts = {};
    Object.keys(seats).forEach(id => {
      const s = seatDef(id);
      if (!s || !s.table) return;
      const c = counts[s.table] = counts[s.table] || { g: 0, a: 0 };
      if (seats[id].type === "guest") c.g++; else if (seats[id].role === "attend") c.a++;
    });
    const tables = lay.tables.map(t => {
      const c = counts[t.id] || { g: 0, a: 0 };
      const r = t.r;
      return `<div class="table" style="left:${(t.x - r) / lay.width * 100}%;top:${(t.y - r) / lay.height * 100}%;width:${2 * r / lay.width * 100}%;height:${2 * r / lay.height * 100}%">
        <b>${esc(t.label)}</b>${t.note ? `<em>${esc(t.note)}</em>` : ""}${c.g ? `<span>ゲスト${c.g}</span>` : ""}${c.a ? `<span>アテンド${c.a}</span>` : ""}</div>`;
    }).join("");
    const nines = (kind === "choshoku" && EDIT) ? lay.tables.map(t => {
      const nine = extras[t.id] === 9;
      return `<button type="button" class="tbl-n${nine ? " on" : ""}" data-nine="${t.id}" style="left:${t.x / lay.width * 100}%;top:${(t.y + t.r + 6) / lay.height * 100}%">${nine ? "8人席に戻す" : "9人席にする"}</button>`;
    }).join("") : "";
    const html = lay.seats.map(s => seatHtml(s, seats[s.id], sug[s.id])).join("");
    $("board").style.aspectRatio = lay.width + " / " + lay.height;
    $("board").style.setProperty("--w", lay.width);
    $("board").innerHTML = `<div class="front">${esc(lay.front)}</div>${tables}${nines}${html}`;
    $("board").classList.toggle("picking", !!(selected || selectedDuty));
    fitSeats();
  }
  /* 札に文字が収まるようにする（「…」で切らない）。
     1行に入らなければ姓と名（ふりがなも）のところで2行に分け、それでも入らなければ少しずつ小さくする。 */
  function fitSeats() {
    document.querySelectorAll("#board .seat").forEach(seat => {
      const parts = Array.from(seat.children).filter(el => el.tagName === "SPAN");
      parts.forEach(el => { el.style.fontSize = ""; el.classList.remove("two"); });
      const cs = getComputedStyle(seat);
      const room = seat.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const used = () => parts.reduce((n, el) => {
        const m = getComputedStyle(el);
        return n + el.offsetHeight + parseFloat(m.marginTop) + parseFloat(m.marginBottom);
      }, 0);
      const wide = el => el.scrollWidth > el.clientWidth + 1;
      const tall = () => used() > room + 1;
      const shrink = (el, tooBig, limit) => {
        const base = parseFloat(getComputedStyle(el).fontSize);
        let size = base;
        while (tooBig() && size > base * (limit || 0.6)) {
          size *= 0.94;
          el.style.fontSize = size + "px";
        }
      };
      const splits = el => el && wide(el) && el.querySelectorAll(".ln").length > 1;
      const name = seat.querySelector(".s-name");
      const top = seat.querySelector(".s-top");
      /* お名前を先に2行にする。ふりがなも2行にして、高さが足りなければお名前を少しだけ小さくする。
         それでも入らなければ、ふりがなは1行に戻して小さくする */
      if (splits(name)) name.classList.add("two");
      if (splits(top)) {
        top.classList.add("two");
        if (name) shrink(name, tall, 0.86);
        if (tall()) { top.classList.remove("two"); if (name) name.style.fontSize = ""; }
      }
      parts.forEach(el => shrink(el, () => wide(el)));
      if (name) shrink(name, tall);
      if (top) shrink(top, tall);
    });
  }
  window.addEventListener("resize", () => fitSeats());

  function personChip(p, extra) {
    const at = seatOf(p.key);
    const sel = selected && selected.key === p.key ? " picked" : "";
    return `<button type="button" class="chip c-${p.role}${at ? " seated" : ""}${sel}" data-drag="${esc(p.key)}" data-pick="${esc(p.key)}">
      ${extra || ""}<span class="c-name">${esc(p.name)}${sexDot(p)}</span>${at ? `<span class="c-at">${esc(tableName(at))}</span>` : `<span class="c-at none">席なし</span>`}</button>`;
  }

  function renderPool() {
    if (!EDIT) return;
    const guests = dayGuests();
    const want = kind === "ms" ? guests : guests.filter(g => g.breakfast);
    const rest = kind === "ms" ? [] : guests.filter(g => !g.breakfast);
    const card = g => {
      const at = seatOf(g.key);
      const sel = selected && selected.key === g.key ? " picked" : "";
      const atts = attendantsOf(g);
      const att = atts.length
        ? atts.map(a => personChip(a, `<span class="c-role">アテンド</span>`)).join("")
        : `<button type="button" class="chip c-missing" data-find-for="${esc(g.key)}"><span class="c-role">アテンド</span><span class="c-name">未登録・名簿から選ぶ</span></button>`;
      return `<div class="g-item${at ? " seated" : ""}">
        <button type="button" class="g-main${sel}" data-drag="${esc(g.key)}" data-pick="${esc(g.key)}">
          <span class="g-kana">${esc(g.kana || "ふりがな未登録")}</span>
          <span class="g-name">${esc(g.name)}<small>様</small>${sexDot(g)}</span>
          <span class="g-ref">紹介者　${esc(g.referrer || "—")}</span>
          <span class="g-marks">${g.marks.map(m => `<i>${esc(m)}</i>`).join("")}</span>
          <span class="g-at${at ? "" : " none"}">${at ? esc(tableName(at)) : "席なし"}</span>
        </button>
        <div class="g-att">${att}</div>
      </div>`;
    };
    const others = Object.keys(seats).map(id => seats[id])
      .filter(p => p.type !== "guest" && p.role !== "attend");
    let html = `<div class="pool-head"><h2>${kind === "ms" ? "この日のゲスト" : "朝食会に参加予定のゲスト"}</h2><span>${want.length}名</span></div>`;
    if (loading && !board) html += `<p class="pool-empty">読み込んでいます…</p>`;
    else if (!want.length) html += `<p class="pool-empty">${kind === "ms" ? "この日のゲストは、まだ登録されていません。<br>受付・紹介者フォームで入れると、ここに出ます。" : "朝食会に参加予定のゲストは、まだいません。"}</p>`;
    html += want.map(card).join("");
    if (rest.length) {
      html += `<details class="pool-more"><summary>ほかのゲスト（朝食会の予定は未確認）${rest.length}名</summary>${rest.map(card).join("")}</details>`;
    }
    if (others.length) {
      html += `<div class="pool-head sm"><h2>席にいる役の方</h2></div><div class="g-att">${others.map(p => personChip(p, `<span class="c-role">${esc(ROLE_SHORT[p.role] || "会員")}</span>`)).join("")}</div>`;
    }
    html += `<div class="pool-head sm"><h2>お役</h2><button type="button" class="linklike" id="btn-duty-pool">追加</button></div>`;
    html += duties.length
      ? `<div class="g-att">${duties.map(d => {
          const at = d.seat && seatDef(d.seat) ? tableName(d.seat) : "";
          const sel = selectedDuty && selectedDuty.id === d.id ? " picked" : "";
          return `<button type="button" class="chip c-yaku${sel}" data-duty="${esc(d.id)}" data-pick-duty="${esc(d.id)}">
            <span class="c-name">${esc(d.name)}</span>${at ? `<span class="c-at">${esc(at)}</span>` : `<span class="c-at none">席なし</span>`}
            <span class="c-del" data-duty-del="${esc(d.id)}">削除</span></button>`;
        }).join("")}</div>`
      : `<p class="pool-empty">お役はまだありません。「お役を追加」から、朝の挨拶などを置けます。</p>`;
    $("pool").innerHTML = html;
    if ($("btn-duty-pool")) $("btn-duty-pool").onclick = openDutyDialog;
  }

  function renderWarnings() {
    const box = $("warn");
    const list = loading && !board ? [] : warnings();
    box.hidden = !list.length;
    box.innerHTML = list.map(w => `<li class="${w.level}">${esc(w.text)}</li>`).join("");
  }

  function renderToolbar() {
    $("date-label").textContent = K.jaDate(date);
    document.querySelectorAll("[data-kind]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.kind === kind)));
    const st = $("status");
    st.className = "status" + (dirty ? " dirty" : "");
    st.textContent = loading ? "読み込んでいます…"
      : dirty ? "保存していない変更があります"
      : server ? "保存済み　" + server.updatedBy + "（" + server.updatedAt.slice(5).replace("-", "/") + "）"
      : EDIT ? "まだ保存されていません" : "";
    if (EDIT) {
      $("btn-save").textContent = "保存";
      $("btn-save").classList.toggle("ready", dirty);
      const canCopy = previous && previous.data && previous.data.seats && !Object.keys(seats).some(id => seats[id].type !== "guest" && ["chair", "leader", "mc"].includes(seats[id].role));
      $("btn-template").hidden = !canCopy;
      if (canCopy) $("btn-template").textContent = "前回（" + K.jaDateShort(previous.date) + "）の会長・司会・リーダーを写す";
    }
  }

  function renderNotice() {
    const box = $("notice");
    const text = notice || loadError;
    box.hidden = !text;
    box.innerHTML = esc(text) +
      (noticeAction ? ` <button type="button" class="btn-sm" id="notice-act">${esc(noticeAction.label)}</button>` : "") +
      (noticeAction2 ? ` <button type="button" class="btn-sm ghost" id="notice-act2">${esc(noticeAction2.label)}</button>` : "");
    if (noticeAction) $("notice-act").onclick = noticeAction.fn;
    if (noticeAction2) $("notice-act2").onclick = noticeAction2.fn;
  }

  function tagClass(t) {
    if (/休会|なし/.test(t)) return "hot";
    if (/あり/.test(t)) return "ok";
    if (/ダブル|トリプル|講話/.test(t) && !/自単会/.test(t)) return "pink";
    if (/バッジ|辞令|夢|抱負/.test(t)) return "gold";
    return "";
  }
  function renderProgram() {
    const box = $("program");
    if (!box) return;
    if (kind !== "ms") { box.hidden = true; box.innerHTML = ""; return; }
    const p = todayProgram();
    if (programError && !p) {
      box.hidden = false;
      box.innerHTML = `<p class="p-empty">${esc(programError)}</p>`;
      return;
    }
    if (!p) {
      box.hidden = false;
      box.innerHTML = `<div class="program-head"><h2>今日のモーニングセミナー</h2></div><p class="p-empty">この日の進行は、まだ進行表に入っていません。</p>`;
      return;
    }
    const tags = (p.tags || []).map(t => `<span class="ptag ${tagClass(t)}">${esc(t)}</span>`).join("");
    const people = p.speakers.map(s => `<article class="p-card">
      <div class="k">${esc(s.label)}</div>
      <div class="nm">${esc(s.name)}${s.kana ? `<span class="kn">${esc(s.kana)}</span>` : ""}</div>
      ${s.callAs ? `<div class="call">呼び出し　${esc(s.callAs)}</div>` : ""}
      ${s.title ? `<div class="ttl">${esc(s.title)}</div>` : ""}
      <div class="eq">ホワイトボード ${esc(s.whiteboard)}　／　プロジェクター ${esc(s.projector)}</div>
    </article>`).join("");
    const speech = p.speech
      ? `<article class="p-card speech"><div class="k">会員スピーチ</div><div class="nm">${esc(p.speech.name)}${p.speech.kana ? `<span class="kn">${esc(p.speech.kana)}</span>` : ""}</div>${p.speech.role ? `<div class="call">${esc(p.speech.role)}</div>` : ""}</article>`
      : `<article class="p-card speech"><div class="k">会員スピーチ</div><div class="nm">なし</div></article>`;
    box.hidden = false;
    box.innerHTML = `<div class="program-head">
      <h2>今日のモーニングセミナー</h2>
      <div class="ptags">${tags}</div>
      <a href="${esc(p.sheetUrl)}" target="_blank" rel="noopener">進行表を開く</a>
    </div>
    ${p.recess ? `<p class="p-empty">この日は休会です。</p>` : `<div class="p-people">${people}${speech}</div>`}`;
  }

  function renderPicking() {
    const bar = $("picking");
    if (!EDIT) return;
    bar.hidden = !selected && !selectedDuty;
    if (selectedDuty) $("picking-text").textContent = "「" + selectedDuty.name + "」を置く席を押してください";
    else if (selected) $("picking-text").textContent = selected.name + (selected.type === "guest" ? "様" : " さん") + "を置く席を押してください";
  }

  function render() {
    renderToolbar();
    renderNotice();
    renderProgram();
    renderPicking();
    renderWarnings();
    renderPool();
    renderBoard();
  }

  /* ---------- 人を探す（キーから） ---------- */
  function findPerson(key) {
    const id = seatOf(key);
    if (id) return seats[id];
    for (const g of dayGuests()) {
      if (g.key === key) return g;
      for (const a of attendantsOf(g)) if (a.key === key) return a;
    }
    if (selected && selected.key === key) return selected;
    const sug = suggestions();
    for (const sid in sug) if (sug[sid].key === key) return sug[sid];
    return null;
  }

  /* ---------- 選んで置く ---------- */
  function pick(key) {
    const p = findPerson(key);
    if (!p) return;
    selectedDuty = null;
    selected = selected && selected.key === key ? null : p;
    render();
  }
  function openDutyDialog() {
    $("duty-presets").innerHTML = DUTY_PRESETS.map(n => `<button type="button" class="role-btn r-yaku" data-preset="${esc(n)}">${esc(n)}</button>`).join("");
    $("duty-free").value = "";
    $("duty-dialog").showModal();
    setTimeout(() => $("duty-free").focus(), 50);
  }
  function onSeat(id, ghostKey) {
    if (!EDIT) return;
    if (selectedDuty) { moveDuty(selectedDuty, id); return; }
    if (ghostKey && !selected) {
      const p = findPerson(ghostKey);
      if (p) place(p, id);
      return;
    }
    if (selected) { place(selected, id); return; }
    if (seats[id]) openSeatDialog(id);
    else openPicker(id);
  }

  /* ---------- 空いている席を押したとき：座る方を選ぶ ---------- */
  let pickerSeat = "", pickerRole = "attend", pickerFor = "";
  function openPicker(id, forGuest) {
    pickerSeat = id || "";
    pickerFor = forGuest || "";
    const s = id ? seatDef(id) : null;
    const duty = id ? dutyOn(id) : null;
    pickerRole = duty ? "yaku" : (s && ["chair", "speaker", "mc", "leader"].includes(s.hint) ? s.hint : "attend");
    $("picker-title").textContent = id
      ? tableName(id) + (s && s.table ? "の席" : "") + (duty ? "（" + duty.name + "）" : "") + "に座る方"
      : "アテンドを名簿から選ぶ";
    const guests = dayGuests();
    const cands = [];
    guests.forEach(g => {
      if (!seatOf(g.key)) cands.push(g);
      g.attendants.forEach(n => { const a = attendPerson(n, g.key); if (!seatOf(a.key) && !cands.some(c => c.key === a.key)) cands.push(a); });
    });
    $("picker-cands-box").hidden = !id || !cands.length;
    $("picker-cands").innerHTML = cands.map(p => `<button type="button" class="chip c-${p.role}" data-cand="${esc(p.key)}">
      <span class="c-role">${p.type === "guest" ? "ゲスト" : "アテンド"}</span><span class="c-name">${esc(p.name)}${p.type === "guest" ? "様" : ""}</span>${p.kana ? `<span class="c-at">${esc(p.kana)}</span>` : ""}</button>`).join("");
    $("picker-q").value = "";
    $("picker-hits").innerHTML = "";
    $("picker-free").value = "";
    $("picker-roles-box").hidden = !!forGuest;
    renderPickerRoles();
    $("picker").showModal();
    if (!id || !cands.length) setTimeout(() => $("picker-q").focus(), 50);
  }
  function renderPickerRoles() {
    const keys = ["attend", "leader", "chair", "speaker", "mc", "yaku", "member", "guest"];
    const duty = pickerSeat ? dutyOn(pickerSeat) : null;
    $("picker-roles").innerHTML = keys.map(k => `<button type="button" class="role-btn r-${k}" data-role="${k}" aria-pressed="${k === pickerRole}">${esc(k === "yaku" && duty ? duty.name : ROLES[k])}</button>`).join("");
  }
  function pickerPlace(p) {
    $("picker").close();
    if (pickerSeat) place(p, pickerSeat);
    else { selected = p; render(); }
  }
  $("picker-roles").addEventListener("click", e => {
    const b = e.target.closest("[data-role]");
    if (!b) return;
    pickerRole = b.dataset.role;
    renderPickerRoles();
  });
  $("picker-cands").addEventListener("click", e => {
    const b = e.target.closest("[data-cand]");
    if (!b) return;
    const p = findPerson(b.dataset.cand);
    if (p) pickerPlace(p);
  });
  $("picker-q").addEventListener("input", () => {
    const hits = K.searchMembers($("picker-q").value);
    $("picker-hits").innerHTML = hits.map(m => `<button type="button" class="hit" data-mid="${esc(m.id || m.name)}">
      <b>${esc(m.name)}</b><span>${esc(m.kana)}</span>${seatOf("m:" + (m.id || flat(m.name))) ? `<em>${esc(tableName(seatOf("m:" + (m.id || flat(m.name)))))}にいます</em>` : ""}</button>`).join("")
      || ($("picker-q").value.trim() ? `<p class="pool-empty">名簿に見つかりません。下の「名簿にない方」から入れてください。</p>` : "");
  });
  $("picker-hits").addEventListener("click", e => {
    const b = e.target.closest("[data-mid]");
    if (!b) return;
    const m = U.members.find(x => (x.id || x.name) === b.dataset.mid);
    if (!m) return;
    const role = pickerFor ? "attend" : pickerRole === "guest" ? "member" : pickerRole;
    pickerPlace(memberPerson(m, role, pickerFor));
  });
  $("picker-free-add").addEventListener("click", () => {
    const name = $("picker-free").value.trim();
    if (!name) { $("picker-free").focus(); return; }
    pickerPlace(otherPerson(name, pickerFor ? "attend" : pickerRole));
  });
  $("picker-close").addEventListener("click", () => $("picker").close());

  /* ---------- 名前の入った席を押したとき ---------- */
  let dialogSeat = "";
  function openSeatDialog(id) {
    dialogSeat = id;
    const p = seats[id];
    const s = seatDef(id);
    const duty = dutyOn(id);
    $("seat-where").textContent = (s && s.no ? s.table + "卓の " : "") + tableName(id) + (duty ? "（" + duty.name + "）" : "");
    $("seat-duty-box").hidden = !duty;
    $("seat-duty-name").textContent = duty ? duty.name : "";
    $("seat-name").innerHTML = p.type === "guest"
      ? `<small>${esc(p.kana)}</small>${esc(p.name)}様`
      : `${p.kana ? `<small>${esc(p.kana)}</small>` : ""}${esc(p.name)}`;
    $("seat-info").innerHTML = p.type === "guest"
      ? `<dt>紹介者</dt><dd>${esc(p.referrer || "—")}</dd><dt>アテンド</dt><dd>${esc(attendantsOf(p).map(a => a.name).join("、") || "未登録")}</dd>${p.marks && p.marks.length ? `<dt>印</dt><dd>${esc(p.marks.join("・"))}</dd>` : ""}`
      : "";
    $("seat-roles-box").hidden = p.type === "guest";
    if (p.type !== "guest") {
      const duty = dutyOn(id);
      $("seat-roles").innerHTML = ["attend", "leader", "chair", "speaker", "mc", "yaku", "member"].map(k =>
        `<button type="button" class="role-btn r-${k}" data-role="${k}" aria-pressed="${k === p.role}">${esc(k === "yaku" && duty ? duty.name : ROLES[k])}</button>`).join("");
    }
    $("seat-dialog").showModal();
  }
  $("seat-roles").addEventListener("click", e => {
    const b = e.target.closest("[data-role]");
    if (!b || !seats[dialogSeat]) return;
    seats[dialogSeat] = Object.assign({}, seats[dialogSeat], { role: b.dataset.role });
    $("seat-dialog").close();
    changed();
  });
  $("seat-move").addEventListener("click", () => {
    $("seat-dialog").close();
    selected = seats[dialogSeat];
    render();
  });
  $("seat-remove").addEventListener("click", () => {
    $("seat-dialog").close();
    unseat(seats[dialogSeat].key);
  });
  $("seat-close").addEventListener("click", () => $("seat-dialog").close());
  $("seat-duty-move").addEventListener("click", () => {
    const d = dialogSeat ? dutyOn(dialogSeat) : null;
    $("seat-dialog").close();
    if (d) pickDuty(d.id);
  });
  $("seat-duty-off").addEventListener("click", () => {
    const d = dialogSeat ? dutyOn(dialogSeat) : null;
    $("seat-dialog").close();
    if (d) unplaceDuty(d.id);
  });

  /* ---------- マウスでつかんで運ぶ（指で押したときは「選んで置く」になる） ---------- */
  let drag = null;
  document.addEventListener("pointerdown", e => {
    if (!EDIT || e.pointerType === "touch" || e.button !== 0) return;
    if (e.target.closest("[data-duty-del],[data-duty-off]")) return;
    const dutyEl = e.target.closest("[data-duty]");
    if (dutyEl) {
      drag = { duty: dutyEl.dataset.duty, x: e.clientX, y: e.clientY, el: dutyEl, moving: false, ghost: null };
      return;
    }
    const el = e.target.closest("[data-drag]");
    if (!el) return;
    drag = { key: el.dataset.drag, x: e.clientX, y: e.clientY, el, moving: false, ghost: null };
  });
  document.addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      if (drag.duty) {
        const d = findDuty(drag.duty);
        if (!d) { drag = null; return; }
        drag.moving = true;
        drag.ghost = document.createElement("div");
        drag.ghost.className = "drag-ghost r-yaku";
        drag.ghost.textContent = d.name;
        document.body.appendChild(drag.ghost);
        document.body.classList.add("dragging");
      } else {
        const p = findPerson(drag.key);
        if (!p) { drag = null; return; }
        drag.moving = true;
        drag.ghost = document.createElement("div");
        drag.ghost.className = "drag-ghost r-" + p.role;
        drag.ghost.textContent = p.name + (p.type === "guest" ? "様" : "");
        document.body.appendChild(drag.ghost);
        document.body.classList.add("dragging");
      }
    }
    drag.ghost.style.left = e.clientX + "px";
    drag.ghost.style.top = e.clientY + "px";
    document.querySelectorAll(".drop-on").forEach(x => x.classList.remove("drop-on"));
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const tgt = over && (over.closest("[data-seat]") || over.closest("#pool"));
    if (tgt) tgt.classList.add("drop-on");
  });
  document.addEventListener("pointerup", e => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moving) return;
    d.ghost.remove();
    document.body.classList.remove("dragging");
    document.querySelectorAll(".drop-on").forEach(x => x.classList.remove("drop-on"));
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const seat = over && over.closest("[data-seat]");
    if (d.duty) {
      const duty = findDuty(d.duty);
      if (!duty) return;
      if (seat) moveDuty(duty, seat.dataset.seat);
      else if (over && over.closest("#pool")) unplaceDuty(duty.id);
      return;
    }
    const p = findPerson(d.key);
    if (!p) return;
    if (seat) place(p, seat.dataset.seat);
    else if (over && over.closest("#pool")) unseat(p.key);
  });
  let suppressClick = false;

  /* ---------- クリック ---------- */
  document.addEventListener("click", e => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    const del = e.target.closest("[data-duty-del]");
    if (del) { removeDuty(del.dataset.dutyDel); return; }
    const off = e.target.closest("[data-duty-off]");
    if (off) { unplaceDuty(off.dataset.dutyOff); return; }
    const nine = e.target.closest("[data-nine]");
    if (nine) { setTableSize(nine.dataset.nine, extras[nine.dataset.nine] === 9 ? 8 : 9); return; }
    const pd = e.target.closest("[data-pick-duty]");
    if (pd) { pickDuty(pd.dataset.pickDuty); return; }
    const dutyHint = e.target.closest("#board [data-duty]");
    if (dutyHint) { pickDuty(dutyHint.dataset.duty); return; }
    const seat = e.target.closest("#board [data-seat]");
    if (seat) { onSeat(seat.dataset.seat, seat.dataset.ghost || ""); return; }
    const pk = e.target.closest("#pool [data-pick]");
    if (pk) { pick(pk.dataset.pick); return; }
    const ff = e.target.closest("#pool [data-find-for]");
    if (ff) { openPicker("", ff.dataset.findFor); return; }
  }, true);

  /* ---------- 日付・種類・ボタン ---------- */
  function setUrl() {
    const q = new URLSearchParams({ date, kind });
    if (EDIT) q.set("edit", "1");
    try { history.replaceState(null, "", location.pathname + "?" + q); } catch (e) { /* ignore */ }
  }
  function go(nextDate, nextKind) {
    if (dirty && !confirm("保存していない変更があります。この端末には残しておくので、あとで戻れば続きから直せます。移りますか？")) return;
    date = nextDate;
    kind = nextKind;
    seats = {};
    extras = {};
    duties = defaultDuties();
    server = null;
    previous = null;
    dirty = false;
    selected = null;
    selectedDuty = null;
    notice = "";
    noticeAction = null;
    noticeAction2 = null;
    setUrl();
    reloadAll();
  }
  $("prev").addEventListener("click", () => go(addDays(date, -7), kind));
  $("next").addEventListener("click", () => go(addDays(date, 7), kind));
  $("btn-today").addEventListener("click", () => go(nextTuesday(today), kind));
  document.querySelectorAll("[data-kind]").forEach(b => b.addEventListener("click", () => { if (b.dataset.kind !== kind) go(date, b.dataset.kind); }));
  $("btn-reload").addEventListener("click", () => {
    if (dirty) { notice = ""; noticeAction = null; }
    reloadAll(true);
  });
  $("btn-image").addEventListener("click", () => window.HAISEKI_IMAGE.share({
    layout: layout(), seats, duties, date, kind, colors: COLORS, roles: ROLES, roleShort: ROLE_SHORT, attendantsOf, genderOf,
    title: K.jaDate(date) + "　" + layout().title + "　配席", dateLabel: K.jaDate(date), kindTitle: layout().title, org: C.org,
    program: todayProgram()
  }));
  /* 見る用 ⇔ 編集の切り替え（同じ日付・種類のまま開き直す。保存していない変更はこの端末に残る） */
  const reopen = edit => {
    const q = new URLSearchParams({ date, kind });
    if (edit) q.set("edit", "1");
    location.href = location.pathname + "?" + q;
  };
  $("btn-edit").addEventListener("click", () => reopen(true));
  $("btn-view").addEventListener("click", () => reopen(false));
  $("btn-link").addEventListener("click", async () => {
    const url = location.origin + location.pathname + "?" + new URLSearchParams({ date, kind });
    try { await navigator.clipboard.writeText(url); showNotice("見る用のリンクをコピーしました：" + url); }
    catch (e) { prompt("見る用のリンク", url); }
  });
  if (EDIT) {
    $("who").value = localStorage.getItem("haiseki.who") || "";
    $("who").addEventListener("change", () => localStorage.setItem("haiseki.who", who()));
    $("btn-save").addEventListener("click", () => save(false));
    /* ゲスト一覧をしまう／出す（この端末で覚えておく） */
    const poolOff = on => {
      document.body.classList.toggle("pool-off", on);
      $("btn-pool").textContent = on ? "ゲスト一覧を出す" : "ゲスト一覧をしまう（席図を広く）";
      try { localStorage.setItem("haiseki.poolOff", on ? "1" : ""); } catch (e) { /* ignore */ }
      fitSeats();
    };
    let off = false;
    try { off = localStorage.getItem("haiseki.poolOff") === "1"; } catch (e) { /* ignore */ }
    poolOff(off);
    $("btn-pool").addEventListener("click", () => poolOff(!document.body.classList.contains("pool-off")));
    $("picking-cancel").addEventListener("click", () => { selected = null; selectedDuty = null; render(); });
    $("btn-duty").addEventListener("click", openDutyDialog);
    $("duty-presets").addEventListener("click", e => {
      const b = e.target.closest("[data-preset]");
      if (!b) return;
      $("duty-dialog").close();
      addDuty(b.dataset.preset);
    });
    $("duty-free-add").addEventListener("click", () => {
      const name = $("duty-free").value.trim();
      if (!name) { $("duty-free").focus(); return; }
      $("duty-dialog").close();
      addDuty(name);
    });
    $("duty-close").addEventListener("click", () => $("duty-dialog").close());
    $("btn-template").addEventListener("click", () => {
      if (!previous) return;
      let n = 0;
      Object.keys(previous.data.seats).forEach(id => {
        const p = previous.data.seats[id];
        if (p.type === "guest" || !["chair", "leader", "mc"].includes(p.role) || seats[id] || !seatDef(id) || seatOf(p.key)) return;
        seats[id] = p;
        n++;
      });
      showNotice(n ? "前回の会長・司会・リーダー " + n + "名を同じ席に写しました。違う方は席を押して直してください。" : "写せる方がいませんでした。");
      if (n) changed();
    });
    $("btn-clear").addEventListener("click", () => {
      if (!Object.keys(seats).length || !confirm("この回の席をすべて空けます。保存するまではスプレッドシートには反映されません。よろしいですか？")) return;
      seats = {};
      changed();
    });
    window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && (selected || selectedDuty)) { selected = null; selectedDuty = null; render(); } });
  }

  K.loadMembers();
  setUrl();
  duties = defaultDuties();
  render();
  K.startLivePolling({ load: () => reloadAll(false).then(() => { if (loadError) throw new Error(loadError); }) });
})();
