/* ============================================================
 *  MS・朝食会 配席 ― 会場の席図
 *
 *  丸テーブルの席は、卓の円のすぐ外側に置く（離れた方眼に散らさない）。
 *  上が前方（演台側）。中央の列は前を向く自由席。
 * ============================================================ */
(function (global) {
  "use strict";

  /* 0°＝右、90°＝下、−90°＝上。卓の円のすぐ外に2席ずつ */
  const SLOT = {
    t1: -114, t2: -66,
    l1: 156, l2: 204,
    r1: -24, r2: 24,
    b1: 114, b2: 66
  };

  function polar(cx, cy, ring, deg) {
    const a = deg * Math.PI / 180;
    return [Math.round(cx + ring * Math.cos(a)), Math.round(cy + ring * Math.sin(a))];
  }

  function roundTable(id, label, cx, cy, sides, opts) {
    const o = Object.assign({ r: 112, ring: 168, hints: {}, note: "" }, opts || {});
    const seats = [];
    sides.split("").forEach(s => {
      [1, 2].forEach(n => {
        const pos = s + n;
        const h = o.hints[pos] || {};
        const ring = h.label ? o.ring + 16 : o.ring;
        const xy = polar(cx, cy, ring, SLOT[pos]);
        const seat = {
          id: id + "-" + pos, table: id, x: xy[0], y: xy[1],
          hint: h.hint || "", label: h.label || ""
        };
        if (h.label) { seat.w = 150; seat.h = 84; }
        seats.push(seat);
      });
    });
    return { table: { id, label, x: cx, y: cy, r: o.r, note: o.note || "" }, seats };
  }

  function build(def) {
    const tables = [], seats = [];
    def.parts.forEach(p => {
      if (p.table) tables.push(p.table);
      p.seats.forEach(s => seats.push(s));
    });
    return {
      id: def.id, title: def.title, width: def.width, height: def.height,
      seatW: def.seatW, seatH: def.seatH, front: def.front,
      tables, seats, blocks: def.blocks || []
    };
  }

  function centerBlock(id, label, x0, y0, cols, rows, gapX, gapY, w, h) {
    const seats = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        seats.push({
          id: id + "-" + (r + 1) + "-" + (c + 1), table: id,
          x: x0 + c * gapX, y: y0 + r * gapY, w, h, hint: "", label: ""
        });
      }
    }
    return { table: null, block: { id, label }, seats };
  }

  const leaderTop = { t1: { hint: "leader" } };
  const choshoku = build({
    id: "choshoku",
    title: "朝食会",
    width: 1180,
    height: 1280,
    seatW: 118,
    seatH: 62,
    front: "前方",
    parts: [
      { seats: [
        { id: "mc-1", table: "", x: 150, y: 88, hint: "mc", label: "司会" },
        { id: "mc-2", table: "", x: 300, y: 88, hint: "mc", label: "司会" }
      ] },
      roundTable("A", "A", 300, 360, "tlrb", { hints: leaderTop }),
      roundTable("B", "B", 880, 360, "tlrb", { hints: leaderTop }),
      roundTable("C", "C", 300, 720, "tlrb", { hints: leaderTop }),
      roundTable("D", "D", 880, 720, "tlrb", { hints: leaderTop }),
      roundTable("E", "E", 300, 1080, "tlrb", { hints: leaderTop }),
      roundTable("F", "F", 880, 1080, "tlrb", { hints: leaderTop })
    ]
  });

  const yaku = {
    t1: { hint: "yaku", label: "朝の挨拶" }, t2: { hint: "yaku", label: "会員スピーチ" },
    r1: { hint: "yaku", label: "連絡事項" }, r2: { hint: "yaku", label: "誓いの言葉" }
  };
  const msW = 1280;
  const msRows = [360, 720, 1080];
  const ms = build({
    id: "ms",
    title: "モーニングセミナー",
    width: msW,
    height: 1280,
    seatW: 118,
    seatH: 62,
    front: "前方（演台）",
    parts: [
      { seats: [
        { id: "speaker", table: "", x: 168, y: 90, w: 156, h: 72, hint: "speaker", label: "講話者" },
        { id: "chair", table: "", x: msW - 168, y: 90, w: 156, h: 72, hint: "chair", label: "会長・進行" }
      ] },
      roundTable("A", "A", 230, msRows[0], "tlb"),
      roundTable("B", "B", msW - 230, msRows[0], "trb", { hints: yaku, note: "お役席" }),
      roundTable("C", "C", 230, msRows[1], "tlb"),
      roundTable("D", "D", msW - 230, msRows[1], "trb"),
      roundTable("E", "E", 230, msRows[2], "tlb"),
      roundTable("F", "F", msW - 230, msRows[2], "trb"),
      centerBlock("M1", "中央・自由席（前）", 500, msRows[0] - 40, 4, 2, 92, 78, 84, 64),
      centerBlock("M2", "中央・自由席（中）", 500, msRows[1] - 40, 4, 2, 92, 78, 84, 64),
      centerBlock("M3", "中央・自由席（後ろ）", 500, msRows[2] - 40, 4, 2, 92, 78, 84, 64)
    ],
    blocks: [
      { id: "M1", label: "中央・自由席（前）" },
      { id: "M2", label: "中央・自由席（中）" },
      { id: "M3", label: "中央・自由席（後ろ）" }
    ]
  });

  global.HAISEKI_LAYOUTS = { ms, choshoku };
})(window);
