import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase';

export const runDataDiagnostics = async () => {
  const user = auth.currentUser;
  if (!user) {
    console.error('[DIAGNOSTICS] No authenticated user');
    return { error: 'No authenticated user' };
  }

  const uid = user.uid;
  console.info('[DIAGNOSTICS] Running diagnostics for user:', uid);

  const results: any = {
    uid,
    timestamp: new Date().toISOString(),
    collections: {},
  };

  const collectionsToCheck = [
    'users/' + uid + '/purchaseOrders',
    'users/' + uid + '/purchaseData',
    'users/' + uid + '/indentData',
    'users/' + uid + '/stockRecords',
    'users/' + uid + '/itemMaster',
    'users/' + uid + '/vendorDepts',
    'users/' + uid + '/vendorIssues',
    'users/' + uid + '/vsirRecords',
  ];

  for (const collPath of collectionsToCheck) {
    try {
      const parts = collPath.split('/');
      let col;
      if (parts.length === 3) {
        col = collection(db, parts[0], parts[1], parts[2]);
      }
      if (!col) continue;

      const snap = await getDocs(col);
      const count = snap.docs.length;
      const sample = snap.docs.length > 0 ? snap.docs[0].data() : null;
      
      results.collections[collPath] = {
        exists: true,
        count,
        sampleData: sample,
      };
      
      console.info(`[DIAGNOSTICS] Collection ${collPath}:`, count, 'documents');
    } catch (error) {
      results.collections[collPath] = {
        exists: false,
        error: (error as any).message,
      };
      console.error(`[DIAGNOSTICS] Collection ${collPath} error:`, error);
    }
  }

  // Check psirs collection (root level)
  try {
    const psirCol = collection(db, 'psirs');
    const psirQuery = query(psirCol, where('userId', '==', uid));
    const psirSnap = await getDocs(psirQuery);
    const count = psirSnap.docs.length;
    const sample = psirSnap.docs.length > 0 ? psirSnap.docs[0].data() : null;
    
    results.collections['psirs (userId filter)'] = {
      exists: true,
      count,
      sampleData: sample,
    };
    console.info('[DIAGNOSTICS] Collection psirs (userId filter):', count, 'documents');
  } catch (error) {
    results.collections['psirs (userId filter)'] = {
      exists: false,
      error: (error as any).message,
    };
    console.error('[DIAGNOSTICS] Collection psirs error:', error);
  }

  console.info('[DIAGNOSTICS] Complete results:', results);
  return results;
};

export const logDiagnostics = () => {
  runDataDiagnostics();
};
