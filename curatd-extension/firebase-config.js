/** Same Firebase project as the main Curatd app (firebase.ts). */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB5A2IJmS5yawHoXgXeNhbvtl-VFkzgGMc",
  authDomain: "curatd-12fad.firebaseapp.com",
  projectId: "curatd-12fad",
  storageBucket: "curatd-12fad.firebasestorage.app",
  messagingSenderId: "418205760342",
  appId: "1:418205760342:web:edb915fba5933dec2874f7",
};

if (typeof self !== "undefined") {
  self.FIREBASE_CONFIG = FIREBASE_CONFIG;
}
