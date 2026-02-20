// Quick simulation to verify getLiveStock logic

const normalizeField = (v) => {
  if (v === undefined || v === null) return '';
  return String(v).trim().toUpperCase();
};

const getIndentQtyFromIndent = (item) => {
  const possibleQtyFields = ['qty','indentQty','quantity','Quantity','requestedQty','requiredQty','Qty','qty1'];
  for (const f of possibleQtyFields) {
    if (item[f] !== undefined && item[f] !== null && item[f] !== '') {
      const n = Number(item[f]);
      if (!isNaN(n)) return n;
    }
  }
  return 0;
};

function computeDisplay(indentItem, indentData, stockRecords) {
  const normCode = normalizeField(indentItem.itemCode || indentItem.Code || '');
  // try to find in indentData exact match - simulate failure
  let cumulativeQty = 0;
  // Simulate no matching entries in indentData so cumulativeQty stays 0

  // fallback to indent item qty
  if (cumulativeQty === 0) {
    const indentQtyFallback = getIndentQtyFromIndent(indentItem) || Number(indentItem.qty) || Number(indentItem.qty1) || 0;
    if (indentQtyFallback > 0) {
      console.log('fallback qty', indentQtyFallback);
      cumulativeQty = indentQtyFallback;
    }
  }

  const stockRec = (stockRecords || []).find(s => normalizeField(s.itemCode) === normCode);
  const closingStock = stockRec && !isNaN(Number(stockRec.closingStock)) ? Number(stockRec.closingStock) : 0;

  let display;
  if (cumulativeQty > 0) {
    if (cumulativeQty > closingStock) display = cumulativeQty - closingStock;
    else display = cumulativeQty;
  } else {
    display = closingStock;
  }

  return { display, cumulativeQty, closingStock };
}

const indentItem = { indentNo: 'S-8/25-04', itemName: 'WH 165 Body', itemCode: 'CB-102', qty: 50, availableForThisIndent: 50 };
const indentData = []; // missing
const stockRecords = [{ itemCode: 'CB-102', closingStock: 95 }];

const result = computeDisplay(indentItem, indentData, stockRecords);
console.log('Result:', result);
