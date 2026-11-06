// Drafts a reply to a contact-form thread for the admin inbox. It reads the
// subject and the first message, so the reply answers what was asked
// (cost, joining, one school vs. several) instead of pasting one template.
//
// Replies go out in the sender's language (#757): the language the message is
// written in, else the one they used the site in (`contact_messages.language`).
// Every sentence below exists in English, Spanish, Vietnamese and Chinese, so
// nothing is machine-translated and nothing is sent to a translation service.

const NOT_A_NAME = /^(hi+|hey+|hello+|yo|sup|test(ing)?|asdf\w*|qwerty|n\/?a|none|no|idk|admin|user|me|anonymous|school|teacher|mr|mrs|ms|mx|dr|miss|.)$/i

// First name, capitalised, or '' when the name field holds a greeting,
// a test value or nothing usable (the greeting then has no name).
const cap = (w) => w[0].toUpperCase() + w.slice(1)
const isWord = (w) => /^[\p{L}'-]{2,}$/u.test(w || '')

export function greetingName(raw) {
  const words = String(raw ?? '').trim().split(/\s+/)
  // "Ms. Lopez" stays "Ms. Lopez"; a title with no surname falls through.
  const title = /^(mr|mrs|ms|mx|dr|miss)\.?$/i.exec(words[0] || '')
  if (title && isWord(words[1])) return `${cap(words[0].toLowerCase())}${words[0].endsWith('.') || /^miss$/i.test(words[0]) ? '' : '.'} ${cap(words[1])}`
  const first = words[0] || ''
  if (!isWord(first) || NOT_A_NAME.test(first)) return 'there'
  return cap(first)
}

// What the sender seems to want, from their own words (English and Spanish
// keywords; other languages fall back to the general partnership reply).
export function readIntent(text) {
  const t = String(text ?? '').toLowerCase()
  return {
    asksCost: /\b(cost|costs|price|pricing|priced|how much|fee|fees|pay|paid|charge|free|quote|budget|precio|cuesta|cuánto|cuanto|gratis|costo|cotización)\b|\$|bao nhiêu|giá|多少钱|价格|费用|免费/.test(t),
    severalSchools: /\b(district|several schools|multiple schools|many schools|\d+\s+schools|all (of )?(our|the) schools|network of schools|distrito|varias escuelas|\d+\s+escuelas)\b|nhiều trường|学区|多所学校/.test(t),
    club: /\b(nhs|national honor society|key club|club|chapter|adviser|advisor|sponsor|asesor)\b|câu lạc bộ|社团/.test(t),
    saidRole: /\b(i am|i'm|im|soy)\b.{0,40}\b(adviser|advisor|sponsor|counselor|counsellor|teacher|principal|coordinator|director|superintendent|asesora?|consejera?|consejero|maestr[oa]|profesora?|directora?)\b/.test(t),
    asksStudents: /\b(student|students|kids|download|app|estudiantes)\b/.test(t),
  }
}

export const DRAFT_LANGUAGES = { en: 'English', es: 'Español', vi: 'Tiếng Việt', zh: '中文' }

/**
 * The language a message is written in: 'zh', 'vi', 'es', 'en', or null when
 * it can't tell (short or mixed text).
 */
export function detectLanguage(text) {
  const t = String(text ?? '')
  if (/[\u4e00-\u9fff]/.test(t)) return 'zh'
  if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t)) return 'vi'
  const words = t.toLowerCase().match(/[\p{L}']+/gu) || []
  const count = (re) => words.filter((w) => re.test(w)).length
  const es = count(/^(hola|gracias|para|que|qué|como|cómo|nuestra|nuestro|nuestros|escuela|escuelas|estudiantes|horas|quiero|queremos|cuánto|cuanto|por|favor|una|los|las|del|tengo|tenemos|puedo|soy|somos|está|esta|necesito|ayuda|también|pero|con|el|la|es|y)$/)
  const en = count(/^(the|and|is|are|we|our|my|i|you|how|what|for|with|this|that|to|of|in|can|do|does|have|school|students|hours|thanks|hello|hi)$/)
  if (/[ñ¿¡]/.test(t) && es >= 1) return 'es'
  if (es >= 3 && es > en) return 'es'
  if (en >= 3 && en >= es) return 'en'
  return null
}

/** Which language to answer a thread in: what they wrote in, else the site language they used. */
export function replyLanguage(contact) {
  const detected = detectLanguage(contact?.message)
  if (detected) return detected
  const site = contact?.language
  return DRAFT_LANGUAGES[site] ? site : 'en'
}

// Every sentence of a draft, per language. {placeholders} are filled in.
const S = {
  en: {
    greet: 'Hi {name}, thanks for reaching out!', greetNoName: 'Hi there, thanks for reaching out!', signoff: 'Best,\nVolunTrack',
    costSeveral: 'On cost: VolunTrack is always free for students and parents. Accounts for schools and districts are paid, and the price depends on how many students will use it, so I\'ll send you a quote once I know a little more. If another school referred you, you both get a discount.',
    costOne: 'On cost: VolunTrack is always free for students and parents. One club or class with up to 50 students is free too. A whole-school account is paid, and the price depends on how many students will use it, so I\'ll send you a quote once I know a little more. If another school referred you, you both get a discount.',
    several: 'Since you have more than one school, an organization account fits best. You manage every school from one login, and each school still gets its own dashboard, student roster and school code.',
    featuresClub: 'With a school account, your club gets:', featuresSchool: 'With a school account, your school gets:',
    features: '- A dashboard where you approve or send back students\' hours, or approve them automatically by your own rules\n- Hour requirements, so students see how close they are and you see who\'s behind\n- QR check-in at events, so hours fill in on their own\n- Clubs inside your school (NHS, Key Club and others), each with its own advisers and goals\n- A join link, QR code and printable flyer to get students signed up\n- Reports and CSV downloads when hours are due\n- Co-adviser accounts if more than one person approves hours\n- English, Spanish, Vietnamese and Chinese for students and families',
    askQuote: 'To send your quote, could you reply with:', askSetup: 'To send a quote and get you set up, could you reply with:',
    askSchools: '- How many schools, and about how many students in total', askClubName: '- Your club and school\'s name', askSchoolName: '- Your school\'s name',
    askStudents: '- About how many students will use it', askRole: '- Your role (for example NHS adviser or counselor)',
    codeOrg: 'After that you\'ll get a one-time registration code to create the account at {site}/organization/register. Setup takes about five minutes. There\'s more detail here: {site}/for-schools',
    codeSchool: 'After that you\'ll get a one-time registration code to create the account at {site}/school/register?plan=school. Setup takes about five minutes. There\'s more detail here: {site}/for-schools',
    freeClub: 'Want to try it first? You can start a free club for up to 50 students right now, no code needed: {site}/school/register. It moves to a school plan later without losing anything.',
    general: 'VolunTrack is a free app for logging volunteer hours. Students, volunteers and parents can track activities, set goals, earn badges, get hours signed off and download printable reports.\n\nIf there\'s a school or club behind your question, we also offer school accounts so advisers can approve hours in one place.\n\nWhat would you like to know? Just reply here.',
    bug: 'Sorry you ran into this, and thanks for flagging it. To track it down quickly, could you send over:\n- Browser and device (for example Chrome on Mac, Safari on iPhone)\n- What you were doing right before it happened\n- Any error message or a screenshot, if you have one\n\nI\'ll dig in as soon as I hear back.',
    feature: 'Thanks for the suggestion. This kind of feedback shapes what gets built next.\n\nCould you tell me a bit more about how you\'d use it? I\'ll add it to the list and let you know if it ships.',
  },
  es: {
    greet: 'Hola, {name}: ¡gracias por escribirnos!', greetNoName: 'Hola: ¡gracias por escribirnos!', signoff: 'Saludos,\nVolunTrack',
    costSeveral: 'Sobre el precio: VolunTrack siempre es gratis para estudiantes y padres. Las cuentas para escuelas y distritos son de pago, y el precio depende de cuántos estudiantes la usarán, así que te enviaré una cotización cuando sepa un poco más. Si otra escuela te recomendó, las dos reciben un descuento.',
    costOne: 'Sobre el precio: VolunTrack siempre es gratis para estudiantes y padres. Un club o una clase de hasta 50 estudiantes también es gratis. La cuenta para toda la escuela es de pago, y el precio depende de cuántos estudiantes la usarán, así que te enviaré una cotización cuando sepa un poco más. Si otra escuela te recomendó, las dos reciben un descuento.',
    several: 'Como tienen más de una escuela, lo mejor es una cuenta de organización. Administras todas las escuelas con un solo inicio de sesión, y cada escuela sigue teniendo su propio panel, lista de estudiantes y código de escuela.',
    featuresClub: 'Con una cuenta de escuela, tu club tiene:', featuresSchool: 'Con una cuenta de escuela, tu escuela tiene:',
    features: '- Un panel donde apruebas o devuelves las horas de los estudiantes, o las apruebas automáticamente con tus propias reglas\n- Requisitos de horas, para que los estudiantes vean cuánto les falta y tú veas quién va atrasado\n- Registro de entrada con QR en los eventos, para que las horas se llenen solas\n- Clubes dentro de tu escuela (NHS, Key Club y otros), cada uno con sus asesores y metas\n- Un enlace para unirse, un código QR y un volante para imprimir, para que los estudiantes se registren\n- Informes y descargas en CSV cuando las horas se entregan\n- Cuentas de coasesor si más de una persona aprueba horas\n- Inglés, español, vietnamita y chino para estudiantes y familias',
    askQuote: 'Para enviarte la cotización, ¿podrías responder con:', askSetup: 'Para enviarte una cotización y ayudarte a empezar, ¿podrías responder con:',
    askSchools: '- Cuántas escuelas y, aproximadamente, cuántos estudiantes en total', askClubName: '- El nombre de tu club y de tu escuela', askSchoolName: '- El nombre de tu escuela',
    askStudents: '- Aproximadamente cuántos estudiantes la usarán', askRole: '- Tu cargo (por ejemplo, asesor de NHS o consejero)',
    codeOrg: 'Después recibirás un código de registro de un solo uso para crear la cuenta en {site}/organization/register. La configuración toma unos cinco minutos. Hay más detalles aquí: {site}/for-schools',
    codeSchool: 'Después recibirás un código de registro de un solo uso para crear la cuenta en {site}/school/register?plan=school. La configuración toma unos cinco minutos. Hay más detalles aquí: {site}/for-schools',
    freeClub: '¿Quieres probarlo primero? Puedes crear ahora mismo un club gratis para hasta 50 estudiantes, sin código: {site}/school/register. Más adelante pasa a un plan de escuela sin perder nada.',
    general: 'VolunTrack es una app gratuita para registrar horas de voluntariado. Estudiantes, voluntarios y padres pueden anotar actividades, ponerse metas, ganar insignias, conseguir firmas para sus horas y descargar informes para imprimir.\n\nSi tu pregunta viene de una escuela o un club, también ofrecemos cuentas de escuela para que los asesores aprueben horas en un solo lugar.\n\n¿Qué te gustaría saber? Solo responde a este correo.',
    bug: 'Lamento que te pasara esto, y gracias por avisarnos. Para encontrar el problema rápido, ¿podrías enviarnos:\n- Navegador y dispositivo (por ejemplo, Chrome en Mac, Safari en iPhone)\n- Qué estabas haciendo justo antes\n- Cualquier mensaje de error o una captura de pantalla, si la tienes\n\nLo revisaré en cuanto me respondas.',
    feature: 'Gracias por la sugerencia. Este tipo de comentarios define lo que construimos después.\n\n¿Podrías contarme un poco más sobre cómo lo usarías? Lo agregaré a la lista y te avisaré si sale.',
  },
  vi: {
    greet: 'Chào {name}, cảm ơn bạn đã liên hệ!', greetNoName: 'Xin chào, cảm ơn bạn đã liên hệ!', signoff: 'Trân trọng,\nVolunTrack',
    costSeveral: 'Về chi phí: VolunTrack luôn miễn phí cho học sinh và phụ huynh. Tài khoản cho trường và học khu là trả phí, và giá tùy vào số học sinh sử dụng, nên tôi sẽ gửi báo giá khi biết thêm một chút. Nếu một trường khác giới thiệu bạn, cả hai đều được giảm giá.',
    costOne: 'Về chi phí: VolunTrack luôn miễn phí cho học sinh và phụ huynh. Một câu lạc bộ hoặc một lớp tối đa 50 học sinh cũng miễn phí. Tài khoản cho cả trường là trả phí, và giá tùy vào số học sinh sử dụng, nên tôi sẽ gửi báo giá khi biết thêm một chút. Nếu một trường khác giới thiệu bạn, cả hai đều được giảm giá.',
    several: 'Vì bạn có nhiều hơn một trường, tài khoản tổ chức là phù hợp nhất. Bạn quản lý mọi trường bằng một lần đăng nhập, và mỗi trường vẫn có bảng điều khiển, danh sách học sinh và mã trường riêng.',
    featuresClub: 'Với tài khoản trường, câu lạc bộ của bạn có:', featuresSchool: 'Với tài khoản trường, trường của bạn có:',
    features: '- Bảng điều khiển để duyệt hoặc trả lại giờ của học sinh, hoặc tự động duyệt theo quy định của bạn\n- Yêu cầu số giờ, để học sinh thấy mình còn bao xa và bạn thấy ai đang chậm\n- Điểm danh bằng QR tại sự kiện, để giờ tự được điền\n- Câu lạc bộ trong trường (NHS, Key Club và các nhóm khác), mỗi nhóm có cố vấn và mục tiêu riêng\n- Liên kết tham gia, mã QR và tờ rơi in được để học sinh đăng ký\n- Báo cáo và tải CSV khi đến hạn nộp giờ\n- Tài khoản đồng cố vấn nếu có nhiều người duyệt giờ\n- Tiếng Anh, Tây Ban Nha, Việt và Trung cho học sinh và gia đình',
    askQuote: 'Để gửi báo giá, bạn có thể trả lời giúp tôi:', askSetup: 'Để gửi báo giá và giúp bạn thiết lập, bạn có thể trả lời giúp tôi:',
    askSchools: '- Có bao nhiêu trường, và tổng cộng khoảng bao nhiêu học sinh', askClubName: '- Tên câu lạc bộ và trường của bạn', askSchoolName: '- Tên trường của bạn',
    askStudents: '- Khoảng bao nhiêu học sinh sẽ sử dụng', askRole: '- Vai trò của bạn (ví dụ: cố vấn NHS hoặc tư vấn viên)',
    codeOrg: 'Sau đó bạn sẽ nhận được mã đăng ký dùng một lần để tạo tài khoản tại {site}/organization/register. Thiết lập mất khoảng năm phút. Xem thêm chi tiết tại đây: {site}/for-schools',
    codeSchool: 'Sau đó bạn sẽ nhận được mã đăng ký dùng một lần để tạo tài khoản tại {site}/school/register?plan=school. Thiết lập mất khoảng năm phút. Xem thêm chi tiết tại đây: {site}/for-schools',
    freeClub: 'Muốn dùng thử trước? Bạn có thể tạo ngay một câu lạc bộ miễn phí cho tối đa 50 học sinh, không cần mã: {site}/school/register. Sau này có thể chuyển sang gói trường mà không mất gì.',
    general: 'VolunTrack là ứng dụng miễn phí để ghi giờ tình nguyện. Học sinh, tình nguyện viên và phụ huynh có thể theo dõi hoạt động, đặt mục tiêu, nhận huy hiệu, xin ký xác nhận giờ và tải báo cáo để in.\n\nNếu câu hỏi của bạn đến từ một trường hoặc câu lạc bộ, chúng tôi cũng có tài khoản trường để cố vấn duyệt giờ ở một nơi.\n\nBạn muốn biết thêm điều gì? Chỉ cần trả lời email này.',
    bug: 'Rất tiếc bạn gặp sự cố này, và cảm ơn bạn đã báo. Để tìm ra lỗi nhanh, bạn có thể gửi giúp:\n- Trình duyệt và thiết bị (ví dụ: Chrome trên Mac, Safari trên iPhone)\n- Bạn đang làm gì ngay trước khi xảy ra lỗi\n- Thông báo lỗi hoặc ảnh chụp màn hình, nếu có\n\nTôi sẽ xem ngay khi nhận được phản hồi.',
    feature: 'Cảm ơn bạn đã góp ý. Những phản hồi như thế này định hướng những gì chúng tôi làm tiếp theo.\n\nBạn có thể kể thêm bạn sẽ dùng nó như thế nào không? Tôi sẽ thêm vào danh sách và báo bạn khi tính năng ra mắt.',
  },
  zh: {
    greet: '{name}，你好，感谢联系我们！', greetNoName: '你好，感谢联系我们！', signoff: '祝好，\nVolunTrack',
    costSeveral: '关于费用：VolunTrack 对学生和家长始终免费。学校和学区账户需要付费，价格取决于使用的学生人数，等我多了解一些情况后会把报价发给你。如果是其他学校推荐你来的，双方都能获得折扣。',
    costOne: '关于费用：VolunTrack 对学生和家长始终免费。一个社团或班级（最多 50 名学生）也免费。全校账户需要付费，价格取决于使用的学生人数，等我多了解一些情况后会把报价发给你。如果是其他学校推荐你来的，双方都能获得折扣。',
    several: '你们有不止一所学校，机构账户最合适。你可以用一个账号管理所有学校，每所学校仍有自己的仪表板、学生名单和学校代码。',
    featuresClub: '使用学校账户，你的社团可以获得：', featuresSchool: '使用学校账户，你的学校可以获得：',
    features: '- 一个仪表板：批准或退回学生的时数，或按你的规则自动批准\n- 时数要求：学生能看到自己还差多少，你能看到谁落后了\n- 活动二维码签到：时数自动填写\n- 校内社团（NHS、Key Club 等），各有自己的指导老师和目标\n- 加入链接、二维码和可打印传单，方便学生注册\n- 到期时可下载报告和 CSV\n- 多人审核时可添加协同指导老师账户\n- 为学生和家庭提供英语、西班牙语、越南语和中文',
    askQuote: '为了给你报价，能否回复以下信息：', askSetup: '为了给你报价并帮你开通，能否回复以下信息：',
    askSchools: '- 有几所学校，总共大约多少名学生', askClubName: '- 你的社团和学校名称', askSchoolName: '- 你的学校名称',
    askStudents: '- 大约多少名学生会使用', askRole: '- 你的职务（例如 NHS 指导老师或辅导员）',
    codeOrg: '之后你会收到一个一次性注册码，用于在 {site}/organization/register 创建账户。设置大约需要五分钟。更多详情：{site}/for-schools',
    codeSchool: '之后你会收到一个一次性注册码，用于在 {site}/school/register?plan=school 创建账户。设置大约需要五分钟。更多详情：{site}/for-schools',
    freeClub: '想先试试？你现在就可以免费创建一个最多 50 名学生的社团，无需代码：{site}/school/register。以后可以升级为学校方案，数据不会丢失。',
    general: 'VolunTrack 是一款免费的志愿时数记录应用。学生、志愿者和家长可以记录活动、设定目标、获得徽章、让时数获得签字确认，并下载可打印的报告。\n\n如果你的问题来自学校或社团，我们也提供学校账户，方便指导老师在一个地方批准时数。\n\n你想了解什么？直接回复这封邮件即可。',
    bug: '很抱歉你遇到了这个问题，谢谢你告诉我们。为了尽快找到原因，能否发给我们：\n- 浏览器和设备（例如 Mac 上的 Chrome、iPhone 上的 Safari）\n- 出问题前你正在做什么\n- 如有错误提示或截图，也请一并发送\n\n收到回复后我会马上处理。',
    feature: '谢谢你的建议。这样的反馈决定了我们接下来要做什么。\n\n能否多说说你会怎么使用它？我会把它加入列表，上线时通知你。',
  },
}

// Topic names as the sender saw them, for the reply's subject line.
const TOPICS = {
  es: { 'General question': 'Pregunta general', 'Bug report': 'Reportar un error', 'Feature request': 'Sugerir una función', 'School or organization partnership': 'Alianza con una escuela u organización' },
  vi: { 'General question': 'Câu hỏi chung', 'Bug report': 'Báo lỗi', 'Feature request': 'Đề xuất tính năng', 'School or organization partnership': 'Hợp tác với trường hoặc tổ chức' },
  zh: { 'General question': '一般问题', 'Bug report': '报告问题', 'Feature request': '功能建议', 'School or organization partnership': '学校或机构合作' },
}
/** The topic in the reply's language (unknown or English topics pass through). */
export function topicIn(lang, subject) {
  return TOPICS[lang]?.[subject] || subject
}

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))

function partnershipBody(L, { asksCost, severalSchools, club, saidRole }, site) {
  const parts = []
  if (asksCost) parts.push(severalSchools ? L.costSeveral : L.costOne)
  if (severalSchools) parts.push(L.several)
  else parts.push(`${club ? L.featuresClub : L.featuresSchool}\n${L.features}`)
  const asks = severalSchools ? [L.askSchools] : [club ? L.askClubName : L.askSchoolName, L.askStudents]
  if (!saidRole) asks.push(L.askRole)
  parts.push(`${asksCost ? L.askQuote : L.askSetup}\n${asks.join('\n')}`)
  parts.push(fill(severalSchools ? L.codeOrg : L.codeSchool, { site }))
  if (!severalSchools) parts.push(fill(L.freeClub, { site }))
  return parts.join('\n\n')
}

/**
 * The draft reply, in `lang` when given, else the sender's language
 * (replyLanguage). Unknown subjects get the general answer.
 */
export function generateDraft(contact, site, lang = null) {
  const code = DRAFT_LANGUAGES[lang] ? lang : replyLanguage(contact)
  const L = S[code]
  const subject = contact?.subject || 'General question'
  const name = greetingName(contact?.name)
  const intent = readIntent(`${subject} ${contact?.message ?? ''}`)
  const origin = String(site || '').replace(/\/$/, '')
  const body = subject === 'School or organization partnership' ? partnershipBody(L, intent, origin)
    : subject === 'Bug report' ? L.bug
      : subject === 'Feature request' ? L.feature
        : L.general
  const greeting = name === 'there' ? L.greetNoName : fill(L.greet, { name })
  return `${greeting}\n\n${body}\n\n${L.signoff}`
}
