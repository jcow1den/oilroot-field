// ============== FIREBASE INITIALIZATION ==============
// IMPORTANT: Replace the placeholder values below with your actual Firebase config.
// You saved these earlier when you registered the web app in the Firebase console.
// Do NOT paste your config in any chat or public place. Edit it here directly.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB2nSihPMz3rOZW-nWB3FRV5V_Au21N4Vc",
    authDomain: "oilroot-field.firebaseapp.com",
    projectId: "oilroot-field",
    storageBucket: "oilroot-field.firebasestorage.app",
    messagingSenderId: "870036160095",
    appId: "1:870036160095:web:6551771edec6d089c3e5ea",
    measurementId: "G-SN915X9KSG"
  };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// Persist login across browser sessions and across devices
setPersistence(auth, browserLocalPersistence);

// ============== DOM REFS ==============
const loadingEl = document.getElementById("loading");
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");

const tabSignIn = document.getElementById("tab-signin");
const tabSignUp = document.getElementById("tab-signup");
const signInForm = document.getElementById("signin-form");
const signUpForm = document.getElementById("signup-form");
const googleSignInBtn = document.getElementById("google-signin");
const logoutBtn = document.getElementById("logout-btn");
const messageEl = document.getElementById("auth-message");

const userDisplayName = document.getElementById("user-display-name");
const userEmail = document.getElementById("user-email");

// ============== UI HELPERS ==============
function showMessage(text, type = "error") {
  messageEl.textContent = text;
  messageEl.className = `auth-message ${type}`;
  messageEl.hidden = false;
}

function clearMessage() {
  messageEl.hidden = true;
  messageEl.textContent = "";
}

function setLoading(isLoading) {
  if (isLoading) {
    loadingEl.classList.remove("hidden");
  } else {
    loadingEl.classList.add("hidden");
  }
}

function showAuthScreen() {
  authScreen.hidden = false;
  appScreen.hidden = true;
}

function showAppScreen(user, profile) {
  authScreen.hidden = true;
  appScreen.hidden = false;
  const name = profile?.displayName || user.displayName || user.email.split("@")[0];
  userDisplayName.textContent = name;
  userEmail.textContent = user.email;
}

// Disable a submit button briefly to prevent double submissions
function lockButton(form) {
  const btn = form.querySelector("button[type=submit]");
  if (btn) {
    btn.disabled = true;
    return () => { btn.disabled = false; };
  }
  return () => {};
}

// ============== TAB SWITCHING ==============
tabSignIn.addEventListener("click", () => {
  tabSignIn.classList.add("active");
  tabSignUp.classList.remove("active");
  signInForm.hidden = false;
  signUpForm.hidden = true;
  clearMessage();
});

tabSignUp.addEventListener("click", () => {
  tabSignUp.classList.add("active");
  tabSignIn.classList.remove("active");
  signUpForm.hidden = false;
  signInForm.hidden = true;
  clearMessage();
});

// ============== USER PROFILE (FIRESTORE) ==============
// Each user gets a profile document at /users/{uid}
// This is where we'll store their display name, role, region, etc., as the app grows.

async function ensureUserProfile(user, extras = {}) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email,
      displayName: extras.displayName || user.displayName || "",
      createdAt: serverTimestamp(),
      lastSignInAt: serverTimestamp()
    });
  } else {
    // Update last sign-in without overwriting createdAt
    await setDoc(ref, { lastSignInAt: serverTimestamp() }, { merge: true });
  }
  return snap.exists() ? snap.data() : { displayName: extras.displayName || "" };
}

// ============== ERROR MESSAGES ==============
// Translate Firebase's cryptic error codes into something a human can read.

function friendlyError(err) {
  const code = err?.code || "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address looks invalid.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account already exists with that email. Try signing in instead.";
    case "auth/weak-password":
      return "Password must be at least 8 characters.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/popup-closed-by-user":
      return "Sign-in was cancelled.";
    case "auth/popup-blocked":
      return "Browser blocked the sign-in window. Allow popups for this site and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a few minutes.";
    default:
      return err?.message || "Something went wrong. Try again.";
  }
}

// ============== SIGN IN ==============
signInForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();
  const unlock = lockButton(signInForm);

  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await ensureUserProfile(cred.user);
    // onAuthStateChanged will route to app screen
  } catch (err) {
    showMessage(friendlyError(err), "error");
  } finally {
    unlock();
  }
});

// ============== SIGN UP ==============
signUpForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();
  const unlock = lockButton(signUpForm);

  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  if (password.length < 8) {
    showMessage("Password must be at least 8 characters.", "error");
    unlock();
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await ensureUserProfile(cred.user, { displayName: name });
    // onAuthStateChanged will route to app screen
  } catch (err) {
    showMessage(friendlyError(err), "error");
  } finally {
    unlock();
  }
});

// ============== GOOGLE SIGN IN ==============
googleSignInBtn.addEventListener("click", async () => {
  clearMessage();
  googleSignInBtn.disabled = true;

  try {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    await ensureUserProfile(cred.user);
    // onAuthStateChanged will route to app screen
  } catch (err) {
    showMessage(friendlyError(err), "error");
  } finally {
    googleSignInBtn.disabled = false;
  }
});

// ============== LOGOUT ==============
logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("Sign out error:", err);
  }
});

// ============== AUTH STATE OBSERVER ==============
// This is the single source of truth for whether a user is signed in.
// It runs on page load (restoring session) and on every sign-in/sign-out.

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const profile = await ensureUserProfile(user);
      showAppScreen(user, profile);
    } catch (err) {
      console.error("Profile load error:", err);
      showAppScreen(user, null);
    }
  } else {
    showAuthScreen();
  }
  setLoading(false);
});
