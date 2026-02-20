import React, { useEffect, useState } from 'react';

const formatTime = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');

const SyncStatus: React.FC = () => {
  const [status, setStatus] = useState<string>('idle');
  const [lastTs, setLastTs] = useState<number | null>(null);
  const [message, setMessage] = useState<string>('Not syncing');

  useEffect(() => {
    const onStarted = (e: any) => { setStatus('running'); setLastTs(e.detail?.ts || Date.now()); setMessage('Background sync started'); };
    const onInitialized = (e: any) => { setStatus('initialized'); setLastTs(e.detail?.ts || Date.now()); setMessage('Initialized remote userData'); };
    const onApplied = (e: any) => { setStatus('applied'); setLastTs(e.detail?.ts || Date.now()); setMessage('Applied remote userData'); };
    const onRemoteUpdate = (e: any) => { setStatus('updated'); setLastTs(e.detail?.ts || Date.now()); setMessage('Remote update applied'); };
    const onSaving = (e: any) => { setStatus('saving'); setLastTs(e.detail?.ts || Date.now()); setMessage('Saving to server...'); };
    const onSaved = (e: any) => { setStatus('saved'); setLastTs(e.detail?.ts || Date.now()); setMessage('Saved'); };
    const onError = (e: any) => { setStatus('error'); setLastTs(e.detail?.ts || Date.now()); setMessage('Error: ' + (e.detail?.error || 'Unknown')); };

    window.addEventListener('userData.sync.started', onStarted as EventListener);
    window.addEventListener('userData.sync.initialized', onInitialized as EventListener);
    window.addEventListener('userData.sync.applied', onApplied as EventListener);
    window.addEventListener('userData.sync.remoteUpdate', onRemoteUpdate as EventListener);
    window.addEventListener('userData.sync.saving', onSaving as EventListener);
    window.addEventListener('userData.sync.saved', onSaved as EventListener);
    window.addEventListener('userData.sync.error', onError as EventListener);

    return () => {
      window.removeEventListener('userData.sync.started', onStarted as EventListener);
      window.removeEventListener('userData.sync.initialized', onInitialized as EventListener);
      window.removeEventListener('userData.sync.applied', onApplied as EventListener);
      window.removeEventListener('userData.sync.remoteUpdate', onRemoteUpdate as EventListener);
      window.removeEventListener('userData.sync.saving', onSaving as EventListener);
      window.removeEventListener('userData.sync.saved', onSaved as EventListener);
      window.removeEventListener('userData.sync.error', onError as EventListener);
    };
  }, []);

  const color = status === 'saved' || status === 'applied' || status === 'initialized' ? '#19a34a' : status === 'saving' || status === 'running' ? '#f5a623' : status === 'error' ? '#d32f2f' : '#90a4ae';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={`${message} @ ${formatTime(lastTs)}`}>
      <span style={{ width: 10, height: 10, borderRadius: 6, background: color, display: 'inline-block' }} />
      <div style={{ fontSize: 12, color: '#fff', opacity: 0.9 }}>
        <div style={{ fontWeight: 600 }}>{message}</div>
        <div style={{ fontSize: 10, opacity: 0.85 }}>{formatTime(lastTs)}</div>
      </div>
    </div>
  );
};

export default SyncStatus;
