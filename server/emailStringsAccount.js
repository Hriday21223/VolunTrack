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

// Free-trial emails (#894).
const K2 = [
  'Your VolunTrack free trial ends on {date}',
  'Your free trial ends on {date}.',
  'After that, {name} goes back to the free club plan: up to 50 students, with every school feature.',
  'After that, your account is locked until payment is made. Pay before then to keep going without a break.',
  'Open VolunTrack',
  'Your VolunTrack free trial has ended',
  '{name} is back on the free club plan: up to 50 students, with every school feature. You can upgrade again any time.',
  'Your account is locked until payment is made. Sign in to VolunTrack to see how to pay.',
]
const T2 = {
  es: ['Tu prueba gratis de VolunTrack termina el {date}', 'Tu prueba gratis termina el {date}.', 'Después, {name} vuelve al plan de club gratis: hasta 50 estudiantes, con todas las funciones para escuelas.', 'Después, tu cuenta quedará bloqueada hasta que se haga el pago. Paga antes de esa fecha para seguir sin interrupciones.', 'Abrir VolunTrack', 'Tu prueba gratis de VolunTrack terminó', '{name} volvió al plan de club gratis: hasta 50 estudiantes, con todas las funciones para escuelas. Puedes mejorar de nuevo cuando quieras.', 'Tu cuenta está bloqueada hasta que se haga el pago. Inicia sesión en VolunTrack para ver cómo pagar.'],
  vi: ['Thời gian dùng thử miễn phí VolunTrack của bạn kết thúc vào {date}', 'Thời gian dùng thử miễn phí của bạn kết thúc vào {date}.', 'Sau đó, {name} sẽ trở lại gói câu lạc bộ miễn phí: tối đa 50 học sinh, có đủ mọi tính năng dành cho trường.', 'Sau đó, tài khoản của bạn sẽ bị khóa cho đến khi thanh toán. Hãy thanh toán trước ngày đó để không bị gián đoạn.', 'Mở VolunTrack', 'Thời gian dùng thử miễn phí VolunTrack của bạn đã kết thúc', '{name} đã trở lại gói câu lạc bộ miễn phí: tối đa 50 học sinh, có đủ mọi tính năng dành cho trường. Bạn có thể nâng cấp lại bất cứ lúc nào.', 'Tài khoản của bạn bị khóa cho đến khi thanh toán. Hãy đăng nhập VolunTrack để xem cách thanh toán.'],
  zh: ['你的 VolunTrack 免费试用将于 {date} 结束', '你的免费试用将于 {date} 结束。', '之后，{name} 将回到免费社团方案：最多 50 名学生，包含所有学校功能。', '之后，你的账号将被锁定，直到完成付款。请在此之前付款，以免中断。', '打开 VolunTrack', '你的 VolunTrack 免费试用已结束', '{name} 已回到免费社团方案：最多 50 名学生，包含所有学校功能。你可以随时再次升级。', '你的账号已被锁定，直到完成付款。请登录 VolunTrack 查看付款方式。'],
  hi: ['आपका VolunTrack मुफ़्त ट्रायल {date} को खत्म होगा', 'आपका मुफ़्त ट्रायल {date} को खत्म होगा।', 'उसके बाद, {name} फिर से मुफ़्त क्लब प्लान पर आ जाएगा: 50 छात्रों तक, स्कूल की हर सुविधा के साथ।', 'उसके बाद, भुगतान होने तक आपका खाता लॉक रहेगा। बिना रुकावट जारी रखने के लिए उससे पहले भुगतान करें।', 'VolunTrack खोलें', 'आपका VolunTrack मुफ़्त ट्रायल खत्म हो गया है', '{name} फिर से मुफ़्त क्लब प्लान पर है: 50 छात्रों तक, स्कूल की हर सुविधा के साथ। आप कभी भी फिर से अपग्रेड कर सकते हैं।', 'भुगतान होने तक आपका खाता लॉक है। भुगतान का तरीका देखने के लिए VolunTrack में साइन इन करें।'],
  ar: ['تنتهي فترة تجربتك المجانية في VolunTrack في {date}', 'تنتهي فترة تجربتك المجانية في {date}.', 'بعد ذلك، يعود {name} إلى خطة النادي المجانية: حتى 50 طالبًا، مع كل ميزات المدارس.', 'بعد ذلك، سيُقفل حسابك حتى يتم الدفع. ادفع قبل ذلك لتستمر دون انقطاع.', 'افتح VolunTrack', 'انتهت فترة تجربتك المجانية في VolunTrack', 'عاد {name} إلى خطة النادي المجانية: حتى 50 طالبًا، مع كل ميزات المدارس. يمكنك الترقية مرة أخرى في أي وقت.', 'حسابك مقفل حتى يتم الدفع. سجّل الدخول إلى VolunTrack لترى طريقة الدفع.'],
  pt: ['Seu teste grátis do VolunTrack termina em {date}', 'Seu teste grátis termina em {date}.', 'Depois disso, {name} volta para o plano de clube grátis: até 50 alunos, com todos os recursos para escolas.', 'Depois disso, sua conta fica bloqueada até o pagamento ser feito. Pague antes disso para continuar sem interrupção.', 'Abrir o VolunTrack', 'Seu teste grátis do VolunTrack terminou', '{name} voltou para o plano de clube grátis: até 50 alunos, com todos os recursos para escolas. Você pode mudar de plano de novo quando quiser.', 'Sua conta está bloqueada até o pagamento ser feito. Entre no VolunTrack para ver como pagar.'],
  fr: ['Votre essai gratuit de VolunTrack se termine le {date}', 'Votre essai gratuit se termine le {date}.', 'Ensuite, {name} repasse au plan club gratuit : jusqu’à 50 élèves, avec toutes les fonctionnalités pour les écoles.', 'Ensuite, votre compte sera bloqué jusqu’au paiement. Payez avant cette date pour continuer sans interruption.', 'Ouvrir VolunTrack', 'Votre essai gratuit de VolunTrack est terminé', '{name} est repassé au plan club gratuit : jusqu’à 50 élèves, avec toutes les fonctionnalités pour les écoles. Vous pouvez repasser au plan école à tout moment.', 'Votre compte est bloqué jusqu’au paiement. Connectez-vous à VolunTrack pour voir comment payer.'],
  bn: ['আপনার VolunTrack বিনামূল্যে ট্রায়াল {date} তারিখে শেষ হবে', 'আপনার বিনামূল্যে ট্রায়াল {date} তারিখে শেষ হবে।', 'এরপর {name} আবার বিনামূল্যে ক্লাব প্ল্যানে ফিরে যাবে: সর্বোচ্চ ৫০ জন শিক্ষার্থী, স্কুলের সব সুবিধাসহ।', 'এরপর পেমেন্ট না হওয়া পর্যন্ত আপনার অ্যাকাউন্ট লক থাকবে। বিরতি ছাড়া চালিয়ে যেতে তার আগেই পেমেন্ট করুন।', 'VolunTrack খুলুন', 'আপনার VolunTrack বিনামূল্যে ট্রায়াল শেষ হয়েছে', '{name} আবার বিনামূল্যে ক্লাব প্ল্যানে ফিরেছে: সর্বোচ্চ ৫০ জন শিক্ষার্থী, স্কুলের সব সুবিধাসহ। আপনি যেকোনো সময় আবার আপগ্রেড করতে পারেন।', 'পেমেন্ট না হওয়া পর্যন্ত আপনার অ্যাকাউন্ট লক আছে। কীভাবে পেমেন্ট করবেন দেখতে VolunTrack-এ সাইন ইন করুন।'],
  ru: ['Бесплатный период VolunTrack заканчивается {date}', 'Ваш бесплатный период заканчивается {date}.', 'После этого {name} вернётся на бесплатный тариф для клуба: до 50 учеников и все функции для школ.', 'После этого аккаунт будет заблокирован до оплаты. Оплатите заранее, чтобы работать без перерыва.', 'Открыть VolunTrack', 'Бесплатный период VolunTrack закончился', '{name} снова на бесплатном тарифе для клуба: до 50 учеников и все функции для школ. Перейти на тариф для школы можно в любое время.', 'Аккаунт заблокирован до оплаты. Войдите в VolunTrack, чтобы узнать, как оплатить.'],
  ja: ['VolunTrack の無料トライアルは {date} に終了します', '無料トライアルは {date} に終了します。', 'その後、{name} は無料のクラブプランに戻ります（生徒 50 人まで、学校向けの機能はすべて利用可能）。', 'その後、お支払いが完了するまでアカウントはロックされます。中断なく使い続けるには、それまでにお支払いください。', 'VolunTrack を開く', 'VolunTrack の無料トライアルが終了しました', '{name} は無料のクラブプランに戻りました（生徒 50 人まで、学校向けの機能はすべて利用可能）。いつでも再びアップグレードできます。', 'お支払いが完了するまでアカウントはロックされています。VolunTrack にサインインしてお支払い方法をご確認ください。'],
}
export const ACCOUNT_EMAIL_STRINGS = Object.fromEntries(
  Object.entries(T).map(([lang, vals]) => [lang, {
    ...Object.fromEntries(K.map((k, i) => [k, vals[i]])),
    ...Object.fromEntries(K2.map((k, i) => [k, T2[lang][i]])),
  }]),
)
