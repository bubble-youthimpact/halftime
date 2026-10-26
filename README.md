# Halftime

Mental skills and support for high school athletes. Static website hosted on GitHub Pages,
with sign-in and data in Firebase.

| Address | Page |
| --- | --- |
| `/` | The Halftime app |
| `/privacy/` | Privacy Policy |
| `/terms/` | Terms of Use |
| `/community-guidelines/` | Community Guidelines |
| `/moderate/` | Story review for moderators (not linked from the app) |

- `firebase.js`: Firebase settings, sign-in and data. The app and `/moderate/` load it.
- `404.html`: shown for any address that doesn't exist.
- `firebase/`: security rules and setup steps. See `firebase/README.md`. Nothing in this folder is used by the website itself.

## Publish on GitHub Pages

1. Upload everything in this folder to the root of a GitHub repository.
2. Repository → Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Add the site address (and your custom domain, if you use one) to Firebase → Authentication → Settings → Authorized domains.
