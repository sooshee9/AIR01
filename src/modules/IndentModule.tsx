import React, { useState, useEffect } from 'react';
import bus from '../utils/eventBus';
import * as XLSX from 'xlsx';
import { subscribeFirestoreDocs, replaceFirestoreCollection } from '../utils/firestoreSync';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

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

  // Migrate existing localStorage `indentData` into Firestore on sign-in
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      if (uid) {
        (async () => {
          try {
            const raw = localStorage.getItem('indentData');
            if (raw) {
              const arr = JSON.parse(raw || '[]');
              if (Array.isArray(arr) && arr.length > 0) {
                for (const it of arr) {
                  try {
                    const payload = { ...it } as any;
                    if (typeof payload.id !== 'undefined') delete payload.id;
                    const col = collection(db, 'userData', uid, 'indentData');
                    await addDoc(col, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                  } catch (err) {
                    console.warn('[IndentModule] migration addDoc failed for item', it, err);
                  }
                }
                try { localStorage.removeItem('indentData'); } catch {}
              }
            }
          } catch (err) {
            console.error('[IndentModule] Migration failed:', err);
          }
        })();
      }
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  // Migrate existing localStorage `indentData` into Firestore on sign-in
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const uid = u ? u.uid : null;
      if (uid) {
        (async () => {
          try {
            const raw = localStorage.getItem('indentData');
            if (raw) {
              const arr = JSON.parse(raw || '[]');
              if (Array.isArray(arr) && arr.length > 0) {
                for (const it of arr) {
                  try {
                    const payload = { ...it } as any;
                    if (typeof payload.id !== 'undefined') delete payload.id;
                    const col = collection(db, 'userData', uid, 'indentData');
                    await addDoc(col, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                  } catch (err) {
                    console.warn('[IndentModule] migration addDoc failed for item', it, err);
                  }
                }
                try { localStorage.removeItem('indentData'); } catch {}
              }
            }
          } catch (err) {
            console.error('[IndentModule] Migration failed:', err);
          }
        })();
      }
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  const [itemMaster, setItemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
  const [stockRecords, setStockRecords] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);

  // Subscribe to Firestore collections on mount
  useEffect(() => {
    const unsubIndents = subscribeFirestoreDocs(uid, 'indentData', (docs) => {
      const formattedIndents = docs.map(doc => ({
        indentNo: doc.indentNo,
        date: doc.date,
        indentBy: doc.indentBy,
        oaNo: doc.oaNo,
        items: Array.isArray(doc.items) ? doc.items : [],
      }));
      setIndents(formattedIndents);
    });

    const unsubItemMaster = subscribeFirestoreDocs(uid, 'itemMasterData', (docs) => {
      const formattedItems = docs.map(doc => ({
        itemName: doc.itemName,
        itemCode: doc.itemCode,
      }));
      setItemMaster(formattedItems);
    });

    const unsubStock = subscribeFirestoreDocs(uid, 'stock-records', (docs) => {
      setStockRecords(docs);
    });

    const unsubPO = subscribeFirestoreDocs(uid, 'purchaseOrders', (docs) => {
      setPurchaseOrders(docs);
    });

    return () => {
      unsubIndents();
      unsubItemMaster();
      unsubStock();
      unsubPO();
    };
  }, [uid]);

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


  // Helper to get stock for an item
  const getStock = (itemCode: string) => {
    const stock = stockRecords.find((s: any) => s.itemCode === itemCode);
    const closingStock = stock && !isNaN(Number(stock.closingStock)) ? Number(stock.closingStock) : 0;
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
    const totalStock = getStock(itemCode);
    let totalAllocatedQty = 0;
    
    indents.forEach((indent, indentIndex) => {
      indent.items.forEach(item => {
        if (item.itemCode === itemCode) {
          const allocated = getAllocatedAvailableForIndent(itemCode, indentIndex, item.qty);
          totalAllocatedQty += allocated;
        }
      });
    });
    
    return totalStock - totalAllocatedQty;
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
    const availableForThisIndent = availableBefore - (Number(itemQty) || 0);
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
        {_itemNames.length > 0 ? (
          <select 
            name="itemName" 
            value={itemInput.model} 
            onChange={handleChange}
            style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          >
            <option value="">Select Item Name</option>
            {_itemNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        ) : (
          <input 
            type="text" 
            name="itemName" 
            value={itemInput.model} 
            onChange={handleChange}
            style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          />
        )}
        <input
          placeholder="Item Code"
          value={itemInput.itemCode}
          onChange={e => setItemInput({ ...itemInput, itemCode: e.target.value })}
          style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
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
              <th>Qty</th>
              <th>Remaining Stock</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {newIndent.items.map((item, idx) => {
              const remainingStock = getRemainingStock(item.itemCode);
              return (
                <tr key={idx}>
                  <td>{item.model}</td>
                  <td>{item.itemCode}</td>
                  <td>{item.qty}</td>
                  <td style={{ 
                    color: remainingStock >= 0 ? '#43a047' : '#e53935',
                    fontWeight: 600 
                  }}>
                    {remainingStock}
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
                        background: analysis.availableForThisIndent >= 0 ? '#43a047' : '#e53935',
                        color: '#fff',
                        fontWeight: 700,
                        padding: '6px 10px',
                        borderRadius: 6,
                        display: 'inline-block',
                        minWidth: 44,
                        textAlign: 'center'
                      }}>
                        {analysis.availableForThisIndent}
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
        </div>
      </div>
    </div>
  );
};

export default IndentModule;