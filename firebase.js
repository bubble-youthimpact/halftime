// Halftime ↔ Firebase.
// Provides three things the app and the moderation page look for:
//   window.HalftimeAuth   sign-in, sign-up, sign-out, delete account
//   window.HalftimeData   each user's saved data, stories, likes and AI replies
//   window.HalftimeAdmin  story review (only works for accounts listed in the "admins" collection)
// Each function returns plain data or throws an Error with a message people can read.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, OAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile,
  sendPasswordResetEmail, signOut, deleteUser, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, query, where, limit, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, onSnapshot, serverTimestamp, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyB_j5XwxB3tz7_68DoJSHhKl3UqlC215b8",
  authDomain: "halftime-79e0e.firebaseapp.com",
  projectId: "halftime-79e0e",
  storageBucket: "halftime-79e0e.firebasestorage.app",
  messagingSenderId: "185485502668",
  appId: "1:185485502668:web:8ebae1b7441b32b298ba69"
};

// Turn this on after Sign in with Apple is set up in your Apple Developer account
// and enabled in Firebase (Authentication → Sign-in method → Apple).
const APPLE_ENABLED = false;

// Real AI replies need the "chat" Cloud Function (firebase/functions), which requires the Blaze plan.
// While this is false, Halftime AI uses the replies built into the app.
const AI_ENABLED = false;

// Region of the "chat" Cloud Function.
const FUNCTIONS_REGION = "asia-northeast3";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Keeps a copy on the device, so the app opens fast and works offline, then syncs.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const functions = getFunctions(app, FUNCTIONS_REGION);

// ─── Errors ─────────────────────────────────────────────────
const MESSAGES = {
  "auth/invalid-credential": "That email and password don't match. Check them and try again.",
  "auth/wrong-password": "That email and password don't match. Check them and try again.",
  "auth/user-not-found": "That email and password don't match. Check them and try again.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
  "auth/weak-password": "Choose a password with at least 6 characters.",
  "auth/account-exists-with-different-credential": "This email is already linked to another sign-in method. Try the one you used before.",
  "auth/popup-closed-by-user": "The sign-in window was closed before it finished.",
  "auth/cancelled-popup-request": "The sign-in window was closed before it finished.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  "auth/network-request-failed": "Can't reach the sign-in service. Check your connection and try again.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/requires-recent-login": "For your security, sign out, sign back in, then delete your account.",
  "auth/unauthorized-domain": "Sign-in isn't set up for this web address yet. Add it under Authorized domains in Firebase.",
  "auth/operation-not-allowed": "This sign-in method isn't turned on yet. Enable it in Firebase under Sign-in method.",
  "permission-denied": "You don't have permission to do that.",
  "unavailable": "You're offline. Your changes will sync when you reconnect.",
  "resource-exhausted": "You've reached today's limit. Try again tomorrow.",
  "unauthenticated": "Please sign in again.",
  "not-signed-in": "Please sign in again."
};
const fail = (e, fallback) => {
  console.warn("[Halftime]", e && e.code, e);
  const code = e && e.code && String(e.code).replace(/^functions\//, "").replace(/^firestore\//, "");
  return new Error(MESSAGES[e && e.code] || MESSAGES[code] || fallback || "Something went wrong. Please try again.");
};
const run = fn => async (...args) => {
  try { return await fn(...args); } catch (e) { throw fail(e); }
};
const me = () => {
  if (!auth.currentUser) throw { code: "not-signed-in" };
  return auth.currentUser;
};
// Firestore rejects undefined values; a JSON round trip removes them.
const clean = v => JSON.parse(JSON.stringify(v ?? null));
const ms = t => (t && typeof t.toMillis === "function" ? t.toMillis() : Date.now());

// ─── Auth ───────────────────────────────────────────────────
const PROVIDERS = { "google.com": "Google", "apple.com": "Apple", "password": "Email" };
const toUser = u => u && {
  uid: u.uid,
  name: u.displayName || "",
  email: u.email || "",
  provider: PROVIDERS[u.providerData[0]?.providerId] || "Email"
};
const saveProfile = u => setDoc(doc(db, "users", u.uid),
  { name: u.displayName || "", email: u.email || "", updatedAt: serverTimestamp() }, { merge: true })
  .catch(e => console.warn("[Halftime] profile", e));

const appleProvider = () => {
  const p = new OAuthProvider("apple.com");
  p.addScope("email");
  p.addScope("name");
  return p;
};
const popup = async provider => {
  const { user } = await signInWithPopup(auth, provider);
  saveProfile(user);
  return toUser(user);
};

window.HalftimeAuth = {
  appleEnabled: APPLE_ENABLED,
  google: run(() => popup(new GoogleAuthProvider())),
  apple: run(() => popup(appleProvider())),
  email: run(async (email, pass) => toUser((await signInWithEmailAndPassword(auth, email, pass)).user)),
  signup: run(async (name, email, pass) => {
    const { user } = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(user, { displayName: name });
    saveProfile(user);
    return toUser(user);
  }),
  reset: run(email => sendPasswordResetEmail(auth, email)),
  signOut: run(() => signOut(auth)),
  // Firebase only deletes accounts that signed in recently, so check that first,
  // then erase the person's data (beforeDelete), then the account itself.
  deleteAccount: run(async (beforeDelete) => {
    const u = me();
    const last = Date.parse(u.metadata.lastSignInTime || 0);
    if (!last || Date.now() - last > 5 * 60 * 1000) throw { code: "auth/requires-recent-login" };
    if (beforeDelete) await beforeDelete();
    await deleteUser(u);
  }),
  onChange: cb => onAuthStateChanged(auth, u => cb(toUser(u)))
};

// ─── Data ───────────────────────────────────────────────────
// users/{uid}                 name, email
// users/{uid}/state/plan      today's plan: {day, items, mood, completed}
// users/{uid}/state/chat      {messages, savedPlans}
// users/{uid}/state/prefs     {liked}
// stories/{id}                title, body, sport, anon, authorUid, authorName, status, createdAt
// stories/{id}/likes/{uid}    one document per person who tapped "I felt this" ({at, uid})
const STATE_PARTS = ["plan", "chat", "prefs"];
const stateDoc = (uid, part) => doc(db, "users", uid, "state", part);

const storyOut = d => {
  const x = d.data();
  return {
    id: d.id, title: x.title, body: x.body, sport: x.sport, anon: !!x.anon,
    authorName: x.authorName || "", status: x.status, createdAt: ms(x.createdAt)
  };
};

window.HalftimeData = {
  // Calls cb(part, data, {fromCache}) now and whenever that part changes on any device.
  // data is null when nothing is saved yet. Returns a stop function.
  watchState(cb) {
    const uid = me().uid;
    const stops = STATE_PARTS.map(part => onSnapshot(stateDoc(uid, part),
      snap => cb(part, snap.exists() ? snap.data() : null, { fromCache: snap.metadata.fromCache }),
      e => console.warn("[Halftime] watch " + part, e)));
    return () => stops.forEach(s => s());
  },
  saveState: run(async (part, data) => {
    if (!STATE_PARTS.includes(part)) return;
    await setDoc(stateDoc(me().uid, part), { ...clean(data), updatedAt: serverTimestamp() });
  }),

  submitStory: run(async ({ title, body, sport, anon }) => {
    const u = me();
    const ref = await addDoc(collection(db, "stories"), {
      title: String(title).trim().slice(0, 120),
      body: String(body).trim().slice(0, 5000),
      sport: String(sport).slice(0, 30),
      anon: !!anon,
      authorUid: u.uid,
      authorName: anon ? "" : (u.displayName || "").trim().split(/\s+/)[0].slice(0, 60),
      status: "pending",
      createdAt: serverTimestamp()
    });
    return ref.id;
  }),
  watchMyStories(cb) {
    const q = query(collection(db, "stories"), where("authorUid", "==", me().uid));
    return onSnapshot(q, s => cb(s.docs.map(storyOut).sort((a, b) => b.createdAt - a.createdAt)),
      e => console.warn("[Halftime] my stories", e));
  },
  watchPublished(cb) {
    const q = query(collection(db, "stories"), where("status", "==", "approved"), limit(100));
    return onSnapshot(q, s => cb(s.docs.map(storyOut).sort((a, b) => b.createdAt - a.createdAt)),
      e => console.warn("[Halftime] stories", e));
  },
  likeCount: async id => {
    try { return (await getCountFromServer(collection(db, "stories", id, "likes"))).data().count; }
    catch (e) { return null; }
  },
  setLike: run(async (id, on) => {
    const ref = doc(db, "stories", id, "likes", me().uid);
    if (on) await setDoc(ref, { at: serverTimestamp(), uid: me().uid });
    else await deleteDoc(ref);
  }),

  // Erases everything this person stored. Called just before their account is deleted.
  deleteAllData: run(async () => {
    const uid = me().uid;
    const prefs = await getDoc(stateDoc(uid, "prefs")).catch(() => null);
    const liked = (prefs && prefs.exists() && prefs.data().liked) || {};
    const mine = await getDocs(query(collection(db, "stories"), where("authorUid", "==", uid)));
    await Promise.all([
      ...Object.keys(liked).map(id => deleteDoc(doc(db, "stories", id, "likes", uid))),
      ...mine.docs.map(d => deleteDoc(d.ref)),
      ...STATE_PARTS.map(p => deleteDoc(stateDoc(uid, p)))
    ]);
    await deleteDoc(doc(db, "users", uid));
  }),

  // Halftime AI reply from the "chat" Cloud Function. Returns null if it isn't available,
  // so the app can fall back to its built-in replies.
  async aiReply(history, cardType) {
    if (!AI_ENABLED) return null;
    try {
      me();
      const res = await httpsCallable(functions, "chat", { timeout: 15000 })({ history, cardType });
      const text = res && res.data && res.data.text;
      return typeof text === "string" && text.trim() ? text.trim() : null;
    } catch (e) {
      console.warn("[Halftime] AI reply", e && e.code, e);
      return null;
    }
  }
};

// ─── Moderation (used by /moderate/) ────────────────────────
window.HalftimeAdmin = {
  isAdmin: async () => {
    try { return (await getDoc(doc(db, "admins", me().uid))).exists(); } catch (e) { return false; }
  },
  watchQueue(status, cb, onError) {
    const q = query(collection(db, "stories"), where("status", "==", status), limit(200));
    return onSnapshot(q, s => cb(s.docs.map(storyOut).sort((a, b) => b.createdAt - a.createdAt)),
      e => { console.warn("[Halftime] queue", e); onError && onError(fail(e)); });
  },
  review: run(async (id, status) => {
    await updateDoc(doc(db, "stories", id), { status, reviewedAt: serverTimestamp(), reviewedBy: me().uid });
  }),
  remove: run(id => deleteDoc(doc(db, "stories", id)))
};

window.dispatchEvent(new Event("halftime-firebase-ready"));
