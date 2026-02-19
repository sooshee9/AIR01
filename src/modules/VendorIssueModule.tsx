import React, { useState, useEffect } from 'react';
import bus from '../utils/eventBus';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import {
  subscribeVendorIssues,
  addVendorIssue,
  updateVendorIssue,
  deleteVendorIssue,
  subscribeVendorDepts,
  getItemMaster,
  subscribeVSIRRecords,
} from '../utils/firestoreServices';

interface VendorIssueItem {
  itemName: string;
  itemCode: string;
  qty: number;
  indentBy: string;
  inStock: number;
  indentClosed: boolean;
}

interface VendorIssue {
  id?: string;
  date: string;
  materialPurchasePoNo: string;
  oaNo: string;
  batchNo: string;
  vendorBatchNo: string;
  dcNo: string;
  issueNo: string;
  vendorName: string;
  items: VendorIssueItem[];
}

const indentByOptions = ['HKG', 'NGR', 'MDD'];

// VSIR lookup will use subscribed `vsirRecords` state inside the component

function getNextIssueNo(issues: VendorIssue[]) {
  const base = 'ISS-';
  if (issues.length === 0) return base + '01';
  const lastSerial = Math.max(
    ...issues.map(i => {
      const match = i.issueNo.match(/ISS-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })
  );
  return base + String(lastSerial + 1).padStart(2, '0');
}

function getNextDCNo(issues: VendorIssue[]) {
  const prefix = 'Vendor/';
  const nums = issues
    .map(issue => {
      const match = issue.dcNo && issue.dcNo.startsWith(prefix)
        ? parseInt(issue.dcNo.replace(prefix, ''))
        : 0;
      return isNaN(match) ? 0 : match;
    });
  const maxNum = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}${String(maxNum + 1).padStart(2, '0')}`;
}

const VendorIssueModule: React.FC = () => {
  // Move all useState declarations to the very top, before any useEffect
  const [issues, setIssues] = useState<VendorIssue[]>(() => {
    const saved = localStorage.getItem('vendorIssueData');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return parsed.map((issue: any) => ({
        ...issue,
        vendorName: issue.vendorName || '',
        vendorBatchNo: issue.vendorBatchNo || '',
        items: Array.isArray(issue.items) ? issue.items : [],
      }));
    } catch {
      return [];
    }
  });

  // Migrate existing localStorage `vendorIssueData` into Firestore on sign-in
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      if (uid) {
        (async () => {
          try {
            const raw = localStorage.getItem('vendorIssueData');
            if (raw) {
              const arr = JSON.parse(raw || '[]');
              if (Array.isArray(arr) && arr.length > 0) {
                for (const it of arr) {
                  try {
                    const payload = { ...it } as any;
                    if (typeof payload.id !== 'undefined') delete payload.id;
                    const col = collection(db, 'userData', uid, 'vendorIssueData');
                    await addDoc(col, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                  } catch (err) {
                    console.warn('[VendorIssueModule] migration addDoc failed for item', it, err);
                  }
                }
                try { localStorage.removeItem('vendorIssueData'); } catch {}
              }
            }
          } catch (err) {
            console.error('[VendorIssueModule] Migration failed:', err);
          }
        })();
      }
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  const [newIssue, setNewIssue] = useState<VendorIssue>({
    date: '',
    materialPurchasePoNo: '',
    oaNo: '',
    batchNo: '',
    vendorBatchNo: '',
    dcNo: '', // Initialize as empty, will be set by useEffect
    issueNo: getNextIssueNo([]), // Use empty array to avoid referencing issues before init
    vendorName: '',
    items: [],
  });

  const [itemInput, setItemInput] = useState<VendorIssueItem>({
    itemName: '',
    itemCode: '',
    qty: 0,
    indentBy: '',
    inStock: 0,
    indentClosed: false,
  });

  const [itemNames, setItemNames] = useState<string[]>([]);
  const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [vendorDeptOrders, setVendorDeptOrders] = useState<any[]>([]);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [vsirRecords, setVsirRecords] = useState<any[]>([]);
  const [editIssueIdx, setEditIssueIdx] = useState<number | null>(null);

  // Helper: deduplicate Vendor Issues by materialPurchasePoNo (keep first occurrence)
  const deduplicateVendorIssues = (arr: VendorIssue[]): VendorIssue[] => {
    const seen = new Set<string>();
    const deduped: VendorIssue[] = [];
    for (const issue of arr) {
      const key = String(issue.materialPurchasePoNo || '').trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        deduped.push(issue);
      }
    }
    return deduped;
  };

  // Helper: get vendor batch no from subscribed VSIR records
  const getVendorBatchNoFromVSIR = (poNo: any): string => {
    try {
      if (!poNo) return '';
      const poNoNormalized = String(poNo).trim();
      const match = vsirRecords.find((r: any) => String(r.poNo || '').trim() === poNoNormalized && r.vendorBatchNo && String(r.vendorBatchNo).trim());
      return match ? match.vendorBatchNo : '';
    } catch (err) {
      console.debug('[VendorIssueModule] Error getting vendorBatchNo from VSIR (state):', err);
      return '';
    }
  };

  // Debug: Log vendorIssueData and vendorDeptData on mount
  useEffect(() => {
    const vendorIssueRaw = localStorage.getItem('vendorIssueData');
    const vendorDeptRaw = localStorage.getItem('vendorDeptData');
    console.debug('[VendorIssueModule][Debug] vendorIssueData(localStorage):', vendorIssueRaw);
    console.debug('[VendorIssueModule][Debug] vendorDeptData(localStorage):', vendorDeptRaw);
  }, []);

  // Auth + Firestore subscriptions
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => setUserUid(u ? u.uid : null));
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    let unsubIssues: (() => void) | null = null;
    let unsubVendorDepts: (() => void) | null = null;
    let unsubVsir: (() => void) | null = null;

    if (!userUid) {
      // when not authenticated, keep using localStorage (existing behavior)
      return () => {};
    }

    try {
      unsubIssues = subscribeVendorIssues(userUid, (docs) => {
        const mapped = docs.map(d => ({ ...d, items: Array.isArray(d.items) ? d.items : [] }));
        const deduped = deduplicateVendorIssues(mapped as VendorIssue[]);
        setIssues(deduped);
      });
    } catch (err) { console.error('[VendorIssueModule] subscribeVendorIssues failed:', err); }

    try {
      unsubVendorDepts = subscribeVendorDepts(userUid, (docs) => setVendorDeptOrders(docs));
    } catch (err) { console.error('[VendorIssueModule] subscribeVendorDepts failed:', err); }

    try {
      unsubVsir = subscribeVSIRRecords(userUid, (docs) => setVsirRecords(docs));
    } catch (err) { console.error('[VendorIssueModule] subscribeVSIRRecords failed:', err); }

    // Try to prime itemMaster from Firestore
    (async () => {
      try {
        const im = await getItemMaster(userUid);
        if (Array.isArray(im) && im.length > 0) {
          setItemMaster(im as any);
          setItemNames(im.map((it: any) => it.itemName).filter(Boolean));
        }
      } catch (err) { console.error('[VendorIssueModule] getItemMaster failed:', err); }
    })();

    return () => {
      if (unsubIssues) unsubIssues();
      if (unsubVendorDepts) unsubVendorDepts();
      if (unsubVsir) unsubVsir();
    };
  }, [userUid]);

  // Load item master and vendor dept data on mount
  useEffect(() => {
    console.debug('[VendorIssueModule][Debug] issues state:', issues);
    console.debug('[VendorIssueModule][Debug] itemMaster:', itemMaster);
    console.debug('[VendorIssueModule][Debug] itemNames:', itemNames);
    console.debug('[VendorIssueModule][Debug] vendorDeptOrders:', vendorDeptOrders);
    console.debug('[VendorIssueModule][Debug] newIssue:', newIssue);
    console.debug('[VendorIssueModule][Debug] Auto-import effect running...');

    const itemMasterRaw = localStorage.getItem('itemMasterData');
    if (itemMasterRaw) {
      try {
        const parsed = JSON.parse(itemMasterRaw);
        if (Array.isArray(parsed)) {
          setItemMaster(parsed);
          setItemNames(parsed.map((item: any) => item.itemName).filter(Boolean));
        }
      } catch {}
    }

    const vendorDeptRaw = localStorage.getItem('vendorDeptData');
    if (vendorDeptRaw) {
      try {
        const parsed = JSON.parse(vendorDeptRaw);
        setVendorDeptOrders(parsed);
        console.debug('[VendorIssueModule] Loaded vendorDeptOrders on mount:', parsed.map((o: any) => ({
          poNo: o.materialPurchasePoNo,
          vendorName: o.vendorName,
          oaNo: o.oaNo,
          batchNo: o.batchNo
        })));
      } catch {}
    }
  }, []);

  // Listen for vendorDept and VSIR updates to reload vendorDeptOrders
  useEffect(() => {
    const handleVendorDeptUpdate = () => {
      console.log('[VendorIssueModule] ✓ VendorDept data updated event received!');
      const vendorDeptRaw = localStorage.getItem('vendorDeptData');
      if (vendorDeptRaw) {
        try {
          const parsed = JSON.parse(vendorDeptRaw);
          console.log('[VendorIssueModule] Parsed vendorDeptData with count:', parsed.length);
          parsed.forEach((order: any, idx: number) => {
            console.log(`[VendorIssueModule] [${idx}] PO: ${order.materialPurchasePoNo}, VendorName: "${order.vendorName}", OA: ${order.oaNo}`);
          });
          setVendorDeptOrders(parsed);
          console.log('[VendorIssueModule] State updated - vendorDeptOrders will trigger re-render');
        } catch (e) {
          console.error('[VendorIssueModule] Error parsing vendorDeptData:', e);
        }
      } else {
        console.warn('[VendorIssueModule] vendorDeptData not found in localStorage');
      }
    };
    
    const handleVSIRUpdate = () => {
      console.log('[VendorIssueModule] ✓ VSIR data updated event received!');
      // Trigger auto-fill for current PO if we have one
      if (newIssue.materialPurchasePoNo) {
        console.log('[VendorIssueModule] Re-triggering auto-fill due to VSIR update for PO:', newIssue.materialPurchasePoNo);
        // Force a re-render by updating a state variable
        setVendorDeptOrders(prev => [...prev]);
      }
    };

    // Listen to storage changes
    const storageHandler = (e: StorageEvent) => {
      console.log('[VendorIssueModule] Storage event detected for key:', e.key);
      if (e.key === 'vendorDeptData') {
        handleVendorDeptUpdate();
      } else if (e.key === 'vsri-records') {
        handleVSIRUpdate();
      }
    };

    window.addEventListener('storage', storageHandler);
    bus.addEventListener('vendorDept.updated', handleVendorDeptUpdate as EventListener);
    bus.addEventListener('vsir.updated', handleVSIRUpdate as EventListener);
    console.log('[VendorIssueModule] Listeners registered for vendorDept and VSIR updates');

    return () => {
      window.removeEventListener('storage', storageHandler);
      bus.removeEventListener('vendorDept.updated', handleVendorDeptUpdate as EventListener);
      bus.removeEventListener('vsir.updated', handleVSIRUpdate as EventListener);
      console.log('[VendorIssueModule] Listeners removed');
    };
  }, [newIssue.materialPurchasePoNo]);

  // Auto-fill Material Purchase PO No from Vendor Dept
  useEffect(() => {
    if (newIssue.materialPurchasePoNo) return;
    if (vendorDeptOrders.length > 0) {
      const latest = vendorDeptOrders[vendorDeptOrders.length - 1];
      if (latest && latest.materialPurchasePoNo) {
        setNewIssue(prev => ({ ...prev, materialPurchasePoNo: latest.materialPurchasePoNo }));
        console.debug('[VendorIssueModule][AutoFill] Filled Material Purchase PO No:', latest.materialPurchasePoNo);
      }
    }
  }, [vendorDeptOrders, newIssue.materialPurchasePoNo]);

  // Auto-fill items table and date from Vendor Dept when PO No is set
  useEffect(() => {
    if (!newIssue.materialPurchasePoNo || newIssue.items.length > 0) return;
    const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
    if (match && Array.isArray(match.items) && match.items.length > 0) {
      const items = match.items.map((item: any) => ({
        itemName: item.itemName || '',
        itemCode: item.itemCode || '',
        qty: item.qty || 0,
        indentBy: item.indentBy || '',
        inStock: 0,
        indentClosed: false,
      }));
      const today = new Date().toISOString().slice(0, 10);
      setNewIssue(prev => ({ ...prev, items, date: prev.date || today }));
      console.debug('[VendorIssueModule][AutoFill] Filled items and date:', items, today);
    }
  }, [newIssue.materialPurchasePoNo, vendorDeptOrders, newIssue.items.length]);

  // Auto-fill OA No, Batch No, Vendor Name, and DC No when PO No changes
  useEffect(() => {
    if (!newIssue.materialPurchasePoNo) return;
    const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
    console.debug('[VendorIssueModule][Debug] Checking auto-fill for OA No, Batch No, Vendor Name, DC No:', {
      poNo: newIssue.materialPurchasePoNo,
      vendorDeptOrders,
      match,
      currentDcNo: newIssue.dcNo
    });
    
    let oaNoValue = '';
    let batchNoValue = '';
    let vendorBatchNoValue = '';
    let vendorNameValue = '';
    let dcNoValue = '';
    
    // Try to get OA No, Batch No, Vendor Batch No, Vendor Name, and DC No from Vendor Dept
    if (match) {
      oaNoValue = match.oaNo || '';
      batchNoValue = match.batchNo || '';
      vendorBatchNoValue = match.vendorBatchNo || '';
      vendorNameValue = match.vendorName || '';
      dcNoValue = (typeof match.dcNo !== 'undefined' && String(match.dcNo).trim() !== '') ? String(match.dcNo) : '';
      console.debug('[VendorIssueModule][AutoFill] Found values from VendorDept:', { oaNoValue, batchNoValue, vendorBatchNoValue, vendorNameValue, dcNoValue });
    }
    
    // If OA No or Batch No not found, try PSIR data
    if (!oaNoValue || !batchNoValue) {
      try {
        const psirRaw = localStorage.getItem('psirData');
        if (psirRaw) {
          const psirs = JSON.parse(psirRaw);
          if (Array.isArray(psirs)) {
            const psirMatch = psirs.find((p: any) => p.poNo === newIssue.materialPurchasePoNo);
            if (psirMatch) {
              if (!oaNoValue) oaNoValue = psirMatch.oaNo || '';
              if (!batchNoValue) batchNoValue = psirMatch.batchNo || '';
              console.debug('[VendorIssueModule][AutoFill] Found values from PSIR:', { oaNoValue, batchNoValue });
            }
          }
        }
      } catch (e) {
        console.error('[VendorIssueModule] Error reading PSIR:', e);
      }
    }
    
    // If Vendor Batch No not found, try VSIR data
    if (!vendorBatchNoValue) {
      const vsirVendorBatchNo = getVendorBatchNoFromVSIR(newIssue.materialPurchasePoNo);
      if (vsirVendorBatchNo) {
        vendorBatchNoValue = vsirVendorBatchNo;
        console.debug('[VendorIssueModule][AutoFill] Found vendor batch no from VSIR:', vendorBatchNoValue);
      }
    }
    
    setNewIssue(prev => {
      const updated = {
        ...prev,
        oaNo: oaNoValue || prev.oaNo,
        batchNo: batchNoValue || prev.batchNo,
        vendorBatchNo: vendorBatchNoValue || prev.vendorBatchNo,
        vendorName: vendorNameValue || prev.vendorName,
        dcNo: dcNoValue || prev.dcNo
      };
      console.debug('[VendorIssueModule][AutoFill] Updated newIssue state:', updated);
      return updated;
    });
  }, [newIssue.materialPurchasePoNo, vendorDeptOrders]);

  // Sync vendor name and vendor batch no from vendorDeptOrders to existing issues
  useEffect(() => {
    if (issues.length === 0 || vendorDeptOrders.length === 0) return;
    
    let updated = false;
    const updatedIssues = issues.map(issue => {
      const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === issue.materialPurchasePoNo);
      if (match) {
        let needsUpdate = false;
        let newVendorName = issue.vendorName;
        let newVendorBatchNo = issue.vendorBatchNo;
        
        if (!newVendorName && match.vendorName) {
          newVendorName = match.vendorName;
          needsUpdate = true;
        }
        
        if (!newVendorBatchNo && match.vendorBatchNo) {
          newVendorBatchNo = match.vendorBatchNo;
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          updated = true;
          console.debug('[VendorIssueModule][Sync] Updated issue with PO:', issue.materialPurchasePoNo, { newVendorName, newVendorBatchNo });
          return { ...issue, vendorName: newVendorName, vendorBatchNo: newVendorBatchNo };
        }
      }
      return issue;
    });
    
    if (updated) {
      console.debug('[VendorIssueModule][Sync] Syncing vendor info to issues');
      setIssues(updatedIssues);
      if (userUid) {
        (async () => {
          try {
            await Promise.all(updatedIssues.map(async (iss: any) => {
              if (iss.id) await updateVendorIssue(userUid, iss.id, iss);
              else await addVendorIssue(userUid, iss);
            }));
          } catch (err) {
            console.error('[VendorIssueModule] Failed to persist synced vendor info to Firestore:', err);
            try { localStorage.setItem('vendorIssueData', JSON.stringify(updatedIssues)); } catch {}
          }
        })();
      } else {
        try { localStorage.setItem('vendorIssueData', JSON.stringify(updatedIssues)); } catch {}
      }
    }
  }, [vendorDeptOrders]);

  // Auto-add Vendor Issue when PO No, date, and items are filled
  useEffect(() => {
    console.debug('[VendorIssueModule][Debug] Auto-add Vendor Issue check:', {
      newIssue,
      issues,
      vendorDeptOrders
    });
    if (
      newIssue.materialPurchasePoNo &&
      newIssue.date &&
      newIssue.items.length > 0 &&
      !issues.some(issue => issue.materialPurchasePoNo === newIssue.materialPurchasePoNo)
    ) {
      const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
      let autoDcNo = getNextDCNo(issues);
      if (match && typeof match.dcNo !== 'undefined' && String(match.dcNo).trim() !== '') {
        autoDcNo = String(match.dcNo);
        console.debug('[VendorIssueModule][AutoAdd] Using DC No from VendorDept:', autoDcNo);
      } else {
        console.debug('[VendorIssueModule][AutoAdd] Using fallback DC No:', autoDcNo);
      }
      const updated = [...issues, { ...newIssue, dcNo: autoDcNo, issueNo: getNextIssueNo(issues) }];
      setIssues(updated);
      if (userUid) {
        (async () => {
          try {
            const last = updated[updated.length - 1];
            if (last && !last.id) await addVendorIssue(userUid, last);
            // Let subscription refresh the list; keep local UI responsive
          } catch (err) {
            console.error('[VendorIssueModule] Failed to add Vendor Issue to Firestore:', err);
            try { localStorage.setItem('vendorIssueData', JSON.stringify(updated)); } catch {}
          }
        })();
      } else {
        try { localStorage.setItem('vendorIssueData', JSON.stringify(updated)); } catch {}
      }
      clearNewIssue(updated);
      console.debug('[VendorIssueModule][AutoAdd] Auto-added Vendor Issue:', { ...newIssue, dcNo: autoDcNo });
    }
  }, [newIssue, issues, vendorDeptOrders]);

  // Auto-import purchase orders
  useEffect(() => {
    const importPurchaseOrders = () => {
      const purchaseOrdersRaw = localStorage.getItem('purchaseOrders');
      let purchaseEntries = [];
      try {
        purchaseEntries = purchaseOrdersRaw ? JSON.parse(purchaseOrdersRaw) : [];
        console.debug('[VendorIssueModule][AutoImport] Parsed purchaseEntries:', purchaseEntries);
      } catch (err) {
        console.error('[VendorIssueModule][AutoImport] Error parsing purchaseOrders:', err);
      }

      const poGroups: Record<string, any[]> = {};
      purchaseEntries.forEach((entry: any) => {
        if (!entry.poNo) return;
        if (!poGroups[entry.poNo]) poGroups[entry.poNo] = [];
        poGroups[entry.poNo].push(entry);
      });

      const purchasePOs = Object.keys(poGroups);
      const existingPOs = new Set(issues.map(issue => issue.materialPurchasePoNo));
      let added = false;
      const newIssues = [...issues];

      purchasePOs.forEach(poNo => {
        if (!existingPOs.has(poNo)) {
          const group = poGroups[poNo];
          const items = group.map((item: any) => ({
            itemName: item.itemName || item.model || '',
            itemCode: item.itemCode || '',
            qty: item.qty || 0,
            indentBy: item.indentBy || '',
            inStock: 0,
            indentClosed: false,
          }));
          const first = group[0];
          const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === poNo);
          let dcNo = getNextDCNo(newIssues);
          if (match && typeof match.dcNo !== 'undefined' && String(match.dcNo).trim() !== '') {
            dcNo = String(match.dcNo);
            console.debug('[VendorIssueModule][AutoImport] Using DC No from VendorDept:', dcNo);
          } else {
            console.debug('[VendorIssueModule][AutoImport] Using fallback DC No:', dcNo);
          }
          
          // Get OA No and Batch No - prioritize VendorDept, then PSIR
          let autoOaNo = match?.oaNo || '';
          let autoBatchNo = match?.batchNo || '';
          
          // Always try PSIR first for OA No and Batch No since it's the source of truth
          try {
            const psirRaw = localStorage.getItem('psirData');
            if (psirRaw) {
              const psirs = JSON.parse(psirRaw);
              if (Array.isArray(psirs)) {
                const psirMatch = psirs.find((p: any) => p.poNo === poNo);
                if (psirMatch) {
                  console.debug('[VendorIssueModule][AutoImport] Found PSIR record for PO:', poNo, psirMatch);
                  autoOaNo = psirMatch.oaNo || autoOaNo;
                  autoBatchNo = psirMatch.batchNo || autoBatchNo;
                  console.debug('[VendorIssueModule][AutoImport] Set OA No:', autoOaNo, 'Batch No:', autoBatchNo);
                } else {
                  console.debug('[VendorIssueModule][AutoImport] No matching PSIR record for PO:', poNo);
                }
              }
            }
          } catch (e) {
            console.error('[VendorIssueModule][AutoImport] Error reading PSIR:', e);
          }
          
          console.debug('[VendorIssueModule][AutoImport] Final values - OA No:', autoOaNo, 'Batch No:', autoBatchNo);
          
          // Get vendor name and vendor batch no from VendorDept
          let autoVendorName = match?.vendorName || '';
          let autoVendorBatchNo = match?.vendorBatchNo || '';
          
          // If vendor batch no not found in VendorDept, try VSIR
          if (!autoVendorBatchNo) {
            const vsirVendorBatchNo = getVendorBatchNoFromVSIR(poNo);
            if (vsirVendorBatchNo) {
              autoVendorBatchNo = vsirVendorBatchNo;
              console.debug('[VendorIssueModule][AutoImport] Found vendor batch no from VSIR:', autoVendorBatchNo);
            }
          }
          
          console.debug('[VendorIssueModule][AutoImport] Vendor Name:', autoVendorName, 'Vendor Batch No:', autoVendorBatchNo);
          
          newIssues.push({
            date: first?.orderPlaceDate || new Date().toISOString().slice(0, 10),
            materialPurchasePoNo: poNo,
            oaNo: autoOaNo,
            batchNo: autoBatchNo,
            vendorBatchNo: autoVendorBatchNo,
            dcNo,
            issueNo: getNextIssueNo(newIssues),
            vendorName: autoVendorName,
            items,
          });
          added = true;
        }
      });

      if (added) {
        console.debug('[VendorIssueModule][AutoImport] Imported new issues:', newIssues);
        setIssues(newIssues);
        if (userUid) {
          (async () => {
            try {
              await Promise.all(newIssues.map(async (iss: any) => {
                if (iss.id) await updateVendorIssue(userUid, iss.id, iss);
                else await addVendorIssue(userUid, iss);
              }));
            } catch (err) {
              console.error('[VendorIssueModule] Failed to persist imported issues to Firestore:', err);
              try { localStorage.setItem('vendorIssueData', JSON.stringify(newIssues)); } catch {}
            }
          })();
        } else {
          try { localStorage.setItem('vendorIssueData', JSON.stringify(newIssues)); } catch {}
        }
      }
    };

    importPurchaseOrders();
    window.addEventListener('storage', importPurchaseOrders);
    const interval = setInterval(importPurchaseOrders, 1000);
    return () => {
      window.removeEventListener('storage', importPurchaseOrders);
      clearInterval(interval);
    };
  }, [issues, vendorDeptOrders]);

  // Fill missing OA No and Batch No from PSIR for existing issues
  useEffect(() => {
    const psirRaw = localStorage.getItem('psirData');
    if (!psirRaw || issues.length === 0) return;
    
    try {
      const psirs = JSON.parse(psirRaw);
      if (!Array.isArray(psirs)) return;
      
      let updated = false;
      const updatedIssues = issues.map(issue => {
        if ((!issue.oaNo || !issue.batchNo) && issue.materialPurchasePoNo) {
          const psirMatch = psirs.find((p: any) => p.poNo === issue.materialPurchasePoNo);
          if (psirMatch) {
            const newOaNo = issue.oaNo || psirMatch.oaNo || '';
            const newBatchNo = issue.batchNo || psirMatch.batchNo || '';
            if (newOaNo !== issue.oaNo || newBatchNo !== issue.batchNo) {
              console.debug('[VendorIssueModule][FillMissing] Filling OA No and Batch No for PO:', issue.materialPurchasePoNo);
              updated = true;
              return { ...issue, oaNo: newOaNo, batchNo: newBatchNo };
            }
          }
        }
        return issue;
      });
      
      if (updated) {
        console.debug('[VendorIssueModule][FillMissing] Updated issues:', updatedIssues);
        setIssues(updatedIssues);
        if (userUid) {
          (async () => {
            try {
              await Promise.all(updatedIssues.map(async (iss: any) => {
                if (iss.id) await updateVendorIssue(userUid, iss.id, iss);
                else await addVendorIssue(userUid, iss);
              }));
            } catch (err) {
              console.error('[VendorIssueModule] Failed to persist filled missing OA/Batch to Firestore:', err);
              try { localStorage.setItem('vendorIssueData', JSON.stringify(updatedIssues)); } catch {}
            }
          })();
        } else {
          try { localStorage.setItem('vendorIssueData', JSON.stringify(updatedIssues)); } catch {}
        }
      }
    } catch (e) {
      console.error('[VendorIssueModule][FillMissing] Error reading PSIR:', e);
    }
  }, []);

  const handleAddItem = () => {
    if (!itemInput.itemName || !itemInput.itemCode || !itemInput.indentBy || itemInput.qty <= 0) return;
    setNewIssue({ ...newIssue, items: [...newIssue.items, itemInput] });
    setItemInput({ itemName: '', itemCode: '', qty: 0, indentBy: '', inStock: 0, indentClosed: false });
  };

  const clearNewIssue = (updatedIssues: VendorIssue[]) => {
    setNewIssue({
      date: '',
      materialPurchasePoNo: '',
      oaNo: '',
      batchNo: '',
      vendorBatchNo: '',
      dcNo: '',
      issueNo: getNextIssueNo(updatedIssues),
      vendorName: '',
      items: [],
    });
    setItemInput({ itemName: '', itemCode: '', qty: 0, indentBy: '', inStock: 0, indentClosed: false });
  };

  const handleAddIssue = () => {
    if (!newIssue.date || !newIssue.materialPurchasePoNo || newIssue.items.length === 0) return;
    const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
    const dcNo = match && match.dcNo && String(match.dcNo).trim() !== '' ? match.dcNo : getNextDCNo(issues);
    const updated = [...issues, { ...newIssue, dcNo, issueNo: getNextIssueNo(issues) }];
    setIssues(updated);
    if (userUid) {
      (async () => {
        try {
          const last = updated[updated.length - 1];
          if (last && !last.id) await addVendorIssue(userUid, last);
        } catch (err) {
          console.error('[VendorIssueModule] Failed to add Vendor Issue to Firestore:', err);
          try { localStorage.setItem('vendorIssueData', JSON.stringify(updated)); } catch {}
        }
      })();
    } else {
      try { localStorage.setItem('vendorIssueData', JSON.stringify(updated)); } catch {}
    }
    clearNewIssue(updated);
  };

  const handleEditIssue = (idx: number) => {
    const issueToEdit = issues[idx];
    setNewIssue(issueToEdit);
    setEditIssueIdx(idx);
    
    // Populate itemInput with the first item from the issue for editing
    if (issueToEdit.items && issueToEdit.items.length > 0) {
      setItemInput(issueToEdit.items[0]);
    }
  };

  const handleUpdateIssue = () => {
    if (editIssueIdx === null) return;
    
    // If itemInput has been modified, update the first item in the newIssue
    if (newIssue.items.length > 0 && itemInput.itemName) {
      newIssue.items[0] = { ...itemInput };
      console.log('[VendorIssueModule] Updated first item with itemInput:', itemInput);
    }
    
    const match = vendorDeptOrders.find(order => order.materialPurchasePoNo === newIssue.materialPurchasePoNo);
    const dcNo = match && match.dcNo && String(match.dcNo).trim() !== '' ? match.dcNo : issues[editIssueIdx].dcNo;
    const updated = issues.map((issue, idx) =>
      idx === editIssueIdx ? { ...newIssue, dcNo } : issue
    );
    setIssues(updated);
    if (userUid) {
      (async () => {
        try {
          await Promise.all(updated.map(async (iss: any) => {
            if (iss.id) await updateVendorIssue(userUid, iss.id, iss);
            else await addVendorIssue(userUid, iss);
          }));
        } catch (err) {
          console.error('[VendorIssueModule] Failed to persist updated Vendor Issue to Firestore:', err);
          try { localStorage.setItem('vendorIssueData', JSON.stringify(updated)); } catch {}
        }
      })();
    } else {
      try { localStorage.setItem('vendorIssueData', JSON.stringify(updated)); } catch {}
    }
    clearNewIssue(updated);
    setEditIssueIdx(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    console.log('[VendorIssueModule] handleChange:', { name, value, type });
    
    if (name === 'itemName') {
      const found = itemMaster.find(item => item.itemName === value);
      setItemInput(prev => ({
        ...prev,
        itemName: value,
        itemCode: found ? found.itemCode : prev.itemCode,
      }));
    } else if (name === 'qty') {
      const numValue = value === '' ? 0 : parseInt(value, 10);
      console.log('[VendorIssueModule] qty change:', { value, numValue });
      setItemInput(prev => ({
        ...prev,
        qty: numValue,
      }));
    } else if (name === 'indentBy') {
      setItemInput(prev => ({
        ...prev,
        indentBy: value,
      }));
    } else if (name === 'inStock') {
      const numValue = value === '' ? 0 : parseInt(value, 10);
      setItemInput(prev => ({
        ...prev,
        inStock: numValue,
      }));
    } else if (name === 'itemCode') {
      setItemInput(prev => ({
        ...prev,
        itemCode: value,
      }));
    }
  };

  return (
    <div>
      <h2>Vendor Issue Module</h2>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <input
          type="date"
          placeholder="Date"
          value={newIssue.date}
          onChange={e => setNewIssue({ ...newIssue, date: e.target.value })}
        />
        <input
          placeholder="Material Purchase PO No"
          value={newIssue.materialPurchasePoNo}
          onChange={e => setNewIssue({ ...newIssue, materialPurchasePoNo: e.target.value })}
        />
        <input
          placeholder="Vendor Name"
          value={newIssue.vendorName}
          readOnly
          style={{ fontWeight: 'bold', background: '#f0f0f0', width: 150 }}
        />
        <input
          placeholder="OA No"
          value={newIssue.oaNo}
          readOnly
          style={{ fontWeight: 'bold', background: '#f0f0f0', width: 120 }}
        />
        <input
          placeholder="Batch No"
          value={newIssue.batchNo}
          readOnly
          style={{ fontWeight: 'bold', background: '#f0f0f0', width: 120 }}
        />
        <input
          placeholder="Vendor Batch No"
          value={newIssue.vendorBatchNo}
          readOnly
          style={{ fontWeight: 'bold', background: '#f0f0f0', width: 150 }}
        />
        <input
          placeholder="DC No"
          value={newIssue.dcNo}
          readOnly
          style={{ fontWeight: 'bold', background: '#f0f0f0', width: 120 }}
        />
        <input
          placeholder="Issue No"
          value={newIssue.issueNo}
          disabled
          style={{ background: '#eee' }}
        />
      </div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label>Item Name:</label>
        {itemNames.length > 0 ? (
          <select
            name="itemName"
            value={itemInput.itemName}
            onChange={handleChange}
          >
            <option value="">Select Item Name</option>
            {itemNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            name="itemName"
            value={itemInput.itemName}
            onChange={handleChange}
          />
        )}
        <input
          placeholder="Item Code"
          name="itemCode"
          value={itemInput.itemCode}
          onChange={handleChange}
          readOnly={itemNames.length > 0}
        />
        <input
          type="number"
          placeholder="Qty"
          name="qty"
          value={itemInput.qty}
          onChange={handleChange}
        />
        <select
          name="indentBy"
          value={itemInput.indentBy}
          onChange={handleChange}
        >
          <option value="">Indent By</option>
          {indentByOptions.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        <input
          type="number"
          placeholder="In Stock"
          name="inStock"
          value={itemInput.inStock}
          onChange={handleChange}
        />
        <label>
          <input
            type="checkbox"
            checked={itemInput.indentClosed}
            onChange={e => setItemInput({ ...itemInput, indentClosed: e.target.checked })}
          />
          Indent Closed
        </label>
        <button onClick={handleAddItem}>Add Item</button>
      </div>
      {newIssue.items.length > 0 && (
        <table border={1} cellPadding={6} style={{ width: '100%', marginBottom: 16 }}>
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Item Code</th>
              <th>Qty</th>
              <th>Indent By</th>
              <th>In Stock</th>
              <th>Indent Closed</th>
            </tr>
          </thead>
          <tbody>
            {newIssue.items.map((item, idx) => (
              <tr key={idx}>
                <td>{item.itemName}</td>
                <td>{item.itemCode}</td>
                <td>{item.qty}</td>
                <td>{item.indentBy}</td>
                <td>{item.inStock}</td>
                <td>{item.indentClosed ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={editIssueIdx !== null ? handleUpdateIssue : handleAddIssue}>
        {editIssueIdx !== null ? 'Update Vendor Issue' : 'Add Vendor Issue'}
      </button>
      <h3>Vendor Issues</h3>
      <table border={1} cellPadding={6} style={{ width: '100%', marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Vendor Name</th>
            <th>Material Purchase PO No</th>
            <th>OA No</th>
            <th>Batch No</th>
            <th>Vendor Batch No</th>
            <th>DC No</th>
            <th>Issue No</th>
            <th>Item Name</th>
            <th>Item Code</th>
            <th>Qty</th>
            <th>Indent By</th>
            <th>In Stock</th>
            <th>Indent Closed</th>
            <th>Edit</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {issues.length === 0 && (
            <tr><td colSpan={16} style={{ textAlign: 'center', color: '#888' }}>(No issues)</td></tr>
          )}
          {issues.flatMap((issue, idx) =>
            issue.items.map((item, i) => {
              // Always show latest DC No from Vendor Dept if available
              const deptOrder = vendorDeptOrders.find(order => order.materialPurchasePoNo === issue.materialPurchasePoNo);
              const displayDcNo = deptOrder && deptOrder.dcNo && String(deptOrder.dcNo).trim() !== '' ? deptOrder.dcNo : issue.dcNo;
              return (
                <tr key={`${idx}-${i}`}>
                  <td>{issue.date}</td>
                  <td>{issue.vendorName}</td>
                  <td>{issue.materialPurchasePoNo}</td>
                  <td>{issue.oaNo}</td>
                  <td>{issue.batchNo}</td>
                  <td>{issue.vendorBatchNo}</td>
                  <td>{displayDcNo}</td>
                  <td>{issue.issueNo}</td>
                  <td>{item.itemName}</td>
                  <td>{item.itemCode}</td>
                  <td>{item.qty}</td>
                  <td>{item.indentBy}</td>
                  <td>{item.inStock}</td>
                  <td>{item.indentClosed ? 'Yes' : 'No'}</td>
                  <td>
                    <button
                      type="button"
                      style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}
                      onClick={() => handleEditIssue(idx)}
                    >
                      Edit
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        const toDelete = issues[idx];
                        if (!toDelete) {
                          console.error('[VendorIssueModule] No issue found to delete at index', idx);
                          return;
                        }

                        console.log('[VendorIssueModule] Deleting issue:', toDelete);
                        
                        // Delete from Firestore immediately
                        if (userUid && toDelete?.id) {
                          deleteVendorIssue(userUid, toDelete.id)
                            .then(() => {
                              console.log('[VendorIssueModule] Successfully deleted from Firestore:', toDelete.id);
                              // Remove from local state after successful Firestore delete
                              setIssues(prev => prev.filter((_, i) => i !== idx));
                            })
                            .catch((err) => {
                              console.error('[VendorIssueModule] Failed to delete from Firestore:', err, 'Issue ID:', toDelete.id);
                            });
                        } else {
                          // No userUid, just remove from state and localStorage
                          setIssues(prev => {
                            const updated = prev.filter((_, i) => i !== idx);
                            try { localStorage.setItem('vendorIssueData', JSON.stringify(updated)); } catch {}
                            return updated;
                          });
                        }
                      }}
                      style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default VendorIssueModule;