/* ============================================================
 *  モーニングセミナー 参加お申し込み（ご本人用）― 設定
 * ============================================================ */
const GUEST_FORM_CONFIG = {
  org: "大阪みなと倫理法人会",
  // 受付の Apps Script（portal/publish/uketsuke/config.js の api.endpoint と同じ）
  endpoint: "https://script.google.com/macros/s/AKfycbxuiaetramtyTzYDEUF_7tesx9Cw2thfHI5pRf7dTLUxYOSdTq_Y1ilL5PBAb2bWr5i/exec",
  // 申込と来場予定日の取得しかできない鍵（Code.gs の GUEST_FORM_KEY と同じ）
  key: "guest-minato-2026",
  // 会場。送信後の画面に出す。空欄なら出さない
  venue: "セントグレースヴィラ",
  mapUrl: "https://maps.app.goo.gl/GRcQB9aUpN6P3Kdq6",
  // ご参加の予定の選択肢と開始時刻。required はチェックを外せない
  plans: [
    { value: "朝礼", time: "6:00〜" },
    { value: "モーニングセミナー", time: "6:30〜", required: true },
    { value: "朝食会", time: "7:50頃〜" }
  ],
  // 興味・関心の選択肢（いくつでも選べる）。足す・消すはここで
  interests: [
    "自分を変えたい",
    "家族・夫婦の関係を見つめ直したい",
    "職場の人間関係の悩みを解消したい",
    "事業をより発展させたい",
    "独立や起業を考えている",
    "社員教育・組織づくりに活かしたい",
    "経営者の仲間を増やしたい",
    "朝の時間を有効活用したい"
  ]
};
