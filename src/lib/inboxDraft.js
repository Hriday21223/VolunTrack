// Drafts a reply to a contact-form thread for the admin inbox. It reads the
// subject and the first message, so the reply answers what was asked
// (cost, joining, one school vs. several) instead of pasting one template.

const NOT_A_NAME = /^(hi+|hey+|hello+|yo|sup|test(ing)?|asdf\w*|qwerty|n\/?a|none|no|idk|admin|user|me|anonymous|school|teacher|mr|mrs|ms|mx|dr|miss|.)$/i

// First name, capitalised, or 'there' when the name field holds a greeting,
// a test value or nothing usable.
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

// What the sender seems to want, from their own words.
export function readIntent(text) {
  const t = String(text ?? '').toLowerCase()
  return {
    asksCost: /\b(cost|costs|price|pricing|priced|how much|fee|fees|pay|paid|charge|free|quote|budget)\b|\$/.test(t),
    severalSchools: /\b(district|several schools|multiple schools|many schools|\d+\s+schools|all (of )?(our|the) schools|network of schools)\b/.test(t),
    club: /\b(nhs|national honor society|key club|club|chapter|adviser|advisor|sponsor)\b/.test(t),
    saidRole: /\b(i am|i'm|im)\b.{0,40}\b(adviser|advisor|sponsor|counselor|counsellor|teacher|principal|coordinator|director|superintendent)\b/.test(t),
    asksStudents: /\b(student|students|kids|download|app)\b/.test(t),
  }
}

function partnershipBody({ asksCost, severalSchools, club, saidRole }, site) {
  const unit = severalSchools ? 'your schools' : club ? 'your club' : 'your school'
  const parts = []

  if (asksCost) {
    parts.push(
      `On cost: VolunTrack is always free for students and parents. ${severalSchools ? 'Accounts for schools and districts are' : 'A school account is'} paid, and the price depends on how many students will use it, so I'll send you a quote once I know a little more. If another school referred you, you both get a discount.`
    )
  }

  if (severalSchools) {
    parts.push(
      `Since you have more than one school, an organization account fits best. You manage every school from one login, and each school still gets its own dashboard, student roster and school code.`
    )
  } else {
    parts.push(
      `With a school account, ${unit} gets:\n- A dashboard where you approve or send back students' hours\n- Hour requirements, so students see how close they are and you see who's behind\n- A join link, QR code and printable flyer to get students signed up\n- Reports and CSV downloads when hours are due\n- Co-adviser accounts if more than one person approves hours`
    )
  }

  parts.push(
    `To send ${asksCost ? 'your quote' : 'a quote and get you set up'}, could you reply with:\n${severalSchools ? '- How many schools, and about how many students in total' : `- Your ${club ? 'club and school' : 'school'}'s name\n- About how many students will use it`}${saidRole ? '' : '\n- Your role (for example NHS adviser or counselor)'}`
  )

  parts.push(
    `After that you'll get a one-time registration code to create the account at ${site}/${severalSchools ? 'organization' : 'school'}/register. Setup takes about five minutes. There's more detail here: ${site}/for-schools`
  )

  return parts.join('\n\n')
}

const OTHER_BODIES = {
  'General question': () => (
    `VolunTrack is a free app for logging volunteer hours. Students, volunteers and parents can track activities, set goals, earn badges, get hours signed off and download printable reports.\n\nIf there's a school or club behind your question, we also offer school accounts so advisers can approve hours in one place.\n\nWhat would you like to know? Just reply here.`
  ),
  'Bug report': () => (
    `Sorry you ran into this, and thanks for flagging it. To track it down quickly, could you send over:\n- Browser and device (for example Chrome on Mac, Safari on iPhone)\n- What you were doing right before it happened\n- Any error message or a screenshot, if you have one\n\nI'll dig in as soon as I hear back.`
  ),
  'Feature request': () => (
    `Thanks for the suggestion. This kind of feedback shapes what gets built next.\n\nCould you tell me a bit more about how you'd use it? I'll add it to the list and let you know if it ships.`
  ),
}

export function generateDraft(contact, site) {
  const subject = contact?.subject || 'General question'
  const name = greetingName(contact?.name)
  const intent = readIntent(`${subject} ${contact?.message ?? ''}`)
  const origin = String(site || '').replace(/\/$/, '')

  const body = subject === 'School or organization partnership'
    ? partnershipBody(intent, origin)
    : (OTHER_BODIES[subject] || OTHER_BODIES['General question'])()

  return `Hi ${name}, thanks for reaching out!\n\n${body}\n\nBest,\nVolunTrack`
}
