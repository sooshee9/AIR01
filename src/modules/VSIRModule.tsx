import React, { useState, useEffect, useRef, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { subscribePsirs } from '../utils/psirService';
import {
  subscribeVSIRRecords,
  addVSIRRecord,
  updateVSIRRecord,
  deleteVSIRRecord,
  subscribeVendorDepts,
  getItemMaster,
  getVendorIssues,
  subscribePurchaseData,
  subscribePurchaseOrders,
} from '../utils/firestoreServices';
import bus from '../utils/eventBus';

const VSRI_MODULE_FIELDS = [
  { key: 'receivedDate', label: 'Received Date', type: 'date' },
  { key: 'indentNo', label: 'Indent No', type: 'text' },
  { key: 'poNo', label: 'PO No', type: 'text' },
  { key: 'oaNo', label: 'OA No', type: 'text' },
  { key: 'purchaseBatchNo', label: 'Purchase Batch No', type: 'text' },
  { key: 'vendorBatchNo', label: 'Vendor Batch No', type: 'text' },
  { key: 'dcNo', label: 'DC No', type: 'text' },
  { key: 'invoiceDcNo', label: 'Invoice / DC No', type: 'text' },
  { key: 'vendorName', label: 'Vendor Name', type: 'text' },
  { key: 'itemName', label: 'Item Name', type: 'text' },
  { key: 'itemCode', label: 'Item Code', type: 'text' },
  { key: 'qtyReceived', label: 'Qty Received', type: 'number' },
  { key: 'okQty', label: 'OK Qty', type: 'number' },
  { key: 'reworkQty', label: 'Rework Qty', type: 'number' },
  { key: 'rejectQty', label: 'Reject Qty', type: 'number' },
  { key: 'grnNo', label: 'GRN No', type: 'text' },
  { key: 'remarks', label: 'Remarks', type: 'text' },
];

interface VSRIRecord {
  id: string;
  receivedDate: string;
  indentNo: string;
  poNo: string;
  oaNo: string;
  purchaseBatchNo: string;
  vendorBatchNo: string;
  dcNo: string;
  invoiceDcNo: string;
  vendorName: string;
  itemName: string;
  itemCode: string;
  qtyReceived: number;
  okQty: number;
  reworkQty: number;
  rejectQty: number;
  grnNo: string;
  remarks: string;
}

const VSIRModule: React.FC = () => {
  // ---------- State ----------
  const [userUid, setUserUid] = useState<string | null>(null);
  const [records, setRecords] = useState<VSRIRecord[]>([]);
  const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [itemNames, setItemNames] = useState<string[]>([]);
  const [vendorDeptOrders, setVendorDeptOrders] = useState<any[]>([]);
  const [vendorIssues, setVendorIssues] = useState<any[]>([]);
  const [purchaseData, setPurchaseData] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [psirData, setPsirData] = useState<any[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [autoDeleteEnabled, setAutoDeleteEnabled] = useState<boolean>(false);
  const [autoImportEnabled, setAutoImportEnabled] = useState<boolean>(false);
  const [itemInput, setItemInput] = useState<Omit<VSRIRecord, 'id'>>({
    receivedDate: '',
    indentNo: '',
    poNo: '',
    oaNo: '',
    purchaseBatchNo: '',
    vendorBatchNo: '',
    dcNo: '',
    invoiceDcNo: '',
    vendorName: '',
    itemName: '',
    itemCode: '',
    qtyReceived: 0,
    okQty: 0,
    reworkQty: 0,
    rejectQty: 0,
    grnNo: '',
    remarks: '',
  });

  // ---------- Refs ----------
  const existingCombinationsRef = useRef<Set<string>>(new Set());
  const unsubscribersRef = useRef<(() => void)[]>([]);

  // ---------- Helpers ----------
  const makeKey = (poNo: string, itemCode: string) =>
    `${String(poNo).trim().toLowerCase()}|${String(itemCode).trim().toLowerCase()}`;

  const deduplicateVSIRRecords = (arr: VSRIRecord[]): VSRIRecord[] => {
    const map = new Map<string, VSRIRecord>();
    for (const rec of arr) {
      const key = makeKey(rec.poNo, rec.itemCode);
      map.set(key, rec);
    }
    return Array.from(map.values());
  };

  const getOrderPoNo = (order: any) => {
    if (!order || typeof order !== 'object') return undefined;
    const candidates = ['poNo', 'materialPurchasePoNo', 'po_no', 'poNumber', 'purchasePoNo', 'poNumberStr'];
    for (const k of candidates) if (order[k]) return order[k];
    for (const k of Object.keys(order)) if (/po/i.test(k) && order[k]) return order[k];
    return undefined;
  };

  const looksLikeItem = (obj: any) => {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj).map(k => k.toLowerCase());
    return keys.includes('itemcode') || keys.includes('item_name') || keys.includes('itemname') || keys.includes('model');
  };

  const getOrderItems = (order: any) => {
    if (!order || typeof order !== 'object') return [];
    if (looksLikeItem(order)) return [order];
    const itemKeys = ['items', 'materials', 'products', 'lines', 'orderItems', 'itemsList'];
    for (const k of itemKeys) if (Array.isArray(order[k]) && order[k].length > 0) return order[k];
    for (const v of Object.values(order)) if (Array.isArray(v) && v.length > 0 && looksLikeItem(v[0])) return v;
    if (Array.isArray(order) && order.length > 0 && looksLikeItem(order[0])) return order;
    return [];
  };

  const generateVendorBatchNo = (): string => {
    const yy = String(new Date().getFullYear()).slice(2);
    let maxNum = 0;
    try {
      records.forEach(r => {
        const match = r.vendorBatchNo?.match?.(new RegExp(`${yy}/V(\\d+)`));
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      });
      vendorDeptOrders.forEach((d: any) => {
        const match = d.vendorBatchNo?.match?.(new RegExp(`${yy}/V(\\d+)`));
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      });
    } catch (e) {
      console.error('[VSIR] Error in generateVendorBatchNo:', e);
    }
    return `${yy}/V${maxNum + 1}`;
  };

  const getVendorBatchNoForPO = (poNo: string): string => {
    if (!poNo) return '';
    try {
      const match = vendorDeptOrders.find((d: any) => d.materialPurchasePoNo === poNo);
      if (match?.vendorBatchNo) return match.vendorBatchNo;
    } catch {}
    try {
      const match = vendorIssues.find((i: any) => i.materialPurchasePoNo === poNo);
      if (match?.vendorBatchNo) return match.vendorBatchNo;
    } catch {}
    return '';
  };

  // ---------- Cleanup ----------
  const unsubscribeAll = useCallback(() => {
    unsubscribersRef.current.forEach(unsub => {
      try { unsub(); } catch (e) { console.error('[VSIR] Error unsubscribing:', e); }
    });
    unsubscribersRef.current = [];
  }, []);

  // ---------- Authentication & Firestore subscriptions ----------
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      const uid = user ? user.uid : null;
      setUserUid(uid);
      unsubscribeAll();

      if (!uid) {
        setRecords([]);
        setVendorDeptOrders([]);
        setPsirData([]);
        setPurchaseData([]);
        setPurchaseOrders([]);
        setItemMaster([]);
        setItemNames([]);
        setVendorIssues([]);
        return;
      }

      const unsubVSIR = subscribeVSIRRecords(uid, (docs) => {
        try {
          const deduped = deduplicateVSIRRecords(docs.map(d => ({ ...d })) as VSRIRecord[]);
          setRecords(deduped);
        } catch (e) { console.error('[VSIR] Error mapping vsir docs', e); }
      });
      unsubscribersRef.current.push(unsubVSIR);

      const unsubVendorDepts = subscribeVendorDepts(uid, (docs) => setVendorDeptOrders(docs || []));
      unsubscribersRef.current.push(unsubVendorDepts);

      const unsubPsirs = subscribePsirs(uid, (docs) => {
        console.debug('[VSIR] PSIR records updated:', docs.length);
        setPsirData(docs || []);
      });
      unsubscribersRef.current.push(unsubPsirs);

      const unsubPurchaseData = subscribePurchaseData(uid, (docs) => {
        console.log('[VSIR] Purchase data updated:', docs.length);
        setPurchaseData(docs || []);
      });
      unsubscribersRef.current.push(unsubPurchaseData);

      const unsubPurchaseOrders = subscribePurchaseOrders(uid, (docs) => {
        console.log('[VSIR] Purchase orders updated:', docs.length);
        setPurchaseOrders(docs || []);
      });
      unsubscribersRef.current.push(unsubPurchaseOrders);

      (async () => {
        try {
          const items = await getItemMaster(uid);
          // Filter to only valid itemMaster shape, fallback to empty array if none
          const validItems = Array.isArray(items)
            ? items.filter((i: any) => typeof i.itemName === 'string' && typeof i.itemCode === 'string')
            : [];
          setItemMaster(validItems.length ? validItems : []);
          setItemNames(validItems.length ? validItems.map((i: any) => i.itemName).filter(Boolean) : []);
        } catch (e) { console.error('[VSIR] getItemMaster failed', e); }
        try {
          const vi = await getVendorIssues(uid);
          setVendorIssues(vi || []);
        } catch (e) { console.error('[VSIR] getVendorIssues failed', e); }
      })();
    });

    return () => {
      unsubAuth();
      unsubscribeAll();
    };
  }, [unsubscribeAll]);

  // ---------- Update dedup cache ----------
  useEffect(() => {
    existingCombinationsRef.current = new Set(
      records.map(r => makeKey(r.poNo, r.itemCode))
    );
  }, [records]);

  // ---------- Dispatch event ----------
  useEffect(() => {
    try {
      bus.dispatchEvent(new CustomEvent('vsir.updated', { detail: { records } }));
    } catch (err) {
      console.error('[VSIR] Error dispatching vsir.updated event:', err);
    }
  }, [records]);

  // ---------- Auto‑delete (dangerous) ----------
  useEffect(() => {
    if (!autoDeleteEnabled || !userUid) return;
    if (purchaseData.length === 0 && records.length > 0) {
      if (!window.confirm('Auto-delete all VSIR records because purchaseData is empty? This cannot be undone.')) return;
      records.forEach(async (rec) => {
        if (!rec?.id) return;
        try {
          await deleteVSIRRecord(userUid, String(rec.id));
          console.log('[VSIR] Auto-deleted:', rec.id);
        } catch (e) {
          console.error('[VSIR] Auto-delete failed for', rec.id, e);
        }
      });
    }
  }, [userUid, purchaseData, records, autoDeleteEnabled]);

  // ---------- Auto‑import (dangerous) ----------
  const runImport = useCallback(async (providedSource?: any[]) => {
    if (!userUid) return;
    const sourceData = providedSource ?? (purchaseOrders.length ? purchaseOrders : purchaseData);
    if (!sourceData.length) return;

    console.log('[VSIR] Running import from', sourceData.length, 'records');
    const currentCombinations = existingCombinationsRef.current;
    let importCount = 0;

    for (const order of sourceData) {
      const poNo = getOrderPoNo(order);
      if (!poNo) continue;

      const items = getOrderItems(order);
      if (!items.length) continue;

      const vendorDeptMatch = vendorDeptOrders.find(
        v => String(v.materialPurchasePoNo).trim() === String(poNo).trim()
      );
      const oaNo = vendorDeptMatch?.oaNo || '';
      const batchNo = vendorDeptMatch?.batchNo || '';

      for (const item of items) {
        const itemCode = item.itemCode || '';
        const key = makeKey(poNo, itemCode);
        if (currentCombinations.has(key)) {
          console.log('[VSIR] Skipping duplicate:', key);
          continue;
        }

        const newRecord: VSRIRecord = {
          id: Math.random().toString(36).slice(2),
          receivedDate: '',
          indentNo: '',
          poNo,
          oaNo,
          purchaseBatchNo: batchNo,
          vendorBatchNo: '',
          dcNo: '',
          invoiceDcNo: '',
          vendorName: '',
          itemName: item.itemName || item.model || '',
          itemCode,
          qtyReceived: item.qty || 0,
          okQty: 0,
          reworkQty: 0,
          rejectQty: 0,
          grnNo: '',
          remarks: '',
        };

        try {
          await addVSIRRecord(userUid, newRecord);
          importCount++;
          console.log('[VSIR] Imported:', key);
        } catch (err) {
          console.error('[VSIR] Failed to import:', key, err);
        }
      }
    }
    console.log('[VSIR] Import complete. Imported:', importCount);
  }, [userUid, purchaseOrders, purchaseData, vendorDeptOrders]);

  useEffect(() => {
    if (!autoImportEnabled) return;
    if (!window.confirm('Auto-import from purchase data/orders? This may overwrite existing VSIR records.')) return;
    runImport();
  }, [autoImportEnabled, purchaseOrders, purchaseData, vendorDeptOrders, userUid, runImport]);

  // ---------- Auto‑fill Indent No from PSIR ----------
  useEffect(() => {
    if (!userUid || !psirData.length || !records.length) return;
    let updated = false;
    const updatedRecords = records.map(record => {
      if (record.poNo && !record.indentNo) {
        const match = psirData.find(p => String(p.poNo).trim() === String(record.poNo).trim());
        if (match?.indentNo && match.indentNo !== record.indentNo) {
          updated = true;
          return { ...record, indentNo: match.indentNo };
        }
      }
      return record;
    });
    if (updated) {
      setRecords(updatedRecords);
      updatedRecords.forEach(async (rec) => {
        if (!rec.id) return;
        try {
          await updateVSIRRecord(userUid, String(rec.id), rec);
        } catch (err) {
          console.error('[VSIR] Error persisting auto-filled indentNo:', err);
        }
      });
    }
  }, [userUid, psirData, records]);

  // ---------- Sync vendor batch from VendorDept ----------
  useEffect(() => {
    if (!vendorDeptOrders.length) return;
    setRecords(prevRecords => {
      let updated = false;
      const newRecords = prevRecords.map(record => {
        const hasEmptyVendorBatchNo = !record.vendorBatchNo?.trim();
        const hasInvoiceDcNo = record.invoiceDcNo?.trim();
        if (hasEmptyVendorBatchNo && record.poNo && hasInvoiceDcNo) {
          const match = vendorDeptOrders.find(
            v => String(v.materialPurchasePoNo).trim() === String(record.poNo).trim()
          );
          if (match?.vendorBatchNo) {
            updated = true;
            return { ...record, vendorBatchNo: match.vendorBatchNo };
          }
        }
        return record;
      });
      return updated ? newRecords : prevRecords;
    });
  }, [vendorDeptOrders]);

  // ---------- Auto‑fill Indent No in form when PO changes ----------
  useEffect(() => {
    if (!itemInput.poNo || !psirData.length) return;
    const match = psirData.find(p => String(p.poNo).trim() === String(itemInput.poNo).trim());
    if (match?.indentNo) {
      setItemInput(prev => ({ ...prev, indentNo: match.indentNo }));
    }
  }, [itemInput.poNo, psirData]);

  // ---------- Auto‑fill OA/Batch/Vendor in form when PO changes ----------
  useEffect(() => {
    if (!itemInput.poNo) return;
    let oaNo = '';
    let batchNo = '';
    let vendorName = '';

    const deptMatch = vendorDeptOrders.find(v => String(v.materialPurchasePoNo).trim() === String(itemInput.poNo).trim());
    if (deptMatch) {
      oaNo = deptMatch.oaNo || '';
      batchNo = deptMatch.batchNo || '';
      vendorName = deptMatch.vendorName || '';
    }
    if ((!oaNo || !batchNo) && psirData.length) {
      const psirMatch = psirData.find(p => String(p.poNo).trim() === String(itemInput.poNo).trim());
      if (psirMatch) {
        oaNo = oaNo || psirMatch.oaNo || '';
        batchNo = batchNo || psirMatch.batchNo || '';
      }
    }
    if ((!oaNo || !batchNo || !vendorName) && vendorIssues.length) {
      const issueMatch = vendorIssues.find(v => String(v.materialPurchasePoNo).trim() === String(itemInput.poNo).trim());
      if (issueMatch) {
        oaNo = oaNo || issueMatch.oaNo || '';
        batchNo = batchNo || issueMatch.batchNo || '';
        vendorName = vendorName || issueMatch.vendorName || '';
      }
    }

    setItemInput(prev => ({
      ...prev,
      oaNo: oaNo || prev.oaNo,
      purchaseBatchNo: batchNo || prev.purchaseBatchNo,
      vendorName: vendorName || prev.vendorName,
    }));
  }, [itemInput.poNo, vendorDeptOrders, psirData, vendorIssues]);

  // ---------- Auto‑fill when itemCode changes ----------
  useEffect(() => {
    if (!itemInput.itemCode || !vendorIssues.length) return;
    let source: any = null;
    if (itemInput.poNo) {
      source = vendorIssues.find(v => String(v.materialPurchasePoNo).trim() === String(itemInput.poNo).trim());
    } else {
      source = vendorIssues.find(v =>
        Array.isArray(v.items) && v.items.some((it: any) => String(it.itemCode).trim() === String(itemInput.itemCode).trim())
      );
    }
    if (source) {
      setItemInput(prev => ({
        ...prev,
        receivedDate: prev.receivedDate || source.date || prev.receivedDate,
        poNo: prev.poNo || source.materialPurchasePoNo || prev.poNo,
        vendorName: prev.vendorName || source.vendorName || prev.vendorName,
      }));
    }
  }, [itemInput.itemCode, vendorIssues, itemInput.poNo]);

  // ---------- Fill missing OA/Batch (once on mount) ----------
  useEffect(() => {
    if (!records.length || (!psirData.length && !vendorDeptOrders.length && !vendorIssues.length)) return;
    setRecords(prevRecords => {
      let updated = false;
      const newRecords = prevRecords.map(record => {
        if ((!record.oaNo || !record.purchaseBatchNo) && record.poNo) {
          let oaNo = record.oaNo;
          let batchNo = record.purchaseBatchNo;
          if (!oaNo || !batchNo) {
            const psirMatch = psirData.find(p => String(p.poNo).trim() === String(record.poNo).trim());
            if (psirMatch) {
              oaNo = oaNo || psirMatch.oaNo || '';
              batchNo = batchNo || psirMatch.batchNo || '';
            }
          }
          if ((!oaNo || !batchNo) && vendorDeptOrders.length) {
            const deptMatch = vendorDeptOrders.find(v => String(v.materialPurchasePoNo).trim() === String(record.poNo).trim());
            if (deptMatch) {
              oaNo = oaNo || deptMatch.oaNo || '';
              batchNo = batchNo || deptMatch.batchNo || '';
            }
          }
          if ((!oaNo || !batchNo) && vendorIssues.length) {
            const issueMatch = vendorIssues.find(v => String(v.materialPurchasePoNo).trim() === String(record.poNo).trim());
            if (issueMatch) {
              oaNo = oaNo || issueMatch.oaNo || '';
              batchNo = batchNo || issueMatch.batchNo || '';
            }
          }
          if (oaNo !== record.oaNo || batchNo !== record.purchaseBatchNo) {
            updated = true;
            return { ...record, oaNo, purchaseBatchNo: batchNo };
          }
        }
        return record;
      });
      return updated ? newRecords : prevRecords;
    });
  }, []); // run only once

  // ---------- Form handlers ----------
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (name === 'itemName') {
      const found = itemMaster.find(item => item.itemName === value);
      setItemInput(prev => ({
        ...prev,
        itemName: value,
        itemCode: found ? found.itemCode : '',
      }));
    } else {
      setItemInput(prev => ({
        ...prev,
        [name]: type === 'number' ? Number(value) : value,
      }));
    }
  };

  const handleEdit = (idx: number) => {
    const record = records[idx];
    let edited = { ...record };
    if (!edited.vendorBatchNo?.trim() && edited.poNo) {
      edited.vendorBatchNo = getVendorBatchNoForPO(edited.poNo) || generateVendorBatchNo();
    }
    setItemInput(edited);
    setEditIdx(idx);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userUid) {
      alert('You must be logged in.');
      return;
    }

    let finalInput = { ...itemInput };
    const hasInvoiceDcNo = finalInput.invoiceDcNo?.trim();

    if (hasInvoiceDcNo && !finalInput.vendorBatchNo?.trim() && finalInput.poNo) {
      const vb = getVendorBatchNoForPO(finalInput.poNo);
      if (!vb) {
        alert('Vendor Batch No could not be determined from VendorDept. Please save a VendorDept order for this PO first.');
        return;
      }
      finalInput.vendorBatchNo = vb;
    } else if (!hasInvoiceDcNo) {
      finalInput.vendorBatchNo = '';
    }

    try {
      const key = makeKey(finalInput.poNo, finalInput.itemCode);
      const existingIdx = records.findIndex(r => makeKey(r.poNo, r.itemCode) === key);

      if (existingIdx !== -1) {
        const existing = records[existingIdx];
        await updateVSIRRecord(userUid, String(existing.id), { ...existing, ...finalInput });
      } else {
        await addVSIRRecord(userUid, { ...finalInput });
      }
      // Clear form after successful submit (optional)
      // setItemInput({ ...initialState });
      // setEditIdx(null);
    } catch (err) {
      console.error('[VSIR] Submit error:', err);
      alert('Failed to save record. Check console.');
    }
  };

  const handleDelete = async (idx: number) => {
    const record = records[idx];
    if (!record?.id || !userUid) return;
    if (!window.confirm('Delete this record?')) return;

    try {
      await deleteVSIRRecord(userUid, String(record.id));
      setRecords(prev => prev.filter(r => r.id !== record.id));
    } catch (e) {
      console.error('[VSIR] Delete failed:', e);
      alert('Delete failed. Check console.');
    }
  };

  // ---------- Render ----------
  return (
    <div>
      <h2>VSRI Module</h2>
      <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
        <label>
          <input
            type="checkbox"
            checked={autoDeleteEnabled}
            onChange={e => setAutoDeleteEnabled(e.target.checked)}
          />
          Enable Auto-Delete (dangerous)
        </label>
        <label>
          <input
            type="checkbox"
            checked={autoImportEnabled}
            onChange={e => setAutoImportEnabled(e.target.checked)}
          />
          Enable Auto-Import (dangerous)
        </label>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        {VSRI_MODULE_FIELDS.map(field => (
          <div key={field.key} style={{ flex: '1 1 200px', minWidth: 180 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>{field.label}</label>
            {field.key === 'itemName' && itemNames.length > 0 ? (
              <select
                name="itemName"
                value={itemInput.itemName}
                onChange={handleChange}
                style={{ width: '100%', padding: 6 }}
              >
                <option value="">Select Item Name</option>
                {itemNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type}
                name={field.key}
                value={(itemInput as any)[field.key]}
                onChange={handleChange}
                style={{ width: '100%', padding: 6 }}
              />
            )}
          </div>
        ))}
        <button type="submit" style={{ padding: '10px 24px', marginTop: 24 }}>
          {editIdx !== null ? 'Update' : 'Add'}
        </button>
      </form>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#fff', borderBottom: '2px solid #333' }}>
              {VSRI_MODULE_FIELDS.map(field => (
                <th key={field.key} style={{ padding: '10px 8px', textAlign: 'left' }}>{field.label}</th>
              ))}
              <th style={{ padding: '10px 8px' }}>Edit</th>
              <th style={{ padding: '10px 8px' }}>Delete</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr key={rec.id} style={{ borderBottom: '1px solid #ccc' }}>
                {VSRI_MODULE_FIELDS.map(field => (
                  <td key={field.key} style={{ padding: '10px 8px' }}>
                    {field.key === 'vendorBatchNo'
                      ? rec.vendorBatchNo || getVendorBatchNoForPO(rec.poNo) || ''
                      : (rec as any)[field.key]}
                  </td>
                ))}
                <td style={{ padding: '10px 8px' }}>
                  <button onClick={() => handleEdit(idx)}>Edit</button>
                </td>
                <td style={{ padding: '10px 8px' }}>
                  <button onClick={() => handleDelete(idx)} style={{ background: '#e53935', color: '#fff' }}>
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

export default VSIRModule;