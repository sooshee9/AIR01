import React, { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';

interface ItemMasterRecord {
  id: string;
  itemName: string;
  itemCode: string;
}

const LOCAL_STORAGE_KEY = 'itemMasterDataCache';

const ITEM_MASTER_FIELDS = [
  { key: 'itemName', label: 'Item Name', type: 'text' },
  { key: 'itemCode', label: 'Item Code', type: 'text' },
];

const ItemMasterModule: React.FC = () => {
  const [records, setRecords] = useState<ItemMasterRecord[]>([]);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    itemName: '',
    itemCode: '',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Robust subscription with proper cleanup and error handling
  useEffect(() => {
    const authUnsubscribe = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      setUserUid(uid);

      // Clean up previous subscription immediately
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      if (!uid) {
        // User logged out — clear records but keep cache
        setRecords([]);
        setLoading(false);
        return;
      }

      // User logged in — load from Firestore with proper error handling
      setLoading(true);
      try {
        const col = collection(db, 'userData', uid, 'itemMasterData');
        
        // Set up Firestore subscription
        unsubscribeRef.current = onSnapshot(
          col,
          (snap) => {
            try {
              const docs = snap.docs.map(d => ({
                id: d.id,
                itemName: d.data().itemName || '',
                itemCode: d.data().itemCode || '',
              } as ItemMasterRecord));
              
              setRecords(docs);
              setLoading(false);
              
              // Cache to localStorage as backup
              try {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(docs));
              } catch (e) {
                console.warn('[ItemMaster] localStorage cache failed:', e);
              }
            } catch (err) {
              console.error('[ItemMaster] Error processing snapshot:', err);
              setLoading(false);
            }
          },
          (error) => {
            console.error('[ItemMaster] Subscription error:', error);
            setLoading(false);
            
            // Fallback to localStorage cache on subscription error
            try {
              const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
              if (cached) {
                setRecords(JSON.parse(cached));
              }
            } catch (e) {
              console.warn('[ItemMaster] Cache fallback failed:', e);
              setRecords([]);
            }
          }
        );
      } catch (err) {
        console.error('[ItemMaster] Failed to set up subscription:', err);
        setLoading(false);
        
        // Fallback to localStorage cache
        try {
          const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (cached) {
            setRecords(JSON.parse(cached));
          }
        } catch (e) {
          setRecords([]);
        }
      }
    });

    return () => {
      // Clean up both subscriptions on unmount
      if (unsubscribeRef.current) {
        try { unsubscribeRef.current(); } catch (e) {}
        unsubscribeRef.current = null;
      }
      try { authUnsubscribe(); } catch (e) {}
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.itemName.trim() || !form.itemCode.trim()) {
      alert('Item Name and Item Code are required.');
      return;
    }

    if (!userUid) {
      alert('You must be logged in to save.');
      return;
    }

    setLoading(true);
    try {
      if (editIdx !== null) {
        // Update existing record
        const rec = records[editIdx];
        if (rec && rec.id) {
          const docRef = doc(db, 'userData', userUid, 'itemMasterData', rec.id);
          await updateDoc(docRef, {
            itemName: form.itemName.trim(),
            itemCode: form.itemCode.trim(),
            updatedAt: serverTimestamp(),
          });
        }
        setEditIdx(null);
      } else {
        // Add new record
        const col = collection(db, 'userData', userUid, 'itemMasterData');
        await addDoc(col, {
          itemName: form.itemName.trim(),
          itemCode: form.itemCode.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setForm({ itemName: '', itemCode: '' });
    } catch (err) {
      console.error('[ItemMaster] Save failed:', err);
      alert('Failed to save record. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (idx: number) => {
    setForm(records[idx]);
    setEditIdx(idx);
  };

  // Delete handler
  const handleDelete = async (idx: number) => {
    if (!userUid) {
      alert('You must be logged in to delete.');
      return;
    }

    const confirmed = window.confirm('Delete this record?');
    if (!confirmed) return;

    setLoading(true);
    try {
      const rec = records[idx];
      if (rec && rec.id) {
        const docRef = doc(db, 'userData', userUid, 'itemMasterData', rec.id);
        await deleteDoc(docRef);
      }
    } catch (err) {
      console.error('[ItemMaster] Delete failed:', err);
      alert('Failed to delete record. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Item Master Module</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        {ITEM_MASTER_FIELDS.map((field) => (
          <div key={field.key} style={{ flex: '1 1 200px', minWidth: 180 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>{field.label}</label>
            <input
              type={field.type}
              name={field.key}
              value={(form as any)[field.key]}
              onChange={handleChange}
              required
              style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #bbb' }}
            />
          </div>
        ))}
        <button type="submit" disabled={loading} style={{ padding: '10px 24px', background: loading ? '#999' : '#1a237e', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 500, marginTop: 24, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Saving...' : 'Add'}
        </button>
      </form>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fafbfc' }}>
          <thead>
            <tr>
              {ITEM_MASTER_FIELDS.map((field) => (
                <th key={field.key} style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>{field.label}</th>
              ))}
              <th style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>Edit</th>
              <th style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>Delete</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr key={idx}>
                {ITEM_MASTER_FIELDS.map((field) => (
                  <td key={field.key} style={{ border: '1px solid #eee', padding: 8 }}>{(rec as any)[field.key]}</td>
                ))}
                <td style={{ border: '1px solid #eee', padding: 8 }}>
                  <button style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }} onClick={() => handleEdit(idx)}>Edit</button>
                  <button onClick={() => handleDelete(idx)} style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ItemMasterModule;