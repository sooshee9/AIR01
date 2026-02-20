import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import {
  getItemMaster,
  subscribeInHouseIssues,
  addInHouseIssue,
  updateInHouseIssue,
  deleteInHouseIssue,
  subscribePsirs,
  subscribeVSIRRecords,
} from '../utils/firestoreServices';

interface InHouseIssueItem {
  itemName: string;
  itemCode: string;
  transactionType: string;
  batchNo: string;
  issueQty: number;
  reqBy: string;
  inStock: number;
  reqClosed: boolean;
  receivedDate?: string; // FIFO: Track when item was received
}

interface InHouseIssue {
  id?: string;  // Firestore document ID
  reqNo: string;
  reqDate: string;
  indentNo: string;
  oaNo: string;
  poNo: string;
  vendor: string;
  purchaseBatchNo: string;
  vendorBatchNo: string;
  issueNo: string;
  items: InHouseIssueItem[];
}

const reqByOptions = ['HKG', 'NGR', 'MDD'];
const transactionTypeOptions = ['Purchase', 'Vendor', 'Stock'];

function getNextReqNo(issues: InHouseIssue[]) {
  const base = 'Req-No-';
  if (issues.length === 0) return base + '01';
  const lastSerial = Math.max(
    ...issues.map(i => {
      const match = i.reqNo.match(/Req-No-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })
  );
  const nextSerial = lastSerial + 1;
  return base + String(nextSerial).padStart(2, '0');
}

function getNextIssueNo(issues: InHouseIssue[]) {
  const base = 'IH-ISS-';
  if (issues.length === 0) return base + '01';
  const lastSerial = Math.max(
    ...issues.map(i => {
      const match = i.issueNo.match(/IH-ISS-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })
  );
  const nextSerial = lastSerial + 1;
  return base + String(nextSerial).padStart(2, '0');
}

const InHouseIssueModule: React.FC = () => {
  const [issues, setIssues] = useState<InHouseIssue[]>(() => {
    const saved = localStorage.getItem('inHouseIssueData');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return parsed.map((issue: any) => ({
        ...issue,
        items: Array.isArray(issue.items) ? issue.items : [],
      }));
    } catch {
      return [];
    }
  });

  const [newIssue, setNewIssue] = useState<InHouseIssue>({
    reqNo: getNextReqNo([]),
    reqDate: '',
    indentNo: '',
    oaNo: '',
    poNo: '',
    vendor: '',
    purchaseBatchNo: '',
    vendorBatchNo: '',
    issueNo: getNextIssueNo([]),
    items: [],
  });

  const [itemInput, setItemInput] = useState<InHouseIssueItem>({
    itemName: '',
    itemCode: '',
    transactionType: 'Purchase',
    batchNo: '',
    issueQty: 0,
    reqBy: '',
    inStock: 0,
    reqClosed: false,
    receivedDate: new Date().toISOString().slice(0, 10),
  });
  // Removed unused editIdx state

  const [itemNames, setItemNames] = useState<string[]>([]);
  const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [psirBatchNos, setPsirBatchNos] = useState<string[]>([]);
  const [vsirBatchNos, setVsirBatchNos] = useState<string[]>([]);
  const [stockQuantities, setStockQuantities] = useState<string[]>([]);
  const [, setVendors] = useState<string[]>([]);
  const [, setVendorBatchNos] = useState<string[]>([]);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [editIssueIdx, setEditIssueIdx] = useState<number | null>(null);
  const [psirData, setPsirData] = useState<any[]>([]);
  const [vsirData, setVsirData] = useState<any[]>([]);

  // Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      setUserUid(uid);
      console.log('[InHouseIssueModule] Auth state changed, uid:', uid);
    });
    return () => unsub();
  }, []);

  // Migrate existing localStorage `inHouseIssueData` into Firestore on sign-in
  useEffect(() => {
    if (!userUid) return;

    (async () => {
      try {
        const raw = localStorage.getItem('inHouseIssueData');
        if (raw) {
          const arr = JSON.parse(raw || '[]');
          if (Array.isArray(arr) && arr.length > 0) {
            console.log('[InHouseIssueModule] Migrating', arr.length, 'issues to Firestore');
            for (const it of arr) {
              try {
                const payload = { ...it } as any;
                if (typeof payload.id !== 'undefined') delete payload.id;
                await addInHouseIssue(userUid, payload);
              } catch (err) {
                console.warn('[InHouseIssueModule] migration add failed for item', it, err);
              }
            }
            try { localStorage.removeItem('inHouseIssueData'); } catch {}
            console.log('[InHouseIssueModule] Migration to Firestore completed');
          }
        }
      } catch (err) {
        console.error('[InHouseIssueModule] Migration failed:', err);
      }

      // Load Item Master from Firestore
      try {
        const items = await getItemMaster(userUid);
        setItemMaster((items || []) as any[]);
        setItemNames((items || []).map((i: any) => i.itemName).filter(Boolean));
        console.log('[InHouseIssueModule] Loaded item master:', items?.length || 0, 'items');
      } catch (err) {
        console.error('[InHouseIssueModule] Failed to load item master:', err);
      }
    })();
  }, [userUid]);

  // Subscribe to Firestore inHouseIssues
  useEffect(() => {
    if (!userUid) return;

    console.log('[InHouseIssueModule] Setting up Firestore subscription for userUid:', userUid);
    const unsub = subscribeInHouseIssues(userUid, (docs) => {
      console.log('[InHouseIssueModule] ✓ Received inHouseIssues from Firestore:', docs.length, 'items');
      setIssues(docs);
    });

    // Subscribe to PSIR data
    const unsubPsir = subscribePsirs(userUid, (docs) => {
      console.log('[InHouseIssueModule] ✓ Received PSIR data from Firestore:', docs.length, 'items');
      setPsirData(docs || []);
    });

    // Subscribe to VSIR data
    const unsubVsir = subscribeVSIRRecords(userUid, (docs) => {
      console.log('[InHouseIssueModule] ✓ Received VSIR data from Firestore:', docs.length, 'items');
      setVsirData(docs || []);
    });

    return () => {
      unsub();
      unsubPsir();
      unsubVsir();
    };
  }, [userUid]);

  // Helper: Get batch numbers for selected vendor
  const getVendorBatchNos = (vendor: string): string[] => {
    try {
      if (!vendor || !vendor.trim()) {
        return [];
      }
      const purchaseDataRaw = localStorage.getItem('purchaseData');
      if (!purchaseDataRaw) {
        return [];
      }
      const purchaseData = JSON.parse(purchaseDataRaw);
      if (!Array.isArray(purchaseData)) {
        return [];
      }
      const batchNos = new Set<string>();
      purchaseData.forEach((item: any) => {
        if (item.supplierName === vendor && item.vendorBatchNo && item.vendorBatchNo.trim()) {
          batchNos.add(item.vendorBatchNo);
        }
      });
      return Array.from(batchNos).sort();
    } catch (e) {
      console.error('[InHouse] Error getting vendor batch nos:', e);
      return [];
    }
  };

  // Helper: Get batch numbers from VSIR module for an itemCode
  const getVsirBatchNosForItem = (itemCode: string): string[] => {
    try {
      if (!itemCode || !itemCode.trim()) {
        console.log('[InHouse] Empty item code for VSIR, returning empty batch nos');
        return [];
      }
      
      console.log('[InHouse] 🔍 Searching VSIR for item code:', itemCode);
      
      const vsirDataLocal = vsirData;
      console.log('[InHouse] 📊 Loaded VSIR records count:', Array.isArray(vsirDataLocal) ? vsirDataLocal.length : 'not-array');
      
      if (!Array.isArray(vsirDataLocal) || vsirDataLocal.length === 0) {
        console.log('[InHouse] ❌ No VSIR data available');
        return [];
      }
      
      const batchNos = new Set<string>();
      vsirDataLocal.forEach((record: any, idx: number) => {
        console.log(`[InHouse] 📝 Record ${idx}: itemCode=${record.itemCode}, Code=${record.Code}, vendorBatchNo=${record.vendorBatchNo}`);
        // Check if this VSIR record contains the item and has vendorBatchNo
        if ((record.itemCode && record.itemCode === itemCode) || (record.Code && record.Code === itemCode)) {
          if (record.vendorBatchNo && record.vendorBatchNo.trim()) {
            console.log('[InHouse] ✅ Found vendor batch no for item', itemCode, ':', record.vendorBatchNo);
            batchNos.add(record.vendorBatchNo);
          } else {
            console.log('[InHouse] ⚠️  Item matched but vendorBatchNo is empty or missing');
          }
        }
      });
      
      const result = Array.from(batchNos).sort();
      console.log('[InHouse] 📋 Final VSIR batch nos for', itemCode, ':', result, '(count:', result.length, ')');
      return result;
    } catch (e) {
      console.error('[InHouse] ❌ Error getting VSIR batch nos:', e);
      return [];
    }
  };

  // Helper: Get batch numbers from PSIR module for an itemCode
  const getPsirBatchNosForItem = (itemCode: string): string[] => {
    try {
      if (!itemCode || !itemCode.trim()) {
        console.log('[InHouse] Empty item code, returning empty batch nos');
        return [];
      }
      
      const psirDataLocal = psirData;
      if (!Array.isArray(psirDataLocal) || psirDataLocal.length === 0) {
        console.log('[InHouse] No PSIR data available');
        return [];
      }
      
      const batchNos = new Set<string>();
      psirDataLocal.forEach((psir: any) => {
        // Check if this PSIR record contains the item
        const hasItem = Array.isArray(psir.items) && 
          psir.items.some((item: any) => 
            (item.itemCode && item.itemCode === itemCode) || 
            (item.Code && item.Code === itemCode)
          );
        
        // If item found and PSIR has batchNo, add it to the set
        if (hasItem && psir.batchNo && psir.batchNo.trim()) {
          console.log('[InHouse] Found batch no for item', itemCode, ':', psir.batchNo);
          batchNos.add(psir.batchNo);
        }
      });
      
      const result = Array.from(batchNos).sort();
      console.log('[InHouse] All batch nos for', itemCode, ':', result);
      return result;
    } catch (e) {
      console.error('[InHouse] Error getting PSIR batch nos:', e);
      return [];
    }
  };

  // Load item master and vendor data from localStorage on mount (for non-Firestore data)
  useEffect(() => {
    // Fetch Item Names and Codes from Item Master
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
    // Fetch Vendors from Purchase data
    const purchaseDataRaw = localStorage.getItem('purchaseData');
    if (purchaseDataRaw) {
      try {
        const parsed = JSON.parse(purchaseDataRaw);
        if (Array.isArray(parsed)) {
          const uniqueVendors = [...new Set(parsed.map((item: any) => item.supplierName).filter(Boolean))];
          setVendors(uniqueVendors);
        }
      } catch {}
    }
  }, []);

  // Update batch numbers when transaction type or item code changes
  useEffect(() => {
    console.log('[InHouse] 🔄 Batch update useEffect triggered. transactionType:', itemInput.transactionType, 'itemCode:', itemInput.itemCode);
    
    if (itemInput.transactionType === 'Purchase' && itemInput.itemCode) {
      const batchNos = getPsirBatchNosForItem(itemInput.itemCode);
      setPsirBatchNos(batchNos);
      setVsirBatchNos([]);
      console.log('[InHouse] ✅ Updated PSIR batch nos for', itemInput.itemCode, ':', batchNos);
    } else if (itemInput.transactionType === 'Vendor' && itemInput.itemCode) {
      console.log('[InHouse] 🎯 Transaction Type is VENDOR - calling getVsirBatchNosForItem');
      const batchNos = getVsirBatchNosForItem(itemInput.itemCode);
      setVsirBatchNos(batchNos);
      setPsirBatchNos([]);
      console.log('[InHouse] ✅ Updated VSIR batch nos for', itemInput.itemCode, ':', batchNos);
    } else if (itemInput.transactionType === 'Stock' && itemInput.itemCode) {
      // For Stock type, get stock quantities
      const stockQtys = getStockQuantities(itemInput.itemCode);
      setStockQuantities(stockQtys);
      setPsirBatchNos([]);
      setVsirBatchNos([]);
      console.log('[InHouse] ✅ Updated Stock quantities for', itemInput.itemCode, ':', stockQtys);
    } else {
      console.log('[InHouse] ⚠️  No batch type matched or missing itemCode');
      setPsirBatchNos([]);
      setVsirBatchNos([]);
    }
  }, [itemInput.transactionType, itemInput.itemCode, psirData, vsirData]);

  // Update vendor batch numbers when vendor selection changes
  useEffect(() => {
    if (newIssue.vendor) {
      const batchNosForVendor = getVendorBatchNos(newIssue.vendor);
      setVendorBatchNos(batchNosForVendor);
    } else {
      setVendorBatchNos([]);
    }
  }, [newIssue.vendor]);

  // Helper: Get stock quantities for selected item code
  const getStockQuantities = (itemCode: string): string[] => {
    try {
      if (!itemCode || !itemCode.trim()) {
        return [];
      }
      const stockDataRaw = localStorage.getItem('stock-records');
      if (!stockDataRaw) {
        return [];
      }
      const stockData = JSON.parse(stockDataRaw);
      if (!Array.isArray(stockData)) {
        return [];
      }
      const quantities = stockData
        .filter((record: any) => record.itemCode === itemCode && record.closingStock > 0)
        .map((record: any) => `${record.closingStock}`);
      return [...new Set(quantities)]; // Remove duplicates
    } catch (e) {
      console.error('Error getting stock quantities:', e);
      return [];
    }
  };

  // Filter stock quantities to show only those not fully issued (for Stock transaction type)
  const getAvailableStockQuantities = (itemCode: string): string[] => {
    try {
      const allStocks = getStockQuantities(itemCode);
      return allStocks.filter(stockQty => {
        const numQty = parseInt(stockQty, 10);
        
        // Check in-house issues
        let totalIssued = 0;
        const issuesRaw = localStorage.getItem('inHouseIssueData');
        if (issuesRaw) {
          const issuesData = JSON.parse(issuesRaw);
          if (Array.isArray(issuesData)) {
            issuesData.forEach((issue: any) => {
              if (Array.isArray(issue.items)) {
                issue.items.forEach((item: any) => {
                  if (item.batchNo === stockQty && item.itemCode === itemCode && item.transactionType === 'Stock') {
                    totalIssued += item.issueQty || 0;
                  }
                });
              }
            });
          }
        }
        
        // Check vendor issues (stock issued through vendor)
        const vendorIssuesRaw = localStorage.getItem('vendorIssueData');
        if (vendorIssuesRaw) {
          const vendorIssuesData = JSON.parse(vendorIssuesRaw);
          if (Array.isArray(vendorIssuesData)) {
            vendorIssuesData.forEach((issue: any) => {
              if (Array.isArray(issue.items)) {
                issue.items.forEach((item: any) => {
                  // For vendor issues, check if batch matches stock qty and item code
                  if (issue.batchNo === stockQty && item.itemCode === itemCode) {
                    totalIssued += item.qty || 0;
                  }
                });
              }
            });
          }
        }
        
        const pending = numQty - totalIssued;
        console.log('[DEBUG] Stock qty filter:', { stockQty, itemCode, pending, willShow: pending > 0 });
        return pending > 0;
      });
    } catch (e) {
      console.error('Error filtering stock quantities:', e);
      return getStockQuantities(itemCode);
    }
  };

  // Update stock quantities when item code or transaction type changes
  useEffect(() => {
    if (itemInput.transactionType === 'Stock' && itemInput.itemCode) {
      const quantities = getAvailableStockQuantities(itemInput.itemCode);
      setStockQuantities(quantities);
    } else {
      setStockQuantities([]);
    }
  }, [itemInput.transactionType, itemInput.itemCode]);

  // Auto-fill Indent No, OA No, PO No from PSIR or VSIR based on batch number
  useEffect(() => {
    if (!itemInput.batchNo) {
      console.log('[InHouse] No batch number selected');
      return;
    }

    console.log('[InHouse] Auto-fill triggered with batchNo:', itemInput.batchNo, 'transactionType:', itemInput.transactionType);

    try {
      if (itemInput.transactionType === 'Purchase') {
        // Get from PSIR
        const psirDataLocal = psirData;
        console.log('[InHouse] PSIR Data loaded:', psirDataLocal);
        if (!Array.isArray(psirDataLocal) || psirDataLocal.length === 0) {
          console.log('[InHouse] No PSIR data available');
          return;
        }
        
        console.log('[InHouse] Searching through', psirDataLocal.length, 'PSIR records');
        for (let i = 0; i < psirDataLocal.length; i++) {
          const psir = psirDataLocal[i];
          console.log(`[InHouse] Record ${i}: batchNo="${psir.batchNo}" (looking for "${itemInput.batchNo}")`);
          
          if (psir.batchNo && psir.batchNo.toString().trim() === itemInput.batchNo.toString().trim()) {
            console.log('[InHouse] ✓ MATCH FOUND!');
            const indentNo = psir.indentNo || '';
            const oaNo = psir.oaNo || '';
            const poNo = psir.poNo || '';
            console.log('[InHouse] Setting values:', { indentNo, oaNo, poNo });
            setNewIssue(prev => {
              const updated = { ...prev, indentNo, oaNo, poNo };
              console.log('[InHouse] Updated newIssue:', updated);
              return updated;
            });
            return;
          }
        }
        console.log('[InHouse] ✗ No matching PSIR batch found');
      } else if (itemInput.transactionType === 'Vendor') {
        // Get from VSIR
        const vsirDataLocal = vsirData;
        console.log('[InHouse] VSIR Data loaded:', vsirDataLocal);
        if (!Array.isArray(vsirDataLocal) || vsirDataLocal.length === 0) {
          console.log('[InHouse] No VSIR data available');
          return;
        }
        
        console.log('[InHouse] Searching through', vsirDataLocal.length, 'VSIR records');
        for (let i = 0; i < vsirDataLocal.length; i++) {
          const vsir = vsirDataLocal[i];
          console.log(`[InHouse] Record ${i}: vendorBatchNo="${vsir.vendorBatchNo}" (looking for "${itemInput.batchNo}")`);
          
          if (vsir.vendorBatchNo && vsir.vendorBatchNo.toString().trim() === itemInput.batchNo.toString().trim()) {
            console.log('[InHouse] ✓ MATCH FOUND!');
            const indentNo = vsir.indentNo || '';
            const oaNo = vsir.oaNo || '';
            const poNo = vsir.poNo || '';
            console.log('[InHouse] Setting values:', { indentNo, oaNo, poNo });
            setNewIssue(prev => {
              const updated = { ...prev, indentNo, oaNo, poNo };
              console.log('[InHouse] Updated newIssue:', updated);
              return updated;
            });
            return;
          }
        }
        console.log('[InHouse] ✗ No matching VSIR batch found');
      }
    } catch (e) {
      console.error('Error auto-filling batch details:', e);
    }
  }, [itemInput.batchNo, itemInput.transactionType, psirData, vsirData]);

  // Auto-fill Indent No, OA No, PO No for all saved issues based on their items' batch numbers
  useEffect(() => {
    if (issues.length === 0) return;

    try {
      console.log('[InHouse] Auto-filling batch details for all saved issues');
      let updated = false;
      const psirDataRaw = localStorage.getItem('psirData');
      const vsirDataRaw = localStorage.getItem('vsri-records');
      
      const psirData = psirDataRaw ? JSON.parse(psirDataRaw) : [];
      const vsirData = vsirDataRaw ? JSON.parse(vsirDataRaw) : [];

      const updatedIssues = issues.map(issue => {
        // If already has all required fields, skip
        if (issue.indentNo && issue.oaNo && issue.poNo) {
          return issue;
        }

        // Try to find matching batch from first item
        if (issue.items && issue.items.length > 0) {
          const firstItem = issue.items[0];
          let indentNo = issue.indentNo || '';
          let oaNo = issue.oaNo || '';
          let poNo = issue.poNo || '';

          if (firstItem.transactionType === 'Purchase') {
            // Search PSIR
            for (const psir of psirData) {
              if (psir.batchNo === firstItem.batchNo) {
                indentNo = psir.indentNo || indentNo;
                oaNo = psir.oaNo || oaNo;
                poNo = psir.poNo || poNo;
                console.log('[InHouse] Found PSIR match for batch:', firstItem.batchNo);
                updated = true;
                break;
              }
            }
          } else if (firstItem.transactionType === 'Vendor') {
            // Search VSIR
            for (const vsir of vsirData) {
              if (vsir.vendorBatchNo === firstItem.batchNo) {
                indentNo = vsir.indentNo || indentNo;
                oaNo = vsir.oaNo || oaNo;
                poNo = vsir.poNo || poNo;
                console.log('[InHouse] Found VSIR match for batch:', firstItem.batchNo);
                updated = true;
                break;
              }
            }
          }

          if (updated) {
            return { ...issue, indentNo, oaNo, poNo };
          }
        }
        return issue;
      });

      if (updated) {
        console.log('[InHouse] Updating issues with auto-filled batch details');
        setIssues(updatedIssues);
        localStorage.setItem('inHouseIssueData', JSON.stringify(updatedIssues));
      }
    } catch (e) {
      console.error('[InHouse] Error auto-filling batch details for saved issues:', e);
    }
  }, []);

  // Auto-add an In House Issue for every new PO in purchaseData if not already present, and fill items from purchase module
  useEffect(() => {
    const purchaseDataRaw = localStorage.getItem('purchaseData');
    let purchaseData = [];
    try {
      purchaseData = purchaseDataRaw ? JSON.parse(purchaseDataRaw) : [];
    } catch {}
    const purchasePOs = purchaseData.map((order: any) => order.poNo).filter(Boolean);
    const existingPOs = new Set(issues.map(issue => issue.poNo));
    let added = false;
    const newIssues = [...issues];
    purchasePOs.forEach((poNo: string) => {
      if (!existingPOs.has(poNo)) {
        const purchaseOrder = purchaseData.find((po: any) => po.poNo === poNo);
        const items = purchaseOrder && Array.isArray(purchaseOrder.items)
          ? purchaseOrder.items.map((item: any) => ({
              itemName: item.itemName || item.model || '',
              itemCode: item.itemCode || '',
              transactionType: 'Purchase',
              batchNo: purchaseOrder?.batchNo || '',
              issueQty: item.qty || 0,
              reqBy: item.reqBy || '',
              inStock: 0,
              reqClosed: false,
            }))
          : [];
        newIssues.push({
          reqNo: '',
          reqDate: '',
          indentNo: '',
          oaNo: '',
          poNo: poNo,
          vendor: purchaseOrder?.supplierName || '',
          purchaseBatchNo: purchaseOrder?.batchNo || '',
          vendorBatchNo: purchaseOrder?.vendorBatchNo || '',
          issueNo: getNextIssueNo(newIssues),
          items,
        });
        added = true;
      }
    });
    if (added) {
      setIssues(newIssues);
      localStorage.setItem('inHouseIssueData', JSON.stringify(newIssues));
    }
    // eslint-disable-next-line
  }, []);

  // When PO No changes, auto-fill Req. No from Vendor Dept DC No if available
  useEffect(() => {
    if (!newIssue.poNo) return;
    const vendorDeptDataRaw = localStorage.getItem('vendorDeptData');
    let vendorDeptData = [];
    try {
      vendorDeptData = vendorDeptDataRaw ? JSON.parse(vendorDeptDataRaw) : [];
    } catch {}
    const match = vendorDeptData.find((order: any) => order.materialPurchasePoNo === newIssue.poNo);
    console.log('[InHouse] vendorDeptData:', vendorDeptData);
    console.log('[InHouse] Selected PO No:', newIssue.poNo);
    console.log('[InHouse] Matched VendorDept order:', match);
    if (match && match.dcNo && newIssue.reqNo !== match.dcNo) {
      console.log('[InHouse] Setting Req. No from VendorDept DC No:', match.dcNo);
      setNewIssue((prev) => {
        const updated = { ...prev, reqNo: match.dcNo };
        console.log('[InHouse] newIssue after Req. No set:', updated);
        return updated;
      });
      return;
    }
    // fallback to purchase module if not found in vendor dept
    const purchaseDataRaw = localStorage.getItem('purchaseData');
    let purchaseData = [];
    try {
      purchaseData = purchaseDataRaw ? JSON.parse(purchaseDataRaw) : [];
    } catch {}
    const matchPurchase = purchaseData.find((order: any) => order.poNo === newIssue.poNo);
    if (matchPurchase && matchPurchase.reqNo && newIssue.reqNo !== matchPurchase.reqNo) {
      console.log('[InHouse] Setting Req. No from Purchase:', matchPurchase.reqNo);
      setNewIssue((prev) => ({ ...prev, reqNo: matchPurchase.reqNo }));
    }
    // eslint-disable-next-line
  }, [newIssue.poNo]);

  // Update vendor batch numbers when vendor selection changes
  useEffect(() => {
    if (newIssue.vendor) {
      const batchNosForVendor = getVendorBatchNos(newIssue.vendor);
      setVendorBatchNos(batchNosForVendor);
    } else {
      setVendorBatchNos([]);
    }
  }, [newIssue.vendor]);

  const handleAddItem = () => {
    if (!itemInput.itemName || !itemInput.itemCode || !itemInput.reqBy || itemInput.issueQty <= 0) return;
    // Sort items by receivedDate (FIFO - oldest first)
    const newItems = [...newIssue.items, itemInput];
    newItems.sort((a, b) => {
      const dateA = new Date(a.receivedDate || '').getTime();
      const dateB = new Date(b.receivedDate || '').getTime();
      return dateA - dateB;
    });
    setNewIssue({ ...newIssue, items: newItems });
    setItemInput({ itemName: '', itemCode: '', transactionType: 'Purchase', batchNo: '', issueQty: 0, reqBy: '', inStock: 0, reqClosed: false, receivedDate: new Date().toISOString().slice(0, 10) });
  };

  const [editItemIdx, setEditItemIdx] = useState<number | null>(null);
  const handleEditItem = (idx: number) => {
    setItemInput(newIssue.items[idx]);
    setEditItemIdx(idx);
  };
  const handleSaveItem = () => {
    if (editItemIdx !== null) {
      setNewIssue(prev => ({
        ...prev,
        items: prev.items.map((item, idx) => idx === editItemIdx ? itemInput : item)
      }));
      setEditItemIdx(null);
      setItemInput({ itemName: '', itemCode: '', transactionType: 'Purchase', batchNo: '', issueQty: 0, reqBy: '', inStock: 0, reqClosed: false });
    } else {
      handleAddItem();
    }
  };

  const handleEditIssue = (idx: number) => {
    setNewIssue(issues[idx]);
    setEditIssueIdx(idx);
  };

  const handleUpdateIssue = () => {
    if (editIssueIdx === null || !userUid) return;
    const issueToUpdate = issues[editIssueIdx];
    if (!issueToUpdate?.id) {
      console.error('[InHouseIssueModule] No issue ID found for update');
      return;
    }
    (async () => {
      try {
        await updateInHouseIssue(userUid, issueToUpdate.id as string, newIssue);
        console.log('[InHouseIssueModule] ✓ Issue updated in Firestore:', issueToUpdate.id);
      } catch (err) {
        console.error('[InHouseIssueModule] Failed to update issue:', err);
      }
    })();
    setNewIssue({ reqNo: getNextReqNo(issues), reqDate: '', indentNo: '', oaNo: '', poNo: '', vendor: '', purchaseBatchNo: '', vendorBatchNo: '', issueNo: getNextIssueNo(issues), items: [] });
    setItemInput({ itemName: '', itemCode: '', transactionType: 'Purchase', batchNo: '', issueQty: 0, reqBy: '', inStock: 0, reqClosed: false, receivedDate: new Date().toISOString().slice(0, 10) });
    setEditIssueIdx(null);
  };

  const handleAddIssue = () => {
    if (!newIssue.reqDate || !newIssue.reqNo || newIssue.items.length === 0) {
      alert('Please fill in: Req. Date, Req. No, and add at least one item');
      return;
    }
    if (!userUid) {
      console.error('[InHouseIssueModule] No userUid available for adding issue');
      alert('Please sign in to add issues');
      return;
    }
    const issueNo = getNextIssueNo(issues);
    (async () => {
      try {
        await addInHouseIssue(userUid, { ...newIssue, issueNo });
        console.log('[InHouseIssueModule] ✓ Issue added to Firestore');
      } catch (err) {
        console.error('[InHouseIssueModule] Failed to add issue:', err);
      }
    })();
    setNewIssue({ reqNo: getNextReqNo(issues), reqDate: '', indentNo: '', oaNo: '', poNo: '', vendor: '', purchaseBatchNo: '', vendorBatchNo: '', issueNo: getNextIssueNo(issues), items: [] });
    setItemInput({ itemName: '', itemCode: '', transactionType: 'Purchase', batchNo: '', issueQty: 0, reqBy: '', inStock: 0, reqClosed: false, receivedDate: new Date().toISOString().slice(0, 10) });
  };

  const handleDeleteItem = async (issueIdx: number, itemIdx: number) => {
    if (!userUid) {
      alert('Please sign in');
      return;
    }
    
    const issueToUpdate = issues[issueIdx];
    if (!issueToUpdate?.id) {
      console.error('[InHouseIssueModule] Issue ID not found');
      return;
    }

    try {
      const updatedItems = issueToUpdate.items.filter((_, i) => i !== itemIdx);
      if (updatedItems.length === 0) {
        // Delete entire issue if no items remain
        await deleteInHouseIssue(userUid, issueToUpdate.id as string);
        console.log('[InHouseIssueModule] ✓ Issue deleted (no items remaining)');
      } else {
        // Update issue with remaining items
        await updateInHouseIssue(userUid, issueToUpdate.id as string, { ...issueToUpdate, items: updatedItems });
        console.log('[InHouseIssueModule] ✓ Item deleted from issue');
      }
    } catch (err) {
      console.error('[InHouseIssueModule] Failed to delete item:', err);
      alert('Failed to delete item: ' + String(err));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'itemName') {
      const found = itemMaster.find(item => item.itemName === value);
      setItemInput({ ...itemInput, itemName: value, itemCode: found ? found.itemCode : '' });
    } else if (name in itemInput) {
      setItemInput({ ...itemInput, [name]: value });
    } else {
      setNewIssue({ ...newIssue, [name]: value });
    }
  };

  // Get batch details (OK Qty and Reject Qty) based on selected batch
  // Calculate already issued qty for a batch number
  const getIssuedQtyForBatch = (batchNo: string, transactionType: string, itemCode: string): number => {
    void transactionType;
    try {
      let totalIssued = 0;
      
      // Check in-house issue data
      const issuesRaw = localStorage.getItem('inHouseIssueData');
      if (issuesRaw) {
        const issuesData = JSON.parse(issuesRaw);
        if (Array.isArray(issuesData)) {
          issuesData.forEach((issue: any) => {
            if (Array.isArray(issue.items)) {
              issue.items.forEach((item: any) => {
                // Sum ALL issued quantities for this batch and itemCode
                if (item.batchNo === batchNo && item.itemCode === itemCode) {
                  totalIssued += item.issueQty || 0;
                }
              });
            }
          });
        }
      }
      
      // Also check vendor issue data - items issued through Vendor Issues module
      const vendorIssuesRaw = localStorage.getItem('vendorIssueData');
      if (vendorIssuesRaw) {
        const vendorIssuesData = JSON.parse(vendorIssuesRaw);
        console.log('[DEBUG] Vendor Issues Data (Full):', vendorIssuesData);
        if (Array.isArray(vendorIssuesData)) {
          vendorIssuesData.forEach((issue: any, issueIdx: number) => {
            console.log(`[DEBUG] Processing vendor issue ${issueIdx}:`, { 
              issueBatchNo: issue.batchNo,
              items: issue.items 
            });
            if (Array.isArray(issue.items)) {
              issue.items.forEach((item: any, itemIdx: number) => {
                console.log(`[DEBUG] Processing vendor item ${issueIdx}-${itemIdx}:`, { 
                  fullItem: item,
                  issueBatchNo: issue.batchNo,
                  searchBatchNo: batchNo, 
                  batchMatch: issue.batchNo === batchNo,
                  itemCode: item.itemCode,
                  searchItemCode: itemCode,
                  codeMatch: item.itemCode === itemCode,
                  qty: item.qty
                });
                // Match by ISSUE batch number (not item.batchNo) and item code
                if (issue.batchNo === batchNo && item.itemCode === itemCode) {
                  console.log('[DEBUG] ✓✓✓ Found vendor issued item:', { batchNo, itemCode, qty: item.qty });
                  totalIssued += item.qty || 0;
                }
              });
            } else {
              console.log(`[DEBUG] Vendor issue ${issueIdx} has no items array or items is not array`);
            }
          });
        }
      }
      
      console.log('[DEBUG] getIssuedQtyForBatch result:', { batchNo, itemCode, totalIssued });
      return totalIssued;
    } catch (e) {
      console.error('Error calculating issued qty for batch:', e);
      return 0;
    }
  };

  // Get OK Qty for a batch from PSIR
  const getPsirOkQtyForBatch = (batchNo: string, itemCode: string): number => {
    try {
      const psirDataLocal = psirData;
      if (!Array.isArray(psirDataLocal)) return 0;
      
      for (const psir of psirDataLocal) {
        if (psir.batchNo === batchNo && Array.isArray(psir.items)) {
          const item = psir.items.find((it: any) => it.itemCode === itemCode);
          if (item) {
            return item.okQty || 0;
          }
        }
      }
      return 0;
    } catch (e) {
      console.error('Error getting PSIR OK Qty:', e);
      return 0;
    }
  };

  // Get OK Qty for a batch from VSIR
  const getVsirOkQtyForBatch = (batchNo: string, itemCode: string): number => {
    try {
      const vsirDataLocal = vsirData;
      if (!Array.isArray(vsirDataLocal)) return 0;
      
      for (const vsir of vsirDataLocal) {
        if (vsir.vendorBatchNo === batchNo && vsir.itemCode === itemCode) {
          return vsir.okQty || 0;
        }
      }
      return 0;
    } catch (e) {
      console.error('Error getting VSIR OK Qty:', e);
      return 0;
    }
  };

  // Get pending OK Qty for a batch (OK Qty - Already Issued)
  const getPendingOkQtyForBatch = (batchNo: string, transactionType: string, itemCode: string): number => {
    let totalOkQty = 0;
    
    if (transactionType === 'Purchase') {
      totalOkQty = getPsirOkQtyForBatch(batchNo, itemCode);
    } else if (transactionType === 'Vendor') {
      totalOkQty = getVsirOkQtyForBatch(batchNo, itemCode);
    }
    
    const issuedQty = getIssuedQtyForBatch(batchNo, transactionType, itemCode);
    const pending = Math.max(0, totalOkQty - issuedQty);
    
    console.log('[DEBUG] getPendingOkQtyForBatch:', { batchNo, transactionType, itemCode, totalOkQty, issuedQty, pending });
    return pending;
  };

  // Filter batch numbers to show only those with pending OK Qty
  const getPsirBatchNosWithPending = (itemCode: string): string[] => {
    const allBatches = getPsirBatchNosForItem(itemCode);
    return allBatches.filter(batch => {
      const pendingQty = getPendingOkQtyForBatch(batch, 'Purchase', itemCode);
      return pendingQty > 0;
    });
  };

  // Filter batch numbers to show only those with pending OK Qty
  const getVsirBatchNosWithPending = (itemCode: string): string[] => {
    const allBatches = getVsirBatchNosForItem(itemCode);
    return allBatches.filter(batch => {
      const pendingQty = getPendingOkQtyForBatch(batch, 'Vendor', itemCode);
      return pendingQty > 0;
    });
  };

  // Get batch details (OK Qty and Reject Qty) based on selected batch
  const getBatchDetailsText = (): string => {
    if (!itemInput.batchNo) {
      return '';
    }

    try {
      if (itemInput.transactionType === 'Purchase') {
        const totalOkQty = getPsirOkQtyForBatch(itemInput.batchNo, itemInput.itemCode);
        const pendingOkQty = getPendingOkQtyForBatch(itemInput.batchNo, 'Purchase', itemInput.itemCode);
        return `${itemInput.batchNo} | OK: ${totalOkQty} | Pending: ${pendingOkQty}`;
      } else if (itemInput.transactionType === 'Vendor') {
        const totalOkQty = getVsirOkQtyForBatch(itemInput.batchNo, itemInput.itemCode);
        const pendingOkQty = getPendingOkQtyForBatch(itemInput.batchNo, 'Vendor', itemInput.itemCode);
        return `${itemInput.batchNo} | OK: ${totalOkQty} | Pending: ${pendingOkQty}`;
      } else if (itemInput.transactionType === 'Stock') {
        // Get from Stock Module
        const stockDataRaw = localStorage.getItem('stock-records');
        if (!stockDataRaw) return 'No Stock data';
        
        const stockData = JSON.parse(stockDataRaw);
        if (!Array.isArray(stockData)) return 'Invalid Stock data';
        
        for (const stock of stockData) {
          if (stock.itemCode === itemInput.itemCode && stock.closingStock.toString() === itemInput.batchNo) {
            const qty = stock.closingStock || 0;
            return `Stock Qty: ${qty}`;
          }
        }
        return `No stock details found`;
      }
      return '';
    } catch (e) {
      console.error('Error getting batch details:', e);
      return 'Error fetching details';
    }
  };

  return (
    <div>
      <h2>In House Issue Module</h2>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="text" placeholder="Req. No" value={newIssue.reqNo} readOnly style={{ fontWeight: 'bold', background: '#f0f0f0' }} />
        <input type="date" placeholder="Req. Date" value={newIssue.reqDate} onChange={e => setNewIssue({ ...newIssue, reqDate: e.target.value })} />
        <input type="text" placeholder="Indent No" value={newIssue.indentNo} onChange={e => setNewIssue({ ...newIssue, indentNo: e.target.value })} style={{ display: 'none' }} />
        <input type="text" placeholder="OA No" value={newIssue.oaNo} onChange={e => setNewIssue({ ...newIssue, oaNo: e.target.value })} style={{ display: 'none' }} />
        <input placeholder="PO No" value={newIssue.poNo} onChange={e => setNewIssue({ ...newIssue, poNo: e.target.value })} style={{ display: 'none' }} />
        <input type="text" placeholder="Purchase Batch No" value={newIssue.purchaseBatchNo} onChange={e => setNewIssue({ ...newIssue, purchaseBatchNo: e.target.value })} style={{ display: 'none' }} />
        <input placeholder="Issue No" value={newIssue.issueNo} disabled style={{ background: '#eee', display: 'none' }} />
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
            {itemNames.map((name) => (
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
        <input placeholder="Item Code" value={itemInput.itemCode} onChange={e => setItemInput({ ...itemInput, itemCode: e.target.value })} />
        <label>Transaction Type:</label>
        <select value={itemInput.transactionType} onChange={e => setItemInput({ ...itemInput, transactionType: e.target.value })}>
          <option value="">Select</option>
          {transactionTypeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <label>Batch No:</label>
        <select value={itemInput.batchNo} onChange={e => setItemInput({ ...itemInput, batchNo: e.target.value })}>
          <option value="">Select</option>
          {itemInput.transactionType === 'Purchase' ? (
            psirBatchNos && psirBatchNos.length > 0 ? (
              getPsirBatchNosWithPending(itemInput.itemCode).map(batchNo => {
                const pendingQty = getPendingOkQtyForBatch(batchNo, 'Purchase', itemInput.itemCode);
                return (
                  <option key={batchNo} value={batchNo}>
                    {batchNo} (Pending: {pendingQty})
                  </option>
                );
              })
            ) : (
              <option disabled style={{ color: '#999' }}>No batch numbers available</option>
            )
          ) : itemInput.transactionType === 'Vendor' ? (
            vsirBatchNos && vsirBatchNos.length > 0 ? (
              getVsirBatchNosWithPending(itemInput.itemCode).map(batchNo => {
                const pendingQty = getPendingOkQtyForBatch(batchNo, 'Vendor', itemInput.itemCode);
                return (
                  <option key={batchNo} value={batchNo}>
                    {batchNo} (Pending: {pendingQty})
                  </option>
                );
              })
            ) : (
              <option disabled style={{ color: '#999' }}>No vendor batch numbers available</option>
            )
          ) : itemInput.transactionType === 'Stock' ? (
            stockQuantities && stockQuantities.length > 0 ? (
              stockQuantities.map(qty => (
                <option key={qty} value={qty}>Stock Quantity: {qty}</option>
              ))
            ) : (
              <option disabled style={{ color: '#999' }}>No stock quantities available</option>
            )
          ) : (
            <option disabled style={{ color: '#999' }}>Select Transaction Type first</option>
          )}
        </select>
        <select value={itemInput.reqBy} onChange={e => setItemInput({ ...itemInput, reqBy: e.target.value })}>
          <option value="">Req By</option>
          {reqByOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <input type="number" placeholder="In Stock" value={itemInput.inStock || ''} onChange={e => setItemInput({ ...itemInput, inStock: Number(e.target.value) })} style={{ display: 'none' }} />
        <input type="date" placeholder="Received Date (FIFO)" value={itemInput.receivedDate || ''} onChange={e => setItemInput({ ...itemInput, receivedDate: e.target.value })} title="Date when item was received - used for FIFO" style={{ display: 'none' }} />
        <input type="number" placeholder="Issue Qty" value={itemInput.issueQty || ''} onChange={e => setItemInput({ ...itemInput, issueQty: Number(e.target.value) })} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <label style={{ fontWeight: 'bold', minWidth: '80px' }}>Batch Details:</label>
          <input
            type="text"
            placeholder="Batch No | OK Qty"
            value={getBatchDetailsText()}
            readOnly
            style={{
              background: '#f5f5f5',
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid #ddd',
              minWidth: '250px',
              fontFamily: 'monospace',
              fontSize: '12px'
            }}
          />
        </div>
        <label style={{ display: 'none' }}>
          <input type="checkbox" checked={itemInput.reqClosed} onChange={e => setItemInput({ ...itemInput, reqClosed: e.target.checked })} />
          Req Closed
        </label>
  <button onClick={handleSaveItem}>{editItemIdx !== null ? 'Save' : 'Add Item'}</button>
      </div>
      {newIssue.items.length > 0 && (
        <table border={1} cellPadding={6} style={{ width: '100%', marginBottom: 16 }}>
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Item Code</th>
              <th>Transaction Type</th>
              <th>Batch No</th>
              <th>Req By</th>
              <th>In Stock</th>
              <th>Received Date (FIFO)</th>
              <th>Issue Qty</th>
              <th>Req Closed</th>
            </tr>
          </thead>
          <tbody>
            {newIssue.items.map((item, idx) => (
              <tr key={idx}>
                <td>{item.itemName}</td>
                <td>{item.itemCode}</td>
                <td>{item.transactionType}</td>
                <td>{item.batchNo}</td>
                <td>{item.reqBy}</td>
                <td>{item.inStock}</td>
                <td>{item.receivedDate}</td>
                <td>{item.issueQty}</td>
                <td>{item.reqClosed ? 'Yes' : 'No'}</td>
                <td><button style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }} onClick={() => handleEditItem(idx)}>Edit</button></td>
                <td><button onClick={(e) => {
                  e.preventDefault();
                  const toDelete = issues[idx];
                  if (!toDelete?.id || !userUid) return;
                  (async () => {
                    try {
                      await deleteInHouseIssue(userUid, toDelete.id as string);
                      console.log('[InHouseIssueModule] ✓ Issue deleted from Firestore:', toDelete.id);
                    } catch (err) {
                      console.error('[InHouseIssueModule] Failed to delete issue:', err);
                    }
                  })();
                }} style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button 
        onClick={editIssueIdx !== null ? handleUpdateIssue : handleAddIssue} 
        style={{marginBottom: 16}}
        disabled={!userUid}
        title={!userUid ? 'Please sign in to add/update issues' : ''}
      >
        {editIssueIdx !== null ? 'Update In House Issue' : 'Add In House Issue'}
      </button>
      <h3>In House Issues</h3>
      <table border={1} cellPadding={6} style={{ width: '100%', marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Req. No</th>
            <th>Req. Date</th>
            <th>Indent No</th>
            <th>OA No</th>
            <th>PO No</th>
            <th>Issue No</th>
            <th>Item Name</th>
            <th>Item Code</th>
            <th>Transaction Type</th>
            <th>Batch No</th>
            <th>Req By</th>
            <th>In Stock</th>
            <th>Received Date (FIFO)</th>
            <th>Issue Qty</th>
            <th>Req Closed</th>
            <th>Edit</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {issues.flatMap((issue, idx) =>
            issue.items.map((item, i) => (
              <tr key={`${idx}-${i}`}>
                <td>{issue.reqNo}</td>
                <td>{issue.reqDate}</td>
                <td>{issue.indentNo}</td>
                <td>{issue.oaNo}</td>
                <td>{issue.poNo}</td>
                <td>{issue.issueNo}</td>
                <td>{item.itemName}</td>
                <td>{item.itemCode}</td>
                <td>{item.transactionType}</td>
                <td>{item.batchNo}</td>
                <td>{item.reqBy}</td>
                <td>{item.inStock}</td>
                <td>{item.receivedDate}</td>
                <td>{item.issueQty}</td>
                <td>{item.reqClosed ? 'Yes' : 'No'}</td>
                <td><button style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }} onClick={() => handleEditIssue(idx)}>Edit</button></td>
                <td><button onClick={() => handleDeleteItem(idx, i)} style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>Delete</button></td>
              </tr>
            ))
         )}
        </tbody>
      </table>

      {/* DEBUG PANEL */}
      <div style={{ marginTop: 40, borderTop: '2px solid #ddd', paddingTop: 20 }}>
        <button 
          onClick={() => setDebugPanelOpen(!debugPanelOpen)}
          style={{ 
            background: '#ff9800', 
            color: 'white', 
            padding: '10px 20px', 
            border: 'none', 
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold'
          }}
        >
          {debugPanelOpen ? '🐛 Hide DEBUG PANEL' : '🐛 Show DEBUG PANEL'}
        </button>

        {debugPanelOpen && (
          <div style={{ 
            marginTop: 20, 
            background: '#f5f5f5', 
            border: '2px solid #ff9800',
            padding: 20,
            borderRadius: 8,
            fontSize: 12
          }}>
            <h3 style={{ marginTop: 0, color: '#ff6f00' }}>🔧 Debug Panel - Batch Filtering Logic</h3>
            
            <div style={{ marginBottom: 20 }}>
              <strong>📋 Current Selection:</strong>
              <div style={{ background: 'white', padding: 10, marginTop: 5, borderRadius: 4, fontFamily: 'monospace' }}>
                <div>Item Name: <strong>{itemInput.itemName || 'N/A'}</strong></div>
                <div>Item Code: <strong>{itemInput.itemCode || 'N/A'}</strong></div>
                <div>Transaction Type: <strong>{itemInput.transactionType || 'N/A'}</strong></div>
                <div>Selected Batch: <strong>{itemInput.batchNo || 'N/A'}</strong></div>
              </div>
            </div>

            {itemInput.transactionType === 'Purchase' && (
              <div style={{ marginBottom: 20 }}>
                <strong>🏭 PURCHASE Transaction Type - Batch Analysis:</strong>
                <div style={{ background: 'white', padding: 10, marginTop: 5, borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>
                  <div style={{ marginBottom: 10 }}>
                    <strong>All PSIR Batches Available:</strong>
                    <div style={{ paddingLeft: 10 }}>
                      {psirBatchNos.length > 0 ? (
                        psirBatchNos.map((batch) => {
                          const okQty = getPsirOkQtyForBatch(batch, itemInput.itemCode);
                          const issuedQty = getIssuedQtyForBatch(batch, 'Purchase', itemInput.itemCode);
                          const pendingQty = getPendingOkQtyForBatch(batch, 'Purchase', itemInput.itemCode);
                          const willShow = pendingQty > 0;
                          
                          return (
                            <div key={batch} style={{ 
                              padding: 8, 
                              margin: 5, 
                              background: willShow ? '#e8f5e9' : '#ffebee',
                              borderLeft: `3px solid ${willShow ? '#4caf50' : '#f44336'}`,
                              borderRadius: 3
                            }}>
                              <div><strong>{batch}</strong> {willShow ? '✅' : '❌'}</div>
                              <div>  OK Qty: {okQty} | Issued: {issuedQty} | Pending: {pendingQty}</div>
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ color: '#999' }}>No PSIR batches found</div>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 15, paddingTop: 10, borderTop: '1px solid #ddd' }}>
                    <strong>Dropdown will show:</strong>
                    <div style={{ paddingLeft: 10, color: '#2196f3' }}>
                      {getPsirBatchNosWithPending(itemInput.itemCode).length > 0 ? (
                        getPsirBatchNosWithPending(itemInput.itemCode).map(b => (
                          <div key={b}>✓ {b} (Pending: {getPendingOkQtyForBatch(b, 'Purchase', itemInput.itemCode)})</div>
                        ))
                      ) : (
                        <div style={{ color: '#f44336' }}>❌ No batches (all fully issued)</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {itemInput.transactionType === 'Vendor' && (
              <div style={{ marginBottom: 20 }}>
                <strong>🏪 VENDOR Transaction Type - Batch Analysis:</strong>
                <div style={{ background: 'white', padding: 10, marginTop: 5, borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>
                  <div style={{ marginBottom: 10 }}>
                    <strong>All VSIR Batches Available:</strong>
                    <div style={{ paddingLeft: 10 }}>
                      {vsirBatchNos.length > 0 ? (
                        vsirBatchNos.map((batch) => {
                          const okQty = getVsirOkQtyForBatch(batch, itemInput.itemCode);
                          const issuedQty = getIssuedQtyForBatch(batch, 'Vendor', itemInput.itemCode);
                          const pendingQty = getPendingOkQtyForBatch(batch, 'Vendor', itemInput.itemCode);
                          const willShow = pendingQty > 0;
                          
                          return (
                            <div key={batch} style={{ 
                              padding: 8, 
                              margin: 5, 
                              background: willShow ? '#e8f5e9' : '#ffebee',
                              borderLeft: `3px solid ${willShow ? '#4caf50' : '#f44336'}`,
                              borderRadius: 3
                            }}>
                              <div><strong>{batch}</strong> {willShow ? '✅' : '❌'}</div>
                              <div>  OK Qty: {okQty} | Issued: {issuedQty} | Pending: {pendingQty}</div>
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ color: '#999' }}>No VSIR batches found</div>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 15, paddingTop: 10, borderTop: '1px solid #ddd' }}>
                    <strong>Dropdown will show:</strong>
                    <div style={{ paddingLeft: 10, color: '#2196f3' }}>
                      {getVsirBatchNosWithPending(itemInput.itemCode).length > 0 ? (
                        getVsirBatchNosWithPending(itemInput.itemCode).map(b => (
                          <div key={b}>✓ {b} (Pending: {getPendingOkQtyForBatch(b, 'Vendor', itemInput.itemCode)})</div>
                        ))
                      ) : (
                        <div style={{ color: '#f44336' }}>❌ No batches (all fully issued)</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {itemInput.transactionType === 'Stock' && (
              <div style={{ marginBottom: 20 }}>
                <strong>📦 STOCK Transaction Type - Quantity Analysis:</strong>
                <div style={{ background: 'white', padding: 10, marginTop: 5, borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>
                  <div style={{ marginBottom: 10 }}>
                    <strong>All Stock Quantities Available:</strong>
                    <div style={{ paddingLeft: 10 }}>
                      {stockQuantities.length > 0 ? (
                        getStockQuantities(itemInput.itemCode).map((qty) => {
                          let totalIssued = 0;
                          
                          // Check in-house issues
                          const issuesRaw = localStorage.getItem('inHouseIssueData');
                          if (issuesRaw) {
                            const issuesData = JSON.parse(issuesRaw);
                            if (Array.isArray(issuesData)) {
                              issuesData.forEach((issue: any) => {
                                if (Array.isArray(issue.items)) {
                                  issue.items.forEach((item: any) => {
                                    if (item.batchNo === qty && item.itemCode === itemInput.itemCode && item.transactionType === 'Stock') {
                                      totalIssued += item.issueQty || 0;
                                    }
                                  });
                                }
                              });
                            }
                          }
                          
                          // Check vendor issues
                          const vendorIssuesRaw = localStorage.getItem('vendorIssueData');
                          if (vendorIssuesRaw) {
                            const vendorIssuesData = JSON.parse(vendorIssuesRaw);
                            if (Array.isArray(vendorIssuesData)) {
                              vendorIssuesData.forEach((issue: any) => {
                                if (Array.isArray(issue.items)) {
                                  issue.items.forEach((item: any) => {
                                    if (issue.batchNo === qty && item.itemCode === itemInput.itemCode) {
                                      totalIssued += item.qty || 0;
                                    }
                                  });
                                }
                              });
                            }
                          }
                          
                          const numQty = parseInt(qty, 10);
                          const pending = numQty - totalIssued;
                          const willShow = pending > 0;
                          
                          return (
                            <div key={qty} style={{ 
                              padding: 8, 
                              margin: 5, 
                              background: willShow ? '#e8f5e9' : '#ffebee',
                              borderLeft: `3px solid ${willShow ? '#4caf50' : '#f44336'}`,
                              borderRadius: 3
                            }}>
                              <div><strong>Qty: {qty}</strong> {willShow ? '✅' : '❌'}</div>
                              <div>  In-House Issued: {totalIssued} | Pending: {pending}</div>
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ color: '#999' }}>No stock quantities found</div>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 15, paddingTop: 10, borderTop: '1px solid #ddd' }}>
                    <strong>Dropdown will show:</strong>
                    <div style={{ paddingLeft: 10, color: '#2196f3' }}>
                      {getAvailableStockQuantities(itemInput.itemCode).length > 0 ? (
                        getAvailableStockQuantities(itemInput.itemCode).map(qty => (
                          <div key={qty}>✓ Stock Qty: {qty}</div>
                        ))
                      ) : (
                        <div style={{ color: '#f44336' }}>❌ No stock quantities (all fully issued)</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 20, paddingTop: 10, borderTop: '1px solid #ccc', fontSize: 11, color: '#666' }}>
              <strong>📝 Formula:</strong>
              <div>Pending Qty = Available Qty - (In-House Issued + Vendor Issued)</div>
              <div>✅ Show in dropdown if: Pending Qty &gt; 0</div>
              <div>❌ Hide from dropdown if: Pending Qty = 0 (already fully issued)</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InHouseIssueModule;
