import React, { useState, useEffect } from 'react';
import bus from '../utils/eventBus';
import * as XLSX from 'xlsx';
import { subscribeFirestoreDocs, replaceFirestoreCollection, getFirestoreDocs } from '../utils/firestoreSync';
import { getItemMaster, subscribeStockRecords, subscribePurchaseOrders } from '../utils/firestoreServices';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';

interface IndentItem {
  model: string;
  itemCode: string;
  qty: number;
  indentClosed: boolean;
}

interface Indent {
  indentNo: string;
  date: string;
  indentBy: string;
  oaNo: string;
  items: IndentItem[];
}

interface IndentModuleProps {
  user?: any;
}

const IndentModule: React.FC<IndentModuleProps> = ({ user }) => {
  // Get uid from user prop or use a default
  const [uid] = useState<string>(user?.uid || 'default-user');

  const [indents, setIndents] = useState<Indent[]>([]);

  const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [stockRecords, setStockRecords] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);

  // Subscribe to Firestore collections and load itemMaster on mount
  useEffect(() => {
    let unsubIndents: any = () => {};
    let unsubStock: any = () => {};
    let unsubPO: any = () => {};

    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        // Load itemMaster using one-time fetch (same pattern as StockModule/VSIR)
        (async () => {
          try {
            const items = await getItemMaster(u.uid);
            console.log('[IndentModule] ✅ getItemMaster returned:', items?.length || 0, 'items');
            setItemMaster((items || []) as any[]);
          } catch (e) {
            console.error('[IndentModule] ❌ getItemMaster failed', e);
            setItemMaster([]);
          }
        })();

        // Subscribe to collections
        unsubIndents = subscribeFirestoreDocs(u.uid, 'indentData', (docs) => {
          const formattedIndents = docs.map(doc => ({
            indentNo: doc.indentNo,
            date: doc.date,
            indentBy: doc.indentBy,
            oaNo: doc.oaNo,
            items: Array.isArray(doc.items) ? doc.items : [],
          }));
          setIndents(formattedIndents);
        });

        unsubStock = subscribeStockRecords(u.uid, (docs) => {
          console.log('[IndentModule] 📦 Stock records received:', docs?.length || 0, 'records');
          if (docs?.length > 0) {
            console.log('[IndentModule] Sample stock record:', docs[0]);
          }
          setStockRecords(docs || []);
        });

        unsubPO = subscribePurchaseOrders(u.uid, (docs) => {
          console.log('[IndentModule] 🛒 Purchase orders received:', docs?.length || 0, 'records');
          setPurchaseOrders(docs || []);
        });
      } else {
        setItemMaster([]);
        setIndents([]);
        setStockRecords([]);
        setPurchaseOrders([]);
      }
    });

    return () => {
      try { unsub(); } catch {}
      try { unsubIndents(); } catch {}
      try { unsubStock(); } catch {}
      try { unsubPO(); } catch {}
    };
  }, []);

  function getNextIndentNo() {
    const base = 'S-8/25-';
    if (indents.length === 0) return base + '01';
    const lastSerial = Math.max(
      ...indents.map(i => {
        const match = i.indentNo.match(/S-8\/25-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
    );
    const nextSerial = lastSerial + 1;
    return base + String(nextSerial).padStart(2, '0');
  }

  // Helper function to get next OA NO based on indent by and prefix
  function getNextOANo(indentByValue: string, currentOANo: string = ''): string {
    if (!indentByValue) return '';
    
    // If user just typed "Stock" without a number, auto-format it
    if (currentOANo.trim() === 'Stock') {
      // Find all OA NOs for the same indent by that contain "Stock"
      const relatedOANos = indents
        .filter(indent => indent.indentBy === indentByValue && indent.oaNo.includes('Stock'))
        .map(indent => indent.oaNo);
      
      // Extract numbers from OA NOs like "Stock 05", "Stock 1", etc.
      const numbers = relatedOANos
        .map(oaNo => {
          const match = oaNo.match(/Stock\s+(\d+)/i);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(num => num > 0);

      // Start from 01 if no Stock entries found
      const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
      const nextNumber = maxNumber + 1;
      return 'Stock ' + String(nextNumber).padStart(2, '0');
    }
    
    // Find all OA NOs for the same indent by that contain "Stock"
    const relatedOANos = indents
      .filter(indent => indent.indentBy === indentByValue && indent.oaNo.includes('Stock'))
      .map(indent => indent.oaNo)
      .filter(oaNo => oaNo && oaNo.includes('Stock'));
    
    if (relatedOANos.length === 0) {
      // No existing "Stock" OA NOs for this indent by
      return '';
    }

    // Extract numbers from OA NOs like "Stock 05"
    const numbers = relatedOANos
      .map(oaNo => {
        const match = oaNo.match(/Stock\s+(\d+)/i);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(num => num > 0);

    if (numbers.length === 0) {
      return '';
    }

    const maxNumber = Math.max(...numbers);
    const nextNumber = maxNumber + 1;
    return 'Stock ' + String(nextNumber).padStart(2, '0');
  }

  const [newIndent, setNewIndent] = useState<Indent>({
    indentNo: getNextIndentNo(),
    date: '',
    indentBy: '',
    oaNo: '',
    items: [],
  });

  const [itemInput, setItemInput] = useState<IndentItem>({
    model: '',
    itemCode: '',
    qty: 0,
    indentClosed: false,
  });

  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [_itemNames, _setItemNames] = useState<string[]>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugFilter, setDebugFilter] = useState('');


  // Helper to normalize item codes for matching
  const normalizeCode = (code: string): string => {
    return String(code || '').trim().toUpperCase();
  };

  // Helper to get stock for an item
  const getStock = (itemCode: string) => {
    if (!itemCode) {
      console.warn('[IndentModule] getStock called with empty itemCode');
      return 0;
    }
    
    const normalizedSearchCode = normalizeCode(itemCode);
    // Try multiple candidate fields and matching strategies (code exact, name exact, alpha match)
    const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
    const alpha = (v: any) => norm(v).replace(/[^A-Z0-9]/g, '');

    let matched: any = null;
    const codeNorm = norm(itemCode || '');
    const targetAlpha = alpha(itemCode || '');

    for (const s of stockRecords || []) {
      try {
        const candidates = [s.itemCode, s.ItemCode, s.code, s.Code, s.item_code, s.itemName, s.ItemName, s.name, s.Name, s.sku, s.SKU];
        // exact code match first
        if (codeNorm && candidates.some(c => norm(c) === codeNorm)) { matched = s; break; }
        // alpha/exact across fields
        if (candidates.some(c => alpha(c) === targetAlpha || norm(c) === codeNorm)) { matched = s; break; }
        // contains fallback
        if (Object.values(s).some((v: any) => { try { const a = alpha(v); const n = norm(v); return a.includes(targetAlpha) || targetAlpha.includes(a) || n.includes(codeNorm) || codeNorm.includes(n); } catch { return false; } })) { matched = s; break; }
      } catch (err) {
        continue;
      }
    }

    if (!matched) {
      console.debug('[IndentModule] Stock not found for itemCode:', itemCode, '(normalized:', normalizedSearchCode, ')', 'Available sample codes:', stockRecords.map((s: any) => s.itemCode || s.ItemCode || s.Item_name).slice(0,10));
      return 0;
    }

    const closingKeys = ['closingStock','closing_stock','ClosingStock','closing','closingQty','closing_qty','Closing','closing stock','Closing Stock','closingstock','closingStockQty','closing_stock_qty','ClosingStockQty','closingstockqty'];
    let closingStock: number | null = null;
    for (const k of closingKeys) {
      if (matched[k] != null && !isNaN(Number(matched[k]))) { closingStock = Number(matched[k]); break; }
    }
    if (closingStock === null) {
      // fallback to match Stock Module calculation: stockQty + purStoreOkQty + vendorOkQty - inHouseIssuedQty
      const stockQty = (matched.stockQty || matched.stock_qty || matched.stock || matched.StockQty || matched.currentStock) || 0;
      const purStoreOkQty = (matched.purStoreOkQty || matched.pur_store_ok_qty || matched.PurStoreOkQty) || 0;
      const vendorOkQty = (matched.vendorOkQty || matched.vendor_ok_qty || matched.VendorOkQty) || 0;
      const inHouseIssuedQty = (matched.inHouseIssuedQty || matched.in_house_issued_qty || matched.InHouseIssuedQty) || 0;
      closingStock = Number(stockQty) + Number(purStoreOkQty) + Number(vendorOkQty) - Number(inHouseIssuedQty) || 0;
    }

    console.debug('[IndentModule] Stock found for', itemCode, ':', closingStock, 'matchedBy:', matched);
    return closingStock;
  };

  // FIXED: Calculate cumulative allocated qty up to a specific indent (including partial allocations from OPEN indents)
  const getCumulativeAllocatedQtyUpTo = (itemCode: string, upToIndentIndex: number) => {
    let totalAllocated = 0;
    for (let i = 0; i < upToIndentIndex; i++) {
      const indent = indents[i];
      indent.items.forEach(item => {
        if (item.itemCode === itemCode) {
          const availableBefore = getStock(itemCode) - totalAllocated;
          const allocatedForThisIndent = Math.min(Math.max(0, availableBefore), Number(item.qty) || 0);
          totalAllocated += allocatedForThisIndent;
        }
      });
    }
    return totalAllocated;
  };

  // Get PO Quantity (Purchase Order Quantity) for an item
  const getPOQuantity = (itemCode: string) => {
    let totalPOQty = 0;
    purchaseOrders.forEach((po: any) => {
      if (po.items && Array.isArray(po.items)) {
        po.items.forEach((item: any) => {
          if (item.itemCode === itemCode) {
            totalPOQty += Number(item.qty) || 0;
          }
        });
      }
    });
    return totalPOQty;
  };

  // FIXED: Enhanced function (prefixed with underscore because it's not used directly)
  const _getAvailableStockForIndent = (itemCode: string, indentIndex: number, itemQty: number) => {
    const totalStock = getStock(itemCode);
    const previousAllocatedQty = getCumulativeAllocatedQtyUpTo(itemCode, indentIndex);
    const availableBefore = totalStock - previousAllocatedQty;
    const availableAfter = availableBefore - (Number(itemQty) || 0);
    return availableAfter;
  };
  void _getAvailableStockForIndent;

  // FIXED: Enhanced allocation function
  const getAllocatedAvailableForIndent = (itemCode: string, indentIndex: number, itemQty: number) => {
    const totalStock = getStock(itemCode);
    const previousAllocatedQty = getCumulativeAllocatedQtyUpTo(itemCode, indentIndex);
    const availableBefore = totalStock - previousAllocatedQty;

    const nonNegativeAvailableBefore = Math.max(0, availableBefore);
    const allocatedForThisIndent = Math.min(nonNegativeAvailableBefore, Number(itemQty) || 0);
    return allocatedForThisIndent;
  };

  // FIXED: Calculate status - CLOSED only when availableBefore >= requested qty
  const _getIndentStatus = (itemCode: string, indentIndex: number, itemQty: number) => {
    const totalStock = getStock(itemCode);
    const previousAllocatedQty = getCumulativeAllocatedQtyUpTo(itemCode, indentIndex);
    const availableBefore = totalStock - previousAllocatedQty;
    
    return availableBefore >= (Number(itemQty) || 0);
  };
  void _getIndentStatus;


  // Calculate remaining stock after all allocations
  const getRemainingStock = (itemCode: string) => {
    const totalStock = Number(getStock(itemCode) || 0);
    const poQty = Number(getPOQuantity(itemCode) || 0);

    // Start from stock + PO (POs increase future availability)
    let available = totalStock + poQty;

    // Subtract allocations from saved indents (in order)
    indents.forEach((indent, indentIndex) => {
      indent.items.forEach(item => {
        if (item.itemCode === itemCode) {
          const allocated = getAllocatedAvailableForIndent(itemCode, indentIndex, item.qty);
          available -= Number(allocated) || 0;
        }
      });
    });

    // Also subtract allocations from items already added to the current (unsaved) indent
    // This treats `newIndent` as the last indent in order and allocates sequentially
    (newIndent.items || []).forEach(item => {
      if (item.itemCode === itemCode) {
        const alloc = Math.min(Math.max(0, available), Number(item.qty) || 0);
        available -= alloc;
      }
    });

    return available;
  };

  // Calculate total allocated stock (actual allocated amounts)
  const getAllocatedStock = (itemCode: string) => {
    let totalAllocatedQty = 0;
    
    indents.forEach((indent, indentIndex) => {
      indent.items.forEach(item => {
        if (item.itemCode === itemCode) {
          const allocated = getAllocatedAvailableForIndent(itemCode, indentIndex, item.qty);
          totalAllocatedQty += allocated;
        }
      });
    });
    
    return totalAllocatedQty;
  };

  // FIXED: Comprehensive analysis function
  const getIndentAnalysis = (itemCode: string, indentIndex: number, itemQty: number) => {
    const totalStock = getStock(itemCode);
    const previousAllocatedQty = getCumulativeAllocatedQtyUpTo(itemCode, indentIndex);
    const poQuantity = getPOQuantity(itemCode);
    const availableBefore = totalStock - previousAllocatedQty;
    const availableForThisIndent = (totalStock + poQuantity) - previousAllocatedQty - (Number(itemQty) || 0);
    const allocatedAvailable = Math.min(Math.max(0, availableBefore), Number(itemQty) || 0);
    const isClosed = availableBefore >= (Number(itemQty) || 0);
    
    return {
      totalStock,
      previousIndentsQty: previousAllocatedQty,
      poQuantity,
      availableForThisIndent,
      allocatedAvailable,
      isClosed,
      calculation: `${totalStock} - ${previousAllocatedQty} = ${availableBefore} (before) - ${itemQty} = ${availableForThisIndent}`
    };
  };

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'itemName') {
      const found = itemMaster.find(item => item.itemName === value);
      setItemInput({ 
        ...itemInput, 
        model: value, 
        itemCode: found ? found.itemCode : '' 
      });
    }
  };

  const handleAddItem = () => {
    if (!itemInput.model || !itemInput.itemCode || isNaN(Number(itemInput.qty)) || Number(itemInput.qty) <= 0) {
      alert('Please fill in Item Name, Item Code, and a valid Quantity');
      return;
    }

    if (editIdx !== null) {
      setNewIndent(prev => ({
        ...prev,
        items: prev.items.map((item, idx) => (idx === editIdx ? itemInput : item)),
      }));
      setEditIdx(null);
    } else {
      setNewIndent(prev => ({
        ...prev,
        items: [...prev.items, itemInput],
      }));
    }
    
    setItemInput({ model: '', itemCode: '', qty: 0, indentClosed: false });
  };

  const handleEditItem = (idx: number) => {
    setItemInput(newIndent.items[idx]);
    setEditIdx(idx);
  };

  const handleAddIndent = () => {
    if (!newIndent.date || !newIndent.indentBy || !newIndent.oaNo) {
      alert('Please fill in Date, Indent By, and OA NO fields');
      return;
    }
    if (newIndent.items.length === 0) {
      alert('Please add at least one item');
      return;
    }

    // LOG: Stock analysis for informational purposes (no blocking)
    let insufficientStockItems: Array<{ model: string; itemCode: string; requested: number; available: number }> = [];
    
    console.log('[IndentModule] Stock analysis started. Total stock records available:', stockRecords?.length || 0);
    
    newIndent.items.forEach(item => {
      const totalStock = getStock(item.itemCode);
      const requestedQty = Number(item.qty) || 0;
      
      console.log(`[IndentModule] Analyzing ${item.model} (${item.itemCode}): Requested=${requestedQty}, Available=${totalStock}, Status=${requestedQty > totalStock ? 'INSUFFICIENT' : 'OK'}`);
      
      if (requestedQty > totalStock) {
        insufficientStockItems.push({
          model: item.model,
          itemCode: item.itemCode,
          requested: requestedQty,
          available: totalStock
        });
      }
    });

    console.log('[IndentModule] Analysis complete. Items with insufficient stock:', insufficientStockItems);

    // Show warning but allow proceeding
    if (insufficientStockItems.length > 0) {
      const itemsList = insufficientStockItems
        .map(i => `${i.model} (${i.itemCode}): Requested ${i.requested} but only ${i.available} available`)
        .join('\n');
      
      console.warn(`⚠️ INSUFFICIENT STOCK DETECTED:\n\n${itemsList}`);
    }

    const indentNo = getNextIndentNo();
    const updated = [...indents, { ...newIndent, indentNo }];
    setIndents(updated);
    
    // Save to Firestore instead of localStorage
    replaceFirestoreCollection(uid, 'indentData', updated).catch(err => {
      console.error('Failed to save indent data to Firestore:', err);
      alert('Failed to save indent. Please try again.');
    });

    // Reset form
    setNewIndent({ indentNo: getNextIndentNo(), date: '', indentBy: '', oaNo: '', items: [] });
    setItemInput({ model: '', itemCode: '', qty: 0, indentClosed: false });
  };

  function exportToExcel() {
    const rows = indents.flatMap((indent, indentIndex) =>
        indent.items.map(item => {
        const analysis = getIndentAnalysis(item.itemCode, indentIndex, item.qty);
        const remainingStock = getRemainingStock(item.itemCode);
        const allocatedStock = getAllocatedStock(item.itemCode);

        return {
          Date: indent.date,
          'Indent No': indent.indentNo,
          Model: item.model,
          'Item Code': item.itemCode,
          Qty: item.qty,
          'Indent By': indent.indentBy,
          'OA NO': indent.oaNo,
          'Total Stock': analysis.totalStock,
          'Previous Indents Qty': analysis.previousIndentsQty,
          'PO Quantity': analysis.poQuantity,
          'Available for This Indent': analysis.availableForThisIndent,
          'Allocated Available': analysis.allocatedAvailable,
          'Remaining Stock': remainingStock,
          'Allocated Stock': allocatedStock,
          'Indent Closed': analysis.isClosed ? 'Yes' : 'No',
          'Calculation': analysis.calculation,
        };
      })
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Indents');
    XLSX.writeFile(wb, 'Indents.xlsx');
  }

  // Prepare debug rows for UI panel
  const debugRows = indents.flatMap((indent, indentIndex) =>
    (indent.items || []).map((item: any) => {
      const analysis = getIndentAnalysis(item.itemCode, indentIndex, item.qty);
      const availableBefore = (analysis.totalStock || 0) - (analysis.previousIndentsQty || 0);
      return {
        indentNo: indent.indentNo,
        date: indent.date,
        indentBy: indent.indentBy,
        oaNo: indent.oaNo,
        itemName: item.model,
        itemCode: item.itemCode,
        qty: Number(item.qty) || 0,
        totalStock: analysis.totalStock || 0,
        previousIndentsQty: analysis.previousIndentsQty || 0,
        poQuantity: analysis.poQuantity || 0,
        availableBefore,
        availableForThisIndent: analysis.availableForThisIndent,
        allocatedAvailable: analysis.allocatedAvailable,
        isClosed: analysis.isClosed,
        calculation: analysis.calculation,
      };
    })
  );

  // One-shot fetch from Firestore for stock-records (useful to force-refresh)
  const fetchStockOnce = async () => {
    try {
      const docs = await getFirestoreDocs(uid, 'stock-records');
      setStockRecords(docs || []);
      console.log('[IndentModule] fetchStockOnce: fetched', docs?.length || 0, 'stock records');
      // Trigger recompute
      try { bus.dispatchEvent(new CustomEvent('stock.updated')); } catch (err) { }
      alert('Fetched stock-records from Firestore (' + (docs?.length || 0) + ')');
    } catch (err) {
      console.error('[IndentModule] fetchStockOnce error', err);
      alert('Failed to fetch stock-records: ' + String(err));
    }
  };

  // Compute and publish open/closed indent items
  const computeAndPublishIndentItems = (sourceIndents: any[]) => {
    try {
      const openItems: any[] = [];
      const closedItems: any[] = [];

      (sourceIndents || []).forEach((indent: any, indentIndex: number) => {
        (indent.items || []).forEach((item: any) => {
          const analysis = getIndentAnalysis(item.itemCode, indentIndex, item.qty);

          const payload = {
            ...item,
            indentNo: indent.indentNo,
            date: indent.date,
            indentBy: indent.indentBy,
            oaNo: indent.oaNo,
            stock: analysis.totalStock,
            availableForThisIndent: analysis.availableForThisIndent,
            qty1: analysis.allocatedAvailable,
            Item: item.model,
            Code: item.itemCode,
          };

          if (analysis.isClosed) closedItems.push(payload);
          else openItems.push(payload);
        });
      });

      console.log('[IndentModule] Saving indent items:', { openItemsCount: openItems.length, closedItemsCount: closedItems.length });
      
      // Save to Firestore instead of localStorage
      replaceFirestoreCollection(uid, 'openIndentItems', openItems).catch(err => {
        console.error('Failed to save open indent items:', err);
      });
      replaceFirestoreCollection(uid, 'closedIndentItems', closedItems).catch(err => {
        console.error('Failed to save closed indent items:', err);
      });

      try {
        bus.dispatchEvent(new CustomEvent('indents.updated', { detail: { openItems, closedItems } }));
      } catch (err) {
        console.error('[IndentModule] Error dispatching indents.updated:', err);
      }
    } catch (err) {
      console.error('[IndentModule] computeAndPublishIndentItems error:', err);
    }
  };

  // Auto-save OPEN and CLOSED indent items for Purchase module and notify via event bus
  useEffect(() => {
    computeAndPublishIndentItems(indents);
  }, [indents]);

  // Listen for stock updates elsewhere in the app and force a recompute
  useEffect(() => {
    const handler = () => {
      setIndents(prev => {
        computeAndPublishIndentItems(prev as any[]);
        return Array.isArray(prev) ? [...prev] : prev;
      });
    };

    try {
      bus.addEventListener('stock.updated', handler as EventListener);
    } catch (err) {
      console.error('[IndentModule] Error registering stock.updated listener:', err);
    }

    return () => {
      try {
        bus.removeEventListener('stock.updated', handler as EventListener);
      } catch (err) {
        console.error('[IndentModule] Error removing stock.updated listener:', err);
      }
    };
  }, []);

  // Also listen for storage events
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      try {
        if (!e.key) return;
        const interestingKeys = ['stock-records', 'indentData', 'purchaseOrders'];
        if (interestingKeys.includes(e.key)) {
          computeAndPublishIndentItems(indents as any[]);
          setIndents(prev => Array.isArray(prev) ? [...prev] : prev);
        }
      } catch (err) {
        console.error('[IndentModule] onStorage handler error:', err);
      }
    };

    try {
      window.addEventListener('storage', onStorage);
    } catch (err) {
      console.error('[IndentModule] Error registering storage listener:', err);
    }

    return () => {
      try {
        window.removeEventListener('storage', onStorage);
      } catch (err) {
        console.error('[IndentModule] Error removing storage listener:', err);
      }
    };
  }, [indents]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Indent Module</h2>
      
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input 
          placeholder="Indent No" 
          value={newIndent.indentNo} 
          disabled 
          style={{ background: '#eee', padding: 8, borderRadius: 4, border: '1px solid #ccc' }} 
        />
        <input
          type="date"
          value={newIndent.date}
          onChange={e => setNewIndent({ ...newIndent, date: e.target.value })}
          style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
        />
        <select 
          value={newIndent.indentBy} 
          onChange={e => {
            const selectedIndentBy = e.target.value;
            const nextOANo = getNextOANo(selectedIndentBy);
            setNewIndent({ ...newIndent, indentBy: selectedIndentBy, oaNo: nextOANo });
          }}
          style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
        >
          <option value="">Indent By</option>
          <option value="HKG">HKG</option>
          <option value="NGR">NGR</option>
          <option value="MDD">MDD</option>
        </select>
        <input
          placeholder="OA NO"
          value={newIndent.oaNo}
          onChange={e => setNewIndent({ ...newIndent, oaNo: e.target.value })}
          onBlur={() => {
            // Auto-format if user entered just "Stock" (case-insensitive) without number
            if (newIndent.oaNo.trim().toLowerCase() === 'stock' && newIndent.indentBy) {
              const formatted = getNextOANo(newIndent.indentBy, newIndent.oaNo);
              if (formatted) {
                setNewIndent({ ...newIndent, oaNo: formatted });
              }
            }
          }}
          style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
        />
        <button 
          onClick={() => {
            if (!newIndent.indentBy) {
              alert('Please select Indent By first');
              return;
            }
            // Generate next OA NO for Stock entries
            const formatted = getNextOANo(newIndent.indentBy, 'Stock');
            if (formatted) {
              setNewIndent({ ...newIndent, oaNo: formatted });
            }
          }}
          style={{
            background: '#2196F3',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '8px 12px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Auto Generate
        </button>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Item Name:</label>
        <select 
          name="itemName" 
          value={itemInput.model} 
          onChange={handleChange}
          style={{ 
            padding: 8, 
            borderRadius: 4, 
            border: itemMaster.length === 0 ? '2px solid red' : '1px solid #ccc',
            minWidth: 200
          }}
        >
          <option value="">
            {itemMaster.length === 0 ? "No items in Item Master" : "Select Item Name"}
          </option>
          {itemMaster.map(item => (
            <option key={item.itemCode} value={item.itemName}>
              {item.itemName} - {item.itemCode}
            </option>
          ))}
        </select>
        <input
          placeholder="Item Code"
          value={itemInput.itemCode}
          readOnly
          style={{ 
            padding: 8, 
            borderRadius: 4, 
            border: '1px solid #ccc',
            background: '#f5f5f5',
            cursor: 'not-allowed'
          }}
        />
        <input
          type="number"
          placeholder="Qty"
          value={itemInput.qty === 0 ? '' : itemInput.qty}
          onChange={e => setItemInput({ ...itemInput, qty: e.target.value === '' ? 0 : Number(e.target.value) })}
          style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc', width: 100 }}
        />
        <button 
          onClick={handleAddItem}
          style={{
            background: '#1976d2',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '8px 16px',
            cursor: 'pointer',
          }}
        >
          {editIdx !== null ? 'Update Item' : 'Add Item'}
        </button>
      </div>

      {newIndent.items.length > 0 && (
        <table border={1} cellPadding={8} style={{ width: '100%', marginBottom: 16, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#e3e6f3' }}>
              <th>Item Name</th>
              <th>Item Code</th>
              <th>Qty Requested</th>
              <th>Available Stock</th>
              <th>Remaining Stock</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {newIndent.items.map((item, idx) => {
              // Calculate remaining stock after saved indents + pending items in this form
              const totalStock = getStock(item.itemCode);
              let totalAllocatedFromSaved = 0;
              
              // Add allocations from saved indents
              indents.forEach((indent, indentIndex) => {
                indent.items.forEach(savedItem => {
                  if (savedItem.itemCode === item.itemCode) {
                    const allocated = getAllocatedAvailableForIndent(item.itemCode, indentIndex, savedItem.qty);
                    totalAllocatedFromSaved += allocated;
                  }
                });
              });
              
              // Add allocations from pending items in current form (up to this item)
              let totalAllocatedFromPending = 0;
              for (let i = 0; i <= idx; i++) {
                totalAllocatedFromPending += Number(newIndent.items[i].qty) || 0;
              }
              
              const remainingStock = totalStock - totalAllocatedFromSaved - totalAllocatedFromPending;
              const availableStock = getStock(item.itemCode);
              const hasInsufficientStock = Number(item.qty) > availableStock;
              
              return (
                <tr key={idx} style={{ 
                  background: hasInsufficientStock ? '#ffebee' : 'inherit'
                }}>
                  <td>{item.model}</td>
                  <td>{item.itemCode}</td>
                  <td>{item.qty}</td>
                  <td style={{
                    fontWeight: 600,
                    color: hasInsufficientStock ? '#e53935' : '#43a047'
                  }}>
                    {availableStock}
                  </td>
                  <td style={{ 
                    color: remainingStock >= 0 ? '#43a047' : '#e53935',
                    fontWeight: 600 
                  }}>
                    {remainingStock}
                  </td>
                  <td style={{
                    fontWeight: 600,
                    color: hasInsufficientStock ? '#e53935' : '#43a047'
                  }}>
                    {hasInsufficientStock ? '⚠️ INSUFFICIENT' : '✓ OK'}
                  </td>
                  <td>
                    <button
                      style={{
                        background: '#1976d2',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        cursor: 'pointer',
                        marginRight: 4,
                      }}
                      onClick={() => handleEditItem(idx)}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        setNewIndent(prev => ({
                          ...prev,
                          items: prev.items.filter((_, i) => i !== idx),
                        }));
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
              );
            })}
          </tbody>
        </table>
      )}

      {newIndent.items.length > 0 && (() => {
        const stockValidation = newIndent.items.map(item => ({
          hasInsufficientStock: Number(item.qty) > getStock(item.itemCode)
        }));
        const insufficientCount = stockValidation.filter(s => s.hasInsufficientStock).length;
        const allValid = insufficientCount === 0;
        const stockRecordsLoaded = (stockRecords?.length || 0) > 0;

        return (
          <div style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 6,
            background: allValid && stockRecordsLoaded ? '#f1f8e9' : '#fff3e0',
            border: `2px solid ${allValid && stockRecordsLoaded ? '#43a047' : '#ff9800'}`
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              📋 Indent Summary:
            </div>
            <div>
              • Total Items: {newIndent.items.length}
            </div>
            <div>
              • Stock Records Loaded: {stockRecordsLoaded ? `✓ ${stockRecords?.length || 0} items` : '❌ Loading...'}
            </div>
            <div style={{ color: '#43a047', fontWeight: 600 }}>
              • ✓ Items with sufficient stock: {newIndent.items.length - insufficientCount}
            </div>
            {insufficientCount > 0 && (
              <div style={{ color: '#ff9800', fontWeight: 600 }}>
                • ⚠️ Items with INSUFFICIENT stock: {insufficientCount}
              </div>
            )}
            {!stockRecordsLoaded && (
              <div style={{ color: '#ff9800', fontWeight: 600, marginTop: 8 }}>
                ⚠️ Stock records not loaded yet. Please wait or refresh from Stock Module.
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ marginBottom: 24, display: 'flex', gap: 8 }}>
        <button 
          onClick={handleAddIndent} 
          disabled={newIndent.items.length === 0}
          style={{
            background: newIndent.items.length === 0 ? '#ccc' : '#43a047',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '10px 20px',
            fontWeight: 500,
            cursor: newIndent.items.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Add Indent
        </button>
        <button
          onClick={exportToExcel}
          style={{
            background: '#ff9800',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '10px 20px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Export to Excel
        </button>
      </div>

      <h3>Indent Records</h3>
      <div style={{ overflowX: 'auto' }}>
        <table border={1} cellPadding={8} style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#e3e6f3' }}>
              <th>Date</th>
              <th>Indent No</th>
              <th>Item Name</th>
              <th>Item Code</th>
              <th>Qty</th>
              <th>Indent By</th>
              <th>OA NO</th>
              <th>Total Stock</th>
              <th>Previous Indents</th>
              <th>PO Quantity</th>
              <th>Available for Indent</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {indents.map((indent, indentIndex) =>
              indent.items.map((item, itemIdx) => {
                const analysis = getIndentAnalysis(item.itemCode, indentIndex, item.qty);
                // Compute available FOR this indent explicitly (includes PO quantity)
                const availableForIndent = (Number(analysis.totalStock || 0) + Number(analysis.poQuantity || 0)) - Number(analysis.previousIndentsQty || 0) - (Number(item.qty) || 0);

                // Debug log to help reproduce why values may appear as zero instead of negative
                if (availableForIndent < 0) {
                  console.debug('[IndentModule] Negative availableForIndent', { indentNo: indent.indentNo, itemCode: item.itemCode, totalStock: analysis.totalStock, poQuantity: analysis.poQuantity, previousIndentsQty: analysis.previousIndentsQty, itemQty: item.qty, availableForIndent });
                }
                
                return (
                  <tr key={`${indentIndex}-${itemIdx}`}>
                    <td>{indent.date}</td>
                    <td>{indent.indentNo}</td>
                    <td>{item.model}</td>
                    <td>{item.itemCode}</td>
                    <td>{item.qty}</td>
                    <td>{indent.indentBy}</td>
                    <td>{indent.oaNo}</td>
                    <td>{analysis.totalStock}</td>
                    <td>{analysis.previousIndentsQty}</td>
                    <td>{analysis.poQuantity}</td>
                    <td>
                      <span style={{
                        background: availableForIndent >= 0 ? '#43a047' : '#e53935',
                        color: '#fff',
                        fontWeight: 700,
                        padding: '6px 10px',
                        borderRadius: 6,
                        display: 'inline-block',
                        minWidth: 44,
                        textAlign: 'center'
                      }}>
                        {availableForIndent}
                      </span>
                    </td>
                    <td>
                      {analysis.isClosed ? (
                        <span style={{ 
                          background: '#43a047', 
                          color: '#fff', 
                          fontWeight: 600, 
                          padding: '4px 12px', 
                          borderRadius: 6,
                          display: 'inline-block',
                        }}>
                          CLOSED
                        </span>
                      ) : (
                        <span style={{ 
                          background: '#e53935', 
                          color: '#fff', 
                          fontWeight: 600, 
                          padding: '4px 12px', 
                          borderRadius: 6,
                          display: 'inline-block',
                        }}>
                          OPEN
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => {
                          const updatedIndents = indents.map((ind, idx) => {
                            if (idx !== indentIndex) return ind;
                            return {
                              ...ind,
                              items: ind.items.filter((_, i) => i !== itemIdx),
                            };
                          }).filter(ind => ind.items.length > 0);
                          setIndents(updatedIndents);
                          replaceFirestoreCollection(uid, 'indentData', updatedIndents).catch(err => {
                            console.error('Failed to update indent data:', err);
                          });
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
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{
        marginTop: 32,
        padding: 16,
        background: '#f5f5f5',
        border: '2px dashed #999',
        borderRadius: 4
      }}>
        <h3 style={{ marginTop: 0, color: '#333' }}>🔍 CORRECTED INDENT LOGIC</h3>
        
        <div style={{ 
          padding: 12, 
          background: '#e8f5e8', 
          border: '1px solid #4caf50',
          borderRadius: 4,
          marginBottom: 16
        }}>
          <h4 style={{ color: '#2e7d32', marginTop: 0 }}>✅ CORRECTED LOGIC EXPLANATION</h4>
          <p><strong>Previous Problem:</strong> OPEN indents were not contributing to cumulative allocation</p>
          <p><strong>New Solution:</strong> Cumulative total includes ACTUAL allocated amounts from both CLOSED and OPEN indents</p>
          <p><strong>Correct Behavior:</strong></p>
          <ul>
            <li>Indent 1: 50 allocated → Cumulative: 50</li>
            <li>Indent 2: 40 allocated → Cumulative: 90</li>
            <li>Indent 3: 10 allocated (of 20) → Cumulative: 100</li>
            <li>Indent 4: 0 allocated (of 40) → Cumulative: 100</li>
          </ul>
          <p><strong>Result:</strong> Available Before for Indent 4 = 100 - 100 = 0 (not 10)</p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h4 style={{ color: '#555' }}>Stock & Indent Analysis</h4>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button
              onClick={() => {
                console.log('[IndentDebug] All Indents:', indents);
                const analysis: any[] = [];
                indents.forEach((indent, indentIndex) => {
                  indent.items.forEach((item) => {
                    const analysisData = getIndentAnalysis(item.itemCode, indentIndex, item.qty);
                    const remaining = getRemainingStock(item.itemCode);
                    const allocated = getAllocatedStock(item.itemCode);
                    analysis.push({
                      indentNo: indent.indentNo,
                      itemCode: item.itemCode,
                      indentQty: item.qty,
                      totalStock: analysisData.totalStock,
                      previousIndentsQty: analysisData.previousIndentsQty,
                      poQuantity: analysisData.poQuantity,
                      availableForThisIndent: analysisData.availableForThisIndent,
                      allocatedAvailable: analysisData.allocatedAvailable,
                      isClosed: analysisData.isClosed,
                      remainingStock: remaining,
                      allocatedStock: allocated,
                      calculation: analysisData.calculation,
                      status: analysisData.isClosed ? 'CLOSED' : 'OPEN'
                    });
                  });
                });
                console.log('[IndentDebug] Corrected Analysis:', analysis);
                alert(`Analyzed ${analysis.length} items. Check console for detailed breakdown.`);
              }}
              style={{
                padding: '8px 12px',
                background: '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Analyze Corrected Indent Logic
            </button>

            <button
              onClick={() => setDebugOpen(d => !d)}
              style={{ padding: '8px 12px', background: '#1976d2', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              {debugOpen ? 'Hide' : 'Show'} Debug Panel
            </button>
          </div>

          {debugOpen && (
            <div style={{ marginTop: 8, padding: 12, background: '#fff', border: '1px solid #ddd', borderRadius: 6 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input placeholder="Filter (item code or name)" value={debugFilter} onChange={e => setDebugFilter(e.target.value)} style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc', minWidth: 240 }} />
                <button onClick={() => console.log('[IndentDebugPanel] rows:', debugRows)} style={{ padding: '8px 12px', background: '#ff9800', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Log Rows</button>
                <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(debugRows, null, 2)).then(()=>alert('Copied to clipboard'))} style={{ padding: '8px 12px', background: '#9c27b0', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Copy JSON</button>
                <button onClick={fetchStockOnce} style={{ padding: '8px 12px', background: '#607d8b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Refresh Stock (Firestore)</button>
              </div>

              <div style={{ maxHeight: 320, overflow: 'auto', borderTop: '1px solid #eee', paddingTop: 8 }}>
                <table border={1} cellPadding={8} style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f3f3f3' }}>
                      <th>Indent No</th>
                      <th>Item</th>
                      <th>Code</th>
                      <th>Qty</th>
                      <th>Total</th>
                      <th>Prev</th>
                      <th>PO</th>
                      <th>Available Before</th>
                      <th>Available After</th>
                      <th>Allocated</th>
                      <th>Calc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debugRows.filter(r => !debugFilter || String(r.itemCode).toLowerCase().includes(debugFilter.toLowerCase()) || String(r.itemName).toLowerCase().includes(debugFilter.toLowerCase())).map((r, i) => (
                      <tr key={i}>
                        <td>{r.indentNo}</td>
                        <td>{r.itemName}</td>
                        <td>{r.itemCode}</td>
                        <td>{r.qty}</td>
                        <td>{r.totalStock}</td>
                        <td>{r.previousIndentsQty}</td>
                        <td>{r.poQuantity}</td>
                        <td>{r.availableBefore}</td>
                        <td>{r.availableForThisIndent}</td>
                        <td>{r.allocatedAvailable}</td>
                        <td style={{ maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.calculation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IndentModule;