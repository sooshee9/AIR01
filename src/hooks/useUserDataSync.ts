import { useEffect, useRef } from 'react';
import bus from '../utils/eventBus';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';

// Global registry to prevent duplicate subscriptions
const activeSubscriptions = new Map<string, Array<() => void>>();

// Default collections to sync with Firestore - now under 'users/{uid}/' path
const DEFAULT_COLLECTIONS = [
  'psirData',
  'vsirRecords',
  'inHouseIssueData',
  'vendorIssueData',
  'purchaseData',
  'itemMaster',
  'vendorDepts',
  'stockRecords',
  'purchaseOrders'
];

export const useUserDataSync = (user: any) => {
  const componentMountedRef = useRef(true);
  const subscriptionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      // Clean up all subscriptions when user logs out
      if (subscriptionKeyRef.current && activeSubscriptions.has(subscriptionKeyRef.current)) {
        const unsubs = activeSubscriptions.get(subscriptionKeyRef.current);
        unsubs?.forEach(unsub => {
          try { unsub(); } catch {}
        });
        activeSubscriptions.delete(subscriptionKeyRef.current);
      }
      return;
    }

    const uid = user.uid;
    const subscriptionKey = `user_${uid}`;

    // Prevent duplicate subscriptions if already active for this user
    if (activeSubscriptions.has(subscriptionKey)) {
      subscriptionKeyRef.current = subscriptionKey;
      return;
    }

    const unsubs: Array<() => void> = [];

    try {
      // Subscribe to each default collection in Firestore - now using 'users' path
      DEFAULT_COLLECTIONS.forEach(collectionName => {
        try {
          const collRef = collection(db, 'users', uid, collectionName);
          
          const unsub = onSnapshot(
            collRef,
            (snapshot) => {
              if (!componentMountedRef.current) return;
              
              const data: any[] = [];
              snapshot.forEach(doc => {
                data.push({ id: doc.id, ...doc.data() });
              });

              // Dispatch events for real-time updates
              bus.dispatchEvent(new CustomEvent('userData.sync.remoteUpdate', { 
                detail: { uid, collection: collectionName, count: data.length, ts: Date.now() } 
              }));
              
              console.debug(`[useUserDataSync] Collection '${collectionName}' synced:`, data.length, 'documents');
            },
            (error) => {
              if (!componentMountedRef.current) return;
              console.error(`[useUserDataSync] Error syncing '${collectionName}':`, error);
              bus.dispatchEvent(new CustomEvent('userData.sync.error', { 
                detail: { uid, collection: collectionName, error: String(error), ts: Date.now() } 
              }));
            }
          );

          unsubs.push(unsub);
        } catch (e) {
          // Silently handle errors to prevent memory leaks
        }
      });

      activeSubscriptions.set(subscriptionKey, unsubs);
      subscriptionKeyRef.current = subscriptionKey;

      bus.dispatchEvent(new CustomEvent('userData.sync.started', { 
        detail: { uid, collections: DEFAULT_COLLECTIONS.length, ts: Date.now() } 
      }));

    } catch (e) {
      bus.dispatchEvent(new CustomEvent('userData.sync.error', { 
        detail: { uid, error: String(e), ts: Date.now() } 
      }));
      // Clean up on error
      unsubs.forEach(unsub => {
        try { unsub(); } catch {}
      });
    }

    return () => {
      componentMountedRef.current = false;
      // Only clean up if this component is the one that set up the subscription
      if (subscriptionKeyRef.current && activeSubscriptions.has(subscriptionKeyRef.current)) {
        const subs = activeSubscriptions.get(subscriptionKeyRef.current);
        if (subs === unsubs) {
          subs.forEach(unsub => {
            try { unsub(); } catch { }
          });
          activeSubscriptions.delete(subscriptionKeyRef.current);
        }
      }
    };
  }, [user?.uid]);
};
