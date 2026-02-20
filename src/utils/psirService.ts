import { collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

type PSIRDoc = Record<string, any>;

// Simple normalization utilities to avoid persisting negative/string qtys and okQty
const normalizeQty = (val: any): number | undefined => {
  if (val === null || val === undefined || val === '') return undefined;
  const n = Number(val);
  if (!Number.isFinite(n)) return undefined;
  return Math.abs(n);
};

const sanitizePsirData = (data: any) => {
  if (!data || typeof data !== 'object') return data;
  const d: any = { ...data };
  if ('poQty' in d) d.poQty = normalizeQty(d.poQty);
  if ('okQty' in d) delete d.okQty;
  if (Array.isArray(d.items)) {
    d.items = d.items.map((it: any) => {
      if (!it || typeof it !== 'object') return it;
      const copy = { ...it };
      if ('poQty' in copy) copy.poQty = normalizeQty(copy.poQty);
      if ('okQty' in copy) delete copy.okQty;
      return copy;
    });
  }
  return d;
};

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
        let docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        // Sort client-side by createdAt descending
        docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        
        // Deduplicate by indentNo only (keep records with BOTH PO No AND Supplier Name)
        // Only remove incomplete duplicates if count > 1 for that Indent No
        const seenByIndent = new Map<string, any[]>();
        const dedupLog: string[] = [];
        const origLength = docs.length;
        
        // First pass: group by indentNo
        docs.forEach(doc => {
          const indentNo = doc.indentNo || 'MISSING';
          if (!seenByIndent.has(indentNo)) {
            seenByIndent.set(indentNo, []);
          }
          seenByIndent.get(indentNo)!.push(doc);
        });
        
        // Second pass: deduplicate within each group
        const deduped: any[] = [];
        seenByIndent.forEach((groupDocs, indentNo) => {
          if (groupDocs.length === 1) {
            // Single record - always keep, even if incomplete (user can edit later)
            const doc = groupDocs[0];
            deduped.push(doc);
            const isComplete = (!!doc.poNo && doc.poNo.trim() !== '') && 
                              (!!doc.supplierName && doc.supplierName.trim() !== '');
            dedupLog.push(`✅ Keep: Indent ${indentNo} (id: ${doc.id}) - ${isComplete ? 'complete' : 'incomplete'} record`);
          } else {
            // Multiple records for same indent - keep most recent complete one, or mots recent overall if none complete
            const completeRecords = groupDocs.filter(doc => 
              (!!doc.poNo && doc.poNo.trim() !== '') && 
              (!!doc.supplierName && doc.supplierName.trim() !== '')
            );
            
            // Sort by creation date (most recent first)
            completeRecords.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            groupDocs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            
            // Keep either most recent complete, or most recent overall
            const kept = completeRecords.length > 0 ? completeRecords[0] : groupDocs[0];
            deduped.push(kept);
            dedupLog.push(`✅ Keep: Indent ${indentNo} (id: ${kept.id}) - most recent ${completeRecords.length > 0 ? 'complete' : 'overall'} record`);
            
            // Log removed duplicates
            groupDocs.forEach(doc => {
              if (doc.id !== kept.id) {
                dedupLog.push(`❌ Remove: Indent ${indentNo} (id: ${doc.id}) - duplicate`);
              }
            });
          }
        });
        
        docs = deduped;
        docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        
        const removedCount = origLength - docs.length;
        console.log('[PSIRService.subscribePsirs] 🔔 SNAPSHOT (fallback) - Original:', origLength, 'After dedup:', docs.length, 'Removed:', removedCount);
        dedupLog.forEach(log => console.log('[Dedup]', log));
        console.log('[PSIRService.subscribePsirs] Final IDs:', docs.map(d => `${d.indentNo} (PO: ${d.poNo}, Supplier: ${d.supplierName}) - ${d.id}`));
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
    let docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    
    // Deduplicate by indentNo only (keep records with BOTH PO No AND Supplier Name)
    // Only remove incomplete duplicates if count > 1 for that Indent No
    const seenByIndent = new Map<string, any[]>();
    const dedupLog: string[] = [];
    const origLength = docs.length;
    
    // First pass: group by indentNo
    docs.forEach(doc => {
      const indentNo = doc.indentNo || 'MISSING';
      if (!seenByIndent.has(indentNo)) {
        seenByIndent.set(indentNo, []);
      }
      seenByIndent.get(indentNo)!.push(doc);
    });
    
    // Second pass: deduplicate within each group
    const deduped: any[] = [];
    seenByIndent.forEach((groupDocs, indentNo) => {
      if (groupDocs.length === 1) {
        // Single record - always keep, even if incomplete (user can edit later)
        const doc = groupDocs[0];
        deduped.push(doc);
        const isComplete = (!!doc.poNo && doc.poNo.trim() !== '') && 
                          (!!doc.supplierName && doc.supplierName.trim() !== '');
        dedupLog.push(`✅ Keep: Indent ${indentNo} (id: ${doc.id}) - ${isComplete ? 'complete' : 'incomplete'} record`);
      } else {
        // Multiple records for same indent - keep most recent complete one, or most recent overall if none complete
        const completeRecords = groupDocs.filter(doc => 
          (!!doc.poNo && doc.poNo.trim() !== '') && 
          (!!doc.supplierName && doc.supplierName.trim() !== '')
        );
        
        // Sort by creation date (most recent first)
        completeRecords.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        groupDocs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        
        // Keep either most recent complete, or most recent overall
        const kept = completeRecords.length > 0 ? completeRecords[0] : groupDocs[0];
        deduped.push(kept);
        dedupLog.push(`✅ Keep: Indent ${indentNo} (id: ${kept.id}) - most recent ${completeRecords.length > 0 ? 'complete' : 'overall'} record`);
        
        // Log removed duplicates
        groupDocs.forEach(doc => {
          if (doc.id !== kept.id) {
            dedupLog.push(`❌ Remove: Indent ${indentNo} (id: ${doc.id}) - duplicate`);
          }
        });
      }
    });
    
    docs = deduped;
    docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    
    const removedCount = origLength - docs.length;
    console.log('[PSIRService.subscribePsirs] 🔔 SNAPSHOT (index) - Original:', origLength, 'After dedup:', docs.length, 'Removed:', removedCount);
    dedupLog.forEach(log => console.log('[Dedup]', log));
    console.log('[PSIRService.subscribePsirs] Final IDs:', docs.map(d => `${d.indentNo} (PO: ${d.poNo}, Supplier: ${d.supplierName}) - ${d.id}`));
    cb(docs);
  }, handleIndexError);
  
  console.log('[PSIRService.subscribePsirs] ✅ Listener set up and returning unsub function');
  return unsub;
};

export const addPsir = async (uid: string, data: any) => {
  console.log('[psirService.addPsir] Starting - uid:', uid);
  const sanitized = sanitizePsirData(data);
  const ref = await addDoc(collection(db, 'psirs'), { ...sanitized, userId: uid, createdAt: serverTimestamp() });
  console.log('[psirService.addPsir] Success - new ID:', ref.id);
  return ref.id;
};

export const updatePsir = async (id: string, data: any) => {
  console.log('[psirService.updatePsir] Starting - id:', id, 'data:', data);
  const sanitized = sanitizePsirData(data);
  await updateDoc(doc(db, 'psirs', id), { ...sanitized, updatedAt: serverTimestamp() });
  console.log('[psirService.updatePsir] Success - updated ID:', id);
};

export const deletePsir = async (id: string) => {
  console.log('[psirService.deletePsir] Starting - id:', id);
  console.log('[psirService.deletePsir] ⚠️ DELETING FROM FIRESTORE - This should be removed on next subscription callback');
  await deleteDoc(doc(db, 'psirs', id));
  console.log('[psirService.deletePsir] ✅ SUCCESS - document deleted from Firestore:', id);
  console.log('[psirService.deletePsir] 📌 Watch for subscription callback - document should no longer appear');};