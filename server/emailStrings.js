// Server-side translations for emails (#416). The app's own strings live in
// src/locales/es.js, but that is a client bundle; emails are rendered here, so
// they get this small map instead. Same convention as the client's tr(): the
// English text is the key, so a string missing from a dictionary simply goes
// out in English. Spanish is informal (tú), matching the app.
//
// A user's language is users.language ('en' | 'es' | NULL), sent by the app
// when they pick one (PUT /api/auth/me/language). NULL means "never told us"
// and gets English. Only text we write is translated — task titles, names and
// activity descriptions are the user's own words and stay as they are.

export const EMAIL_LANGUAGES = ['en', 'es']

/**
 * The language a request asked for (#604). The app sets Accept-Language to
 * its own chosen language on every API call (src/lib/apiFetch.js), so this is
 * the app's setting, not just the browser's. 'es' or 'en'.
 */
export function requestLang(req) {
  const h = String(req?.headers?.['accept-language'] || '').trim().toLowerCase()
  return h.startsWith('es') ? 'es' : 'en'
}

/** Any stored/requested value → a language we can render ('en' fallback). */
export function emailLang(value) {
  return EMAIL_LANGUAGES.includes(value) ? value : 'en'
}

const ES = {
  // Shared
  'Hi {name},': 'Hola, {name}:',
  "This is an automated message — please don't reply to this email. Contact us if you run into any problems: {link}":
    'Este es un mensaje automático; por favor, no respondas a este correo. Si tienes algún problema, escríbenos: {link}',

  // Parent weekly digest (server/digest.js)
  'Weekly volunteer summary: {start} – {end}': 'Resumen semanal de voluntariado: {start} – {end}',
  "You don't have any linked students yet — once you link one, this weekly summary will show their logged hours.":
    'Todavía no tienes estudiantes vinculados. Cuando vincules uno, este resumen semanal mostrará sus horas registradas.',
  "Here's what your student logged from {start} to {end}:": 'Esto es lo que registró tu estudiante del {start} al {end}:',
  "Here's what your students logged from {start} to {end}:": 'Esto es lo que registraron tus estudiantes del {start} al {end}:',
  'No hours logged this week.': 'No registró horas esta semana.',
  '{week} h this week — {verified} h approved, {pending} h pending verification.':
    '{week} h esta semana: {verified} h aprobadas y {pending} h pendientes de verificación.',
  Date: 'Fecha',
  Activity: 'Actividad',
  Hours: 'Horas',
  Status: 'Estado',
  Unverified: 'Sin verificar',
  Pending: 'Pendiente',
  Approved: 'Aprobado',
  Rejected: 'Rechazado',
  '(no description)': '(sin descripción)',
  '…and 1 more entry.': '…y 1 registro más.',
  '…and {n} more entries.': '…y {n} registros más.',
  'All-time total: {n} h.': 'Total acumulado: {n} h.',
  'View full details on your VolunTrack dashboard': 'Ver todos los detalles en tu panel de VolunTrack',
  'Unsubscribe from these weekly emails': 'Darme de baja de estos correos semanales',

  // "Come back" nudge (server/comeback.js)
  'We miss you — here is a volunteer task near you': 'Te extrañamos: aquí tienes una tarea de voluntariado cerca de ti',
  'We miss you — here is a volunteer task coming up': 'Te extrañamos: aquí tienes una tarea de voluntariado próxima',
  'We miss you — here are {n} volunteer tasks near you': 'Te extrañamos: aquí tienes {n} tareas de voluntariado cerca de ti',
  'We miss you — here are {n} volunteer tasks coming up': 'Te extrañamos: aquí tienes {n} tareas de voluntariado próximas',
  'Hi there,': '¡Hola!',

  'How was it? Rate this event to help other volunteers.': '¿Qué tal fue? Califica este evento para ayudar a otros voluntarios.',

  // Sign-up code and welcome emails (server/email.js, #604)
  '{code} is your VolunTrack code': '{code} es tu código de VolunTrack',
  'Enter this code to finish creating your VolunTrack account:': 'Escribe este código para terminar de crear tu cuenta de VolunTrack:',
  'It works once and expires in {n} minutes. If you didn’t try to sign up, you can ignore this email — no account is created without the code.': 'Sirve una vez y vence en {n} minutos. Si no intentaste registrarte, puedes ignorar este correo: no se crea ninguna cuenta sin el código.',
  '— The VolunTrack Team': '— El equipo de VolunTrack',
  'Your free VolunTrack club is ready': 'Tu club gratuito de VolunTrack está listo',
  'Your VolunTrack school account is ready': 'La cuenta de tu escuela en VolunTrack está lista',
  'Your free club is set up.': 'Tu club gratuito está configurado.',
  'Your school account is set up.': 'La cuenta de tu escuela está configurada.',
  'The next step is getting students on board, and it takes about five minutes.': 'El siguiente paso es sumar a los estudiantes, y lleva unos cinco minutos.',
  'Your dashboard has a <strong>starter kit</strong>: a join link (students can also type the code <strong>{code}</strong>), a QR code, a printable flyer in English and Spanish, and messages ready to paste into email or Google Classroom.': 'Tu panel tiene un <strong>kit de inicio</strong>: un enlace para unirse (los estudiantes también pueden escribir el código <strong>{code}</strong>), un código QR, un volante para imprimir en inglés y español, y mensajes listos para pegar en un correo o en Google Classroom.',
  'Your dashboard has a <strong>starter kit</strong>: a join link, a QR code, a printable flyer in English and Spanish, and messages ready to paste into email or Google Classroom.': 'Tu panel tiene un <strong>kit de inicio</strong>: un enlace para unirse, un código QR, un volante para imprimir en inglés y español, y mensajes listos para pegar en un correo o en Google Classroom.',
  'Open your starter kit': 'Abrir tu kit de inicio',
  'Then set your hour requirement under School setup → Requirements, so students can see how close they are.': 'Luego define tu requisito de horas en Configuración de la escuela → Requisitos, para que los estudiantes vean cuánto les falta.',
  'A free club can have up to 50 students. For more, use <strong>Upgrade to a school plan</strong> on your dashboard or <a href="{link}">contact us</a>.': 'Un club gratuito puede tener hasta 50 estudiantes. Para más, usa <strong>Cambiar al plan para escuelas</strong> en tu panel o <a href="{link}">escríbenos</a>.',
  'Your VolunTrack organization is ready': 'Tu organización en VolunTrack está lista',
  'Your organization account is set up. Start by adding your first school: you send the invite, and the school finishes setting itself up.': 'La cuenta de tu organización está configurada. Empieza agregando tu primera escuela: tú envías la invitación y la escuela termina de configurarse.',
  'Add your first school': 'Agregar tu primera escuela',
  'Once you have two or more schools, your dashboard compares them side by side.': 'Cuando tengas dos o más escuelas, tu panel las compara una al lado de la otra.',
  'Welcome to VolunTrack': 'Te damos la bienvenida a VolunTrack',
  'Welcome! To follow your student’s volunteer hours, ask them for a <strong>family link code</strong>: they make one in VolunTrack under Settings → Family. Then enter it in your Settings.': '¡Bienvenido! Para seguir las horas de voluntariado de tu hijo o hija, pídele un <strong>código de vinculación familiar</strong>: lo crea en VolunTrack en Configuración → Familia. Luego escríbelo en tu Configuración.',
  'Enter a link code': 'Escribir un código de vinculación',
  'You’ll see the hours they log from then on, and you can get a short weekly summary by email.': 'Verás las horas que registre desde ese momento, y puedes recibir un breve resumen semanal por correo.',
  'Welcome to VolunTrack!': '¡Te damos la bienvenida a VolunTrack!',
  'Welcome! The best time to log volunteer hours is right after you do them. It takes about a minute: the date, what you did, and how long.': '¡Bienvenido! El mejor momento para registrar horas de voluntariado es justo después de hacerlas. Lleva un minuto: la fecha, qué hiciste y cuánto tiempo.',
  'Log your first hours': 'Registrar tus primeras horas',
  'If your school or club uses VolunTrack, ask your adviser for the school code and enter it in Settings, so they can approve your hours.': 'Si tu escuela o club usa VolunTrack, pide a tu asesor el código de la escuela y escríbelo en Configuración, para que pueda aprobar tus horas.',
  'Have old hours on paper? On Log Hours, tap <strong>Scan a paper log</strong> to add them from a photo.': '¿Tienes horas antiguas en papel? En Registrar horas, toca <strong>Escanear un registro en papel</strong> para agregarlas desde una foto.',

  // Deadline reminders (server/deadlineReminders.js) and opportunity alerts (server/taskAlerts.js), #604
  '{n} hours to go: due {date}': 'Te faltan {n} horas: fecha límite {date}',
  'tomorrow': 'mañana',
  'in {n} days': 'en {n} días',
  '{school}’s volunteer hours are due on <strong>{date}</strong>, {when}. You have {done} of {target} hours, so <strong>{left} to go</strong>.': 'Las horas de voluntariado de {school} vencen el <strong>{date}</strong>, {when}. Tienes {done} de {target} horas, así que <strong>te faltan {left}</strong>.',
  'Already did hours you haven’t logged? Add them now. Looking for something to do? Opportunities lists events near you.': '¿Ya hiciste horas que no registraste? Agrégalas ahora. ¿Buscas algo que hacer? Oportunidades muestra eventos cerca de ti.',
  'Log hours': 'Registrar horas',
  'Find opportunities': 'Buscar oportunidades',
  'Sent because your hours are due soon. <a href="{link}">Stop progress emails</a> or turn them off in Settings.': 'Te lo enviamos porque tus horas vencen pronto. <a href="{link}">Dejar de recibir correos de progreso</a> o desactívalos en Configuración.',
  'New volunteer opportunity: {title}': 'Nueva oportunidad de voluntariado: {title}',
  '{n} new volunteer opportunities for you': '{n} nuevas oportunidades de voluntariado para ti',
  'at': 'a las',
  'A new task was posted this week in the causes you follow:': 'Esta semana se publicó una tarea nueva en las causas que sigues:',
  'New tasks were posted this week in the causes you follow:': 'Esta semana se publicaron tareas nuevas en las causas que sigues:',
  'See all opportunities': 'Ver todas las oportunidades',
  'You turned on new opportunity alerts. <a href="{link}">Stop these emails</a> or change your causes on Opportunities.': 'Activaste los avisos de nuevas oportunidades. <a href="{link}">Dejar de recibir estos correos</a> o cambia tus causas en Oportunidades.',

  // Goal reached (server/goalReached.js, #607)
  '{name} reached {hours} volunteer hours 🎉': '{name} llegó a {hours} horas de voluntariado 🎉',
  '{name} has met the volunteer hour requirement at {school}, with {hours} hours logged. That took real commitment, so it might be a good moment to say well done.':
    '{name} cumplió con las horas de voluntariado que pide {school}, con {hours} horas registradas. Eso requirió mucho compromiso, así que puede ser un buen momento para felicitarle.',
  'See their hours': 'Ver sus horas',
  '{date} at {time}': '{date} a las {time}',
  "It's been a little while since you logged any volunteer hours on VolunTrack. No pressure — whenever you're ready, here is a task you could join:":
    'Hace un tiempo que no registras horas de voluntariado en VolunTrack. Sin presión: cuando quieras, aquí tienes una tarea a la que podrías unirte:',
  "It's been a little while since you logged any volunteer hours on VolunTrack. No pressure — whenever you're ready, here is a task you could join, close to where you have volunteered before:":
    'Hace un tiempo que no registras horas de voluntariado en VolunTrack. Sin presión: cuando quieras, aquí tienes una tarea a la que podrías unirte, cerca de donde ya has hecho voluntariado:',
  "It's been a little while since you logged any volunteer hours on VolunTrack. No pressure — whenever you're ready, here are a few tasks you could join:":
    'Hace un tiempo que no registras horas de voluntariado en VolunTrack. Sin presión: cuando quieras, aquí tienes algunas tareas a las que podrías unirte:',
  "It's been a little while since you logged any volunteer hours on VolunTrack. No pressure — whenever you're ready, here are a few tasks you could join, close to where you have volunteered before:":
    'Hace un tiempo que no registras horas de voluntariado en VolunTrack. Sin presión: cuando quieras, aquí tienes algunas tareas a las que podrías unirte, cerca de donde ya has hecho voluntariado:',
  'See all volunteer opportunities': 'Ver todas las oportunidades de voluntariado',
  'Already volunteering somewhere? {link} so they count.': '¿Ya haces voluntariado en algún lugar? {link} para que cuenten.',
  'Log your hours': 'Registra tus horas',
  'We send this at most once after a month without volunteering. {link} or turn them off in Settings.':
    'Te lo enviamos como máximo una vez tras un mes sin voluntariado. {link} o desactívalos en Ajustes.',
  'Stop these emails': 'Dejar de recibir estos correos',
  'We miss you!': '¡Te extrañamos!',
  'A volunteer task you could join: {titles}': 'Una tarea de voluntariado a la que podrías unirte: {titles}',
  '{n} volunteer tasks you could join: {titles}': '{n} tareas de voluntariado a las que podrías unirte: {titles}',
  // Task emails (server/routes/school.js taskEmailHtml and its callers)
  'When:': 'Cuándo:',
  'Where:': 'Dónde:',
  'Organizer:': 'Organizador:',
  'Volunteer opportunity': 'Oportunidad de voluntariado',
  'Open in VolunTrack': 'Abrir en VolunTrack',
  'Add to calendar:': 'Añadir al calendario:',
  'Posted by {name}': 'Publicado por {name}',
  'View task': 'Ver la tarea',
  'New task from {name}: {title}': 'Nueva tarea de {name}: {title}',
  'an organizer': 'un organizador',
  'An organizer you follow': 'Un organizador que sigues',
  'A new volunteer task': 'Una nueva tarea de voluntariado',
  '{name} just posted a new task.': '{name} acaba de publicar una nueva tarea.',
  'You get these because you follow this organizer.': 'Recibes estos correos porque sigues a este organizador.',
  'View task and sign up': 'Ver la tarea e inscribirte',
  'Stop emails from {name}': 'Dejar de recibir correos de {name}',
  'this organizer': 'este organizador',
  'A friend': 'Un amigo',
  '{first} invited you to volunteer together: {title}': '{first} te invitó a hacer voluntariado juntos: {title}',
  '{first} invited you to volunteer together': '{first} te invitó a hacer voluntariado juntos',
  '{first} signed up for this volunteer task on VolunTrack and would like you to come along.':
    '{first} se inscribió en esta tarea de voluntariado en VolunTrack y le gustaría que vinieras.',
  'Open the link to see the details and sign up. You need a VolunTrack account, which is free.':
    'Abre el enlace para ver los detalles e inscribirte. Necesitas una cuenta de VolunTrack, que es gratis.',
  "You got this email because a friend entered your address. We don't keep it or email you again unless you sign up.":
    'Recibiste este correo porque un amigo escribió tu dirección. No la guardamos ni volveremos a escribirte a menos que te registres.',
  'See the task and sign up': 'Ver la tarea e inscribirte',
  '{child} wants to volunteer: {title}': '{child} quiere hacer voluntariado: {title}',
  '{child} needs your OK to volunteer': '{child} necesita tu permiso para hacer voluntariado',
  "{name} signed up for this volunteer task on VolunTrack. Because they are under 13, the organizer won't see the sign-up until you approve it.":
    '{name} se inscribió en esta tarea de voluntariado en VolunTrack. Como tiene menos de 13 años, el organizador no verá la inscripción hasta que la apruebes.',
  'Open your Family dashboard to approve or decline. Nothing is shared with the organizer if you decline.':
    'Abre tu panel familiar para aprobarla o rechazarla. Si la rechazas, no se comparte nada con el organizador.',
  'Review on your Family dashboard': 'Revisar en tu panel familiar',
  "{name} signed up for this volunteer task on VolunTrack and gave this address as their parent or guardian. Because they are under 13, the organizer won't see the sign-up until you approve it.":
    '{name} se inscribió en esta tarea de voluntariado en VolunTrack e indicó esta dirección como la de su madre, padre o tutor. Como tiene menos de 13 años, el organizador no verá la inscripción hasta que la apruebes.',
  'Open the link to approve or decline. Nothing changes until you press a button on that page, and the link works once.':
    'Abre el enlace para aprobarla o rechazarla. No cambia nada hasta que pulses un botón en esa página, y el enlace funciona una sola vez.',
  "If you don't know this child, decline or ignore this email.": 'Si no conoces a este niño o niña, rechaza la inscripción o ignora este correo.',
  'Review this sign-up': 'Revisar esta inscripción',
  'A spot opened up: {title}': 'Se liberó un lugar: {title}',
  "You're off the waitlist": 'Saliste de la lista de espera',
  "A spot opened up and it's yours. The organizer will confirm your sign-up, and you'll get another email when they do.":
    'Se liberó un lugar y es tuyo. El organizador confirmará tu inscripción y recibirás otro correo cuando lo haga.',
  "Can't make it any more? Cancel from Attendance in VolunTrack so the next person gets the spot.":
    '¿Ya no puedes ir? Cancela desde Asistencia en VolunTrack para que el lugar pase a la siguiente persona.',
  "You're in: {title}": 'Inscripción aprobada: {title}',
  'Update on your signup: {title}': 'Novedades sobre tu inscripción: {title}',
  "You're approved": 'Tu inscripción fue aprobada',
  'Your signup was not accepted': 'Tu inscripción no fue aceptada',
  'The organizer approved your signup.': 'El organizador aprobó tu inscripción.',
  'The organizer could not take your signup for this one. Other opportunities are listed in VolunTrack.':
    'El organizador no pudo aceptar tu inscripción esta vez. Hay otras oportunidades en VolunTrack.',
  'Cancelled: {title}': 'Cancelada: {title}',
  'This event has been cancelled': 'Este evento fue cancelado',
  'The organizer has cancelled this event.': 'El organizador canceló este evento.',
  'The organizer closed their VolunTrack account, so this event will not happen.':
    'El organizador cerró su cuenta de VolunTrack, así que este evento no se realizará.',
  'Reason given: {reason}': 'Motivo: {reason}',
  'Find another task': 'Buscar otra tarea',
  'Message from the organizer: {title}': 'Mensaje del organizador: {title}',
  'A message from {from}': 'Un mensaje de {from}',
  'the organizer': 'el organizador',
  '{name} (co-host)': '{name} (coorganizador)',
  'a co-host': 'un coorganizador',
  'Tomorrow: {title}': 'Mañana: {title}',
  'Your volunteer event is tomorrow': 'Tu evento de voluntariado es mañana',
  'This is a reminder about tomorrow.': 'Te recordamos el evento de mañana.',
  'Meeting point: {place}': 'Punto de encuentro: {place}',
  'On the day, contact: {contact}': 'El día del evento, contacta a: {contact}',
  'Thank you for volunteering: {title}': 'Gracias por tu voluntariado: {title}',
  'A thank-you from {from}': 'Un agradecimiento de {from}',
  'The organizer': 'El organizador',
  'See it in VolunTrack': 'Verlo en VolunTrack',
  // Account deleted goodbye (server/email.js sendAccountDeletedEmail)
  'Your VolunTrack account has been deleted': 'Tu cuenta de VolunTrack fue eliminada',
  'Your VolunTrack account and its data have been deleted, as you asked.': 'Tu cuenta de VolunTrack y sus datos se eliminaron, como pediste.',
  "We've attached a copy of your volunteer hours (1 entry, {hours} hours in total) as a spreadsheet file, so you still have a record.":
    'Adjuntamos una copia de tus horas de voluntariado (1 registro, {hours} horas en total) en una hoja de cálculo, para que conserves un registro.',
  "We've attached a copy of your volunteer hours ({n} entries, {hours} hours in total) as a spreadsheet file, so you still have a record.":
    'Adjuntamos una copia de tus horas de voluntariado ({n} registros, {hours} horas en total) en una hoja de cálculo, para que conserves un registro.',
  "Keep it somewhere safe. We can't recover your account or these hours.": 'Guárdala en un lugar seguro. No podemos recuperar tu cuenta ni estas horas.',
  'You had no volunteer hours logged, so there is nothing to attach.': 'No tenías horas de voluntariado registradas, así que no hay nada que adjuntar.',
  'We cancelled the 1 upcoming event you posted and let the people signed up know.': 'Cancelamos el evento próximo que publicaste y avisamos a las personas inscritas.',
  'We cancelled the {n} upcoming events you posted and let the people signed up know.': 'Cancelamos los {n} eventos próximos que publicaste y avisamos a las personas inscritas.',
  "Thank you for volunteering. You're welcome back any time.": 'Gracias por hacer voluntariado. Puedes volver cuando quieras.',
  Category: 'Categoría',
  Location: 'Ubicación',
  Organization: 'Organización',
  Supervisor: 'Supervisor',
  Notes: 'Notas',
  // Email change (server/email.js sendEmailChangeCodeEmail / sendEmailChangedNotice)
  '{code} is your VolunTrack code': '{code} es tu código de VolunTrack',
  'Enter this code in VolunTrack to use this address for your account:': 'Escribe este código en VolunTrack para usar esta dirección en tu cuenta:',
  "It works once and expires in {minutes} minutes. If you didn't ask for this, ignore this email. Nothing changes without the code.":
    'Funciona una sola vez y caduca en {minutes} minutos. Si no lo pediste, ignora este correo. No cambia nada sin el código.',
  'Your VolunTrack email address was changed': 'Se cambió el correo de tu cuenta de VolunTrack',
  'The email address for your VolunTrack account was changed to {email}. From now on, sign in and get emails there.':
    'El correo de tu cuenta de VolunTrack se cambió a {email}. A partir de ahora, inicia sesión y recibe los correos ahí.',
  "If you didn't do this, contact us right away: {link}": 'Si no fuiste tú, escríbenos de inmediato: {link}',
  // Two-step sign-in by email (server/email.js sendEmailOtpEmail)
  'Enter this code in VolunTrack to turn on two-step sign-in by email:': 'Escribe este código en VolunTrack para activar el inicio de sesión en dos pasos por correo:',
  'Enter this code to finish signing in to VolunTrack:': 'Escribe este código para terminar de iniciar sesión en VolunTrack:',
  "It works once and expires in {minutes} minutes. If you didn't just try to sign in, someone may know your password: change it in Settings.":
    'Funciona una sola vez y caduca en {minutes} minutos. Si no acabas de intentar iniciar sesión, alguien podría conocer tu contraseña: cámbiala en Ajustes.',
  // After-event nudges (server/routes/school.js run-attendance-nudges)
  'Who came to {title}?': '¿Quién vino a {title}?',
  '1 volunteer who signed up has no hours logged for this event yet.': '1 voluntario inscrito todavía no tiene horas registradas para este evento.',
  '{n} volunteers who signed up have no hours logged for this event yet.': '{n} voluntarios inscritos todavía no tienen horas registradas para este evento.',
  'Mark who came and log their hours on My Tasks, so their time counts toward their goals.': 'Marca quién vino y registra sus horas en Mis tareas, para que su tiempo cuente para sus metas.',
  'Mark attendance': 'Marcar asistencia',
  '1 volunteer has no hours logged yet. Mark who came.': '1 voluntario todavía no tiene horas registradas. Marca quién vino.',
  '{n} volunteers have no hours logged yet. Mark who came.': '{n} voluntarios todavía no tienen horas registradas. Marca quién vino.',
  'Did you volunteer at {title}?': '¿Hiciste voluntariado en {title}?',
  'No hours are logged for this event on your account yet.': 'Todavía no hay horas registradas para este evento en tu cuenta.',
  "If you were there, log your hours so they count. The organizer can still confirm them. If you didn't go, you can ignore this.":
    'Si fuiste, registra tus horas para que cuenten. El organizador todavía puede confirmarlas. Si no fuiste, puedes ignorar este correo.',
  'Log my hours': 'Registrar mis horas',
  'No hours are logged for this yet. If you went, log them so they count.': 'Todavía no hay horas registradas para esto. Si fuiste, regístralas para que cuenten.',
  // Monthly progress email (server/monthlyProgress.js)
  'Your {month} volunteer hours: 1 hour': 'Tus horas de voluntariado de {month}: 1 hora',
  'Your {month} volunteer hours: {hours} hours': 'Tus horas de voluntariado de {month}: {hours} horas',
  'You logged {hours} hours of volunteering in {month}, in 1 session. Nice work!': 'Registraste {hours} horas de voluntariado en {month}, en 1 sesión. ¡Buen trabajo!',
  'You logged {hours} hours of volunteering in {month}, across {n} sessions. Nice work!': 'Registraste {hours} horas de voluntariado en {month}, en {n} sesiones. ¡Buen trabajo!',
  "You've reached your {goal}-hour goal, with {total} hours in all.": 'Alcanzaste tu meta de {goal} horas, con {total} horas en total.',
  "That's {total} of your {goal}-hour goal: {left} hours to go by {date}.": 'Llevas {total} de tu meta de {goal} horas: te faltan {left} horas antes del {date}.',
  "That's {total} of your {goal}-hour goal: {left} hours to go.": 'Llevas {total} de tu meta de {goal} horas: te faltan {left} horas.',
  'That brings you to {total} hours in all.': 'Con eso llevas {total} horas en total.',
  'See your progress': 'Ver tu progreso',
  'Share my hours': 'Compartir mis horas',
  'You get this once a month after logging hours. {link} or turn it off in Settings.': 'Recibes esto una vez al mes cuando registras horas. {link} o desactívalo en Ajustes.',
  '{school} approved your report': '{school} aprobó tu informe',
  '{school} sent back your report': '{school} te devolvió tu informe',
  'Reason: {reason}': 'Motivo: {reason}',
  'The report you sent on {date}.': 'El informe que enviaste el {date}.',
  'Note from your school:': 'Nota de tu escuela:',
  'Why:': 'Motivo:',
  'Fix what they asked for, then send a new report from Reports.': 'Corrige lo que te pidieron y envía un informe nuevo desde Informes.',
  'Open Reports': 'Abrir Informes',
  'Your shift: {shift}': 'Tu turno: {shift}',
  'Your entry': 'Tu registro',
  '{school} approved: {what}': '{school} aprobó: {what}',
  '{school} approved {n} of your entries': '{school} aprobó {n} de tus registros',
  '{school} sent back: {what}': '{school} devolvió: {what}',
  '{school} sent back an entry': '{school} te devolvió un registro',
  "These hours don't count for now. Fix the entry in VolunTrack (editing it sends it for review again), or talk with your adviser.": 'Estas horas no cuentan por ahora. Corrige el registro en VolunTrack (al editarlo se vuelve a revisar) o habla con tu asesor.',
}

const DICTIONARIES = { es: ES }

/**
 * Translate one email string. `lang` is 'en' | 'es' (anything else → English).
 * Placeholders are {name}; values are inserted as given, so escape HTML first.
 */
export function et(lang, text, vars) {
  const dict = DICTIONARIES[emailLang(lang)]
  let out = (dict && dict[text]) || text
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
  return out
}

/** Short date ("Oct 13" / "13 oct") for a UTC Date, optionally with the year. */
export function emailDate(lang, date, withYear = false) {
  return date.toLocaleDateString(emailLang(lang) === 'es' ? 'es-ES' : 'en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}),
  }).replace(/\.$/, '').replace(/\. /, ' ')
}
