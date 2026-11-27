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
// Signing up for an opportunity without an account (Nov 27).
const K3 = ["Confirm your spot: {title}", "You signed up for {title} on {date} without an account. Open the link below and press Confirm to hold your spot. Your volunteer badge, with the QR code to show at check-in, is on the same page.", "Confirm my spot", "The link works until the event is over. If you didn’t sign up, ignore this email and nothing happens.", "Want your hours tracked and signed? Create a free VolunTrack account with this email address."]
const T3 = {
 "es": [
  "Confirma tu lugar: {title}",
  "Te inscribiste en {title} el {date} sin una cuenta. Abre el enlace de abajo y pulsa Confirmar para guardar tu lugar. Tu credencial de voluntario, con el código QR para el registro de llegada, está en la misma página.",
  "Confirmar mi lugar",
  "El enlace funciona hasta que termine el evento. Si no te inscribiste, ignora este correo y no pasará nada.",
  "¿Quieres que tus horas se registren y se firmen? Crea una cuenta gratuita de VolunTrack con este correo."
 ],
 "vi": [
  "Xác nhận chỗ của bạn: {title}",
  "Bạn đã đăng ký {title} vào {date} mà không cần tài khoản. Mở liên kết bên dưới và nhấn Xác nhận để giữ chỗ. Thẻ tình nguyện viên của bạn, có mã QR để xuất trình khi điểm danh, nằm trên cùng trang.",
  "Xác nhận chỗ của tôi",
  "Liên kết dùng được đến khi sự kiện kết thúc. Nếu bạn không đăng ký, hãy bỏ qua email này và sẽ không có gì xảy ra.",
  "Muốn giờ của bạn được ghi và ký xác nhận? Hãy tạo tài khoản VolunTrack miễn phí bằng địa chỉ email này."
 ],
 "zh": [
  "确认你的名额：{title}",
  "你在未注册账户的情况下报名了 {date} 的 {title}。打开下面的链接并点击“确认”即可保留名额。你的志愿者徽章（签到时出示的二维码）也在同一页面。",
  "确认我的名额",
  "链接在活动结束前有效。如果不是你报名的，请忽略这封邮件，不会有任何影响。",
  "想记录并签核你的时长？用这个邮箱地址创建一个免费的 VolunTrack 账户。"
 ],
 "hi": [
  "अपनी जगह पक्की करें: {title}",
  "आपने बिना खाते के {date} को {title} के लिए साइन अप किया। अपनी जगह पक्की करने के लिए नीचे दिया लिंक खोलें और पुष्टि करें दबाएँ। चेक-इन पर दिखाने वाले QR कोड के साथ आपका स्वयंसेवक बैज उसी पेज पर है।",
  "मेरी जगह पक्की करें",
  "लिंक कार्यक्रम खत्म होने तक काम करता है। अगर आपने साइन अप नहीं किया, तो यह ईमेल अनदेखा करें, कुछ नहीं होगा।",
  "अपने घंटे दर्ज और हस्ताक्षरित करवाना चाहते हैं? इसी ईमेल पते से मुफ़्त VolunTrack खाता बनाएँ।"
 ],
 "ar": [
  "أكّد مكانك: {title}",
  "سجّلت في {title} بتاريخ {date} دون حساب. افتح الرابط أدناه واضغط «تأكيد» لحجز مكانك. شارة المتطوع الخاصة بك، مع رمز QR لإظهاره عند الحضور، موجودة في الصفحة نفسها.",
  "أكّد مكاني",
  "يعمل الرابط حتى انتهاء الفعالية. إن لم تسجّل، فتجاهل هذه الرسالة ولن يحدث شيء.",
  "تريد تسجيل ساعاتك وتوقيعها؟ أنشئ حسابًا مجانيًا في VolunTrack بعنوان البريد هذا."
 ],
 "pt": [
  "Confirme sua vaga: {title}",
  "Você se inscreveu em {title} em {date} sem uma conta. Abra o link abaixo e toque em Confirmar para garantir sua vaga. Seu crachá de voluntário, com o código QR para mostrar na chegada, está na mesma página.",
  "Confirmar minha vaga",
  "O link funciona até o evento terminar. Se não foi você que se inscreveu, ignore este e-mail e nada acontece.",
  "Quer suas horas registradas e assinadas? Crie uma conta grátis no VolunTrack com este e-mail."
 ],
 "fr": [
  "Confirme ta place : {title}",
  "Tu t’es inscrit(e) à {title} le {date} sans compte. Ouvre le lien ci-dessous et appuie sur Confirmer pour garder ta place. Ton badge de bénévole, avec le code QR à montrer à l’arrivée, est sur la même page.",
  "Confirmer ma place",
  "Le lien fonctionne jusqu’à la fin de l’événement. Si tu ne t’es pas inscrit(e), ignore cet e-mail et rien ne se passera.",
  "Tu veux que tes heures soient suivies et signées ? Crée un compte VolunTrack gratuit avec cette adresse e-mail."
 ],
 "bn": [
  "আপনার জায়গা নিশ্চিত করুন: {title}",
  "আপনি অ্যাকাউন্ট ছাড়াই {date} তারিখে {title}-এ সাইন আপ করেছেন। জায়গা ধরে রাখতে নিচের লিংক খুলে নিশ্চিত করুন চাপুন। চেক-ইনে দেখানোর QR কোডসহ আপনার স্বেচ্ছাসেবক ব্যাজ একই পাতায় আছে।",
  "আমার জায়গা নিশ্চিত করুন",
  "লিংকটি ইভেন্ট শেষ হওয়া পর্যন্ত কাজ করে। আপনি সাইন আপ না করে থাকলে এই ইমেলটি উপেক্ষা করুন, কিছুই হবে না।",
  "আপনার ঘণ্টা লেখা ও স্বাক্ষর করাতে চান? এই ইমেল ঠিকানা দিয়ে একটি ফ্রি VolunTrack অ্যাকাউন্ট খুলুন।"
 ],
 "ru": [
  "Подтвердите место: {title}",
  "Вы записались на «{title}» ({date}) без аккаунта. Откройте ссылку ниже и нажмите «Подтвердить», чтобы закрепить место. Ваш бейдж волонтёра с QR-кодом для отметки на входе — на той же странице.",
  "Подтвердить место",
  "Ссылка работает до конца мероприятия. Если вы не записывались, просто проигнорируйте это письмо.",
  "Хотите, чтобы ваши часы учитывались и подписывались? Создайте бесплатный аккаунт VolunTrack на этот адрес."
 ],
 "ja": [
  "参加を確定してください：{title}",
  "アカウントなしで {date} の「{title}」に申し込みました。下のリンクを開いて「確定」を押すと参加枠が確保されます。受付で見せる QR コード付きのボランティアバッジも同じページにあります。",
  "参加を確定する",
  "リンクはイベント終了まで使えます。申し込んだ覚えがない場合は、このメールを無視してください。何も起こりません。",
  "時間を記録して署名してもらいたい場合は、このメールアドレスで無料の VolunTrack アカウントを作成してください。"
 ]
}
// The certificate emailed after the event to someone without an account.
const K4 = ["Your certificate of service: {title}", "Certificate of Service", "This certifies that", "volunteered {hours} hours at {title} on {date}.", "Organizer", "Thank you for volunteering! Create a free VolunTrack account with this email address to keep all your hours in one place."]
const T4 = {
 "es": [
  "Tu certificado de servicio: {title}",
  "Certificado de servicio",
  "Se certifica que",
  "hizo {hours} horas de voluntariado en {title} el {date}.",
  "Organizador",
  "¡Gracias por tu voluntariado! Crea una cuenta gratuita de VolunTrack con este correo para tener todas tus horas en un solo lugar."
 ],
 "vi": [
  "Giấy chứng nhận phục vụ của bạn: {title}",
  "Giấy chứng nhận phục vụ",
  "Chứng nhận rằng",
  "đã tình nguyện {hours} giờ tại {title} vào {date}.",
  "Người tổ chức",
  "Cảm ơn bạn đã tình nguyện! Hãy tạo tài khoản VolunTrack miễn phí bằng email này để giữ mọi giờ của bạn ở một nơi."
 ],
 "zh": [
  "你的服务证书：{title}",
  "服务证书",
  "兹证明",
  "于 {date} 在 {title} 志愿服务 {hours} 小时。",
  "组织者",
  "感谢你的志愿服务！用这个邮箱地址创建免费 VolunTrack 账户，把所有时长集中在一处。"
 ],
 "hi": [
  "आपका सेवा प्रमाणपत्र: {title}",
  "सेवा प्रमाणपत्र",
  "यह प्रमाणित किया जाता है कि",
  "ने {date} को {title} में {hours} घंटे स्वयंसेवा की।",
  "आयोजक",
  "स्वयंसेवा के लिए धन्यवाद! अपने सारे घंटे एक जगह रखने के लिए इसी ईमेल पते से मुफ़्त VolunTrack खाता बनाएँ।"
 ],
 "ar": [
  "شهادة الخدمة الخاصة بك: {title}",
  "شهادة خدمة",
  "نشهد بأن",
  "تطوّع {hours} ساعة في {title} بتاريخ {date}.",
  "المنظّم",
  "شكرًا لتطوعك! أنشئ حسابًا مجانيًا في VolunTrack بعنوان البريد هذا لتحتفظ بكل ساعاتك في مكان واحد."
 ],
 "pt": [
  "Seu certificado de serviço: {title}",
  "Certificado de serviço",
  "Certificamos que",
  "fez {hours} horas de voluntariado em {title} em {date}.",
  "Organizador",
  "Obrigado pelo voluntariado! Crie uma conta grátis no VolunTrack com este e-mail para manter todas as suas horas em um só lugar."
 ],
 "fr": [
  "Ton certificat de bénévolat : {title}",
  "Certificat de bénévolat",
  "Nous certifions que",
  "a fait {hours} heures de bénévolat à {title} le {date}.",
  "Organisateur",
  "Merci pour ton bénévolat ! Crée un compte VolunTrack gratuit avec cette adresse e-mail pour garder toutes tes heures au même endroit."
 ],
 "bn": [
  "আপনার সেবার সার্টিফিকেট: {title}",
  "সেবার সার্টিফিকেট",
  "এই মর্মে প্রত্যয়ন করা হচ্ছে যে",
  "{date} তারিখে {title}-এ {hours} ঘণ্টা স্বেচ্ছাসেবা করেছেন।",
  "আয়োজক",
  "স্বেচ্ছাসেবার জন্য ধন্যবাদ! সব ঘণ্টা এক জায়গায় রাখতে এই ইমেল ঠিকানা দিয়ে একটি ফ্রি VolunTrack অ্যাকাউন্ট খুলুন।"
 ],
 "ru": [
  "Ваш сертификат волонтёра: {title}",
  "Сертификат волонтёра",
  "Настоящим подтверждается, что",
  "отработал(а) волонтёром {hours} ч на мероприятии «{title}» {date}.",
  "Организатор",
  "Спасибо за помощь! Создайте бесплатный аккаунт VolunTrack на этот адрес, чтобы хранить все свои часы в одном месте."
 ],
 "ja": [
  "奉仕活動の修了証：{title}",
  "奉仕活動修了証",
  "以下の者は",
  "{date} に「{title}」で {hours} 時間のボランティア活動を行ったことを証明します。",
  "主催者",
  "ボランティアへのご参加ありがとうございました！このメールアドレスで無料の VolunTrack アカウントを作れば、すべての時間を一か所で管理できます。"
 ]
}
const K5 = ["Time in {in} · Time out {out}", "Your signed service record, with the event, date, time in, time out and hours, is attached as a PDF."]
const T5 = {
 "es": [
  "Entrada {in} · Salida {out}",
  "Tu registro de servicio firmado, con el evento, la fecha, la hora de entrada, la de salida y las horas, va adjunto en PDF."
 ],
 "vi": [
  "Giờ vào {in} · Giờ ra {out}",
  "Bản ghi phục vụ đã ký của bạn, gồm sự kiện, ngày, giờ vào, giờ ra và số giờ, được đính kèm dưới dạng PDF."
 ],
 "zh": [
  "签到 {in} · 签退 {out}",
  "附件为你已签名的服务记录 PDF，包括活动、日期、签到时间、签退时间和时长。"
 ],
 "hi": [
  "आने का समय {in} · जाने का समय {out}",
  "आपका हस्ताक्षरित सेवा रिकॉर्ड, कार्यक्रम, तारीख, आने-जाने के समय और घंटों के साथ, PDF के रूप में संलग्न है।"
 ],
 "ar": [
  "الحضور {in} · الانصراف {out}",
  "سجل خدمتك الموقّع، مع الفعالية والتاريخ ووقت الحضور والانصراف والساعات، مرفق بصيغة PDF."
 ],
 "pt": [
  "Entrada {in} · Saída {out}",
  "Seu registro de serviço assinado, com o evento, a data, os horários de entrada e saída e as horas, está anexado em PDF."
 ],
 "fr": [
  "Arrivée {in} · Départ {out}",
  "Ton relevé de bénévolat signé, avec l’événement, la date, l’heure d’arrivée, l’heure de départ et les heures, est joint en PDF."
 ],
 "bn": [
  "আসার সময় {in} · যাওয়ার সময় {out}",
  "ইভেন্ট, তারিখ, আসা-যাওয়ার সময় ও ঘণ্টাসহ আপনার স্বাক্ষরিত সেবার রেকর্ড PDF হিসেবে সংযুক্ত আছে।"
 ],
 "ru": [
  "Приход {in} · Уход {out}",
  "Подписанная запись о волонтёрской работе — мероприятие, дата, время прихода и ухода, часы — во вложении в PDF."
 ],
 "ja": [
  "開始 {in} ・ 終了 {out}",
  "イベント、日付、開始・終了時刻、時間を記載した署名済みの活動記録を PDF で添付しています。"
 ]
}
const K6 = ["Your certificate and your signed service record (with the event, date, time in, time out and hours) are attached as PDFs to download and print."]
const T6 = {
 "es": [
  "Tu certificado y tu registro de servicio firmado (con el evento, la fecha, la hora de entrada, la de salida y las horas) van adjuntos en PDF para descargar e imprimir."
 ],
 "vi": [
  "Giấy chứng nhận và bản ghi phục vụ đã ký của bạn (gồm sự kiện, ngày, giờ vào, giờ ra và số giờ) được đính kèm dưới dạng PDF để tải xuống và in."
 ],
 "zh": [
  "附件为你的证书和已签名的服务记录 PDF（包括活动、日期、签到和签退时间及时长），可下载和打印。"
 ],
 "hi": [
  "आपका प्रमाणपत्र और हस्ताक्षरित सेवा रिकॉर्ड (कार्यक्रम, तारीख, आने-जाने के समय और घंटों के साथ) डाउनलोड और प्रिंट करने के लिए PDF के रूप में संलग्न हैं।"
 ],
 "ar": [
  "شهادتك وسجل خدمتك الموقّع (مع الفعالية والتاريخ ووقت الحضور والانصراف والساعات) مرفقان بصيغة PDF للتنزيل والطباعة."
 ],
 "pt": [
  "Seu certificado e seu registro de serviço assinado (com o evento, a data, os horários de entrada e saída e as horas) estão anexados em PDF para baixar e imprimir."
 ],
 "fr": [
  "Ton certificat et ton relevé de bénévolat signé (avec l’événement, la date, l’heure d’arrivée, l’heure de départ et les heures) sont joints en PDF à télécharger et imprimer."
 ],
 "bn": [
  "আপনার সার্টিফিকেট ও স্বাক্ষরিত সেবার রেকর্ড (ইভেন্ট, তারিখ, আসা-যাওয়ার সময় ও ঘণ্টাসহ) ডাউনলোড ও প্রিন্টের জন্য PDF হিসেবে সংযুক্ত আছে।"
 ],
 "ru": [
  "Ваш сертификат и подписанная запись о работе (мероприятие, дата, время прихода и ухода, часы) во вложении в PDF — их можно скачать и распечатать."
 ],
 "ja": [
  "修了証と署名済みの活動記録（イベント、日付、開始・終了時刻、時間）を PDF で添付しています。ダウンロードして印刷できます。"
 ]
}
export const ACCOUNT_EMAIL_STRINGS = Object.fromEntries(
  Object.entries(T).map(([lang, vals]) => [lang, {
    ...Object.fromEntries(K.map((k, i) => [k, vals[i]])),
    ...Object.fromEntries(K2.map((k, i) => [k, T2[lang][i]])),
    ...Object.fromEntries(K3.map((k, i) => [k, T3[lang][i]])),
    ...Object.fromEntries(K4.map((k, i) => [k, T4[lang][i]])),
    ...Object.fromEntries(K5.map((k, i) => [k, T5[lang][i]])),
    ...Object.fromEntries(K6.map((k, i) => [k, T6[lang][i]])),
  }]),
)
