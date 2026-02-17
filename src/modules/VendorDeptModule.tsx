import React, { useState, useEffect } from 'react';
import bus from '../utils/eventBus';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { getPurchaseOrders, getPurchaseData } from '../utils/firestoreServices';
import { subscribeVSIRRecords } from '../utils/firestoreServices';
import { subscribePsirs } from '../utils/psirService';

interface VendorDeptItem {
	itemName: string;
	itemCode: string;
	materialIssueNo: string;
	qty: number;
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
	orderPlaceDate: string;
	materialPurchasePoNo: string;
	oaNo: string;
	batchNo: string;
	vendorBatchNo: string;
	dcNo: string;
	vendorName: string;
	items: VendorDeptItem[];
}

const indentStatusOptions = ['Open', 'Closed', 'Partial'];

// Helper: robust numeric extractor: trims and parses numeric fields across various possible keys
const getNumericField = (obj: any, keys: string[]): number | null => {
	for (const k of keys) {
		if (obj && obj[k] !== undefined && obj[k] !== null) {
			const raw = String(obj[k]).trim();
			if (raw !== '') {
				const n = Number(raw);
				if (!isNaN(n)) return n;
			}
		}
	}
	return null;
};

// Helper: find which numeric field/key exists (returns key, raw string and parsed value)
const findNumericField = (obj: any, keys: string[]): { key: string; raw: string; value: number } | null => {
	for (const k of keys) {
		if (obj && obj[k] !== undefined && obj[k] !== null) {
			const raw = String(obj[k]).trim();
			if (raw !== '') {
				const n = Number(raw);
				if (!isNaN(n)) return { key: k, raw, value: n };
			}
		}
	}
	return null;
};

// Helper: choose best stock record when multiple candidates match.
// Strategy: prefer explicit closingStock (or its numeric equivalent), otherwise use computed stockQty + purchaseActualQtyInStore.
// Tie-breaker: higher computed value, then larger id (assumed later entries have larger ids).
const chooseBestStock = (candidates: any[]) => {
	if (!Array.isArray(candidates) || candidates.length === 0) return null;
	const closingKeys = ['closingStock','closing_stock','ClosingStock','closing','closingQty','closing_qty','Closing','closing stock','Closing Stock','closingstock','closingStockQty','closing_stock_qty','ClosingStockQty','closingstockqty'];
	const stockQtyKeys = ['stockQty','stock_qty','stock','StockQty','currentStock'];
	const purchaseKeys = ['purchaseActualQtyInStore','purchase_actual_qty_in_store','purchaseActualQty','purchase_actual_qty','purchaseActualQtyInStore'];
	let best: any = null;
	let bestVal = Number.NEGATIVE_INFINITY;
	for (const s of candidates) {
		const c = findNumericField(s, closingKeys);
		const closing = c ? c.value : null;
		const stockQty = getNumericField(s, stockQtyKeys) || 0;
		const pQty = getNumericField(s, purchaseKeys) || 0;
		const computed = (closing !== null ? closing : (stockQty + pQty)) || 0;
		if (best === null || computed > bestVal) { best = s; bestVal = computed; }
		else if (computed === bestVal) {
			if ((s.id || 0) > ((best.id || 0))) best = s;
		}
	}
	return best;
};

// Helper: get PO qty (purchaseQty / qty / originalIndentQty) from purchaseOrders or purchaseData
const getPurchaseQty = (poNo: string | undefined, itemCode: string | undefined, purchaseOrders?: any[], purchaseData?: any[]): number => {
	try {
		if (!poNo || !itemCode) return 0;
		const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
		const tPo = norm(poNo);
		const tCode = norm(itemCode);

		if (purchaseOrders && Array.isArray(purchaseOrders)) {
			const pos = purchaseOrders;
			if (Array.isArray(pos)) {
				const po = pos.find((p: any) => norm(p.poNo) === tPo);
				if (po) {
					if (Array.isArray(po.items)) {
						const match = po.items.find((it: any) => norm(it.itemCode || it.Code) === tCode);
						if (match) {
							// Prefer explicit PO quantity fields when available (poQty / originalIndentQty / qty)
							const poPreferred = Number(match.poQty ?? match.originalIndentQty ?? match.qty ?? 0);
							if (poPreferred > 0) return poPreferred;

							// If no explicit poQty on purchaseOrders entry, check purchaseData for a better po quantity
							const purchaseDataRaw = localStorage.getItem('purchaseData');
							if (purchaseDataRaw) {
								try {
									const pds = JSON.parse(purchaseDataRaw);
									if (Array.isArray(pds)) {
										const pdMatch = pds.find((it: any) => (norm(it.poNo) === tPo || norm(it.indentNo) === tPo) && norm(it.itemCode || it.Code) === tCode);
										if (pdMatch) {
											const pdPreferred = Number(pdMatch.poQty ?? pdMatch.originalIndentQty ?? pdMatch.qty ?? 0);
											if (pdPreferred > 0) return pdPreferred;
										}
									}
								} catch {}
							}

							const rawVal = Number(match.purchaseQty ?? 0);
							if (rawVal > 0) return rawVal;
							return poPreferred || rawVal;
						}
					} else {
						if (norm(po.itemCode || po.Code) === tCode) return Number(po.purchaseQty ?? po.qty ?? po.originalIndentQty ?? 0);
					}
				}
			}
		}

		if (purchaseData && Array.isArray(purchaseData)) {
			const pd = purchaseData;
			if (Array.isArray(pd)) {
				const match = pd.find((it: any) => (norm(it.poNo) === tPo || norm(it.indentNo) === tPo) && norm(it.itemCode || it.Code) === tCode);
				if (match) {
					// Prefer explicit poQty/originalIndentQty/qty on purchaseData match too
					const poPreferred = Number(match.poQty ?? match.originalIndentQty ?? match.qty ?? 0);
					if (poPreferred > 0) return poPreferred;
					const rawVal = Number(match.purchaseQty ?? 0);
					if (rawVal > 0) return rawVal;
					return poPreferred || rawVal;
				}
			}
		}
	} catch (err) {
		console.error('[VendorDeptModule] getPurchaseQty error', err);
	}
	return 0;
};

// Prefer Purchase module's status when available (search purchaseData / purchaseOrders)
const getIndentStatusFromPurchase = (poNo: any, itemCode: any, indentNo: any, purchaseData?: any[], purchaseOrders?: any[]): string => {
	try {
		const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
		const tPo = norm(poNo);
		const tCode = norm(itemCode);
		const tIndent = norm(indentNo);

		// Check purchaseData first
		if (purchaseData && Array.isArray(purchaseData)) {
			const pd = purchaseData;
			if (Array.isArray(pd)) {
				const found = pd.find((it: any) => (
					((norm(it.poNo) === tPo) || (norm(it.indentNo) === tIndent)) && (norm(it.itemCode || it.Code) === tCode)
				));
				if (found && found.indentStatus) return String(found.indentStatus);
			}
		}

		// Then check purchaseOrders (PO -> items)
		if (purchaseOrders && Array.isArray(purchaseOrders)) {
			const pos = purchaseOrders;
			if (Array.isArray(pos)) {
				const po = pos.find((p: any) => norm(p.poNo) === tPo || norm(p.poNo || p.indentNo) === tPo);
				if (po) {
					if (Array.isArray(po.items)) {
						const mit = po.items.find((it: any) => norm(it.itemCode || it.Code) === tCode);
						if (mit && mit.indentStatus) return String(mit.indentStatus);
					} else {
						if (po.itemCode && norm(po.itemCode) === tCode && po.indentStatus) return String(po.indentStatus);
					}
				}
			}
		}

		return '';
	} catch (err) {
		return '';
	}
};

// Helper: Get supplier name from Purchase module by PO No
const getSupplierNameFromPO = (poNo: any, purchaseOrders?: any[], purchaseData?: any[]): string => {
	try {
		if (!poNo) return '';
		const poNoNormalized = String(poNo).trim().toUpperCase();
		
		// Check Purchase Orders first
		if (purchaseOrders && Array.isArray(purchaseOrders)) {
			if (Array.isArray(purchaseOrders)) {
				const po = purchaseOrders.find((p: any) => String(p.poNo || '').trim().toUpperCase() === poNoNormalized);
				if (po && po.supplierName) {
					return String(po.supplierName).trim();
				}
			}
		}
		
		// Fall back to Purchase Data
		if (purchaseData && Array.isArray(purchaseData)) {
			if (Array.isArray(purchaseData)) {
				const entry = purchaseData.find((p: any) => String(p.poNo || '').trim().toUpperCase() === poNoNormalized);
				if (entry && entry.supplierName) {
					return String(entry.supplierName).trim();
				}
			}
		}
		
		return '';
	} catch (err) {
		console.error('[VendorDept] Error getting supplier name:', err);
		return '';
	}
};

// Helper: Get vendorBatchNo from VSIR module if available
const getVendorBatchNoFromVSIR = (poNo: any, vsirRecords?: any[]): string => {
	try {
		if (!poNo) {
			console.log('[VendorDept] getVendorBatchNoFromVSIR called with empty poNo');
			return '';
		}
		const poNoNormalized = String(poNo).trim();
		console.log('[VendorDept] Looking for vendorBatchNo for PO:', poNoNormalized);
		
		console.log('[VendorDept] VSIR data exists:', !!vsirRecords);
		if (!vsirRecords) {
			console.log('[VendorDept] No VSIR data found');
			return '';
		}
		// vsirRecords is already an array
		if (!Array.isArray(vsirRecords)) {
			console.log('[VendorDept] VSIR data is not an array');
			// Try to handle as array anyway
		}
		
		console.log('[VendorDept] VSIR records count:', vsirRecords.length);
		if (vsirRecords.length > 0) {
			console.log('[VendorDept] First VSIR record structure:', JSON.stringify(vsirRecords[0]));
			console.log('[VendorDept] All VSIR POs:', vsirRecords.map((r: any) => r.poNo).join(', '));
			console.log('[VendorDept] Looking for PO match with:', poNoNormalized);
		}
		
		// Find first VSIR record matching this PO with a vendorBatchNo (normalized comparison)
		const match = vsirRecords.find((r: any) => {
			const rPoNo = String(r.poNo || '').trim();
			const hasVendorBatchNo = r.vendorBatchNo && String(r.vendorBatchNo).trim();
			return rPoNo === poNoNormalized && hasVendorBatchNo;
		});
		
		if (match) {
			console.log('[VendorDept] ✓ Match found! vendorBatchNo:', match.vendorBatchNo);
			return match.vendorBatchNo;
		} else {
			console.log('[VendorDept] ✗ No matching VSIR record found for PO:', poNoNormalized);
		}
		return '';
	} catch (err) {
		console.log('[VendorDept] Error getting vendorBatchNo from VSIR:', err);
		return '';
	}
};

// Helper: Get PSIR data for a given PO
const getPSIRDataByPO = (poNo: string | undefined, psirData?: any[]): any => {
	try {
		if (!poNo) return null;
		if (!psirData) return null;
		if (!Array.isArray(psirData)) return null;
		const match = psirData.find((r: any) => String(r.poNo || '').trim() === String(poNo).trim());
		return match || null;
	} catch (err) {
		console.error('[VendorDept] Error getting PSIR data:', err);
		return null;
	}
};

	// Import Purchase Orders to Vendor Dept
	const importPurchaseOrdersToVendorDept = () => {
		try {
			console.info('[VendorDeptModule] 🔵 MANUAL IMPORT TRIGGERED - User clicked Import button');
			console.debug('[VendorDeptModule] purchaseOrders:', purchaseOrders);
			console.debug('[VendorDeptModule] purchaseData:', purchaseData);
			console.debug('[VendorDeptModule] entries:', entries);
			console.debug('[VendorDeptModule] userUid:', userUid);
			
			// Use purchaseOrders if available, fallback to purchaseData
			const ordersToImport = purchaseOrders.length > 0 ? purchaseOrders : purchaseData;
			
			if (ordersToImport.length === 0) {
				console.warn('[VendorDeptModule] No purchase orders or purchase data to import');
				alert('No purchase orders or purchase data found');
				return;
			}
			
			console.info('[VendorDeptModule] Using', purchaseOrders.length > 0 ? 'purchaseOrders' : 'purchaseData', '(' + ordersToImport.length + ' records)');
			
			let importedCount = 0;
			const newEntries: VendorDeptOrder[] = [];
			
			ordersToImport.forEach((order: any, idx: number) => {
				try {
					const poNo = String(order.materialPurchasePoNo || order.poNo || '').trim();
					const vendorName = String(order.vendorName || order.supplierName || '').trim();
					
					if (!poNo) {
						console.debug(`[VendorDeptModule] Skipping order ${idx} - no PO number`);
						return;
					}
					
					// Check if already imported
					const exists = entries.find((e: VendorDeptOrder) => String(e.materialPurchasePoNo || '').trim() === poNo);
					if (exists) {
						console.debug(`[VendorDeptModule] Skipping - already imported: ${poNo}`);
						return;
					}
					
					// Extract items
					let items: VendorDeptItem[] = [];
					if (Array.isArray(order.items) && order.items.length > 0) {
						items = order.items.map((it: any) => ({
							itemName: it.itemName || it.Item || '',
							itemCode: it.itemCode || it.Code || '',
							materialIssueNo: '',
							qty: Number(it.purchaseQty || it.poQty || it.originalIndentQty || 0) || 0,
							indentStatus: 'Open',
							receivedQty: 0,
							okQty: 0,
							reworkQty: 0,
							rejectedQty: 0,
							grnNo: '',
							debitNoteOrQtyReturned: '',
							remarks: ''
						}));
					} else {
						// Fallback: create single item from order
						items = [{
							itemName: order.itemName || order.Item || '',
							itemCode: order.itemCode || order.Code || '',
							materialIssueNo: '',
							qty: 1,
							indentStatus: 'Open',
							receivedQty: 0,
							okQty: 0,
							reworkQty: 0,
							rejectedQty: 0,
							grnNo: '',
							debitNoteOrQtyReturned: '',
							remarks: ''
						}];
					}
					
					const newEntry: VendorDeptOrder = {
						orderPlaceDate: new Date().toISOString().slice(0, 10),
						materialPurchasePoNo: poNo,
						oaNo: order.oaNo || '',
						batchNo: order.batchNo || '',
						vendorBatchNo: order.vendorBatchNo || '',
						dcNo: '',
						vendorName: vendorName,
						items: items
					};
					
					newEntries.push(newEntry);
					importedCount++;
					console.debug(`[VendorDeptModule] Imported: ${poNo} - ${vendorName}`);
				} catch (err) {
					console.error(`[VendorDeptModule] Error processing order ${idx}:`, err);
				}
			});
			
			if (importedCount > 0) {
				setEntries(prev => [...prev, ...newEntries]);
				console.info(`[VendorDeptModule] ✅ Successfully imported ${importedCount} purchase orders`);
				alert(`✅ Successfully imported ${importedCount} purchase orders to Vendor Dept`);
				bus.dispatchEvent(new CustomEvent('vendorDeptModule.updated', { detail: { entries: [...entries, ...newEntries] } }));
			} else {
				console.warn('[VendorDeptModule] No new purchase orders were imported');
				alert('No new purchase orders to import (all already exist)');
			}
		} catch (error) {
			console.error('[VendorDeptModule] Error importing purchase orders:', error);
			alert('Error importing purchase orders: ' + String(error));
		}
	};

const VendorDeptModule: React.FC = () => {

	// Declare newOrder state before any useEffect that uses it
	const [newOrder, setNewOrder] = useState<VendorDeptOrder>({
		orderPlaceDate: '',
		materialPurchasePoNo: '',
		oaNo: '',
		batchNo: '',
		vendorBatchNo: '',
		dcNo: '', // Always default to empty string
		vendorName: '',
		items: [],
	});

	// Current authenticated user's UID (if logged in)
	const [userUid, setUserUid] = useState<string | null>(null);

	// Accept Firestore state variables as props
	const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
	const [purchaseData, setPurchaseData] = useState<any[]>([]);
	const [vsirRecords, setVsirRecords] = useState<any[]>([]);
	const [psirData, setPsirData] = useState<any[]>([]);

	// Listen to authentication state
	useEffect(() => {
		const unsub = onAuthStateChanged(auth, (u) => {
			const uid = u ? u.uid : null;
			console.info('[VendorDeptModule] Auth state changed - userUid:', uid);
			setUserUid(uid);
		});
		return () => unsub();
	}, []);

	// Load purchase orders, purchase data, VSIR, and PSIR from Firestore
	useEffect(() => {
		const loadData = async () => {
			try {
				if (!userUid) {
					console.debug('[VendorDeptModule] Skipping data load - userUid is not set');
					return;
				}
				console.info('[VendorDeptModule] Starting data load for user:', userUid);
				
				const [poData, purchaseDataData] = await Promise.all([
					getPurchaseOrders(userUid),
					getPurchaseData(userUid),
				]);
				
				if (Array.isArray(poData)) {
					setPurchaseOrders(poData);
					console.debug('[VendorDeptModule] Loaded', poData.length, 'purchase orders');
				}
				
				if (Array.isArray(purchaseDataData)) {
					setPurchaseData(purchaseDataData);
					console.debug('[VendorDeptModule] Loaded', purchaseDataData.length, 'purchase data records');
				}
			} catch (e) {
				console.error('[VendorDeptModule] Error loading purchase data:', e);
			}
		};

		loadData();
	}, [userUid]);

	// Subscribe to VSIR records from Firestore
	useEffect(() => {
		let unsub: (() => void) | null = null;
		if (!userUid) {
			console.debug('[VendorDeptModule] Skipping VSIR subscription - no userUid');
			return;
		}
		console.debug('[VendorDeptModule] Setting up VSIR subscription for userId:', userUid);
		unsub = subscribeVSIRRecords(userUid, (docs) => {
			console.debug('[VendorDeptModule] VSIR records updated:', docs.length, 'records');
			setVsirRecords(docs);
		});
		return () => {
			if (unsub) unsub();
		};
	}, [userUid]);

	// Subscribe to PSIR records from Firestore
	useEffect(() => {
		let unsub: (() => void) | null = null;
		if (!userUid) {
			console.debug('[VendorDeptModule] Skipping PSIR subscription - no userUid');
			return;
		}
		console.debug('[VendorDeptModule] Setting up PSIR subscription for userId:', userUid);
		unsub = subscribePsirs(userUid, (docs) => {
			console.debug('[VendorDeptModule] PSIR records updated:', docs.length, 'records');
			setPsirData(docs);
		});
		return () => {
			if (unsub) unsub();
		};
	}, [userUid]);

	// Get all PO numbers from PurchaseModule state
	const [purchasePOs, setPurchasePOs] = useState<string[]>([]);
	useEffect(() => {
		if (purchaseOrders && Array.isArray(purchaseOrders)) {
			const poList = purchaseOrders.map((order: any) => order.poNo).filter(Boolean);
			setPurchasePOs(poList);
			// Always auto-select latest if not set
			if (poList.length > 0 && !newOrder.materialPurchasePoNo) {
				setNewOrder(prev => ({ ...prev, materialPurchasePoNo: poList[poList.length - 1] }));
			}
		}
	}, [newOrder.materialPurchasePoNo, purchaseOrders]);


	const [orders, setOrders] = useState<VendorDeptOrder[]>([]);
	useEffect(() => {
		// Update orders when vsirRecords changes
		if (orders.length > 0) {
			const updated = orders.map((order: any) => {
				let vendorBatchNo = order.vendorBatchNo || '';
				if (!vendorBatchNo) {
					vendorBatchNo = getVendorBatchNoFromVSIR(order.materialPurchasePoNo, vsirRecords);
				}
				return {
					...order,
					vendorBatchNo,
					items: Array.isArray(order.items) ? order.items : [],
				};
			});
			setOrders(updated);
		}
	}, [vsirRecords]);

	// Sync vendorBatchNo from VSIR on component mount
	useEffect(() => {
		console.log('[VendorDept] Syncing vendorBatchNo from VSIR on mount for all existing orders');
		setOrders(prevOrders => {
			const syncedOrders = prevOrders.map(order => {
				if (!order.vendorBatchNo || !order.vendorBatchNo.trim()) {
					const vendorBatchNo = getVendorBatchNoFromVSIR(order.materialPurchasePoNo, vsirRecords);
					if (vendorBatchNo && vendorBatchNo !== order.vendorBatchNo) {
						console.log(`[VendorDept] ✓ Synced vendorBatchNo for PO ${order.materialPurchasePoNo}: ${vendorBatchNo}`);
						return { ...order, vendorBatchNo };
					}
				}
				return order;
			});
			
			return syncedOrders;
		});
	}, [vsirRecords]); // Run when VSIR records change

	// Clean up debitNoteOrQtyReturned field that may have been incorrectly set to GRN data
	useEffect(() => {
		console.log('[VendorDept] Cleaning up debitNoteOrQtyReturned field with GRN-like values');
		setOrders(prevOrders => {
			const cleanedOrders = prevOrders.map(order => {
				const cleanedItems = order.items.map(item => {
					// If debitNoteOrQtyReturned looks like a GRN number (only digits, longer than 3), clear it
					if (item.debitNoteOrQtyReturned && /^\d{4,}$/.test(String(item.debitNoteOrQtyReturned).trim())) {
						console.log(`[VendorDept] ✓ Cleared GRN-like value from debitNoteOrQtyReturned for item ${item.itemCode}: "${item.debitNoteOrQtyReturned}"`);
						return { ...item, debitNoteOrQtyReturned: '' };
					}
					return item;
				});
				
				if (cleanedItems !== order.items) {
					return { ...order, items: cleanedItems };
				}
				return order;
			});
			
			return cleanedOrders;
		});
	}, []); // Run once on mount

	const [itemInput, setItemInput] = useState<VendorDeptItem>({
		itemName: '',
		itemCode: '',
		materialIssueNo: '',
		qty: 0,
		closingStock: '',
		indentStatus: '',
		receivedQty: 0,
		okQty: 0,
		reworkQty: 0,
		rejectedQty: 0,
		grnNo: '',
		debitNoteOrQtyReturned: '',
		remarks: '',
	});

	// Auto-fill Received, OK, Rework, and Rejected quantities from VSIR
	useEffect(() => {
		if (!newOrder.materialPurchasePoNo || !itemInput.itemCode) return;
		
		try {
			if (!vsirRecords) {
				console.debug('[VendorDeptModule][AutoFill] No VSIR records found');
				return;
			}
			
			if (!Array.isArray(vsirRecords)) return;
			
			// Find matching VSIR record for this PO and item
			const matchingVSIR = vsirRecords.find((vsir: any) =>
				vsir.poNo === newOrder.materialPurchasePoNo &&
				vsir.itemCode === itemInput.itemCode
			);
			
			if (matchingVSIR) {
				const receivedQty = matchingVSIR.qtyReceived || 0;
				const okQty = matchingVSIR.okQty || 0;
				const reworkQty = matchingVSIR.reworkQty || 0;
				const rejectedQty = matchingVSIR.rejectQty || 0;
				const grnNo = matchingVSIR.grnNo || '';
				
				console.debug('[VendorDeptModule][AutoFill] Found VSIR data for PO:', newOrder.materialPurchasePoNo, 'Item:', itemInput.itemCode, {
					receivedQty,
					okQty,
					reworkQty,
					rejectedQty,
					grnNo
				});
				
				setItemInput(prev => ({
					...prev,
					receivedQty,
					okQty,
					reworkQty,
					rejectedQty,
					grnNo
				}));
			}
		} catch (e) {
			console.error('[VendorDeptModule][AutoFill] Error reading VSIR data:', e);
		}
	}, [newOrder.materialPurchasePoNo, itemInput.itemCode]);

	// Auto-populate items from PSIR when PO changes (only if items list is empty)
	useEffect(() => {
		if (!newOrder.materialPurchasePoNo || newOrder.items.length > 0) return;
		
		try {
			const psirRecord = getPSIRDataByPO(newOrder.materialPurchasePoNo, psirData);
			if (psirRecord && psirRecord.items && Array.isArray(psirRecord.items)) {
				console.log('[VendorDeptModule][AutoPopulate] Found', psirRecord.items.length, 'items in PSIR for PO:', newOrder.materialPurchasePoNo);
				
				// Auto-populate items from PSIR
				const psirItems = psirRecord.items.map((item: any) => ({
					itemName: item.itemName || '',
					itemCode: item.itemCode || '',
					materialIssueNo: '', // Will be filled by user
					qty: item.qtyReceived || item.poQty || 0,
					closingStock: getClosingStock(item.itemCode, item.itemName),
					indentStatus: '',
					receivedQty: 0,
					okQty: 0,
					reworkQty: 0,
					rejectedQty: 0,
					grnNo: item.grnNo || '',
					debitNoteOrQtyReturned: '',
					remarks: '',
				}));
				
				setNewOrder(prev => ({ ...prev, items: psirItems }));
				console.log('[VendorDeptModule][AutoPopulate] Populated items from PSIR');
			}
		} catch (e) {
			console.error('[VendorDeptModule][AutoPopulate] Error:', e);
		}
	}, [newOrder.materialPurchasePoNo]);

	// Sync quantities from VSIR to existing orders
	useEffect(() => {
		if (orders.length === 0) return;
		
		try {
			if (!vsirRecords) return;
			if (!Array.isArray(vsirRecords)) return;
			
			let updated = false;
			const updatedOrders = orders.map(order => {
				const updatedItems = order.items.map((item: any) => {
					// Find matching VSIR record
					const matchingVSIR = vsirRecords.find((vsir: any) =>
						vsir.poNo === order.materialPurchasePoNo &&
						vsir.itemCode === item.itemCode
					);
					
					if (matchingVSIR) {
						const newReceivedQty = matchingVSIR.qtyReceived || 0;
						const newOkQty = matchingVSIR.okQty || 0;
						const newReworkQty = matchingVSIR.reworkQty || 0;
						const newRejectedQty = matchingVSIR.rejectQty || 0;
						const newGrnNo = matchingVSIR.grnNo || '';
						
						// Only update if values differ
						if (newReceivedQty !== item.receivedQty || newOkQty !== item.okQty || 
						    newReworkQty !== item.reworkQty || newRejectedQty !== item.rejectedQty ||
						    newGrnNo !== item.grnNo) {
							console.debug('[VendorDeptModule][Sync] Updating VSIR data for PO:', order.materialPurchasePoNo, 'Item:', item.itemCode);
							updated = true;
							return {
								...item,
								receivedQty: newReceivedQty,
								okQty: newOkQty,
								reworkQty: newReworkQty,
								rejectedQty: newRejectedQty,
								grnNo: newGrnNo,
								// IMPORTANT: DO NOT modify debitNoteOrQtyReturned - it's a manual field
								debitNoteOrQtyReturned: item.debitNoteOrQtyReturned || ''
							};
						}
					}
					return item;
				});
				
				return { ...order, items: updatedItems };
			});
			
			if (updated) {
				console.debug('[VendorDeptModule][Sync] Syncing VSIR data to vendor dept orders');
				setOrders(updatedOrders);
				bus.dispatchEvent(new CustomEvent('vendorDept.updated', { detail: { source: 'vsir-sync' } }));
			}
		} catch (e) {
			console.error('[VendorDeptModule][Sync] Error syncing VSIR data:', e);
		}
	}, [orders]);

	// Listen for VSIR updates
	useEffect(() => {
		const handleVSIRUpdate = () => {
			console.log('[VendorDeptModule] VSIR data updated event received');
			// Trigger sync by forcing a state update
			setOrders(prev => [...prev]);
		};

		const storageHandler = (e: StorageEvent) => {
			if (e.key === 'vsri-records') {
				handleVSIRUpdate();
			}
		};

		window.addEventListener('storage', storageHandler);
		bus.addEventListener('vsir.updated', handleVSIRUpdate as EventListener);
		console.log('[VendorDeptModule] Listeners registered for VSIR updates');

		return () => {
			window.removeEventListener('storage', storageHandler);
			bus.removeEventListener('vsir.updated', handleVSIRUpdate as EventListener);
			console.log('[VendorDeptModule] Listeners removed for VSIR updates');
		};
	}, []);

	// Debug: Log VSIR records and orders on component mount
	useEffect(() => {
		console.log('[VendorDeptModule] ========== MOUNT DIAGNOSTIC ==========');
		console.log('[VendorDeptModule] VSIR records:');
		if (vsirRecords) {
			try {
				console.log('[VendorDeptModule]   Count:', vsirRecords.length);
				console.log('[VendorDeptModule]   Full data:', JSON.stringify(vsirRecords, null, 2));
				vsirRecords.forEach((r: any, i: number) => {
					console.log(`[VendorDeptModule]   [${i}] poNo="${r.poNo}" vendorBatchNo="${r.vendorBatchNo}" itemCode="${r.itemCode}"`);
				});
			} catch (e) {
				console.log('[VendorDeptModule]   Error:', e);
			}
		} else {
			console.log('[VendorDeptModule]   No VSIR records found');
		}
		console.log('[VendorDeptModule] VendorDept orders:');
		console.log('[VendorDeptModule]   Count:', orders.length);
		orders.forEach((o: any, i: number) => {
			console.log(`[VendorDeptModule]   [${i}] materialPurchasePoNo="${o.materialPurchasePoNo}" vendorBatchNo="${o.vendorBatchNo}"`);
		});
		console.log('[VendorDeptModule] ======================================');
	}, []);

	const [itemNames] = useState<string[]>([]);
	const [itemMaster] = useState<{ itemName: string; itemCode: string }[]>([]);
	const [editIdx, setEditIdx] = useState<{orderIdx: number, itemIdx: number} | null>(null);

	// Debug panel state
	const [debugOpen, setDebugOpen] = useState(false);
	const [debugReport, setDebugReport] = useState<any[]>([]);

// Refresh closingStock values for all orders from stock records
const refreshOrdersClosingStock = () => {
	setOrders(prevOrders => prevOrders.map(order => ({
		...order,
		items: (order.items || []).map((it: any) => ({
			...it,
			closingStock: getClosingStock(it.itemCode, it.itemName),
		}))
	})));
};

// Track stock updates so component re-renders when stock-records change
const [, setStockVersion] = useState(0);
useEffect(() => {
	const handler = () => { refreshOrdersClosingStock(); setStockVersion(v => v + 1); };
		// Listen for stock changes from StockModule or other tabs
		bus.addEventListener('stock.updated', handler as EventListener);
		const storageHandler = (e: StorageEvent) => { if ((e as any)?.key === 'stock-records') handler(); };
		window.addEventListener('storage', storageHandler);
		return () => {
			bus.removeEventListener('stock.updated', handler as EventListener);
			window.removeEventListener('storage', storageHandler as EventListener);
		};
	}, []);

	// Update orders when VSIR records change
	useEffect(() => {
		console.log('[VendorDept] VSIR records updated, syncing vendorBatchNo to orders');
		if (orders.length === 0) return;
		
		setOrders(prevOrders => {
			const updated = prevOrders.map(order => {
				// If vendorBatchNo is empty or missing, try to get from VSIR
				if (!order.vendorBatchNo || !order.vendorBatchNo.trim()) {
					const vsirBatchNo = getVendorBatchNoFromVSIR(order.materialPurchasePoNo, vsirRecords);
					if (vsirBatchNo) {
						return { ...order, vendorBatchNo: vsirBatchNo };
					}
				}
				return order;
			});
			
			return updated;
		});
	}, [vsirRecords]);

	// Auto-backfill batchNo from PSIR when psirData changes
	useEffect(() => {
		if (!psirData || !Array.isArray(psirData) || orders.length === 0) return;
		
		console.log('[VendorDeptModule] Auto-backfilling batchNo from PSIR for existing orders...');
		try {
			setOrders(prevOrders => {
				const updated = prevOrders.map(order => {
					// If order already has batchNo, skip it
					if (order.batchNo && String(order.batchNo).trim()) {
						return order;
					}
					
					// Find matching PSIR record by PO number
					const matchingPSIR = psirData.find((p: any) => p.poNo === order.materialPurchasePoNo);
					if (matchingPSIR && matchingPSIR.batchNo && matchingPSIR.invoiceNo && String(matchingPSIR.invoiceNo).trim()) {
						console.log('[VendorDeptModule] ✓ Auto-backfill: Found batchNo for PO', order.materialPurchasePoNo, ':', matchingPSIR.batchNo);
						return { ...order, batchNo: matchingPSIR.batchNo };
					}
					return order;
				});
				
				return updated;
			});
		} catch (err) {
			console.error('[VendorDeptModule] Error auto-backfilling batchNo:', err);
		}
	}, [psirData]);

	// Auto-fill vendorBatchNo in form when PO changes
	useEffect(() => {
		if (newOrder.materialPurchasePoNo && (!newOrder.vendorBatchNo || !newOrder.vendorBatchNo.trim())) {
			const vsirBatchNo = getVendorBatchNoFromVSIR(newOrder.materialPurchasePoNo, vsirRecords);
			if (vsirBatchNo) {
				console.log('[VendorDept] Auto-filling vendorBatchNo from VSIR:', vsirBatchNo);
				setNewOrder(prev => ({ ...prev, vendorBatchNo: vsirBatchNo }));
			}
		}
	}, [newOrder.materialPurchasePoNo, vsirRecords]);

		// Auto-fill Material Purchase PO No from latest PO No in PurchaseModule ONLY if newOrder is blank (prevents overwriting user input)
		useEffect(() => {
			const handlePurchaseChange = () => {
				if (!purchaseOrders || purchaseOrders.length === 0) return;
				
				const parsed = purchaseOrders;
				if (Array.isArray(parsed) && parsed.length > 0) {
					const latest = parsed[parsed.length - 1];
					// Only auto-fill if newOrder is blank except for materialPurchasePoNo
					if (
						latest && latest.poNo &&
						!newOrder.orderPlaceDate &&
						!newOrder.dcNo &&
						!newOrder.vendorName &&
						(!newOrder.items || newOrder.items.length === 0)
					) {
						setNewOrder(prev => ({ ...prev, materialPurchasePoNo: latest.poNo }));
					}
				}
			};
			// Initial run
			handlePurchaseChange();
			// Listen for same-tab updates via event bus
			bus.addEventListener('purchaseOrders.updated', handlePurchaseChange as EventListener);
			return () => {
				bus.removeEventListener('purchaseOrders.updated', handlePurchaseChange as EventListener);
			};
		}, [newOrder.orderPlaceDate, newOrder.dcNo, newOrder.vendorName, newOrder.items, purchaseOrders]);

	// Always set Material Purchase PO No to latest PO No from PurchaseModule if empty
	useEffect(() => {
		if (newOrder.materialPurchasePoNo) return;
		if (!purchaseOrders || purchaseOrders.length === 0) return;
		
		const parsed = purchaseOrders;
		if (Array.isArray(parsed) && parsed.length > 0) {
			const latest = parsed[parsed.length - 1];
			if (latest && latest.poNo) {
				setNewOrder(prev => ({ ...prev, materialPurchasePoNo: latest.poNo }));
			}
		}
	}, [newOrder.materialPurchasePoNo, purchaseOrders]);

	// Always sync Material Purchase PO No with the latest PO No from PurchaseModule
	useEffect(() => {
		const handlePurchaseChange = () => {
			if (!purchaseOrders || purchaseOrders.length === 0) return;
			
			const parsed = purchaseOrders;
			if (Array.isArray(parsed) && parsed.length > 0) {
				const latest = parsed[parsed.length - 1];
				if (latest && latest.poNo) {
					setNewOrder(prev => ({ ...prev, materialPurchasePoNo: latest.poNo }));
				}
			}
		};
		// Initial run
		handlePurchaseChange();
		// Listen for changes via event bus
		bus.addEventListener('purchaseOrders.updated', handlePurchaseChange as EventListener);
		return () => {
			bus.removeEventListener('purchaseOrders.updated', handlePurchaseChange as EventListener);
		};
	}, [purchaseOrders]);

	// Helper function to generate batch number

	// When materialPurchasePoNo changes, auto-fill order-level fields (if empty)
	useEffect(() => {
		if (!newOrder.materialPurchasePoNo) {
			console.log('[VendorDeptModule][MaterialPOChange] PO No is empty, skipping');
			return;
		}
		
		const poNo = newOrder.materialPurchasePoNo;
		console.log('[VendorDeptModule][MaterialPOChange] PO No changed to:', poNo);
		
		try {
			let oaNoValue = '';
			let batchNoValue = '';
			let vendorBatchNoValue = '';
			let orderPlaceDateValue = '';
			
			// FIRST: Try to get from existing VendorDept orders
			const existingOrder = orders.find(order => order.materialPurchasePoNo === poNo);
			if (existingOrder) {
				oaNoValue = existingOrder.oaNo || '';
				batchNoValue = existingOrder.batchNo || '';
				vendorBatchNoValue = existingOrder.vendorBatchNo || '';
				orderPlaceDateValue = existingOrder.orderPlaceDate || '';
				console.log('[VendorDeptModule][MaterialPOChange] ✓ Found in existing VendorDept orders:', { oaNoValue, batchNoValue, vendorBatchNoValue, orderPlaceDateValue });
			}
			
			// SECOND: If not found in orders, try PSIR data
			if (!oaNoValue || !batchNoValue || !orderPlaceDateValue) {
				const psirDataRecord = getPSIRDataByPO(poNo, psirData);
				if (psirDataRecord) {
					if (!oaNoValue) oaNoValue = psirDataRecord.oaNo || '';
					if (!batchNoValue) batchNoValue = psirDataRecord.batchNo || '';
					if (!orderPlaceDateValue) orderPlaceDateValue = psirDataRecord.receivedDate || '';
					console.log('[VendorDeptModule][MaterialPOChange] ✓ Found in PSIR:', { oaNoValue, batchNoValue, orderPlaceDateValue });
				}
			}
			
			// THIRD: If vendorBatchNo not found, try to get from VSIR
			if (!vendorBatchNoValue) {
				vendorBatchNoValue = getVendorBatchNoFromVSIR(poNo, vsirRecords);
				if (vendorBatchNoValue) {
					console.log('[VendorDeptModule][MaterialPOChange] ✓ Fetched Vendor Batch No from VSIR:', vendorBatchNoValue);
				} else {
					console.log('[VendorDeptModule][MaterialPOChange] ✗ Vendor Batch No not found in VSIR');
				}
			}
			
			console.log('[VendorDeptModule][MaterialPOChange] Final values - Order Place Date:', orderPlaceDateValue, 'OA NO:', oaNoValue, 'Batch No:', batchNoValue);
			
			setNewOrder(prev => {
				const updated = {
					...prev,
					orderPlaceDate: orderPlaceDateValue || prev.orderPlaceDate,
					oaNo: oaNoValue || prev.oaNo,
					batchNo: batchNoValue || prev.batchNo,
					vendorBatchNo: vendorBatchNoValue || prev.vendorBatchNo,
				};
				console.log('[VendorDeptModule][MaterialPOChange] Updated newOrder state:', updated);
				return updated;
			});
		} catch (e) {
			console.error('[VendorDeptModule][MaterialPOChange] Error:', e);
		}
	}, [newOrder.materialPurchasePoNo, orders, vsirRecords, psirData]);



	// Auto-fill item fields from PSIR data (preferred) or purchaseData when PO No or Item Code changes
	useEffect(() => {
		if (!newOrder.materialPurchasePoNo || !itemInput.itemCode) return;
		console.log('[VendorDeptModule][AutoFill] PO No:', newOrder.materialPurchasePoNo, 'Item Code:', itemInput.itemCode);
		// Try PSIR data first
		let filled = false;
		if (psirData) {
			try {
				const psirs = psirData;
				for (const psir of psirs) {
					if (psir.poNo === newOrder.materialPurchasePoNo && Array.isArray(psir.items)) {
						const match = psir.items.find((it: any) => it.itemCode === itemInput.itemCode);
						console.log('[VendorDeptModule][AutoFill] PSIR match:', match);
						if (match) {
							// Do NOT auto-fill receivedQty from PSIR -- keep Received Qty manual
							setItemInput(prev => ({
								...prev,
								qty: getPurchaseQty(newOrder.materialPurchasePoNo, match.itemCode, purchaseOrders, purchaseData) || match.qtyReceived || prev.qty,
								indentStatus: (function(){ const p = getIndentStatusFromPurchase(newOrder.materialPurchasePoNo, match.itemCode || prev.itemCode, match.indentNo || psir.indentNo || prev.materialIssueNo || '', purchaseData, purchaseOrders); if (p) return p && p.toUpperCase ? p.toUpperCase() : String(p); return (prev.indentStatus || '').toUpperCase(); })(),
								okQty: match.okQty || 0,
								reworkQty: prev.reworkQty, // PSIR may not have reworkQty
								rejectedQty: match.rejectQty || 0,
								grnNo: match.grnNo || psir.grnNo || '',
							}));
							filled = true;
							break;
						}
					}
				}
			} catch (err) {
				console.error('[VendorDeptModule][AutoFill] Error parsing PSIR data:', err);
			}
		}
		// If not found in PSIR, fallback to purchaseOrders
		if (!filled && purchaseOrders) {
			try {
				const parsed = purchaseOrders;
				const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
				const targetPo = norm(newOrder.materialPurchasePoNo);
				const targetCode = norm(itemInput.itemCode);
				const po = parsed.find((order: any) => norm(order.poNo) === targetPo || norm(order.poNo || order.indentNo) === targetPo);
				console.log('[VendorDeptModule][AutoFill] Purchase order found (normalized):', !!po);
				if (po && Array.isArray(po.items)) {
					const match = po.items.find((it: any) => norm(it.itemCode || it.Code) === targetCode);
					console.log('[VendorDeptModule][AutoFill] Purchase item match (normalized):', match);
					if (match) {
						const inferredQty = getPurchaseQty(newOrder.materialPurchasePoNo, match.itemCode, purchaseOrders, purchaseData) || Number(match.purchaseQty ?? match.receivedQty ?? match.qty ?? 0);
						// Do NOT auto-fill receivedQty here — it must be entered manually
						setItemInput(prev => ({
							...prev,
							qty: inferredQty,
							okQty: match.okQty || 0,
							reworkQty: match.reworkQty || 0,
							rejectedQty: match.rejectedQty || 0,
							grnNo: match.grnNo || '',
						}));
					}
				}
			} catch (err) {
				console.error('[VendorDeptModule][AutoFill] Error parsing purchaseOrders:', err);
			}
		}
	}, [newOrder.materialPurchasePoNo, itemInput.itemCode, psirData, purchaseOrders, purchaseData]);


	useEffect(() => {
		console.log('[VendorDeptModule] Loading item master data from Firestore state');
		// Item master will be passed from parent or loaded separately
	}, []);

	const handleAddItem = () => {
		if (!itemInput.itemName || !itemInput.itemCode || !itemInput.materialIssueNo || itemInput.qty <= 0) return;
		const itemWithStock = { ...itemInput, closingStock: getClosingStock(itemInput.itemCode, itemInput.itemName) };
		setNewOrder({ ...newOrder, items: [...newOrder.items, itemWithStock] });
		setItemInput({ itemName: '', itemCode: '', materialIssueNo: '', qty: 0, closingStock: '', indentStatus: '', receivedQty: 0, okQty: 0, reworkQty: 0, rejectedQty: 0, grnNo: '', debitNoteOrQtyReturned: '', remarks: '' });
	};

	const [editItemIdx, setEditItemIdx] = useState<number | null>(null);

	const handleDeleteCurrentItem = (idx: number) => {
		setNewOrder(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
		if (editItemIdx === idx) {
			setEditItemIdx(null);
			setItemInput({ itemName: '', itemCode: '', materialIssueNo: '', qty: 0, closingStock: '', indentStatus: '', receivedQty: 0, okQty: 0, reworkQty: 0, rejectedQty: 0, grnNo: '', debitNoteOrQtyReturned: '', remarks: '' });
		}
	};
	void handleDeleteCurrentItem; 

	const handleAddOrder = () => {
		// Debug: log the new order before saving
		console.log('[VendorDeptModule] handleAddOrder newOrder:', newOrder);
		console.log('[VendorDeptModule] handleAddOrder - batchNo value:', newOrder.batchNo);
		// Ensure all required fields are filled, including OA NO and Batch No
		if (!newOrder.orderPlaceDate || !newOrder.materialPurchasePoNo || !newOrder.vendorName || newOrder.items.length === 0 || !newOrder.dcNo) {
			alert('Please fill all required fields (Order Date, PO No, Vendor, DC No, and at least one item)');
			return;
		}
		if (!newOrder.oaNo) {
			alert('OA NO not populated yet. Please wait or try selecting the PO No again.');
			return;
		}
		if (!newOrder.batchNo) {
			alert('Batch No not populated yet. Please wait or try selecting the PO No again.');
			return;
		}
		// Get vendor batch no from VSIR at save time (no auto-generation)
		let vendorBatchNo = newOrder.vendorBatchNo;
		if (!vendorBatchNo) {
			// Try to fetch from VSIR by matching PO
			console.log('[VendorDeptModule] vendorBatchNo is empty, fetching from VSIR for PO:', newOrder.materialPurchasePoNo);
			vendorBatchNo = getVendorBatchNoFromVSIR(newOrder.materialPurchasePoNo, vsirRecords);
			
			if (vendorBatchNo) {
				console.log('[VendorDeptModule] ✓ Fetched vendorBatchNo from VSIR:', vendorBatchNo);
			} else {
				console.log('[VendorDeptModule] ✗ Vendor Batch No NOT found in VSIR - leaving empty (user must create in VSIR first)');
			}
		}
		console.log('[VendorDeptModule] Final vendorBatchNo:', vendorBatchNo);
		
		// Ensure uniqueness by checking against all existing orders
		const allExistingOrders = [...orders];
		
		// Check for duplicates and increment if needed
		let counter = 0;
		while (allExistingOrders.some(o => o.vendorBatchNo === vendorBatchNo) && counter < 100) {
			counter++;
			// If duplicate found, generate next number
			const yy = String(new Date().getFullYear()).slice(-2);
			const match = vendorBatchNo.match(new RegExp(`${yy}/V(\\d+)`));
			if (match) {
				const num = parseInt(match[1], 10);
				vendorBatchNo = `${yy}/V${num + 1}`;
				console.log('[VendorDeptModule] Duplicate found, incremented to:', vendorBatchNo);
			} else {
				break;
			}
		}
		console.log('[VendorDeptModule] Final vendorBatchNo for save:', vendorBatchNo);
		const orderToSave = {
			orderPlaceDate: newOrder.orderPlaceDate,
			materialPurchasePoNo: newOrder.materialPurchasePoNo,
			oaNo: newOrder.oaNo,
			batchNo: newOrder.batchNo,
			vendorBatchNo: vendorBatchNo,
			dcNo: newOrder.dcNo,
			vendorName: newOrder.vendorName,
			items: newOrder.items,
		};
		console.log('[VendorDeptModule] Order to save with batchNo:', orderToSave);
		const updated = [...orders, orderToSave];
		console.log('[VendorDeptModule] Updated orders array:', updated);
		setOrders(updated);
		
		// DIRECTLY update VSIR records with the vendorBatchNo
		try {
			if (vsirRecords && Array.isArray(vsirRecords)) {
				console.log('[VendorDeptModule] Syncing vendorBatchNo to VSIR for PO:', orderToSave.materialPurchasePoNo);
				const updatedVsirRecords = vsirRecords.map((record: any) => {
					// Match VSIR record by PO number (normalized comparison)
					const recordPoNo = String(record.poNo || '').trim();
					const orderPoNo = String(orderToSave.materialPurchasePoNo || '').trim();
					if (recordPoNo === orderPoNo) {
						console.log('[VendorDeptModule] ✓ VSIR record matched for PO', orderPoNo, '- updating vendorBatchNo:', orderToSave.vendorBatchNo);
						return { ...record, vendorBatchNo: orderToSave.vendorBatchNo };
					}
					return record;
				});
				console.log('[VendorDeptModule] VSIR records updated');
				// Dispatch event so VSIR component knows about the update
				try {
					bus.dispatchEvent(new CustomEvent('vsir.records.synced', { detail: { records: updatedVsirRecords } }));
				} catch {}
			}
		} catch (err) {
			console.error('[VendorDeptModule] Error syncing to VSIR:', err);
		}
		
		// Dispatch event so VSIR can sync the vendorBatchNo (legacy event for safety)
		try {
			bus.dispatchEvent(new CustomEvent('vendorDept.updated', { detail: { vendorDeptData: updated } }));
			console.log('[VendorDeptModule] Dispatched vendorDept.updated event for VSIR sync');
		} catch (err) {
			console.error('[VendorDeptModule] Error dispatching vendorDept.updated event:', err);
		}
		
		clearNewOrder();
	};

	const [editOrderIdx, setEditOrderIdx] = useState<number | null>(null);

	// Auto-fill Vendor Name from Purchase module when PO No changes
	useEffect(() => {
		if (!newOrder.materialPurchasePoNo) {
			// If PO is cleared, don't clear vendor name (user might want to keep it)
			return;
		}
		
		// Only auto-fill if vendor name is empty AND we're not editing (fresh add)
		if (editOrderIdx === null && !newOrder.vendorName) {
			const supplierName = getSupplierNameFromPO(newOrder.materialPurchasePoNo, purchaseOrders, purchaseData);
			if (supplierName) {
				console.log('[VendorDeptModule][VendorAutoFill] ✓ Fetched supplier name from PO:', supplierName);
				setNewOrder(prev => ({ ...prev, vendorName: supplierName }));
			} else {
				console.log('[VendorDeptModule][VendorAutoFill] ✗ Could not find supplier name for PO:', newOrder.materialPurchasePoNo);
			}
		}
	}, [newOrder.materialPurchasePoNo, editOrderIdx, newOrder.vendorName, purchaseOrders, purchaseData]);

	const handleEditOrder = (idx: number) => {
				// Deep clone to avoid direct mutation
				const orderToEdit = JSON.parse(JSON.stringify(orders[idx]));
				console.log('[DEBUG][VendorDeptModule] Editing order at idx:', idx, orderToEdit);
				
				// If the order doesn't have a vendor batch no, try to fetch from VSIR (don't generate)
				if (!orderToEdit.vendorBatchNo || orderToEdit.vendorBatchNo.trim() === '') {
					const fetchedFromVSIR = getVendorBatchNoFromVSIR(orderToEdit.materialPurchasePoNo, vsirRecords);
					if (fetchedFromVSIR) {
						console.log('[VendorDeptModule] ✓ Loaded vendor batch no from VSIR:', fetchedFromVSIR);
						orderToEdit.vendorBatchNo = fetchedFromVSIR;
					} else {
						console.log('[VendorDeptModule] ✗ Vendor Batch No not found in VSIR - will remain empty');
					}
				}
				
				setNewOrder(orderToEdit);
				setEditOrderIdx(idx);
			};
	const handleUpdateOrder = () => {
		if (editOrderIdx === null) return;
		console.log('[DEBUG][VendorDeptModule] Saving newOrder at idx:', editOrderIdx, newOrder);
		console.log('[DEBUG][VendorDeptModule] batchNo value:', newOrder.batchNo);

		const updated = orders.map((order, idx) => idx === editOrderIdx ? newOrder : order);
		setOrders(updated);
		
		// Dispatch event so Purchase Module can sync
		try {
			bus.dispatchEvent(new CustomEvent('vendorDept.updated', { detail: { vendorDeptData: updated } }));
			console.log('[VendorDeptModule] Dispatched vendorDept.updated event');
		} catch (err) {
			console.error('[VendorDeptModule] Error dispatching vendorDept.updated event:', err);
		}
		
		clearNewOrder();
		setEditOrderIdx(null);
	};

	const handleSaveItem = () => {
				if (editIdx) {
					// If editing an item in newOrder.items (pre-save table), update it in newOrder.items
					setNewOrder(prev => ({
						...prev,
						items: prev.items.map((item, iIdx) => iIdx === editIdx.itemIdx ? { ...itemInput, closingStock: getClosingStock(itemInput.itemCode, itemInput.itemName) } : item)
					}));
					setEditIdx(null);
					setItemInput({ itemName: '', itemCode: '', materialIssueNo: '', qty: 0, closingStock: '', indentStatus: '', receivedQty: 0, okQty: 0, reworkQty: 0, rejectedQty: 0, grnNo: '', debitNoteOrQtyReturned: '', remarks: '' });
				} else {
					handleAddItem();
				}
	};

	// Debug: Log PO list and newOrder.materialPurchasePoNo on every render
	React.useEffect(() => {
		console.log('[VendorDeptModule] purchasePOs:', purchasePOs);
		console.log('[VendorDeptModule] newOrder.materialPurchasePoNo:', newOrder.materialPurchasePoNo);
	}, [purchasePOs, newOrder.materialPurchasePoNo]);

	// Debug: Log DC No and newOrder state on every render
	useEffect(() => {
		console.log('[VendorDeptModule] newOrder.dcNo:', newOrder.dcNo);
		console.log('[VendorDeptModule] newOrder:', newOrder);
		console.log('[VendorDeptModule] orders:', orders);
	}, [newOrder, orders]);

	// FIXED: Auto-add a Vendor Dept Order for every new PO in purchasePOs if not already present
	// This function now ONLY reads from purchaseOrders and NEVER writes to it
	React.useEffect(() => {
		if (purchasePOs.length === 0) return;
		
		// Use purchaseOrders as source for full item details, but group by poNo
		const purchaseOrdersRaw = localStorage.getItem('purchaseOrders');
		console.debug('[VendorDeptModule][AutoImport] purchaseOrdersRaw:', purchaseOrdersRaw);
		let purchaseEntries = [];
		try {
			purchaseEntries = purchaseOrdersRaw ? JSON.parse(purchaseOrdersRaw) : [];
			console.debug('[VendorDeptModule][AutoImport] Parsed purchaseEntries:', purchaseEntries);
		} catch (err) {
			console.error('[VendorDeptModule][AutoImport] Error parsing purchaseOrders:', err);
		}
		
		// Group purchase entries by poNo (normalized to uppercase for consistent comparison)
		const poGroups: { [poNo: string]: any[] } = {};
		purchaseEntries.forEach((entry: any) => {
			if (!entry.poNo) return;
			const normalizedPoNo = String(entry.poNo).trim().toUpperCase();
			if (!poGroups[normalizedPoNo]) poGroups[normalizedPoNo] = [];
			poGroups[normalizedPoNo].push(entry);
		});
		
		console.debug('[VendorDeptModule][AutoImport] poGroups:', poGroups);
		
		// For each PO, check if an order exists in Vendor Dept Orders
		// CRITICAL: Check both in-memory state AND localStorage to prevent duplicates
		// ALSO: Normalize PO numbers to uppercase for case-insensitive comparison
		const existingPOs = new Set<string>(orders.map(order => String(order.materialPurchasePoNo).trim().toUpperCase()));
		try {
			const savedData = localStorage.getItem('vendorDeptData');
			if (savedData) {
				const savedOrders = JSON.parse(savedData);
				if (Array.isArray(savedOrders)) {
					savedOrders.forEach((order: any) => {
						if (order.materialPurchasePoNo) {
							const normalizedPoNo = String(order.materialPurchasePoNo).trim().toUpperCase();
							existingPOs.add(normalizedPoNo);
						}
					});
				}
			}
		} catch (err) {
			console.error('[VendorDeptModule][AutoImport] Error reading vendorDeptData from localStorage:', err);
		}
		console.debug('[VendorDeptModule][AutoImport] existingPOs (normalized):', existingPOs);
		
		let added = false;
		const newOrders = [...orders];
		
		purchasePOs.forEach(poNo => {
			const normalizedPoNo = String(poNo).trim().toUpperCase();
			if (!existingPOs.has(normalizedPoNo) && poGroups[normalizedPoNo]) {
				const group = poGroups[normalizedPoNo];
				console.debug('[VendorDeptModule][AutoImport] Importing group for PO:', poNo, '(normalized:', normalizedPoNo, ')', group);
				
				// Map purchase items to VendorDeptItem format, filling all available fields
				const items = group.map((item: any) => {
					let itemName = item.itemName || item.model || '';
					let itemCode = item.itemCode || '';
					
					if ((!itemName || !itemCode) && window.localStorage) {
						const itemMasterRaw = localStorage.getItem('itemMasterData');
						if (itemMasterRaw) {
							try {
								const itemMaster = JSON.parse(itemMasterRaw);
								if (Array.isArray(itemMaster)) {
									if (itemCode) {
										const found = itemMaster.find((im: any) => im.itemCode === itemCode);
										if (found) itemName = found.itemName || itemName;
									}
									if (itemName && !itemCode) {
										const found = itemMaster.find((im: any) => im.itemName === itemName);
										if (found) itemCode = found.itemCode || itemCode;
									}
								}
							} catch {}
						}
					}
					
					return {
						itemName,
						itemCode,
						materialIssueNo: '',
						qty: getPurchaseQty(poNo, itemCode, purchaseOrders, purchaseData) || item.qty || 0,
						indentStatus: (function() {
							const purchaseStatus = getIndentStatusFromPurchase(poNo, itemCode, item.indentNo || '', purchaseData, purchaseOrders);
							if (purchaseStatus) return purchaseStatus && purchaseStatus.toUpperCase ? purchaseStatus.toUpperCase() : String(purchaseStatus);
							return (item.indentStatus || '').toUpperCase();
						})(),
						// Do not auto-fill receivedQty on import; require manual entry
						receivedQty: 0,
						okQty: item.okQty || 0,
						reworkQty: item.reworkQty || 0,
						rejectedQty: item.rejectedQty || 0,
						grnNo: item.grnNo || '',
						debitNoteOrQtyReturned: item.debitNoteOrQtyReturned || '',
						remarks: item.remarks || '',
					};
				});
				
				// Use first entry for order-level fields
				const first = group[0];
				
				// Fetch Batch No from PSIR for auto-imported orders (just like manual form)
				let batchNoForAutoImport = first?.batchNo || '';
// Fetch batchNo ONLY from PSIR - NO AUTO-GENERATION
			if (!batchNoForAutoImport) {
				try {
					const psirDataRaw = localStorage.getItem('psirData');
					if (psirDataRaw) {
						const psirs = JSON.parse(psirDataRaw);
						if (Array.isArray(psirs)) {
							const matchingPSIR = psirs.find((p: any) => p.poNo === poNo);
							if (matchingPSIR && matchingPSIR.batchNo) {
								batchNoForAutoImport = matchingPSIR.batchNo;
								console.debug('[VendorDeptModule][AutoImport] ✓ Found batchNo from PSIR for PO', poNo, ':', batchNoForAutoImport);
							} else if (matchingPSIR) {
								console.debug('[VendorDeptModule][AutoImport] ✗ PSIR record found but NO batchNo (invoice may not be entered yet)');
							}
						}
					}
				} catch (e) {
					console.error('[VendorDeptModule][AutoImport] Error fetching batchNo from PSIR:', e);
				}
			}
			
			// NO AUTO-GENERATION - batchNo should only come from PSIR
			if (!batchNoForAutoImport) {
				console.debug('[VendorDeptModule][AutoImport] Batch No NOT populated - waiting for PSIR to generate it');
			}
			
			// Fetch Vendor Batch No from VSIR
			let vendorBatchNoForAutoImport = '';
			try {
				const vsirRaw = localStorage.getItem('vsri-records');
				if (vsirRaw) {
					const vsirRecords = JSON.parse(vsirRaw);
					if (Array.isArray(vsirRecords)) {
						const matchingVSIR = vsirRecords.find((v: any) => v.poNo === poNo);
						if (matchingVSIR && matchingVSIR.vendorBatchNo) {
							vendorBatchNoForAutoImport = matchingVSIR.vendorBatchNo;
							console.debug('[VendorDeptModule][AutoImport] ✓ Found vendorBatchNo from VSIR for PO', poNo, ':', vendorBatchNoForAutoImport);
						} else if (matchingVSIR) {
							console.debug('[VendorDeptModule][AutoImport] ✗ VSIR record found but NO vendorBatchNo yet');
						}
					}
				}
			} catch (e) {
				console.error('[VendorDeptModule][AutoImport] Error fetching vendorBatchNo from VSIR:', e);
			}
			
			if (!vendorBatchNoForAutoImport) {
				console.debug('[VendorDeptModule][AutoImport] Vendor Batch No NOT populated - will be fetched when manually entered in VSIR');
			}
				
				newOrders.push({
					orderPlaceDate: first?.orderPlaceDate || '',
					materialPurchasePoNo: poNo,
					oaNo: first?.oaNo || '',
					batchNo: batchNoForAutoImport,
					vendorBatchNo: vendorBatchNoForAutoImport,
					dcNo: '',
					vendorName: '', // MANUAL ENTRY - users must enter vendor name manually
					items,
				});
				added = true;
			}
		});
		
		if (added) {
			console.debug('[VendorDeptModule][AutoImport] Imported new orders:', newOrders);
			setOrders(newOrders);
			// CRITICAL: Also reload and merge from localStorage to prevent overwriting recent updates
			try {
				const current = localStorage.getItem('vendorDeptData');
				if (current) {
					const currentOrders = JSON.parse(current);
					// Merge: keep all current orders and add only the new ones that don't conflict
					// Use normalized (uppercase) PO numbers for case-insensitive comparison
					const merged = [...currentOrders];
					newOrders.forEach((newOrder: any) => {
						// Check if this PO already exists in current (case-insensitive)
						const newOrderPoNormalized = String(newOrder.materialPurchasePoNo).trim().toUpperCase();
						const exists = merged.some(o => String(o.materialPurchasePoNo).trim().toUpperCase() === newOrderPoNormalized);
						if (!exists) {
							merged.push(newOrder);
						}
					});
					localStorage.setItem('vendorDeptData', JSON.stringify(merged));
					console.debug('[VendorDeptModule][AutoImport] Merged with existing orders in localStorage');
				} else {
					localStorage.setItem('vendorDeptData', JSON.stringify(newOrders));
				}
			} catch (err) {
				console.error('[VendorDeptModule][AutoImport] Error merging with localStorage:', err);
				localStorage.setItem('vendorDeptData', JSON.stringify(newOrders));
			}
		}
	}, [purchaseOrders]);

	// Regenerate vendor batch nos for existing orders that don't have them
	const regenerateVendorBatchNos = () => {
		const rawData = localStorage.getItem('vendorDeptData');
		if (!rawData) return;
		
		try {
			const allOrders = JSON.parse(rawData);
			let needsUpdate = false;
			
			const updated = allOrders.map((order: any, idx: number) => {
				if (!order.vendorBatchNo || order.vendorBatchNo.trim() === '') {
					needsUpdate = true;
					// Generate unique vendor batch no
					const yy = String(new Date().getFullYear()).slice(-2);
					let maxNum = 0;
					
					// Find max number already used
					allOrders.forEach((o: any) => {
						if (o.vendorBatchNo && typeof o.vendorBatchNo === 'string') {
							const match = o.vendorBatchNo.match(new RegExp(`${yy}/V(\\d+)`));
							if (match) {
								const num = parseInt(match[1], 10);
								if (!isNaN(num)) maxNum = Math.max(maxNum, num);
							}
						}
					});
					
					// Make sure we don't duplicate numbers already in this batch
					let newNum = maxNum + idx + 1;
					const newVendorBatchNo = `${yy}/V${newNum}`;
					console.log('[VendorDeptModule] Regenerating vendorBatchNo for order', idx, ':', newVendorBatchNo);
					return { ...order, vendorBatchNo: newVendorBatchNo };
				}
				return order;
			});
			
			if (needsUpdate) {
				console.log('[VendorDeptModule] Updated orders with vendorBatchNos:', updated);
				localStorage.setItem('vendorDeptData', JSON.stringify(updated));
				setOrders(updated);
				alert('✅ Vendor Batch Nos regenerated for all orders!');
			} else {
				console.log('[VendorDeptModule] All orders already have vendorBatchNos');
				alert('✅ All orders already have Vendor Batch Nos');
			}
		} catch (err) {
			console.error('[VendorDeptModule] Error regenerating vendor batch nos:', err);
			alert('❌ Error regenerating vendor batch nos');
		}
	};

	// Sync Batch No from PSIR to all existing orders
	const syncBatchNoFromPSIR = () => {
		console.log('[VendorDeptModule] Syncing Batch No from PSIR to all orders');
		try {
			const psirDataRaw = localStorage.getItem('psirData');
			if (!psirDataRaw) {
				alert('❌ No PSIR data found');
				return;
			}
			
			const psirRecords = JSON.parse(psirDataRaw);
			const allOrdersRaw = localStorage.getItem('vendorDeptData');
			if (!allOrdersRaw) {
				alert('❌ No Vendor Dept orders found');
				return;
			}
			
			const allOrders = JSON.parse(allOrdersRaw);
			let updated = 0;
			
			const syncedOrders = allOrders.map((order: any) => {
				// Find matching PSIR record by PO number
				const matchingPSIR = psirRecords.find((p: any) => p.poNo === order.materialPurchasePoNo);
				if (matchingPSIR && matchingPSIR.batchNo && !order.batchNo) {
					console.log('[VendorDeptModule] ✓ Syncing batchNo for PO', order.materialPurchasePoNo, ':', matchingPSIR.batchNo);
					updated++;
					return { ...order, batchNo: matchingPSIR.batchNo };
				}
				return order;
			});
			
			localStorage.setItem('vendorDeptData', JSON.stringify(syncedOrders));
			setOrders(syncedOrders);
			bus.dispatchEvent(new CustomEvent('vendorDept.updated', { detail: { vendorDeptData: syncedOrders } }));
			
			if (updated > 0) {
				console.log('[VendorDeptModule] Synced Batch No for', updated, 'orders');
				alert(`✅ Synced Batch No for ${updated} order(s)`);
			} else {
				alert('✅ All orders already have Batch No or no matching PSIR data');
			}
		} catch (err) {
			console.error('[VendorDeptModule] Error syncing Batch No from PSIR:', err);
			alert('❌ Error syncing Batch No: ' + String(err));
		}
	};

	// Always sync orders state with localStorage after auto-adding POs
	React.useEffect(() => {
		const savedData = localStorage.getItem('vendorDeptData');
		if (savedData) {
			setOrders(JSON.parse(savedData));
		}

		// When PurchaseModule updates, attempt a non-destructive sync to fill empty qtys
		const handlePurchaseUpdate = () => {
			console.log('[VendorDeptModule] Detected purchaseOrders update, running non-destructive sync');
			syncEmptyVendorDeptQty();
		};

		// When VSIR updates, sync vendorBatchNo
const handleVSIRUpdate = (event?: any) => {
		console.log('[VendorDeptModule] VSIR updated event received, syncing vendorBatchNo');
		console.log('[VendorDeptModule] Event detail records:', event?.detail?.records);
		
		// Get VSIR records directly from localStorage for diagnostic
		const vsirRaw = localStorage.getItem('vsri-records');
		if (vsirRaw) {
			const vsirRecords = JSON.parse(vsirRaw);
			console.log('[VendorDeptModule] VSIR records from localStorage:', vsirRecords.map((r: any) => ({ poNo: r.poNo, vendorBatchNo: r.vendorBatchNo, id: r.id })));
		}
		
		setOrders(prevOrders => {
			console.log('[VendorDeptModule] Current VendorDept orders:', prevOrders.map(o => ({ poNo: o.materialPurchasePoNo, vendorBatchNo: o.vendorBatchNo })));
			const updated = prevOrders.map(order => {
				if (!order.vendorBatchNo || !order.vendorBatchNo.trim()) {
					const fetched = getVendorBatchNoFromVSIR(order.materialPurchasePoNo, vsirRecords);
					console.log('[VendorDeptModule] Attempting to fetch for PO:', order.materialPurchasePoNo, '-> Result:', fetched);
					if (fetched) {
						console.log('[VendorDept] Synced vendorBatchNo for PO', order.materialPurchasePoNo, ':', fetched);
						return { ...order, vendorBatchNo: fetched };
					}
				}
				return order;
			});
			// Persist synced data back to localStorage
			console.log('[VendorDeptModule] Final updated orders:', updated.map(o => ({ poNo: o.materialPurchasePoNo, vendorBatchNo: o.vendorBatchNo })));
				localStorage.setItem('vendorDeptData', JSON.stringify(updated));
				return updated;
			});
		};

		window.addEventListener('storage', handlePurchaseUpdate);
		bus.addEventListener('purchaseOrders.updated', handlePurchaseUpdate as EventListener);
		bus.addEventListener('vsir.updated', handleVSIRUpdate as EventListener);
		
		return () => {
			window.removeEventListener('storage', handlePurchaseUpdate);
			bus.removeEventListener('purchaseOrders.updated', handlePurchaseUpdate as EventListener);
			bus.removeEventListener('vsir.updated', handleVSIRUpdate as EventListener);
		};
	}, [purchasePOs]);

	// Debug: Log orders state before rendering table
	React.useEffect(() => {
		console.log('[VendorDeptModule] orders state before table (full):', JSON.stringify(orders, null, 2));
	}, [orders]);

	// When PSIR data is updated, refresh the form's batchNo if PO is selected
	useEffect(() => {
		const handlePSIRUpdate = () => {
			console.log('[VendorDeptModule] PSIR data updated, refreshing batchNo for current PO:', newOrder.materialPurchasePoNo);
			if (!newOrder.materialPurchasePoNo) return;
			
			try {
				const psirDataRaw = localStorage.getItem('psirData');
				if (!psirDataRaw) return;
				
				const psirs = JSON.parse(psirDataRaw);
				const matchingPSIR = psirs.find((p: any) => p.poNo === newOrder.materialPurchasePoNo);
				
				if (matchingPSIR && matchingPSIR.invoiceNo && String(matchingPSIR.invoiceNo).trim() && matchingPSIR.batchNo) {
					console.log('[VendorDeptModule] ✓ PSIR update: Found invoiceNo and batchNo, updating form');
					setNewOrder(prev => ({
						...prev,
						oaNo: matchingPSIR.oaNo || prev.oaNo,
						batchNo: matchingPSIR.batchNo || prev.batchNo,
					}));
				}
			} catch (err) {
				console.error('[VendorDeptModule] Error handling PSIR update:', err);
			}
		};
		
		bus.addEventListener('psirData.updated', handlePSIRUpdate as EventListener);
		
		return () => {
			bus.removeEventListener('psirData.updated', handlePSIRUpdate as EventListener);
		};
	}, [newOrder.materialPurchasePoNo]);

	// Auto-fill vendorBatchNo from VSIR when PO No changes (don't generate - let save handle that)
	useEffect(() => {
		if (newOrder.materialPurchasePoNo) {
			console.log('[VendorDept] ========== AUTO-FILL CHECK ==========');
			const vendorBatchNo = getVendorBatchNoFromVSIR(newOrder.materialPurchasePoNo);
			console.log('[VendorDept] Auto-fill vendorBatchNo for PO:', newOrder.materialPurchasePoNo, 'Result from VSIR:', vendorBatchNo);
			
			if (vendorBatchNo) {
				console.log('[VendorDept] ✓ Found in VSIR, setting vendorBatchNo:', vendorBatchNo);
				setNewOrder(prev => ({ ...prev, vendorBatchNo }));
				console.log('[VendorDept] vendorBatchNo filled from VSIR:', vendorBatchNo);
			} else {
				// If not found in VSIR, check if there's an existing order with this PO
				const existingOrder = orders.find(o => o.materialPurchasePoNo === newOrder.materialPurchasePoNo);
				if (existingOrder?.vendorBatchNo) {
					console.log('[VendorDept] ✓ Found in existing orders, using vendorBatchNo:', existingOrder.vendorBatchNo);
					setNewOrder(prev => ({ ...prev, vendorBatchNo: existingOrder.vendorBatchNo }));
				} else {
					// If not found anywhere, set to empty and let save time logic generate unique one
					console.log('[VendorDept] ✗ No VSIR data or existing order found, will generate unique number at save time');
					setNewOrder(prev => ({ ...prev, vendorBatchNo: '' }));
				}
			}
			console.log('[VendorDept] ====================================');
		}
	}, [newOrder.materialPurchasePoNo, orders]);

	// Listen to VSIR updates and refetch vendorBatchNo if PO matches
	useEffect(() => {
		const handleVsirRecordsSync = () => {
			if (newOrder.materialPurchasePoNo) {
				console.log('[VendorDept] VSIR records synced event received, refetching vendorBatchNo');
				const vendorBatchNo = getVendorBatchNoFromVSIR(newOrder.materialPurchasePoNo);
				if (vendorBatchNo && vendorBatchNo !== newOrder.vendorBatchNo) {
					console.log('[VendorDept] ✓ Updating vendorBatchNo from VSIR sync:', vendorBatchNo);
					setNewOrder(prev => ({ ...prev, vendorBatchNo }));
				}
			}
		};
		
		bus.addEventListener('vsir.records.synced', handleVsirRecordsSync as EventListener);
		bus.addEventListener('vsir.updated', handleVsirRecordsSync as EventListener);
		
		return () => {
			bus.removeEventListener('vsir.records.synced', handleVsirRecordsSync as EventListener);
			bus.removeEventListener('vsir.updated', handleVsirRecordsSync as EventListener);
		};
	}, [newOrder.materialPurchasePoNo, newOrder.vendorBatchNo]);

	// When PSIR data is updated, sync batchNo to existing orders
	useEffect(() => {
		const handlePSIRUpdate = () => {
			console.log('[VendorDeptModule] PSIR data updated, syncing batchNo to orders');
			const psirDataRaw = localStorage.getItem('psirData');
			if (!psirDataRaw) return;
			
			try {
				const psirRecords = JSON.parse(psirDataRaw);
				setOrders(prevOrders => {
					const updated = prevOrders.map(order => {
						// Find matching PSIR record by PO number
						const matchingPSIR = psirRecords.find((p: any) => p.poNo === order.materialPurchasePoNo);
						if (matchingPSIR && matchingPSIR.batchNo && !order.batchNo) {
							// Only update if order doesn't have batchNo but PSIR does
							console.log('[VendorDeptModule] ✓ Syncing batchNo from PSIR for PO', order.materialPurchasePoNo, ':', matchingPSIR.batchNo);
							return { ...order, batchNo: matchingPSIR.batchNo };
						}
						return order;
					});
					
					// Check if any changes were made
					const changed = updated.some((o, i) => o.batchNo !== prevOrders[i].batchNo);
					if (changed) {
						console.log('[VendorDeptModule] Batch No synced from PSIR, saving to localStorage');
						localStorage.setItem('vendorDeptData', JSON.stringify(updated));
						bus.dispatchEvent(new CustomEvent('vendorDept.updated', { detail: { vendorDeptData: updated } }));
					}
					return updated;
				});
			} catch (err) {
				console.error('[VendorDeptModule] Error syncing PSIR batchNo:', err);
			}
		};
		
		bus.addEventListener('psirData.updated', handlePSIRUpdate as EventListener);
		
		return () => {
			bus.removeEventListener('psirData.updated', handlePSIRUpdate as EventListener);
		};
	}, []);

	// When clearing the form after add/update, also set next DC No
	const clearNewOrder = () => {
		setNewOrder({
			orderPlaceDate: '',
			materialPurchasePoNo: '',
			oaNo: '',
			batchNo: '',
			vendorBatchNo: '',
			dcNo: '',
			vendorName: '', // Always default to empty string
			items: [],
		});
		setItemInput({ itemName: '', itemCode: '', materialIssueNo: '', qty: 0, closingStock: '', indentStatus: '', receivedQty: 0, okQty: 0, reworkQty: 0, rejectedQty: 0, grnNo: '', debitNoteOrQtyReturned: '', remarks: '' });
	};

	// Preview sync report: list items that would be changed
	const previewVendorDeptSync = () => {
		const raw = localStorage.getItem('vendorDeptData');
		if (!raw) return [];
		const vd = JSON.parse(raw) as VendorDeptOrder[];
		const report: any[] = [];
		vd.forEach((order, oIdx) => {
			(order.items || []).forEach((it, iIdx) => {
				const purchaseQty = getPurchaseQty(order.materialPurchasePoNo, it.itemCode) || 0;
				report.push({ po: order.materialPurchasePoNo, itemCode: it.itemCode, currentQty: it.qty, purchaseQty, orderIdx: oIdx, itemIdx: iIdx });
			});
		});
		console.log('[VendorDeptModule][PreviewSync] report:', report);
		return report;
	};

	// Build a human-friendly debug report indicating where values come from
	const buildDebugReport = () => {
		const raw = localStorage.getItem('vendorDeptData');
		const psirRaw = localStorage.getItem('psirData');
		const purchaseDataRaw = localStorage.getItem('purchaseData');
		const vendorData = raw ? JSON.parse(raw) as VendorDeptOrder[] : [];
		// const pos = purchaseOrdersRaw ? JSON.parse(purchaseOrdersRaw) : []; // unused

		const psirs = psirRaw ? JSON.parse(psirRaw) : [];
		const pd = purchaseDataRaw ? JSON.parse(purchaseDataRaw) : [];
		const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
		const report: any[] = [];
		vendorData.forEach((order, oIdx) => {
			(order.items || []).forEach((it, iIdx) => {
				const poNo = order.materialPurchasePoNo;
				const code = it.itemCode;
				const purchaseQty = getPurchaseQty(poNo, code) || 0;
				let psirQty = 0;
				for (const psir of psirs) {
					if (norm(psir.poNo) === norm(poNo) && Array.isArray(psir.items)) {
						const m = psir.items.find((x: any) => norm(x.itemCode) === norm(code));
						if (m) { psirQty = Number(m.qtyReceived || 0); break; }
					}
				}
				let inferred = 'manual';
				let matchedSource: string | null = null;
				let matchedDetails: any = null;
				if (purchaseQty > 0 && Number(it.qty) === purchaseQty) { inferred = 'purchase'; matchedSource = 'purchase'; matchedDetails = { purchaseQty }; }
				else if (psirQty > 0 && Number(it.receivedQty) === psirQty) { inferred = 'psir'; matchedSource = 'psir'; matchedDetails = { psirQty }; }
				else if (!it.qty || Number(it.qty) === 0) { inferred = 'empty'; }
				const pdMatchEntry = (pd || []).find((x: any) => (norm(x.poNo) === norm(poNo) || norm(x.indentNo) === norm(poNo)) && norm(x.itemCode || x.Code) === norm(code));
				const poMatch = (() => {
					try {
						const purchaseOrdersRaw = localStorage.getItem('purchaseOrders');
						if (!purchaseOrdersRaw) return null;
						const pos = JSON.parse(purchaseOrdersRaw);
						if (!Array.isArray(pos)) return null;
						const poEntry = pos.find((p: any) => norm(p.poNo) === norm(poNo) || norm(p.poNo || p.indentNo) === norm(poNo));
						if (!poEntry) return null;
						if (Array.isArray(poEntry.items)) return poEntry.items.find((it2: any) => norm(it2.itemCode || it2.Code) === norm(code)) || null;
						return (norm(poEntry.itemCode || poEntry.Code) === norm(code)) ? poEntry : null;
					} catch { return null; }
				})();
				report.push({ po: poNo, itemCode: code, currentQty: it.qty, purchaseQty, psirQty, pdMatch: !!pdMatchEntry, poMatch, pdMatchEntry, inferredSource: inferred, matchedSource, matchedDetails, orderIdx: oIdx, itemIdx: iIdx });
			});
		});
		setDebugReport(report);
		console.log('[VendorDeptModule][DebugReport]', report);
		return report;
	};

	// Stock debug panel state & builder
	const [stockDebugOpen, setStockDebugOpen] = useState(false);
	const [stockDebugReport, setStockDebugReport] = useState<any[]>([]);

	const buildStockDebugReport = () => {
		const stockRaw = localStorage.getItem('stock-records');
		const stocks = stockRaw ? JSON.parse(stockRaw) : [];
		const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
		const alpha = (v: any) => norm(v).replace(/[^A-Z0-9]/g, '');
		const report: any[] = [];
		(orders || []).forEach((order, oIdx) => {
			(order.items || []).forEach((it, iIdx) => {
				const lookupVals = [it.itemCode, it.itemName].filter(Boolean).join(' ');
				const target = norm(lookupVals);
				const targetAlpha = alpha(lookupVals);
				let matchedRecord: any = null;
				let matchedBy = 'none';
				// exact alpha/norm match
				matchedRecord = stocks.find((s: any) => {
					const candidates = [s.itemCode, s.ItemCode, s.code, s.Code, s.item_code, s.itemName, s.ItemName, s.name, s.Name, s.sku, s.SKU];
					return candidates.some(c => alpha(c) === targetAlpha || norm(c) === target);
				});
				if (matchedRecord) matchedBy = 'exact';
				else {
					matchedRecord = stocks.find((s: any) => {
						return Object.values(s).some((v: any) => {
							try {
							const a = alpha(v);
							const n = norm(v);
							return a.includes(targetAlpha) || targetAlpha.includes(a) || n.includes(target) || target.includes(n);
						} catch { return false; }
						});
					});
					if (matchedRecord) matchedBy = 'contains';
				}
				// If multiple matches potentially apply, pick the best candidate deterministically
			if (matchedRecord) {
				const combinedMatches = stocks.filter((s: any) => {
					const candidates = [s.itemCode, s.ItemCode, s.code, s.Code, s.item_code, s.itemName, s.ItemName, s.name, s.Name, s.sku, s.SKU];
					const exact = candidates.some(c => alpha(c) === targetAlpha || norm(c) === target);
					if (exact) return true;
					try {
						return Object.values(s).some((v: any) => {
							const a = alpha(v);
							const n = norm(v);
							return a.includes(targetAlpha) || targetAlpha.includes(a) || n.includes(target) || target.includes(n);
						});
					} catch { return false; }
				});
				if (combinedMatches.length > 1) {
					matchedRecord = chooseBestStock(combinedMatches);
				}
			}
			const closingKey = matchedRecord ? findNumericField(matchedRecord, ['closingStock','closing_stock','ClosingStock','closing','closingQty','closing_qty','Closing','closing stock','Closing Stock','closingstock','closingStockQty','closing_stock_qty','ClosingStockQty','closingstockqty']) : null;
			const closingStock = closingKey ? closingKey.value : null;
				const stockQty = matchedRecord ? getNumericField(matchedRecord, ['stockQty','stock_qty','stock','StockQty','currentStock']) : null;
				const purchaseActualQtyInStore = matchedRecord ? getNumericField(matchedRecord, ['purchaseActualQtyInStore','purchase_actual_qty_in_store','purchaseActualQty','purchase_actual_qty','purchaseActualQtyInStore']) : null;
				const computed = (closingStock !== null ? closingStock : ((stockQty || 0) + (purchaseActualQtyInStore || 0)));
				report.push({ po: order.materialPurchasePoNo, orderIdx: oIdx, itemIdx: iIdx, itemCode: it.itemCode, itemName: it.itemName, matched: !!matchedRecord, matchedBy, matchedRecord, closingStock, closingKey: closingKey ? closingKey.key : null, closingRaw: closingKey ? closingKey.raw : null, stockQty, purchaseActualQtyInStore, computed });
			});
		});
		setStockDebugReport(report);
		console.log('[VendorDeptModule][StockDebug]', report);
		return report;
	};

	// Non-destructive sync: only fill empty qty values
	const syncEmptyVendorDeptQty = () => {
		if (orders.length === 0) return;
		let changed = false;
		const updated = orders.map(order => ({
			...order,
			items: (order.items || []).map(it => {
				const p = getPurchaseQty(order.materialPurchasePoNo, it.itemCode, purchaseOrders, purchaseData) || 0;
				if ((!it.qty || Number(it.qty) === 0) && p > 0) {
					changed = true;
					return { ...it, qty: p };
				}
				return it;
			})
		}));
		if (changed) {
			setOrders(updated);
			console.log('[VendorDeptModule] Sync Empty Qty applied');
		} else {
			console.log('[VendorDeptModule] No empty qty items to sync');
		}
	};

	// Force sync: overwrite all qty where purchase data exists
	const forceVendorDeptSync = () => {
		if (orders.length === 0) return;
		let changed = false;
		const updated = orders.map(order => ({
			...order,
			items: (order.items || []).map(it => {
				const p = getPurchaseQty(order.materialPurchasePoNo, it.itemCode, purchaseOrders, purchaseData) || 0;
				if (p > 0 && Number(it.qty) !== p) {
					changed = true;
					return { ...it, qty: p };
				}
				return it;
			})
		}));
		if (changed) {
			setOrders(updated);
			console.log('[VendorDeptModule] Force Sync applied');
		} else {
			console.log('[VendorDeptModule] No items required force sync');
		}
	};

	// CRITICAL FIX: Remove any code that writes to purchaseOrders
	// This module should ONLY read from purchaseOrders and write to vendorDeptData

	// Return the stock total for an item. Prefer `closingStock` if present in stock-records.
	// Accepts itemCode or itemName (fallback) to improve matching when one is missing.
	const getStockTotal = (itemCode?: string, itemName?: string): number => {
		try {
			if (!itemCode && !itemName) return 0;
			const lookup = (itemCode || itemName || '');
			const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
			const alpha = (v: any) => norm(v).replace(/[^A-Z0-9]/g, ''); // remove punctuation/spaces for robust matching
			const target = norm(lookup);
			const targetAlpha = alpha(lookup);
			const stockRaw = localStorage.getItem('stock-records');
			const stocks = stockRaw ? JSON.parse(stockRaw) : [];
			if (!Array.isArray(stocks)) return 0;

			// Try strict matches before fuzzy match: prefer exact code, then exact name, then exact normalized, then contains
			let stock: any = null;
			const codeNorm = norm(itemCode || '');
			const nameNorm = norm(itemName || '');
			if (codeNorm) {
				const matches = stocks.filter((s: any) => { try { return norm(s.itemCode || s.ItemCode || s.code || s.Code || s.item_code) === codeNorm; } catch { return false; } });
				if (matches.length > 0) { stock = chooseBestStock(matches); if (stock) console.debug('[VendorDeptModule] getStockTotal code-exact match', codeNorm, stock); }
			}
			if (!stock && nameNorm) {
				const matches = stocks.filter((s: any) => { try { return norm(s.itemName || s.ItemName || s.name || s.Name) === nameNorm; } catch { return false; } });
				if (matches.length > 0) { stock = chooseBestStock(matches); if (stock) console.debug('[VendorDeptModule] getStockTotal name-exact match', nameNorm, stock); }
			}
			if (!stock) {
				const matches = stocks.filter((s: any) => {
					const candidates = [s.itemCode, s.ItemCode, s.code, s.Code, s.item_code, s.itemName, s.ItemName, s.name, s.Name, s.sku, s.SKU];
					return candidates.some(c => alpha(c) === targetAlpha || norm(c) === target);
				});
				if (matches.length > 0) { stock = chooseBestStock(matches); if (stock) console.debug('[VendorDeptModule] getStockTotal exact normalized match', target, stock); }
			}
			if (!stock) {
				const matches = stocks.filter((s: any) => {
					return Object.values(s).some((v: any) => {
						try {
							const a = alpha(v);
							const n = norm(v);
							return a.includes(targetAlpha) || targetAlpha.includes(a) || n.includes(target) || target.includes(n);
						} catch { return false; }
					});
				});
				if (matches.length > 0) { stock = chooseBestStock(matches); if (stock) console.debug('[VendorDeptModule] getStockTotal contains match', target, stock); }
			}
        if (!stock) {
            console.debug('[VendorDeptModule] getStockTotal: no matching stock for', itemCode);
            return 0;
        }
			// Helper to pick numeric fields by common key names

			// Prefer closing stock using common possible field names
			const closingStock = getNumericField(stock, ['closingStock', 'closing_stock', 'ClosingStock', 'closing', 'closingQty', 'closing_qty', 'Closing','closing stock','Closing Stock','closingstock','closingStockQty','closing_stock_qty','ClosingStockQty','closingstockqty']);
			if (closingStock !== null) return closingStock;

			const stockQty = getNumericField(stock, ['stockQty', 'stock_qty', 'stock', 'StockQty', 'currentStock']) || 0;
			const purchaseActualQtyInStore = getNumericField(stock, ['purchaseActualQtyInStore', 'purchase_actual_qty_in_store', 'purchaseActualQty', 'purchase_actual_qty', 'purchaseActualQtyInStore']) || 0;
			const sQty = (stockQty || 0);
			const pQty = (purchaseActualQtyInStore || 0);
			return sQty + pQty;
		} catch (err) {
			console.error('[VendorDeptModule] getStockTotal error', err);
			return 0;
		}
	};
	void getStockTotal;

	// Return the Closing Stock (or computed fallback) for the matched stock record, using the same logic as the stock debug
	const getClosingStock = (itemCode?: string, itemName?: string): number | string => {
		try {
			if (!itemCode && !itemName) return '';
			// Use combined lookup (code + name) to match like buildStockDebugReport
			const lookup = [itemCode, itemName].filter(Boolean).join(' ');
			const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
			const alpha = (v: any) => norm(v).replace(/[^A-Z0-9]/g, '');
			const target = norm(lookup);
			const targetAlpha = alpha(lookup);
			const stockRaw = localStorage.getItem('stock-records');
			const stocks = stockRaw ? JSON.parse(stockRaw) : [];
			if (!Array.isArray(stocks)) return '';

			let matchedRecord: any = null;
			let matchedBy = 'none';
			void matchedBy;
			const codeNorm = norm(itemCode || '');
			const nameNorm = norm(itemName || '');
// Prefer exact itemCode match (choose best)
		if (codeNorm && !matchedRecord) {
			const matches = stocks.filter((s: any) => { try { return norm(s.itemCode || s.ItemCode || s.code || s.Code || s.item_code) === codeNorm; } catch { return false; } });
			if (matches.length > 0) { matchedRecord = chooseBestStock(matches); if (matchedRecord) matchedBy = 'code-exact'; }
		}
		// Prefer exact itemName match (choose best)
		if (nameNorm && !matchedRecord) {
			const matches = stocks.filter((s: any) => { try { return norm(s.itemName || s.ItemName || s.name || s.Name) === nameNorm; } catch { return false; } });
			if (matches.length > 0) { matchedRecord = chooseBestStock(matches); if (matchedRecord) matchedBy = 'name-exact'; }
		}
		// exact alpha/norm match first (choose best)
		{
			const matches = stocks.filter((s: any) => {
				const candidates = [s.itemCode, s.ItemCode, s.code, s.Code, s.item_code, s.itemName, s.ItemName, s.name, s.Name, s.sku, s.SKU];
				return candidates.some(c => alpha(c) === targetAlpha || norm(c) === target);
			});
			if (matches.length > 0) { matchedRecord = chooseBestStock(matches); if (matchedRecord) matchedBy = 'exact'; }
		}
		// fallback to contains
		if (!matchedRecord) {
			const matches = stocks.filter((s: any) => {
				return Object.values(s).some((v: any) => {
					try {
						const a = alpha(v);
						const n = norm(v);
						return a.includes(targetAlpha) || targetAlpha.includes(a) || n.includes(target) || target.includes(n);
					} catch { return false; }
				});
			});
			if (matches.length > 0) { matchedRecord = chooseBestStock(matches); if (matchedRecord) matchedBy = 'contains'; }
			}

			if (!matchedRecord) return '';


			const closingKey = findNumericField(matchedRecord, ['closingStock', 'closing_stock', 'ClosingStock', 'closing', 'closingQty', 'closing_qty', 'Closing','closing stock','Closing Stock','closingstock','closingStockQty','closing_stock_qty','ClosingStockQty','closingstockqty']);
			const closingStock = closingKey ? closingKey.value : null;
			const stockQty = getNumericField(matchedRecord, ['stockQty', 'stock_qty', 'stock', 'StockQty', 'currentStock']) || 0;
			const purchaseActualQtyInStore = getNumericField(matchedRecord, ['purchaseActualQtyInStore', 'purchase_actual_qty_in_store', 'purchaseActualQty', 'purchase_actual_qty', 'purchaseActualQtyInStore']) || 0;
			const computed = (closingStock !== null ? closingStock : (stockQty + purchaseActualQtyInStore));
			return computed;
		} catch (err) {
			console.error('[VendorDeptModule] getClosingStock error', err);
			return '';
		}
	};

	return (
		<div>
			<div>
				<h2>Vendor Dept Module</h2>
				<div style={{ marginBottom: 16, padding: 12, background: '#e8f5e8', border: '1px solid #4caf50', borderRadius: 6 }}>
					<h3>Import Purchase Orders to Vendor Dept</h3>
					<div style={{ marginBottom: 12, fontSize: '14px', lineHeight: 1.6 }}>
						<div><strong>Status:</strong></div>
						<div>📋 Purchase Orders Loaded: <span style={{ fontWeight: 'bold', color: purchaseOrders.length > 0 ? '#4caf50' : '#999' }}>{purchaseOrders.length}</span></div>
						<div>📋 Purchase Data Loaded: <span style={{ fontWeight: 'bold', color: purchaseData.length > 0 ? '#4caf50' : '#999' }}>{purchaseData.length}</span></div>
						<div>📦 Vendor Dept Records: <span style={{ fontWeight: 'bold' }}>{entries.length}</span></div>
						<div>👤 User: <span style={{ fontWeight: 'bold', color: userUid ? '#4caf50' : '#f44336' }}>{userUid ? '✓ Logged in' : '✗ Not authenticated'}</span></div>
					</div>
					<p style={{ marginBottom: 8, fontSize: '13px', color: '#666' }}>
						{purchaseOrders.length === 0 && purchaseData.length === 0 ? '⚠️ No purchase orders or data loaded yet' : `Ready to import ${Math.max(purchaseOrders.length, purchaseData.length)} records`}
					</p>
					<button 
						onClick={() => importPurchaseOrdersToVendorDept()}
						disabled={(purchaseOrders.length === 0 && purchaseData.length === 0) || !userUid}
						style={{ 
							padding: '8px 16px', 
							backgroundColor: (purchaseOrders.length === 0 && purchaseData.length === 0) || !userUid ? '#ccc' : '#4caf50', 
							color: 'white', 
							border: 'none', 
							borderRadius: 4, 
							cursor: (purchaseOrders.length === 0 && purchaseData.length === 0) || !userUid ? 'not-allowed' : 'pointer',
							fontWeight: 600
						}}
					>
						Import Purchase Orders to Vendor Dept
					</button>
				</div>
				<div style={{ marginBottom: 16, display: 'flex', gap: 8, background: '#ffffcc', padding: 12, borderRadius: 4, border: '1px solid #ffcc00' }}>
					<button onClick={() => {
						const poNo = newOrder.materialPurchasePoNo;
						
						// Check purchase orders
						const purchaseOrdersRaw = localStorage.getItem('purchaseOrders');
						const purchaseOrders = purchaseOrdersRaw ? JSON.parse(purchaseOrdersRaw) : [];
						
						// Check PSIR data
						const psirDataRaw = localStorage.getItem('psirData');
						const psirData = psirDataRaw ? JSON.parse(psirDataRaw) : [];

						// Check VSIR data
						const vsirRaw = localStorage.getItem('vsri-records');
						const vsirData = vsirRaw ? JSON.parse(vsirRaw) : [];
						
						// Find matching records
						let matchingPO = null;
						let matchingPSIR = null;
						let matchingVSIR = null;
						if (poNo) {
							matchingPO = purchaseOrders.find((p: any) => p.poNo === poNo);
							matchingPSIR = psirData.find((p: any) => p.poNo === poNo);
							matchingVSIR = vsirData.find((v: any) => v.poNo === poNo);
						}
						
						const report = [
							{ label: 'Selected PO No', value: poNo || 'None' },
							{ label: 'PurchaseOrders Count', value: purchaseOrders.length },
							{ label: 'PSIR Records Count', value: psirData.length },
							{ label: 'VSIR Records Count', value: vsirData.length },
							{ label: 'Matching PO Found', value: matchingPO ? '✓ YES' : '✗ NO' },
							{ label: 'Matching PO OA NO', value: matchingPO?.oaNo || 'empty' },
							{ label: 'Matching PSIR Found', value: matchingPSIR ? '✓ YES' : '✗ NO' },
							{ label: 'Matching PSIR OA NO', value: matchingPSIR?.oaNo || 'empty' },
							{ label: 'Matching PSIR Batch No', value: matchingPSIR?.batchNo || 'empty' },
							{ label: 'Matching VSIR Found', value: matchingVSIR ? '✓ YES' : '✗ NO' },
							{ label: 'Matching VSIR Vendor Batch No', value: matchingVSIR?.vendorBatchNo || 'empty' },
							{ label: 'Current Form OA NO', value: newOrder.oaNo || 'empty' },
							{ label: 'Current Form Batch No', value: newOrder.batchNo || 'empty' },
						];
						
						console.log('=== VENDOR DEPT DEBUG ===');
						console.log('Purchase Orders:', purchaseOrders);
						console.log('PSIR Data:', psirData);
						console.log('VSIR Data:', vsirData);
						console.log('Matching PO:', matchingPO);
						console.log('Matching PSIR:', matchingPSIR);
						console.log('Matching VSIR:', matchingVSIR);
						console.log('Current newOrder:', newOrder);
						
						setDebugReport(report);
						setDebugOpen(!debugOpen);
					}} style={{ padding: '8px 12px', background: '#ff6b6b', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold' }}>
						🔍 Debug {debugOpen ? '▼' : '▶'}
					</button>
					<button onClick={() => regenerateVendorBatchNos()} style={{ padding: '8px 12px', background: '#4caf50', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold' }}>
						🔄 Regenerate Vendor Batch Nos
					</button>
					<button onClick={() => syncBatchNoFromPSIR()} style={{ padding: '8px 12px', background: '#2196f3', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold' }}>
						📥 Sync Batch No from PSIR
					</button>
				</div>
				
				{debugOpen && (
					<div style={{ marginBottom: 16, background: '#f0f0f0', padding: 12, borderRadius: 4, border: '1px solid #ccc' }}>
						<h4>Debug Report</h4>
						<table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
							<tbody>
								{debugReport.map((row, idx) => (
									<tr key={idx} style={{ borderBottom: '1px solid #ddd' }}>
										<td style={{ padding: 6, fontWeight: 'bold', width: '50%' }}>{row.label}:</td>
										<td style={{ padding: 6, background: row.value === 'empty' || row.value === '✗ NO' || row.value === '0' ? '#ffcccc' : '#ccffcc', fontFamily: 'monospace' }}>
											{String(row.value)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				
				<div style={{ marginBottom: 16, display: 'none', gap: 8, alignItems: 'center' }}>
					<label>Material Purchase PO No:</label>
					<select
						value={newOrder.materialPurchasePoNo}
						onChange={e => setNewOrder({ ...newOrder, materialPurchasePoNo: e.target.value })}
						style={{ padding: '6px', border: '1px solid #ccc', borderRadius: 4 }}
					>
						<option value="">Select PO No</option>
						{purchasePOs.map(po => <option key={po} value={po}>{po}</option>)}
					</select>
				</div>
				<div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
					<label>Order Place Date (from PSIR):</label>
					<input type="text" value={newOrder.orderPlaceDate} readOnly style={{ padding: '6px', border: '1px solid #ccc', borderRadius: 4, background: '#f0f0f0' }} />
					<label>OA NO:</label>
					<input type="text" value={newOrder.oaNo} readOnly style={{ padding: '6px', border: '1px solid #ccc', borderRadius: 4, background: '#f0f0f0' }} />
					<label>Batch No:</label>
					<input type="text" value={newOrder.batchNo} readOnly style={{ padding: '6px', border: '1px solid #ccc', borderRadius: 4, background: '#f0f0f0' }} />
					<label>Vendor Batch No:</label>
					<input
						type="text"
						placeholder="Enter or auto-filled from VSIR"
						value={newOrder.vendorBatchNo}
						onChange={(e) => setNewOrder({ ...newOrder, vendorBatchNo: e.target.value })}
						style={{ padding: '6px', border: '1px solid #ccc', borderRadius: 4 }}
					/>
					<label>Vendor Name (Enter manually):</label>
					<input
						type="text"
						placeholder="Enter Vendor Name"
						value={newOrder.vendorName}
						onChange={e => setNewOrder({ ...newOrder, vendorName: e.target.value })}
						style={{ fontWeight: 'bold', background: '#fff', width: 200, border: '2px solid #1976d2', color: '#1976d2', padding: '6px' }}
					/>
				</div>
				<div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
					<label>DC No (Enter manually):</label>
					<input
						type="text"
						placeholder="Enter DC No manually"
						value={newOrder.dcNo}
						onChange={e => setNewOrder({ ...newOrder, dcNo: e.target.value })}
						style={{ fontWeight: 'bold', background: '#fff', width: 160, border: '2px solid #1976d2', color: '#1976d2' }}
					/>
				</div>

				<div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
					<label>Item Name:</label>
					{itemNames.length > 0 ? (
						<select
							name="itemName"
							value={itemInput.itemName}
							onChange={e => {
								const value = e.target.value;
								const found = itemMaster.find(item => item.itemName === value);
								const foundCode = found ? found.itemCode : '';
								const inferredQty = getPurchaseQty(newOrder.materialPurchasePoNo, foundCode) || itemInput.qty;
								setItemInput({ ...itemInput, itemName: value, itemCode: foundCode, qty: inferredQty, closingStock: getClosingStock(foundCode, value) });
							}}
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
							onChange={e => setItemInput({ ...itemInput, itemName: e.target.value })}
						/>
					)}
					<input placeholder="Item Code" value={itemInput.itemCode} onChange={e => setItemInput({ ...itemInput, itemCode: e.target.value })} readOnly={itemNames.length > 0} />
					<input placeholder="Material Issue No" value={itemInput.materialIssueNo} onChange={e => setItemInput({ ...itemInput, materialIssueNo: e.target.value })} />
					<input type="number" placeholder="Qty" value={itemInput.qty || ''} onChange={e => setItemInput({ ...itemInput, qty: Number(e.target.value) })} />
					<select value={itemInput.indentStatus} onChange={e => setItemInput({ ...itemInput, indentStatus: e.target.value })} >
						<option value="">Indent Status</option>
						{indentStatusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
					</select>
					<input type="number" placeholder="Received Qty" value={itemInput.receivedQty || ''} onChange={e => setItemInput({ ...itemInput, receivedQty: Number(e.target.value) })} />
					<input type="number" placeholder="OK Qty" value={itemInput.okQty || ''} onChange={e => setItemInput({ ...itemInput, okQty: Number(e.target.value) })} />
					<input type="number" placeholder="Rework Qty" value={itemInput.reworkQty || ''} onChange={e => setItemInput({ ...itemInput, reworkQty: Number(e.target.value) })} />
					<input type="number" placeholder="Rejected Qty" value={itemInput.rejectedQty || ''} onChange={e => setItemInput({ ...itemInput, rejectedQty: Number(e.target.value) })} />
					<input placeholder="GRN No" value={itemInput.grnNo} onChange={e => setItemInput({ ...itemInput, grnNo: e.target.value })} />
					<input placeholder="Debit Note or Qty Returned" value={itemInput.debitNoteOrQtyReturned} onChange={e => setItemInput({ ...itemInput, debitNoteOrQtyReturned: e.target.value })} />
					<input placeholder="Remarks" value={itemInput.remarks} onChange={e => setItemInput({ ...itemInput, remarks: e.target.value })} />
					<button onClick={handleSaveItem}>
						{editIdx ? 'Update Item' : 'Add Item'}
					</button>
				</div>

				<button onClick={editOrderIdx !== null ? handleUpdateOrder : handleAddOrder}>
					{editOrderIdx !== null ? 'Update Vendor Dept Order' : 'Add Vendor Dept Order'}
				</button>
				{editOrderIdx !== null && (
					<button onClick={() => {
						clearNewOrder();
						setEditOrderIdx(null);
					}} style={{ background: '#757575', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 16px', cursor: 'pointer', marginLeft: 8 }}>
						Cancel
					</button>
				)}
				<h3>Vendor Dept Orders</h3>
				<div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
						<button
							onClick={() => {
								// Preview what would change if we sync empty vendor qty from purchase
								try {
									const rawV = localStorage.getItem('vendorDeptData');
									if (!rawV) { alert('No Vendor Dept data'); return; }
									const vendor = JSON.parse(rawV) as any[];
									const preview = vendor.map(v => ({
										vendorId: v.vendorId,
										items: (v.items || []).map((it: any) => {
											const existing = Number(it.qty || 0) || 0;
											const pq = getPurchaseQty(v.poNo, it.itemCode) || 0;
											return { itemCode: it.itemCode, existing, purchaseQty: pq, wouldUpdate: existing === 0 && pq > 0 };
										})
									}));
									const small = preview.filter(p => p.items.some((i:any)=>i.wouldUpdate));
									if (small.length === 0) { alert('Preview: no items would be updated'); return; }
									// show limited preview
									const lines: string[] = [];
									for (const p of small) {
										for (const it of p.items.filter((x:any)=>x.wouldUpdate)) {
											lines.push(`${p.vendorId} • ${it.itemCode} : ${it.existing} -> ${it.purchaseQty}`);
										}
									}
									alert('Preview updates:\n' + lines.join('\n'));
								} catch (err) { alert('Error during preview: ' + String(err)); }
							}}
							style={{ padding: '6px 8px' }}
						>Preview Sync</button>

						<button
							onClick={() => {
								// Non-destructive sync: fill empty vendor.qty from purchase
								if (!confirm('Fill empty Vendor Dept qty values from Purchase PO (non-destructive)?')) return;
								try {
									const rawV = localStorage.getItem('vendorDeptData');
									if (!rawV) { alert('No Vendor Dept data'); return; }
									const vendor = JSON.parse(rawV) as any[];
									let changed = 0;
									const updated = vendor.map(v => ({
										...v,
										items: (v.items || []).map((it: any) => {
											const existing = Number(it.qty || 0) || 0;
											const pq = getPurchaseQty(v.poNo, it.itemCode) || 0;
											if (existing === 0 && pq > 0) { changed++; return { ...it, qty: pq }; }
											return it;
										})
									}));
									if (changed > 0) {
										localStorage.setItem('vendorDeptData', JSON.stringify(updated));
										try { bus.dispatchEvent(new CustomEvent('vendorDept.updated', { detail: { vendorDeptData: updated } })); } catch (err) {}
										setOrders(updated);
										alert(`Sync applied: updated ${changed} vendor items' qty`);
									} else {
										alert('No items needed syncing');
									}
								} catch (err) { alert('Error during sync: ' + String(err)); }
							}}
							style={{ padding: '6px 8px' }}
						>Sync Empty</button>

						<button
							onClick={() => {
								if (!confirm('Force overwrite ALL vendor qty from Purchase PO (destructive). This cannot be undone. Proceed?')) return;
								try {
									const rawV = localStorage.getItem('vendorDeptData');
									if (!rawV) { alert('No Vendor Dept data'); return; }
									const vendor = JSON.parse(rawV) as any[];
									let changed = 0;
									const updated = vendor.map(v => ({
										...v,
										items: (v.items || []).map((it: any) => {
											const pq = getPurchaseQty(v.poNo, it.itemCode) || 0;
											if ((Number(it.qty || 0) || 0) !== pq) { changed++; return { ...it, qty: pq }; }
											return it;
										})
									}));
									if (changed > 0) {
										localStorage.setItem('vendorDeptData', JSON.stringify(updated));
										try { bus.dispatchEvent(new CustomEvent('vendorDept.updated', { detail: { vendorDeptData: updated } })); } catch (err) {}
										setOrders(updated);
										alert(`Force sync applied: overwrote ${changed} vendor items' qty`);
									} else {
										alert('No differences found; nothing overwritten');
									}
								} catch (err) { alert('Error during force sync: ' + String(err)); }
							}}
							style={{ padding: '6px 8px' }}
						>Force Sync</button>
					<button onClick={() => { const r = previewVendorDeptSync(); alert(`Preview items: ${r.length}`); console.log('[VendorDeptModule] Preview:', r); }} style={{ padding: '6px 10px' }}>Preview Sync</button>
					<button onClick={() => { syncEmptyVendorDeptQty(); alert('Sync Empty Qty completed'); }} style={{ padding: '6px 10px' }}>Sync Empty Qty</button>
					<button onClick={() => { if (confirm('Force sync will overwrite qty values where purchase data exists. Continue?')) { forceVendorDeptSync(); alert('Force Sync completed'); } }} style={{ padding: '6px 10px', background: '#e53935', color: '#fff' }}>Force Sync</button>
					<button onClick={() => { setDebugOpen(prev => !prev); if (!debugOpen) buildDebugReport(); }} style={{ padding: '6px 10px' }}>{debugOpen ? 'Hide Debug' : 'Show Debug'}</button>
				<button onClick={() => { setStockDebugOpen(prev => !prev); if (!stockDebugOpen) buildStockDebugReport(); }} style={{ padding: '6px 10px' }}>{stockDebugOpen ? 'Hide Stock Debug' : 'Show Stock Debug'}</button>
				</div>
				{stockDebugOpen && (
				<div style={{ marginBottom: 12, border: '1px solid #ccc', padding: 8, background: '#fffef0' }}>
					<h4>Debug: Stock Matching</h4>
					<p style={{ margin: 0, marginBottom: 8 }}>Rows: {stockDebugReport.length}</p>
					<table border={1} cellPadding={6} style={{ width: '100%', marginBottom: 8 }}>
						<thead>
							<tr>
								<th>PO</th>
								<th>Item Code</th>
								<th>Item Name</th>
								<th>Matched</th>
								<th>Matched By</th>
								<th>Closing Stock</th>
								<th>Computed Stock</th>
								<th>Closing Key</th>
						<th>Closing Raw</th>
						<th>Matched Record (JSON)</th>
							</tr>
						</thead>
						<tbody>
							{stockDebugReport.map((r, i) => (
								<tr key={i}>
									<td>{r.po}</td>
									<td>{r.itemCode}</td>
									<td>{r.itemName}</td>
									<td>{r.matched ? 'Yes' : 'No'}</td>
									<td>{r.matchedBy}</td>
									<td>{r.closingStock ?? ''}</td>
									<td>{r.computed}</td>
						<td>{r.closingKey ?? ''}</td>
						<td>{r.closingRaw ?? ''}</td>
									<td style={{ maxWidth: 400 }}><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(r.matchedRecord || {}, null, 2)}</pre></td>
								</tr>
							))}
						</tbody>
					</table>
					<div style={{ display: 'flex', gap: 8 }}>
						<button onClick={() => { const r = buildStockDebugReport(); alert(`Refreshed stock debug entries: ${r.length}`); }} style={{ padding: '6px 10px' }}>Refresh Stock Debug</button>
						<button onClick={() => { setStockDebugReport([]); setStockDebugOpen(false); }} style={{ padding: '6px 10px' }}>Close Stock Debug</button>
					</div>
				</div>
			)}
			{debugOpen && (
					<div style={{ marginBottom: 12, border: '1px solid #ccc', padding: 8, background: '#fafafa' }}>
						<h4>Debug: Vendor Dept Data Sources</h4>
						<p style={{ margin: 0, marginBottom: 8 }}>Rows: {debugReport.length}</p>
						<table border={1} cellPadding={6} style={{ width: '100%', marginBottom: 8 }}>
							<thead>
								<tr>
									<th>PO Qty</th>
									<th>Item Code</th>
									<th>Current Qty</th>
									<th>Purchase Qty</th>
									<th>PSIR Received</th>
									<th>purchaseData Match</th>
									<th>Inferred Source</th>
								</tr>
							</thead>
							<tbody>
								{debugReport.map((r, i) => (
									<tr key={i}>
										<td>{r.po}</td>
										<td>{r.itemCode}</td>
										<td>{r.currentQty}</td>
										<td>{r.purchaseQty}</td>
										<td>{r.psirQty}</td>
										<td>{r.pdMatch ? 'Yes' : 'No'}</td>
										<td>{r.inferredSource}</td>
									</tr>
								))}
							</tbody>
						</table>
						<button onClick={() => { const r = buildDebugReport(); alert(`Refreshed debug entries: ${r.length}`); }} style={{ padding: '6px 10px' }}>Refresh Debug</button>
						<button onClick={() => { setDebugReport([]); setDebugOpen(false); }} style={{ padding: '6px 10px' }}>Close Debug</button>
					</div>
				)}
				<table border={1} cellPadding={6} style={{ width: '100%', marginBottom: 16 }}>
					<thead>
						<tr>
							<th>Order Place Date</th>
							<th>Material Purchase PO No</th>
							<th>OA NO</th>
							<th>Batch No</th>
							<th>Vendor Batch No</th>
							<th>DC No</th>
							<th>Vendor Name</th>
							<th>Item Name</th>
							<th>Item Code</th>
							<th>Material Issue No</th>
							<th>Qty</th>
							<th>Indent Status</th>
							<th>Closing Stock</th>
							<th>Rejected Qty</th>
							<th>Received Qty</th>
							<th>OK Qty</th>
							<th>Rework Qty</th>
							<th>GRN No</th>
							<th>Debit Note or Qty Returned</th>
							<th>Remarks</th>
							<th>Edit</th>
							<th>Delete</th>
						</tr>
					</thead>
					<tbody>
						{orders.map((order, idx) => {
							if (order.items.length === 0) {
								return (
									<tr key={idx}>
										<td>{order.orderPlaceDate}</td>
										<td>{order.materialPurchasePoNo}</td>
										<td>{order.oaNo}</td>
										<td>{order.batchNo}</td>
										<td>{order.vendorBatchNo}</td>
										<td>{order.dcNo}</td>
										<td>{order.vendorName}</td>
										<td colSpan={13} style={{ textAlign: 'center', color: '#888' }}>(No items)</td>
										<td><button style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }} onClick={() => handleEditOrder(idx)}>Edit</button></td>
										<td><button onClick={() => {
											setOrders(prevOrders => {
												const updatedOrders = prevOrders.filter((_, oIdx) => oIdx !== idx);
												localStorage.setItem('vendorDeptData', JSON.stringify(updatedOrders));
												return updatedOrders;
											});
										}} style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>Delete</button></td>
									</tr>
								);
							}
							return order.items.map((item, i) => (
								<tr key={`${idx}-${i}`}>
									<td>{order.orderPlaceDate}</td>
									<td>{order.materialPurchasePoNo}</td>
									<td>{order.oaNo}</td>
									<td>{order.batchNo}</td>
									<td>{order.vendorBatchNo}</td>
									<td>{order.dcNo}</td>
									<td>{order.vendorName}</td>
									<td>{item.itemName}</td>
									<td>{item.itemCode}</td>
									<td>{item.materialIssueNo}</td>
									<td>{Math.abs(item.qty)}</td>
									<td>{(() => {
										try {


	
	
	
											const purchaseStatus = getIndentStatusFromPurchase(order.materialPurchasePoNo, item.itemCode, item.materialIssueNo || '');
											return (purchaseStatus || (item.indentStatus || '')).toString().toUpperCase();
										} catch {
											return 'NO STATUS';
										}
									})()}</td>
									<td>{getClosingStock(item.itemCode, item.itemName)}</td>
									<td>{item.rejectedQty}</td>
									<td>{item.receivedQty}</td>
									<td>{item.okQty}</td>
									<td>{item.reworkQty}</td>
									<td>{item.grnNo}</td>
									<td>{item.debitNoteOrQtyReturned}</td>
									<td>{item.remarks}</td>
									<td><button style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }} onClick={() => handleEditOrder(idx)}>Edit</button></td>
									<td><button onClick={() => {
										setOrders(prevOrders => {
											const updatedOrders = prevOrders.map((o, oIdx) => {
												if (oIdx !== idx) return o;
												return { ...o, items: o.items.filter((_, itemIdx) => itemIdx !== i) };
											}).filter(o => o.items.length > 0);
											localStorage.setItem('vendorDeptData', JSON.stringify(updatedOrders));
											return updatedOrders;
										});
									}} style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>Delete</button></td>
								</tr>
							));
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
};

export default VendorDeptModule;