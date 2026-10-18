/* ============================================================
 *  チームの月別出席の表（チーム別出席ページと出席簿ページで共通）
 *  teamTableHtml(d) に API の1チーム分を渡すと、見出し・表・注意書きの HTML を返す。
 * ============================================================ */
(function () {
  const css = `
  .team-table .title{font-size:1.1rem;font-weight:800;margin:0 0 2px}
  .team-table .title small{font-weight:500;color:#6b7686;font-size:.82rem;margin-left:6px}
  .team-table .scroll{overflow-x:auto;margin-top:10px;-webkit-overflow-scrolling:touch}
  .team-table table{border-collapse:separate;border-spacing:0;font-size:.85rem;white-space:nowrap}
  .team-table th,.team-table td{padding:7px 10px;border-bottom:1px solid #e5e9f0;text-align:center;background:#fff}
  .team-table thead th{background:#f5f7fa;font-weight:700;color:#3a4657;position:sticky;top:0}
  .team-table th.name,.team-table td.name{position:sticky;left:0;z-index:1;text-align:left;border-right:1px solid #e5e9f0}
  .team-table thead th.name{z-index:2}
  .team-table td.role{text-align:left;color:#6b7686;font-size:.78rem}
  .team-table td.na{color:#b4bcc8}
  .team-table td.full{color:#0b6b3a;font-weight:700}
  .team-table td.zero{color:#b23a3a}
  .team-table td.guest{color:#9a6a00;background:#fff8e6;font-size:.78rem}
  .team-table .g{display:block;font-size:.68rem;color:#9a6a00;font-weight:500}
  .team-table td.total,.team-table th.total{border-left:1px solid #e5e9f0;font-weight:700}
  .team-table tr.late td{background:#fbfcfd}
  .team-table tr.late td.guest{background:#fff8e6}
  .team-table .moved{display:block;font-size:.7rem;color:#6b7686}
  .team-table tfoot td{background:#f8fafc;font-weight:700}
  .team-table tfoot tr:first-child td{border-top:2px solid #cfd6e0}
  .team-table .msg{padding:22px 4px;color:#6b7686;text-align:center}
  .team-table .warn{margin-top:10px;font-size:.78rem;color:#9a5b00;background:#fff6e6;border-radius:8px;padding:8px 10px}
  .team-table .legend{font-size:.75rem;color:#6b7686;margin-top:8px}`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const monthLabel = m => Number(m.slice(5, 7)) + "月";
  const pct = (a, b) => b ? (a / b * 100).toFixed(1) + "%" : "";

  function cellHtml(c, m, member){
    const g = (member.guest || {})[m];
    if (c === "notMember") {
      if (g) return `<td class="guest">ゲスト${g}回</td>`;
      const note = member.movedOut && member.movedOut.month === m
        ? `<span class="moved">${member.movedOut.team ? esc(member.movedOut.team) + "へ" : "チームを離れる"}</span>` : "";
      return `<td class="na">—${note}</td>`;
    }
    if (!c) return "<td></td>";
    const cls = c.attended === c.held ? "full" : (c.attended === 0 ? "zero" : "");
    return `<td class="${cls}">${c.attended}/${c.held}${g ? `<span class="g">＋ゲスト${g}</span>` : ""}</td>`;
  }

  window.teamTableHtml = function (d){
    const months = d.months;
    const active = months.filter(m => d.held[m]);
    const sum = { held: 0, total: 0, slot: 0 };
    active.forEach(m => { const s = d.summary[m]; sum.held += d.held[m]; sum.total += s.attendedTotal; sum.slot += s.slotTotal; });
    const hasGuest = d.members.some(mb => mb.guest && Object.keys(mb.guest).length);

    const head = `<tr><th class="name">氏名</th><th>役割</th><th>参加月</th>${months.map(m => `<th>${monthLabel(m)}</th>`).join("")}<th class="total">期計</th></tr>`;
    const body = d.members.map(mb => {
      const t = mb.total.held ? `${mb.total.attended}/${mb.total.held}` : "";
      return `<tr class="${mb.joinMonth ? "late" : ""}">
        <td class="name">${esc(mb.name)}</td>
        <td class="role">${esc((mb.role || "").replace(/（.*）$/, ""))}</td>
        <td>${mb.joinMonth ? monthLabel(mb.joinMonth) : ""}</td>
        ${months.map(m => cellHtml(mb.cells[m], m, mb)).join("")}
        <td class="total">${t}</td></tr>`;
    }).join("");
    const row = (label, f, total) => `<tr><td class="name">${label}</td><td></td><td></td>${months.map(m => `<td>${d.held[m] ? f(d.summary[m], m) : ""}</td>`).join("")}<td class="total">${total}</td></tr>`;
    const foot =
      row("開催回数", (s, m) => d.held[m], sum.held || "") +
      row("出席人数", s => `${s.attendedMembers}/${s.targetMembers}人`, "") +
      row("延べ出席", s => `${s.attendedTotal}/${s.slotTotal}`, sum.slot ? `${sum.total}/${sum.slot}` : "") +
      row("出席率", s => pct(s.attendedTotal, s.slotTotal), pct(sum.total, sum.slot));

    return `<div class="team-table">
      <p class="title">${esc(d.team)}<small>${esc(d.committee)}</small></p>
      ${active.length ? "" : `<div class="msg">この期のモーニングセミナーはまだ開催されていません。</div>`}
      <div class="scroll"><table><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>
      ${hasGuest ? `<div class="legend">「ゲスト◯回」は入会前にゲストとして来た回数です。出席率には入れていません。</div>` : ""}
      ${d.warnings.length ? `<div class="warn">${d.warnings.map(esc).join("<br>")}</div>` : ""}
    </div>`;
  };
})();
