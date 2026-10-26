// Halftime AI: writes chat replies for signed-in athletes.
// The AI key stays here on the server, never in the website code.
//
// Deploy (from the firebase/ folder):
//   firebase functions:secrets:set OPENAI_API_KEY
//   firebase deploy --only functions
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as functionsV1 from "firebase-functions/v1";
import OpenAI from "openai";

initializeApp();
const db = getFirestore();
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

const MODEL = "gpt-6-luna";     // OpenAI's fast, low-cost model
const DAILY_LIMIT = 60;          // replies per person per day
const MAX_TURNS = 12;            // recent messages sent to the model
const MAX_CHARS = 1000;          // per message

const SYSTEM = [
  "You are Halftime AI, a supportive mental-skills assistant in an app for high school athletes aged 13 to 18.",
  "Your tone is calm, gentle and reassuring, like a thoughtful sport psychologist.",
  "Validate feelings first, then offer one or two practical, evidence-informed suggestions such as breathing, cue words, visualization, sleep, or talking to a trusted adult.",
  "Never diagnose, never give medical, dieting, weight-cutting or medication advice, and do not claim to be a therapist.",
  "If the athlete mentions self-harm, suicide, abuse or being in danger, say you are glad they told you, encourage them to call or text 988 (in the U.S.) or call 911 in an emergency, and to tell a trusted adult right away.",
  "Plain sentences only: no emojis, no markdown, no lists. Reply in under 60 words."
].join(" ");

const CARD_HINT = {
  exercise: " The app will show a matching exercise card below your reply, so you may mention it briefly.",
  playbook: " The app will show a matching playbook card below your reply, so you may mention it briefly.",
  plan: " The app will show a step-by-step plan card below your reply, so you may mention it briefly."
};

const today = () => new Date().toISOString().slice(0, 10);

// Counts replies per person per day (stored in usage/{uid}, which the app itself can't read or write).
async function takeQuota(uid) {
  const ref = db.collection("usage").doc(uid);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const count = d.day === today() ? d.count || 0 : 0;
    if (count >= DAILY_LIMIT) return false;
    tx.set(ref, { day: today(), count: count + 1, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

// The model needs alternating user/assistant turns that start with the user.
function toMessages(history) {
  const out = [];
  for (const m of history.slice(-MAX_TURNS)) {
    const role = m && m.role === "assistant" ? "assistant" : "user";
    const text = String((m && m.text) || "").slice(0, MAX_CHARS).trim();
    if (!text) continue;
    if (!out.length && role === "assistant") continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n" + text;
    else out.push({ role, content: text });
  }
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

export const chat = onCall(
  { region: "asia-northeast3", secrets: [OPENAI_API_KEY], timeoutSeconds: 20, memory: "256MiB", maxInstances: 10 },
  async request => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in again.");

    const history = Array.isArray(request.data && request.data.history) ? request.data.history : [];
    const messages = toMessages(history);
    if (!messages) throw new HttpsError("invalid-argument", "Nothing to reply to.");

    if (!(await takeQuota(uid))) throw new HttpsError("resource-exhausted", "Daily limit reached.");

    const hint = CARD_HINT[request.data && request.data.cardType] || "";
    let text = "";
    try {
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY.value(), timeout: 15000, maxRetries: 1 });
      const response = await openai.responses.create({
        model: MODEL,
        instructions: SYSTEM + hint,
        input: messages,
        max_output_tokens: 220,
        reasoning: { effort: "none" },   // quick, conversational replies
        store: false                     // don't keep chats on OpenAI's side
      });
      text = (response.output_text || "").trim();
    } catch (e) {
      console.error("AI request failed", e && e.status, e && e.message);
      throw new HttpsError("unavailable", "Halftime AI is unavailable right now.");
    }
    if (!text) throw new HttpsError("unavailable", "Halftime AI is unavailable right now.");
    return { text };
  }
);

// When an account is deleted, erase anything of theirs that is left: the AI usage counter
// (the app can't delete it) and, as a backup, their saved data, stories and likes.
export const cleanupDeletedUser = functionsV1.region("asia-northeast3").auth.user().onDelete(async user => {
  const uid = user.uid;
  await db.doc(`usage/${uid}`).delete().catch(() => {});
  await db.recursiveDelete(db.doc(`users/${uid}`)).catch(e => console.error("users cleanup", e));
  const mine = await db.collection("stories").where("authorUid", "==", uid).get();
  await Promise.all(mine.docs.map(d => db.recursiveDelete(d.ref)));
  const likes = await db.collectionGroup("likes").where("uid", "==", uid).get().catch(() => null);
  if (likes) await Promise.all(likes.docs.map(d => d.ref.delete()));
});
