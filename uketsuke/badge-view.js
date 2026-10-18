/* ============================================================
 *  新入会員バッジ贈呈 ― 一覧の描き方（badge.html と birthday.html で共通）
 *
 *  会長挨拶でバッジを贈呈する方のうち、来ている方だけ名前を呼ぶ。
 *  来ている方は白いカード＋緑の帯で前に出し、まだの方はカードごとグレーに沈める。
 *  来ているかどうかは、その日の受付に会員として登録されているかで見る。
 * ============================================================ */
(function (global) {
  "use strict";
  const K = global.UKETSUKE;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function withArrival(badges, records) {
    return (badges || []).map(b => {
      const rec = K.findMemberRecord(records, { memberId: b.memberId, name: b.name });
      return { badge: b, rec, arrived: K.recordArrived(rec) };
    });
  }

  function cardHtml(row, opts) {
    const b = row.badge;
    const klass = opts.hasSession ? (row.arrived ? "arrived" : "waiting") : "plain";
    const state = opts.hasSession
      ? `<div class="bv-state"><span class="bv-pill">${row.arrived ? "来ています" : "まだ"}</span></div>`
      : "";
    const time = row.arrived && row.rec ? K.normalizeRecordTime(row.rec).hm : "";
    const tools = opts.edit
      ? `<div class="bv-tools">
          <button type="button" class="btn small ghost" data-badge-memo="${esc(b.id)}">メモを直す</button>
          <button type="button" class="btn small danger" data-badge-del="${esc(b.id)}">取り消す</button>
        </div>`
      : "";
    const pending = b._pending ? `<span class="bv-pending">${esc(b._pending)}</span>` : "";
    return `<article class="bv-card ${klass}">
      <div class="bv-name"><span class="nm">${esc(b.name)}</span>${b.kana ? `<span class="kn">${esc(b.kana)}</span>` : ""}</div>
      ${state}
      <div class="bv-memo">${b.memo ? esc(b.memo) : ""}${time ? `<span class="bv-time">受付 ${esc(time)}</span>` : ""}${pending}</div>
      ${tools}
    </article>`;
  }

  /* opts: { hasSession, edit, emptyText } */
  function render(box, badges, records, opts) {
    opts = opts || {};
    const rows = withArrival(badges, records);
    if (!rows.length) {
      box.innerHTML = `<p class="bv-empty">${opts.emptyText || "この日にバッジを贈呈する方は、まだ登録されていません。"}</p>`;
      return { total: 0, arrived: 0 };
    }
    if (!opts.hasSession) {
      box.innerHTML = rows.map(r => cardHtml(r, opts)).join("");
      return { total: rows.length, arrived: 0 };
    }
    const here = rows.filter(r => r.arrived);
    const yet = rows.filter(r => !r.arrived);
    let html = "";
    if (here.length) {
      html += `<div class="bv-group here">来ています（${here.length}名）</div>`;
      html += here.map(r => cardHtml(r, opts)).join("");
    }
    if (yet.length) {
      html += `<div class="bv-group yet">まだ来ていません（${yet.length}名）</div>`;
      html += yet.map(r => cardHtml(r, opts)).join("");
    }
    box.innerHTML = html;
    return { total: rows.length, arrived: here.length };
  }

  function tallyHtml(t, hasSession) {
    if (!t.total) return "";
    if (!hasSession) return `バッジ贈呈 <b>${t.total}名</b>（受付が始まると、来ている方が上に出ます）`;
    return `バッジ贈呈 <b>${t.total}名</b>　／　来ています <span class="ok">${t.arrived}名</span>　／　まだ ${t.total - t.arrived}名`;
  }

  global.BadgeView = { render, tallyHtml };
})(window);
