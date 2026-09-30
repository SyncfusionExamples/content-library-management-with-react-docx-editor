import React, { useEffect, useRef, useState } from 'react';
import {
    DocumentEditorContainerComponent,
    Toolbar,Ribbon,
} from '@syncfusion/ej2-react-documenteditor';
import { saveNewVersion, updateStatus } from '../api';

DocumentEditorContainerComponent.Inject(Ribbon, Toolbar);

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
export default function DocxEditorDialog({ item, sfdt, onClose, onSaved, onStatusChanged }) {
    const containerRef = useRef(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [opened, setOpened] = useState(false);
    const [status, setStatus] = useState(item && item.Status ? item.Status : 'Draft');
    const [statusBusy, setStatusBusy] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');

    // True when the editor is open on a non-current version (e.g. the
    // user opened v2 via the history dialog while the current head is
    // v3). The status dropdown is disabled in that case because status
    // only describes the active edit — older versions are frozen and
    // cannot be re-validated. Saving an old version still creates a
    // new v(n+1) that inherits the document's current status.
    const isOldVersion = (() => {
        if (!item) return false;
        const m = /v(\d+)\.docx$/i.exec(item.CurrentFile || '');
        if (!m) return false;
        const openV = parseInt(m[1], 10);
        return Number.isFinite(openV) && Number.isFinite(item.CurrentVersion) && openV < item.CurrentVersion;
    })();

    useEffect(() => {
        if (!item) return;
        // When opening a specific historical version (CurrentFile =
        // v{n}.docx, n < CurrentVersion) the status dropdown should
        // show the status that version was saved with, not the
        // document's current status. Each version record carries a
        // frozen Status (added so the history dialog can show the
        // state at save time); fall back to the item's current Status
        // for legacy records that predate the snapshot.
        const fileName = item.CurrentFile || '';
        const m = /v(\d+)\.docx$/i.exec(fileName);
        if (m && Array.isArray(item.Versions)) {
            const target = parseInt(m[1], 10);
            const v = item.Versions.find(x => x.VersionNumber === target);
            if (v && v.Status) {
                setStatus(v.Status);
                return;
            }
        }
        if (item.Status) setStatus(item.Status);
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

    // Drive the editor's track-changes behaviour off the current
    // status: enabled for Review / Approved, disabled for Draft. The
    // prop on the container only takes effect on first render, so we
    // also push the value into the editor instance whenever the
    // status changes. The isOldVersion guard means we never toggle
    // tracking on a frozen historical version.
    const trackChangesEnabled = !isOldVersion && (status === 'Review' || status === 'Approved');
    useEffect(() => {
        const editor = containerRef.current && containerRef.current.documentEditor;
        if (!editor) return;
        try {
            if (typeof editor.enableTrackChanges === 'boolean' || editor.enableTrackChanges === undefined) {
                editor.enableTrackChanges = trackChangesEnabled;
            }
        } catch (e) {
            // Older builds expose the flag as readonly; the JSX prop
            // already covers the initial render, so just log and move on.
            console.warn('Could not set enableTrackChanges at runtime', e);
        }
    }, [trackChangesEnabled, opened]);

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
        // Guard: status can only be changed while editing the current
        // version. If the editor is open on a historical file we
        // revert the selection silently and do not call the API.
        if (isOldVersion) {
            setStatus(status);
            setStatusMsg('Status is frozen for older versions');
            setTimeout(() => setStatusMsg(''), 2500);
            return;
        }
        const previous = status;
        setStatus(newStatus);
        setStatusBusy(true);
        setStatusMsg('');
        try {
            // Delegate the API call + list refresh to the parent so the
            // home-page table updates immediately, not only after a save.
            // If the parent didn't provide a handler, fall back to a
            // direct API call (no refresh in that case, but the status
            // still gets persisted).
            if (typeof onStatusChanged === 'function') {
                await onStatusChanged(item.Id, newStatus);
            } else {
                await updateStatus(item.Id, newStatus);
            }
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
                        toolbarMode="Ribbon"
                        enableToolbar={true}
                        showPropertiesPane={false}
                        isReadOnly={false}
                        enableTrackChanges={trackChangesEnabled}
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
                            disabled={statusBusy || saving || isOldVersion}
                            title={isOldVersion ? 'Status is frozen for older versions. The current version status applies when you save this as a new version.' : undefined}
                            style={{
                                padding: '4px 8px', border: '1px solid #cbd5e1',
                                borderRadius: 4, background: '#fff', fontSize: 13,
                                cursor: (statusBusy || isOldVersion) ? 'not-allowed' : 'pointer',
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
