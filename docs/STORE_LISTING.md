# Store listing — Google Play and the App Store

Everything the two store consoles ask for, in the order they ask for it, so a
submission is copy-paste. Keep the privacy answers here in step with
`src/pages/Privacy.jsx` and `ios/App/App/PrivacyInfo.xcprivacy` — a store
form that disagrees with the published policy is a rejection (or, on Play, a
policy strike after release). Tracking issue: #228.

## Identity

| Field | Value |
| --- | --- |
| App name | VolunTrack |
| Package / bundle ID | `com.voluntrack.voluntrack` (permanent once uploaded) |
| Category | Education (Play: *Education*; Apple: primary *Education*, secondary *Productivity*) |
| Website | https://volunteer-track-two.vercel.app |
| Support email | volunteertrackinfo@gmail.com |
| Privacy policy | https://volunteer-track-two.vercel.app/privacy |
| Account deletion URL (Play) | https://volunteer-track-two.vercel.app/privacy#account-deletion |
| Terms | https://volunteer-track-two.vercel.app/terms |

When `getvoluntrack.com` goes live, update these URLs in both consoles —
nothing in the binary depends on them. (The app talks to the backend by
the absolute URL in `.env.app`, which changes only when the backend moves.)

## Listing copy

**Play listing title** (30 max) — the name shown in the store; the app's
icon label stays *VolunTrack*:
> VolunTrack: Volunteer Hours

**Play short description** (80 max):
> Log volunteer & community service hours, hit your goal, and share a report.

**Apple subtitle** (30 max):
> Log and verify service hours

**Apple keywords** (100 max, comma-separated, no spaces needed):
> volunteer,service hours,community service,NHS,student,school,club,tracker,log,verify,goals

**Apple promotional text** (170 max, editable without review):
> Log hours in seconds, ask a supervisor to verify them, and keep one record your school can trust — from any device.

**Full description** (both stores; Play 4000 max):

> VolunTrack is the free, simple way for students to track volunteer and
> community service hours — for NHS, Key Club, graduation requirements,
> scholarships and college applications.
>
> LOG HOURS IN A MINUTE
> • Add the date, hours, activity and organization, with a photo or document as proof
> • Send an entry to a supervisor to verify — they approve and sign from a link, no account needed
> • "Log again" fills in a regular activity in one tap
> • Works offline and syncs when you're back online
>
> SEE YOUR GOAL
> • Set an hour goal and see how much you need each week to finish on time
> • A weekly chart and a 🔥 streak for every week in a row you volunteer
> • Badges as you go: first hour, 10, 50 and 100 hours, streaks, and more
>
> FIND OPPORTUNITIES NEAR YOU
> • Browse volunteer tasks posted by schools and organizations as a list or on a map
> • Filter by cause, date, online, or wheelchair accessible
> • Sign up in one tap, add it to your calendar, and check in with a QR code when you arrive
>
> REPORTS WHEN THEY'RE DUE
> • Download a PDF or spreadsheet of your hours
> • Export a signed transcript of your verified hours that anyone can check
> • A shareable picture of your hours, and a Year in review
>
> FOR SCHOOLS AND CLUBS
> • Approve or reject students' hours in one dashboard, and download reports
> • Set the rules: required fields, custom questions, the hour requirement
> • A starter kit with a join link, QR code flyer and ready-to-send messages
> • Sign students in with your own Google Workspace or Microsoft account
> • Every time staff open a student's record, it's written to an access log
>
> FOR FAMILIES
> • Parents can follow their student's hours and get a weekly summary by email
> • Students under 13 need a parent's approval to sign up
>
> BRING YOUR FRIENDS
> • Share your invite link and earn badges when friends join
>
> PRIVATE BY DESIGN
> • Free for students, volunteers and parents
> • We never sell your data
> • In English and Spanish

**Release notes / What's new** (Play 500 max) — 0.8.0:

> New in 0.8.0:
> • Home-screen widget: your hours and goal, and a Log hours button
> • Scan a paper log: photograph an old hours sheet to add the entries
> • "What did you learn?" reflections, private to you
> • College applications: your hours as Common App entries, ready to copy
> • Parents can cheer an entry with "Proud of you"
> • Advisers: start a free club for up to 50 students

## Graphics

| Asset | Required size | File |
| --- | --- | --- |
| Play app icon | 512×512 PNG | `store-assets/play/icon-512.png` |
| Play feature graphic | 1024×500 PNG/JPG, no alpha | `store-assets/play/feature-graphic.png` |
| Play phone screenshots | 2–8, 16:9 or 9:16, 320–3840 px sides | *to capture* |
| Apple iPhone 6.9" screenshots | 1–10 at 1320×2868 (or 1290×2796) | *to capture* |
| Apple iPad 13" screenshots | 1–10 at 2064×2752 | *to capture — only while the app ships for iPad* |
| Apple app icon | from the binary (`resources/icon-only.png`, 1024×1024) | — |

The older files in `store-assets/` are the original branding at small sizes;
none meet a store's minimum, so don't upload them.

Screenshots: capture from the simulator/emulator signed into the review
demo account (below) so no real student's data appears — the Dashboard, Log
Hours, a verified entry, Goals, and the school dashboard. iPad screenshots
are required because the target is universal (`TARGETED_DEVICE_FAMILY =
"1,2"`); setting it to `1` (iPhone only) removes that requirement, at the
cost of the app running letterboxed on iPads.

## Privacy — Google Play "Data safety"

- **Does your app collect or share any of the required user data types?** Yes
- **Is all data encrypted in transit?** Yes (HTTPS only)
- **Do you provide a way for users to request deletion?** Yes — in the app
  (Settings → Delete account) and at the account-deletion URL above.

| Data type | Collected | Shared | Optional? | Purpose |
| --- | --- | --- | --- | --- |
| Personal info → Name | Yes | No | Required for an account | App functionality, Account management |
| Personal info → Email address | Yes | No | Required for an account | App functionality, Account management |
| Personal info → User IDs (account ID; the student ID number, if entered) | Yes | No | Required for an account | App functionality, Account management |
| Personal info → Other info (date of birth, at sign-up — tick *processed ephemerally*: used for the age rules, never stored) | Yes | No | Required for an account | App functionality |
| Location → Approximate location | Yes | No | Optional | App functionality |
| Location → Precise location | Yes | No | Optional | App functionality |
| Photos and videos → Photos (proof of service; an organizer's task cover photo; a photo of a paper hours log — read on the device and not collected; only if the optional AI reader is switched on is it sent to our AI provider, processed ephemerally and not stored) | Yes | No | Optional | App functionality |
| Files and docs | Yes | No | Optional | App functionality |
| App activity → Other user-generated content (hours, descriptions, supervisor contacts, app reviews, contact-form messages, optional first names of guests brought to a task) | Yes | No | Required | App functionality |
| App activity → Other actions (whether the account was created on the website, Android or iPhone) | Yes | No | Required for an account | Analytics |
| App info and performance → Crash logs (error message, technical details, page and app version, with no account, name or email attached) | Yes | No | Required | App functionality |

Not collected: financial info (school invoices are paid by bank transfer outside
the app), contacts, messages, health, audio, web history, device IDs,
diagnostics, and no analytics beyond the one sign-up fact in the table
(`users.signup_platform`, read from the request's origin when an account is
created and used only for the admin's sign-up counts) — and **no biometric data**: Face ID / Touch ID /
fingerprint unlock (*Keep me signed in*) is checked by the OS, which tells the
app only pass/fail. A passkey sends us its **public key** only (plus a name
and dates), which is account-security data under *Account management*, not a
separate data type. The sign-in token kept for *Keep me signed in* stays in
the device's Keychain / Keystore. Vercel Analytics runs on the website only; the app
doesn't load it (`src/App.jsx`).

Reminder notifications don't change any answer: they are booked on the phone
as local notifications (`src/lib/nativeReminders.js`) and nothing about them
leaves the device. The notification permission is asked for only on the
Reminders page's *Allow* tap.

The app language (`users.language`, `en` | `es`, sent when a signed-in user
picks one so the weekly digest and "We miss you" email can be sent in it) is
an app setting, not one of the store's data types, so it doesn't change any
answer either. It is still listed on the Privacy page.

"Shared" is **No** throughout because every recipient is either a
service provider processing on our behalf (hosting, email, bot protection)
or someone the user chose to send it to (their school, a supervisor they
asked to verify), both of which Play excludes from "sharing". Location
search sends the typed text and an approximate position to Photon and
Nominatim (both OpenStreetMap services) only when the user searches for a place
or moves the map pin.

## Privacy — Apple "App Privacy"

- **Do you or your third-party partners collect data from this app?** Yes
- **Tracking:** No data is used to track.

All of the following are *Linked to the user*, *not used for tracking*,
purpose *App Functionality* — matching `PrivacyInfo.xcprivacy`:

- Contact Info → Name, Email Address
- Identifiers → User ID
- Location → Precise Location (only when the user taps *Use current location*
  or turns on nearby tasks)
- User Content → Photos or Videos (proof photos, task cover photos), Other User Content (entries, app
  reviews, questions to task organizers, and reports about volunteer
  tasks), Customer Support
  (contact-form messages)

*Not linked to the user*, *not used for tracking*, purpose *App Functionality*:

- Diagnostics → Crash Data (error message, technical details, page and app
  version when something breaks; no account, name or email is attached)

One more, *Linked to the user*, *not used for tracking*, purpose *Analytics*:

- Usage Data → Product Interaction (only which app the account was created
  in — website, Android or iPhone — for the admin's sign-up counts)

Nothing to declare for the date of birth: Apple counts data as collected only
when it is kept longer than needed to answer the request, and the server
discards it after the age check.

Nothing to declare for Face ID (the app never receives biometric data; its
`NSFaceIDUsageDescription` is in `Info.plist`) or for passkeys (public key
only, part of the account).

## Age rating / audience

The app's users include minors. Sign-up asks everyone for a date of birth
(`server/ageRules.js`; checked again by the server and never stored — only
`users.under_13` is kept). Volunteer Task Maker and parent accounts need
18+. An under-13 student account is created locked and only opens once the parent or
guardian they name approves it from an emailed link (declined or unanswered
for 14 days: deleted). Accounts a school creates, or that arrive through school
sign-in, rely on the school's consent. The parent's email address is collected
for that request, and — while no parent account is linked — to ask the parent
to approve each volunteer task the child signs up for (organizers see an
under-13's sign-up only after that) — count it under *Email address* in the
Data safety / App Privacy answers. That decides the store settings:

- **Play → Target audience:** 13–15, 16–17, 18+. Leave the under-13 bands
  unticked. Ticking one puts the app under the **Families policy**
  (certified-SDK and ad rules, teacher-approved review). Younger students
  can still use the app through their school. Answer "Yes" to *could the
  app unintentionally appeal to children* only if the listing is changed
  to target them.
- **Play → Content rating (IARC):** Reference category *Utility,
  Productivity, Communication*. No violence, sexuality, language, drugs or
  gambling. *Users can interact / exchange info:* **Yes**, because students
  share entries with their school and supervisors. Location shared with
  other users: **No**. Expected result: Everyone / PEGI 3.
- **Apple → Age rating:** answer "None" to every content question. For
  *Unrestricted web access* answer **No** (the app shows only its own pages).
  For *User-generated content* answer **No** (entries are private, never
  public; an app review reaches the website's About page only after its
  writer agrees and an admin approves it, so it is curated, not open
  posting). Expected result: 4+. **Don't** choose the Kids category, because
  that brings the Kids rules (no external links, parental gates).

## Payments

The app sells nothing. Students and volunteers use it free. Schools and
organizations are invoiced directly and pay by bank transfer. That is a
business-to-business service bought outside the app, which Apple's
guideline 3.1.3(c) (Enterprise Services) permits, and the app has no buy
button or checkout link. Play: **Contains ads — No. In-app purchases — No.**

## App Review notes

Apple reviews every build, and Play reviews the first release and policy
changes. Both reviewers need to sign in, so before the first submission
**create a dedicated reviewer account on production** (`appreview@test.com`
exists for this). Don't hand reviewers the other `@test.com` accounts: they
are on production too, and the admin, school and organization ones have
two-factor turned on. Use a student
account joined to a demo school that holds a few sample entries. Don't use
a real student's account.

Paste into *App Review Information → Notes* (Apple) / *App access* (Play):

> VolunTrack is a volunteer-hour tracker used by students and their schools.
> Demo student account: <email> / <password>. It belongs to a demo school, so
> you can log hours (Log Hours tab), attach proof, request supervisor
> verification, and see goals and badges.
>
> **Why sign-in is required:** a student's hours are records their school
> reviews and approves, and that a linked parent can follow, so they belong
> to an account rather than one device. School single sign-on appears only
> for schools that configured it; the demo account uses a password.
>
> **Native features in this build** (it is not a website in a frame):
> - Face ID / Touch ID / passcode app lock with "Keep me signed in" (the
>   session lives in the iOS Keychain and is restored only after biometrics).
> - Passkeys as a second sign-in factor (Settings → Passkeys).
> - Reminders delivered as native local notifications, even when the app is
>   closed (Reminders tab).
> - Camera: scan a QR code to sign in on another device, or photograph proof
>   of service.
> - Works offline: hours logged without a connection are saved on the device
>   and sync when it's back.
> - Native tab bar, haptics, status bar and splash screen.
>
> **User-generated content (guideline 1.2):** volunteer tasks on the
> Opportunities tab are posted by organizers. Every task has a **Report**
> button (reasons: unsafe or inappropriate, spam or a scam, misleading, other)
> with an option to **block the organizer**, which hides their tasks and
> stops their messages; blocks are listed and undone in Settings → Blocked
> organizers. Reports reach us by email and in our admin dashboard, and we act
> within 24 hours: dismiss, remove the task, or suspend the organizer from
> posting.
>
> Camera is used only to scan a sign-in QR code or photograph proof; location
> only when the user taps "Use current location" or turns on nearby tasks.

**Guideline 4.2 (minimum functionality)** is the main rejection risk for an
app that shares its UI with a website. The note above lists the native
parts; keep it in step with the build (Face ID lock, passkeys, native
notifications, camera, offline, tab bar, haptics, status bar, splash).

## Signing

### Android upload key (once)

```bash
cd android
keytool -genkeypair -v -keystore voluntrack-upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
cp keystore.properties.example keystore.properties   # then fill in the passwords
```

`*.jks` and `keystore.properties` are gitignored. Store both, and the
passwords, in a password manager. When creating the app in Play Console,
enroll in **Play App Signing** (the default): Google then holds the real
signing key, and a lost upload key can be reset.

For CI, set `VOLUNTRACK_UPLOAD_STORE_FILE` (path relative to `android/`),
`VOLUNTRACK_UPLOAD_STORE_PASSWORD`, `VOLUNTRACK_UPLOAD_KEY_ALIAS` and
`VOLUNTRACK_UPLOAD_KEY_PASSWORD` instead of the properties file.

### iOS

In Xcode, open `ios/App/App.xcodeproj`, then *Signing & Capabilities*. Pick
your team with *Automatically manage signing*. Then use *Product → Archive →
Distribute App → App Store Connect*. The bundle ID must first be registered
under Certificates, Identifiers & Profiles, and the app created in App Store
Connect under that ID.

## Cutting a release

```bash
npm version minor --no-git-tag-version     # or edit package.json's version
npm run bundle:android                     # stamps versions, builds, syncs, bundles
# → android/app/build/outputs/bundle/release/app-release.aab  (upload to Play)
# iOS: npm run version:app && npm run build:app, then Archive in Xcode
```

`npm run version:app` (`scripts/mobile-version.mjs`) writes the version into
Gradle and Xcode and derives the build number from it (0.3.0 → 300). Both
stores reject a build number they've seen before. To re-upload the same
version, pass a higher number: `node scripts/mobile-version.mjs 301`.

## Owner checklist (first submission)

- [ ] **Google Play Console** developer account ($25 once, ID verification).
      A *personal* account created after Nov 2023 must run a **closed test
      with at least 12 testers for 14 consecutive days** before it can apply for
      production access, so start the closed test early. An *organization*
      account skips this but needs a D-U-N-S number.
- [ ] **Apple Developer Program** ($99/yr). An individual enrollment shows
      your personal name as the seller. An organization shows "VolunTrack"
      but needs a D-U-N-S number and a legal entity.
- [ ] Create the production reviewer account and demo school (above).
- [ ] Generate the Android upload key, then run `npm run bundle:android`.
- [ ] Capture screenshots.
- [ ] Fill in the listing, Data safety / App Privacy, rating and audience from this file.
- [ ] Play: internal testing → closed testing (12 testers × 14 days) → production.
- [ ] Apple: Archive → TestFlight → submit for review.
