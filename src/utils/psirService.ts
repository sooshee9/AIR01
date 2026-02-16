import { collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

type PSIRDoc = Record<string, any>;

export const subscribePsirs = (uid: string, cb: (docs: Array<PSIRDoc & { id: string }>) => void) => {
  console.log('[PSIRService.subscribePsirs] Setting up listener for user:', uid);
  const col = collection(db, 'psirs');
  
  // Try with composite index first (userId + createdAt)
  const qWithIndex = query(col, where('userId', '==', uid), orderBy('createdAt', 'desc'));
  
  let unsub: (() => void) | null = null;
  let indexCreated = false;
  
  // Attempt with index
  const handleIndexError = (error: any) => {
    const isIndexError = error?.code === 'failed-precondition' && error?.message?.includes('index');
    
    if (isIndexError && !indexCreated) {
      console.warn('[PSIRService] Composite index missing. Falling back to simple query (userId only)...');
      indexCreated = true;
      
      // Unsubscribe from failed query
      if (unsub) unsub();
      
      // Fallback: simple query without orderBy, sort client-side
      const qFallback = query(col, where('userId', '==', uid));
      unsub = onSnapshot(qFallback, snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        // Sort client-side by createdAt descending
        docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        console.log('[PSIRService.subscribePsirs] 🔔 SNAPSHOT (fallback) -', docs.length, 'PSIRs received');
        console.log('[PSIRService.subscribePsirs] IDs:', docs.map(d => d.id));
        cb(docs);
      }, (error2) => {
        console.error('[PSIRService] Even fallback query failed:', error2.code, error2.message);
        console.error('[PSIRService] Fallback error for user:', uid);
        cb([]);
      });
    } else {
      console.error('[PSIRService] subscribePsirs failed (likely missing index):', error.code, error.message);
      console.error('[PSIRService] To fix: Create Firestore composite index on "psirs" collection:');
      console.error('[PSIRService]   - Field: userId (Ascending)');
      console.error('[PSIRService]   - Field: createdAt (Descending)');
      console.error('[PSIRService] Query attempted for user:', uid);
      cb([]);
    }
  };
  
  unsub = onSnapshot(qWithIndex, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    console.log('[PSIRService.subscribePsirs] 🔔 SNAPSHOT (index) -', docs.length, 'PSIRs received');
    console.log('[PSIRService.subscribePsirs] IDs:', docs.map(d => d.id));
    cb(docs);
  }, handleIndexError);
  
  console.log('[PSIRService.subscribePsirs] ✅ Listener set up and returning unsub function');
  return unsub;
};

export const addPsir = async (uid: string, data: any) => {
  console.log('[psirService.addPsir] Starting - uid:', uid);
  const ref = await addDoc(collection(db, 'psirs'), { ...data, userId: uid, createdAt: serverTimestamp() });
  console.log('[psirService.addPsir] Success - new ID:', ref.id);
  return ref.id;
};

export const updatePsir = async (id: string, data: any) => {
  console.log('[psirService.updatePsir] Starting - id:', id, 'data:', data);
  await updateDoc(doc(db, 'psirs', id), { ...data, updatedAt: serverTimestamp() });
  console.log('[psirService.updatePsir] Success - updated ID:', id);
};

export const deletePsir = async (id: string) => {
  console.log('[psirService.deletePsir] Starting - id:', id);
  await deleteDoc(doc(db, 'psirs', id));
  console.log('[psirService.deletePsir] Success - deleted ID:', id);
};
