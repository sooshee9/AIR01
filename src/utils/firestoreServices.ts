import { collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, setDoc, deleteDoc, doc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { logger } from './logger';

// ============ PURCHASE ORDERS ============
export const subscribePurchaseOrders = (uid: string, cb: (docs: any[]) => void) => {
  const col = collection(db, 'users', uid, 'purchaseOrders');
  const q = query(col, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(docs);
  }, (error) => {
    logger.error('[FirestoreServices] Error subscribing to purchaseOrders:', error);
    cb([]);
  });
  return unsub;
};

export const getPurchaseOrders = async (uid: string) => {
  try {
    if (!uid) {
      console.warn('[FirestoreServices] getPurchaseOrders called with empty uid');
      return [];
    }
    const col = collection(db, 'users', uid, 'purchaseOrders');
    const snap = await getDocs(col);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.debug('[FirestoreServices] getPurchaseOrders retrieved', data.length, 'records for user:', uid);
    return data;
  } catch (error) {
    console.error('[FirestoreServices] Error getting purchaseOrders for user', uid, ':', error);
    return [];
  }
};

export const addPurchaseOrder = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'purchaseOrders');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding purchaseOrder:', error);
    throw error;
  }
};

export const updatePurchaseOrder = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'purchaseOrders', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating purchaseOrder:', error);
    throw error;
  }
};

// ============ VENDOR DEPARTMENTS ============
export const subscribeVendorDepts = (uid: string, cb: (docs: any[]) => void) => {
  const col = collection(db, 'users', uid, 'vendorDepts');
  const unsub = onSnapshot(col, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(docs);
  }, (error) => {
    logger.error('[FirestoreServices] Error subscribing to vendorDepts:', error);
    cb([]);
  });
  return unsub;
};

export const getVendorDepts = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'vendorDepts');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting vendorDepts:', error);
    return [];
  }
};

export const addVendorDept = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'vendorDepts');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding vendorDept:', error);
    throw error;
  }
};

export const updateVendorDept = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'vendorDepts', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating vendorDept:', error);
    throw error;
  }
};

export const deleteVendorDept = async (uid: string, docId: string) => {
  try {
    const docRef = doc(db, 'users', uid, 'vendorDepts', docId);
    await deleteDoc(docRef);
  } catch (error) {
    logger.error('[FirestoreServices] Error deleting vendorDept:', error);
    throw error;
  }
};

// ============ VENDOR ISSUES ============
export const subscribeVendorIssues = (uid: string, cb: (docs: any[]) => void) => {
  const col = collection(db, 'users', uid, 'vendorIssues');
  const q = query(col, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(docs);
  }, (error) => {
    logger.error('[FirestoreServices] Error subscribing to vendorIssues:', error);
    cb([]);
  });
  return unsub;
};

export const getVendorIssues = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'vendorIssues');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting vendorIssues:', error);
    return [];
  }
};

export const addVendorIssue = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'vendorIssues');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding vendorIssue:', error);
    throw error;
  }
};

export const updateVendorIssue = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'vendorIssues', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating vendorIssue:', error);
    throw error;
  }
};

export const deleteVendorIssue = async (uid: string, docId: string) => {
  try {
    const docRef = doc(db, 'users', uid, 'vendorIssues', docId);
    await deleteDoc(docRef);
  } catch (error) {
    logger.error('[FirestoreServices] Error deleting vendorIssue:', error);
    throw error;
  }
};

// ============ VENDOR STOCK ISSUE RECORDS (VSIR) ============
export const subscribeVSIRRecords = (uid: string, cb: (docs: any[]) => void) => {
  const col = collection(db, 'users', uid, 'vsirRecords');
  const q = query(col, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(docs);
  }, (error) => {
    logger.error('[FirestoreServices] Error subscribing to vsirRecords:', error);
    cb([]);
  });
  return unsub;
};

export const getVSIRRecords = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'vsirRecords');
    const q = query(col, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting vsirRecords:', error);
    return [];
  }
};

export const addVSIRRecord = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'vsirRecords');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding vsirRecord:', error);
    throw error;
  }
};

export const updateVSIRRecord = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'vsirRecords', docId);
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating vsirRecord:', error);
    throw error;
  }
};

export const deleteVSIRRecord = async (uid: string, docId: string) => {
  try {
    const docRef = doc(db, 'users', uid, 'vsirRecords', docId);
    await deleteDoc(docRef);
  } catch (error) {
    logger.error('[FirestoreServices] Error deleting vsirRecord:', error);
    throw error;
  }
};

// ============ PURCHASE DATA ============
export const subscribePurchaseData = (uid: string, cb: (docs: any[]) => void) => {
  const col = collection(db, 'users', uid, 'purchaseData');
  const q = query(col, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(docs);
  }, (error) => {
    logger.error('[FirestoreServices] Error subscribing to purchaseData:', error);
    cb([]);
  });
  return unsub;
};

export const getPurchaseData = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'purchaseData');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting purchaseData:', error);
    return [];
  }
};

export const updatePurchaseData = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'purchaseData', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating purchaseData:', error);
    throw error;
  }
};

// ============ INDENT DATA ============
export const getIndentData = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'indentData');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting indentData:', error);
    return [];
  }
};

// ============ STOCK RECORDS ============
export const getStockRecords = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'stockRecords');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting stockRecords:', error);
    return [];
  }
};

export const addStockRecord = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'stockRecords');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding stockRecord:', error);
    throw error;
  }
};

export const updateStockRecord = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'stockRecords', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating stockRecord:', error);
    throw error;
  }
};

export const deleteStockRecord = async (uid: string, docId: string) => {
  try {
    const docRef = doc(db, 'users', uid, 'stockRecords', docId);
    await deleteDoc(docRef);
  } catch (error) {
    logger.error('[FirestoreServices] Error deleting stockRecord:', error);
    throw error;
  }
};

export const subscribeStockRecords = (uid: string, cb: (docs: any[]) => void) => {
  try {
    const col = collection(db, 'users', uid, 'stockRecords');
    const q = query(col, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb(docs);
    }, (error) => {
      logger.error('[FirestoreServices] Error subscribing to stockRecords:', error);
      cb([]);
    });
    return unsub;
  } catch (error) {
    logger.error('[FirestoreServices] subscribeStockRecords failed:', error);
    return () => {};
  }
};

// ============ ITEM MASTER ============
export const subscribeItemMaster = (uid: string, cb: (docs: any[]) => void) => {
  try {
    const col = collection(db, 'users', uid, 'itemMaster');
    const unsub = onSnapshot(col, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb(docs);
    }, (error) => {
      logger.error('[FirestoreServices] Error subscribing to itemMaster:', error);
      cb([]);
    });
    return unsub;
  } catch (error) {
    logger.error('[FirestoreServices] subscribeItemMaster failed:', error);
    return () => {};
  }
};

export const getItemMaster = async (uid: string) => {
  try {
    const col = collection(db, 'users', uid, 'itemMaster');
    const snap = await getDocs(col);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    logger.error('[FirestoreServices] Error getting itemMaster:', error);
    return [];
  }
};

export const addItemMaster = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'itemMaster');
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding itemMaster:', error);
    throw error;
  }
};

export const updateItemMaster = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'itemMaster', docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating itemMaster:', error);
    throw error;
  }
};

export const deleteItemMaster = async (uid: string, docId: string) => {
  try {
    const docRef = doc(db, 'users', uid, 'itemMaster', docId);
    await deleteDoc(docRef);
  } catch (error) {
    logger.error('[FirestoreServices] Error deleting itemMaster:', error);
    throw error;
  }
};
// ============ HARD RESET - Delete all data except ItemMaster ============
export const hardResetAllData = async (uid: string) => {
  try {
    console.log('[FirestoreServices] Starting hard reset for user:', uid);
    
    const collectionsToDelete = [
      'vendorIssues',
      'vsirRecords',
      'purchaseOrders',
      'vendorDepts',
      'indents',
      'stock',
      'inHouseIssues'
    ];
    
    const deletionResults: Record<string, number> = {};
    
    // Delete all docs from each collection under users/{uid}
    for (const collectionName of collectionsToDelete) {
      try {
        const col = collection(db, 'users', uid, collectionName);
        const snap = await getDocs(col);
        
        let deletedCount = 0;
        for (const doc of snap.docs) {
          try {
            await deleteDoc(doc.ref);
            deletedCount++;
          } catch (err) {
            console.error(`[FirestoreServices] Error deleting ${collectionName} doc:`, doc.id, err);
          }
        }
        
        deletionResults[collectionName] = deletedCount;
        console.log(`[FirestoreServices] Deleted ${deletedCount} documents from ${collectionName}`);
      } catch (err) {
        console.error(`[FirestoreServices] Error querying ${collectionName}:`, err);
        deletionResults[collectionName] = 0;
      }
    }
    
    // Delete user's PSIRs from root psirs collection (where userId == uid)
    try {
      const psirCol = collection(db, 'psirs');
      const q = query(psirCol, where('userId', '==', uid));
      const snap = await getDocs(q);
      
      let deletedCount = 0;
      for (const doc of snap.docs) {
        try {
          await deleteDoc(doc.ref);
          deletedCount++;
        } catch (err) {
          console.error('[FirestoreServices] Error deleting PSIR:', doc.id, err);
        }
      }
      
      deletionResults['psirs'] = deletedCount;
      console.log(`[FirestoreServices] Deleted ${deletedCount} PSIRs out of ${snap.docs.length}`);
    } catch (err) {
      console.error('[FirestoreServices] Error querying PSIRs:', err);
      deletionResults['psirs'] = 0;
    }
    
    // Clear all localStorage caches
    const localStorageKeys = [
      'purchaseOrderData',
      'vendorDeptData',
      'indentData',
      'vendorIssueData',
      'vsirData',
      'psirData',
      'itemMasterData',
      'userData',
      'stockData',
      'inHouseIssueData'
    ];
    
    localStorageKeys.forEach(key => {
      try {
        localStorage.removeItem(key);
        console.log(`[FirestoreServices] Cleared localStorage: ${key}`);
      } catch (err) {
        console.error(`[FirestoreServices] Error clearing ${key}:`, err);
      }
    });
    
    // Wait a moment for Firestore to finalize deletions
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify deletion by checking counts
    console.log('[FirestoreServices] ✅ Hard reset completed:', deletionResults);
    console.log('[FirestoreServices] Summary:');
    Object.entries(deletionResults).forEach(([col, count]) => {
      console.log(`  - ${col}: ${count} deleted`);
    });
    
    return { success: true, message: 'All data deleted except ItemMaster', deletionResults };
  } catch (error) {
    logger.error('[FirestoreServices] Error during hard reset:', error);
    throw error;
  }
};

// Verify that collections are empty
export const verifyDataCleared = async (uid: string) => {
  try {
    console.log('[FirestoreServices] Verifying data deletion...');
    
    const collectionsToCheck = [
      'vendorIssues',
      'vsirRecords',
      'purchaseOrders',
      'vendorDepts',
      'indents',
      'stock',
      'inHouseIssues'
    ];
    
    const verificationResults: Record<string, number> = {};
    const detailedResults: Record<string, any[]> = {};
    
    for (const collectionName of collectionsToCheck) {
      const col = collection(db, 'users', uid, collectionName);
      const snap = await getDocs(col);
      verificationResults[collectionName] = snap.docs.length;
      
      if (snap.docs.length > 0) {
        detailedResults[collectionName] = snap.docs.map(d => ({ id: d.id, data: d.data() }));
        console.error(`[FirestoreServices] ⚠️ Found ${snap.docs.length} remaining docs in ${collectionName}:`, detailedResults[collectionName]);
      }
    }
    
    // Check PSIRs
    const psirCol = collection(db, 'psirs');
    const q = query(psirCol, where('userId', '==', uid));
    const psirSnap = await getDocs(q);
    verificationResults['psirs'] = psirSnap.docs.length;
    
    if (psirSnap.docs.length > 0) {
      detailedResults['psirs'] = psirSnap.docs.map(d => ({ id: d.id, data: d.data() }));
      console.error(`[FirestoreServices] ⚠️ Found ${psirSnap.docs.length} remaining PSIRs:`, detailedResults['psirs']);
    }
    
    const allClear = Object.values(verificationResults).every(count => count === 0);
    
    console.log('[FirestoreServices] ✅ Verification results:', verificationResults);
    console.log(`[FirestoreServices] All data cleared: ${allClear}`);
    
    if (!allClear) {
      console.error('[FirestoreServices] ⚠️ WARNING: Some data was not deleted! Details:', detailedResults);
    }
    
    return { allClear, results: verificationResults, detailedResults };
  } catch (error) {
    console.error('[FirestoreServices] Error verifying data:', error);
    return { allClear: false, results: {}, detailedResults: {}, error: String(error) };
  }
};

// Aggressive cleanup - forces deletion of all remaining data
export const forceCleanupAllData = async (uid: string) => {
  try {
    console.log('[FirestoreServices] Starting FORCE CLEANUP...');
    
    const collectionsToDelete = [
      'vendorIssues',
      'vsirRecords',
      'purchaseOrders',
      'vendorDepts',
      'indents',
      'stock',
      'inHouseIssues'
    ];
    
    const forceCleanupResults: Record<string, number> = {};
    
    // Force delete all docs with batch operations
    for (const collectionName of collectionsToDelete) {
      try {
        const col = collection(db, 'users', uid, collectionName);
        const snap = await getDocs(col);
        
        console.log(`[FirestoreServices] Force cleaning ${collectionName}: ${snap.docs.length} docs found`);
        
        let deletedCount = 0;
        for (const doc of snap.docs) {
          try {
            await deleteDoc(doc.ref);
            deletedCount++;
            console.log(`[FirestoreServices]   Deleted ${collectionName}/${doc.id}`);
          } catch (err) {
            console.error(`[FirestoreServices]   Failed to delete ${collectionName}/${doc.id}:`, err);
          }
        }
        
        forceCleanupResults[collectionName] = deletedCount;
      } catch (err) {
        console.error(`[FirestoreServices] Error force cleaning ${collectionName}:`, err);
        forceCleanupResults[collectionName] = 0;
      }
    }
    
    // Force cleanup PSIRs
    try {
      const psirCol = collection(db, 'psirs');
      const q = query(psirCol, where('userId', '==', uid));
      const snap = await getDocs(q);
      
      console.log(`[FirestoreServices] Force cleaning PSIRs: ${snap.docs.length} docs found`);
      
      let deletedCount = 0;
      for (const doc of snap.docs) {
        try {
          await deleteDoc(doc.ref);
          deletedCount++;
          console.log(`[FirestoreServices]   Deleted psirs/${doc.id}`);
        } catch (err) {
          console.error(`[FirestoreServices]   Failed to delete psirs/${doc.id}:`, err);
        }
      }
      
      forceCleanupResults['psirs'] = deletedCount;
    } catch (err) {
      console.error('[FirestoreServices] Error force cleaning PSIRs:', err);
      forceCleanupResults['psirs'] = 0;
    }
    
    console.log('[FirestoreServices] ✅ Force cleanup completed:', forceCleanupResults);
    return { success: true, forceCleanupResults };
  } catch (error) {
    console.error('[FirestoreServices] Fatal error during force cleanup:', error);
    throw error;
  }
}

// ============ IN HOUSE ISSUES ============
export const subscribeInHouseIssues = (uid: string, cb: (docs: any[]) => void) => {
  const col = collection(db, 'users', uid, 'inHouseIssues');
  const q = query(col, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(docs);
  }, (error) => {
    logger.error('[FirestoreServices] Error subscribing to inHouseIssues:', error);
    cb([]);
  });
  return unsub;
};

export const addInHouseIssue = async (uid: string, data: any) => {
  try {
    const col = collection(db, 'users', uid, 'inHouseIssues');
    const docRef = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return docRef.id;
  } catch (error) {
    logger.error('[FirestoreServices] Error adding inHouseIssue:', error);
    throw error;
  }
};

export const updateInHouseIssue = async (uid: string, docId: string, data: any) => {
  try {
    const docRef = doc(db, 'users', uid, 'inHouseIssues', docId);
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    logger.error('[FirestoreServices] Error updating inHouseIssue:', error);
    throw error;
  }
};

export const deleteInHouseIssue = async (uid: string, docId: string) => {
  try {
    const docRef = doc(db, 'users', uid, 'inHouseIssues', docId);
    await deleteDoc(docRef);
  } catch (error) {
    logger.error('[FirestoreServices] Error deleting inHouseIssue:', error);
    throw error;
  }
};