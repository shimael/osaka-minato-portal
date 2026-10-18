/* ============================================================
 *  モーニングセミナー受付 ― 設定
 *  スプレッドシート連携の URL と、画面側の既定値だけをここに置きます。
 * ============================================================ */
const UKETSUKE_CONFIG = {
  org: "大阪みなと倫理法人会",
  jitanKai: "大阪みなと", // 自単会の名前（ゲストの他単会と区別するため）

  api: {
    // GAS をデプロイして得た https://script.google.com/macros/s/××××/exec を貼る
    // 空のままだと、この端末の localStorage にだけ保存されます（共有されません）
    endpoint: "https://script.google.com/macros/s/AKfycbxuiaetramtyTzYDEUF_7tesx9Cw2thfHI5pRf7dTLUxYOSdTq_Y1ilL5PBAb2bWr5i/exec",
    // 合言葉の代わりに使う固定の鍵。画面には出ません（受付の人は名前を入れるだけで使えます）。
    // uketsuke-gas/Code.gs の ADMIN_KEY と必ず同じ文字列にしてください。
    key: "uketsuke-minato-2026",
    // ゲストの事前申込フォーム用の鍵。申込と来場予定日の取得しかできない（Code.gs の GUEST_FORM_KEY と同じ）
    guestFormKey: "guest-minato-2026"
  },

  /* ご本人用の申込フォーム（外の方に渡すページ）。紹介者用フォームの送信後に、転送用のリンクとして出す */
  guestFormUrl: "https://osaka-minato-guest.surge.sh/",

  /* 会員名簿の取り込み元（「名簿を更新」ボタンで読みに行く公開CSV）。
     ふだんは members-data.js に焼き込んだ名簿をそのまま使うので、
     電波がなくても候補は出ます。ここは更新ボタンを押したときだけ使います。
     空にすると更新ボタンは出ません。 */
  membersCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT4bLuHafLVVuZsVg64IHEhYHtJVJTdbIKCLdO4_OQ_q4JO9vXdRlKvloFl_FfIp6YkSiJoYKLl5HLN/pub?gid=548606881&single=true&output=csv",

  /* 名簿の取得からこの日数が経ったら「更新しませんか」と促す */
  membersStaleDays: 14,

  /* 複数人で同時に入力するとき、他の端末の登録を取り込むのは
     画面の「更新」ボタンを押したときだけ。自動では読みに行きません。 */

  /* 受付でチェックする会（紙のリストと同じ並び） */
  attendance: [
    { key: "chourei", label: "朝礼" },
    { key: "ms",      label: "モーニングセミナー" },
    { key: "share",   label: "シェア会" }
  ],

  /* 新入会員の判定：この月の1日を基準に、直近のこの月〜今日までを新入会員とする */
  newMemberAnchorMonth: 5 // 5 = 5月
};
