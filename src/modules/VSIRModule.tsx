import React, { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { subscribePsirs } from '../utils/psirService';
import { subscribeVSIRRecords, addVSIRRecord, updateVSIRRecord, deleteVSIRRecord, subscribeVendorDepts, getItemMaster, getVendorIssues, subscribePurchaseData, subscribePurchaseOrders } from '../utils/firestoreServices';
import bus from '../utils/eventBus';

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

const VSIRModule: React.FC = () => {
  const [formData, setFormData] = useState<{ itemName: string }>({ itemName: '' });
  const [records, setRecords] = useState<VSRIRecord[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
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
  const [itemNames, setItemNames] = useState<string[]>([]);
  const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [vendorDeptOrders, setVendorDeptOrders] = useState<any[]>([]);
  const [vendorIssues, setVendorIssues] = useState<any[]>([]);
  const [purchaseData, setPurchaseData] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [psirData, setPsirData] = useState<any[]>([]);
  const [userUid, setUserUid] = useState<string | null>(null);
  
  // Track existing PO+ItemCode combinations to prevent duplicates during import
  const existingCombinationsRef = useRef<Set<string>>(new Set());

  // Ref to track previous records to prevent unnecessary re-renders
  const prevRecordsRef = useRef<VSRIRecord[]>([]);

  // Helper: create a composite key for deduplication
  const makeKey = (poNo: string, itemCode: string) => `${String(poNo).trim().toLowerCase()}|${String(itemCode).trim().toLowerCase()}`;

  // Helper: deduplicate VSIR records by poNo+itemCode (keep latest occurrence)
  const deduplicateVSIRRecords = (arr: VSRIRecord[]): VSRIRecord[] => {
    const map = new Map<string, VSRIRecord>();
    for (const rec of arr) {
      const key = makeKey(rec.poNo, rec.itemCode);
      map.set(key, rec); // always keep the latest occurrence
    }
    return Array.from(map.values());
  };

  // Initialize component - set isInitialized to true on mount
  useEffect(() => {
    setIsInitialized(true);
  }, []);

    // Subscribe to Firestore and load master data when authenticated
    useEffect(() => {
      const unsubAuth = onAuthStateChanged(auth, (u) => {
        const uid = u ? u.uid : null;
        setUserUid(uid);
        if (!uid) return;

        // subscribe to VSIR records
        const unsubVSIR = subscribeVSIRRecords(uid, (docs) => {
          try {
            const dedupedDocs = deduplicateVSIRRecords(docs.map(d => ({ ...d })) as VSRIRecord[]);
            // Always update records to ensure latest values are held
            prevRecordsRef.current = dedupedDocs;
            setRecords(dedupedDocs);
          } catch (e) { console.error('[VSIR] Error mapping vsir docs', e); }
        });

        // subscribe to vendorDept orders
        const unsubVendorDepts = subscribeVendorDepts(uid, (docs) => {
          setVendorDeptOrders(docs || []);
        });

        // subscribe to PSIR records from Firestore
        const unsubPsirs = subscribePsirs(uid, (docs) => {
          console.debug('[VSIR] PSIR records updated:', docs.length, 'records');
          setPsirData(docs || []);
        });

        // subscribe to purchaseData in real-time (for auto-import)
        const unsubPurchaseData = subscribePurchaseData(uid, (docs) => {
          console.log('[VSIR] ✅ Purchase data subscription updated:', docs.length, 'records');
          if (docs.length > 0) {
            console.log('[VSIR] First purchase data entry:', docs[0]);
            setPurchaseData(docs || []);
          } else {
            setPurchaseData([]);
          }
        });
  // Auto-delete all VSIR records if purchaseData is empty
  useEffect(() => {
    const runAutoDelete = async () => {
      if (!userUid || typeof userUid !== 'string') {
        console.log('[VSIR][DEBUG] Auto-delete not triggered: userUid is missing or invalid.', userUid);
        return;
      }
      if (!Array.isArray(purchaseData) || !Array.isArray(records)) {
        console.log('[VSIR][DEBUG] Auto-delete not triggered: purchaseData or records is not an array.', purchaseData, records);
        return;
      }
      if (purchaseData.length === 0 && records.length > 0) {
        console.log('[VSIR][DEBUG] Triggering auto-delete: userUid=', userUid, 'purchaseData.length=', purchaseData.length, 'records.length=', records.length);
        alert('[VSIR][DEBUG] Attempting to auto-delete all VSIR records because purchaseData is empty. See console for details.');
        for (const rec of records) {
          try {
            if (!rec || !rec.id) {
              console.log('[VSIR][DEBUG] Skipping invalid record:', rec);
              continue;
            }
            console.log('[VSIR][DEBUG] Attempting to delete VSIR record:', rec);
            await deleteVSIRRecord(userUid, String(rec.id));
            console.log('[VSIR][DEBUG] Successfully auto-deleted VSIR record:', rec.id);
            alert('[VSIR][DEBUG] Successfully auto-deleted VSIR record: ' + rec.id);
          } catch (e) {
            const errMsg = (e && typeof e === 'object' && 'message' in e) ? (e as any).message : String(e);
            alert('[VSIR][DEBUG] Failed to auto-delete VSIR record: ' + rec.id + '\nError: ' + errMsg);
            console.error('[VSIR][DEBUG] Failed to auto-delete VSIR record:', rec.id, e);
          }
        }
      } else {
        console.log('[VSIR][DEBUG] Auto-delete not triggered. userUid:', userUid, 'purchaseData.length:', purchaseData.length, 'records.length:', records.length);
      }
    };
    runAutoDelete();
  }, [userUid, purchaseData]);


        // subscribe to purchaseOrders in real-time (alternative source)
        const unsubPurchaseOrders = subscribePurchaseOrders(uid, (docs) => {
          console.log('[VSIR] ✅ Purchase orders subscription updated:', docs.length, 'records');
          if (docs.length > 0) {
            console.log('[VSIR] First purchase order entry:', docs[0]);
          }
          setPurchaseOrders(docs || []);
        });

        // load one-time master collections
        (async () => {
          try {
            const items = await getItemMaster(uid);
            setItemMaster((items || []) as any[]);
            setItemNames((items || []).map((i: any) => i.itemName).filter(Boolean));
          } catch (e) { console.error('[VSIR] getItemMaster failed', e); }
          try { const vi = await getVendorIssues(uid); setVendorIssues(vi || []); } catch (e) { console.error('[VSIR] getVendorIssues failed', e); }
        })();

        // cleanup when signed out or component unmount
        return () => {
          try { if (unsubVSIR) unsubVSIR(); } catch {}
          try { if (unsubVendorDepts) unsubVendorDepts(); } catch {}
          try { if (unsubPsirs) unsubPsirs(); } catch {}
          try { if (unsubPurchaseData) unsubPurchaseData(); } catch {}
          try { if (unsubPurchaseOrders) unsubPurchaseOrders(); } catch {}
        };
      });

      return () => { try { unsubAuth(); } catch {} };
  }, []);

  // Update the existing combinations ref whenever records change
  useEffect(() => {
    existingCombinationsRef.current = new Set(
      records.map(r => `${String(r.poNo).trim().toLowerCase()}|${String(r.itemCode).trim().toLowerCase()}`)
    );
    console.log('[VSIR] Updated dedup cache with', existingCombinationsRef.current.size, 'combinations');
  }, [records]);

  // Auto-fill Indent No from PSIR for all records that have poNo but missing indentNo
  // PSIR data is already subscribed in the auth effect above, just use it here
  useEffect(() => {
    if (!isInitialized || records.length === 0 || psirData.length === 0) {
      return;
    }

    console.log('[VSIR] Auto-filling Indent No from Firestore PSIRs');
    let updated = false;
    const updatedRecords = records.map(record => {
      if (record.poNo && (!record.indentNo || record.indentNo.trim() === '')) {
        for (const psir of psirData) {
          if (psir.poNo && psir.poNo.toString().trim() === record.poNo.toString().trim()) {
            const indentNo = psir.indentNo || '';
            if (indentNo && indentNo !== record.indentNo) {
              updated = true;
              return { ...record, indentNo };
            }
            break;
          }
        }
      }
      return record;
    });

    if (updated) {
      setRecords(updatedRecords);
      // Persist the auto-filled indentNo to Firestore
      if (userUid) {
        updatedRecords.forEach(async (rec) => {
          if (rec.id) {
            try {
              await updateVSIRRecord(userUid, String(rec.id), rec);
            } catch (err) {
              console.error('[VSIR] Error persisting auto-filled indentNo:', err);
            }
          }
        });
      }
    }
  }, [isInitialized, psirData]);

  // Persist records and dispatch events
  useEffect(() => {
    if (!isInitialized) {
      return;
    }
    console.log('[VSIR-DEBUG] Records changed - VSIR persistence handled by Firestore subscriptions and explicit writes');
    try {
      bus.dispatchEvent(new CustomEvent('vsir.updated', { detail: { records } }));
    } catch (err) {
      console.error('[VSIR] Error dispatching vsir.updated event:', err);
    }
  }, [records, isInitialized]);

  // Sync vendor batch from VendorDept on update
  useEffect(() => {
    const syncVendorBatchFromDept = () => {
      try {
        console.log('[VSIR-DEBUG] ========== SYNC CHECK ==========');
        const vendorDepts = vendorDeptOrders || [];
        if (!vendorDepts || vendorDepts.length === 0) {
          console.log('[VSIR-DEBUG] No vendorDeptData found for sync');
          return;
        }
        console.log('[VSIR-DEBUG] VendorDept records:', vendorDepts.map((vd: any) => ({ po: vd.materialPurchasePoNo, vendorBatchNo: vd.vendorBatchNo })));
        console.log('[VSIR-DEBUG] Current VSIR records:', records.map(r => ({ poNo: r.poNo, vendorBatchNo: r.vendorBatchNo, invoiceDcNo: r.invoiceDcNo, itemCode: r.itemCode })));
        
        let updated = false;
        const updatedRecords = records.map(record => {
          const hasEmptyVendorBatchNo = !record.vendorBatchNo || !String(record.vendorBatchNo).trim();
          const hasPoNo = !!record.poNo;
          // ONLY sync vendorBatchNo if invoiceDcNo is manually entered (prerequisite check)
          const hasInvoiceDcNo = record.invoiceDcNo && String(record.invoiceDcNo).trim();
          console.log(`[VSIR-DEBUG] Record ${record.poNo || 'NO-PO'}: hasEmptyVendorBatchNo=${hasEmptyVendorBatchNo}, hasPoNo=${hasPoNo}, hasInvoiceDcNo=${hasInvoiceDcNo}`);
          
          if (hasEmptyVendorBatchNo && hasPoNo && hasInvoiceDcNo) {
            const match = vendorDepts.find((vd: any) => {
              const poMatch = String(vd.materialPurchasePoNo || '').trim() === String(record.poNo || '').trim();
              console.log(`[VSIR-DEBUG]   Comparing: "${vd.materialPurchasePoNo}" === "${record.poNo}" ? ${poMatch}`);
              return poMatch;
            });
            
            if (match?.vendorBatchNo) {
              console.log(`[VSIR-DEBUG] ✓ SYNC: Found match for PO ${record.poNo}, Invoice/DC No present, syncing vendorBatchNo: ${match.vendorBatchNo}`);
              updated = true;
              return { ...record, vendorBatchNo: match.vendorBatchNo };
            } else {
              console.log(`[VSIR-DEBUG] ✗ No matching VendorDept record found for PO ${record.poNo}`);
            }
          } else if (!hasInvoiceDcNo && hasEmptyVendorBatchNo) {
            console.log(`[VSIR-DEBUG] ✗ Skipping vendorBatchNo sync - Invoice/DC No not entered yet`);
          }
          return record;
        });
        
        if (updated) {
          console.log('[VSIR-DEBUG] ✓ Records updated, persisting');
          console.log('[VSIR-DEBUG] Updated records:', updatedRecords.map(r => ({ poNo: r.poNo, vendorBatchNo: r.vendorBatchNo, invoiceDcNo: r.invoiceDcNo })));
          setRecords(updatedRecords);
        } else {
          console.log('[VSIR-DEBUG] No records needed updating');
        }
        console.log('[VSIR-DEBUG] ==============================');
      } catch (err) {
        console.error('[VSIR][SyncVendorBatch] Error:', err);
      }
    };

    const handleVendorDeptUpdate = (event: any) => {
      console.log('[VSIR-DEBUG] vendorDept.updated event received, event.detail:', event?.detail);
      syncVendorBatchFromDept();
    };
    bus.addEventListener('vendorDept.updated', handleVendorDeptUpdate);
    console.log('[VSIR-DEBUG] Calling syncVendorBatchFromDept on mount');
    syncVendorBatchFromDept();

    return () => {
      bus.removeEventListener('vendorDept.updated', handleVendorDeptUpdate);
    };
  }, [records]);

  // Auto-fill Indent No from PSIR when PO No changes
  useEffect(() => {
    if (!itemInput.poNo) {
      return;
    }

    try {
      const psirs = psirData || [];
      if (!Array.isArray(psirs) || psirs.length === 0) {
        console.log('[VSIR] No PSIR data found for indent auto-fill');
        return;
      }

      console.log('[VSIR] Looking for PO No:', itemInput.poNo, 'in PSIR data');
      for (const psir of psirs) {
        if (psir.poNo && psir.poNo.toString().trim() === itemInput.poNo.toString().trim()) {
          const indentNo = psir.indentNo || '';
          console.log('[VSIR] Found PSIR record with PO No:', itemInput.poNo, 'Indent No:', indentNo);
          setItemInput(prev => ({ ...prev, indentNo }));
          return;
        }
      }
      console.log('[VSIR] No matching PSIR record found for PO No:', itemInput.poNo);
    } catch (e) {
      console.error('[VSIR] Error auto-filling indent no:', e);
    }
  }, [itemInput.poNo]);

  // Auto-import from purchaseData (Firebase only - NO localStorage)
  // Reusable import routine so manual and automatic can share the same logic
  // Helpers to robustly detect PO number and item arrays from various purchase shapes
  const getOrderPoNo = (order: any) => {
    if (!order || typeof order !== 'object') return undefined;
    const candidates = ['poNo', 'materialPurchasePoNo', 'po_no', 'poNumber', 'purchasePoNo', 'poNumberStr'];
    for (const k of candidates) {
      if (order[k]) return order[k];
    }
    // fallback: any key that looks like "po" and contains non-empty value
    for (const k of Object.keys(order)) {
      if (/po/i.test(k) && order[k]) return order[k];
    }
    return undefined;
  };

  const looksLikeItem = (obj: any) => {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj).map(k => k.toLowerCase());
    return keys.includes('itemcode') || keys.includes('item_name') || keys.includes('itemname') || keys.includes('model') || keys.includes('code') || keys.includes('name');
  };

  const getOrderItems = (order: any) => {
    if (!order || typeof order !== 'object') return [];
    // If the order itself looks like a single item object, treat it as a one-item list
    if (looksLikeItem(order)) return [order];
    // common field names for arrays of items
    const itemKeys = ['items', 'materials', 'products', 'lines', 'orderItems', 'itemsList'];
    for (const k of itemKeys) {
      if (Array.isArray(order[k]) && order[k].length > 0) return order[k];
    }
    // fallback: scan all values for the first array of item-like objects
    for (const v of Object.values(order)) {
      if (Array.isArray(v) && v.length > 0 && looksLikeItem(v[0])) return v;
    }
    // last resort: if order itself is an array-like container
    if (Array.isArray(order) && order.length > 0 && looksLikeItem(order[0])) return order;
    return [];
  };

  const runImport = async (providedSource?: any[]) => {
    if (!userUid) {
      console.log('[VSIR] Manual import skipped: no userUid');
      return;
    }

    const sourceData = providedSource ?? ((Array.isArray(purchaseOrders) && purchaseOrders.length > 0) ? purchaseOrders : purchaseData);

    if (!Array.isArray(sourceData) || sourceData.length === 0) {
      console.log('[VSIR] Manual import skipped: no source data available');
      return;
    }

    console.log('[VSIR] ========== RUN IMPORT ==========');
    console.log('[VSIR] Using source:', Array.isArray(purchaseOrders) && purchaseOrders.length > 0 ? 'purchaseOrders' : 'purchaseData');
    console.log('[VSIR] userUid:', userUid);
    console.log('[VSIR] Current VSIR records:', records.length);
    console.log('[VSIR] Source data entries:', sourceData.length);

    try {
      // Use ref for dedup to ensure we have current combinations even if records state is stale
      const currentCombinations = existingCombinationsRef.current;
      console.log('[VSIR] Dedup cache has', currentCombinations.size, 'combinations');
      let importCount = 0;

      for (let orderIdx = 0; orderIdx < sourceData.length; orderIdx++) {
        const order: any = sourceData[orderIdx];
        const poNo = getOrderPoNo(order);
        console.log(`[VSIR] Processing order ${orderIdx}: poNo=${poNo}`);
        if (!poNo) { console.log('[VSIR]  skipping: no PO number'); continue; }

        const items = getOrderItems(order);
        if (!Array.isArray(items) || items.length === 0) { console.log('[VSIR]  skipping: no items (checked multiple keys)'); continue; }

        const vendorDeptMatch = vendorDeptOrders.find((v: any) => (v.materialPurchasePoNo || '').toString().trim() === poNo.toString().trim());
        const oaNo = vendorDeptMatch?.oaNo || '';
        const batchNo = vendorDeptMatch?.batchNo || '';

        for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
          const item = items[itemIdx];
          const itemCode = item.itemCode || '';
          const dedupeKey = `${String(poNo).trim().toLowerCase()}|${String(itemCode).trim().toLowerCase()}`;
          
          // Skip if this PO+Item combination already exists (check against current ref, not stale state)
          if (currentCombinations.has(dedupeKey)) {
            console.log(`[VSIR]  skipping duplicate: ${dedupeKey}`);
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
            itemCode: itemCode,
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
            console.log('[VSIR]   ✅ imported', dedupeKey);
          } catch (err) {
            console.error('[VSIR]   ❌ failed to import', dedupeKey, err);
          }
        }
      }

      console.log('[VSIR] Import complete. total imported:', importCount);
    } catch (e) {
      console.error('[VSIR] Error running import:', e);
    }
  };

  // Automatic run when data or auth changes
  useEffect(() => {
    runImport();
  }, [purchaseOrders, purchaseData, vendorDeptOrders, userUid]);

  // Fill missing OA/Batch from PSIR/VendorDept (once)
  useEffect(() => {
    if (records.length === 0) {
      console.log('[VSIR-DEBUG] Fill missing effect: no records');
      return;
    }
    try {
      console.log('[VSIR-DEBUG] Fill missing effect: processing', records.length, 'records');
      const psirs = psirData || [];
      const vendorDepts = vendorDeptOrders || [];
      const vendorIssuesList = vendorIssues || [];

      let updated = false;
      const updatedRecords = records.map(record => {
        if ((!record.oaNo || !record.purchaseBatchNo) && record.poNo) {
          let oaNo = record.oaNo;
          let batchNo = record.purchaseBatchNo;

          if (!oaNo || !batchNo) {
            const psirMatch = psirs.find((p: any) => p.poNo === record.poNo);
            if (psirMatch) {
              oaNo = oaNo || psirMatch.oaNo || '';
              batchNo = batchNo || psirMatch.batchNo || '';
            }
          }

          if ((!oaNo || !batchNo) && vendorDepts.length) {
            const deptMatch = vendorDepts.find((v: any) => v.materialPurchasePoNo === record.poNo);
            if (deptMatch) {
              oaNo = oaNo || deptMatch.oaNo || '';
              batchNo = batchNo || deptMatch.batchNo || '';
            }
          }

          if ((!oaNo || !batchNo) && vendorIssuesList.length) {
            const issueMatch = vendorIssuesList.find((vi: any) => vi.materialPurchasePoNo === record.poNo);
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

        if (updated) {
        console.log('[VSIR-DEBUG] Fill missing: updated records, calling setRecords');
        setRecords(updatedRecords);
      } else {
        console.log('[VSIR-DEBUG] Fill missing: no updates needed');
      }
    } catch (e) {
      console.error('[VSIR][FillMissing] Error:', e);
    }
  }, []);

  // Auto-fill when PO changes
  useEffect(() => {
    if (!itemInput.poNo) return;

    let oaNo = '';
    let batchNo = '';
    let vendorName = '';

    // From VendorDept
    const deptMatch = (vendorDeptOrders || []).find((v: any) => v.materialPurchasePoNo === itemInput.poNo);
    if (deptMatch) {
      oaNo = deptMatch.oaNo || '';
      batchNo = deptMatch.batchNo || '';
      vendorName = deptMatch.vendorName || '';
    }

    // Fallback to PSIR
    if ((!oaNo || !batchNo) && itemInput.poNo) {
      const psirs = psirData || [];
      const psirMatch = Array.isArray(psirs) && psirs.find((p: any) => p.poNo === itemInput.poNo);
      if (psirMatch) {
        oaNo = oaNo || psirMatch.oaNo || '';
        batchNo = batchNo || psirMatch.batchNo || '';
      }
    }

    // Fallback to VendorIssue
    if ((!oaNo || !batchNo || !vendorName) && itemInput.poNo) {
      const issues = vendorIssues || [];
      const issueMatch = Array.isArray(issues) && issues.find((vi: any) => vi.materialPurchasePoNo === itemInput.poNo);
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
      // dcNo is MANUAL ENTRY - don't override user input
      vendorName: vendorName || prev.vendorName,
    }));
  }, [itemInput.poNo, vendorDeptOrders]);

  // Auto-fill when itemCode changes
  useEffect(() => {
    if (!itemInput.itemCode) return;
    try {
      const issues = vendorIssues || [];
      if (!issues || !issues.length) return;
      let source: any = null;

      if (itemInput.poNo) {
        source = issues.find((v: any) => String(v.materialPurchasePoNo).trim() === String(itemInput.poNo).trim());
      } else {
        source = issues.find((v: any) =>
          Array.isArray(v.items) && v.items.some((it: any) => String(it.itemCode).trim() === String(itemInput.itemCode).trim())
        );
      }

      if (source) {
        setItemInput(prev => ({
          ...prev,
          receivedDate: prev.receivedDate || source.date || prev.receivedDate,
          poNo: prev.poNo || source.materialPurchasePoNo || prev.poNo,
          // dcNo and invoiceDcNo are MANUAL ENTRY - don't auto-populate
          vendorName: prev.vendorName || source.vendorName || prev.vendorName,
        }));
      }
    } catch {}
  }, [itemInput.itemCode]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (name === 'itemName') {
      setFormData({ itemName: value });
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

  const generateVendorBatchNo = (): string => {
    const yy = String(new Date().getFullYear()).slice(2);
    let maxNum = 0;

    try {
      // Check VSIR records
      (records || []).forEach(r => {
        const match = (r as any).vendorBatchNo?.match?.(new RegExp(`${yy}/V(\\d+)`));
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      });

      // Check VendorDept
      (vendorDeptOrders || []).forEach((d: any) => {
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

    // Try VendorDept
    try {
      const match = (vendorDeptOrders || []).find((d: any) => d.materialPurchasePoNo === poNo);
      if (match?.vendorBatchNo) return match.vendorBatchNo;
    } catch {}

    // Try VendorIssue
    try {
      const match = (vendorIssues || []).find((i: any) => i.materialPurchasePoNo === poNo);
      if (match?.vendorBatchNo) return match.vendorBatchNo;
    } catch {}

    return ''; // not found
  };

  const handleEdit = (idx: number) => {
    const record = records[idx];
    let edited = { ...record };

    if (!edited.vendorBatchNo?.trim() && edited.poNo) {
      let vb = getVendorBatchNoForPO(edited.poNo);
      if (!vb) vb = generateVendorBatchNo();
      edited.vendorBatchNo = vb;
    }

    setItemInput(edited);
    setFormData({ itemName: edited.itemName });
    setEditIdx(idx);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let finalItemInput = { ...itemInput };

    // Vendor Batch No should ONLY be populated if invoiceDcNo is manually entered (prerequisite)
    const hasInvoiceDcNo = finalItemInput.invoiceDcNo && String(finalItemInput.invoiceDcNo).trim();
    
    if (hasInvoiceDcNo && !finalItemInput.vendorBatchNo?.trim() && finalItemInput.poNo) {
      let vb = getVendorBatchNoForPO(finalItemInput.poNo);
      if (!vb) {
        console.log('[VSIR] Vendor Batch No not found in VendorDept for PO:', finalItemInput.poNo, '- leaving empty for manual entry or sync');
        vb = '';
      }
      finalItemInput.vendorBatchNo = vb;
      console.log('[VSIR] ✓ Invoice/DC No entered, vendorBatchNo set to:', vb);
    } else if (!hasInvoiceDcNo && !finalItemInput.vendorBatchNo?.trim()) {
      console.log('[VSIR] ✗ Invoice/DC No not entered, vendorBatchNo will remain empty');
      finalItemInput.vendorBatchNo = '';
    }

    if (hasInvoiceDcNo && !finalItemInput.vendorBatchNo?.trim()) {
      alert('⚠️ Vendor Batch No could not be determined from VendorDept. Please save a VendorDept order for this PO first.');
      return;
    }

    // Add or update record in local state
    let updatedRecords: VSRIRecord[];
    const key = makeKey(finalItemInput.poNo, finalItemInput.itemCode);
    const existingIdx = records.findIndex(r => makeKey(r.poNo, r.itemCode) === key);
    if (existingIdx !== -1) {
      // Update existing
      updatedRecords = [...records];
      // Use the Firestore ID if present
      const firestoreId = records[existingIdx].id;
      updatedRecords[existingIdx] = { ...records[existingIdx], ...finalItemInput, id: firestoreId };
      setRecords(deduplicateVSIRRecords(updatedRecords));
      // Persist to Firestore
      if (userUid && firestoreId) {
        try {
          await updateVSIRRecord(userUid, String(firestoreId), { ...records[existingIdx], ...finalItemInput, id: firestoreId });
        } catch (err) {
          console.error('[VSIR] Error persisting VSIR to Firestore:', err);
        }
      }
    } else {
      // Add new: use Firestore-generated ID
      if (userUid) {
        try {
          const firestoreId = await addVSIRRecord(userUid, { ...finalItemInput });
          if (firestoreId) {
            const newRecord = { ...finalItemInput, id: firestoreId };
            updatedRecords = deduplicateVSIRRecords([...records, newRecord]);
            setRecords(updatedRecords);
          } else {
            // fallback: just add with a random string id
            const newRecord = { ...finalItemInput, id: Math.random().toString(36).slice(2) };
            updatedRecords = deduplicateVSIRRecords([...records, newRecord]);
            setRecords(updatedRecords);
          }
        } catch (err) {
          console.error('[VSIR] Error persisting VSIR to Firestore:', err);
        }
      } else {
        // Not logged in: just add with a random string id
        const newRecord = { ...finalItemInput, id: Math.random().toString(36).slice(2) };
        updatedRecords = deduplicateVSIRRecords([...records, newRecord]);
        setRecords(updatedRecords);
      }
    }
    // Do NOT reset form after submit, so values are held
  };

  return (
    <div>
      <h2>VSRI Module</h2>
      
      {/* Diagnostic Panel removed as requested */}
          <div>
            <strong>Purchase Orders:</strong> {purchaseOrders.length} records
            {purchaseOrders.length > 0 && (
              <div style={{ fontSize: 10, marginTop: 4, background: '#fff', padding: 4, borderRadius: 2, maxHeight: 80, overflow: 'auto' }}>
                {purchaseOrders.slice(0, 2).map((po, idx) => (
                  <div key={idx}>
                    PO: {po.poNo || po.materialPurchasePoNo} | Items: {po.items?.length || 0}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <strong>Purchase Data:</strong> {purchaseData.length} records
            {purchaseData.length > 0 && (
              <div style={{ fontSize: 10, marginTop: 4, background: '#fff', padding: 4, borderRadius: 2, maxHeight: 80, overflow: 'auto' }}>
                {purchaseData.slice(0, 2).map((pd, idx) => (
                  <div key={idx}>
                    PO: {pd.poNo} | Items: {pd.items?.length || 0}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <strong>VSIR Records:</strong> {records.length} imported
          </div>
          <div>
            <strong>User ID:</strong> {userUid ? '✅ Logged in' : '❌ Not logged in'}
          </div>
        </div>
        {purchaseOrders.length === 0 && purchaseData.length === 0 && (
          <p style={{ margin: '8px 0 0 0', color: '#856404' }}>
            ⚠️ No purchase data found. Please add purchase orders first.
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        {VSRI_MODULE_FIELDS.map((field) => (
          <div key={field.key} style={{ flex: '1 1 200px', minWidth: 180 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>{field.label}</label>
            {field.key === 'itemName' && itemNames.length > 0 ? (
              <select
                name="itemName"
                value={formData.itemName}
                onChange={handleChange}
                style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #bbb' }}
              >
                <option value="">Select Item Name</option>
                {itemNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type}
                name={field.key}
                value={(itemInput as any)[field.key]}
                onChange={handleChange}
                style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #bbb' }}
              />
            )}
          </div>
        ))}
        <button type="submit" style={{ padding: '10px 24px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 500, marginTop: 24 }}>
          {editIdx !== null ? 'Update' : 'Add'}
        </button>
      </form>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', border: '1px solid #ccc', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#fff', borderBottom: '2px solid #333', fontWeight: 'bold' }}>
              {VSRI_MODULE_FIELDS.map((field) => (
                <th key={field.key} style={{ padding: '10px 8px', textAlign: 'left', borderRight: '1px solid #ccc' }}>{field.label}</th>
              ))}
              <th style={{ padding: '10px 8px', textAlign: 'center' }}>Edit</th>
              <th style={{ padding: '10px 8px', textAlign: 'center' }}>Delete</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr key={rec.id} style={{ borderBottom: '1px solid #ccc', background: '#fff' }}>
                {VSRI_MODULE_FIELDS.map((field) => {
                  const cellCommon: React.CSSProperties = { padding: '10px 8px', borderRight: '1px solid #ccc' };
                  if (field.key === 'dcNo') {
                    return <td key={field.key} style={cellCommon}>{rec.dcNo}</td>;
                  }
                  if (field.key === 'vendorBatchNo') {
                    const vendorBatchNo = rec.vendorBatchNo || getVendorBatchNoForPO(rec.poNo) || '';
                    return <td key={field.key} style={cellCommon}>{vendorBatchNo}</td>;
                  }
                  return <td key={field.key} style={cellCommon}>{(rec as any)[field.key]}</td>;
                })}
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                  <button
                    style={{
                      background: '#1976d2',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 2,
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontSize: 11
                    }}
                    onClick={() => handleEdit(idx)}
                  >
                    Edit
                  </button>
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                  <button
                    onClick={() => {
                      const toDelete = records[idx];
                      if (!toDelete) {
                        console.error('[VSIR] No record found to delete at index', idx);
                        return;
                      }

                      console.log('[VSIR] Deleting record:', toDelete);

                      if (userUid && toDelete && toDelete.id) {
                        deleteVSIRRecord(userUid, String(toDelete.id))
                          .then(() => {
                            console.log('[VSIR] Successfully deleted from Firestore:', toDelete.id);
                            // Remove from local state after successful Firestore delete
                            setRecords(prev => prev.filter(r => r.id !== toDelete.id));
                          })
                          .catch((e) => {
                            console.error('[VSIR] deleteVSIRRecord failed:', e, 'Record ID:', toDelete.id);
                            alert('Failed to delete record from Firestore. Please check your permissions and network.\nError: ' + (e && e.message ? e.message : e));
                          });
                      } else {
                        // No userUid, just remove from state
                        setRecords(prev => prev.filter(r => r.id !== toDelete.id));
                      }
                    }}
                    style={{
                      background: '#e53935',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 2,
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontSize: 11
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

export default VSIRModule;