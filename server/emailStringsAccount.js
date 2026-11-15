// Email strings for the new-sign-in alert (#886), in every email language.
// Merged into DICTIONARIES in emailStrings.js; English text is the key.
const K = [
  'New sign-in to your VolunTrack account',
  'Your VolunTrack account was just signed in to from {device}, on {when} (UTC).',
  "If this was you, you don't need to do anything.",
  'Not you? Sign out every device right away, then change your password.',
  'Sign out everywhere',
]
const T = {
  es: ['Nuevo inicio de sesión en tu cuenta de VolunTrack', 'Se acaba de iniciar sesión en tu cuenta de VolunTrack desde {device}, el {when} (UTC).', 'Si fuiste tú, no tienes que hacer nada.', '¿No fuiste tú? Cierra la sesión en todos los dispositivos ahora mismo y luego cambia tu contraseña.', 'Cerrar sesión en todas partes'],
  vi: ['Có đăng nhập mới vào tài khoản VolunTrack của bạn', 'Tài khoản VolunTrack của bạn vừa được đăng nhập từ {device}, lúc {when} (UTC).', 'Nếu đó là bạn, bạn không cần làm gì cả.', 'Không phải bạn? Hãy đăng xuất khỏi mọi thiết bị ngay, rồi đổi mật khẩu.', 'Đăng xuất khỏi mọi nơi'],
  zh: ['你的 VolunTrack 账号有新的登录', '你的 VolunTrack 账号刚刚在 {device} 上登录，时间为 {when}（UTC）。', '如果是你本人，无需任何操作。', '不是你？请立即退出所有设备，然后修改密码。', '退出所有设备'],
  hi: ['आपके VolunTrack खाते में नया साइन-इन', 'आपके VolunTrack खाते में अभी {device} से साइन इन किया गया, {when} (UTC) को।', 'अगर यह आप थे, तो आपको कुछ करने की ज़रूरत नहीं है।', 'आप नहीं थे? तुरंत हर डिवाइस से साइन आउट करें, फिर अपना पासवर्ड बदलें।', 'हर जगह से साइन आउट करें'],
  ar: ['تسجيل دخول جديد إلى حسابك في VolunTrack', 'تم تسجيل الدخول إلى حسابك في VolunTrack للتو من {device}، في {when} (UTC).', 'إن كنت أنت، فلا داعي لفعل أي شيء.', 'لست أنت؟ سجّل الخروج من كل الأجهزة فورًا، ثم غيّر كلمة المرور.', 'تسجيل الخروج من كل مكان'],
  pt: ['Novo acesso à sua conta do VolunTrack', 'Sua conta do VolunTrack acabou de ser acessada em {device}, em {when} (UTC).', 'Se foi você, não precisa fazer nada.', 'Não foi você? Saia de todos os dispositivos agora e depois troque sua senha.', 'Sair de todos os lugares'],
  fr: ['Nouvelle connexion à votre compte VolunTrack', 'Votre compte VolunTrack vient d’être utilisé pour une connexion depuis {device}, le {when} (UTC).', 'Si c’était vous, vous n’avez rien à faire.', 'Ce n’était pas vous ? Déconnectez tous les appareils tout de suite, puis changez votre mot de passe.', 'Se déconnecter partout'],
  bn: ['আপনার VolunTrack অ্যাকাউন্টে নতুন সাইন-ইন', 'আপনার VolunTrack অ্যাকাউন্টে এইমাত্র {device} থেকে সাইন ইন করা হয়েছে, {when} (UTC)-এ।', 'এটি আপনি হলে কিছুই করতে হবে না।', 'আপনি নন? এখনই সব ডিভাইস থেকে সাইন আউট করুন, তারপর পাসওয়ার্ড বদলান।', 'সব জায়গা থেকে সাইন আউট করুন'],
  ru: ['Новый вход в ваш аккаунт VolunTrack', 'В ваш аккаунт VolunTrack только что вошли с устройства {device}, {when} (UTC).', 'Если это были вы, ничего делать не нужно.', 'Это были не вы? Сразу выйдите со всех устройств, а затем смените пароль.', 'Выйти везде'],
  ja: ['VolunTrackアカウントへの新しいサインイン', 'あなたのVolunTrackアカウントに {device} から {when}（UTC）にサインインがありました。', 'ご本人であれば、何もする必要はありません。', '心当たりがない場合は、すぐにすべての端末からサインアウトし、パスワードを変更してください。', 'すべての端末からサインアウト'],
}
export const ACCOUNT_EMAIL_STRINGS = Object.fromEntries(
  Object.entries(T).map(([lang, vals]) => [lang, Object.fromEntries(K.map((k, i) => [k, vals[i]]))]),
)
