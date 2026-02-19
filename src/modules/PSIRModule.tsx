import React, { useState, useEffect, useRef } from 'react';
import bus from '../utils/eventBus';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { addPsir, updatePsir, subscribePsirs, deletePsir } from '../utils/psirService';
import { getItemMaster, getPurchaseData, getIndentData, getStockRecords, getPurchaseOrders, updatePurchaseData, updatePurchaseOrder } from '../utils/firestoreServices';

interface PSIRItem {
  itemName: string;
  itemCode: string;
  qtyReceived: number;
  okQty: number;
  rejectQty: number;
  grnNo: string;
  remarks: string;
  poQty?: number;
}

interface PSIR {
  id?: string;
  userId?: string;
  receivedDate: string;
  indentNo: string;
  poNo: string;
  oaNo: string;
  batchNo: string;
  invoiceNo: string;
  supplierName: string;
  items: PSIRItem[];
  createdAt?: any;
  updatedAt?: any;
}

interface PurchaseOrder {
  poNo: string;
  indentNo?: string;
  supplierName?: string;
  orderPlaceDate?: string;
  items?: { poNo?: string; indentNo?: string; itemName?: string; itemCode?: string }[];
}

const PSIRModule: React.FC = () => {
  const [psirs, setPsirs] = useState<PSIR[]>([]);

  const [newPSIR, setNewPSIR] = useState<PSIR>({
    receivedDate: '',
    indentNo: '',
    poNo: '',
    oaNo: '',
    batchNo: '',
    invoiceNo: '',
    supplierName: '',
    items: [],
  });

  const [itemInput, setItemInput] = useState<PSIRItem>({
    itemName: '',
    itemCode: '',
    qtyReceived: 0,
    okQty: 0,
    rejectQty: 0,
    grnNo: '',
    remarks: '',
  });

  const [editItemIdx, setEditItemIdx] = useState<number | null>(null);
  
  const [itemNames, setItemNames] = useState<string[]>([]);
  const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseData, setPurchaseData] = useState<any[]>([]);
  const [indentData, setIndentData] = useState<any[]>([]);
  const [stockRecords, setStockRecords] = useState<any[]>([]);
  const [editPSIRIdx, setEditPSIRIdx] = useState<number | null>(null);
  const [processedPOs, setProcessedPOs] = useState<Set<string>>(new Set());
  const [deletedPOKeys, setDeletedPOKeys] = useState<Set<string>>(new Set());
  const [psirDebugOpen, setPsirDebugOpen] = useState<boolean>(false);
  const [psirDebugOutput, setPsirDebugOutput] = useState<string>('');
  const [psirDebugExtra, setPsirDebugExtra] = useState<string>('');
  const [deleteDebugOpen, setDeleteDebugOpen] = useState<boolean>(false);
  const [deleteDebugInfo, setDeleteDebugInfo] = useState<string>('');

  const [userUid, setUserUid] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      console.info('[PSIRModule] Auth state changed - userUid:', uid);
      setUserUid(uid);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    if (!userUid) {
      console.debug('[PSIRModule] Skipping PSIR subscription - no userUid');
      return;
    }
    console.debug('[PSIRModule] Setting up PSIR subscription for userId:', userUid);
    unsub = subscribePsirs(userUid, (docs) => {
      console.group('[PSIRModule] SUBSCRIPTION UPDATE RECEIVED');
      console.log('📬 Firestore callback triggered');
      console.log('📊 Documents received from Firestore:', docs.length);
      console.log('📋 Document IDs:', docs.map(d => d.id));
      
      const newPsirs = docs.map(d => ({ ...d })) as any[];
      const normalized = newPsirs.map((psir: any) => ({ ...psir, items: Array.isArray(psir.items) ? psir.items : [] }));
      
      console.log('✅ Normalized PSIR data - count:', normalized.length);
      console.log('📝 PSIR records:', normalized.map(p => ({ id: p.id, indentNo: p.indentNo, itemCount: p.items.length })));
      
      setPsirs(normalized);
      const existingPOs = new Set(normalized.map((psir: any) => psir.poNo).filter(Boolean));
      const existingIndents = new Set(normalized.map((psir: any) => `INDENT::${psir.indentNo}`).filter(id => id !== 'INDENT::'));
      setProcessedPOs(new Set([...existingPOs, ...existingIndents]));
      
      console.log('🎯 State updated - new psirs count:', normalized.length);
      console.log('✅ Subscription callback complete');
      console.groupEnd();
    });

    return () => {
      console.debug('[PSIRModule] Unsubscribing from PSIR subscription');
      if (unsub) unsub();
    };
  }, [userUid]);

  useEffect(() => {
    const loadPurchaseOrders = async () => {
      try {
        if (!userUid) {
          console.debug('[PSIRModule] Skipping loadPurchaseOrders: no userUid');
          return;
        }
        console.info('[PSIRModule] Starting purchase orders load for user:', userUid);
        const orders = await getPurchaseOrders(userUid);
        console.debug('[PSIRModule] getPurchaseOrders returned:', {
          isArray: Array.isArray(orders),
          length: Array.isArray(orders) ? orders.length : 'N/A',
          data: orders
        });
        
        if (Array.isArray(orders)) {
          console.info('[PSIRModule][Init] Loaded', orders.length, 'purchase orders from Firestore');
          setPurchaseOrders(orders as any as PurchaseOrder[]);
          if (orders.length > 0 && !newPSIR.poNo) {
            const latestOrder: any = orders[orders.length - 1];
            console.debug('[PSIRModule] Auto-filling first PO:', latestOrder.poNo);
            setNewPSIR(prev => ({
              ...prev,
              poNo: latestOrder.poNo || '',
              supplierName: latestOrder.supplierName || '',
              indentNo: latestOrder.indentNo || '',
            }));
          }
        } else {
          console.error('[PSIRModule][Init] getPurchaseOrders returned non-array:', typeof orders);
        }
      } catch (e) {
        console.error('[PSIRModule][Init] Error loading purchaseOrders from Firestore:', e);
      }
    };
    
    loadPurchaseOrders();
  }, [userUid]);

  useEffect(() => {
    if (!newPSIR.poNo) return;
    
    // Use purchaseOrders if available, fallback to purchaseData for auto-fill
    const ordersToSearch = purchaseOrders.length > 0 ? purchaseOrders : purchaseData;
    
    if (ordersToSearch.length === 0) {
      console.debug('[PSIRModule][AutoFill] No purchaseOrders or purchaseData available');
      return;
    }
    
    try {
      const matchingPO = ordersToSearch.find(po => po.poNo === newPSIR.poNo);
      
      if (matchingPO) {
        setNewPSIR(prev => ({ 
          ...prev, 
          indentNo: matchingPO.indentNo || prev.indentNo,
          oaNo: (matchingPO as any).oaNo || prev.oaNo,
          supplierName: matchingPO.supplierName || prev.supplierName
        }));
        
        if (matchingPO.items && matchingPO.items.length > 0) {
          const firstItem = matchingPO.items[0] as any;
          setItemInput(prev => ({
            ...prev,
            itemName: firstItem.itemName || firstItem.Item || prev.itemName,
            itemCode: firstItem.itemCode || firstItem.Code || prev.itemCode,
          }));
        } else {
          const poAny = matchingPO as any;
          const topName = poAny.itemName || poAny.Item || poAny.model || '';
          const topCode = poAny.itemCode || poAny.Code || poAny.CodeNo || '';
          if (topName || topCode) {
            setItemInput(prev => ({
              ...prev,
              itemName: topName || prev.itemName,
              itemCode: topCode || prev.itemCode,
            }));
          }
        }
        
        if (!matchingPO.supplierName && purchaseData.length > 0) {
          const found = purchaseData.find((p: any) => String(p.poNo || '').trim() === String(matchingPO.poNo || '').trim() || String(p.indentNo || '').trim() === String(matchingPO.indentNo || '').trim());
          if (found && (found.supplierName || found.supplier)) {
            const supplierVal = String(found.supplierName || found.supplier || '').trim();
            if (supplierVal) {
              setNewPSIR(prev => ({ ...prev, supplierName: supplierVal }));
            }
          }
        }

        console.debug('[PSIRModule][AutoFill] Auto-filled from PO:', matchingPO);
      }
    } catch (e) {
      console.error('[PSIRModule][AutoFill] Error processing auto-fill:', e);
    }
  }, [newPSIR.poNo, purchaseOrders, purchaseData]);

  useEffect(() => {
    if (itemInput.itemName && itemMaster.length > 0) {
      const matchedItem = itemMaster.find(item => item.itemName === itemInput.itemName);
      if (matchedItem && matchedItem.itemCode !== itemInput.itemCode) {
        setItemInput(prev => ({
          ...prev,
          itemCode: matchedItem.itemCode
        }));
      }
    }
  }, [itemInput.itemName, itemMaster]);

  useEffect(() => {
    if (newPSIR.invoiceNo && !newPSIR.batchNo) {
      const nextBatchNo = getNextBatchNo();
      setNewPSIR(prev => ({
        ...prev,
        batchNo: nextBatchNo
      }));
    }
  }, [newPSIR.invoiceNo, psirs]);

  useEffect(() => {
    const loadData = async () => {
      try {
        console.info('[PSIRModule] Starting data load for user:', userUid);
        const [itemMasterData, purchaseDataData, indentDataData, stockDataData] = await Promise.all([
          getItemMaster(userUid || ''),
          getPurchaseData(userUid || ''),
          getIndentData(userUid || ''),
          getStockRecords(userUid || ''),
        ]);
        
        console.debug('[PSIRModule] Data load completed:', {
          itemMasterCount: Array.isArray(itemMasterData) ? itemMasterData.length : 'not-array',
          purchaseDataCount: Array.isArray(purchaseDataData) ? purchaseDataData.length : 'not-array',
          indentDataCount: Array.isArray(indentDataData) ? indentDataData.length : 'not-array',
          stockDataCount: Array.isArray(stockDataData) ? stockDataData.length : 'not-array',
        });
        
        if (Array.isArray(itemMasterData)) {
          setItemMaster(itemMasterData as any as { itemName: string; itemCode: string }[]);
          setItemNames((itemMasterData as any[]).map((item: any) => item.itemName).filter(Boolean));
          console.debug('[PSIRModule][Init] Loaded itemMaster from Firestore:', itemMasterData);
        } else {
          console.warn('[PSIRModule][Init] itemMasterData is not an array:', typeof itemMasterData);
        }
        
        if (Array.isArray(purchaseDataData)) {
          setPurchaseData(purchaseDataData);
          console.debug('[PSIRModule][Init] Loaded purchaseData from Firestore:', purchaseDataData.length, 'records');
        } else {
          console.warn('[PSIRModule][Init] purchaseDataData is not an array:', typeof purchaseDataData);
        }

        if (Array.isArray(indentDataData)) {
          setIndentData(indentDataData);
          console.debug('[PSIRModule][Init] Loaded indentData from Firestore:', indentDataData.length, 'records');
        } else {
          console.warn('[PSIRModule][Init] indentDataData is not an array:', typeof indentDataData);
        }

        if (Array.isArray(stockDataData)) {
          setStockRecords(stockDataData);
          console.debug('[PSIRModule][Init] Loaded stockRecords from Firestore:', stockDataData.length, 'records');
        } else {
          console.warn('[PSIRModule][Init] stockDataData is not an array:', typeof stockDataData);
        }
      } catch (e) {
        console.error('[PSIRModule][Init] Error loading initial data from Firestore:', e);
      }
    };

    if (userUid) {
      loadData();
    } else {
      console.warn('[PSIRModule] Skipping data load - userUid is not set');
    }
  }, [userUid]);

  const importAllPurchaseOrdersToPSIR = (forceImport: boolean = false) => {
    try {
      console.info('[PSIRModule]', forceImport ? '🔵 FORCE IMPORT' : '🔵 MANUAL IMPORT TRIGGERED', '- User clicked Import button');
      console.debug('[PSIRModule] purchaseOrders:', purchaseOrders);
      console.debug('[PSIRModule] purchaseData:', purchaseData);
      console.debug('[PSIRModule] psirs:', psirs);
      console.debug('[PSIRModule] userUid:', userUid);
      console.debug('[PSIRModule] processedPOs:', processedPOs);
      console.debug('[PSIRModule] forceImport:', forceImport);
      
      // Use purchaseOrders if available, fallback to purchaseData
      const ordersToImport = purchaseOrders.length > 0 ? purchaseOrders : purchaseData;
      
      if (ordersToImport.length === 0) {
        console.warn('[PSIRModule] No purchase orders or purchase data to import');
        alert('No purchase orders or purchase data found');
        return;
      }
      
      console.info('[PSIRModule] Using', purchaseOrders.length > 0 ? 'purchaseOrders' : 'purchaseData', '(' + ordersToImport.length + ' records)');

      let importedCount = 0;
      const newPSIRs: PSIR[] = [];

      ordersToImport.forEach((order, orderIdx) => {
        const poNo = String(order.poNo || '').trim();
        const indentNo = String(order.indentNo || '').trim();
        
        console.debug(`[PSIRModule] Processing order ${orderIdx}:`, { poNo, indentNo, supplierName: order.supplierName });
        
        // Skip if PO number is not present (required field)
        if (!poNo) {
          console.debug(`[PSIRModule] Skipping order ${orderIdx} - PO number is required but missing`);
          return;
        }

        let oaNoFromPurchase = '';
        if (Array.isArray(purchaseData)) {
          const purchaseMatch = purchaseData.find((p: any) => {
            const pPo = String(p.poNo || '').trim();
            const pIndent = String(p.indentNo || '').trim();
            return (poNo && pPo === poNo) || (indentNo && pIndent === indentNo);
          });
          if (purchaseMatch) {
            oaNoFromPurchase = purchaseMatch.oaNo || '';
          }
        }
        
        const orderKey = poNo;
        
        // Skip if already processed, UNLESS forceImport is true
        if (!forceImport && processedPOs.has(orderKey)) {
          console.debug(`[PSIRModule] Skipping already processed: ${orderKey}`);
          return;
        }
        
        if (deletedPOKeys.has(orderKey)) {
          console.debug(`[PSIRModule] Skipping previously deleted: ${orderKey} (will not re-import)`);
          return;
        }

        const existingIdx = psirs.findIndex(psir => {
          const psirPo = String(psir.poNo || '').trim();
          return poNo && psirPo === poNo;
        });

        let itemsFromPO: PSIRItem[] = [];
        
        if (Array.isArray(order.items) && order.items.length > 0) {
          itemsFromPO = order.items.map((it: any) => {
            const code = it.itemCode || it.Code || it.itemCode || '';
            return ({
              itemName: it.itemName || it.Item || it.model || '',
              itemCode: code,
              qtyReceived: 0,
              okQty: 0,
              rejectQty: 0,
              grnNo: '',
              remarks: '',
              poQty: getPOQtyFor(poNo, indentNo, code),
            });
          });
        } else {
          const orderAny = order as any;
          const topName = orderAny.itemName || orderAny.Item || orderAny.model || '';
          const topCode = orderAny.itemCode || orderAny.Code || orderAny.CodeNo || '';
          
            if (topName || topCode) {
            itemsFromPO = [{
              itemName: topName,
              itemCode: topCode,
              qtyReceived: 0,
              okQty: 0,
              rejectQty: 0,
              grnNo: '',
              remarks: '',
              poQty: getPOQtyFor(poNo, indentNo, topCode),
            }];
          } else {
            try {
              const matched = Array.isArray(purchaseData) ? purchaseData.filter((p: any) => {
                const pPo = String(p.poNo || '').trim();
                const pIndent = String(p.indentNo || '').trim();
                return (poNo && pPo === poNo) || (indentNo && pIndent === indentNo);
              }) : [];

                if (matched.length > 0) {
                const supplierFromMatched = String(matched[0].supplierName || matched[0].supplier || '').trim();
                itemsFromPO = matched.map((p: any) => {
                  const code = p.itemCode || p.Code || p.CodeNo || '';
                  return ({
                    itemName: p.itemName || p.Item || p.model || '',
                    itemCode: code,
                    qtyReceived: 0,
                    okQty: 0,
                    rejectQty: 0,
                    grnNo: '',
                    remarks: '',
                    poQty: getPOQtyFor(poNo, indentNo, code),
                  });
                });
                if (supplierFromMatched) {
                  order.supplierName = order.supplierName || supplierFromMatched;
                }
              } else {
                itemsFromPO = [{ 
                  itemName: '', 
                  itemCode: '', 
                  qtyReceived: 0, 
                  okQty: 0, 
                  rejectQty: 0, 
                  grnNo: '', 
                  remarks: '' 
                }];
              }
            } catch (err) {
              itemsFromPO = [{ 
                itemName: '', 
                itemCode: '', 
                qtyReceived: 0, 
                okQty: 0, 
                rejectQty: 0, 
                grnNo: '', 
                remarks: '' 
              }];
            }
          }
        }

        if (existingIdx !== -1) {
          const existing = psirs[existingIdx];
          let updated = false;
          const updatedPsirs = [...psirs];
          const candidateSupplier = String(order.supplierName || '').trim();

          const newRec = { ...existing } as PSIR;
          if ((!newRec.supplierName || String(newRec.supplierName).trim() === '') && candidateSupplier) {
            newRec.supplierName = candidateSupplier;
            updated = true;
          }
          if ((!newRec.oaNo || String(newRec.oaNo).trim() === '') && oaNoFromPurchase) {
            newRec.oaNo = oaNoFromPurchase;
            updated = true;
          }
          if ((!Array.isArray(newRec.items) || newRec.items.length === 0) && Array.isArray(itemsFromPO) && itemsFromPO.length > 0) {
            newRec.items = itemsFromPO;
            updated = true;
          }

          if (updated) {
            updatedPsirs[existingIdx] = newRec;
            setPsirs(updatedPsirs);
            if (userUid && (newRec as any).id) {
              (async () => {
                try {
                  await updatePsir((newRec as any).id, newRec);
                } catch (e) {
                  console.error('[PSIRModule] Failed to update PSIR in Firestore', e);
                }
              })();
            }
            try { bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { psirs: updatedPsirs } })); } catch (err) {}
            importedCount++;
            setProcessedPOs(prev => new Set([...prev, orderKey]));
          } else {
            console.debug(`[PSIRModule] PSIR already exists and has data for: ${orderKey}`);
          }
        } else {
          const newPSIRRecord: PSIR = {
            receivedDate: new Date().toISOString().slice(0, 10),
            indentNo: indentNo,
            poNo: poNo,
            oaNo: oaNoFromPurchase || '',
            batchNo: '',
            invoiceNo: '',
            supplierName: order.supplierName || '',
            items: itemsFromPO,
          };

          newPSIRs.push(newPSIRRecord);
          importedCount++;
          setProcessedPOs(prev => new Set([...prev, orderKey]));
        }
      });

      if (importedCount > 0) {
        console.info('[PSIRModule] Import complete - imported', importedCount, 'records, saving to Firestore...');
        setPsirs(prev => {
          const updated = [...prev, ...newPSIRs];
          console.debug('[PSIRModule] Updated local PSIRs state with', newPSIRs.length, 'new records');
          newPSIRs.forEach((psir, idx) => {
            if (userUid) {
              console.debug('[PSIRModule] Saving PSIR', idx, 'to Firestore for userId:', userUid);
              (async () => {
                try {
                  const result = await addPsir(userUid, psir);
                  console.debug('[PSIRModule] Successfully saved PSIR', idx, 'with id:', result);
                } catch (e) {
                  console.error('[PSIRModule] Failed to add PSIR to Firestore', idx, e);
                }
              })();
            } else {
              console.warn('[PSIRModule] Cannot save PSIR - no userUid');
            }
          });
          try { bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { psirs: updated } })); } catch (err) {}
          return updated;
        });
        alert(`✅ Successfully imported ${importedCount} purchase orders/indents to PSIR`);
      } else {
        console.warn('[PSIRModule] No new purchase orders/indents were imported');
        alert('No new purchase orders/indents to import (all are already processed)');
      }

    } catch (error) {
      console.error('[PSIRModule] Error importing all purchase orders:', error);
      alert('Error importing purchase orders: ' + String(error));
    }
  };

  // DISABLED: Auto-import functionality removed
  // Users should now click "Import All Purchase Orders to PSIR" button manually
  // useEffect(() => {
  //   // Auto-import logic was here but disabled to allow manual-only imports
  // }, [userUid, purchaseOrders.length, purchaseData.length]);

  // NEW: Clean up orphaned PSIR records when their source Purchase Order is deleted
  useEffect(() => {
    const ordersToCheck = purchaseOrders.length > 0 ? purchaseOrders : purchaseData;
    if (!userUid || psirs.length === 0 || ordersToCheck.length === 0) return;
    
    console.debug('[PSIRModule] Checking for orphaned PSIR records...');
    
    const existingPOKeys = new Set<string>();
    ordersToCheck.forEach(order => {
      const poNo = String(order.poNo || '').trim();
      const indentNo = String(order.indentNo || '').trim();
      if (poNo) existingPOKeys.add(poNo);
      if (indentNo) existingPOKeys.add(`INDENT::${indentNo}`);
    });
    
    const orphanedPSIRs: string[] = [];
    psirs.forEach(psir => {
      const poNo = String(psir.poNo || '').trim();
      const indentNo = String(psir.indentNo || '').trim();
      const key = poNo ? poNo : `INDENT::${indentNo}`;
      
      if (!existingPOKeys.has(key) && !existingPOKeys.has(poNo) && !existingPOKeys.has(`INDENT::${indentNo}`)) {
        if ((psir as any).id) {
          orphanedPSIRs.push((psir as any).id);
          console.log('[PSIRModule] Found orphaned PSIR:', { id: (psir as any).id, poNo, indentNo, key });
        }
      }
    });
    
    if (orphanedPSIRs.length > 0) {
      console.info(`[PSIRModule] Deleting ${orphanedPSIRs.length} orphaned PSIR records...`);
      (async () => {
        try {
          await Promise.all(orphanedPSIRs.map(id => deletePsir(id)));
          console.info('[PSIRModule] Successfully deleted orphaned PSIR records');
          
          setPsirs(prevPsirs => prevPsirs.filter(p => !(p as any).id || !orphanedPSIRs.includes((p as any).id)));
          
          setProcessedPOs(prev => {
            const updated = new Set(prev);
            psirs.forEach(psir => {
              if (orphanedPSIRs.includes((psir as any).id)) {
                const poNo = String(psir.poNo || '').trim();
                const indentNo = String(psir.indentNo || '').trim();
                const key = poNo ? poNo : `INDENT::${indentNo}`;
                updated.delete(key);
              }
            });
            return updated;
          });
          
        } catch (err) {
          console.error('[PSIRModule] Error deleting orphaned PSIR records:', err);
        }
      })();
    }
  }, [userUid, psirs, purchaseOrders, purchaseData]);

  const handleAddItem = () => {
    if (!itemInput.itemName || !itemInput.itemCode) {
      alert('Item Name and Item Code are required');
      return;
    }

    let qtyToUse = Number(itemInput.qtyReceived) || 0;
    const ok = Number(itemInput.okQty) || 0;
    const rej = Number(itemInput.rejectQty) || 0;
    if (qtyToUse <= 0) {
      qtyToUse = ok + rej;
    }
    if (qtyToUse !== (ok + rej)) {
      alert('PO must equal OK Qty + Reject Qty');
      return;
    }
    const poQ = getPOQtyFor(newPSIR.poNo, newPSIR.indentNo, itemInput.itemCode);
    setNewPSIR(prev => ({ ...prev, items: [...prev.items, { ...itemInput, qtyReceived: qtyToUse, poQty: poQ }] }));
    const addedItem = { ...itemInput, qtyReceived: qtyToUse, poQty: poQ };
    setItemInput({ itemName: '', itemCode: '', qtyReceived: 0, okQty: 0, rejectQty: 0, grnNo: '', remarks: '' });
    setEditItemIdx(null);
    try {
      bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { draftItem: addedItem } }));
    } catch (err) {}
  };

  const handleEditItem = (idx: number) => {
    const it = newPSIR.items[idx] || {} as any;
    setItemInput({
      itemName: it.itemName || '',
      itemCode: it.itemCode || '',
      qtyReceived: it.qtyReceived ?? 0,
      okQty: it.okQty ?? 0,
      rejectQty: it.rejectQty ?? 0,
      grnNo: it.grnNo || '',
      remarks: it.remarks || '',
      poQty: it.poQty ?? undefined,
    });
    setEditItemIdx(idx);
  };

  const handleUpdateItem = () => {
    if (editItemIdx === null) return;
    let qtyToUse = Number(itemInput.qtyReceived) || 0;
    const ok = Number(itemInput.okQty) || 0;
    const rej = Number(itemInput.rejectQty) || 0;
    if (qtyToUse <= 0) qtyToUse = ok + rej;
    if (qtyToUse !== (ok + rej)) {
      alert('PO must equal OK Qty + Reject Qty');
      return;
    }
    const updatedItems = newPSIR.items.map((item, idx) => (idx === editItemIdx ? { ...itemInput, qtyReceived: qtyToUse, poQty: getPOQtyFor(newPSIR.poNo, newPSIR.indentNo, itemInput.itemCode) } : item));
    setNewPSIR(prev => ({ ...prev, items: updatedItems }));
    setItemInput({ itemName: '', itemCode: '', qtyReceived: 0, okQty: 0, rejectQty: 0, grnNo: '', remarks: '' });
    setEditItemIdx(null);
  };

  const handleAddPSIR = () => {
    if (!newPSIR.receivedDate || !newPSIR.indentNo || !newPSIR.poNo || !newPSIR.invoiceNo || !newPSIR.supplierName || newPSIR.items.length === 0) {
      alert('All fields are required, and at least one item must be added');
      return;
    }
    
    let psirToSave = { ...newPSIR };
    if (!psirToSave.batchNo || psirToSave.batchNo.trim() === '') {
      console.log('[PSIR] handleAddPSIR - batchNo is empty, generating');
      psirToSave.batchNo = getNextBatchNo();
      console.log('[PSIR] handleAddPSIR - generated batchNo:', psirToSave.batchNo);
    }
    
    const normalizedItems = psirToSave.items.map(it => ({ ...it, poQty: getPOQtyFor(psirToSave.poNo, psirToSave.indentNo, it.itemCode) }));

    if (userUid) {
      (async () => {
        try {
          await addPsir(userUid, { ...psirToSave, items: normalizedItems });
        } catch (e) {
          console.error('[PSIRModule] Failed to add PSIR to Firestore', e);
          alert('Error saving to Firestore: ' + String(e));
        }
      })();
    } else {
      alert('User not authenticated');
    }

    setNewPSIR({ receivedDate: '', indentNo: '', poNo: '', oaNo: '', batchNo: '', invoiceNo: '', supplierName: '', items: [] });
    setItemInput({ itemName: '', itemCode: '', qtyReceived: 0, okQty: 0, rejectQty: 0, grnNo: '', remarks: '' });
    setEditPSIRIdx(null);
  };

  const handleEditPSIR = (idx: number) => {
    const psirToEdit = psirs[idx];
    const cloned: PSIR = {
      ...psirToEdit,
      items: psirToEdit.items.map(item => ({ ...item })),
    };
    setNewPSIR(cloned);
    setEditPSIRIdx(idx);
  };

  const handleUpdatePSIR = () => {
    if (editPSIRIdx === null) return;
    if (!newPSIR.receivedDate || !newPSIR.indentNo || !newPSIR.poNo || !newPSIR.invoiceNo || !newPSIR.supplierName || newPSIR.items.length === 0) {
      alert('All fields are required, and at least one item must be added');
      return;
    }
    
    let psirToSave = { ...newPSIR };
    if (!psirToSave.batchNo || psirToSave.batchNo.trim() === '') {
      console.log('[PSIR] handleUpdatePSIR - batchNo is empty, generating');
      psirToSave.batchNo = getNextBatchNo();
      console.log('[PSIR] handleUpdatePSIR - generated batchNo:', psirToSave.batchNo);
    }
    
    const updatedLocal = psirs.map((psir, idx) => (idx === editPSIRIdx ? { ...psirToSave, items: psirToSave.items.map(it => ({ ...it, poQty: getPOQtyFor(psirToSave.poNo, psirToSave.indentNo, it.itemCode) })) } : psir));

    const target = psirs[editPSIRIdx!];
    const docId = target && (target as any).id;

    if (userUid && docId) {
      (async () => {
        try {
          await updatePsir(docId, { ...psirToSave, items: psirToSave.items.map(it => ({ ...it, poQty: getPOQtyFor(psirToSave.poNo, psirToSave.indentNo, it.itemCode) })) });
        } catch (e) {
          console.error('[PSIRModule] Failed to update PSIR in Firestore', e);
          alert('Error updating in Firestore: ' + String(e));
        }
      })();
    } else {
      setPsirs(updatedLocal);
      try { bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { psirs: updatedLocal } })); } catch (err) {}
    }

    setNewPSIR({ receivedDate: '', indentNo: '', poNo: '', oaNo: '', batchNo: '', invoiceNo: '', supplierName: '', items: [] });
    setItemInput({ itemName: '', itemCode: '', qtyReceived: 0, okQty: 0, rejectQty: 0, grnNo: '', remarks: '' });
    setEditPSIRIdx(null);
  };

  const handleItemInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const newValue = type === 'number' ? (value === '' ? '' : Number(value)) : value;
    setItemInput(prev => ({
      ...prev,
      [name]: newValue,
    }));
  };

  const generateDeleteDebugInfo = (psirIdx: number, itemIdx: number, status: string, error?: any) => {
    const target = psirs[psirIdx];
    const timestamp = new Date().toISOString();
    const debugData = {
      timestamp,
      status,
      userAuthentication: {
        userUid: userUid || 'NOT LOGGED IN',
        isAuthenticated: userUid ? 'YES' : 'NO'
      },
      indices: {
        psirIdx,
        itemIdx,
        totalPsirs: psirs.length
      },
      psirRecord: target ? {
        id: (target as any).id || 'MISSING ID - THIS IS THE PROBLEM!',
        receivedDate: target.receivedDate,
        indentNo: target.indentNo,
        poNo: target.poNo,
        supplierName: target.supplierName,
        itemsCount: target.items?.length || 0
      } : 'PSIR NOT FOUND AT INDEX',
      itemToDelete: target && target.items?.[itemIdx] ? {
        itemName: target.items[itemIdx].itemName,
        itemCode: target.items[itemIdx].itemCode,
        qtyReceived: target.items[itemIdx].qtyReceived
      } : 'ITEM NOT FOUND',
      operation: {
        willDelete: target && target.items?.length === 1 ? 'ENTIRE PSIR' : 'ONLY THIS ITEM'
      },
      error: error ? {
        message: error.message,
        code: (error as any).code,
        fullError: String(error)
      } : 'NO ERROR'
    };
    
    const debugString = JSON.stringify(debugData, null, 2);
    console.error('[DEBUG] Delete Operation Report:\n', debugString);
    return debugString;
  };

  const handleDeleteItem = async (psirIdx: number, itemIdx: number) => {
    console.group('handleDeleteItem execution trace');
    console.log('📍 Trace Step 1: Function entry');
    console.log('   psirIdx:', psirIdx, 'itemIdx:', itemIdx, 'totalPsirs:', psirs.length);
    
    const target = psirs[psirIdx];
    
    if (!target) {
      console.log('❌ Trace Step 2: PSIR not found at index', psirIdx);
      const debugInfo = generateDeleteDebugInfo(psirIdx, itemIdx, 'FAILED_PSIR_NOT_FOUND');
      setDeleteDebugInfo(debugInfo);
      setDeleteDebugOpen(true);
      console.error('[PSIRModule] Target PSIR not found at index', psirIdx);
      console.groupEnd();
      alert('Error: Could not find PSIR record. Check debug panel.');
      return;
    }
    console.log('✅ Trace Step 2: PSIR found at index', psirIdx);

    if (!userUid) {
      console.log('❌ Trace Step 3: User not authenticated');
      const debugInfo = generateDeleteDebugInfo(psirIdx, itemIdx, 'FAILED_NOT_AUTHENTICATED');
      setDeleteDebugInfo(debugInfo);
      setDeleteDebugOpen(true);
      console.warn('[PSIRModule] Cannot delete: user not authenticated');
      console.groupEnd();
      alert('Error: User not authenticated. Please sign in first.');
      return;
    }
    console.log('✅ Trace Step 3: User authenticated -', userUid);

    const psirId = (target as any).id;
    if (!psirId) {
      console.log('❌ Trace Step 4: PSIR has no ID');
      const debugInfo = generateDeleteDebugInfo(psirIdx, itemIdx, 'FAILED_NO_PSIR_ID');
      setDeleteDebugInfo(debugInfo);
      setDeleteDebugOpen(true);
      console.error('[PSIRModule] Target PSIR has no ID:', target);
      console.groupEnd();
      alert('Error: PSIR record has no ID. Cannot delete. See debug panel.');
      return;
    }
    console.log('✅ Trace Step 4: PSIR ID exists -', psirId);

    console.log('📍 Trace Step 5: Creating updated PSIR object');
    const updatedTarget = { 
      ...target, 
      items: target.items.filter((_, idx) => idx !== itemIdx) 
    };
    console.log('   Remaining items after filter:', updatedTarget.items.length);

    const isDeleting = updatedTarget.items.length === 0;
    console.log('   Will delete entire PSIR?', isDeleting);

    try {
      console.log('📍 Trace Step 6: Starting Firestore operation');
      console.log('   Operation:', isDeleting ? 'deletePsir' : 'updatePsir');
      
      if (isDeleting) {
        console.log('   Calling deletePsir with ID:', psirId);
        await deletePsir(psirId);
        console.log('✅ Trace Step 6a: deletePsir completed successfully');
        
        const poNo = String(target.poNo || '').trim();
        const indentNo = String(target.indentNo || '').trim();
        const deletedKey = poNo ? poNo : `INDENT::${indentNo}`;
        setDeletedPOKeys(prev => new Set([...prev, deletedKey]));
        console.log('🚫 Marked as deleted to prevent re-import:', deletedKey);
      } else {
        console.log('   Calling updatePsir with ID:', psirId);
        await updatePsir(psirId, updatedTarget);
        console.log('✅ Trace Step 6b: updatePsir completed successfully');
      }

      console.log('📍 Trace Step 6c: Immediately updating local state (DON\'T WAIT FOR SUBSCRIPTION)');
      setPsirs(prevPsirs => {
        const updated = prevPsirs.map((p, idx) => {
          if (idx !== psirIdx) return p;
          return updatedTarget;
        });
        const filtered = updated.filter(p => p.items.length > 0);
        console.log('✅ Trace Step 6c: Local state updated - remaining PSIRs:', filtered.length);
        try { bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { psirs: filtered } })); } catch (err) {}
        return filtered;
      });

      console.log('📍 Trace Step 7: Setting success debug info');
      const successDebugInfo = generateDeleteDebugInfo(psirIdx, itemIdx, 'SUCCESS');
      setDeleteDebugInfo(successDebugInfo);
      setDeleteDebugOpen(true);
      console.log('✅ Trace Step 7: UI updated immediately - subscription will confirm the delete');
      console.groupEnd();
    } catch (e) {
      console.log('❌ Trace Step 6: ERROR during Firestore operation');
      console.error('Error object:', e);
      console.error('Error message:', (e as any)?.message);
      console.error('Error code:', (e as any)?.code);
      
      const errorDebugInfo = generateDeleteDebugInfo(psirIdx, itemIdx, 'FAILED_FIRESTORE_ERROR', e);
      setDeleteDebugInfo(errorDebugInfo);
      setDeleteDebugOpen(true);
      
      const errorMsg = (e as any)?.message || String(e);
      console.log('📍 Trace Step 7: Error handler - showing alert with message:', errorMsg);
      
      if (errorMsg.includes('permission-denied') || errorMsg.includes('PERMISSION_DENIED')) {
        alert('Permission denied. Check Firestore security rules. See debug panel.');
      } else {
        alert('Error deleting item: ' + errorMsg + '. See debug panel for details.');
      }
      console.groupEnd();
    }
  };

  const formatJSON = (v: any) => {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };

  const generatePSIRDebugReport = () => {
    try {
      const report = {
        generatedAt: new Date().toISOString(),
        purchaseOrdersCount: Array.isArray(purchaseOrders) ? purchaseOrders.length : 0,
        purchaseDataCount: Array.isArray(purchaseData) ? purchaseData.length : 0,
        indentDataCount: Array.isArray(indentData) ? indentData.length : 0,
        itemMasterCount: Array.isArray(itemMaster) ? itemMaster.length : 0,
        psirDataCount: Array.isArray(psirs) ? psirs.length : 0,
        stockRecordsCount: Array.isArray(stockRecords) ? stockRecords.length : 0,
        processedPOs: Array.from(processedPOs),
        userUid: userUid || 'not authenticated',
        currentItemInput: itemInput,
        currentNewPSIR: newPSIR,
      };

      setPsirDebugOutput(formatJSON(report));
      setPsirDebugOpen(true);
    } catch (err) {
      setPsirDebugOutput('Error generating PSIR debug report: ' + String(err));
      setPsirDebugOpen(true);
    }
  };

  const computePurchaseActuals = () => {
    try {
      const okTotalsByItemName: Record<string, number> = {};
      if (Array.isArray(psirs)) {
        psirs.forEach((psir: any) => {
          if (Array.isArray(psir.items)) {
            psir.items.forEach((it: any) => {
              const name = String(it.itemName || '').trim();
              const okRaw = (it.okQty === undefined || it.okQty === null) ? 0 : Number(it.okQty || 0);
              const qtyReceivedRaw = (it.qtyReceived === undefined || it.qtyReceived === null) ? 0 : Number(it.qtyReceived || 0);
              const ok = okRaw > 0 ? okRaw : qtyReceivedRaw;
              if (!name) return;
              okTotalsByItemName[name] = (okTotalsByItemName[name] || 0) + ok;
            });
          }
        });
      }

      const results = Array.isArray(stockRecords)
        ? stockRecords.map((rec: any) => {
            const ok = okTotalsByItemName[rec.itemName] || 0;
            return {
              itemName: rec.itemName,
              itemCode: rec.itemCode,
              okTotal: ok,
              purchaseActualQtyInStore: ok,
            };
          })
        : [];

      return results;
    } catch (err) {
      return [];
    }
  };

  const manualDispatchPSIRUpdated = () => {
    try {
      bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { psirs } }));
      alert('Dispatched psir.updated with current psirData');
    } catch (err) {
      alert('Failed to dispatch psir.updated: ' + String(err));
    }
  };

  const getNextBatchNo = (): string => {
    const currentYear = new Date().getFullYear();
    const yearSuffix = String(currentYear).slice(-2);
    
    const batchNumbers = psirs
      .map(psir => psir.batchNo)
      .filter(batchNo => batchNo && batchNo.includes('P'))
      .map(batchNo => {
        const match = batchNo.match(/P(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(num => num > 0);

    const maxNumber = batchNumbers.length > 0 ? Math.max(...batchNumbers) : 0;
    const nextNumber = maxNumber + 1;
    
    return `${yearSuffix}/P${nextNumber}`;
  };

  const getPOQtyFor = (poNo: string | undefined, indentNo: string | undefined, itemCode: string | undefined): number => {
    try {
      const arrA = Array.isArray(purchaseData) ? purchaseData : [];
      const arrB = Array.isArray(purchaseOrders) ? purchaseOrders : [];
      const mergeKey = (e: any) => `${String(e.poNo||'').trim().toUpperCase()}|${String(e.indentNo||'').trim().toUpperCase()}|${String(e.itemCode||e.Code||e.Item||'').trim().toUpperCase()}`;
      const mergedMap = new Map<string, any>();
      if (Array.isArray(arrB)) arrB.forEach((e: any) => mergedMap.set(mergeKey(e), e));
      if (Array.isArray(arrA)) arrA.forEach((e: any) => mergedMap.set(mergeKey(e), e));
      const arr = Array.from(mergedMap.values());

      const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
      const targetCode = norm(itemCode);
      const targetPo = norm(poNo);
      const targetIndent = norm(indentNo);

      const extractQty = (e: any) => Number(e.purchaseQty ?? e.poQty ?? e.qty ?? e.originalIndentQty ?? 0) || 0;
      const candidateCodes = (e: any) => [e.itemCode, e.Code, e.CodeNo, e.Item].map((c: any) => norm(c));

      const byPoAndCode = arr.find((e: any) => {
        if (!targetPo) return false;
        if (norm(e.poNo) !== targetPo) return false;
        const codes = candidateCodes(e);
        return codes.includes(targetCode);
      });
      if (byPoAndCode) return extractQty(byPoAndCode);

      const byIndentAndCode = arr.find((e: any) => {
        if (norm(e.indentNo) !== targetIndent) return false;
        const codes = candidateCodes(e);
        return codes.includes(targetCode);
      });
      if (byIndentAndCode) return extractQty(byIndentAndCode);

      const byCode = arr.find((e: any) => {
        const codes = candidateCodes(e);
        return codes.includes(targetCode);
      });
      if (byCode) return extractQty(byCode);

      return 0;
    } catch (err) {
      return 0;
    }
  };

  const getPOQtyMatchDetails = (poNo: string | undefined, indentNo: string | undefined, itemCode: string | undefined) => {
    const details: any = { poNo, indentNo, itemCode, tried: [], matched: false, matchedSource: null, matchedEntry: null, qty: 0 };
    try {
      const arrA = Array.isArray(purchaseData) ? purchaseData : [];
      const arrB = Array.isArray(purchaseOrders) ? purchaseOrders : [];

      const mergeKey = (e: any) => `${String(e.poNo||'').trim().toUpperCase()}|${String(e.indentNo||'').trim().toUpperCase()}|${String(e.itemCode||e.Code||e.Item||'').trim().toUpperCase()}`;
      const mergedMap = new Map<string, any>();
      if (Array.isArray(arrB)) arrB.forEach((e: any) => mergedMap.set(mergeKey(e), e));
      if (Array.isArray(arrA)) arrA.forEach((e: any) => mergedMap.set(mergeKey(e), e));
      const arr = Array.from(mergedMap.values());

      const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
      const targetCode = norm(itemCode);
      const targetPo = norm(poNo);
      const targetIndent = norm(indentNo);

      const extractQty = (e: any) => Number(e.purchaseQty ?? e.poQty ?? e.qty ?? e.originalIndentQty ?? 0) || 0;
      const candidateCodes = (e: any) => [e.itemCode, e.Code, e.CodeNo, e.Item].map((c: any) => norm(c));

      const preferQuantityFromEntry = (e: any) => {
        try {
          const stored = extractQty(e);
          if (stored && stored > 0) return stored;
          const currentStock = Number(e.currentStock ?? e.stock ?? e.current ?? 0) || 0;
          if (currentStock > 0) return currentStock;
          try {
            const actuals = computePurchaseActuals();
            const codes = [e.itemCode, e.Code, e.CodeNo, e.Item].map((c: any) => norm(c));
            const match = actuals.find((a: any) => codes.includes(norm(a.itemCode)) || norm(a.itemName) === norm(e.itemName));
            if (match) {
              const val = Number(match.purchaseActualQtyInStore || 0) || 0;
              if (val > 0) return val;
            }
          } catch (err) {}
          return 0;
        } catch (err) {
          return extractQty(e);
        }
      };

      details.tried.push({ step: 'po+code', targetPo, targetCode });
      const byPoAndCode = arr.find((e: any) => {
        if (!targetPo) return false;
        if (norm(e.poNo) !== targetPo) return false;
        const codes = candidateCodes(e);
        return codes.includes(targetCode);
      });
      if (byPoAndCode) {
        details.matched = true; details.matchedSource = 'purchaseData|purchaseOrders'; details.matchedEntry = byPoAndCode; details.qty = preferQuantityFromEntry(byPoAndCode);
        return details;
      }

      details.tried.push({ step: 'indent+code', targetIndent, targetCode });
      const byIndentAndCode = arr.find((e: any) => {
        if (norm(e.indentNo) !== targetIndent) return false;
        const codes = candidateCodes(e);
        return codes.includes(targetCode);
      });
      if (byIndentAndCode) {
        details.matched = true; details.matchedSource = 'purchaseData|purchaseOrders'; details.matchedEntry = byIndentAndCode; details.qty = preferQuantityFromEntry(byIndentAndCode);
        return details;
      }

      details.tried.push({ step: 'po-only', targetPo });
      if (targetPo) {
        const byPo = arr.find((e: any) => norm(e.poNo) === targetPo);
        if (byPo) { details.matched = true; details.matchedSource = 'purchaseData|purchaseOrders'; details.matchedEntry = byPo; details.qty = preferQuantityFromEntry(byPo); return details; }
      }

      details.tried.push({ step: 'code-any', targetCode });
      const byCode = arr.find((e: any) => candidateCodes(e).includes(targetCode));
      if (byCode) { details.matched = true; details.matchedSource = 'purchaseData|purchaseOrders'; details.matchedEntry = byCode; details.qty = preferQuantityFromEntry(byCode); return details; }

      details.matched = false; details.matchedSource = null; details.matchedEntry = null; details.qty = 0;
      return details;
    } catch (err) {
      details.error = String(err);
      return details;
    }
  };

  useEffect(() => {
    const handler = (e: any) => {
      try {
        console.debug('[PSIRModule] Received purchaseOrders.updated event', e);
        setPsirs(prev => prev.map(p => ({ ...p, items: Array.isArray(p.items) ? p.items.map(i => ({ ...i })) : p.items })));
        setNewPSIR(prev => ({ ...prev, items: Array.isArray(prev.items) ? prev.items.map(it => ({ ...it })) : prev.items }));
      } catch (err) {}
    };

    const handlerPurchaseData = (e: any) => {
      try {
        console.debug('[PSIRModule] Received purchaseData.updated event', e);
        setPsirs(prev => prev.map(p => ({ ...p, items: Array.isArray(p.items) ? p.items.map(i => ({ ...i })) : p.items })));
        setNewPSIR(prev => ({ ...prev, items: Array.isArray(prev.items) ? prev.items.map(it => ({ ...it })) : prev.items }));
      } catch (err) {}
    };

    try {
      bus.addEventListener('purchaseOrders.updated', handler as EventListener);
      bus.addEventListener('purchaseData.updated', handlerPurchaseData as EventListener);
      console.debug('[PSIRModule] Registered event listeners for purchaseOrders.updated and purchaseData.updated');
    } catch (err) {
      console.error('[PSIRModule] Failed to register event listeners:', err);
    }

    return () => {
      try {
        bus.removeEventListener('purchaseOrders.updated', handler as EventListener);
        bus.removeEventListener('purchaseData.updated', handlerPurchaseData as EventListener);
      } catch (err) {}
    };
  }, []);

  const _psirSyncedRef = useRef(false);
  useEffect(() => {
    if (!_psirSyncedRef.current) {
      console.debug('[PSIRModule] Automatic one-time qtyReceived sync is disabled. Use the PSIR Debug panel to run a manual sync.');
      _psirSyncedRef.current = true;
    }
  }, [psirs]);

  const _psirRepairRef = useRef(false);
  useEffect(() => {
    try {
      if (_psirRepairRef.current) return;
      if (!psirs || psirs.length === 0) {
        _psirRepairRef.current = true;
        return;
      }

      let restoredCount = 0;
      const repaired = psirs.map((psir) => {
        const newItems = (psir.items || []).map((item: any) => {
          try {
            const details = getPOQtyMatchDetails(psir.poNo, psir.indentNo, item.itemCode);
            const matched = details && details.matchedEntry ? details.matchedEntry : null;
            if (!matched) return item;

            const purchaseQty = Number(matched.purchaseQty ?? matched.poQty ?? matched.purchaseQty ?? 0) || 0;
            const originalQty = Number(matched.originalIndentQty ?? matched.originalQty ?? matched.qty ?? 0) || 0;

            if (purchaseQty > 0 && originalQty > 0 && Number(item.qtyReceived || 0) === purchaseQty && originalQty !== purchaseQty) {
              restoredCount++;
              return { ...item, qtyReceived: originalQty };
            }
          } catch (err) {}
          return item;
        });
        return { ...psir, items: newItems };
      });

      if (restoredCount > 0) {
        setPsirs(repaired);
        try {
          if (userUid) {
            (async () => {
              try {
                await Promise.all(repaired.map(async (psir: any) => {
                  if (psir && psir.id) {
                    await updatePsir(psir.id, { items: psir.items });
                  }
                }));
              } catch (err) {
                console.error('[PSIRModule] Error persisting repaired PSIRs to Firestore:', err);
              }
            })();
          }
        } catch (err) {
          console.error('[PSIRModule] Error scheduling PSIR persistence:', err);
        }
        try { bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { psirs: repaired } })); } catch (err) {}
        console.info(`[PSIRModule] Repair restored qtyReceived for ${restoredCount} items from originalIndentQty.`);
      } else {
        console.debug('[PSIRModule] Repair found no overwritten items to restore.');
      }

      _psirRepairRef.current = true;
    } catch (err) {
      _psirRepairRef.current = true;
      console.error('[PSIRModule] Error running PSIR repair:', err);
    }
  }, [psirs]);

  const _psirShiftRef = useRef(false);
  useEffect(() => {
    if (!_psirShiftRef.current) {
      console.debug('[PSIRModule] Automatic PSIR->Purchase shift is disabled. Use the PSIR Debug panel to run it manually if needed.');
      _psirShiftRef.current = true;
    }
  }, [psirs]);

  return (
    <div>
      <h2>PSIR Module</h2>
      
      <div style={{ marginBottom: 16, padding: 12, background: '#e8f5e8', border: '1px solid #4caf50', borderRadius: 6 }}>
        <h3>Import All Purchase Orders/Indents</h3>
        <div style={{ marginBottom: 12, fontSize: '14px', lineHeight: 1.6 }}>
          <div><strong>Status:</strong></div>
          <div>📋 Purchase Orders Loaded: <span style={{ fontWeight: 'bold', color: purchaseOrders.length > 0 ? '#4caf50' : '#999' }}>{purchaseOrders.length}</span></div>
          <div>📋 Purchase Data Loaded: <span style={{ fontWeight: 'bold', color: purchaseData.length > 0 ? '#4caf50' : '#999' }}>{purchaseData.length}</span></div>
          <div>✅ Processed POs/Indents: <span style={{ fontWeight: 'bold' }}>{processedPOs.size}</span></div>
          <div>📦 PSIR Records: <span style={{ fontWeight: 'bold' }}>{psirs.length}</span></div>
          <div>👤 User: <span style={{ fontWeight: 'bold', color: userUid ? '#4caf50' : '#f44336' }}>{userUid ? '✓ Logged in' : '✗ Not authenticated'}</span></div>
        </div>
        <p style={{ marginBottom: 8, fontSize: '13px', color: '#666' }}>
          {purchaseOrders.length === 0 && purchaseData.length === 0 ? '⚠️ No purchase orders or data loaded yet' : `Ready to import ${Math.max(purchaseOrders.length, purchaseData.length)} records`}
        </p>
        <button 
          onClick={() => importAllPurchaseOrdersToPSIR(true)}
          disabled={purchaseOrders.length === 0 && purchaseData.length === 0 || !userUid}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: (purchaseOrders.length === 0 && purchaseData.length === 0) || !userUid ? '#ccc' : '#4caf50', 
            color: 'white', 
            border: 'none', 
            borderRadius: 4, 
            cursor: (purchaseOrders.length === 0 && purchaseData.length === 0) || !userUid ? 'not-allowed' : 'pointer' 
          }}
        >
          Import All Purchase Orders to PSIR
        </button>
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => setPsirDebugOpen(prev => !prev)}
          style={{ padding: '6px 10px', cursor: 'pointer' }}
        >
          {psirDebugOpen ? 'Hide PSIR Debug' : 'Show PSIR Debug'}
        </button>
        <button onClick={generatePSIRDebugReport} style={{ padding: '6px 10px', cursor: 'pointer' }}>Generate PSIR Debug Report</button>
        
        <button 
          onClick={async () => {
            console.log('[PSIR] Manual refresh: Forcing re-fetch from Firestore');
            if (userUid) {
              try {
                await new Promise((resolve) => {
                  const unsub = subscribePsirs(userUid, (docs) => {
                    console.log('[PSIR] Manual refresh completed - fresh data:', docs.length, 'records');
                    console.log('[PSIR] Fresh document IDs:', docs.map(d => d.id));
                    resolve(null);
                    unsub();
                  });
                });
                alert('✅ Manual refresh completed! Check console for fresh data.');
              } catch (err) {
                console.error('[PSIR] Manual refresh failed:', err);
                alert('❌ Refresh failed: ' + String(err));
              }
            } else {
              alert('❌ User not authenticated');
            }
          }}
          style={{ 
            padding: '6px 10px', 
            cursor: 'pointer',
            background: '#4CAF50',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontWeight: 600
          }}
        >
          🔄 Refresh PSIR Data
        </button>
        
        <button 
          onClick={() => {
            try {
              console.log('[PSIR DEBUG] purchaseOrders:', purchaseOrders);
              console.log('[PSIR DEBUG] purchaseData:', purchaseData);
              console.log('[PSIR DEBUG] psirs:', psirs);
              setPsirDebugOutput(formatJSON({ 
                purchaseOrders, 
                purchaseData,
                psirs,
                message: 'Check browser console for full details'
              }));
              setPsirDebugOpen(true);
              alert('Data printed to console. Check browser DevTools (F12)');
            } catch (err) {
              alert('Error reading data: ' + String(err));
            }
          }} 
          style={{ padding: '6px 10px', cursor: 'pointer', background: '#ff9800', color: 'white', border: 'none', borderRadius: 4 }}
        >
          🔍 Inspect All Data
        </button>
      </div>
      
      {psirDebugOpen && (
        <div style={{ marginBottom: 16, padding: 12, background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 6 }}>
          <div style={{ marginBottom: 8, fontWeight: 700 }}>PSIR Debug Output</div>
          <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
            <button onClick={() => setPsirDebugOutput(formatJSON({ psirData: psirs }))} style={{ padding: '6px 8px' }}>Show psirData</button>
            <button onClick={() => { getStockRecords(userUid || '').then(recs => setPsirDebugExtra(formatJSON(recs))); }} style={{ padding: '6px 8px' }}>Show stock-records</button>
            <button onClick={() => setPsirDebugExtra(formatJSON(computePurchaseActuals()))} style={{ padding: '6px 8px' }}>Show computed purchaseActuals</button>
            <button onClick={manualDispatchPSIRUpdated} style={{ padding: '6px 8px' }}>Dispatch psir.updated</button>
            <button
              onClick={async () => {
                try {
                  const details = (newPSIR.items || []).map(it => getPOQtyMatchDetails(newPSIR.poNo, newPSIR.indentNo, it.itemCode));
                  setPsirDebugExtra(formatJSON({ title: 'PO Qty match for current newPSIR items', details }));
                } catch (err) {
                  setPsirDebugExtra('Error generating PO Qty debug: ' + String(err));
                }
              }}
              style={{ padding: '6px 8px' }}
            >
              Debug PO Qty (current items)
            </button>
            <button
              onClick={async () => {
                try {
                  if (psirs.length === 0) { alert('No PSIR data found'); return; }
                  let changed = false;
                  let count = 0;
                  for (const psir of psirs) {
                    const newItems = (psir.items || []).map((item: any) => {
                      const existing = Number(item.qtyReceived || 0) || 0;
                      const poQty = getPOQtyFor(psir.poNo, psir.indentNo, item.itemCode) || 0;
                      if (existing === 0 && poQty > 0) {
                        changed = true; count++; return { ...item, qtyReceived: poQty };
                      }
                      return item;
                    });
                    if (changed && psir.id && userUid) {
                      await updatePsir(psir.id, { items: newItems });
                    }
                  }
                  if (changed) {
                    try { bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { psirs } })); } catch (err) {}
                    alert(`Sync applied: filled ${count} items' PO into PSIR.qtyReceived`);
                  } else {
                    alert('No empty PSIR.qtyReceived items found to sync');
                  }
                } catch (err) {
                  alert('Error running manual sync: ' + String(err));
                }
              }}
              style={{ padding: '6px 8px' }}
            >
              Sync Empty PO into PSIR
            </button>

            <button
              onClick={async () => {
                try {
                  if (psirs.length === 0) { alert('No PSIR data found'); return; }
                  let changed = 0;
                  for (const psir of psirs) {
                    const newItems = (psir.items || []).map((it: any) => {
                      try {
                        const newPo = getPOQtyFor(psir.poNo, psir.indentNo, it.itemCode) || 0;
                        if ((Number(it.poQty || 0) || 0) !== newPo) { changed++; return { ...it, poQty: newPo }; }
                        return it;
                      } catch (err) { return it; }
                    });
                    if (changed > 0 && psir.id && userUid) {
                      await updatePsir(psir.id, { items: newItems });
                    }
                  }
                  if (changed > 0) {
                    try { bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { psirs } })); } catch (err) {}
                    alert(`Synced PO Qty into PSIR for ${changed} items`);
                  } else {
                    alert('All PSIR poQty values are already up-to-date');
                  }
                } catch (err) { alert('Error during PO Qty sync: ' + String(err)); }
              }}
              style={{ padding: '6px 8px' }}
            >
              Sync PO Qty into PSIR
            </button>

            <button
              onClick={() => {
                if (!confirm('This will move PSIR.qtyReceived into purchase records where purchaseQty is empty and clear PSIR.qtyReceived. Proceed?')) return;
                try {
                  const arrA = Array.isArray(purchaseData) ? JSON.parse(JSON.stringify(purchaseData)) : [];
                  const arrB = Array.isArray(purchaseOrders) ? JSON.parse(JSON.stringify(purchaseOrders)) : [];
                  const psirArr = Array.isArray(psirs) ? JSON.parse(JSON.stringify(psirs)) : [];
                  if (!psirArr || psirArr.length === 0) { alert('No PSIR data found'); return; }
                  let shiftedCount = 0;
                  const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
                  const newPsirs = psirArr.map((psir: any) => ({
                    ...psir,
                    items: (psir.items || []).map((item: any) => {
                      try {
                        const existingQty = Number(item.qtyReceived || 0);
                        if (!(existingQty > 0)) return item;
                        const targetPo = norm(psir.poNo);
                        const targetCode = norm(item.itemCode);
                        let foundInA = -1;
                        if (Array.isArray(arrA)) {
                          foundInA = arrA.findIndex((e: any) => targetPo && norm(e.poNo) === targetPo && [e.itemCode, e.Code, e.CodeNo, e.Item].map((c:any)=>norm(c)).includes(targetCode));
                        }
                        if (foundInA !== -1) {
                          const entry = arrA[foundInA];
                          const existingPurchaseQty = Number(entry.purchaseQty ?? entry.poQty ?? entry.originalIndentQty ?? 0) || 0;
                          if (existingPurchaseQty === 0) { entry.purchaseQty = existingQty; shiftedCount++; return { ...item, qtyReceived: 0 }; }
                          return item;
                        }
                        let foundInB = -1;
                        if (Array.isArray(arrB)) {
                          foundInB = arrB.findIndex((e: any) => targetPo && norm(e.poNo) === targetPo && [e.itemCode, e.Code, e.CodeNo, e.Item].map((c:any)=>norm(c)).includes(targetCode));
                        }
                        if (foundInB !== -1) {
                          const entry = arrB[foundInB];
                          const existingPurchaseQty = Number(entry.purchaseQty ?? entry.poQty ?? entry.originalIndentQty ?? 0) || 0;
                          if (existingPurchaseQty === 0) { entry.purchaseQty = existingQty; shiftedCount++; return { ...item, qtyReceived: 0 }; }
                          return item;
                        }
                        return item;
                      } catch (err) { return item; }
                    })
                  }));
                  if (shiftedCount > 0) {
                    if (userUid) {
                      (async () => {
                        try {
                          if (Array.isArray(arrA)) {
                            await Promise.all(arrA.map(async (e: any) => { if (e && e.id) await updatePurchaseData(userUid, e.id, e); }));
                            try { bus.dispatchEvent(new CustomEvent('purchaseData.updated', { detail: { purchaseData: arrA } })); } catch (err) {}
                          }
                          if (Array.isArray(arrB)) {
                            await Promise.all(arrB.map(async (e: any) => { if (e && e.id) await updatePurchaseOrder(userUid, e.id, e); }));
                            try { bus.dispatchEvent(new CustomEvent('purchaseOrders.updated', { detail: arrB })); } catch (err) {}
                          }
                          await Promise.all(newPsirs.map(async (p: any) => { if (p && p.id) await updatePsir(p.id, { items: p.items }); }));
                          try { bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { psirs: newPsirs } })); } catch (err) {}
                          setPsirs(newPsirs);
                          alert(`Shift applied: moved ${shiftedCount} qtyReceived values into purchase records and cleared them in PSIR`);
                        } catch (err) {
                          console.error('[PSIRModule] Error persisting shifted data to Firestore:', err);
                          alert('Shift completed locally but failed to persist some changes: ' + String(err));
                        }
                      })();
                    } else {
                      setPsirs(newPsirs);
                      try { bus.dispatchEvent(new CustomEvent('psir.updated', { detail: { psirs: newPsirs } })); } catch (err) {}
                      alert(`Shift applied: moved ${shiftedCount} qtyReceived values into purchase records and cleared them in PSIR`);
                    }
                  } else {
                    alert('No eligible qtyReceived values found to shift');
                  }
                } catch (err) { alert('Error during shift: ' + String(err)); }
              }}
              style={{ padding: '6px 8px' }}
            >
              Shift PO from PSIR to Purchase
            </button>
            <button
              onClick={() => {
                try {
                  const all: any[] = [];
                  psirs.forEach(psir => psir.items.forEach((it: any) => all.push({ psir: { poNo: psir.poNo, indentNo: psir.indentNo }, item: it, details: getPOQtyMatchDetails(psir.poNo, psir.indentNo, it.itemCode) })));
                  setPsirDebugExtra(formatJSON({ title: 'PO Qty match for all PSIR records', all }));
                } catch (err) {
                  setPsirDebugExtra('Error generating PO Qty debug for all: ' + String(err));
                }
              }}
              style={{ padding: '6px 8px' }}
            >
              Debug PO Qty (all PSIR)
            </button>
          </div>
          <pre style={{ maxHeight: 300, overflow: 'auto', background: '#fff', padding: 8, border: '1px solid #ddd' }}>{psirDebugOutput || 'No debug output yet. Click "Generate PSIR Debug Report".'}</pre>
          {psirDebugExtra && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Extra Debug</div>
              <pre style={{ maxHeight: 300, overflow: 'auto', background: '#fff', padding: 8, border: '1px solid #ddd' }}>{psirDebugExtra}</pre>
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 16, padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
        <h4>Debug Info:</h4>
        <div>PO No: {newPSIR.poNo}</div>
        <div>Indent No: {newPSIR.indentNo}</div>
        <div>Item Names in Master: {itemNames.length}</div>
        <div>Processed POs/Indents: {processedPOs.size}</div>
      </div>

      {deleteDebugOpen && (
        <div style={{ 
          marginBottom: 16, 
          padding: 16, 
          background: '#ffebee', 
          border: '3px solid #d32f2f', 
          borderRadius: 8,
          position: 'relative'
        }}>
          <div style={{ 
            fontWeight: 700, 
            fontSize: '16px',
            marginBottom: 12,
            color: '#d32f2f'
          }}>
            🔍 DELETE OPERATION DEBUG INFO
          </div>
          
          <textarea 
            readOnly 
            value={deleteDebugInfo}
            style={{
              width: '100%',
              height: '300px',
              padding: 12,
              fontFamily: 'monospace',
              fontSize: '12px',
              backgroundColor: '#fff',
              border: '1px solid #d32f2f',
              borderRadius: 4,
              marginBottom: 12
            }}
          />
          
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(deleteDebugInfo);
                alert('Debug info copied to clipboard!');
              }}
              style={{
                padding: '8px 16px',
                background: '#d32f2f',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              📋 Copy to Clipboard
            </button>
            
            <button 
              onClick={() => {
                console.error('[DELETE DEBUG - FULL INFO]:', deleteDebugInfo);
                alert('Debug info logged to console!');
              }}
              style={{
                padding: '8px 16px',
                background: '#f57c00',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              🖥️ Log to Console
            </button>
            
            <button 
              onClick={() => setDeleteDebugOpen(false)}
              style={{
                padding: '8px 16px',
                background: '#666',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              ✕ Close
            </button>
          </div>
          
          <div style={{ marginTop: 12, fontSize: '12px', color: '#666' }}>
            <strong>💡 How to read this debug info:</strong>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li><strong>userUid:</strong> Should show your Firebase user ID, not "NOT LOGGED IN"</li>
              <li><strong>psirId:</strong> Should be a string ID, not "MISSING ID - THIS IS THE PROBLEM!"</li>
              <li><strong>status:</strong> Shows what went wrong (SUCCESS, FAILED_*, etc.)</li>
              <li><strong>totalPsirs:</strong> How many PSIR records exist</li>
              <li><strong>error:</strong> Firestore error message if delete failed</li>
            </ul>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <input
          type="date"
          placeholder="Received Date"
          name="receivedDate"
          value={newPSIR.receivedDate}
          onChange={e => setNewPSIR(prev => ({ ...prev, receivedDate: e.target.value }))}
        />
        <input
          placeholder="Indent No"
          name="indentNo"
          value={newPSIR.indentNo}
          onChange={e => setNewPSIR(prev => ({ ...prev, indentNo: e.target.value }))}
        />
        <input
          placeholder="OA NO"
          name="oaNo"
          value={newPSIR.oaNo}
          onChange={e => setNewPSIR(prev => ({ ...prev, oaNo: e.target.value }))}
        />
        <input
          placeholder="PO No"
          name="poNo"
          value={newPSIR.poNo}
          onChange={e => setNewPSIR(prev => ({ ...prev, poNo: e.target.value }))}
        />
        <input
          placeholder="Batch No"
          name="batchNo"
          value={newPSIR.batchNo}
          onChange={e => setNewPSIR(prev => ({ ...prev, batchNo: e.target.value }))}
        />
        <button 
          onClick={() => setNewPSIR(prev => ({ ...prev, batchNo: getNextBatchNo() }))}
          style={{
            background: '#2196F3',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Auto Generate
        </button>
        <input
          placeholder="Invoice No"
          name="invoiceNo"
          value={newPSIR.invoiceNo}
          onChange={e => setNewPSIR(prev => ({ ...prev, invoiceNo: e.target.value }))}
        />
        <input
          placeholder="Supplier Name"
          name="supplierName"
          value={newPSIR.supplierName}
          onChange={e => setNewPSIR(prev => ({ ...prev, supplierName: e.target.value }))}
        />
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label>Item Name:</label>
        {itemNames.length > 0 ? (
          <select name="itemName" value={itemInput.itemName} onChange={handleItemInputChange}>
            <option value="">Select Item Name</option>
            {[...new Set(itemNames)].map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input 
            type="text" 
            placeholder="Item Name"
            name="itemName" 
            value={itemInput.itemName} 
            onChange={handleItemInputChange} 
          />
        )}
        <input
          placeholder="Item Code"
          name="itemCode"
          value={itemInput.itemCode}
          onChange={handleItemInputChange}
        />
        <input
          type="number"
          placeholder="Qty Received"
          name="qtyReceived"
          value={itemInput.qtyReceived ?? ''}
          onChange={handleItemInputChange}
          min={0}
          step={1}
        />
        <input
          type="number"
          placeholder="OK Qty"
          name="okQty"
          value={itemInput.okQty || ''}
          onChange={handleItemInputChange}
        />
        <input
          type="number"
          placeholder="Reject Qty"
          name="rejectQty"
          value={itemInput.rejectQty || ''}
          onChange={handleItemInputChange}
        />
        <input
          placeholder="GRN No"
          name="grnNo"
          value={itemInput.grnNo}
          onChange={handleItemInputChange}
        />
        <input
          placeholder="Remarks"
          name="remarks"
          value={itemInput.remarks}
          onChange={handleItemInputChange}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleAddItem} disabled={editItemIdx !== null}>
            Add Item
          </button>
          <button onClick={handleUpdateItem} disabled={editItemIdx === null}>
            Update Item
          </button>
        </div>
      </div>
      
      {newPSIR.items.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3>Items in Current PSIR:</h3>
          <table border={1} cellPadding={6} style={{ width: '100%' }}>
            <thead>
              <tr>
                  <th>Item Name</th>
                  <th>Item Code</th>
                  <th>PO Qty</th>
                  <th>Qty Received</th>
                  <th>OK Qty</th>
                  <th>Reject Qty</th>
                  <th>GRN No</th>
                  <th>Remarks</th>
                  <th>Actions</th>
                </tr>
            </thead>
            <tbody>
              {(newPSIR.items || []).map((item, idx) => {
                const poQty = getPOQtyFor(newPSIR.poNo, newPSIR.indentNo, item.itemCode) || 0;
                return (
                <tr key={idx}>
                  <td>{item.itemName}</td>
                  <td>{item.itemCode}</td>
                  <td>{Math.abs(poQty)}</td>
                  <td>{item.qtyReceived}</td>
                  <td>{item.okQty}</td>
                  <td>{item.rejectQty}</td>
                  <td>{item.grnNo}</td>
                  <td>{item.remarks}</td>
                  <td>
                    <button onClick={() => handleEditItem(idx)}>Edit</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        {editPSIRIdx === null ? (
          <button onClick={handleAddPSIR}>Add PSIR</button>
        ) : (
          <button onClick={handleUpdatePSIR}>Update PSIR</button>
        )}
      </div>

      <h3>PSIR Records ({psirs.length})</h3>
      <table border={1} cellPadding={6} style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Received Date</th>
            <th>Indent No</th>
            <th>OA NO</th>
            <th>PO No</th>
            <th>Batch No</th>
            <th>Invoice No</th>
            <th>Supplier Name</th>
            <th>Item Name</th>
            <th>Item Code</th>
            <th>PO Qty</th>
            <th>Qty Received</th>
            <th>OK Qty</th>
            <th>Reject Qty</th>
            <th>GRN No</th>
            <th>Remarks</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {psirs.length === 0 ? (
            <tr>
              <td colSpan={16} style={{ textAlign: 'center', color: '#888' }}>
                (No PSIR records)
              </td>
            </tr>
          ) : (
            psirs.flatMap((psir, psirIdx) => 
              (psir?.items || []).map((item, itemIdx) => {
                const poQty = getPOQtyFor(psir.poNo, psir.indentNo, item.itemCode) || 0;
                return (
                <tr key={`${psirIdx}-${itemIdx}`}>
                  <td>{psir.receivedDate}</td>
                  <td>{psir.indentNo}</td>
                  <td>{psir.oaNo}</td>
                  <td>{psir.poNo}</td>
                  <td>{psir.batchNo}</td>
                  <td>{psir.invoiceNo}</td>
                  <td>{psir.supplierName}</td>
                  <td>{item.itemName}</td>
                  <td>{item.itemCode}</td>
                  <td>{Math.abs(poQty)}</td>
                  <td>{item.qtyReceived}</td>
                  <td>{item.okQty}</td>
                  <td>{item.rejectQty}</td>
                  <td>{item.grnNo}</td>
                  <td>{item.remarks}</td>
                  <td>
                    <button onClick={() => handleEditPSIR(psirIdx)}>Edit</button>
                    <button onClick={async () => {
                      console.group('🗑️ DELETE BUTTON CLICKED');
                      console.log('Step 1: Button click handler started');
                      console.log('Indices:', { psirIdx, itemIdx });
                      console.log('PSIR ID:', psir.id);
                      console.log('Current user UID:', userUid);
                      console.log('Total PSIRs in state:', psirs.length);
                      console.groupEnd();
                      
                      try {
                        console.log('Step 2: Calling handleDeleteItem...');
                        await handleDeleteItem(psirIdx, itemIdx);
                        console.log('Step 3: handleDeleteItem completed successfully');
                      } catch (err) {
                        console.error('Step 3: ERROR in handleDeleteItem:', err);
                        console.error('Error details:', {
                          message: (err as any).message,
                          code: (err as any).code,
                          stack: (err as any).stack
                        });
                      }
                    }}>Delete</button>
                    <button 
                      onClick={() => {
                        console.log('[PSIRModule] PSIR Record Debug:', {
                          psirIdx,
                          psirId: psir.id,
                          psirData: psir,
                          itemIdx,
                          itemData: psir.items[itemIdx]
                        });
                        alert('Check console for PSIR record details');
                      }}
                      style={{ marginLeft: 4, fontSize: '11px' }}
                    >
                      Inspect
                    </button>
                    <button
                      onClick={() => {
                        try {
                          const d = getPOQtyMatchDetails(psir.poNo, psir.indentNo, item.itemCode);
                          setPsirDebugExtra(formatJSON({ title: 'PO Qty debug for row', d }));
                          setPsirDebugOpen(true);
                        } catch (err) {
                          setPsirDebugExtra('Error computing debug: ' + String(err));
                          setPsirDebugOpen(true);
                        }
                      }}
                      style={{ marginLeft: 8 }}
                    >
                      PO Debug
                    </button>
                  </td>
                </tr>
                );
              })
            )
          )}
        </tbody>
      </table>
    </div>
  );
};

export default PSIRModule;