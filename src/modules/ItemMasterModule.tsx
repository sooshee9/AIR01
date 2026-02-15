import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { getItemMaster, subscribeItemMaster, addItemMaster, updateItemMaster, deleteItemMaster } from '../utils/firestoreServices';

interface ItemMasterRecord {
  id?: string | number;
  itemName: string;
  itemCode: string;
}

const LOCAL_STORAGE_KEY = 'itemMasterData';

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

  // Subscribe to Firestore item master when authenticated; fall back to localStorage when signed out
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const au = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      setUserUid(uid);
      if (!uid) {
        // load from localStorage when logged out
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!saved) {
          setRecords([]);
          return;
        }
        try {
          setRecords(JSON.parse(saved));
        } catch {
          setRecords([]);
        }
        return;
      }

      // load initial and subscribe
      try {
        unsub = subscribeItemMaster(uid, (docs) => {
          setRecords(docs.map(d => ({ id: d.id, itemName: d.itemName, itemCode: d.itemCode })));
        });
      } catch (e) {
        // fallback to one-time fetch
        (async () => {
          try {
            const items = await getItemMaster(uid);
            setRecords(items.map((d: any) => ({ id: d.id, itemName: d.itemName, itemCode: d.itemCode })));
          } catch {
            setRecords([]);
          }
        })();
      }
    });

    return () => {
      try { if (unsub) unsub(); } catch {}
      try { au(); } catch {}
    };
  }, []);

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
        try {
          if (editIdx !== null) {
            const existing = records[editIdx];
            if (existing && existing.id) {
              await updateItemMaster(userUid, String(existing.id), { itemName: form.itemName, itemCode: form.itemCode });
            }
          } else {
            await addItemMaster(userUid, { itemName: form.itemName, itemCode: form.itemCode });
          }
        } catch (e) {
          console.error('[ItemMaster] Firestore save failed', e);
        }
      } else {
        if (editIdx !== null) {
          setRecords((prev) => prev.map((rec, idx) => idx === editIdx ? { ...rec, itemName: form.itemName, itemCode: form.itemCode } : rec));
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

  // Delete handler
  const handleDelete = (idx: number) => {
    (async () => {
      const rec = records[idx];
      if (userUid && rec && rec.id) {
        try { await deleteItemMaster(userUid, String(rec.id)); } catch (e) { console.error('[ItemMaster] delete failed', e); }
      } else {
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
        <button type="submit" style={{ padding: '10px 24px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 500, marginTop: 24 }}>Add</button>
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