import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { logger } from './logger';

/**
 * Add a document to a Firestore collection
 * @param uid User ID
 * @param collectionName Collection name
 * @param data Document data
 * @returns Document ID
 */
export const addFirestoreDoc = async (uid: string, collectionName: string, data: any): Promise<string> => {
  try {
    const collRef = collection(db, 'users', uid, collectionName);
    const docRef = await addDoc(collRef, {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    logger.log(`[Firestore] Added to ${collectionName}:`, docRef.id);
    console.debug(`[Firestore] Added document to 'users/${uid}/${collectionName}':`, docRef.id);
    return docRef.id;
  } catch (error) {
    logger.error(`[Firestore] Error adding to ${collectionName}:`, error);
    console.error(`[Firestore] Error adding to 'users/${uid}/${collectionName}':`, error);
    throw error;
  }
};

/**
 * Get all documents from a Firestore collection
 * @param uid User ID
 * @param collectionName Collection name
 * @returns Array of documents with IDs
 */
export const getFirestoreDocs = async (uid: string, collectionName: string): Promise<any[]> => {
  try {
    const collRef = collection(db, 'users', uid, collectionName);
    const snapshot = await getDocs(collRef);
    const docs: any[] = [];
    snapshot.forEach(doc => {
      docs.push({ id: doc.id, ...doc.data() });
    });
    logger.log(`[Firestore] Retrieved ${docs.length} documents from ${collectionName}`);
    console.debug(`[Firestore] Retrieved ${docs.length} documents from 'users/${uid}/${collectionName}'`);
    return docs;
  } catch (error) {
    logger.error(`[Firestore] Error retrieving from ${collectionName}:`, error);
    console.error(`[Firestore] Error retrieving from 'users/${uid}/${collectionName}':`, error);
    return [];
  }
};

/**
 * Update a document in Firestore
 * @param uid User ID
 * @param collectionName Collection name
 * @param docId Document ID
 * @param data Updated data
 */
export const updateFirestoreDoc = async (uid: string, collectionName: string, docId: string, data: any): Promise<void> => {
  try {
    const docRef = doc(db, 'users', uid, collectionName, docId);
    await updateDoc(docRef, {
      ...data,
      updatedAt: new Date().toISOString(),
    });
    logger.log(`[Firestore] Updated ${collectionName}/${docId}`);
    console.debug(`[Firestore] Updated 'users/${uid}/${collectionName}/${docId}'`);
  } catch (error) {
    logger.error(`[Firestore] Error updating ${collectionName}/${docId}:`, error);
    console.error(`[Firestore] Error updating 'users/${uid}/${collectionName}/${docId}':`, error);
    throw error;
  }
};

/**
 * Delete a document from Firestore
 * @param uid User ID
 * @param collectionName Collection name
 * @param docId Document ID
 */
export const deleteFirestoreDoc = async (uid: string, collectionName: string, docId: string): Promise<void> => {
  try {
    const docRef = doc(db, 'users', uid, collectionName, docId);
    await deleteDoc(docRef);
    logger.log(`[Firestore] Deleted ${collectionName}/${docId}`);
    console.debug(`[Firestore] Deleted 'users/${uid}/${collectionName}/${docId}'`);
  } catch (error) {
    logger.error(`[Firestore] Error deleting ${collectionName}/${docId}:`, error);
    console.error(`[Firestore] Error deleting 'users/${uid}/${collectionName}/${docId}':`, error);
    throw error;
  }
};

/**
 * Subscribe to real-time updates from a Firestore collection
 * @param uid User ID
 * @param collectionName Collection name
 * @param callback Function called with updated documents
 * @returns Unsubscribe function
 */
export const subscribeFirestoreDocs = (
  uid: string,
  collectionName: string,
  callback: (docs: any[]) => void
): (() => void) => {
  try {
    const collRef = collection(db, 'users', uid, collectionName);
    const unsubscribe = onSnapshot(
      collRef,
      (snapshot) => {
        const docs: any[] = [];
        snapshot.forEach(doc => {
          docs.push({ id: doc.id, ...doc.data() });
        });
        callback(docs);
        logger.log(`[Firestore] Real-time update: ${collectionName} (${docs.length} docs)`);
        console.debug(`[Firestore] Real-time update: 'users/${uid}/${collectionName}' (${docs.length} docs)`);
      },
      (error) => {
        logger.error(`[Firestore] Error subscribing to ${collectionName}:`, error);
        console.error(`[Firestore] Error subscribing to 'users/${uid}/${collectionName}':`, error);
      }
    );
    return unsubscribe;
  } catch (error) {
    logger.error(`[Firestore] Error setting up subscription for ${collectionName}:`, error);
    console.error(`[Firestore] Error setting up subscription for 'users/${uid}/${collectionName}':`, error);
    return () => {};
  }
};

/**
 * Bulk replace all documents in a collection (useful for syncing arrays)
 * @param uid User ID
 * @param collectionName Collection name
 * @param newData Array of documents to store
 */
export const replaceFirestoreCollection = async (uid: string, collectionName: string, newData: any[]): Promise<void> => {
  try {
    const collRef = collection(db, 'users', uid, collectionName);
    
    // Get existing documents
    const snapshot = await getDocs(collRef);
    const existingIds = new Set<string>();
    
    // Delete old documents
    const deletePromises = snapshot.docs.map(doc => {
      existingIds.add(doc.id);
      return deleteDoc(doc.ref);
    });
    await Promise.all(deletePromises);
    
    // Add new documents
    const addPromises = newData.map(item => {
      return addDoc(collRef, {
        ...item,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    await Promise.all(addPromises);
    
    logger.log(`[Firestore] Replaced ${collectionName} with ${newData.length} documents`);
    console.debug(`[Firestore] Replaced 'users/${uid}/${collectionName}': deleted ${existingIds.size}, added ${newData.length}`);
  } catch (error) {
    logger.error(`[Firestore] Error replacing ${collectionName}:`, error);
    console.error(`[Firestore] Error replacing 'users/${uid}/${collectionName}':`, error);
    throw error;
  }
};
