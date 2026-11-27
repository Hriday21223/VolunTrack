// The /guides pages (#487): practical articles aimed at what students and
// parents search for. Plain data so the page, the prerender list and the
// sitemap read one source. Keep claims accurate: requirements differ by NHS
// chapter, school, district and state, so the guides say "check with your
// adviser" instead of quoting a number that may be wrong for the reader.
//
// Section bodies are arrays of paragraphs; a paragraph that is an array is a
// bulleted list. `updated` feeds the Article structured data.

export const GUIDES = [
  {
    slug: 'nhs-service-hours',
    title: 'How to Track National Honor Society (NHS) Service Hours',
    short: 'NHS service hours',
    description: 'A step-by-step way to log NHS service hours so they count: what to record, getting them approved, and staying on pace for your chapter’s deadline.',
    updated: '2026-11-22',
    intro: 'National Honor Society members are expected to do service, and most chapters ask for a set number of hours each year with proof. Losing track of a few sessions can mean scrambling before a deadline. Here is a simple routine that keeps your hours organized and easy to verify.',
    sections: [
      {
        heading: 'Start with your chapter’s rules',
        body: [
          'Each NHS chapter sets its own service requirement, so the number of hours, what counts and the deadline can differ from school to school. Before you log anything, ask your chapter adviser:',
          [
            'How many hours you need, and by when (per semester or per year).',
            'What counts as service. Many chapters exclude paid work and helping family; some count tutoring or chapter projects differently.',
            'What proof they accept: a supervisor’s signature, an email, a sign-in sheet, a photo, or a link to a shared file such as a Google Drive document.',
            'Whether hours from summer or from before you joined count.',
          ],
          'Write the answers down. They decide how you log every hour after this.',
        ],
      },
      {
        heading: 'Log each session the same day',
        body: [
          'Memory fades fast, and a vague entry is the one an adviser questions. For every session, record:',
          [
            'The date, start and end time, and total hours.',
            'The organization and where it happened.',
            'What you actually did, in a sentence ("sorted 300 cans at the food bank", not "volunteered").',
            'Your supervisor’s name and contact, so the hours can be confirmed.',
          ],
        ],
      },
      {
        heading: 'Get hours approved while people remember you',
        body: [
          'Ask for a signature or confirmation on the day, or within a week. A supervisor who remembers you approves quickly; one asked three months later may not. If your chapter uses a form, carry it with you.',
        ],
      },
      {
        heading: 'Check your pace every month',
        body: [
          'Divide the hours you still need by the weeks left before the deadline. If it comes out above two or three hours a week, plan a bigger project now rather than at the end of the semester.',
        ],
      },
      {
        heading: 'How VolunTrack helps',
        body: [
          [
            'Set your chapter’s goal and deadline; the dashboard shows hours to go and the weekly pace you need.',
            'Log a session in about a minute, with location, supervisor and a photo of your proof, or a link to it in Google Drive once you have joined your school.',
            'Supervisors and organizers can approve hours, so you have a clear record of what is verified.',
            'Download a PDF or spreadsheet of your hours for your adviser, or share a picture of your progress.',
          ],
        ],
      },
    ],
  },
  {
    slug: 'community-service-hours',
    title: 'Community Service Hours for High School: How to Log Them So They Count',
    short: 'Community service hours',
    description: 'How high school students can find, log and verify community service hours for graduation, clubs or scholarships, without a last-minute scramble.',
    updated: '2026-11-22',
    intro: 'Many high schools, districts and clubs ask students to complete community service, whether for graduation, a diploma seal, a club or a scholarship. The hours only help if you can show them. This guide covers finding service, keeping records your school will accept, and staying on track.',
    sections: [
      {
        heading: 'Find out exactly what your school requires',
        body: [
          'Requirements vary a lot between states, districts and schools, and some schools have none. Ask your counselor or check your student handbook for:',
          [
            'The number of hours and the deadline.',
            'Which organizations qualify (often nonprofits, schools or government agencies).',
            'What doesn’t count, which commonly includes paid work and helping relatives.',
            'How hours must be submitted: a form, an online system or a signed log.',
          ],
        ],
      },
      {
        heading: 'Find service that fits your schedule',
        body: [
          'Regular, small commitments add up faster than one-off events you have to keep searching for. Look at food banks, libraries, animal shelters, parks departments, tutoring programs and your school’s own clubs. A weekly two-hour shift reaches 40 hours in about five months.',
        ],
      },
      {
        heading: 'Keep a record your school will accept',
        body: [
          'For each session, write down the date, hours, organization, what you did and a supervisor who can confirm it. Get a signature or confirmation soon after, and keep a photo of any paper form. A tidy log with supervisor contacts is much easier for a counselor to approve than a list written from memory.',
        ],
      },
      {
        heading: 'Don’t leave it for senior year',
        body: [
          'Spread hours across your high school years. Check your total each semester, and if you’re behind, add one regular commitment instead of cramming events into your last month.',
        ],
      },
      {
        heading: 'How VolunTrack helps',
        body: [
          [
            'Free for students: log hours, set your school’s goal and see your pace.',
            'Find volunteer opportunities near you and sign up in a tap.',
            'Supervisors and organizers can verify your hours; schools on VolunTrack can approve them directly.',
            'Export a report for your counselor whenever it’s due.',
          ],
        ],
      },
    ],
  },
  {
    slug: 'volunteer-hours-for-college',
    title: 'Volunteer Hours for College Applications: What to Track and How to Show It',
    short: 'Volunteer hours for college',
    description: 'What to record about your volunteering so it reads well on college applications and in recommendation letters, and how to keep it organized from freshman year.',
    updated: '2026-11-22',
    intro: 'Colleges see a lot of volunteering on applications. What stands out is commitment and impact you can describe clearly, and that depends on the records you keep along the way. Here’s what to track so the activities section and your essays are easy to write.',
    sections: [
      {
        heading: 'Track the details applications ask for',
        body: [
          'Application activity sections typically ask how many hours per week and weeks per year you spent, which grades you participated in, your role and a short description. Keep these as you go:',
          [
            'Dates and hours for every session, so you can total hours per week and weeks per year.',
            'Your role, and any change in it (volunteer, then shift lead, then organizer).',
            'Numbers that show impact: meals served, students tutored, money raised.',
            'A supervisor’s name and contact for verification or a recommendation.',
          ],
          'Requirements change from year to year, so check the current application you’re using.',
        ],
      },
      {
        heading: 'Depth beats a long list',
        body: [
          'A few activities you stuck with, and grew in, usually say more than many one-time events. If you volunteer somewhere regularly, keep going and look for ways to take on more responsibility.',
        ],
      },
      {
        heading: 'Write it down while it’s fresh',
        body: [
          'After a memorable day, add a line about what happened and what you learned. Those notes become essay material, and they help a supervisor write a specific recommendation.',
        ],
      },
      {
        heading: 'How VolunTrack helps',
        body: [
          [
            'Log every session with hours, place, role notes and supervisor.',
            'See totals by category and over time, so hours per week and weeks per year are easy to work out.',
            'Get hours verified, and export a PDF report or a signed transcript of your record.',
            'Share a picture of your total hours when you hit a milestone.',
          ],
        ],
      },
    ],
  },
  {
    slug: 'volunteer-hours-log-sheet',
    title: 'Free Printable Volunteer Hours Log Sheet (PDF)',
    short: 'Printable volunteer log sheet',
    description: 'Download a free printable volunteer and community service hours log sheet (PDF), with columns for date, activity, hours, supervisor and signature, plus tips so your school accepts it.',
    updated: '2026-11-27',
    download: 'blank-log',
    intro: 'Many schools, clubs and NHS chapters still ask for a paper log signed by a supervisor. Here is a free log sheet you can print, with the columns advisers usually look for, and a few tips so every line gets accepted.',
    sections: [
      {
        heading: 'What’s on the sheet',
        body: [
          'One row per session, with space for 18 sessions on a page:',
          [
            'Date, and the activity or place you served.',
            'Hours for that session.',
            'Your supervisor’s name and email, so your school can check the hours.',
            'Your supervisor’s signature.',
          ],
          'If your school has its own form, use that one instead: it’s what your counselor or adviser expects to see.',
        ],
      },
      {
        heading: 'Tips so your hours are accepted',
        body: [
          [
            'Fill in each row on the day you serve, not from memory weeks later.',
            'Ask for the signature before you leave. A supervisor who remembers you signs quickly.',
            'Write the activity clearly: "sorted donations at the food bank", not just "volunteered".',
            'Keep a photo of every page, so a lost sheet doesn’t mean lost hours.',
            'Total your hours at the bottom and check them against your requirement each month.',
          ],
        ],
      },
      {
        heading: 'Prefer not to carry paper?',
        body: [
          'VolunTrack is a free volunteer hour tracker app. You log a session in about a minute, your supervisor can sign on your phone or by email, and you can download a report for your school any time. If you already have paper logs, Scan a paper log in the app reads a photo or PDF of your sheet and fills in the entries for you to check.',
        ],
      },
    ],
  },
  {
    slug: 'how-many-volunteer-hours',
    title: 'How Many Volunteer Hours Do You Need? NHS, Graduation and College',
    short: 'How many volunteer hours you need',
    description: 'How many volunteer or community service hours students usually need for National Honor Society, high school graduation, scholarships and college applications, and how to find your exact number.',
    updated: '2026-11-27',
    intro: 'There is no single national number. The hours you need depend on what they’re for: your NHS chapter, your school or state, a scholarship, or simply standing out on a college application. Here is how each one usually works and how to find your exact target.',
    sections: [
      {
        heading: 'National Honor Society',
        body: [
          'Each NHS chapter sets its own service requirement, so it varies from school to school. Chapters often ask for a set number of hours each year or semester, sometimes split between chapter projects and your own service. Your chapter adviser or handbook has the exact number, what counts, and the deadline.',
        ],
      },
      {
        heading: 'High school graduation',
        body: [
          'Most states don’t require service hours to graduate, but some states, districts and schools do. Two well-known examples:',
          [
            'Maryland: public school students complete at least 75 hours of service-learning to earn a diploma.',
            'Washington, D.C.: students complete 100 hours of community service (phased in, reaching 100 from the 2025–26 school year).',
          ],
          'Other districts and individual schools set their own numbers, often somewhere between 20 and 100 hours. Check your student handbook or ask your counselor, and ask what counts: paid work and helping relatives usually don’t.',
        ],
      },
      {
        heading: 'Scholarships and awards',
        body: [
          'Service-based scholarships and awards each set their own minimum, from a few dozen hours to several hundred. Read the eligibility rules early, since some only count hours from a set period or need a supervisor’s confirmation.',
        ],
      },
      {
        heading: 'College applications',
        body: [
          'Colleges don’t require a set number of volunteer hours. What reads well is steady commitment and what you did: a few places you stuck with, the role you grew into, and the difference you made. Hours per week and weeks per year matter more than one big total.',
        ],
      },
      {
        heading: 'Work out your weekly pace',
        body: [
          'Take the hours you still need and divide by the weeks left before your deadline. 40 hours over 20 weeks is 2 hours a week, which one regular shift covers. If the number comes out high, add a regular commitment now rather than cramming at the end.',
        ],
      },
      {
        heading: 'How VolunTrack helps',
        body: [
          [
            'Set your goal and deadline, and the dashboard shows hours to go and the weekly pace you need.',
            'If your school uses VolunTrack, its requirement shows up for you automatically.',
            'Supervisors can verify your hours, and you can download a report whenever it’s due.',
          ],
        ],
      },
    ],
  },
  {
    slug: 'presidents-volunteer-service-award',
    title: 'The President’s Volunteer Service Award (PVSA): Hours, Levels and How to Track Them',
    short: 'President’s Volunteer Service Award',
    description: 'What the President’s Volunteer Service Award (PVSA) is, the hours for its Bronze, Silver and Gold levels, its current status, and how to keep records so your hours are ready to certify.',
    updated: '2026-11-27',
    intro: 'The President’s Volunteer Service Award (PVSA) has recognized Americans for volunteer service since 2003. Awards go through certifying organizations such as schools, clubs and nonprofits, based on hours served in a 12-month period. Here is how it works and how to keep your hours ready.',
    sections: [
      {
        heading: 'Check the current status first',
        body: [
          'In 2025 the program paused new award orders. Before you plan around the award, check the official PVSA website (presidentialserviceawards.gov) or ask your school or club whether it is certifying awards this year. Recording your hours is worth it either way: the same log works for your school, NHS, scholarships and college applications.',
        ],
      },
      {
        heading: 'Hours for each level',
        body: [
          'Hours are counted over 12 months. The levels for young adults and adults are:',
          [
            'Young adults (16–25): Bronze 100–174 hours, Silver 175–249, Gold 250 or more.',
            'Adults (26 and up): Bronze 100–249 hours, Silver 250–499, Gold 500 or more.',
            'Lifetime Achievement: 4,000 or more hours over a lifetime.',
          ],
          'There are lower levels for younger students and for families; check the official site or your certifying organization for those.',
        ],
      },
      {
        heading: 'Which 12 months count',
        body: [
          'Each certifying organization picks its own 12-month window: a school year, a calendar year, or another period. Ask yours which dates count, and only count hours inside them.',
        ],
      },
      {
        heading: 'Records a certifying organization will accept',
        body: [
          [
            'The date and hours of every session.',
            'Where you served and what you did.',
            'A supervisor who can confirm it, ideally with a signature or email.',
          ],
          'Paid work and service required by a court generally don’t count. Your certifying organization has the final say.',
        ],
      },
      {
        heading: 'How VolunTrack helps',
        body: [
          [
            'Log every session with hours, place and supervisor, and get them verified.',
            'Filter your report by date to total any 12-month window.',
            'Schools on VolunTrack can set Bronze, Silver and Gold award levels, so you see which one you’ve reached.',
          ],
        ],
      },
    ],
  },
  {
    slug: 'volunteer-opportunities-for-teens',
    link: { to: '/volunteer-opportunities', label: 'See volunteer opportunities near you' },
    title: 'How to Find Volunteer Opportunities for Teens Near You',
    short: 'Volunteer opportunities for teens',
    description: 'Where teens can find volunteer opportunities near them, which places accept volunteers under 18, and how to sign up and keep your hours so they count for school.',
    updated: '2026-11-27',
    intro: 'Finding a place to volunteer is often the hardest part, especially if you’re under 18. Many organizations welcome teens, but some have age limits or need a parent’s permission. Here’s where to look and how to make the hours count.',
    sections: [
      {
        heading: 'Places that often take teen volunteers',
        body: [
          [
            'Food banks and food pantries (sorting, packing, distribution days).',
            'Libraries (reading programs, events, shelving).',
            'Animal shelters (some have a minimum age, or ask for a parent alongside younger teens).',
            'Parks, community gardens and clean-up days.',
            'Tutoring and after-school programs for younger kids.',
            'Places of worship, senior centers and community events.',
            'Your own school’s clubs, such as NHS, Key Club and service clubs.',
          ],
        ],
      },
      {
        heading: 'Check age rules and permission',
        body: [
          'Before you sign up, ask about a minimum age, whether a parent must sign a waiver, and whether an adult has to come with you. Under 13, a parent usually needs to approve.',
        ],
      },
      {
        heading: 'Pick something regular',
        body: [
          'A weekly or monthly shift at one place adds up faster than hunting for one-off events, and it gives you a supervisor who knows you, which helps with signatures, references and college applications.',
        ],
      },
      {
        heading: 'Make the hours count',
        body: [
          'Write down the date, hours, place, what you did and your supervisor after every session, and get it confirmed soon after. Check with your school which organizations count toward its requirement.',
        ],
      },
      {
        heading: 'How VolunTrack helps',
        body: [
          [
            'Browse volunteer opportunities near you in the app, filter by date and cause, and sign up in a tap.',
            'Check in with a QR code at the event, and your hours are logged for you.',
            'Under 13? A parent approves first, right in the app.',
            'Your hours, verified, ready for your school’s report.',
          ],
        ],
      },
    ],
  },
]

export function guideBySlug(slug) {
  return GUIDES.find((g) => g.slug === slug) || null
}
