import React, { useEffect, useRef, useState } from 'react';
import {
    DocumentEditorContainerComponent,
    Toolbar,
} from '@syncfusion/ej2-react-documenteditor';
import { saveNewVersion, updateStatus } from '../api';

DocumentEditorContainerComponent.Inject(Toolbar);

const STATUS_OPTIONS = ['Draft', 'Review', 'Approved'];

/**
 * Simple, single-purpose editor dialog.
 *
 * Props:
 *   - item:    the content item being edited
 *   - sfdt:    the SFDT JSON string already loaded from the server
 *   - onClose: called when the user wants to dismiss the dialog
 *   - onSaved: called after a successful save
 *
 * On mount the editor immediately calls `open(sfdt)` to render the
 * document. No polling, no auto-loader, no service URL dance.
 */
export default function DocxEditorDialog({ item, sfdt, onClose, onSaved }) {
    const containerRef = useRef(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [opened, setOpened] = useState(false);
    const [status, setStatus] = useState(item && item.Status ? item.Status : 'Draft');
    const [statusBusy, setStatusBusy] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');

    useEffect(() => {
        if (item && item.Status) setStatus(item.Status);
    }, [item]);

    useEffect(() => {
        const inst = containerRef.current && containerRef.current.documentEditor;
        if (!inst || !sfdt || opened) return;
        try {
            inst.open(sfdt);
            setOpened(true);
        } catch (e) {
            console.error('open() failed', e);
            setError('Failed to render document: ' + (e.message || e));
        }
    }, [sfdt, opened]);

    if (!item) return null;

    const handleSave = async () => {
        if (!containerRef.current) return;
        setSaving(true);
        setError('');
        try {
            const newSfdt = containerRef.current.documentEditor.serialize();
            const updated = await saveNewVersion(item.Id, newSfdt, 'Author');
            onSaved && onSaved(updated);
        } catch (e) {
            setError(e.message || 'Save failed.');
        } finally {
            setSaving(false);
        }
    };

    const handleClose = () => {
        if (saving || statusBusy) return;
        onClose && onClose();
    };

    const handleStatusChange = async (e) => {
        const newStatus = e.target.value;
        const previous = status;
        setStatus(newStatus);
        setStatusBusy(true);
        setStatusMsg('');
        try {
            await updateStatus(item.Id, newStatus);
            setStatusMsg('Status updated');
        } catch (err) {
            setStatus(previous);
            setStatusMsg('Failed to update status: ' + (err.message || err));
        } finally {
            setStatusBusy(false);
            setTimeout(() => setStatusMsg(''), 2500);
        }
    };

    return (
        <div
            onClick={(e) => { if (e.target === e.currentTarget && !saving) handleClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(15,23,42,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 12,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: '#fff', width: '98vw', height: '95vh',
                    borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 16px', borderBottom: '1px solid #e5e7eb',
                        background: '#f8fafc',
                    }}
                >
                    <strong>
                        Edit · {item.Title}
                        {(() => {
                            // item.CurrentFile can briefly be undefined while
                            // the parent re-renders after Save. Guard so a
                            // missing/non-string value renders nothing.
                            const fileName = (item && typeof item.CurrentFile === 'string') ? item.CurrentFile : '';
                            const m = fileName ? /\.[^.\\/]+$/.exec(fileName) : null;
                            return m && m[1] ? <span style={{ color: '#94a3b8', fontWeight: 'normal', fontSize: 13, marginLeft: 6 }}>(.{m[1].toLowerCase()})</span> : null;
                        })()}
                    </strong>
                    <button
                        onClick={handleClose}
                        disabled={saving}
                        style={{
                            background: 'transparent', border: 0, fontSize: 20,
                            cursor: saving ? 'not-allowed' : 'pointer', lineHeight: 1,
                        }}
                        aria-label="Close"
                    >×</button>
                </div>

                {error && (
                    <div
                        style={{
                            color: '#b91c1c',
                            background: '#fee2e2',
                            border: '1px solid #fecaca',
                            padding: '6px 10px',
                            borderRadius: 4,
                            fontSize: 12,
                            margin: '8px 16px 0',
                        }}
                    >
                        {error}
                    </div>
                )}

                <div style={{ flex: 1, minHeight: 0, padding: '8px 16px 0' }}>
                    <DocumentEditorContainerComponent
                        ref={containerRef}
                        id={`docEditor_${item.Id}`}
                        height="100%"
                        width="100%"
                        enableToolbar={true}
                        showPropertiesPane={false}
                        isReadOnly={false}
                        enableTrackChanges={true}
                        showComments={true}
                    />
                </div>

                <div
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 12, padding: '10px 16px', borderTop: '1px solid #e5e7eb',
                        background: '#f8fafc',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label htmlFor="status-select" style={{ fontSize: 12, color: '#475569' }}>
                            Status:
                        </label>
                        <select
                            id="status-select"
                            value={status}
                            onChange={handleStatusChange}
                            disabled={statusBusy || saving}
                            style={{
                                padding: '4px 8px', border: '1px solid #cbd5e1',
                                borderRadius: 4, background: '#fff', fontSize: 13,
                                cursor: statusBusy ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {STATUS_OPTIONS.map(s => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                        {statusMsg && (
                            <span style={{ fontSize: 12, color: statusMsg.startsWith('Failed') ? '#b91c1c' : '#16a34a' }}>
                                {statusMsg}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            onClick={handleClose}
                            disabled={saving || statusBusy}
                            style={{
                                padding: '6px 14px', background: '#fff', color: '#1f2937',
                                border: '1px solid #cbd5e1', borderRadius: 4,
                                cursor: (saving || statusBusy) ? 'not-allowed' : 'pointer',
                            }}
                        >Close</button>
                        <button
                            onClick={handleSave}
                            disabled={saving || !opened}
                            style={{
                                padding: '6px 14px',
                                background: !opened ? '#94a3b8' : (saving ? '#94a3b8' : '#6366f1'),
                                color: '#fff', border: 0, borderRadius: 4,
                                cursor: (!opened || saving) ? 'not-allowed' : 'pointer',
                                fontWeight: 600,
                            }}
                        >{saving ? 'Saving…' : 'Save'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
