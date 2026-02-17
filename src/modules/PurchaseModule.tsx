import React, { useEffect, useState } from "react";
import bus from '../utils/eventBus';
import { subscribeFirestoreDocs, replaceFirestoreCollection } from '../utils/firestoreSync';

interface PurchaseEntry {
  orderPlaceDate: string;
  poNo: string;
  supplierName: string;
  itemName: string;
  itemCode: string;
  indentNo: string;
  indentDate?: string;
  indentBy: string;
  oaNo: string;
  originalIndentQty: number;
  purchaseQty: number;
  currentStock: number;
  indentStatus: string;
  receivedQty: number;
  okQty: number;
  rejectedQty: number;
  grnNo: string;
  debitNoteOrQtyReturned: string;
  remarks: string;
}

interface PurchaseModuleProps {
  user?: any;
}

const indentStatusOptions = ["Open", "Closed", "Partial"];

const PurchaseModule: React.FC<PurchaseModuleProps> = ({ user }) => {
  // Get uid from user prop or use a default
  const [uid] = useState<string>(user?.uid || 'default-user');

  const [entries, setEntries] = useState<PurchaseEntry[]>([]);
  const [itemNames, setItemNames] = useState<string[]>([]);
  const [lastImport, setLastImport] = useState<number>(0);
  
  // Real-time Firestore data
  const [openIndentItems, setOpenIndentItems] = useState<any[]>([]);
  const [closedIndentItems, setClosedIndentItems] = useState<any[]>([]);
  const [_stockRecords, setStockRecords] = useState<any[]>([]);
  const [indentData, setIndentData] = useState<any[]>([]);
  const [_itemMasterData, setItemMasterData] = useState<any[]>([]);
  const [_psirData, setPsirData] = useState<any[]>([]);

  const [newEntry, setNewEntry] = useState<PurchaseEntry>({
    orderPlaceDate: "",
    poNo: "",
    supplierName: "",
    itemName: "",
    itemCode: "",
    indentNo: "",
    indentBy: "",
    oaNo: "",
    originalIndentQty: 0,
    purchaseQty: 0,
    currentStock: 0,
    indentStatus: "Open",
    receivedQty: 0,
    okQty: 0,
    rejectedQty: 0,
    grnNo: "",
    debitNoteOrQtyReturned: "",
    remarks: "",
  });

  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editEntry, setEditEntry] = useState<PurchaseEntry | null>(null);
  // Debug panel state
  const [debugOpen, setDebugOpen] = useState<boolean>(false);
  const [debugOutput, setDebugOutput] = useState<string>('');
  const [lastDebugRun, setLastDebugRun] = useState<number | null>(null);

  // Subscribe to Firestore collections
  useEffect(() => {
    console.info('[PurchaseModule] Setting up Firestore subscriptions for user:', uid);
    
    // Note: Using correct collection names that match firestoreServices.ts
    const unsubOpen = subscribeFirestoreDocs(uid, 'openIndentItems', (docs) => {
      console.debug('[PurchaseModule] openIndentItems updated:', docs.length, 'records');
      setOpenIndentItems(docs);
    });
    const unsubClosed = subscribeFirestoreDocs(uid, 'closedIndentItems', (docs) => {
      console.debug('[PurchaseModule] closedIndentItems updated:', docs.length, 'records');
      setClosedIndentItems(docs);
    });
    const unsubStock = subscribeFirestoreDocs(uid, 'stockRecords', (docs) => {
      console.debug('[PurchaseModule] stockRecords updated:', docs.length, 'records');
      setStockRecords(docs);
    });
    const unsubIndent = subscribeFirestoreDocs(uid, 'indentData', (docs) => {
      console.debug('[PurchaseModule] indentData updated:', docs.length, 'records');
      setIndentData(docs);
    });
    const unsubItemMaster = subscribeFirestoreDocs(uid, 'itemMaster', (docs) => {
      console.debug('[PurchaseModule] itemMaster updated:', docs.length, 'records');
      setItemMasterData(docs);
    });
    const unsubPsir = subscribeFirestoreDocs(uid, 'psirData', (docs) => {
      console.debug('[PurchaseModule] psirData updated:', docs.length, 'records');
      setPsirData(docs);
    });
    
    return () => {
      console.debug('[PurchaseModule] Unsubscribing from all Firestore collections');
      unsubOpen();
      unsubClosed();
      unsubStock();
      unsubIndent();
      unsubItemMaster();
      unsubPsir();
    };
  }, [uid]);

  // 🎯 FIXED: Get status from indent source (open/closed indents)
  const getStatusFromIndent = (item: any): string => {
    const isInOpen = openIndentItems.some((openItem: any) => 
      openItem.indentNo === item.indentNo && 
      (openItem.itemCode === item.itemCode || openItem.Code === item.itemCode)
    );
    if (isInOpen) return "Open";
    
    const isInClosed = closedIndentItems.some((closedItem: any) => 
      closedItem.indentNo === item.indentNo && 
      (closedItem.itemCode === item.itemCode || closedItem.Code === item.itemCode)
    );
    if (isInClosed) return "Closed";
    
    return "Open"; // Default if not found
  };

  // 🎯 ENHANCED: Get stock from indent item - EXACT MATCH TO INDENT MODULE
  const getStockFromIndent = (item: any): number => {
    if (!item || typeof item !== 'object') return 0;
    
    // 🎯 PRIORITY 1: Direct stock fields (same as indent module)
    const primaryStockFields = [
      'stock', 'Stock', 'currentStock', 'Current Stock', 
      'availableStock', 'Available', 'available', 'instock', 'inStock',
      'balance', 'Balance', 'qty1'
    ];

    // 🎯 PRIORITY 2: Quantity fields that might represent stock
    const quantityFields = [
      'quantity', 'Quantity', 'qty', 'Qty'
    ];

    const tryParse = (v: any): number => {
      if (v === undefined || v === null || v === '') return 0;
      
      // If already a number
      if (typeof v === 'number' && !isNaN(v)) return v;
      
      // String: strip commas and extract number
      const s = String(v).trim();
      const noCommas = s.replace(/,/g, '');
      const m = noCommas.match(/-?\d+(?:\.\d+)?/);
      if (m) {
        const n = parseFloat(m[0]);
        if (!isNaN(n)) return n;
      }
      
      return 0;
    };

    // 🎯 FIRST: Try primary stock fields (exact match to indent module logic)
    for (const field of primaryStockFields) {
      if (Object.prototype.hasOwnProperty.call(item, field)) {
        const parsed = tryParse(item[field]);
        if (parsed !== 0) {
          console.log(`🎯 Found stock in field "${field}":`, parsed);
          return parsed;
        }
      }
    }

    // 🎯 SECOND: Try quantity fields
    for (const field of quantityFields) {
      if (Object.prototype.hasOwnProperty.call(item, field)) {
        const parsed = tryParse(item[field]);
        if (parsed !== 0) {
          console.log(`🎯 Using quantity as stock from field "${field}":`, parsed);
          return parsed;
        }
      }
    }

    // 🎯 THIRD: Calculate from qty - issued if available
    if (item.qty !== undefined && item.issued !== undefined) {
      const qty = tryParse(item.qty);
      const issued = tryParse(item.issued);
      const balance = qty - issued;
      if (balance >= 0) {
        console.log(`🎯 Calculated stock from (qty - issued):`, balance);
        return balance;
      }
    }

    console.log(`🎯 No stock found, defaulting to 0`);
    return 0;
  };

  // Get indent quantity from indent item
  const getIndentQtyFromIndent = (item: any): number => {
    const possibleQtyFields = [
      'qty', 'indentQty', 'quantity', 'Quantity', 
      'requestedQty', 'requiredQty', 'Qty', 'qty1'
    ];
    
    for (const field of possibleQtyFields) {
      if (item[field] !== undefined && item[field] !== null && item[field] !== '') {
        const qtyValue = Number(item[field]);
        if (!isNaN(qtyValue)) {
          return qtyValue;
        }
      }
    }
    
    return 0;
  };

  

  const normalizeField = (v: any): string => {
    if (v === undefined || v === null) return '';
    try {
      return String(v).trim().toUpperCase();
    } catch {
      return '';
    }
  };

  const makeKey = (indentNo: any, itemCode: any): string => {
    return `${normalizeField(indentNo)}|${normalizeField(itemCode)}`;
  };

  // 🎯 NEW: Deduplicate entries by indentNo + itemCode (keep first occurrence)
  const deduplicateEntries = (entries: PurchaseEntry[]): PurchaseEntry[] => {
    if (!Array.isArray(entries)) return [];
    
    const seen = new Set<string>();
    const deduplicated: PurchaseEntry[] = [];
    let duplicateCount = 0;

    for (const entry of entries) {
      const key = makeKey(entry.indentNo, entry.itemCode);
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(entry);
      } else {
        duplicateCount++;
        console.warn(`[PurchaseModule] ⚠️ Duplicate found and removed: ${key} (keeping first, removing this one)`);
      }
    }

    if (duplicateCount > 0) {
      console.log(`[PurchaseModule] Deduplication complete: removed ${duplicateCount} duplicate(s), keeping ${deduplicated.length} unique records`);
    }

    return deduplicated;
  };

  // 🎯 ENHANCED: Get live stock for a purchase entry - EXACT MATCH TO INDENT MODULE
  const getLiveStockForEntry = (entry: PurchaseEntry): number => {
    try {
      const allIndentItems = [...openIndentItems, ...closedIndentItems];

      const normIndent = normalizeField(entry.indentNo);
      const normCode = normalizeField(entry.itemCode);

      console.log(`🔍 Live stock lookup for: ${entry.indentNo} - ${entry.itemCode}`);

      // 🎯 PRIORITY 1: Exact match by indentNo + itemCode/Code
      for (const indentItem of allIndentItems) {
        if (!indentItem) continue;
        
        const itemIndentNo = normalizeField(indentItem.indentNo);
        const itemCodeA = normalizeField(indentItem.itemCode);
        const itemCodeB = normalizeField(indentItem.Code);
        
        if (itemIndentNo === normIndent && 
            (itemCodeA === normCode || itemCodeB === normCode)) {
          // To match IndentModule display we need to compute the same derived value:
          // cumulativeQty up to this indent/item vs. closingStock from stock-records.
          try {
            // Prefer explicit "Available for This Indent" if present on the indent item
            const availFromIndent = [
              indentItem.availableForThisIndent,
              indentItem.allocatedAvailable,
              indentItem.qty1,
              indentItem.available
            ].find(v => v !== undefined && v !== null);
            if (availFromIndent !== undefined && availFromIndent !== null) {
              const av = Number(availFromIndent);
              if (!isNaN(av)) {
                console.log('ℹ️ Using indent-provided available value for display:', av, indentItem);
                return av;
              }
            }
            // Use Firestore indentData from state
            const indents = indentData;

            // find the indices for this indent/item within indentData
            let found = false;
            let targetIndentIdx = -1;
            let targetItemIdx = -1;
            for (let i = 0; i < indents.length && !found; i++) {
              const ind = indents[i];
              if (!ind || !Array.isArray(ind.items)) continue;
              if (normalizeField(ind.indentNo) !== itemIndentNo) continue;
              for (let j = 0; j < ind.items.length; j++) {
                const it = ind.items[j];
                if (!it) continue;
                const codeA2 = normalizeField(it.itemCode);
                const codeB2 = normalizeField(it.Code || it.Item || '');
                if (codeA2 === normCode || codeB2 === normCode) {
                  targetIndentIdx = i;
                  targetItemIdx = j;
                  found = true;
                  break;
                }
              }
            }

            // Compute cumulative qty up to that point. If we can't find the
            // exact item inside `indentData` (possible when codes/keys differ),
            // fall back to the qty reported on the indent item itself.
            let cumulativeQty = 0;
            if (targetIndentIdx >= 0 && targetItemIdx >= 0) {
              for (let i = 0; i <= targetIndentIdx; i++) {
                const ind = indentData[i];
                if (!ind || !Array.isArray(ind.items)) continue;
                const limit = i === targetIndentIdx ? targetItemIdx + 1 : ind.items.length;
                for (let j = 0; j < limit; j++) {
                  const it = ind.items[j];
                  if (!it) continue;
                  const codeA3 = normalizeField(it.itemCode);
                  const codeB3 = normalizeField(it.Code || it.Item || '');
                  if (codeA3 === normCode || codeB3 === normCode) {
                    cumulativeQty += Number(it.qty) || 0;
                  }
                }
              }
            }

            if (cumulativeQty === 0) {
              const indentQtyFallback = getIndentQtyFromIndent(indentItem) || Number(indentItem.qty) || Number(indentItem.qty1) || 0;
              if (indentQtyFallback > 0) {
                console.log('⚠️ No matching item in indentData for live info; falling back to indent item qty:', indentQtyFallback);
                cumulativeQty = indentQtyFallback;
              }
            }

            // If we did not find the item in indentData, use the qty from the
            // indent item itself (this matches user expectations where the
            // indent row explicitly contains the intended qty).
            if (cumulativeQty === 0) {
              const indentQtyFallback = getIndentQtyFromIndent(indentItem) || Number(indentItem.qty) || Number(indentItem.qty1) || 0;
              if (indentQtyFallback > 0) {
                console.log('⚠️ No matching item in indentData; falling back to indent item qty:', indentQtyFallback);
                cumulativeQty = indentQtyFallback;
              }
            }

            // Get closing stock from stock-records (same as IndentModule.getStock)
            const stocks = _stockRecords;
            const stockRec = stocks.find((s: any) => normalizeField(s.itemCode) === normCode);
            const closingStock = stockRec && !isNaN(Number(stockRec.closingStock)) ? Number(stockRec.closingStock) : 0;

            let display: number;
            if (cumulativeQty > 0) {
              // If cumulative requirement exists, show requirement unless it's a shortage
              // (required > closingStock) in which case show the shortage amount.
              if (cumulativeQty > closingStock) display = cumulativeQty - closingStock;
              else display = cumulativeQty;
            } else {
              // No recorded cumulative requirement: fall back to closing stock value
              display = closingStock;
            }
            console.log(`✅ Exact match found - cumulativeQty: ${cumulativeQty}, closingStock: ${closingStock}, display: ${display}`, indentItem);
            return display;
          } catch (err) {
            // Fallback to reported stock from indent item
            const stock = getStockFromIndent(indentItem);
            console.log('⚠️ Error computing derived display stock, falling back to indent stock:', err, stock);
            return stock;
          }
        }
      }

      // 🎯 PRIORITY 2: Match by indentNo only (take first match)
      for (const indentItem of allIndentItems) {
        if (!indentItem) continue;
        
        const itemIndentNo = normalizeField(indentItem.indentNo);
        if (itemIndentNo === normIndent) {
          // Attempt same derived calculation using indentData for first matching item
          try {
            const normCodeFallback = normalizeField(indentItem.itemCode || indentItem.Code || '');
            let targetIndentIdx = -1;
            let targetItemIdx = -1;
            for (let i = 0; i < indentData.length; i++) {
              if (normalizeField(indentData[i].indentNo) !== itemIndentNo) continue;
              targetIndentIdx = i;
              // find first matching item code within this indent
              for (let j = 0; j < (indentData[i].items || []).length; j++) {
                const it = indentData[i].items[j];
                if (!it) continue;
                const codeA4 = normalizeField(it.itemCode);
                const codeB4 = normalizeField(it.Code || it.Item || '');
                if (codeA4 === normCodeFallback || codeB4 === normCodeFallback) {
                  targetItemIdx = j;
                  break;
                }
              }
              break;
            }

            let cumulativeQty = 0;
            if (targetIndentIdx >= 0 && targetItemIdx >= 0) {
              const normCode2 = normalizeField(indentItem.itemCode || indentItem.Code || '');
              for (let i = 0; i <= targetIndentIdx; i++) {
                const ind = indentData[i];
                if (!ind || !Array.isArray(ind.items)) continue;
                const limit = i === targetIndentIdx ? targetItemIdx + 1 : ind.items.length;
                for (let j = 0; j < limit; j++) {
                  const it = ind.items[j];
                  if (!it) continue;
                  const codeA5 = normalizeField(it.itemCode);
                  const codeB5 = normalizeField(it.Code || it.Item || '');
                  if (codeA5 === normCode2 || codeB5 === normCode2) {
                    cumulativeQty += Number(it.qty) || 0;
                  }
                }
              }
            }

            if (cumulativeQty === 0) {
              const indentQtyFallback = getIndentQtyFromIndent(indentItem) || Number(indentItem.qty) || Number(indentItem.qty1) || 0;
              if (indentQtyFallback > 0) {
                console.log('⚠️ No matching item in indentData for indentNo fallback; using indent item qty:', indentQtyFallback);
                cumulativeQty = indentQtyFallback;
              }
            }

            const stocks = _stockRecords;
            const stockRec = stocks.find((s: any) => normalizeField(s.itemCode) === normalizeField(indentItem.itemCode || indentItem.Code || ''));
            const closingStock = stockRec && !isNaN(Number(stockRec.closingStock)) ? Number(stockRec.closingStock) : 0;

            let display: number;
            if (cumulativeQty > 0) {
              if (cumulativeQty > closingStock) display = cumulativeQty - closingStock;
              else display = cumulativeQty;
            } else {
              display = closingStock;
            }
            console.log(`⚠️ Fallback by indentNo computed display - cumulativeQty: ${cumulativeQty}, closingStock: ${closingStock}, display: ${display}`, indentItem);
            return display;
          } catch (err) {
            const stock = getStockFromIndent(indentItem);
            console.log('⚠️ Fallback error computing derived display, using indent stock:', err, stock);
            return stock;
          }
        }
      }

      console.log(`❌ No matching indent item found`);
    } catch (err) {
      console.error('❌ Error reading indent items for live stock:', err);
    }

    // Final fallback to stored value
    console.log(`📦 Using stored purchase stock: ${entry.currentStock}`);
    return entry.currentStock || 0;
  };

  // Get live stock display + whether it's a shortage (matches IndentModule display logic)
  const getLiveStockInfo = (entry: PurchaseEntry): { display: number; isShort: boolean } => {
    try {
      const allIndentItems = [...openIndentItems, ...closedIndentItems];

      const normIndent = normalizeField(entry.indentNo);
      const normCode = normalizeField(entry.itemCode);

      // Exact match by indentNo + itemCode/Code
      for (const indentItem of allIndentItems) {
        if (!indentItem) continue;
        const itemIndentNo = normalizeField(indentItem.indentNo);
        const itemCodeA = normalizeField(indentItem.itemCode);
        const itemCodeB = normalizeField(indentItem.Code);
        if (itemIndentNo === normIndent && (itemCodeA === normCode || itemCodeB === normCode)) {
          try {
            // Prefer explicit "Available for This Indent" if present on the indent item
            const availFromIndent = [
              indentItem.availableForThisIndent,
              indentItem.allocatedAvailable,
              indentItem.qty1,
              indentItem.available
            ].find(v => v !== undefined && v !== null);
            if (availFromIndent !== undefined && availFromIndent !== null) {
              const av = Number(availFromIndent);
              if (!isNaN(av)) {
                console.log('ℹ️ Using indent-provided available value for display:', av, indentItem);
                return { display: av, isShort: false };
              }
            }

            // Use Firestore indentData from state
            const indents = indentData;

            // find the indices for this indent/item within indentData
            let found = false;
            let targetIndentIdx = -1;
            let targetItemIdx = -1;
            for (let i = 0; i < indents.length && !found; i++) {
              const ind = indents[i];
              if (!ind || !Array.isArray(ind.items)) continue;
              if (normalizeField(ind.indentNo) !== itemIndentNo) continue;
              for (let j = 0; j < ind.items.length; j++) {
                const it = ind.items[j];
                if (!it) continue;
                const codeA2 = normalizeField(it.itemCode);
                const codeB2 = normalizeField(it.Code || it.Item || '');
                if (codeA2 === normCode || codeB2 === normCode) {
                  targetIndentIdx = i;
                  targetItemIdx = j;
                  found = true;
                  break;
                }
              }
            }

            let cumulativeQty = 0;
            if (targetIndentIdx >= 0 && targetItemIdx >= 0) {
              for (let i = 0; i <= targetIndentIdx; i++) {
                const ind = indentData[i];
                if (!ind || !Array.isArray(ind.items)) continue;
                const limit = i === targetIndentIdx ? targetItemIdx + 1 : ind.items.length;
                for (let j = 0; j < limit; j++) {
                  const it = ind.items[j];
                  if (!it) continue;
                  const codeA3 = normalizeField(it.itemCode);
                  const codeB3 = normalizeField(it.Code || it.Item || '');
                  if (codeA3 === normCode || codeB3 === normCode) {
                    cumulativeQty += Number(it.qty) || 0;
                  }
                }
              }
            }

            // If cumulativeQty is zero, check for indent-level available fields

            if (cumulativeQty === 0) {
              const indentQtyFallback = getIndentQtyFromIndent(indentItem) || Number(indentItem.qty) || Number(indentItem.qty1) || 0;
              if (indentQtyFallback > 0) {
                console.log('⚠️ No matching item in indentData for indentNo fallback; using indent item qty:', indentQtyFallback);
                cumulativeQty = indentQtyFallback;
              }
            }

            const stocks = _stockRecords;
            const stockRec = stocks.find((s: any) => normalizeField(s.itemCode) === normCode);
            const closingStock = stockRec && !isNaN(Number(stockRec.closingStock)) ? Number(stockRec.closingStock) : 0;

            let display: number;
            if (cumulativeQty > 0) {
              if (cumulativeQty > closingStock) display = cumulativeQty - closingStock;
              else display = cumulativeQty;
            } else {
              display = closingStock;
            }
            const isShort = cumulativeQty > closingStock;
            return { display, isShort };
          } catch (err) {
            const stock = getStockFromIndent(indentItem);
            return { display: stock, isShort: false };
          }
        }
      }

      // Fallback: match by indentNo only
      for (const indentItem of allIndentItems) {
        if (!indentItem) continue;
        const itemIndentNo = normalizeField(indentItem.indentNo);
        if (itemIndentNo === normIndent) {
          try {
            // Prefer explicit "Available for This Indent" if present on the indent item
            const availFromIndent = [
              indentItem.availableForThisIndent,
              indentItem.allocatedAvailable,
              indentItem.qty1,
              indentItem.available
            ].find(v => v !== undefined && v !== null);
            if (availFromIndent !== undefined && availFromIndent !== null) {
              const av = Number(availFromIndent);
              if (!isNaN(av)) {
                console.log('ℹ️ Using indent-provided available value for display (indentNo fallback):', av, indentItem);
                return { display: av, isShort: false };
              }
            }
            const normCodeFallback = normalizeField(indentItem.itemCode || indentItem.Code || '');
            let targetIndentIdx = -1;
            let targetItemIdx = -1;
            for (let i = 0; i < indentData.length; i++) {
              if (normalizeField(indentData[i].indentNo) !== itemIndentNo) continue;
              targetIndentIdx = i;
              for (let j = 0; j < (indentData[i].items || []).length; j++) {
                const it = indentData[i].items[j];
                if (!it) continue;
                const codeA4 = normalizeField(it.itemCode);
                const codeB4 = normalizeField(it.Code || it.Item || '');
                if (codeA4 === normCodeFallback || codeB4 === normCodeFallback) {
                  targetItemIdx = j;
                  break;
                }
              }
              break;
            }

            let cumulativeQty = 0;
            if (targetIndentIdx >= 0 && targetItemIdx >= 0) {
              const normCode2 = normalizeField(indentItem.itemCode || indentItem.Code || '');
              for (let i = 0; i <= targetIndentIdx; i++) {
                const ind = indentData[i];
                if (!ind || !Array.isArray(ind.items)) continue;
                const limit = i === targetIndentIdx ? targetItemIdx + 1 : ind.items.length;
                for (let j = 0; j < limit; j++) {
                  const it = ind.items[j];
                  if (!it) continue;
                  const codeA5 = normalizeField(it.itemCode);
                  const codeB5 = normalizeField(it.Code || it.Item || '');
                  if (codeA5 === normCode2 || codeB5 === normCode2) {
                    cumulativeQty += Number(it.qty) || 0;
                  }
                }
              }
            }

            const stocks = _stockRecords;
            const stockRec = stocks.find((s: any) => normalizeField(s.itemCode) === normalizeField(indentItem.itemCode || indentItem.Code || ''));
            const closingStock = stockRec && !isNaN(Number(stockRec.closingStock)) ? Number(stockRec.closingStock) : 0;

            let display: number;
            if (cumulativeQty > 0) {
              if (cumulativeQty > closingStock) display = cumulativeQty - closingStock;
              else display = cumulativeQty;
            } else {
              display = closingStock;
            }
            const isShort = cumulativeQty > closingStock;
            return { display, isShort };
          } catch (err) {
            const stock = getStockFromIndent(indentItem);
            return { display: stock, isShort: false };
          }
        }
      }

      // Final fallback to stored value
      return { display: entry.currentStock || 0, isShort: false };
    } catch (err) {
      console.error('❌ Error reading indent items for live stock info:', err);
      return { display: entry.currentStock || 0, isShort: false };
    }
  };

  // 🎯 NEW: Force refresh all stock data from indent module
  const forceStockRefresh = () => {
    console.log('🔄 Force refreshing all stock data from indent module...');
    
    const updatedEntries = entries.map(entry => {
      const liveStock = getLiveStockForEntry(entry);
      
      if (liveStock !== entry.currentStock) {
        console.log(`🔄 Updating stock for ${entry.indentNo}: ${entry.currentStock} → ${liveStock}`);
        return {
          ...entry,
          currentStock: liveStock,
          remarks: `${entry.remarks || ''} | Stock force-refreshed: ${liveStock}`.trim()
        };
      }
      
      return entry;
    });

    const changedEntries = updatedEntries.filter((entry, index) => 
      entry.currentStock !== entries[index]?.currentStock
    );

    if (changedEntries.length > 0) {
      setEntries(updatedEntries);
      saveEntries(updatedEntries);
      alert(`✅ Stock refreshed! Updated ${changedEntries.length} entries with latest indent module stock.`);
    } else {
      alert('ℹ️ Stock is already up-to-date with indent module.');
    }
  };

  // Debug helpers
  const formatJSON = (v: any) => {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };

  const generateDebugReport = () => {
    try {
      const purchaseData = entries;

      const stockComparison = purchaseData.map((entry: any) => {
        const liveStock = getLiveStockForEntry(entry);
        return {
          indentNo: entry.indentNo,
          itemCode: entry.itemCode,
          storedStock: entry.currentStock,
          liveStock: liveStock,
          match: entry.currentStock === liveStock,
          difference: liveStock - entry.currentStock
        };
      });

      const report = {
        timestamp: new Date().toISOString(),
        counts: {
          openIndentItems: openIndentItems.length,
          closedIndentItems: closedIndentItems.length,
          purchaseRecords: purchaseData.length,
          stockMatches: stockComparison.filter((s: any) => s.match).length,
          stockMismatches: stockComparison.filter((s: any) => !s.match).length
        },
        sampleIndentItems: [...openIndentItems, ...closedIndentItems].slice(0, 3),
        stockComparison: stockComparison.filter((s: any) => !s.match), // Show only mismatches
        allPurchaseEntries: purchaseData.slice(0, 5)
      };

      setDebugOutput(formatJSON(report));
      setLastDebugRun(Date.now());
      setDebugOpen(true);
    } catch (err) {
      setDebugOutput('Error generating report: ' + String(err));
      setDebugOpen(true);
    }
  };

  const persistIndentStockToPurchaseData = () => {
    try {
      const updated = entries.map((entry: any) => {
        const live = getLiveStockForEntry(entry);
        if (live !== entry.currentStock) {
          return { 
            ...entry, 
            currentStock: live, 
            remarks: `${entry.remarks || ''} | Stock synced: ${live}`.trim() 
          };
        }
        return entry;
      });
      
      const changedCount = updated.filter((entry: any, index: number) => 
        entry.currentStock !== entries[index]?.currentStock
      ).length;
      
      saveEntries(updated);
      setEntries(updated);
      setDebugOutput(prev => prev + `\n\n✅ Persisted stock for ${changedCount} purchaseData entries.`);
    } catch (err) {
      setDebugOutput('❌ Error persisting stock: ' + String(err));
    }
  };

  const seedSampleIndents = () => {
    const sampleOpen = [
      { 
        indentNo: 'S-8/25-02', 
        itemName: 'WH 135 Body', 
        itemCode: 'CB-101', 
        qty: 50, 
        stock: 40, 
        indentBy: 'HKG', 
        date: '2025-11-20' 
      },
      { 
        indentNo: 'S-8/25-03', 
        itemName: 'Engine Oil', 
        itemCode: 'OIL-001', 
        qty: 100, 
        stock: 25, 
        indentBy: 'HKG', 
        date: '2025-11-20' 
      }
    ];
    const sampleClosed = [
      { 
        indentNo: 'S-8/25-01', 
        itemName: 'WH 135 Body', 
        itemCode: 'CB-101', 
        qty: 140, 
        stock: 150, 
        indentBy: 'HKG', 
        date: '2025-11-20' 
      }
    ];
    replaceFirestoreCollection(uid, 'openIndentItems', sampleOpen).catch(err => console.error(err));
    replaceFirestoreCollection(uid, 'closedIndentItems', sampleClosed).catch(err => console.error(err));
    setDebugOutput(prev => prev + '\n\n✅ Seeded sample indent items into Firestore.');
  };

  const clearDebugOutput = () => { setDebugOutput(''); };

  // Save function
  const saveEntries = (data: PurchaseEntry[]): PurchaseEntry[] => {
    console.log('[PurchaseModule] Saving data:', data.length, 'entries');
    // Always deduplicate before saving to prevent duplicates from reaching Firestore
    const dedupedData = deduplicateEntries(data);
    replaceFirestoreCollection(uid, 'purchaseData', dedupedData).catch(err => console.error(err));
    replaceFirestoreCollection(uid, 'purchaseOrders', dedupedData).catch(err => console.error(err));
    
    try {
      bus.dispatchEvent(new CustomEvent('purchaseOrders.updated', { detail: dedupedData }));
    } catch (err) {
      console.error('[PurchaseModule] Error dispatching event:', err);
    }

    return dedupedData;
  };

  // Manual import function - SYNC STATUS AND STOCK FROM INDENT MODULE
  const manuallyImportAndOverwrite = () => {
    console.log('[PurchaseModule] Manual import triggered');
    
    const allIndentItems = [...openIndentItems, ...closedIndentItems];

    if (allIndentItems.length === 0) {
      alert('No indent items found in storage');
      return;
    }

    try {
      let updatedCount = 0;
      let createdCount = 0;

      const existingEntriesMap = new Map();
      entries.forEach(entry => {
        existingEntriesMap.set(makeKey(entry.indentNo, entry.itemCode), entry);
      });

      const updatedEntries = [...entries];

      allIndentItems.forEach((item: any) => {
        if (!item.indentNo) return;
        
        const key = makeKey(item.indentNo, item.itemCode || '');
        const stock = getStockFromIndent(item); // Get actual stock from indent
        const indentQty = getIndentQtyFromIndent(item);
        
        // 🎯 FIXED: Get status from indent source, not calculation
        const indentStatus = getStatusFromIndent(item);

        console.log(`Importing: ${item.indentNo} - ${item.itemCode}, Status: ${indentStatus}, Stock: ${stock}, Qty: ${indentQty}`);

        if (existingEntriesMap.has(key)) {
          const entryIndex = updatedEntries.findIndex(e => 
            makeKey(e.indentNo, e.itemCode) === key
          );

          if (entryIndex >= 0) {
            // Update status, stock and PO Qty according to new rule:
            // If status is 'Open' => PO Qty = stock, else (Closed) => PO Qty = 0
            const updatedEntry = {
              ...updatedEntries[entryIndex],
              originalIndentQty: indentQty,
              currentStock: stock, // Always update stock from indent
              indentStatus: indentStatus, // Use actual status from indent
              purchaseQty: (indentStatus === 'Open') ? stock : 0,
              oaNo: item.oaNo || item.OA || '',
              remarks: `Updated from indent: ${indentStatus}, Stock: ${stock}`,
            };
            updatedEntries[entryIndex] = updatedEntry;
            updatedCount++;
          }
        } else {
          const newEntryObj: PurchaseEntry = {
            orderPlaceDate: '',
            poNo: '',
            supplierName: '',
            itemName: item.model || item.itemName || item.Item || item.description || '',
            itemCode: item.itemCode || item.Code || '',
            indentNo: item.indentNo || '',
            indentDate: item.date || item.indentDate || '',
            indentBy: item.indentBy || '',
            oaNo: item.oaNo || item.OA || '',
            originalIndentQty: indentQty,
            // PO Qty rule: If status is 'Open' => PO Qty = live-stock, else (Closed) => PO Qty = 0
            purchaseQty: (indentStatus === 'Open' ? (getLiveStockForEntry({ indentNo: item.indentNo || '', itemCode: item.itemCode || item.Code || '', currentStock: stock } as any) || indentQty) : 0),
            currentStock: stock, // Use actual stock from indent
            indentStatus: indentStatus, // Use actual status from indent
            receivedQty: 0,
            okQty: 0,
            rejectedQty: 0,
            grnNo: '',
            debitNoteOrQtyReturned: '',
            remarks: `Imported from indent: ${indentStatus}, Stock: ${stock}`,
          };
          updatedEntries.push(newEntryObj);
          createdCount++;
        }
      });

      const finalEntries = saveEntries(updatedEntries);
      const dedupedEntries = deduplicateEntries(finalEntries);
      setEntries(dedupedEntries);
      setLastImport(Date.now());

      alert(`✅ Import completed: Updated ${updatedCount}, Created ${createdCount}. Duplicates removed. Status and Stock synced from indent module.`);
    } catch (error) {
      console.error('[PurchaseModule] Import error:', error);
      alert('❌ Error during import');
    }
  };

  // Load saved entries from Firestore
  useEffect(() => {
    console.log('[PurchaseModule] Loading data from Firestore (purchaseData)');
    
    const unsub = subscribeFirestoreDocs(uid, 'purchaseData', (docs) => {
      if (docs && docs.length > 0) {
        try {
          // Ensure data shape is correct
          const migratedData = docs.map((entry: any) => ({
            ...entry,
            originalIndentQty: entry.originalIndentQty ?? entry.qty ?? 0,
            purchaseQty: entry.purchaseQty ?? entry.poQty ?? entry.qty ?? 0,
            currentStock: entry.currentStock ?? entry.inStock ?? 0,
            okQty: entry.okQty ?? 0,
            receivedQty: entry.receivedQty ?? 0,
            rejectedQty: entry.rejectedQty ?? 0,
          }));
          const dedupedData = deduplicateEntries(migratedData);
          setEntries(dedupedData);
        } catch (error) {
          console.error('[PurchaseModule] Error processing purchaseData:', error);
          setEntries([]);
        }
      } else {
        setEntries([]);
      }
    });

    return unsub;
  }, [uid]);

  // 🎯 FIXED: Real-time updates - SYNC STATUS AND STOCK FROM INDENT MODULE
  useEffect(() => {
    const handler = (e: any) => {
      console.log('[PurchaseModule] Received indents.updated event, syncing status and stock...');
      
      const openItems: any[] = e?.detail?.openItems || [];
      const closedItems: any[] = e?.detail?.closedItems || [];
      
      // Create status and stock maps from indent data
      const statusMap = new Map<string, string>();
      const stockMap = new Map<string, number>();
      const stockByIndentNo = new Map<string, number>(); // fallback by indentNo only

      const processIndentItem = (item: any, status: string) => {
        if (!item || !item.indentNo) return;
        const codeA = item.itemCode || '';
        const codeB = item.Code || '';
        const keyA = makeKey(item.indentNo, codeA);
        const keyB = makeKey(item.indentNo, codeB);
        statusMap.set(keyA, status);
        statusMap.set(keyB, status);
        
        // 🎯 IMPORTANT: Always get fresh stock data from indent
        const stockVal = getStockFromIndent(item);
        if (stockVal !== undefined) {
          stockMap.set(keyA, stockVal);
          stockMap.set(keyB, stockVal);
          stockByIndentNo.set(normalizeField(item.indentNo), stockVal);
        }
      };

      openItems.forEach((item: any) => processIndentItem(item, 'Open'));
      closedItems.forEach((item: any) => processIndentItem(item, 'Closed'));

      setEntries(prevEntries => {
        const updatedEntries = prevEntries.map(entry => {
          const key = makeKey(entry.indentNo, entry.itemCode);
          const newStatus = statusMap.get(key);
          let newStock = stockMap.has(key) ? stockMap.get(key) : undefined;

          // Fallback: try matching by indentNo only
          if (newStock === undefined) {
            const fallback = stockByIndentNo.get(normalizeField(entry.indentNo));
            if (fallback !== undefined) newStock = fallback;
          }

          let changed = false;
          let updatedEntry = { ...entry };

          if (newStatus && entry.indentStatus !== newStatus) {
            console.log(`🔄 Syncing status for ${entry.indentNo}: ${entry.indentStatus} → ${newStatus}`);
            updatedEntry.indentStatus = newStatus;
            updatedEntry.remarks = `Status synced from indent: ${newStatus}`;
            changed = true;
          }

          // 🎯 IMPORTANT: Always update stock when available from indent
          if (newStock !== undefined && newStock !== entry.currentStock) {
            console.log(`🔄 Syncing stock for ${entry.indentNo}: ${entry.currentStock} → ${newStock}`);
            updatedEntry.currentStock = newStock;
            updatedEntry.remarks = `${updatedEntry.remarks || ''} | Stock synced from indent: ${newStock}`.trim();
            changed = true;
          }

          // 📌 Ensure purchaseQty follows rule: Open => stock, Closed => 0
          try {
            const effectiveStatus = newStatus ?? updatedEntry.indentStatus;
            const effectiveStock = (newStock !== undefined) ? newStock : updatedEntry.currentStock;
            const desiredPurchaseQty = effectiveStatus === 'Open' ? effectiveStock : 0;
            if (updatedEntry.purchaseQty !== desiredPurchaseQty) {
              updatedEntry.purchaseQty = desiredPurchaseQty;
              updatedEntry.remarks = `${updatedEntry.remarks || ''} | PO Qty synced: ${desiredPurchaseQty}`.trim();
              changed = true;
            }
          } catch (err) {
            // ignore sync error
          }

          return changed ? updatedEntry : entry;
        });

        const changed = JSON.stringify(updatedEntries) !== JSON.stringify(prevEntries);
        if (changed) {
          const finalEntries = saveEntries(updatedEntries);
          return finalEntries;
        }
        return prevEntries;
      });
    };

    try {
      bus.addEventListener('indents.updated', handler as EventListener);
    } catch (err) {
      console.error('[PurchaseModule] Error registering indents.updated listener:', err);
    }

    return () => {
      try {
        bus.removeEventListener('indents.updated', handler as EventListener);
      } catch (err) {
        console.error('[PurchaseModule] Error removing indents.updated listener:', err);
      }
    };
  }, []);

  // Auto-fill Received, OK, Rejected quantities from PSIR module
  useEffect(() => {
    if (!newEntry.poNo || !newEntry.itemCode) return;
    
    try {
      const psirs = _psirData;
      if (!Array.isArray(psirs)) return;
      
      // Find matching PSIR record for this PO and item
      const matchingPSIR = psirs.find((psir: any) => 
        psir.poNo === newEntry.poNo && 
        Array.isArray(psir.items) &&
        psir.items.some((item: any) => item.itemCode === newEntry.itemCode)
      );
      
      if (matchingPSIR && Array.isArray(matchingPSIR.items)) {
        const matchingItem = matchingPSIR.items.find((item: any) => item.itemCode === newEntry.itemCode);
        
        if (matchingItem) {
          const receivedQty = matchingItem.qtyReceived || 0;
          const okQty = matchingItem.okQty || 0;
          const rejectedQty = matchingItem.rejectQty || 0;
          
          console.debug('[PurchaseModule][AutoFill] Found PSIR data for PO:', newEntry.poNo, 'Item:', newEntry.itemCode, {
            receivedQty,
            okQty,
            rejectedQty
          });
          
          setNewEntry(prev => ({
            ...prev,
            receivedQty,
            okQty,
            rejectedQty
          }));
        }
      }
    } catch (e) {
      console.error('[PurchaseModule][AutoFill] Error reading PSIR data:', e);
    }
  }, [newEntry.poNo, newEntry.itemCode]);

  // Sync Received, OK, Rejected quantities from PSIR to existing entries
  useEffect(() => {
    if (entries.length === 0) return;
    
    try {
      const psirs = _psirData;
      if (!Array.isArray(psirs)) return;
      
      let updated = false;
      const updatedEntries = entries.map(entry => {
        // Find matching PSIR record for this entry
        const matchingPSIR = psirs.find((psir: any) => 
          psir.poNo === entry.poNo && 
          Array.isArray(psir.items)
        );
        
        if (matchingPSIR && Array.isArray(matchingPSIR.items)) {
          const matchingItem = matchingPSIR.items.find((item: any) => item.itemCode === entry.itemCode);
          
          if (matchingItem) {
            const newReceivedQty = matchingItem.qtyReceived || 0;
            const newOkQty = matchingItem.okQty || 0;
            const newRejectedQty = matchingItem.rejectQty || 0;
            
            // Only update if values differ
            if (newReceivedQty !== entry.receivedQty || newOkQty !== entry.okQty || newRejectedQty !== entry.rejectedQty) {
              console.debug('[PurchaseModule][Sync] Updating PSIR data for PO:', entry.poNo, 'Item:', entry.itemCode);
              updated = true;
              return {
                ...entry,
                receivedQty: newReceivedQty,
                okQty: newOkQty,
                rejectedQty: newRejectedQty
              };
            }
          }
        }
        return entry;
      });
      
      if (updated) {
        console.debug('[PurchaseModule][Sync] Syncing PSIR data to purchase entries');
        setEntries(updatedEntries);
        saveEntries(updatedEntries);
      }
    } catch (e) {
      console.error('[PurchaseModule][Sync] Error syncing PSIR data:', e);
    }
  }, [entries, entries.length]);

  // Listen for PSIR updates and trigger re-sync
  useEffect(() => {
    const handlePSIRUpdate = () => {
      console.log('[PurchaseModule] PSIR data updated event received');
      // Force a sync by creating a fresh copy of entries
      setEntries(prev => [...prev]);
    };

    bus.addEventListener('psir.updated', handlePSIRUpdate as EventListener);
    console.log('[PurchaseModule] Listeners registered for PSIR updates');

    return () => {
      bus.removeEventListener('psir.updated', handlePSIRUpdate as EventListener);
      console.log('[PurchaseModule] Listeners removed for PSIR updates');
    };
  }, []);

  // Load item master names
  useEffect(() => {
    if (Array.isArray(_itemMasterData)) {
      setItemNames(_itemMasterData.map((i: any) => i.itemName).filter(Boolean));
    }
  }, [_itemMasterData]);

  // One-time sync at startup: refresh purchaseData from indent storage so Stock reflects current indent values
  useEffect(() => {
    try {
      // call refreshData which will update entries and persist changes when needed
      refreshData();
    } catch (err) {
      console.error('Error running initial refreshData:', err);
    }
  }, []);

  // 🎯 FIXED: Refresh data - SYNC STATUS AND STOCK FROM INDENT MODULE
  const refreshData = () => {
    console.log('[PurchaseModule] Refreshing data with status and stock sync');
    
    if (entries.length === 0) return;

    try {
      const parsedData = entries;
      
      // Create status and stock maps
      const statusMap = new Map<string, string>();
      const stockMap = new Map<string, number>();
      const stockByIndentNo = new Map<string, number>();

      const processIndentItem = (item: any, status: string) => {
        if (!item || !item.indentNo) return;
        const codeA = item.itemCode || '';
        const codeB = item.Code || '';
        const keyA = makeKey(item.indentNo, codeA);
        const keyB = makeKey(item.indentNo, codeB);
        statusMap.set(keyA, status);
        statusMap.set(keyB, status);
        
        // 🎯 IMPORTANT: Always get fresh stock data from indent
        const stockVal = getStockFromIndent(item);
        if (stockVal !== undefined) {
          stockMap.set(keyA, stockVal);
          stockMap.set(keyB, stockVal);
          stockByIndentNo.set(normalizeField(item.indentNo), stockVal);
        }
      };

      openIndentItems.forEach((item: any) => processIndentItem(item, 'Open'));
      closedIndentItems.forEach((item: any) => processIndentItem(item, 'Closed'));
      
      const refreshedData = parsedData.map((entry: PurchaseEntry) => {
        const key = makeKey(entry.indentNo, entry.itemCode);
        const newStatus = statusMap.get(key);
        let newStock = stockMap.has(key) ? stockMap.get(key) : undefined;

        // fallback by indentNo
        if (newStock === undefined) {
          const fallback = stockByIndentNo.get(normalizeField(entry.indentNo));
          if (fallback !== undefined) newStock = fallback;
        }

        const updated = { ...entry };
        let didChange = false;

        if (newStatus && entry.indentStatus !== newStatus) {
          updated.indentStatus = newStatus;
          updated.remarks = `Status refreshed from indent: ${newStatus}`;
          didChange = true;
        }

        // 🎯 IMPORTANT: Always update stock when available from indent
        if (newStock !== undefined && newStock !== entry.currentStock) {
          updated.currentStock = newStock;
          updated.remarks = `${updated.remarks || ''} | Stock refreshed from indent: ${newStock}`.trim();
          didChange = true;
        }

        // 📌 Ensure purchaseQty follows rule: Open => stock, Closed => 0
        try {
          const effectiveStatus = newStatus ?? updated.indentStatus;
          const effectiveStock = (newStock !== undefined) ? newStock : updated.currentStock;
          const desiredPurchaseQty = effectiveStatus === 'Open' ? effectiveStock : 0;
          if (updated.purchaseQty !== desiredPurchaseQty) {
            updated.purchaseQty = desiredPurchaseQty;
            updated.remarks = `${updated.remarks || ''} | PO Qty refreshed: ${desiredPurchaseQty}`.trim();
            didChange = true;
          }
        } catch (err) {
          // ignore
        }

        return didChange ? updated : entry;
      });

      setEntries(refreshedData);
      saveEntries(refreshedData);
      alert('✅ Data refreshed with status and stock synced from indent module.');
    } catch (error) {
      console.error('[PurchaseModule] Error refreshing data:', error);
      alert('❌ Error refreshing data');
    }
  };

  // Debug function to check status and stock sync
  const debugStatusSync = () => {
    console.log('=== DEBUG STATUS & STOCK SYNC ===');
    
    console.log('Open Indents:', openIndentItems);
    console.log('Closed Indents:', closedIndentItems);
    console.log('Purchase Entries:', entries);
    
    // Build the same maps used by the sync logic so we can inspect them
    const statusMap = new Map<string, string>();
    const stockMap = new Map<string, number>();
    const stockByIndentNo = new Map<string, number>();

    const processIndentItem = (item: any, status: string) => {
      if (!item || !item.indentNo) return;
      const codeA = item.itemCode || '';
      const codeB = item.Code || '';
      const keyA = makeKey(item.indentNo, codeA);
      const keyB = makeKey(item.indentNo, codeB);
      statusMap.set(keyA, status);
      statusMap.set(keyB, status);
      const stockVal = getStockFromIndent(item);
      if (stockVal !== undefined) {
        stockMap.set(keyA, stockVal);
        stockMap.set(keyB, stockVal);
        stockByIndentNo.set(normalizeField(item.indentNo), stockVal);
      }
    };

    openIndentItems.forEach((it: any) => processIndentItem(it, 'Open'));
    closedIndentItems.forEach((it: any) => processIndentItem(it, 'Closed'));

    console.log('Computed statusMap keys:', Array.from(statusMap.keys()));
    console.log('Computed stockMap entries:', Array.from(stockMap.entries()));
    console.log('Computed stockByIndentNo entries:', Array.from(stockByIndentNo.entries()));

    entries.forEach((entry, index) => {
      const key = makeKey(entry.indentNo, entry.itemCode);
      const exactStock = stockMap.has(key) ? stockMap.get(key) : undefined;
      const fallbackStock = stockByIndentNo.get(normalizeField(entry.indentNo));
      const usedStock = exactStock !== undefined ? exactStock : fallbackStock;
      const actualStatus = statusMap.get(key) || 'Not found';

      console.log(`Entry ${index} lookup:`, {
        indentNo: entry.indentNo,
        itemCode: entry.itemCode,
        key,
        exactStock,
        fallbackStock,
        usedStock,
        purchaseStock: entry.currentStock,
        statusInMap: actualStatus,
        purchaseStatus: entry.indentStatus
      });
    });
    
    alert('✅ Check console for status and stock sync debug information');
  };

  // Handlers (remain the same)
  const handleNewChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    let numValue = Number(value);
    
    // Ensure qty fields only accept positive numbers
    if ((name.includes("Qty") || name === "originalIndentQty" || name === "currentStock") && numValue < 0) {
      numValue = 0;
    }
    
    setNewEntry(prev => ({
      ...prev,
      [name]: name.includes("Qty") || name === "originalIndentQty" || name === "currentStock"
        ? numValue
        : value,
    }));
  };

  const handleAddEntry = () => {
    if (!newEntry.poNo || !newEntry.supplierName) {
      alert("PO No and Supplier Name are required.");
      return;
    }
    // Ensure purchaseQty follows status rule: when status is 'Open' => PO Qty = live stock, else (Closed) => PO Qty = 0
    const computedLive = getLiveStockForEntry(newEntry as any) || newEntry.purchaseQty || 0;
    const computedPurchaseQty = (newEntry.indentStatus === 'Open') ? computedLive : 0;
    const entryToSave = { ...newEntry, purchaseQty: computedPurchaseQty };
    const updatedEntries = [...entries, entryToSave];
    const savedEntries = saveEntries(updatedEntries);
    setEntries(savedEntries);
    
    setNewEntry({
      orderPlaceDate: "",
      poNo: "",
      supplierName: "",
      itemName: "",
      itemCode: "",
      indentNo: "",
      indentBy: "",
      oaNo: "",
      originalIndentQty: 0,
      purchaseQty: 0,
      currentStock: 0,
      indentStatus: "Open",
      receivedQty: 0,
      okQty: 0,
      rejectedQty: 0,
      grnNo: "",
      debitNoteOrQtyReturned: "",
      remarks: "",
    });
  };

  const handleEditAll = (index: number) => {
    setEditIndex(index);
    setEditEntry({ ...entries[index] });
  };

  const handleEditChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    if (!editEntry) return;
    
    let numValue = Number(value);
    
    // Ensure qty fields only accept positive numbers
    if ((name.includes("Qty") || name === "originalIndentQty" || name === "currentStock") && numValue < 0) {
      numValue = 0;
    }
    
    setEditEntry(prev => ({
      ...prev!,
      [name]: name.includes("Qty") || name === "originalIndentQty" || name === "currentStock"
        ? numValue
        : value,
    }));
  };

  const handleSaveEdit = () => {
    if (editIndex === null || !editEntry) return;
    
    const updated = [...entries];
    // Ensure purchaseQty follows status rule when saving edits
    const computedLiveEdit = getLiveStockForEntry(editEntry as any) || editEntry.purchaseQty || 0;
    const computedPurchaseQtyEdit = (editEntry.indentStatus === 'Open') ? computedLiveEdit : 0;
    updated[editIndex] = { ...editEntry, purchaseQty: computedPurchaseQtyEdit };
    const savedEntries = saveEntries(updated);
    setEntries(savedEntries);
    
    setEditIndex(null);
    setEditEntry(null);
  };

  const handleDelete = (index: number) => {
    const updated = entries.filter((_, i) => i !== index);
    setEntries(updated);
    saveEntries(updated);
  };

  const cancelEdit = () => {
    setEditIndex(null);
    setEditEntry(null);
  };

  return (
    <div>
      <h2>Purchase Module</h2>
      
      {/* Control Panel */}
      <div style={{ 
        marginBottom: 16, 
        padding: 12, 
        background: '#e8f5e8', 
        border: '1px solid #4caf50',
        borderRadius: '4px'
      }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <strong>Entries: {entries.length}</strong> | 
            <strong> Last Import: {lastImport ? new Date(lastImport).toLocaleTimeString() : 'Never'}</strong>
          </div>
          <button 
            onClick={manuallyImportAndOverwrite}
            style={{
              padding: '6px 12px',
              background: '#2196f3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Import All Indents
          </button>
          <button 
            onClick={refreshData}
            style={{
              padding: '6px 12px',
              background: '#4caf50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Refresh Data
          </button>
          <button 
            onClick={forceStockRefresh}
            style={{
              padding: '6px 12px',
              background: '#9c27b0',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Force Stock Refresh
          </button>
          <button 
            onClick={debugStatusSync}
            style={{
              padding: '6px 12px',
              background: '#ff9800',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Debug Status Sync
          </button>
          <button
            onClick={() => setDebugOpen(prev => !prev)}
            style={{
              padding: '6px 12px',
              background: debugOpen ? '#6a1b9a' : '#673ab7',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {debugOpen ? 'Hide Debug Panel' : 'Show Debug Panel'}
          </button>
        </div>
        <div style={{ marginTop: '8px', fontSize: '14px', color: '#2e7d32' }}>
          <strong>🎯 Stock Column:</strong> Shows LIVE data from Indent Module • Updates automatically • Matches indent stock exactly
        </div>
        {debugOpen && (
          <div style={{ marginTop: 12, padding: 12, background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={generateDebugReport} style={{ padding: '6px 10px', cursor: 'pointer' }}>Generate Report</button>
              <button onClick={persistIndentStockToPurchaseData} style={{ padding: '6px 10px', cursor: 'pointer' }}>Persist Stock</button>
              <button onClick={seedSampleIndents} style={{ padding: '6px 10px', cursor: 'pointer' }}>Seed Sample</button>
              <button onClick={clearDebugOutput} style={{ padding: '6px 10px', cursor: 'pointer' }}>Clear Output</button>
            </div>
            <div style={{ marginTop: 8 }}>
              <strong>Last run:</strong> {lastDebugRun ? new Date(lastDebugRun).toLocaleString() : 'Never'}
            </div>
            <pre style={{ marginTop: 8, maxHeight: 300, overflow: 'auto', background: '#ffffff', padding: 8, border: '1px solid #ddd' }}>{debugOutput || 'No debug output yet. Click Generate Report.'}</pre>
          </div>
        )}
      </div>

      {/* Add New Entry Section */}
      <div
        style={{
          background: "#f9f9f9",
          padding: 12,
          border: "1px solid #ccc",
          marginBottom: 16,
        }}
      >
        <h3>Add New Entry</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            name="orderPlaceDate"
            value={newEntry.orderPlaceDate}
            onChange={handleNewChange}
            placeholder="Order Date"
          />
          <input
            name="poNo"
            placeholder="PO No *"
            value={newEntry.poNo}
            onChange={handleNewChange}
            style={{ 
              border: !newEntry.poNo ? '2px solid red' : '1px solid #ccc',
              padding: '6px'
            }}
          />
          <input
            name="supplierName"
            placeholder="Supplier Name *"
            value={newEntry.supplierName}
            onChange={handleNewChange}
            style={{ 
              border: !newEntry.supplierName ? '2px solid red' : '1px solid #ccc',
              padding: '6px'
            }}
          />
          <select
            name="itemName"
            value={newEntry.itemName}
            onChange={handleNewChange}
            style={{ padding: '6px' }}
          >
            <option value="">Select Item</option>
            {itemNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <input
            name="itemCode"
            placeholder="Item Code"
            value={newEntry.itemCode}
            onChange={handleNewChange}
            style={{ padding: '6px' }}
          />
          <input
            name="indentNo"
            placeholder="Indent No"
            value={newEntry.indentNo}
            onChange={handleNewChange}
            style={{ padding: '6px' }}
          />
          <input
            type="number"
            name="originalIndentQty"
            placeholder="Original Qty"
            value={newEntry.originalIndentQty || ""}
            onChange={handleNewChange}
            style={{ padding: '6px', width: '100px' }}
          />
          <input
            type="number"
            name="purchaseQty"
            placeholder="PO Qty"
            value={newEntry.purchaseQty || ""}
            onChange={handleNewChange}
            style={{ padding: '6px', width: '100px' }}
          />
          <input
            type="number"
            name="currentStock"
            placeholder="Stock"
            value={newEntry.currentStock || ""}
            onChange={handleNewChange}
            style={{ padding: '6px', width: '100px' }}
          />
          <button 
            onClick={handleAddEntry} 
            style={{ 
              background: '#4caf50', 
              color: 'white', 
              border: 'none',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Add Entry
          </button>
        </div>
      </div>

      {/* Entries Table */}
      <h3>Purchase Orders ({entries.length})</h3>
      {entries.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', background: '#f5f5f5' }}>
          No purchase orders found. Click "Import All Indents" to import from open and closed indent items.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table border={1} cellPadding={8} style={{ width: "100%", minWidth: '1500px' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                <th>#</th>
                <th>Item</th>
                <th>Code</th>
                <th>Indent No</th>
                <th>OA NO</th>
                <th>Order Date</th>
                <th>PO No</th>
                <th>Supplier</th>
                <th>Orig. Qty</th>
                  <th>PO Qty</th>
                <th style={{ background: '#e3f2fd' }}>🎯 Stock</th>
                <th>Status</th>
                <th>Received</th>
                <th>OK</th>
                <th>Rejected</th>
                <th>GRN No</th>
                <th>Remarks</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const liveInfo = getLiveStockInfo(e);
                const liveStock = liveInfo.display;
                const isShort = liveInfo.isShort;
                const stockMatches = liveStock === e.currentStock;
                
                return (
                  <tr key={i} style={{ background: i === editIndex ? '#fff3cd' : 'white' }}>
                    <td style={{ fontWeight: 'bold' }}>{i + 1}</td>
                    <td>{e.itemName || 'N/A'}</td>
                    <td>{e.itemCode || 'N/A'}</td>
                    <td>{e.indentNo || 'N/A'}</td>
                    <td>{e.oaNo || 'N/A'}</td>
                    <td style={{ 
                      background: e.orderPlaceDate ? '#e8f5e8' : '#fff3cd',
                      fontWeight: 'bold',
                      color: e.orderPlaceDate ? '#2e7d32' : '#856404'
                    }}>
                      {e.orderPlaceDate || 'Not set'}
                    </td>
                    <td style={{ 
                      background: e.poNo ? '#e8f5e8' : '#fff3cd',
                      fontWeight: 'bold',
                      color: e.poNo ? '#2e7d32' : '#856404'
                    }}>
                      {e.poNo || 'Not set'}
                    </td>
                    <td style={{ 
                      background: e.supplierName ? '#e8f5e8' : '#fff3cd',
                      fontWeight: 'bold',
                      color: e.supplierName ? '#2e7d32' : '#856404'
                    }}>
                      {e.supplierName || 'Not set'}
                    </td>
                    <td>{e.originalIndentQty}</td>
                    <td>{e.indentStatus === 'Open' ? Math.abs(liveStock) : 0}</td>
                    <td>
                      {(() => {
                        const displayValNum = liveStock;
                        const isNegative = typeof displayValNum === 'number' && displayValNum < 0;
                        const isZeroOrMissing = displayValNum === null || displayValNum === undefined || displayValNum === 0;
                        const displayText = (displayValNum === null || displayValNum === undefined || displayValNum === 0) ? '-' : displayValNum;
                        const badgeStyle: React.CSSProperties = {
                          background: (isShort || isNegative || isZeroOrMissing) ? '#e53935' : '#43a047',
                          color: '#fff',
                          fontWeight: 700,
                          padding: '6px 10px',
                          borderRadius: 6,
                          display: 'inline-block',
                          minWidth: 44,
                          textAlign: 'center'
                        };
                        return (
                          <div>
                            <span style={badgeStyle}>{displayText}</span>
                            {!stockMatches && (
                              <div style={{ fontSize: 10, color: '#ff9800', marginTop: 4 }}>⚡ Live</div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ 
                      background: e.indentStatus === 'Closed' ? '#e8f5e8' : 
                                e.indentStatus === 'Open' ? '#fff3cd' : '#fff3e0',
                      fontWeight: 'bold',
                      color: e.indentStatus === 'Closed' ? '#2e7d32' : 
                            e.indentStatus === 'Open' ? '#856404' : '#ff9800'
                    }}>
                      {e.indentStatus}
                    </td>
                    <td>{e.receivedQty}</td>
                    <td>{e.okQty}</td>
                    <td>{e.rejectedQty}</td>
                    <td>{e.grnNo || 'N/A'}</td>
                    <td style={{ fontSize: '12px' }}>{e.remarks}</td>
                    <td>
                      <button 
                        onClick={() => handleEditAll(i)}
                        style={{ 
                          marginRight: '4px',
                          background: '#2196f3',
                          color: 'white',
                          border: 'none',
                          padding: '4px 8px',
                          borderRadius: '3px',
                          cursor: 'pointer'
                        }}
                      >
                        Edit
                      </button>
                      <button 
                        onClick={() => handleDelete(i)}
                        style={{
                          background: '#f44336',
                          color: 'white',
                          border: 'none',
                          padding: '4px 8px',
                          borderRadius: '3px',
                          cursor: 'pointer'
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
        </div>
      )}

      {/* Edit Section */}
      {editEntry && (
        <div
          style={{
            marginTop: 24,
            padding: 16,
            border: "2px solid #2196f3",
            background: "#f8fdff",
            borderRadius: '4px'
          }}
        >
          <h4>Edit Entry #{editIndex !== null ? editIndex + 1 : ''} - {editEntry.itemName}</h4>
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", 
            gap: 12,
            marginBottom: 16
          }}>
            <div>
              <label><strong>Order Place Date *</strong></label>
              <input
                type="date"
                name="orderPlaceDate"
                value={editEntry.orderPlaceDate}
                onChange={handleEditChange}
                style={{ width: '100%', padding: '8px', marginTop: '4px' }}
              />
            </div>
            <div>
              <label><strong>PO No *</strong></label>
              <input
                name="poNo"
                value={editEntry.poNo}
                onChange={handleEditChange}
                style={{ 
                  width: '100%', 
                  padding: '8px',
                  marginTop: '4px',
                  border: !editEntry.poNo ? '2px solid red' : '1px solid #ccc'
                }}
              />
            </div>
            <div>
              <label><strong>Supplier Name *</strong></label>
              <input
                name="supplierName"
                value={editEntry.supplierName}
                onChange={handleEditChange}
                style={{ 
                  width: '100%', 
                  padding: '8px',
                  marginTop: '4px',
                  border: !editEntry.supplierName ? '2px solid red' : '1px solid #ccc'
                }}
              />
            </div>
            <div>
              <label><strong>Item Name</strong></label>
              <select
                name="itemName"
                value={editEntry.itemName}
                onChange={handleEditChange}
                style={{ width: '100%', padding: '8px', marginTop: '4px' }}
              >
                <option value="">Select Item</option>
                {itemNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <label><strong>Original Indent Qty</strong></label>
              <input
                type="number"
                name="originalIndentQty"
                value={editEntry.originalIndentQty || ""}
                onChange={handleEditChange}
                style={{ width: '100%', padding: '8px', marginTop: '4px' }}
              />
            </div>
            <div>
              <label><strong>PO Qty</strong></label>
              <input
                type="number"
                name="purchaseQty"
                value={editEntry.purchaseQty || ""}
                onChange={handleEditChange}
                style={{ width: '100%', padding: '8px', marginTop: '4px' }}
              />
            </div>
            <div>
              <label><strong>Stock</strong></label>
              <input
                type="number"
                name="currentStock"
                value={editEntry.currentStock || ""}
                onChange={handleEditChange}
                style={{ width: '100%', padding: '8px', marginTop: '4px' }}
              />
            </div>
            <div>
              <label><strong>Indent Status</strong></label>
              <select
                name="indentStatus"
                value={editEntry.indentStatus}
                onChange={handleEditChange}
                style={{ width: '100%', padding: '8px', marginTop: '4px' }}
              >
                <option value="">Select Status</option>
                {indentStatusOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <button 
              onClick={handleSaveEdit}
              disabled={!editEntry.poNo || !editEntry.supplierName}
              style={{
                background: (!editEntry.poNo || !editEntry.supplierName) ? '#ccc' : '#4caf50',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                cursor: (!editEntry.poNo || !editEntry.supplierName) ? 'not-allowed' : 'pointer',
                marginRight: '8px'
              }}
            >
              Save Changes
            </button>
            <button 
              onClick={cancelEdit}
              style={{
                background: '#9e9e9e',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
          {(!editEntry.poNo || !editEntry.supplierName) && (
            <div style={{ color: 'red', marginTop: '8px' }}>
              * PO No and Supplier Name are required
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PurchaseModule;