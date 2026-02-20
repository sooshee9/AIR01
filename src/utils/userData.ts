import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export const getUserData = async (uid: string) => {
  const ref = doc(db, 'userData', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as any) : null;
};

export const setUserData = async (uid: string, data: any) => {
  await setDoc(doc(db, 'userData', uid), data, { merge: true });
};

export const subscribeUserData = (uid: string, cb: (data: any) => void) => {
  const ref = doc(db, 'userData', uid);
  return onSnapshot(ref, snap => cb(snap.exists() ? (snap.data() as any) : null));
};
