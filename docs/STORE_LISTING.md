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

**Play short description** (80 max):
> Log volunteer hours, track your goals, and share your record with your school.

**Apple subtitle** (30 max):
> Log and verify service hours

**Apple keywords** (100 max, comma-separated, no spaces needed):
> volunteer,service hours,community service,NHS,student,school,club,tracker,log,verify,goals

**Apple promotional text** (170 max, editable without review):
> Log hours in seconds, ask a supervisor to verify them, and keep one record your school can trust — from any device.

**Full description** (both stores; Play 4000 max):

> VolunTrack keeps every volunteer hour in one place — logged when it
> happens, verified by the people you helped, and ready when your school,
> club or scholarship asks for it.
>
> FOR STUDENTS AND VOLUNTEERS
> • Log hours in a few taps: what you did, where, and for how long
> • Attach a photo or document as proof of service
> • Send an entry to a supervisor to verify — they approve and sign from a link, no account needed
> • Set goals and watch your progress, earn badges along the way
> • Export a signed transcript of your verified hours that anyone can check
>
> FOR PARENTS
> • Link to your student's account and follow their progress
> • Opt in to a weekly summary by email
>
> FOR SCHOOLS AND ORGANIZATIONS
> • See your students' hours in one dashboard and approve or reject entries
> • Set the rules for how your students log hours: required fields, custom questions, goals
> • Sign students in with your own Google Workspace or Microsoft account
> • Keep proof-of-service files in your own storage — VolunTrack keeps only a pointer
> • Every time staff open a student's record, it's written to an access log

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
| Personal info → User IDs | Yes | No | Required for an account | App functionality, Account management |
| Location → Approximate location | Yes | No | Optional | App functionality |
| Location → Precise location | Yes | No | Optional | App functionality |
| Photos and videos → Photos | Yes | No | Optional | App functionality |
| Files and docs | Yes | No | Optional | App functionality |
| App activity → Other user-generated content (hours, descriptions, supervisor contacts) | Yes | No | Required | App functionality |

Not collected: financial info (school invoices are paid by bank transfer outside
the app), contacts, messages, health, audio, web history, device IDs,
diagnostics, analytics — and **no biometric data**: Face ID / Touch ID /
fingerprint unlock (*Keep me signed in*) is checked by the OS, which tells the
app only pass/fail. A passkey sends us its **public key** only (plus a name
and dates), which is account-security data under *Account management*, not a
separate data type. The sign-in token kept for *Keep me signed in* stays in
the device's Keychain / Keystore. Vercel Analytics runs on the website only; the app
doesn't load it (`src/App.jsx`).

"Shared" is **No** throughout because every recipient is either a
service provider processing on our behalf (hosting, email, bot protection)
or someone the user chose to send it to (their school, a supervisor they
asked to verify), both of which Play excludes from "sharing". Location
search sends the typed text and an approximate position to the HERE /
OpenStreetMap geocoders only when the user searches for a place.

## Privacy — Apple "App Privacy"

- **Do you or your third-party partners collect data from this app?** Yes
- **Tracking:** No data is used to track.

All of the following are *Linked to the user*, *not used for tracking*,
purpose *App Functionality* — matching `PrivacyInfo.xcprivacy`:

- Contact Info → Name, Email Address
- Identifiers → User ID
- Location → Precise Location (only when the user taps *Use current location*)
- User Content → Photos or Videos, Other User Content

Nothing to declare for Face ID (the app never receives biometric data; its
`NSFaceIDUsageDescription` is in `Info.plist`) or for passkeys (public key
only, part of the account).

## Age rating / audience

The app's users include minors, and its Privacy Policy lets under-13s sign up
with parental, guardian or school consent. That decides the store settings:

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
  public). Expected result: 4+. **Don't** choose the Kids category, because
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
**create a dedicated reviewer account on production** (the seeded
`@test.com` accounts exist only in the local database). Use a student
account joined to a demo school that holds a few sample entries. Don't use
a real student's account.

Paste into *App Review Information → Notes* (Apple) / *App access* (Play):

> VolunTrack is a volunteer-hour tracker used by students and their schools.
> Demo student account: <email> / <password>. It belongs to a demo school, so
> you can log hours (Log Hours tab), attach proof, request supervisor
> verification, and see goals and badges.
> School single sign-on appears only for schools that configured it; the demo
> account uses a password. Camera is used only to scan a sign-in QR code or
> photograph proof; location only when the user taps "Use current location".

**Guideline 4.2 (minimum functionality)** is the main rejection risk for an
app that shares its UI with a website. Mention the native parts: the native
app shell and tab bar, haptics, the status bar and splash screen, and camera QR
sign-in. If Apple still rejects it, native push reminders (`@capacitor/push-notifications`) are the next step.

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
