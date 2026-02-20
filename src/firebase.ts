import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCWc5n7p8i0YSKrl1YE1aPcCL_xMP2Euss",
  authDomain: "track-94ac0.firebaseapp.com",
  projectId: "track-94ac0",
  storageBucket: "track-94ac0.firebasestorage.app",
  messagingSenderId: "385414085070",
  appId: "1:385414085070:web:e408f58095221b3c0ed39f",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
