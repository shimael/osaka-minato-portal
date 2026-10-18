/* ============================================================
 *  役職者ポータル ― 共通ナビゲーション
 *
 *  どのページでも同じ形で、上から次の2段を出す。
 *   1段目（ポータル帯）… 画面最上部の細い濃紺の帯。「役職者ポータル › MS受付 › 集計」の道順。
 *   2段目（セクションのタブ）… ページ見出しの下の白い帯。セクション内のページだけを並べる。
 *  いまの回の状態（受付中・締切済みなど）はナビではないので、各ページの本文側に出す。
 *
 *  使い方：ページ見出し（<header>）の直後に置く。
 *    <script src="../portal-nav.js" data-section="uketsuke" data-tab="rireki" data-page="この回の集計"></script>
 *    data-section … 下の SECTIONS のキー。無ければ帯だけ出す。
 *    data-tab     … いま開いているタブ。空ならタブを出さない（帯だけ）。
 *    data-page    … タブの下の階層にいるときのページ名（帯の道順の最後に出す）。
 * ============================================================ */
(function () {
  "use strict";
  const me = document.currentScript;
  const root = new URL("./", me.src).href;

  const SECTIONS = {
    uketsuke: {
      title: "MS受付",
      tabs: [
        { id: "entry", label: "受付", href: "uketsuke/index.html" },
        { id: "guests", label: "ゲスト情報", href: "uketsuke/guests.html" },
        { id: "haiseki", label: "配席", href: "uketsuke/haiseki.html" },
        { id: "rireki", label: "履歴・集計", href: "uketsuke/rireki.html" },
        { id: "print", label: "受付用紙の印刷", href: "uketsuke/print.html", prep: true }
      ]
    },
    ms: {
      title: "モーニングセミナー",
      tabs: [
        { id: "history", label: "履歴", href: "ms/history.html" },
        { id: "prep", label: "準備カレンダー", href: "ms/index.html" }
      ]
    }
  };

  const css = `
.pn-band{background:#0a2036; color:rgba(255,255,255,.78); font-size:.76rem; line-height:1;
  font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif}
.pn-band-in{padding:9px 20px; display:flex; align-items:center; gap:6px; flex-wrap:wrap}
.pn-band a{color:#e5c884; text-decoration:none; font-weight:700}
.pn-band a:hover{text-decoration:underline}
.pn-home{display:inline-flex; align-items:center; gap:6px}
.pn-crest{width:18px; height:18px; border-radius:50%; border:1.5px solid #c8a24a; color:#c8a24a;
  display:inline-flex; align-items:center; justify-content:center; font-size:.62rem; font-weight:800}
.pn-sep{color:rgba(255,255,255,.35)}
.pn-here{color:#fff; font-weight:700}
.pn-tabs{background:#fff; border-bottom:1px solid #dfe5ee; box-shadow:0 2px 8px rgba(20,45,80,.05);
  font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif}
.pn-tabs-in{padding:0 6px; display:flex; align-items:stretch; gap:2px;
  overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none}
.pn-tabs-in::-webkit-scrollbar{display:none}
.pn-tab{display:flex; align-items:center; padding:13px 14px 11px; border-bottom:3px solid transparent;
  color:#4a5566; text-decoration:none; font-size:.9rem; font-weight:700; white-space:nowrap}
.pn-tab:hover{color:#0f2f4f; background:#f6f8fb}
.pn-tab[aria-current="page"]{color:#0f2f4f; border-bottom-color:#c8a24a; font-weight:800}
.pn-prep{margin-left:auto; display:flex; align-items:center; gap:2px; padding-left:12px; border-left:1px solid #e5e9f0}
.pn-prep-lbl{font-size:.68rem; font-weight:800; color:#8a93a3; letter-spacing:.06em; padding:0 4px 0 2px; white-space:nowrap}
.pn-prep .pn-tab{font-size:.82rem}
@media (max-width:560px){
  .pn-tab{padding:12px 10px 10px; font-size:.84rem}
  .pn-prep-lbl{display:none}
}
@media print{ .pn-band,.pn-tabs{display:none !important} }`;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const section = SECTIONS[me.dataset.section || ""] || null;
  const tabId = me.dataset.tab || "";
  const tab = section ? section.tabs.find(t => t.id === tabId) : null;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const band = document.createElement("nav");
  band.className = "pn-band";
  band.setAttribute("aria-label", "ポータル内の現在地");
  document.body.insertBefore(band, document.body.firstChild);

  function paintBand(page) {
    const steps = [];
    if (section) {
      const first = section.tabs[0];
      const onFirst = !tab || tab === first;
      steps.push({ label: section.title, href: onFirst && !page ? "" : first.href });
      if (tab && tab !== first) steps.push({ label: tab.label, href: page ? tab.href : "" });
    }
    if (page) steps.push({ label: page, href: "" });
    band.innerHTML = `<div class="pn-band-in">
      <a class="pn-home" href="${root}index.html"><span class="pn-crest">倫</span>役職者ポータル</a>
      ${steps.map(s => `<span class="pn-sep">›</span>` + (s.href
        ? `<a href="${root + s.href}">${esc(s.label)}</a>`
        : `<span class="pn-here">${esc(s.label)}</span>`)).join("")}
    </div>`;
  }
  paintBand(me.dataset.page || "");

  if (section && tabId) {
    const link = t => `<a class="pn-tab" href="${root + t.href}"${t.id === tabId ? ' aria-current="page"' : ""}>${esc(t.label)}</a>`;
    const main = section.tabs.filter(t => !t.prep);
    const prep = section.tabs.filter(t => t.prep);
    const tabs = document.createElement("nav");
    tabs.className = "pn-tabs";
    tabs.setAttribute("aria-label", section.title + "のページ");
    tabs.innerHTML = `<div class="pn-tabs-in">${main.map(link).join("")}${prep.length
      ? `<span class="pn-prep"><span class="pn-prep-lbl">準備</span>${prep.map(link).join("")}</span>`
      : ""}</div>`;
    me.parentNode.insertBefore(tabs, me.nextSibling);
  }

  window.PortalNav = { setPage: paintBand };
})();
