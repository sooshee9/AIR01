

import PSIRModule from './modules/PSIRModule';
import VSIRModule from './modules/VSIRModule';
import StockModule from './modules/StockModule';
import ItemMasterModule from './modules/ItemMasterModule';

import React from 'react';
import { useState, useEffect } from 'react';

import LoginPage from './LoginPage';
import SyncStatus from './components/SyncStatus';
import IndentModule from './modules/IndentModule';
import PurchaseModule from './modules/PurchaseModule';
import VendorDeptModule from './modules/VendorDeptModule';
import VendorIssueModule from './modules/VendorIssueModule';
import InHouseIssueModule from './modules/InHouseIssueModule';
import { ErrorBoundary } from './components/ErrorBoundary';
import './App.css';
import { useUserRole } from './hooks/useUserRole';
import { useUserDataSync } from './hooks/useUserDataSync';
import { runDataDiagnostics } from './utils/diagnostics';
import { hardResetAllData, verifyDataCleared } from './utils/firestoreServices';


function App() {
  const [activeModule, setActiveModule] = useState<'sales' | 'dc' | 'acuInventory' | 'acuInventoryDashboard' | 'purchase' | 'salesDashboard' | 'debitNote' | 'indent' | 'vendorDept' | 'vendorIssue' | 'inHouseIssue' | 'psir' | 'vsir' | 'stock' | 'itemMaster'>('purchase');
  const [user, setUser] = useState<any>(null);
  // Hook to fetch and create role/profile
  const { userProfile: _userProfile } = useUserRole(user);
  // Hook to sync user data with Firestore (on login)
  useUserDataSync(user);

  // Expose diagnostics function to window for console debugging
  useEffect(() => {
    (window as any).AcuDiagnostics = {
      runDiagnostics: runDataDiagnostics,
      help: () => {
        console.info('Available diagnostics commands:');
        console.info('  AcuDiagnostics.runDiagnostics() - Check all collections for data');
        console.info('Usage: AcuDiagnostics.runDiagnostics()');
      },
    };
    console.info('[App] Diagnostics available - type: AcuDiagnostics.runDiagnostics()');
  }, []);

  // Build modules with user prop
  const modulesWithUser: Record<string, React.ReactElement> = {
    purchase: <PurchaseModule user={user} />,
    indent: <IndentModule user={user} />,
    vendorDept: <VendorDeptModule />,
    vendorIssue: <VendorIssueModule />,
    inHouseIssue: <InHouseIssueModule />,
    psir: <PSIRModule />,
    vsir: <VSIRModule />,
    stock: <StockModule />,
    itemMaster: <ItemMasterModule />,
  };

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  return (
    <div className="erp-app" style={{ fontFamily: 'Segoe UI, Arial, sans-serif', background: '#f6f8fa', minHeight: '100vh' }}>
      <header style={{ background: '#1a237e', color: '#fff', padding: '20px 32px 8px 32px', boxShadow: '0 2px 8px #0001' }}>
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: 1, textAlign: 'center' }}>Airtech Inventory ERP System</h1>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <span style={{ fontWeight: 500, fontSize: 16 }}>{user.email}</span>
          <div style={{ marginLeft: 8 }}><SyncStatus /></div>
          <button onClick={async () => {
            if (confirm('⚠️ WARNING: This will delete ALL data except ItemMaster. Are you sure?')) {
              try {
                const resetResult = await hardResetAllData(user.uid);
                console.log('[App] Hard reset result:', resetResult);
                
                // Verify deletion
                const verifyResult = await verifyDataCleared(user.uid);
                console.log('[App] Verification result:', verifyResult);
                
                if (verifyResult.allClear) {
                  alert('✅ Hard reset completed! All data deleted except ItemMaster.\n\nRefreshing page...');
                } else {
                  alert(`⚠️ Hard reset completed but verify shows:\n${Object.entries(verifyResult.results).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nRefreshing page anyway...`);
                }
                
                window.location.reload();
              } catch (err) {
                alert('❌ Hard reset failed. Check console for details.');
                console.error('Hard reset error:', err);
              }
            }
          }} style={{ background: '#d32f2f', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', fontWeight: 500, cursor: 'pointer', fontSize: 14 }}>Hard Reset</button>
          <button onClick={() => setUser(null)} style={{ background: '#fff', color: '#1a237e', border: 'none', borderRadius: 4, padding: '6px 14px', fontWeight: 500, cursor: 'pointer' }}>Logout</button>
        </div>
      </header>
      <main style={{ maxWidth: 900, margin: '32px auto', background: '#fff', borderRadius: 8, boxShadow: '0 2px 12px #0002', padding: 32, minHeight: 400 }}>
        <ErrorBoundary>
          {modulesWithUser[activeModule]}
        </ErrorBoundary>
      </main>
      <footer style={{
        position: 'fixed',
        left: 0,
        bottom: 0,
        width: '100%',
        background: '#1a237e',
        color: '#fff',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '12px 0',
        boxShadow: '0 -2px 8px #0001',
        zIndex: 100
      }}>
  <nav style={{ display: 'flex', gap: 24, overflowX: 'auto', whiteSpace: 'nowrap', paddingBottom: 4, maxWidth: '100vw' }}>
          <button onClick={() => setActiveModule('purchase')} style={{
            background: activeModule === 'purchase' ? '#3949ab' : '#fff',
            color: activeModule === 'purchase' ? '#fff' : '#1a237e',
            border: 'none',
            borderRadius: 4,
            padding: '10px 28px',
            fontWeight: 500,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'background 0.2s, color 0.2s',
          }}>Purchase</button>
          <button onClick={() => setActiveModule('vendorDept')} style={{
            background: activeModule === 'vendorDept' ? '#3949ab' : '#fff',
            color: activeModule === 'vendorDept' ? '#fff' : '#1a237e',
            border: 'none',
            borderRadius: 4,
            padding: '10px 28px',
            fontWeight: 500,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'background 0.2s, color 0.2s',
          }}>Vendor Dept</button>
          <button onClick={() => setActiveModule('vendorIssue')} style={{
            background: activeModule === 'vendorIssue' ? '#3949ab' : '#fff',
            color: activeModule === 'vendorIssue' ? '#fff' : '#1a237e',
            border: 'none',
            borderRadius: 4,
            padding: '10px 28px',
            fontWeight: 500,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'background 0.2s, color 0.2s',
          }}>Vendor Issue</button>
          <button onClick={() => setActiveModule('inHouseIssue')} style={{
            background: activeModule === 'inHouseIssue' ? '#3949ab' : '#fff',
            color: activeModule === 'inHouseIssue' ? '#fff' : '#1a237e',
            border: 'none',
            borderRadius: 4,
            padding: '10px 28px',
            fontWeight: 500,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'background 0.2s, color 0.2s',
          }}>In House Issue</button>
          <button onClick={() => setActiveModule('indent')} style={{
            background: activeModule === 'indent' ? '#3949ab' : '#fff',
            color: activeModule === 'indent' ? '#fff' : '#1a237e',
            border: 'none',
            borderRadius: 4,
            padding: '10px 28px',
            fontWeight: 500,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'background 0.2s, color 0.2s',
          }}>Indent</button>
          <button onClick={() => setActiveModule('psir')} style={{
            background: activeModule === 'psir' ? '#3949ab' : '#fff',
            color: activeModule === 'psir' ? '#fff' : '#1a237e',
            border: 'none',
            borderRadius: 4,
            padding: '10px 28px',
            fontWeight: 500,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'background 0.2s, color 0.2s',
          }}>PSIR</button>
          <button onClick={() => setActiveModule('vsir')} style={{
            background: activeModule === 'vsir' ? '#3949ab' : '#fff',
            color: activeModule === 'vsir' ? '#fff' : '#1a237e',
            border: 'none',
            borderRadius: 4,
            padding: '10px 28px',
            fontWeight: 500,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'background 0.2s, color 0.2s',
          }}>VSIR</button>
          <button onClick={() => setActiveModule('stock')} style={{
            background: activeModule === 'stock' ? '#3949ab' : '#fff',
            color: activeModule === 'stock' ? '#fff' : '#1a237e',
            border: 'none',
            borderRadius: 4,
            padding: '10px 28px',
            fontWeight: 500,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'background 0.2s, color 0.2s',
          }}>Stock</button>
          <button onClick={() => setActiveModule('itemMaster')} style={{
            background: activeModule === 'itemMaster' ? '#3949ab' : '#fff',
            color: activeModule === 'itemMaster' ? '#fff' : '#1a237e',
            border: 'none',
            borderRadius: 4,
            padding: '10px 28px',
            fontWeight: 500,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'background 0.2s, color 0.2s',
          }}>Item Master</button>
        </nav>
      </footer>
    </div>
  );
}

export default App;
