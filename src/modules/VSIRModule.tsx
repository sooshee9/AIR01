
import React, { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { subscribePsirs } from '../utils/psirService';
import { subscribeVSIRRecords, addVSIRRecord, updateVSIRRecord, deleteVSIRRecord, subscribeVendorDepts, getItemMaster, getVendorIssues, subscribePurchaseData, subscribePurchaseOrders, updateVendorDept } from '../utils/firestoreServices';
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

interface VendorDeptItem {
  itemName: string;
  itemCode: string;
  materialIssueNo: string;
  qty: number;
  plannedQty?: number;
  closingStock?: number | string;
  indentStatus: string;
  receivedQty: number;
  okQty: number;
  reworkQty: number;
  rejectedQty: number;
  grnNo: string;
  debitNoteOrQtyReturned: string;
  remarks: string;
}

interface VendorDeptOrder {
  id?: string;
  orderPlaceDate: string;
  materialPurchasePoNo: string;
  oaNo: string;
  batchNo: string;
  vendorBatchNo: string;
  dcNo: string;
  vendorName: string;
  items: VendorDeptItem[];
}

interface Field {
  key: keyof Omit<VSRIRecord, 'id'>;
  label: string;
  type: string;
}

const VSRI_MODULE_FIELDS: Field[] = [
  { key: 'receivedDate', label: 'Received Date', type: 'date' },
  { key: 'indentNo', label: 'Indent No', type: 'text' },
  { key: 'poNo', label: 'PO No', type: 'text' },
  { key: 'oaNo', label: 'OA No', type: 'text' },
  { key: 'purchaseBatchNo', label: 'Purchase Batch No', type: 'text' },
  { key: 'vendorBatchNo', label: 'Vendor Batch No', type: 'text' },
  { key: 'dcNo', label: 'DC No', type: 'text' },
  { key: 'invoiceDcNo', label: 'Invoice/DC No', type: 'text' },
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
  const [itemNames, setItemNames] = useState<string[]>([]);
  const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [vendorDeptOrders, setVendorDeptOrders] = useState<VendorDeptOrder[]>([]);
  const [vendorIssues, setVendorIssues] = useState<any[]>([]);
  const [purchaseData, setPurchaseData] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [psirData, setPsirData] = useState<any[]>([]);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [records, setRecords] = useState<VSRIRecord[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  // Robustness toggles (move outside of itemInput)
  const [autoDeleteEnabled, setAutoDeleteEnabled] = useState<boolean>(false);
  const [autoImportEnabled, setAutoImportEnabled] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Debug panel function
  const showDebugPanel = () => {
    console.group('🔍 VSIR DEBUG PANEL');
    console.log('📅 Timestamp:', new Date().toISOString());
    console.log('👤 User UID:', userUid);
    console.log('🔢 Is Initialized:', isInitialized);
    console.log('📝 Is Submitting:', isSubmitting);
    console.log('✏️ Edit Index:', editIdx);
    
    console.group('📋 Current Form State (itemInput)');
    Object.entries(itemInput).forEach(([key, value]) => {
      console.log(`  ${key}:`, value, `(type: ${typeof value})`);
    });
    console.groupEnd();
    
    console.group('🏭 VendorDept Records');
    console.log('Count:', vendorDeptOrders.length);
    vendorDeptOrders.forEach((vd, index) => {
      console.log(`Record ${index + 1}:`, {
        id: vd.id,
        materialPurchasePoNo: vd.materialPurchasePoNo,
        vendorBatchNo: vd.vendorBatchNo,
        allKeys: Object.keys(vd),
        raw: vd
      });
    });
    console.groupEnd();
    
    console.group('📦 VSIR Records');
    console.log('Count:', records.length);
    records.forEach((record, index) => {
      console.log(`Record ${index + 1}:`, {
        id: record.id,
        poNo: record.poNo,
        vendorBatchNo: record.vendorBatchNo,
        invoiceDcNo: record.invoiceDcNo,
        itemCode: record.itemCode,
        hasEmptyVendorBatch: !record.vendorBatchNo || !String(record.vendorBatchNo).trim(),
        raw: record
      });
    });
    console.groupEnd();
    
    console.group('🔄 Sync Analysis');
    let syncableRecords = 0;
    let syncedRecords = 0;
    let failedRecords = 0;
    
    records.forEach((record, index) => {
      const hasEmptyVendorBatchNo = !record.vendorBatchNo || !String(record.vendorBatchNo).trim();
      const hasPoNo = !!record.poNo;
      const hasInvoiceDcNo = record.invoiceDcNo && String(record.invoiceDcNo).trim();
      
      const match = hasPoNo ? vendorDeptOrders.find(vd => 
        String(vd.materialPurchasePoNo || '').trim() === String(record.poNo || '').trim()
      ) : null;
      
      const canSync = hasEmptyVendorBatchNo && hasPoNo && match?.vendorBatchNo;
      
      if (canSync) syncableRecords++;
      if (!hasEmptyVendorBatchNo) syncedRecords++;
      if (hasPoNo && !match) failedRecords++;
      
      console.log(`Record ${index + 1} (${record.poNo || 'NO-PO'}):`, {
        hasEmptyVendorBatchNo,
        hasPoNo,
        hasInvoiceDcNo,
        matchFound: !!match,
        vendorBatchAvailable: match?.vendorBatchNo ? true : false,
        canSync,
        status: canSync ? '🔄 READY TO SYNC' : hasEmptyVendorBatchNo ? '⏳ WAITING' : '✅ SYNCED'
      });
    });
    
    console.log('📊 Sync Summary:', {
      totalRecords: records.length,
      syncableRecords,
      syncedRecords,
      failedRecords,
      vendorDeptRecords: vendorDeptOrders.length
    });
    console.groupEnd();
    
    console.group('⚙️ Module State');
    console.log('Auto Delete Enabled:', autoDeleteEnabled);
    console.log('Auto Import Enabled:', autoImportEnabled);
    console.log('Success Message:', successMessage);
    console.log('Item Names Count:', itemNames.length);
    console.log('Item Master Count:', itemMaster.length);
    console.log('Vendor Issues Count:', vendorIssues.length);
    console.log('Purchase Data Count:', purchaseData.length);
    console.log('Purchase Orders Count:', purchaseOrders.length);
    console.log('PSIR Data Count:', psirData.length);
    console.groupEnd();
    
    console.group('🚨 Recent Errors/Warnings');
    // Add any recent errors here if tracked
    console.log('No recent errors tracked');
    console.groupEnd();
    
    console.groupEnd();
  };

  const initialItemInput: Omit<VSRIRecord, 'id'> = {
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
  };

  const [itemInput, setItemInput] = useState<Omit<VSRIRecord, 'id'>>(initialItemInput);
  const [lastSavedRecord, setLastSavedRecord] = useState<VSRIRecord | null>(null);

  // Debug itemInput changes
  useEffect(() => {
    console.log('[VSIR-DEBUG] itemInput state changed:', itemInput);
  }, [itemInput]);

  // Make debug panel available globally for easy access
  useEffect(() => {
    (window as any).vsirDebug = showDebugPanel;
    console.log('🔧 VSIR Debug Panel available! Run vsirDebug() in console or press Ctrl+Shift+D to view current state.');
    
    // Add keyboard shortcut for debug panel
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        showDebugPanel();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [itemInput, vendorDeptOrders, records, userUid, isInitialized, isSubmitting, editIdx, autoDeleteEnabled, autoImportEnabled, successMessage]);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

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
      const unsubAuth = onAuthStateChanged(auth, (u: User | null) => {
        const uid = u ? u.uid : null;
        setUserUid(uid);
        if (!uid) return;

        // subscribe to VSIR records
        const unsubVSIR = subscribeVSIRRecords(uid, (docs) => {
          try {
            console.log('[VSIR] VSIR subscription received', docs.length, 'raw docs');
            console.log('[VSIR] Raw docs vendorBatchNo:', docs.map(d => ({ id: d.id, poNo: d.poNo, vendorBatchNo: d.vendorBatchNo })));
            const dedupedDocs = deduplicateVSIRRecords(docs.map(d => ({ ...d })) as VSRIRecord[]);
            console.log('[VSIR] After deduplication:', dedupedDocs.length, 'records');
            console.log('[VSIR] Deduped docs vendorBatchNo:', dedupedDocs.map(d => ({ id: d.id, poNo: d.poNo, vendorBatchNo: d.vendorBatchNo })));
            
            // Merge strategy: preserve locally edited qty fields from previous state
            setRecords(prev => {
              if (!prev || prev.length === 0) {
                console.log('[VSIR] No previous state, using fresh docs');
                prevRecordsRef.current = dedupedDocs;
                return dedupedDocs;
              }
              
              // Build map of record IDs to preserve qty values
              const map = new Map(prev.map(r => [r.id, r]));
              
              // Merge: keep locally edited qtys from prev state
              const merged = dedupedDocs.map(doc => ({
                ...doc,
                okQty: map.get(doc.id)?.okQty ?? doc.okQty,
                reworkQty: map.get(doc.id)?.reworkQty ?? doc.reworkQty,
                rejectQty: map.get(doc.id)?.rejectQty ?? doc.rejectQty,
              }));
              
              prevRecordsRef.current = merged;
              console.log('[VSIR] Merged snapshot with preserved qty values');
              console.log('[VSIR] Merged records vendorBatchNo:', merged.map(r => ({ id: r.id, poNo: r.poNo, vendorBatchNo: r.vendorBatchNo })));
              console.log('[VSIR] Setting records state...');
              return merged;
            });
            
            console.log('[VSIR] Records state updated via merge');
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
      if (!autoDeleteEnabled) return;
      if (!userUid || typeof userUid !== 'string') {
        console.log('[VSIR][DEBUG] Auto-delete not triggered: userUid is missing or invalid.', userUid);
        return;
      }
      if (!Array.isArray(purchaseData) || !Array.isArray(records)) {
        console.log('[VSIR][DEBUG] Auto-delete not triggered: purchaseData or records is not an array.', purchaseData, records);
        return;
      }
      if (purchaseData.length === 0 && records.length > 0) {
        if (!window.confirm('Auto-delete all VSIR records because purchaseData is empty? This cannot be undone.')) {
          return;
        }
        console.log('[VSIR][DEBUG] Triggering auto-delete: userUid=', userUid, 'purchaseData.length=', purchaseData.length, 'records.length=', records.length);
        for (const rec of records) {
          try {
            if (!rec || !rec.id) {
              console.log('[VSIR][DEBUG] Skipping invalid record:', rec);
              continue;
            }
            console.log('[VSIR][DEBUG] Attempting to delete VSIR record:', rec);
            await deleteVSIRRecord(userUid, String(rec.id));
            console.log('[VSIR][DEBUG] Successfully auto-deleted VSIR record:', rec.id);
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
  }, [userUid, purchaseData, autoDeleteEnabled]);


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
    const syncVendorBatchFromDept = async () => {
      try {
        console.log('[VSIR-DEBUG] ========== SYNC CHECK ==========');
        const vendorDepts = vendorDeptOrders || [];
        if (!vendorDepts || vendorDepts.length === 0) {
          console.log('[VSIR-DEBUG] No vendorDeptData found for sync');
          return;
        }
        console.log('[VSIR-DEBUG] VendorDept records:', vendorDepts.map((vd: any) => ({ po: vd.materialPurchasePoNo, vendorBatchNo: vd.vendorBatchNo })));
        console.log('[VSIR-DEBUG] Raw VendorDept records:', vendorDepts.map((vd: any) => ({
          id: vd.id,
          materialPurchasePoNo: vd.materialPurchasePoNo,
          vendorBatchNo: vd.vendorBatchNo,
          allKeys: Object.keys(vd)
        })));
        console.log('[VSIR-DEBUG] Current VSIR records:', records.map(r => ({ poNo: r.poNo, vendorBatchNo: r.vendorBatchNo, invoiceDcNo: r.invoiceDcNo, itemCode: r.itemCode })));
        
        let updated = false;
        const updatedRecords = records.map(record => {
          const hasEmptyVendorBatchNo = !record.vendorBatchNo || !String(record.vendorBatchNo).trim();
          const hasPoNo = !!record.poNo;
          // Sync vendorBatchNo if PO No is present (removed invoiceDcNo prerequisite)
          const hasInvoiceDcNo = record.invoiceDcNo && String(record.invoiceDcNo).trim();
          console.log(`[VSIR-DEBUG] Record ${record.poNo || 'NO-PO'}: hasEmptyVendorBatchNo=${hasEmptyVendorBatchNo}, hasPoNo=${hasPoNo}, hasInvoiceDcNo=${hasInvoiceDcNo}`);
          
          if (hasEmptyVendorBatchNo && hasPoNo) {
            const match = vendorDepts.find((vd: any) => {
              const poMatch = String(vd.materialPurchasePoNo || '').trim() === String(record.poNo || '').trim();
              console.log(`[VSIR-DEBUG]   Comparing: "${vd.materialPurchasePoNo}" === "${record.poNo}" ? ${poMatch}`);
              return poMatch;
            });
            
            console.log(`[VSIR-DEBUG]   Match result:`, match ? { po: match.materialPurchasePoNo, vendorBatchNo: match.vendorBatchNo } : 'null');
            
            if (match?.vendorBatchNo) {
              console.log(`[VSIR-DEBUG] ✓ SYNC: Found match for PO ${record.poNo}, syncing vendorBatchNo: ${match.vendorBatchNo}`);
              updated = true;
              return {
                ...record,
                vendorBatchNo: match.vendorBatchNo ?? record.vendorBatchNo,
                okQty: record.okQty,
                reworkQty: record.reworkQty,
                rejectQty: record.rejectQty
              };
            } else {
              console.log(`[VSIR-DEBUG] ✗ No matching VendorDept record found for PO ${record.poNo} (match.vendorBatchNo is falsy)`);
            }
          }
          return record;
        });
        
        if (updated) {
          console.log('[VSIR-DEBUG] ✓ Records updated, persisting');
          console.log('[VSIR-DEBUG] Updated records:', updatedRecords.map(r => ({ poNo: r.poNo, vendorBatchNo: r.vendorBatchNo, invoiceDcNo: r.invoiceDcNo })));
          // Persist each updated record to Firestore
          if (userUid) {
            for (const record of updatedRecords) {
              if (record.id) {
                console.log('[VSIR-DEBUG] Updating VSIR record payload:', { id: record.id, poNo: record.poNo, vendorBatchNo: record.vendorBatchNo });
                await updateVSIRRecord(userUid, record.id, record);
              }
            }
          } else {
            console.log('[VSIR-DEBUG] Cannot persist - user not authenticated');
          }
          console.log('[VSIR-DEBUG] Setting records state with updated records');
          setRecords(updatedRecords);
        } else {
          console.log('[VSIR-DEBUG] No records needed updating');
        }
        
        // Reverse sync: if VSIR has vendorBatchNo and VendorDept doesn't, update VendorDept
        if (userUid) {
          for (const record of records) {
            if (record.vendorBatchNo && record.poNo) {
              const match = vendorDepts.find(vd => String(vd.materialPurchasePoNo || '').trim() === String(record.poNo || '').trim());
              if (match && !match.vendorBatchNo && match.id) {
                console.log(`[VSIR-SYNC] Updating VendorDept ${match.id} with vendorBatchNo: ${record.vendorBatchNo} from VSIR record ${record.id}`);
                const updatePayload = { ...match, vendorBatchNo: record.vendorBatchNo };
                console.log('[VSIR-SYNC] VendorDept update payload:', { id: match.id, poNo: match.materialPurchasePoNo, vendorBatchNo: record.vendorBatchNo });
                await updateVendorDept(userUid, match.id, updatePayload);
              }
            }
          }
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

    // Guard: Don't import if records already exist (prevent overwriting manual edits)
    if (records.length > 0) {
      console.log('[VSIR] Import skipped — records already exist (', records.length, 'records). Use manual import only for initial setup.');
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
    if (!autoImportEnabled) return;
    if (!window.confirm('Auto-import from purchase data/orders? This may overwrite existing VSIR records.')) return;
    runImport();
  }, [purchaseOrders, purchaseData, vendorDeptOrders, userUid, autoImportEnabled]);

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
            return {
              ...record,
              oaNo: oaNo ?? record.oaNo,
              purchaseBatchNo: batchNo ?? record.purchaseBatchNo,
              okQty: record.okQty,
              reworkQty: record.reworkQty,
              rejectQty: record.rejectQty
            };
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
    console.log('[VSIR] handleChange called:', name, '=', value, 'type:', type);

    if (name === 'itemName') {
      const found = itemMaster.find(item => item.itemName === value);
      setItemInput(prev => {
        const newState = {
          ...prev,
          itemName: value,
          itemCode: found ? found.itemCode : '',
        };
        console.log('[VSIR] Updated itemInput (itemName change):', newState);
        return newState;
      });
    } else {
      setItemInput(prev => {
        const newState = {
          ...prev,
          [name]: type === 'number' ? Number(value) : value,
        };
        console.log('[VSIR] Updated itemInput (field change):', newState);
        return newState;
      });
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
    // IMPORTANT: Strip Firestore metadata fields (id, createdAt, updatedAt) 
    // to keep itemInput clean and prevent them from being sent back to Firestore
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...edited } = record as any;

    if (!edited.vendorBatchNo?.trim() && edited.poNo) {
      let vb = getVendorBatchNoForPO(edited.poNo);
      if (!vb) vb = generateVendorBatchNo();
      edited.vendorBatchNo = vb;
    }

    console.log('[VSIR] handleEdit loading record (cleaned):', edited);
    console.log('[VSIR] Excluded Firestore fields - id:', _id, ', createdAt:', _createdAt, ', updatedAt:', _updatedAt);
    setItemInput(edited);
    setEditIdx(idx);
    setLastSavedRecord(record);
  };

  const formRef = useRef<HTMLFormElement>(null);

    const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    console.log('[VSIR] handleSubmit called with itemInput:', itemInput);
    console.log('[VSIR] Current form state before validation:', itemInput);

    // For updates, be more lenient with validation
    const isUpdate = editIdx !== null;
    const requiredFieldsCheck = !itemInput.poNo || !itemInput.itemCode || !itemInput.itemName;
    const dateQtyCheck = isUpdate ? false : (!itemInput.receivedDate || itemInput.qtyReceived === 0);

    if (requiredFieldsCheck || dateQtyCheck) {
      console.log('[VSIR] Validation failed - missing required fields');
      const missing = [];
      if (!itemInput.poNo) missing.push('PO No');
      if (!itemInput.itemCode) missing.push('Item Code');
      if (!itemInput.itemName) missing.push('Item Name');
      if (!isUpdate && !itemInput.receivedDate) missing.push('Received Date');
      if (!isUpdate && itemInput.qtyReceived === 0) missing.push('Qty Received');
      alert(`Required fields missing: ${missing.join(', ')}`);
      return;
    }

    if (!userUid) {
      console.log('[VSIR] Validation failed - user not authenticated');
      alert('User not authenticated');
      return;
    }

    console.log('[VSIR] Validation passed, proceeding with save');
    setIsSubmitting(true);

    try {
      const finalItemInput = { ...itemInput };
      
      // Auto-fill receivedDate if empty
      if (!finalItemInput.receivedDate) {
        finalItemInput.receivedDate = new Date().toISOString().split('T')[0];
        console.log('[VSIR] Auto-filled receivedDate:', finalItemInput.receivedDate);
      }
      const hasInvoiceDcNo = finalItemInput.invoiceDcNo && String(finalItemInput.invoiceDcNo).trim();
      if (hasInvoiceDcNo && !finalItemInput.vendorBatchNo?.trim() && finalItemInput.poNo) {
        let vb = getVendorBatchNoForPO(finalItemInput.poNo);
        if (!vb) vb = '';
        finalItemInput.vendorBatchNo = vb;
        console.log('[VSIR] Updated vendorBatchNo from PO:', vb);
      } else if (!hasInvoiceDcNo) {
        finalItemInput.vendorBatchNo = '';
      }

      console.log('[VSIR] Final data to save:', finalItemInput);

      if (editIdx !== null) {
        console.log('[VSIR] Updating existing record at index:', editIdx);
        const record = records[editIdx];
        if (!record || !record.id) {
          throw new Error('Invalid record for update');
        }
        console.log('[VSIR] Record to update:', record);
        console.log('[VSIR] Updating record:', record.id);
        const updateData = { ...record, ...finalItemInput, id: record.id };
        console.log('[VSIR] Update data being sent:', updateData);
        console.log('[VSIR] Firestore update starting...');
        await updateVSIRRecord(userUid, String(record.id), updateData);
        console.log('[VSIR] Firestore update completed');
        console.log('[VSIR] Update successful');
        setSuccessMessage('Record updated successfully!');
      } else {
        console.log('[VSIR] Adding new record');
        await addVSIRRecord(userUid, finalItemInput);
        console.log('[VSIR] Add successful');
        setSuccessMessage('Record added successfully!');
      }

      // Sync OK Qty to Vendor Dept (for both add and update operations)
      if (finalItemInput.okQty > 0 && finalItemInput.poNo && finalItemInput.itemCode) {
        try {
          const operation = editIdx !== null ? 'UPDATE' : 'ADD';
          console.log(`[VSIR-${operation}] Syncing OK Qty to Vendor Dept:`, {
            poNo: finalItemInput.poNo,
            itemCode: finalItemInput.itemCode,
            okQty: finalItemInput.okQty
          });

          // Find matching Vendor Dept record
          const vendorDeptMatch = vendorDeptOrders.find(vd =>
            String(vd.materialPurchasePoNo || '').trim() === String(finalItemInput.poNo || '').trim()
          );

          if (vendorDeptMatch && vendorDeptMatch.id) {
            // Find matching item within the Vendor Dept record
            const itemIndex = vendorDeptMatch.items?.findIndex((item: VendorDeptItem) =>
              String(item.itemCode || '').trim() === String(finalItemInput.itemCode || '').trim()
            );

            if (itemIndex !== undefined && itemIndex >= 0) {
              // Update the OK Qty for this item
              const updatedItems = [...(vendorDeptMatch.items || [])];
              updatedItems[itemIndex] = {
                ...updatedItems[itemIndex],
                okQty: finalItemInput.okQty
              };

              const updatedVendorDept = {
                ...vendorDeptMatch,
                items: updatedItems
              };

              console.log(`[VSIR-${operation}] Updating Vendor Dept OK Qty:`, {
                vendorDeptId: vendorDeptMatch.id,
                itemIndex,
                newOkQty: finalItemInput.okQty
              });

              await updateVendorDept(userUid, vendorDeptMatch.id, updatedVendorDept);
              console.log(`[VSIR-${operation}] Vendor Dept OK Qty sync successful`);

              // Dispatch event to notify other modules
              bus.dispatchEvent(new CustomEvent('vendorDept.updated', {
                detail: { updatedRecord: updatedVendorDept }
              }));
            } else {
              console.log(`[VSIR-${operation}] No matching item found in Vendor Dept for itemCode:`, finalItemInput.itemCode);
            }
          } else {
            console.log(`[VSIR-${operation}] No matching Vendor Dept record found for PO:`, finalItemInput.poNo);
          }
        } catch (syncError) {
          console.error('[VSIR] Error syncing OK Qty to Vendor Dept:', syncError);
          // Don't fail the whole operation for sync errors
        }
      }
    } catch (e) {
      console.error('[VSIR] Error during save:', e);
      alert('Error: ' + String(e));
    } finally {
      console.log('[VSIR] Save attempt completed');
      setIsSubmitting(false);
      // Don't clear the form - keep values for user convenience
      // setItemInput(initialItemInput);
      setEditIdx(null);
      // Keep the last saved record for display
      // setLastSavedRecord(null);
      if (formRef.current) {
        formRef.current.reset = () => {};
      }
    }
  };

  return (
    <div>
      <h2>VSRI Module</h2>

      {/* Display saved records status */}
      {records.length > 0 && (
        <div style={{
          marginBottom: 16,
          padding: '12px',
          backgroundColor: '#e8f5e9',
          border: '1px solid #4caf50',
          borderRadius: 4,
          color: '#2e7d32',
          fontWeight: 500
        }}>
          ✅ {records.length} record{records.length !== 1 ? 's' : ''} saved in Firestore
        </div>
      )}

      {/* Display last saved record details */}
      {lastSavedRecord && (
        <div style={{
          marginBottom: 16,
          padding: '12px',
          backgroundColor: '#fff3e0',
          border: '2px solid #ff9800',
          borderRadius: 4,
          color: '#e65100'
        }}>
          <strong>Last Saved Record:</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', marginTop: '8px', fontSize: '12px' }}>
            <div><strong>PO No:</strong> {lastSavedRecord.poNo}</div>
            <div><strong>Item Code:</strong> {lastSavedRecord.itemCode}</div>
            <div><strong>Item Name:</strong> {lastSavedRecord.itemName}</div>
            <div><strong>Qty Received:</strong> {lastSavedRecord.qtyReceived}</div>
            <div><strong>OK Qty:</strong> {lastSavedRecord.okQty}</div>
            <div><strong>Rework Qty:</strong> {lastSavedRecord.reworkQty}</div>
            <div><strong>Reject Qty:</strong> {lastSavedRecord.rejectQty}</div>
            <div><strong>GRN No:</strong> {lastSavedRecord.grnNo}</div>
            <div><strong>Vendor:</strong> {lastSavedRecord.vendorName}</div>
            <div><strong>OA No:</strong> {lastSavedRecord.oaNo}</div>
          </div>
          <button
            type="button"
            onClick={() => setLastSavedRecord(null)}
            style={{
              marginTop: '8px',
              padding: '4px 12px',
              background: '#ff9800',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
        <label>
          <input type="checkbox" checked={autoDeleteEnabled} onChange={e => setAutoDeleteEnabled(e.target.checked)} />
          Enable Auto-Delete (dangerous)
        </label>
        <label>
          <input type="checkbox" checked={autoImportEnabled} onChange={e => setAutoImportEnabled(e.target.checked)} />
          Enable Auto-Import (dangerous)
        </label>
        <button 
          onClick={showDebugPanel}
          style={{ 
            padding: '6px 12px', 
            background: '#2196f3', 
            color: '#fff', 
            border: 'none', 
            borderRadius: 4, 
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          🔍 Debug Panel
        </button>
      </div>
      {successMessage && (
        <div style={{ 
          marginBottom: 16, 
          padding: '10px', 
          backgroundColor: successMessage.includes('Error') ? '#ffebee' : '#e8f5e8', 
          border: `1px solid ${successMessage.includes('Error') ? '#f44336' : '#4caf50'}`, 
          borderRadius: 4,
          color: successMessage.includes('Error') ? '#c62828' : '#2e7d32'
        }}>
          {successMessage}
        </div>
      )}
      <form
        ref={formRef}
        key={`vsir-form-${editIdx}`}
        onSubmit={handleSubmit}
        onReset={(e) => {
          e.preventDefault();
          console.log('[VSIR] Form reset prevented');
        }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}
      >
        {VSRI_MODULE_FIELDS.map((field) => {
          const fieldValue = (itemInput as any)[field.key];
          console.log(`[VSIR-RENDER] Field ${field.key} =`, fieldValue, 'type:', typeof fieldValue);
          return (
          <div key={field.key} style={{ flex: '1 1 200px', minWidth: 180 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>{field.label}</label>
            {field.key === 'itemName' && itemNames.length > 0 ? (
              <select
                name="itemName"
                value={itemInput.itemName || ''}
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
                value={fieldValue || ''}
                onChange={handleChange}
                style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #bbb' }}
              />
            )}
          </div>
        );
        })}
        <button 
          type="submit" 
          disabled={isSubmitting}
          style={{ 
            padding: '10px 24px', 
            background: isSubmitting ? '#ccc' : '#1a237e', 
            color: '#fff', 
            border: 'none', 
            borderRadius: 4, 
            fontWeight: 500, 
            marginTop: 24,
            cursor: isSubmitting ? 'not-allowed' : 'pointer'
          }}
        >
          {isSubmitting ? 'Saving...' : (editIdx !== null ? 'Update' : 'Add')}
        </button>
        <button
          type="button"
          onClick={() => {
            console.log('[VSIR-DEBUG] Current itemInput state:', itemInput);
            alert('Check console for current itemInput state');
          }}
          style={{
            padding: '10px 24px',
            background: '#ff9800',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontWeight: 500,
            marginTop: 24,
            marginLeft: 16,
            cursor: 'pointer'
          }}
        >
          Debug State
        </button>
        <button
          type="button"
          onClick={() => {
            console.log('[VSIR] Clearing form for new entry');
            setItemInput(initialItemInput);
            setEditIdx(null);
            setLastSavedRecord(null);
          }}
          style={{
            padding: '10px 24px',
            background: '#9c27b0',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontWeight: 500,
            marginTop: 24,
            marginLeft: 8,
            cursor: 'pointer'
          }}
        >
          Clear Form
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
                    console.log(`[VSIR] Table rendering vendorBatchNo for record ${rec.id}: rec.vendorBatchNo="${rec.vendorBatchNo}", computed="${vendorBatchNo}"`);
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
                            setRecords(prev => prev.filter(r => r.id !== toDelete.id));
                          })
                          .catch((e) => {
                            console.error('[VSIR] deleteVSIRRecord failed:', e, 'Record ID:', toDelete.id);
                            alert('Failed to delete record from Firestore. Please check your permissions and network.\nError: ' + (e && e.message ? e.message : e));
                          });
                      } else {
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
