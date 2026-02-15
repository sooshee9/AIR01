import { collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

type PSIRDoc = Record<string, any>;

export const subscribePsirs = (uid: string, cb: (docs: Array<PSIRDoc & { id: string }>) => void) => {
  const col = collection(db, 'psirs');
  const q = query(col, where('userId', '==', uid), orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    cb(docs);
  }, (error) => {
    console.error('[PSIRService] subscribePsirs failed (likely missing index):', error.code, error.message);
    // Fallback: return empty array so modules don't crash
    cb([]);
  });
  return unsub;
};

export const addPsir = async (uid: string, data: any) => {
  const ref = await addDoc(collection(db, 'psirs'), { ...data, userId: uid, createdAt: serverTimestamp() });
  return ref.id;
};

export const updatePsir = async (id: string, data: any) => {
  await updateDoc(doc(db, 'psirs', id), { ...data, updatedAt: serverTimestamp() });
};

export const deletePsir = async (id: string) => {
  await deleteDoc(doc(db, 'psirs', id));
};
