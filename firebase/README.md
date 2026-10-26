# Halftime: Firebase setup

This folder holds the parts of Halftime that run on Firebase: the database security rules
and index settings. (`functions/` is an optional AI add-on for later; see below.)
The website itself (the app, legal pages and `/moderate/`) is hosted on GitHub Pages.

## One-time setup in the Firebase console

1. **Authentication → Sign-in method:** turn on Email/Password and Google.
2. **Authentication → Settings → Authorized domains:** add your site's address
   (for example `yourname.github.io` or your custom domain).
3. **Firestore Database → Create database:** choose production mode and the
   `asia-northeast3` (Seoul) location.
4. **Make yourself a moderator:** open `yoursite/moderate/`, sign in, and copy the user ID it shows.
   In Firestore, create a collection called `admins` and add a document whose ID is that user ID
   (no fields needed). Refresh the page.

## Publish the security rules

Install the Firebase command line tool once: `npm install -g firebase-tools`, then `firebase login`.

From this folder:

```bash
firebase deploy --only firestore          # security rules + index settings
```

Or paste `firestore.rules` into Firestore Database → Rules in the console and click Publish.

Everything runs on the free Spark plan. No server code is deployed.

### Later: real AI replies (optional)

Halftime AI currently uses replies built into the app. The `functions/` folder holds a ready-made
OpenAI version for later. It needs the Blaze (pay-as-you-go) plan and an OpenAI API key with prepaid credits.
To turn it on: add `"functions": [{ "source": "functions" }]` to `firebase.json`, run
`cd functions && npm install && cd ..`, `firebase functions:secrets:set OPENAI_API_KEY`,
`firebase deploy --only functions`, then set `AI_ENABLED = true` in `firebase.js` and update the
Halftime AI section of the Privacy Policy.

## What's stored where

| Path | What | Who can read it |
| --- | --- | --- |
| `users/{uid}` | name, email | that person |
| `users/{uid}/state/plan` | today's plan, mood, finished exercises | that person |
| `users/{uid}/state/chat` | recent chat messages | that person |
| `users/{uid}/state/prefs` | stories they liked | that person |
| `stories/{id}` | submitted stories and their review status | everyone signed in, once approved; the author; moderators |
| `stories/{id}/likes/{uid}` | one "I felt this" per person | everyone signed in |
| `admins/{uid}` | moderators (added by hand) | that moderator |

