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
    updated: '2026-10-24',
    intro: 'National Honor Society members are expected to do service, and most chapters ask for a set number of hours each year with proof. Losing track of a few sessions can mean scrambling before a deadline. Here is a simple routine that keeps your hours organized and easy to verify.',
    sections: [
      {
        heading: 'Start with your chapter’s rules',
        body: [
          'Each NHS chapter sets its own service requirement, so the number of hours, what counts and the deadline can differ from school to school. Before you log anything, ask your chapter adviser:',
          [
            'How many hours you need, and by when (per semester or per year).',
            'What counts as service. Many chapters exclude paid work and helping family; some count tutoring or chapter projects differently.',
            'What proof they accept: a supervisor’s signature, an email, a sign-in sheet or a photo.',
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
            'Log a session in about a minute, with location, supervisor and a photo of your proof.',
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
    updated: '2026-10-24',
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
    updated: '2026-10-24',
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
]

export function guideBySlug(slug) {
  return GUIDES.find((g) => g.slug === slug) || null
}
