import React, { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { getItemMaster, subscribeItemMaster, addItemMaster, updateItemMaster, deleteItemMaster } from '../utils/firestoreServices';

interface ItemMasterRecord {
  id?: string | number;
  itemName: string;
  itemCode: string;
}

const ITEM_MASTER_FIELDS = [
  { key: 'itemName', label: 'Item Name', type: 'text' },
  { key: 'itemCode', label: 'Item Code', type: 'text' },
];

const ItemMasterModule: React.FC = () => {
  const [records, setRecords] = useState<ItemMasterRecord[]>([]);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [form, setForm] = useState<ItemMasterRecord>({
    itemName: '',
    itemCode: '',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const firestoreUnsubRef = useRef<(() => void) | null>(null);

  // Handle auth state changes and Firestore subscription lifecycle (Firestore-only)
  useEffect(() => {
    const authUnsubscribe = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;

      // Logout: clear records and cleanup subscription
      if (!uid) {
        setRecords([]);
        setUserUid(null);
        if (firestoreUnsubRef.current) {
          try { firestoreUnsubRef.current(); } catch {}
          firestoreUnsubRef.current = null;
        }
        return;
      }

      // Login: set UID and subscribe to Firestore
      setUserUid(uid);

      // Clean previous subscription if any
      if (firestoreUnsubRef.current) {
        try { firestoreUnsubRef.current(); } catch {}
        firestoreUnsubRef.current = null;
      }

      // Small delay to avoid race with cleanup
      setTimeout(() => {
        try {
          firestoreUnsubRef.current = subscribeItemMaster(uid, (docs) => {
            const firestoreRecords = docs.map(d => ({ id: d.id, itemName: d.itemName, itemCode: d.itemCode }));
            setRecords(firestoreRecords);
          });
        } catch (e) {
          console.error('[ItemMaster] subscribeItemMaster failed', e);
          // fallback one-time fetch
          getItemMaster(uid).then(items => setRecords(items.map((d: any) => ({ id: d.id, itemName: d.itemName, itemCode: d.itemCode })))).catch(() => setRecords([]));
        }
      }, 100);
    });

    return () => {
      try { authUnsubscribe(); } catch {}
      if (firestoreUnsubRef.current) {
        try { firestoreUnsubRef.current(); } catch {}
        firestoreUnsubRef.current = null;
      }
    };
  }, []);

  // Firestore-only: no localStorage persistence

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    (async () => {
      if (userUid) {
        // Logged in - save to Firestore
        try {
          if (editIdx !== null) {
            const existing = records[editIdx];
            if (existing && existing.id) {
              await updateItemMaster(userUid, String(existing.id), { 
                itemName: form.itemName, 
                itemCode: form.itemCode 
              });
            }
          } else {
            await addItemMaster(userUid, { 
              itemName: form.itemName, 
              itemCode: form.itemCode 
            });
          }
        } catch (e) {
          console.error('[ItemMaster] Firestore save failed', e);
        }
      } else {
        // Logged out - save to localStorage
        if (editIdx !== null) {
          setRecords((prev) => prev.map((rec, idx) => 
            idx === editIdx ? { ...rec, itemName: form.itemName, itemCode: form.itemCode } : rec
          ));
          setEditIdx(null);
        } else {
          setRecords((prev) => [
            ...prev,
            { ...form, id: Date.now() },
          ]);
        }
      }
      
      setForm({ itemName: '', itemCode: '' });
    })();
  };

  const handleEdit = (idx: number) => {
    setForm(records[idx]);
    setEditIdx(idx);
  };

  const handleDelete = (idx: number) => {
    (async () => {
      const rec = records[idx];
      
      if (userUid && rec && rec.id) {
        // Logged in - delete from Firestore
        try { 
          await deleteItemMaster(userUid, String(rec.id)); 
        } catch (e) { 
          console.error('[ItemMaster] delete failed', e); 
        }
      } else {
        // Logged out - delete from localStorage
        setRecords(records => records.filter((_, i) => i !== idx));
      }
    })();
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
        <button type="submit" style={{ padding: '10px 24px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 500, marginTop: 24 }}>
          {editIdx !== null ? 'Update' : 'Add'}
        </button>
        {editIdx !== null && (
          <button 
            type="button" 
            onClick={() => {
              setForm({ itemName: '', itemCode: '' });
              setEditIdx(null);
            }}
            style={{ padding: '10px 24px', background: '#757575', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 500, marginTop: 24 }}
          >
            Cancel
          </button>
        )}
      </form>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fafbfc' }}>
          <thead>
            <tr>
              {ITEM_MASTER_FIELDS.map((field) => (
                <th key={field.key} style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>{field.label}</th>
              ))}
              <th style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr key={rec.id || idx}>
                {ITEM_MASTER_FIELDS.map((field) => (
                  <td key={field.key} style={{ border: '1px solid #eee', padding: 8 }}>{(rec as any)[field.key]}</td>
                ))}
                <td style={{ border: '1px solid #eee', padding: 8 }}>
                  <button 
                    onClick={() => handleEdit(idx)}
                    style={{ 
                      background: '#1976d2', 
                      color: '#fff', 
                      border: 'none', 
                      borderRadius: 4, 
                      padding: '4px 12px', 
                      cursor: 'pointer',
                      marginRight: '8px'
                    }}
                  >
                    Edit
                  </button>
                  <button 
                    onClick={() => handleDelete(idx)}
                    style={{ 
                      background: '#e53935', 
                      color: '#fff', 
                      border: 'none', 
                      borderRadius: 4, 
                      padding: '4px 12px', 
                      cursor: 'pointer' 
                    }}
                  >
                    Delete
                  </button>
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