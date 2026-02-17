import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { subscribePsirs } from '../utils/psirService';
import { subscribeVSIRRecords, addVSIRRecord, updateVSIRRecord, deleteVSIRRecord, subscribeVendorDepts, getItemMaster, getVendorIssues, getPurchaseData } from '../utils/firestoreServices';
import bus from '../utils/eventBus';

interface VSRIRecord {
  id: number;
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
  const [psirData, setPsirData] = useState<any[]>([]);
  const [userUid, setUserUid] = useState<string | null>(null);

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
            setRecords(docs.map(d => ({ ...d })) as any[]);
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

        // load one-time master collections
        (async () => {
          try {
            const items = await getItemMaster(uid);
            setItemMaster((items || []) as any[]);
            setItemNames((items || []).map((i: any) => i.itemName).filter(Boolean));
          } catch (e) { console.error('[VSIR] getItemMaster failed', e); }
          try { const p = await getPurchaseData(uid); setPurchaseData(p || []); } catch (e) { console.error('[VSIR] getPurchaseData failed', e); }
          try { const vi = await getVendorIssues(uid); setVendorIssues(vi || []); } catch (e) { console.error('[VSIR] getVendorIssues failed', e); }
        })();

        // cleanup when signed out or component unmount
        return () => {
          try { if (unsubVSIR) unsubVSIR(); } catch {}
          try { if (unsubVendorDepts) unsubVendorDepts(); } catch {}
          try { if (unsubPsirs) unsubPsirs(); } catch {}
        };
      });

      return () => { try { unsubAuth(); } catch {} };
  }, []);

  // Auto-fill Indent No from PSIR for all records that have poNo but missing indentNo
  useEffect(() => {
    if (!isInitialized || records.length === 0) {
      return;
    }

    // Try Firestore realtime PSIRs when logged in, fall back to localStorage
    let unsub: (() => void) | null = null;
    const authUnsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        try {
          const psirDataRaw = localStorage.getItem('psirData');
          if (!psirDataRaw) return;
          const psirData = JSON.parse(psirDataRaw);
          if (!Array.isArray(psirData)) return;
          setPsirData(psirData);

          console.log('[VSIR] Auto-filling Indent No from local psirData');
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

          if (updated) setRecords(updatedRecords);
        } catch (e) { console.error('[VSIR] Error auto-filling indent no from local', e); }
        return;
      }

      unsub = subscribePsirs(u.uid, docs => {
        const psirDataFromFs = docs.map(d => ({ ...d })) as any[];
        setPsirData(psirDataFromFs);
        console.log('[VSIR] Auto-filling Indent No from Firestore PSIRs');
        let updated = false;
        const updatedRecords = records.map(record => {
          if (record.poNo && (!record.indentNo || record.indentNo.trim() === '')) {
            for (const psir of psirDataFromFs) {
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

        if (updated) setRecords(updatedRecords);
      });
    });

    return () => {
      if (unsub) unsub();
      try { authUnsub(); } catch {}
    };
  }, [isInitialized]);

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
  useEffect(() => {
    if (!userUid || !Array.isArray(purchaseData) || purchaseData.length === 0) {
      return; // Wait for userUid and purchase data
    }

    try {
      // Check which POs already have VSIR records
      const existingPOs = new Set(records.map(r => r.poNo));
      console.log('[VSIR] Auto-import starting. Current records:', records.length, 'Purchase orders:', purchaseData.length);

      purchaseData.forEach((order: any) => {
        if (!order.poNo || existingPOs.has(order.poNo) || !Array.isArray(order.items)) return;

        // Get matching VendorDept order for OA and Batch info
        let oaNo = '';
        let batchNo = '';
        const vendorDeptMatch = vendorDeptOrders.find((v: any) => v.materialPurchasePoNo === order.poNo);
        if (vendorDeptMatch) {
          oaNo = vendorDeptMatch.oaNo || '';
          batchNo = vendorDeptMatch.batchNo || '';
        }

        // Create VSIR record for each item in the purchase order
        order.items.forEach((item: any) => {
          const newRecord: VSRIRecord = {
            id: Date.now() + Math.floor(Math.random() * 10000),
            receivedDate: '',
            indentNo: '',
            poNo: order.poNo,
            oaNo,
            purchaseBatchNo: batchNo,
            vendorBatchNo: '',
            dcNo: '',
            invoiceDcNo: '',
            vendorName: '',
            itemName: item.itemName || item.model || '',
            itemCode: item.itemCode || '',
            qtyReceived: item.qty || 0,
            okQty: 0,
            reworkQty: 0,
            rejectQty: 0,
            grnNo: '',
            remarks: '',
          };

          // Save to Firebase
          addVSIRRecord(userUid, newRecord)
            .then(() => {
              console.debug('[VSIR] ✅ Record auto-imported to Firebase for PO:', order.poNo, 'Item:', item.itemCode);
            })
            .catch((error) => {
              console.error('[VSIR] ❌ Error saving record for PO', order.poNo, ':', error);
            });
        });
      });
    } catch (e) {
      console.error('[VSIR] Error in auto-import:', e);
    }
  }, [purchaseData, vendorDeptOrders, records, userUid]);

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
      // Only try to fetch/generate vendorBatchNo if invoiceDcNo is entered
      let vb = getVendorBatchNoForPO(finalItemInput.poNo);
      if (!vb) {
        console.log('[VSIR] Vendor Batch No not found in VendorDept for PO:', finalItemInput.poNo, '- leaving empty for manual entry or sync');
        vb = '';
      }
      finalItemInput.vendorBatchNo = vb;
      console.log('[VSIR] ✓ Invoice/DC No entered, vendorBatchNo set to:', vb);
    } else if (!hasInvoiceDcNo && !finalItemInput.vendorBatchNo?.trim()) {
      // If invoiceDcNo not entered, leave vendorBatchNo empty
      console.log('[VSIR] ✗ Invoice/DC No not entered, vendorBatchNo will remain empty');
      finalItemInput.vendorBatchNo = '';
    }

    // Validation: vendorBatchNo is required if invoiceDcNo is entered
    if (hasInvoiceDcNo && !finalItemInput.vendorBatchNo?.trim()) {
      alert('⚠️ Vendor Batch No could not be determined from VendorDept. Please save a VendorDept order for this PO first.');
      return;
    }

    const newRecord: VSRIRecord = {
      ...finalItemInput,
      id: editIdx !== null ? records[editIdx].id : Date.now(),
    };

    let updated: VSRIRecord[] = [];
    if (editIdx !== null) {
      updated = [...records];
      updated[editIdx] = newRecord;
      setRecords(updated);
    } else {
      updated = [...records, newRecord];
      setRecords(updated);
    }

    // Persist to Firestore when logged in
    if (userUid) {
      try {
        if (editIdx !== null) {
          const existing = records[editIdx];
          if (existing && typeof existing.id === 'string') {
            await updateVSIRRecord(userUid, existing.id as string, newRecord);
          } else {
            // if existing record came from localStorage (numeric id) we still create a new Firestore doc
            await addVSIRRecord(userUid, newRecord);
          }
        } else {
          await addVSIRRecord(userUid, newRecord);
        }
      } catch (err) {
        console.error('[VSIR] Error persisting VSIR to Firestore:', err);
      }
    }

    // Reset form
    setItemInput({
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
    setFormData({ itemName: '' });
    setEditIdx(null);
  };

  return (
    <div>
      <h2>VSRI Module</h2>
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
            ) : field.key === 'itemCode' ? (
              <input
                type={field.type}
                name={field.key}
                value={itemInput.itemCode}
                onChange={handleChange}
                required
                style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #bbb' }}
                readOnly={itemNames.length > 0}
              />
            ) : field.key === 'oaNo' || field.key === 'dcNo' || field.key === 'purchaseBatchNo' ? (
              <input
                type="text"
                name={field.key}
                value={(itemInput as any)[field.key]}
                readOnly
                style={{ fontWeight: 'bold', background: '#f0f0f0', width: 120 }}
              />
            ) : (
              <input
                type={field.type}
                name={field.key}
                value={(itemInput as any)[field.key]}
                onChange={handleChange}
                required={field.key !== 'remarks'}
                style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #bbb' }}
              />
            )}
          </div>
        ))}
        <button
          type="submit"
          style={{
            padding: '10px 24px',
            background: '#1a237e',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontWeight: 500,
            marginTop: 24,
          }}
        >
          {editIdx !== null ? 'Update' : 'Add'}
        </button>
      </form>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fafbfc' }}>
          <thead>
            <tr>
              {VSRI_MODULE_FIELDS.map((field) => (
                <th key={field.key} style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>
                  {field.label}
                </th>
              ))}
              <th style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>Edit</th>
              <th style={{ border: '1px solid #ddd', padding: 8, background: '#e3e6f3', fontWeight: 600 }}>Delete</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr key={rec.id}>
                {VSRI_MODULE_FIELDS.map((field) => {
                  if (field.key === 'dcNo') {
                    // dcNo is MANUAL ENTRY - only show what user entered in VSIR
                    return <td key={field.key} style={{ border: '1px solid #eee', padding: 8 }}>{rec.dcNo}</td>;
                  }
                  if (field.key === 'vendorBatchNo') {
                    const vendorBatchNo = rec.vendorBatchNo || getVendorBatchNoForPO(rec.poNo) || '';
                    return <td key={field.key} style={{ border: '1px solid #eee', padding: 8 }}>{vendorBatchNo}</td>;
                  }
                  return <td key={field.key} style={{ border: '1px solid #eee', padding: 8 }}>{(rec as any)[field.key]}</td>;
                })}
                <td style={{ border: '1px solid #eee', padding: 8 }}>
                  <button
                    style={{
                      background: '#1976d2',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '4px 12px',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleEdit(idx)}
                  >
                    Edit
                  </button>
                </td>
                <td style={{ border: '1px solid #eee', padding: 8 }}>
                  <button
                    onClick={async () => {
                      // delete from state and Firestore if logged in
                      const toDelete = records[idx];
                      setRecords(prev => prev.filter((_, i) => i !== idx));
                      if (userUid && toDelete && typeof toDelete.id === 'string') {
                        try { await deleteVSIRRecord(userUid, toDelete.id as string); } catch (e) { console.error('[VSIR] deleteVSIRRecord failed', e); }
                      }
                    }}
                    style={{
                      background: '#e53935',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '4px 12px',
                      cursor: 'pointer',
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