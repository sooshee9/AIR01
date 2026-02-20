// NOTE: localStorage-based helpers were removed — StockModule now uses Firestore-only state
import React, { useState, useEffect } from "react";
import bus from '../utils/eventBus';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { subscribeStockRecords, addStockRecord, updateStockRecord, deleteStockRecord, subscribePurchaseOrders, subscribeVendorIssues, subscribeVendorDepts, subscribeVSIRRecords, getItemMaster } from '../utils/firestoreServices';
import { subscribePsirs } from '../utils/psirService';

interface StockRecord {
  id: number;
  itemName: string;
  itemCode: string;
  batchNo: string;
  stockQty: number;
  indentQty: number;
  purchaseQty: number;
  vendorQty: number;
  purStoreOkQty: number;
  vendorOkQty: number;
  inHouseIssuedQty: number;
  vendorIssuedQty: number;
  closingStock: number;
}

const STOCK_MODULE_FIELDS = [
  { key: "itemName", label: "Item Name", type: "text" },
  { key: "stockQty", label: "Stock Qty", type: "number" },
  { key: "indentQty", label: "Indent Qty", type: "number", readOnly: true },
  { key: "purchaseQty", label: "Purchase Qty", type: "number", readOnly: true },
  { key: "vendorQty", label: "Vendor Qty", type: "number", readOnly: true },
  { key: "purStoreOkQty", label: "Pur Store OK Qty", type: "number", readOnly: true },
  { key: "vendorOkQty", label: "Vendor OK Qty", type: "number", readOnly: true },
  { key: "inHouseIssuedQty", label: "In-House Issued Qty", type: "number" },
  { key: "vendorIssuedQty", label: "Vendor Issued Qty", type: "number" },
  { key: "closingStock", label: "Closing Stock", type: "number" }
];
// NOTE: collection-based helpers (subscribe-backed) are implemented inside component

const defaultItemInput: Omit<StockRecord, "id"> = {
  itemName: "",
  itemCode: "",
  batchNo: "",
  stockQty: 0,
  indentQty: 0,
  purchaseQty: 0,
  vendorQty: 0,
  purStoreOkQty: 0,
  vendorOkQty: 0,
  inHouseIssuedQty: 0,
  vendorIssuedQty: 0,
  closingStock: 0,
};

const StockModule: React.FC = () => {
  const [itemInput, setItemInput] = useState<Omit<StockRecord, "id">>(defaultItemInput);
  const [records, setRecords] = useState<StockRecord[]>([]);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  // item master from Firestore
  // const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [psirsState, setPsirsState] = useState<any[]>([]);
  const [vendorIssuesState, setVendorIssuesState] = useState<any[]>([]);
  const [inHouseIssuesState, setInHouseIssuesState] = useState<any[]>([]);
  const [vendorDeptState, setVendorDeptState] = useState<any[]>([]);
  const [purchaseOrdersState, setPurchaseOrdersState] = useState<any[]>([]);
  const [indentState, setIndentState] = useState<any[]>([]);
  const [vsirRecordsState, setVsirRecordsState] = useState<any[]>([]);
  const [itemMasterState, setItemMasterState] = useState<any[]>([]);
  const [draftPsirItems, setDraftPsirItems] = useState<any[]>([]);
  const [lastPsirEventAt, setLastPsirEventAt] = useState<string>('');
  const [, setLastPsirDetail] = useState<any>(null);
  const [showDebugPanel, setShowDebugPanel] = useState<boolean>(true);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  // Helper: normalization
  const normalize = (s: any) => (s === undefined || s === null ? '' : String(s).trim().toLowerCase());

  // Firestore-backed helper functions (use state populated by subscriptions)
  const getVendorIssuedQtyTotal = (itemCode: string) => {
    try {
      return (vendorIssuesState || []).reduce((total: number, issue: any) => {
        if (Array.isArray(issue.items)) {
          return (
            total +
            issue.items.reduce(
              (sum: number, item: any) => (item.itemCode === itemCode && typeof item.qty === 'number' ? sum + item.qty : sum),
              0
            )
          );
        }
        return total;
      }, 0);
    } catch {
      return 0;
    }
  };



  const getInHouseIssuedQtyByTransactionType = (itemCode: string, transactionType: string) => {
    try {
      return (inHouseIssuesState || []).reduce((total: number, issue: any) => {
        if (Array.isArray(issue.items)) {
          return (
            total +
            issue.items.reduce((sum: number, item: any) => {
              const matches = item.itemCode === itemCode && (item.transactionType === transactionType || transactionType === '*');
              const qty = item.issueQty || item.qty || 0;
              return matches && typeof qty === 'number' ? sum + qty : sum;
            }, 0)
          );
        }
        return total;
      }, 0);
    } catch {
      return 0;
    }
  };

  const getInHouseIssuedQtyByItemName = (itemName: string, itemCode?: string) => {
    try {
      const targetName = normalize(itemName);
      const targetCode = normalize(itemCode);
      return (inHouseIssuesState || []).reduce((total: number, issue: any) => {
        if (Array.isArray(issue.items)) {
          return (
            total +
            issue.items.reduce((sum: number, item: any) => {
              const name = normalize(item.itemName || '');
              const code = normalize(item.itemCode || '');
              const matched = (targetName && name === targetName) || (targetCode && code === targetCode);
              const qty = item.issueQty || item.qty || 0;
              return matched && typeof qty === 'number' ? sum + qty : sum;
            }, 0)
          );
        }
        return total;
      }, 0);
    } catch {
      return 0;
    }
  };

  const getInHouseIssuedQtyByItemNameStockOnly = (itemName: string, itemCode?: string) => {
    try {
      const targetName = normalize(itemName);
      const targetCode = normalize(itemCode);
      return (inHouseIssuesState || []).reduce((total: number, issue: any) => {
        if (Array.isArray(issue.items)) {
          return (
            total +
            issue.items.reduce((sum: number, item: any) => {
              const name = normalize(item.itemName || '');
              const code = normalize(item.itemCode || '');
              const matched = (targetName && name === targetName) || (targetCode && code === targetCode);
              const isStockType = item.transactionType === 'Stock';
              const qty = item.issueQty || item.qty || 0;
              return matched && isStockType && typeof qty === 'number' ? sum + qty : sum;
            }, 0)
          );
        }
        return total;
      }, 0);
    } catch {
      return 0;
    }
  };

  const getVendorDeptQtyTotal = (itemCode: string) => {
    try {
      return (vendorDeptState || []).reduce((total: number, order: any) => {
        if (Array.isArray(order.items)) {
          return (
            total +
            order.items.reduce((sum: number, item: any) => (item.itemCode === itemCode && typeof item.qty === 'number' ? sum + item.qty : sum), 0)
          );
        }
        return total;
      }, 0);
    } catch {
      return 0;
    }
  };

  const getVSIRReceivedQtyTotal = (itemCode: string) => {
    try {
      return (vsirRecordsState || []).reduce((total: number, record: any) => {
        if (record.itemCode === itemCode) {
          const okQty = typeof record.okQty === 'number' ? record.okQty : 0;
          const reworkQty = typeof record.reworkQty === 'number' ? record.reworkQty : 0;
          const rejectQty = typeof record.rejectQty === 'number' ? record.rejectQty : 0;
          return total + okQty + reworkQty + rejectQty;
        }
        return total;
      }, 0);
    } catch {
      return 0;
    }
  };

  const getAdjustedVendorIssuedQty = (itemCode: string) => {
    const vendorIssuedTotal = getVendorIssuedQtyTotal(itemCode) || 0;
    const vsirReceivedTotal = getVSIRReceivedQtyTotal(itemCode) || 0;
    return Math.max(0, vendorIssuedTotal - vsirReceivedTotal);
  };

  const getAdjustedVendorOkQty = (itemCode: string) => {
    const vendorDeptOkQty = getVendorDeptOkQtyTotal(itemCode) || 0;
    const totalInHouseIssuedVendor = getInHouseIssuedQtyByTransactionType(itemCode || '', 'Vendor') || 0;
    return Math.max(0, vendorDeptOkQty - totalInHouseIssuedVendor);
  };



  const getVendorDeptOkQtyTotal = (itemCode: string) => {
    try {
      return (vendorDeptState || []).reduce((total: number, order: any) => {
        if (Array.isArray(order.items)) {
          return (
            total +
            order.items.reduce((sum: number, item: any) => (item.itemCode === itemCode && typeof item.okQty === 'number' ? sum + item.okQty : sum), 0)
          );
        }
        return total;
      }, 0);
    } catch {
      return 0;
    }
  };

  const getIndentQtyTotal = (itemCode: string) => {
    try {
      console.log('[StockModule] Calculating indentQty for itemCode:', itemCode);
      const total = (indentState || []).reduce((total: number, indent: any) => {
        if (Array.isArray(indent.items)) {
          const indentSum = indent.items.reduce((sum: number, item: any) => {
            if (item.itemCode === itemCode && typeof item.qty === 'number') {
              console.log('[StockModule] Adding indent item qty:', item.qty, 'for itemCode:', itemCode);
              return sum + item.qty;
            }
            return sum;
          }, 0);
          return total + indentSum;
        }
        return total;
      }, 0);
      console.log('[StockModule] Total indentQty for', itemCode, ':', total);
      return total;
    } catch (e) {
      console.error('[StockModule] Error calculating indentQty:', e);
      return 0;
    }
  };

  const getPurchaseQtyTotal = (itemCode: string) => {
    try {
      let items: any[] = [];
      (purchaseOrdersState || []).forEach((entry: any) => {
        if (Array.isArray(entry.items)) items = items.concat(entry.items);
        else if (entry.itemCode && typeof entry.qty === 'number') items.push(entry);
      });
      return items.reduce((sum: number, item: any) => (item.itemCode === itemCode && typeof item.qty === 'number' ? sum + item.qty : sum), 0);
    } catch {
      return 0;
    }
  };

  const getPSIROkQtyTotal = (itemName: string, itemCode?: string) => {
    try {
      const targetName = normalize(itemName);
      const targetCode = normalize(itemCode);
      const totalFromPsirs = (psirsState || []).reduce((total: number, psir: any) => {
        if (Array.isArray(psir.items)) {
          return (
            total +
            psir.items.reduce((sum: number, item: any) => {
              const name = normalize(item.itemName || item.Item || '');
              const code = normalize(item.itemCode || item.Code || item.CodeNo || '');
              const okRaw = (item.okQty === undefined || item.okQty === null) ? 0 : Number(item.okQty || 0);
              const qtyReceivedRaw = (item.qtyReceived === undefined || item.qtyReceived === null) ? 0 : Number(item.qtyReceived || 0);
              const ok = okRaw > 0 ? okRaw : qtyReceivedRaw;
              if ((targetName && name === targetName) || (targetCode && code === targetCode)) {
                return sum + ok;
              }
              return sum;
            }, 0)
          );
        }
        return total;
      }, 0);

      const draftTotal = (draftPsirItems || []).reduce((sum: number, it: any) => {
        const name = normalize(it.itemName || it.Item || '');
        const code = normalize(it.itemCode || it.Code || it.CodeNo || '');
        const okRaw = (it.okQty === undefined || it.okQty === null) ? 0 : Number(it.okQty || 0);
        const qtyReceivedRaw = (it.qtyReceived === undefined || it.qtyReceived === null) ? 0 : Number(it.qtyReceived || 0);
        const ok = okRaw > 0 ? okRaw : qtyReceivedRaw;
        if ((targetName && name === targetName) || (targetCode && code === targetCode)) return sum + ok;
        return sum;
      }, 0);

      return totalFromPsirs + draftTotal;
    } catch (e) {
      return 0;
    }
  };

  const getAdjustedPurStoreOkQty = (itemName: string, itemCode?: string, _batchNo?: string) => {
    const psirOkQty = getPSIROkQtyTotal(itemName, itemCode) || 0;
    const totalInHouseIssuedPurchase = getInHouseIssuedQtyByTransactionType(itemCode || '', 'Purchase') || 0;
    const vendorIssuedQty = getVendorIssuedQtyTotal(itemCode || '') || 0;
    return Math.max(0, psirOkQty - totalInHouseIssuedPurchase - vendorIssuedQty);
  };

  // Listen for same-window PSIR updates via the event bus and force re-render
  useEffect(() => {
    const psirHandler = (ev: Event) => {
      try {
        const ce = ev as CustomEvent;
        setLastPsirEventAt(new Date().toISOString());
        setLastPsirDetail((ce && (ce as any).detail) || null);
        const det = (ce && (ce as any).detail) || {};
        if (det.draftItem) {
          setDraftPsirItems(prev => [...prev, det.draftItem]);
        } else if (det.psirs) {
          setDraftPsirItems([]);
        }
      } catch (err) {}
      setRecords(prev => [...prev]);
    };
    try {
      bus.addEventListener('psir.updated', psirHandler as EventListener);
    } catch (err) {}
    return () => { try { bus.removeEventListener('psir.updated', psirHandler as EventListener); } catch (err) {} };
  }, []);

  // Load item master & track auth state; subscribe to Firestore collections when signed in
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      setUserUid(uid);
    });
    return () => { try { unsubAuth(); } catch {} };
  }, []);

  // Subscribe to Firestore stockRecords when user is signed in
  useEffect(() => {
    let unsub: (() => void) | null = null;
    if (userUid) {
      try {
        // subscribe for realtime updates
        unsub = subscribeStockRecords(userUid, (docs: any[]) => {
          // normalize docs into local record shape
          const mapped = docs.map(d => ({
            id: d.id,
            itemName: d.itemName || '',
            itemCode: d.itemCode || '',
            batchNo: d.batchNo || '',
            stockQty: Number(d.stockQty) || 0,
            indentQty: Number(d.indentQty) || 0,
            purchaseQty: Number(d.purchaseQty) || 0,
            vendorQty: Number(d.vendorQty) || 0,
            purStoreOkQty: Number(d.purStoreOkQty) || 0,
            vendorOkQty: Number(d.vendorOkQty) || 0,
            inHouseIssuedQty: Number(d.inHouseIssuedQty) || 0,
            vendorIssuedQty: Number(d.vendorIssuedQty) || 0,
            closingStock: Number(d.closingStock) || 0,
          } as StockRecord));
          setRecords(mapped);
        });
      } catch (err) {
        console.error('[StockModule] subscribeStockRecords error:', err);
      }
    } else {
      // signed out — clear records
      setRecords([]);
    }

    // Also subscribe to dependent collections for calculations
    let unsubPsir: (() => void) | null = null;
    let unsubVendorIssues: (() => void) | null = null;
    let unsubVendorDepts: (() => void) | null = null;
    let unsubPurchaseOrders: (() => void) | null = null;
    let unsubVSIR: (() => void) | null = null;
    let unsubInHouse: (() => void) | null = null;
    let unsubIndent: (() => void) | null = null;

    if (userUid) {
      try {
        unsubPsir = subscribePsirs(userUid, (docs) => setPsirsState(docs));
      } catch {}
      try {
        unsubVendorIssues = subscribeVendorIssues(userUid, (docs) => setVendorIssuesState(docs));
      } catch {}
      try {
        unsubVendorDepts = subscribeVendorDepts(userUid, (docs) => setVendorDeptState(docs));
      } catch {}
      try {
        unsubPurchaseOrders = subscribePurchaseOrders(userUid, (docs) => setPurchaseOrdersState(docs));
      } catch {}
      try {
        unsubVSIR = subscribeVSIRRecords(userUid, (docs) => setVsirRecordsState(docs));
      } catch {}

      // inHouseIssueData, indentData and itemMasterData don't have helpers — subscribe directly
      try {
        const coll = collection(db, 'users', userUid, 'inHouseIssues');
        unsubInHouse = onSnapshot(coll, snap => setInHouseIssuesState(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
      } catch {}
      try {
        const coll2 = collection(db, 'users', userUid, 'indentData');
        unsubIndent = onSnapshot(coll2, snap => setIndentState(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
      } catch {}
      console.log('[StockModule] Auth effect: userUid set to', userUid);
      
      // load one-time master collections (same pattern as VSIR)
      (async () => {
        try {
          const items = await getItemMaster(userUid);
          console.log('[StockModule] ✅ getItemMaster returned:', items?.length || 0, 'items', items);
          setItemMasterState((items || []) as any[]);
        } catch (e) {
          console.error('[StockModule] ❌ getItemMaster failed', e);
          setItemMasterState([]);
        }
      })();
    } else {
      // clear dependent states when signed out
      setPsirsState([]);
      setVendorIssuesState([]);
      setInHouseIssuesState([]);
      setVendorDeptState([]);
      setPurchaseOrdersState([]);
      setIndentState([]);
      setVsirRecordsState([]);
      setItemMasterState([]);
    }

    return () => {
      try { if (unsub) unsub(); } catch {}
      try { if (unsubPsir) unsubPsir(); } catch {}
      try { if (unsubVendorIssues) unsubVendorIssues(); } catch {}
      try { if (unsubVendorDepts) unsubVendorDepts(); } catch {}
      try { if (unsubPurchaseOrders) unsubPurchaseOrders(); } catch {}
      try { if (unsubVSIR) unsubVSIR(); } catch {}
      try { if (unsubInHouse) unsubInHouse(); } catch {}
      try { if (unsubIndent) unsubIndent(); } catch {}
    };
  }, [userUid]);

  // Debug: Log indentState changes
  useEffect(() => {
    console.log('[StockModule] indentState updated:', indentState.length, 'indents');
    if (indentState.length > 0) {
      console.log('[StockModule] Sample indent:', indentState[0]);
    }
  }, [indentState]);

  // Update debug panel when item input changes
  useEffect(() => {
    if (itemInput.itemName || itemInput.itemCode) {
      const psirOkQty = getPSIROkQtyTotal(itemInput.itemName, itemInput.itemCode) || 0;
      const totalInHouseIssuedPurchase = getInHouseIssuedQtyByTransactionType(itemInput.itemCode || "", "Purchase") || 0;
      const vendorIssuedQty = getAdjustedVendorIssuedQty(itemInput.itemCode || "") || 0;
      const purStoreOkQty = Math.max(0, psirOkQty - totalInHouseIssuedPurchase - vendorIssuedQty);

      const vendorDeptOkQty = getVendorDeptOkQtyTotal(itemInput.itemCode || "") || 0;
      const totalInHouseIssuedVendor = getInHouseIssuedQtyByTransactionType(itemInput.itemCode || "", "Vendor") || 0;
      const vendorOkQty = Math.max(0, vendorDeptOkQty - totalInHouseIssuedVendor);

      setDebugInfo({
        itemName: itemInput.itemName,
        itemCode: itemInput.itemCode,
        psirOkQty: psirOkQty,
        totalInHouseIssuedPurchase: totalInHouseIssuedPurchase,
        vendorIssuedQty: vendorIssuedQty,
        purStoreOkQty: purStoreOkQty,
        vendorDeptOkQty: vendorDeptOkQty,
        totalInHouseIssuedVendor: totalInHouseIssuedVendor,
        vendorOkQty: vendorOkQty
      });
    } else {
      setDebugInfo(null);
    }
  }, [itemInput.itemName, itemInput.itemCode, draftPsirItems]);

  // Persist records (no localStorage) — notify other modules
  useEffect(() => {
    try {
      bus.dispatchEvent(new CustomEvent('stock.updated', { detail: { records } }));
    } catch (err) {
      console.error('[StockModule] Error dispatching stock.updated:', err);
    }
  }, [records]);

  // (PSIR helpers implemented above using subscribed state)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (name === "itemName") {
      // value is the itemCode (used as key in dropdown)
      const found = itemMasterState.find((item) => item.itemCode === value);
      console.log('[StockModule] item selected by code:', value, 'found item:', found);
      setItemInput((prev) => ({
        ...prev,
        itemName: found ? found.itemName : "",
        itemCode: found ? found.itemCode : "",
      }));
    } else {
      setItemInput((prev) => ({
        ...prev,
        [name]: type === "number" ? Number(value) : value,
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemInput.itemName) {
      alert("Item Name is required.");
      return;
    }
    // Auto-calculate all fields except itemName/itemCode/stockQty/batchNo
    const vendorIssuedTotal = getVendorIssuedQtyTotal(itemInput.itemCode) || 0;
    const vendorDeptTotal = getVendorDeptQtyTotal(itemInput.itemCode) || 0;
    const vsirReceivedTotal = getVSIRReceivedQtyTotal(itemInput.itemCode) || 0;
    // Subtract VSIR received quantities from vendor issued qty
    const vendorIssuedQtyAdjusted = Math.max(0, vendorIssuedTotal - vsirReceivedTotal);
    // Get adjusted Pur Store OK Qty (subtract in-house issued qty by batch no)
    const purStoreOkQtyAdjusted = getAdjustedPurStoreOkQty(itemInput.itemName, itemInput.itemCode, itemInput.batchNo) || 0;
    const inHouseIssuedStockOnly = getInHouseIssuedQtyByItemNameStockOnly(itemInput.itemName, itemInput.itemCode) || 0;
    const autoRecord = {
      ...itemInput,
      indentQty: getIndentQtyTotal(itemInput.itemCode) || 0,
      purchaseQty: getPurchaseQtyTotal(itemInput.itemCode) || 0,
      vendorQty: Math.max(0, vendorDeptTotal - vendorIssuedTotal), // Deduct issued qty from vendor dept qty
      purStoreOkQty: purStoreOkQtyAdjusted,
      vendorOkQty: getAdjustedVendorOkQty(itemInput.itemCode) || 0,
      inHouseIssuedQty: getInHouseIssuedQtyByItemName(itemInput.itemName, itemInput.itemCode) || 0,
      vendorIssuedQty: vendorIssuedQtyAdjusted,
      closingStock:
        (Number(itemInput.stockQty) || 0)
        + (purStoreOkQtyAdjusted)
        + (getAdjustedVendorOkQty(itemInput.itemCode) || 0)
        - (inHouseIssuedStockOnly),
    };

    console.log('[DEBUG] handleSubmit - Full Payload:', {
      itemInput: itemInput,
      calculations: {
        vendorIssuedTotal,
        vendorDeptTotal,
        vsirReceivedTotal,
        vendorIssuedQtyAdjusted,
        purStoreOkQtyAdjusted
      },
      autoRecord: autoRecord
    });

    if (editIdx !== null) {
      const existing = records[editIdx];
      if (userUid && existing && typeof (existing as any).id === 'string') {
        try {
          await updateStockRecord(userUid, String((existing as any).id), autoRecord);
          setRecords((prev) =>
            prev.map((rec, idx) => (idx === editIdx ? { ...autoRecord, id: rec.id } : rec))
          );
        } catch (err) {
          console.error('[StockModule] Failed to update stock record in Firestore:', err);
        }
      } else {
        // local update
        setRecords((prev) =>
          prev.map((rec, idx) => (idx === editIdx ? { ...autoRecord, id: rec.id } : rec))
        );
      }
      setEditIdx(null);
    } else {
      if (userUid) {
        try {
          const newId = await addStockRecord(userUid, autoRecord);
          setRecords((prev) => [...prev, { ...autoRecord, id: newId } as any]);
        } catch (err) {
          console.error('[StockModule] Failed to add stock record to Firestore:', err);
          // fallback to local
          setRecords((prev) => [...prev, { ...autoRecord, id: Date.now() }]);
        }
      } else {
        setRecords((prev) => [
          ...prev,
          { ...autoRecord, id: Date.now() },
        ]);
      }
    }
    setItemInput(defaultItemInput);
  };

  const handleEdit = (idx: number) => {
    setItemInput(records[idx]);
    setEditIdx(idx);
  };

  const handleDelete = async (idx: number) => {
    const rec = records[idx];
    if (userUid && rec && typeof (rec as any).id === 'string') {
      try {
        await deleteStockRecord(userUid, String((rec as any).id));
        // Don't update local state — let Firestore subscription auto-update
      } catch (err) {
        console.error('[StockModule] Failed to delete stock record from Firestore:', err);
        alert('Failed to delete record. Please try again.');
      }
    } else {
      // Offline fallback: update local state only
      setRecords((prev) => prev.filter((_, i) => i !== idx));
    }
  };

  return (
    <div>
      <h2>Stock Module</h2>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 24 }}>
        {STOCK_MODULE_FIELDS.map((field) => (
          <div key={field.key} style={{ flex: "1 1 200px", minWidth: 180 }}>
            <label style={{ display: "block", marginBottom: 4 }}>{field.label}</label>
            {field.key === "itemName" ? (
              <select
                name="itemName"
                value={itemInput.itemCode}
                onChange={handleChange}
                style={{ width: "100%", padding: 6, borderRadius: 4, border: itemMasterState.length === 0 ? "2px solid red" : "1px solid #bbb" }}
              >
                <option value="">
                  {itemMasterState.length === 0 ? "No items in Item Master" : "Select Item Name"}
                </option>
                {itemMasterState.map((item) => (
                  <option key={item.id || item.itemCode} value={item.itemCode}>
                    {item.itemName} - {item.itemCode}
                  </option>
                ))}
              </select>
            ) : field.key === "indentQty" ? (
              <input
                type="number"
                name="indentQty"
                value={getIndentQtyTotal(itemInput.itemCode) || 0}
                readOnly
                style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #bbb", background: "#eee" }}
              />
            ) : field.key === "purchaseQty" ? (
              <input
                type="number"
                name="purchaseQty"
                value={getPurchaseQtyTotal(itemInput.itemCode) || 0}
                readOnly
                style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #bbb", background: "#eee" }}
              />
            ) : field.key === "vendorQty" ? (
              <input
                type="number"
                name="vendorQty"
                value={Math.max(0, (getVendorDeptQtyTotal(itemInput.itemCode) || 0) - (getVendorIssuedQtyTotal(itemInput.itemCode) || 0))}
                readOnly
                style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #bbb", background: "#eee" }}
              />
            ) : field.key === "purStoreOkQty" ? (
              <input
                type="number"
                name="purStoreOkQty"
                value={getAdjustedPurStoreOkQty(itemInput.itemName, itemInput.itemCode, itemInput.batchNo) || 0}
                readOnly
                style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #bbb", background: "#eee" }}
              />
            ) : field.key === "vendorOkQty" ? (
              <input
                type="number"
                name="vendorOkQty"
                value={getAdjustedVendorOkQty(itemInput.itemCode) || 0}
                readOnly
                style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #bbb", background: "#eee" }}
              />
            ) : field.key === "inHouseIssuedQty" ? (
              <input
                type="number"
                name="inHouseIssuedQty"
                value={getInHouseIssuedQtyByItemName(itemInput.itemName, itemInput.itemCode) || 0}
                readOnly
                style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #bbb", background: "#eee" }}
              />
            ) : field.key === "vendorIssuedQty" ? (
              <input
                type="number"
                name="vendorIssuedQty"
                value={getAdjustedVendorIssuedQty(itemInput.itemCode) || 0}
                readOnly
                style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #bbb", background: "#eee" }}
              />
            ) : field.key === "closingStock" ? (
              <input
                type="number"
                name="closingStock"
                value={
                  (Number(itemInput.stockQty) || 0)
                          + (getAdjustedPurStoreOkQty(itemInput.itemName, itemInput.itemCode, itemInput.batchNo) || 0)
                  + (getAdjustedVendorOkQty(itemInput.itemCode) || 0)
                  - (getInHouseIssuedQtyByItemNameStockOnly(itemInput.itemName, itemInput.itemCode) || 0)
                }
                readOnly
                style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #bbb", background: "#eee" }}
              />
            ) : (
              <input
                type={field.type}
                name={field.key}
                value={(itemInput as any)[field.key] || ""}
                onChange={handleChange}
                required
                readOnly={field.readOnly}
                style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #bbb" }}
              />
            )}
          </div>
        ))}
        <button
          type="submit"
          style={{
            padding: "10px 24px",
            background: "#1a237e",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            fontWeight: 500,
            marginTop: 24,
          }}
        >
          {editIdx !== null ? "Update" : "Add"}
        </button>
      </form>

      <div style={{ marginBottom: 12, padding: 12, background: showDebugPanel ? '#e3f2fd' : '#f5f5f5', border: '2px solid #1976d2', borderRadius: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: '16px' }}>🐛 DEBUG PANEL - Pur Store OK Qty Calculation</strong>
          <button 
            onClick={() => setShowDebugPanel(!showDebugPanel)}
            style={{
              padding: '6px 12px',
              background: '#1976d2',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            {showDebugPanel ? 'Hide' : 'Show'}
          </button>
        </div>

        {showDebugPanel && (
          <div style={{ background: '#fff', padding: 12, borderRadius: 4, border: '1px solid #90caf9' }}>
            {debugInfo ? (
              <div>
                <div style={{ marginBottom: 12, padding: 8, background: '#f3e5f5', borderRadius: 4 }}>
                  <strong>Current Item:</strong> {debugInfo.itemName || '(none)'} [{debugInfo.itemCode || '(none)'}]
                </div>

                <div style={{ marginBottom: 12, padding: 8, background: '#fff3e0', borderRadius: 4 }}>
                  <strong style={{ display: 'block', marginBottom: 4, color: '#f57c00' }}>PSIR OK Qty Calculation:</strong>
                  <div style={{ marginLeft: 16 }}>
                    <div>Total PSIR OK Qty: <strong style={{ color: '#f57c00', fontSize: '16px' }}>{debugInfo.psirOkQty || 0}</strong></div>
                    {debugInfo.psirItems && debugInfo.psirItems.length > 0 && (
                      <details style={{ marginTop: 8 }}>
                        <summary>Breakdown ({debugInfo.psirItems.length} items)</summary>
                        <div style={{ marginLeft: 16, marginTop: 8 }}>
                          {debugInfo.psirItems.map((item: any, idx: number) => (
                            <div key={idx} style={{ padding: 6, background: '#ffe0b2', marginBottom: 4, borderRadius: 4, fontSize: '12px' }}>
                              <div><strong>{item.itemName}</strong> [{item.itemCode}] {item.isDraft ? '(DRAFT)' : ''}</div>
                              <div>okQty: {item.okQty}, qtyReceived: {item.qtyReceived} → Using: <strong>{item.usedValue}</strong></div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>

                <div style={{ marginBottom: 12, padding: 8, background: '#e8f5e9', borderRadius: 4 }}>
                  <strong style={{ display: 'block', marginBottom: 4, color: '#2e7d32' }}>In-House Issued Qty - Transaction Type: "Purchase" (Deduction):</strong>
                  <div style={{ marginLeft: 16 }}>
                    Total In-House Issued (Purchase): <strong style={{ color: '#2e7d32', fontSize: '16px' }}>{debugInfo.totalInHouseIssuedPurchase || 0}</strong>
                  </div>
                </div>

                <div style={{ marginBottom: 12, padding: 8, background: '#ffe0b2', borderRadius: 4 }}>
                  <strong style={{ display: 'block', marginBottom: 4, color: '#e65100' }}>Vendor Issued Qty - From Vendor Issue Module (Deduction):</strong>
                  <div style={{ marginLeft: 16 }}>
                    Total Vendor Issued: <strong style={{ color: '#e65100', fontSize: '16px' }}>{debugInfo.vendorIssuedQty || 0}</strong>
                  </div>
                </div>

                <div style={{ padding: 12, background: '#c8e6c9', borderRadius: 4, border: '2px solid #2e7d32', marginBottom: 12 }}>
                  <strong style={{ display: 'block', marginBottom: 4, color: '#1b5e20', fontSize: '16px' }}>Final Pur Store OK Qty:</strong>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#1b5e20' }}>
                    {debugInfo.psirOkQty || 0} - {debugInfo.totalInHouseIssuedPurchase || 0} - {debugInfo.vendorIssuedQty || 0} = <span style={{ color: '#d32f2f', fontSize: '24px' }}>{debugInfo.purStoreOkQty || 0}</span>
                  </div>
                </div>

                <div style={{ marginBottom: 12, padding: 8, background: '#f3e0f5', borderRadius: 4 }}>
                  <strong style={{ display: 'block', marginBottom: 4, color: '#7b1fa2' }}>Vendor Dept OK Qty - Transaction Type: "Vendor" Deduction:</strong>
                  <div style={{ marginLeft: 16 }}>
                    Vendor Dept OK Qty: <strong style={{ color: '#7b1fa2', fontSize: '16px' }}>{debugInfo.vendorDeptOkQty || 0}</strong>
                    <div style={{ marginTop: 4 }}>In-House Issued (Vendor): <strong style={{ color: '#7b1fa2', fontSize: '16px' }}>{debugInfo.totalInHouseIssuedVendor || 0}</strong></div>
                  </div>
                </div>

                <div style={{ padding: 12, background: '#e1bee7', borderRadius: 4, border: '2px solid #7b1fa2', marginBottom: 12 }}>
                  <strong style={{ display: 'block', marginBottom: 4, color: '#4a148c', fontSize: '16px' }}>Final Vendor OK Qty:</strong>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4a148c' }}>
                    {debugInfo.vendorDeptOkQty || 0} - {debugInfo.totalInHouseIssuedVendor || 0} = <span style={{ color: '#d32f2f', fontSize: '28px' }}>{debugInfo.vendorOkQty || 0}</span>
                  </div>
                </div>

                <div style={{ marginTop: 12, padding: 8, background: '#eceff1', borderRadius: 4, fontSize: '12px' }}>
                  <div>Last psir.updated event: {lastPsirEventAt || '(none)'}</div>
                </div>
              </div>
            ) : (
              <div style={{ color: '#666', fontStyle: 'italic' }}>Enter an item and its values will appear here...</div>
            )}
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fafbfc" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #ddd", padding: 8, background: "#e3e6f3", fontWeight: 600 }}>S.No</th>
              {STOCK_MODULE_FIELDS.map((field) => (
                <th key={field.key} style={{ border: "1px solid #ddd", padding: 8, background: "#e3e6f3" }}>
                  {field.label}
                </th>
              ))}
              <th style={{ border: "1px solid #ddd", padding: 8, background: "#e3e6f3" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr key={rec.id}>
                <td style={{ border: "1px solid #eee", padding: 8 }}>{idx + 1}</td>
                {STOCK_MODULE_FIELDS.map((field) => (
                  <td key={field.key} style={{ border: "1px solid #eee", padding: 8 }}>
                    {field.key === "purStoreOkQty"
                      ? getAdjustedPurStoreOkQty(rec.itemName, rec.itemCode, rec.batchNo)
                      : field.key === "indentQty"
                      ? getIndentQtyTotal(rec.itemCode)
                      : field.key === "purchaseQty"
                      ? getPurchaseQtyTotal(rec.itemCode)
                      : field.key === "vendorQty"
                      ? Math.max(0, (getVendorDeptQtyTotal(rec.itemCode) || 0) - (getVendorIssuedQtyTotal(rec.itemCode) || 0))
                      : field.key === "vendorOkQty"
                      ? getAdjustedVendorOkQty(rec.itemCode)
                      : field.key === "inHouseIssuedQty"
                      ? getInHouseIssuedQtyByItemName(rec.itemName, rec.itemCode)
                      : field.key === "vendorIssuedQty"
                      ? getAdjustedVendorIssuedQty(rec.itemCode)
                      : field.key === "closingStock"
                      ? ((Number(rec.stockQty) || 0)
                          + (getAdjustedPurStoreOkQty(rec.itemName, rec.itemCode, rec.batchNo) || 0)
                          + (getAdjustedVendorOkQty(rec.itemCode) || 0)
                          - (getInHouseIssuedQtyByItemNameStockOnly(rec.itemName, rec.itemCode) || 0))
                      : (rec as any)[field.key]}
                  </td>
                ))}
                <td style={{ border: "1px solid #eee", padding: 8 }}>
                  <button
                    style={{ marginRight: 8, background: "#1976d2", color: "#fff", border: "none", padding: "4px 12px" }}
                    onClick={() => handleEdit(idx)}
                  >
                    Edit
                  </button>
                  <button
                    style={{ background: "#e53935", color: "#fff", border: "none", padding: "4px 12px" }}
                    onClick={() => handleDelete(idx)}
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

export default StockModule;