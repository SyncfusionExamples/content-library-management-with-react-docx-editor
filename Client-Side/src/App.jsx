import React, { useCallback, useEffect, useState } from 'react';
import {
    listItems, deleteItem,
    downloadUrl, exportCombinedDocx, exportExcel, downloadBlob,
    updateMetadata, updateStatus, loadSfdt, mergeAndSaveDocx, getItemVersions
} from './api';
import UploadDialog from './components/UploadDialog';
import DocxEditorDialog from './components/DocxEditorDialog';
import './App.css';

const STATUSES = ['Draft', 'Review', 'Approved'];
const CATEGORIES = ['SOP', 'HR', 'Safety', 'Training', 'Manufacturing', 'Finance', 'Other'];

// Returns the file extension (lowercase, without the dot) for a stored
// file name, or '' when the input is empty / has no extension. Used to
// surface the file type next to titles in the UI.
const fileExt = (fileName) => {
    if (!fileName) return '';
    const m = /\.([^.\\/]+)$/.exec(fileName);
    return m ? m[1].toLowerCase() : '';
};

/**
 * Plain HTML Content Library — no Syncfusion Grid, no Dialog, no Toast.
 * The earlier versions used Syncfusion components, but React threw
 * NotFoundError when the Grid reconciled after data updates, which
 * blocked the rest of the UI (including upload). This version is
 * intentionally boring: <table>, <button>, native inputs. After it
 * works end-to-end we can swap pieces back in one at a time.
 */
export default function App() {
    const [items, setItems] = useState([]);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [uploadOpen, setUploadOpen] = useState(false);
    const [metaItem, setMetaItem] = useState(null);
    const [editItem, setEditItem] = useState(null);
    const [editSfdt, setEditSfdt] = useState(null);
    const [mergeDialog, setMergeDialog] = useState(null); // { ids, defaults }
    const [historyDialog, setHistoryDialog] = useState(null); // { item } when open
    const [toast, setToast] = useState(null);
    const [busy, setBusy] = useState(false);

    const showToast = (msg, type = 'info') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const refresh = useCallback(async () => {
        try {
            const data = await listItems();
            setItems(data);
        } catch (e) {
            showToast('Failed to load library: ' + e.message, 'error');
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const toggleSelected = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const clearSelection = () => setSelectedIds(new Set());

    const handleUploaded = (newItem) => {
        setUploadOpen(false);
        showToast(`Uploaded "${newItem.Title}"`, 'success');
        refresh();
    };

    const selectedItems = () => items.filter(i => selectedIds.has(i.Id));
    const singleSelected = () => {
        const s = selectedItems();
        return s.length === 1 ? s[0] : null;
    };
    const requireSingle = (action) => {
        const s = singleSelected();
        if (!s) { showToast(`Select exactly one item to ${action}.`, 'info'); return null; }
        return s;
    };

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`Delete ${selectedIds.size} item(s)?`)) return;
        setBusy(true);
        try {
            for (const id of selectedIds) await deleteItem(id);
            showToast('Deleted.', 'success');
            clearSelection();
            await refresh();
        } catch (e) {
            showToast('Delete failed: ' + e.message, 'error');
        } finally { setBusy(false); }
    };

    // When the user clicks "Merge documents", open a small dialog that
    // asks for the metadata of the new combined item (title, category,
    // status, author, version) before actually merging. The dialog
    // pre-fills sensible defaults derived from the current selection.
    const handleExportDocx = () => {
        const sel = selectedItems();
        if (sel.length < 2 || !sel.every(i => (i.CurrentFile || '').toLowerCase().endsWith('.docx'))) {
            showToast('Merge works only with DOCX documents. Deselect any XLSX or PPTX files.', 'info');
            return;
        }
        const stamp = new Date();
        const defaults = {
            title: `Combined \u2014 ${sel.length} items \u2014 ${stamp.toISOString().slice(0, 16).replace('T', ' ')}`,
            category: sel[0]?.Category || 'Other',
            status: 'Draft',
            author: 'Merge',
            version: '1',
        };
        setMergeDialog({ ids: [...selectedIds], defaults, count: sel.length });
    };

    const handleMergeConfirm = async (metadata) => {
        if (!mergeDialog) return;
        const { ids, count } = mergeDialog;
        setMergeDialog(null);
        setBusy(true);
        try {
            const newItem = await mergeAndSaveDocx(ids, metadata);
            clearSelection();
            await refresh();
            if (newItem && newItem.Id) {
                setSelectedIds(new Set([newItem.Id]));
                showToast(`Merged ${count} DOCX document(s) into "${newItem.Title}".`, 'success');
                // Open the editor for the freshly merged document so the
                // user can immediately review or tweak the result without
                // having to click Edit manually.
                await handleEdit(newItem);
            } else {
                showToast(`Merged ${count} DOCX document(s).`, 'success');
            }
        } catch (e) {
            showToast('Merge failed: ' + e.message, 'error');
        } finally { setBusy(false); }
    };

    const handleMergeCancel = () => setMergeDialog(null);

    // History button gating: only enable when exactly one row is selected
    // and it's a DOCX (the only type with stored versions).
    const canShowHistory = () => {
        if (selectedIds.size !== 1) return false;
        const it = items.find(x => selectedIds.has(x.Id));
        if (!it) return false;
        return (it.CurrentFile || '').toLowerCase().endsWith('.docx');
    };

    const handleOpenHistory = async () => {
        if (!canShowHistory()) return;
        const it = items.find(x => selectedIds.has(x.Id));
        setBusy(true);
        try {
            const details = await getItemVersions(it.Id);
            setHistoryDialog({ item: it, details });
        } catch (e) {
            showToast('Failed to load version history: ' + e.message, 'error');
        } finally { setBusy(false); }
    };

    const handleCloseHistory = () => setHistoryDialog(null);

    // True only when the selection is a valid merge input:
    //   - at least 2 items selected
    //   - every selected item is a DOCX file (no XLSX/PPTX mixed in)
    // A mixed selection is rejected because the backend merge is a DOCX-only
    // operation; the previous "ignore non-DOCX" behavior was surprising.
    const canMergeDocx = () => {
        if (selectedIds.size < 2) return false;
        for (const it of items) {
            if (!selectedIds.has(it.Id)) continue;
            if (!(it.CurrentFile || '').toLowerCase().endsWith('.docx')) return false;
        }
        return true;
    };

    // Export to Excel is a DOCX-only operation. The button is enabled
    // only when every selected item is a DOCX file — a single DOCX or
    // multiple DOCX are both fine, but any XLSX/PPTX in the selection
    // (alone or mixed with DOCX) disables it. The empty selection is
    // naturally disabled because the loop has no items to confirm.
    const canExportExcel = () => {
        if (selectedIds.size === 0) return false;
        for (const it of items) {
            if (!selectedIds.has(it.Id)) continue;
            if (!(it.CurrentFile || '').toLowerCase().endsWith('.docx')) return false;
        }
        return true;
    };

    const handleExportExcel = async () => {
        if (selectedIds.size === 0) { showToast('Select at least one DOCX item.', 'info'); return; }
        if (!canExportExcel()) { showToast('Export to Excel supports DOCX items only. Deselect any XLSX or PPTX files.', 'info'); return; }
        try {
            const blob = await exportExcel([...selectedIds]);
            downloadBlob(blob, 'ContentExport.xlsx');
            showToast(`Excel export ready (${selectedIds.size} item(s)).`, 'success');
        } catch (e) { showToast('Export failed: ' + e.message, 'error'); }
    };

    const handleMetadata = () => {
        const item = requireSingle('edit metadata');
        if (item) setMetaItem(item);
    };

    const handleMetaSave = async (item) => {
        setBusy(true);
        try {
            await updateMetadata(item.Id, {
                title: item.Title, version: item.Version,
                category: item.Category, status: item.Status, author: item.Author
            });
            showToast('Metadata updated.', 'success');
            setMetaItem(null);
            await refresh();
        } catch (e) { showToast('Update failed: ' + e.message, 'error'); }
        finally { setBusy(false); }
    };

    const handleEditSaved = (updated) => {
        setEditItem(null);
        setEditSfdt(null);
        showToast(`Saved as v${updated.CurrentVersion}.`, 'success');
        refresh();
    };

    // Status changes are made from inside the editor dialog. We lift the
    // API call up here so we can refresh the home-page list as soon as
    // the server confirms the change. Otherwise the row in the table
    // keeps showing the old status until the editor is closed and
    // reopened (or another refresh-triggering action runs).
    //
    // We also keep the editor's and history dialog's local snapshots
    // in sync: both were opened against an older copy of the item and
    // would otherwise show stale status until the user re-opens them.
    const handleStatusChanged = async (id, newStatus) => {
        const updated = await updateStatus(id, newStatus);
        await refresh();
        // Keep the editor in sync if it is still open on the same item.
        // setEditItem only fires the editor's [item] effect when the
        // reference actually changes; we always pass a new object so the
        // dropdown re-seeds with the latest Version.Status.
        setEditItem(prev => (prev && prev.Id === id ? { ...updated } : prev));
        // Keep the history dialog in sync if it is open on the same item.
        setHistoryDialog(prev => {
            if (!prev || !prev.details) return prev;
            if (prev.item && prev.item.Id === id) {
                return { item: { ...updated }, details: { ...prev.details, status: updated.Status, currentFile: updated.CurrentFile, currentVersion: updated.CurrentVersion, versions: (updated.Versions || []).slice().sort((a, b) => b.VersionNumber - a.VersionNumber) } };
            }
            return prev;
        });
        return updated;
    };

    const closeEditor = () => {
        setEditItem(null);
        setEditSfdt(null);
    };

    const handleEdit = async (item) => {
        setBusy(true);
        setEditItem(item);
        setEditSfdt(null);
        try {
            const sfdt = await loadSfdt(`ContentLibrary/${item.Id}/${item.CurrentFile}`);
            setEditSfdt(sfdt);
        } catch (e) {
            showToast('Failed to load document: ' + e.message, 'error');
            setEditItem(null);
        } finally {
            setBusy(false);
        }
    };

    // Open a specific historical version (by file name, e.g. "v2.docx")
    // in the same editor. Used by the version-history dialog.
    const handleEditVersion = async (item, fileName) => {
        setHistoryDialog(null);
        await handleEdit({ ...item, CurrentFile: fileName });
    };

    return (
        <div className="cl-shell">
            <header className="cl-header">
                <h1>Content Library</h1>
                <span className="cl-subtitle">Reusable content items · DOCX </span>
            </header>

            <div className="cl-toolbar">
                <button className="cl-btn cl-btn-primary" onClick={() => setUploadOpen(true)} disabled={busy}>Upload</button>
                <button className="cl-btn" onClick={handleMetadata} disabled={busy || !singleSelected()}>Metadata</button>
                <button
                    className="cl-btn"
                    onClick={handleOpenHistory}
                    disabled={busy || !canShowHistory()}
                    title={canShowHistory() ? 'View previous versions of this document' : 'Select a single DOCX document to view its version history'}
                >
                    History
                </button>
                <span className="cl-spacer" />
                <button
                    className="cl-btn cl-btn-primary"
                    onClick={handleExportDocx}
                    disabled={busy || !canMergeDocx()}
                    title={canMergeDocx() ? 'Merge selected DOCX documents into a single file' : 'Select at least two DOCX documents (no XLSX or PPTX) to enable merge'}
                >
                    Merge documents
                </button>
                <button className="cl-btn cl-btn-primary" onClick={handleExportExcel} disabled={busy || !canExportExcel()}
                    title={canExportExcel() ? 'Export selected DOCX documents to an Excel workbook' : 'Select at least one DOCX document (no XLSX or PPTX) to enable Export Excel'}
                >Export Excel</button>
                <button className="cl-btn cl-btn-danger" onClick={handleDelete} disabled={busy || selectedIds.size === 0}>Delete</button>
            </div>

            <div className="cl-status">
                {selectedIds.size} item(s) selected · {items.length} total
            </div>

            <div className="cl-grid-wrapper">
                <table className="cl-table">
                    <thead>
                        <tr>
                            <th style={{ width: 40 }}></th>
                            <th>Title</th>
                            <th style={{ width: 80 }}>Version</th>
                            <th style={{ width: 110 }}>Category</th>
                            <th style={{ width: 100 }}>Status</th>
                            <th style={{ width: 100 }}>Author</th>
                            <th style={{ width: 160 }}>Modified</th>
                            <th style={{ width: 200 }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr><td colSpan={8} className="cl-empty">No documents yet. Click Upload to add the first one.</td></tr>
                        ) : items.map(item => {
                            const checked = selectedIds.has(item.Id);
                            const isDocx = (item.CurrentFile || '').toLowerCase().endsWith('.docx');
                            return (
                                <tr key={item.Id} className={checked ? 'cl-row-selected' : ''}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleSelected(item.Id)}
                                        />
                                    </td>
                                    <td>
                                        {item.Title}
                                        {fileExt(item.CurrentFile) && (
                                            <span style={{ color: '#64748b', fontSize: 12, marginLeft: 6 }}>
                                                (.{fileExt(item.CurrentFile)})
                                            </span>
                                        )}
                                    </td>
                                    <td>{item.Version}</td>
                                    <td>{item.Category}</td>
                                    <td>{item.Status}</td>
                                    <td>{item.Author}</td>
                                    <td>{item.ModifiedDate ? new Date(item.ModifiedDate).toLocaleString() : ''}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-start' }}>
                                            {isDocx && (
                                                <button
                                                    className="cl-btn cl-btn-primary"
                                                    style={{ padding: '4px 10px', fontSize: 12 }}
                                                    onClick={() => handleEdit(item)}
                                                >
                                                    Edit
                                                </button>
                                            )}
                                            <button
                                                className="cl-btn"
                                                style={{ padding: '4px 10px', fontSize: 12 }}
                                                onClick={() => {
                                                    const a = document.createElement('a');
                                                    a.href = downloadUrl(item.Id);
                                                    a.download = '';
                                                    a.click();
                                                }}
                                            >
                                                Download
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <UploadDialog
                open={uploadOpen}
                onClose={() => setUploadOpen(false)}
                onUploaded={handleUploaded}
            />

            {metaItem && (
                <MetadataDialog
                    item={metaItem}
                    onClose={() => setMetaItem(null)}
                    onSave={handleMetaSave}
                />
            )}

            {editItem && (
                <DocxEditorDialog
                    item={editItem}
                    sfdt={editSfdt}
                    onClose={closeEditor}
                    onSaved={handleEditSaved}
                    onStatusChanged={handleStatusChanged}
                />
            )}

            {mergeDialog && (
                <MergeDialog
                    defaults={mergeDialog.defaults}
                    count={mergeDialog.count}
                    onConfirm={handleMergeConfirm}
                    onCancel={handleMergeCancel}
                />
            )}

            {historyDialog && (
                <VersionHistoryDialog
                    item={historyDialog.item}
                    details={historyDialog.details}
                    onClose={handleCloseHistory}
                    onOpenVersion={handleEditVersion}
                />
            )}

            {toast && (
                <div className={'cl-toast cl-toast-' + toast.type}>
                    {toast.msg}
                </div>
            )}
        </div>
    );
}

function MetadataDialog({ item, onClose, onSave }) {
    const [title, setTitle] = useState(item.Title || '');
    const [version, setVersion] = useState(item.Version || '');
    const [category, setCategory] = useState(item.Category || 'SOP');
    const [status, setStatus] = useState(item.Status || 'Draft');
    const [author, setAuthor] = useState(item.Author || '');

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(15,23,42,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <form
                onSubmit={(e) => { e.preventDefault(); onSave({ ...item, Title: title, Version: version, Category: category, Status: status, Author: author }); }}
                style={{ background: '#fff', width: 520, maxWidth: '95vw', borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', padding: 0, color: '#1f2937' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>Edit Metadata · {item.Title}</strong>
                    <button type="button" onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 20, cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ padding: 16, display: 'grid', gap: 12 }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Title</label>
                        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', padding: 6, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Version</label>
                            <input
                                type="text"
                                value={version}
                                onChange={(e) => setVersion(e.target.value)}
                                readOnly
                                disabled
                                title="Version is managed automatically. The current version is shown for reference; the next save will create v{n+1}."
                                style={{ width: '100%', padding: 6, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box', background: '#f1f5f9', color: '#475569', cursor: 'not-allowed' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Author</label>
                            <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} style={{ width: '100%', padding: 6, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }} />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Category</label>
                            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%', padding: 6, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Status</label>
                            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: '100%', padding: 6, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}>
                                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
                <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e7eb', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: 8, borderRadius: '0 0 8px 8px' }}>
                    <button type="button" onClick={onClose} style={{ padding: '6px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                    <button type="submit" style={{ padding: '6px 14px', background: '#6366f1', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Save</button>
                </div>
            </form>
        </div>
    );
}

/**
 * Asks the user to supply metadata (title, category, status, author,
 * version) for the new combined document before the merge actually
 * happens. The form is pre-filled with sensible defaults so the user
 * can simply press Save for the common case.
 */
function MergeDialog({ defaults, count, onConfirm, onCancel }) {
    const [title, setTitle] = useState(defaults?.title || '');
    const [version, setVersion] = useState(defaults?.version || '1');
    const [category, setCategory] = useState(defaults?.category || 'Other');
    const [status, setStatus] = useState(defaults?.status || 'Draft');
    const [author, setAuthor] = useState(defaults?.author || '');
    const [error, setError] = useState('');

    // Reset whenever the defaults prop changes (dialog re-opened with
    // a different selection).
    useEffect(() => {
        setTitle(defaults?.title || '');
        setVersion(defaults?.version || '1');
        setCategory(defaults?.category || 'Other');
        setStatus(defaults?.status || 'Draft');
        setAuthor(defaults?.author || '');
        setError('');
    }, [defaults]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!title.trim()) { setError('Title is required.'); return; }
        onConfirm({ title: title.trim(), version: version.trim() || '1', category, status, author: author.trim() || 'Merge' });
    };

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(15,23,42,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <form
                onSubmit={handleSubmit}
                style={{ background: '#fff', width: 520, maxWidth: '95vw', borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', padding: 0, color: '#1f2937' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>Save merged document ({count} items)</strong>
                    <button type="button" onClick={onCancel} style={{ background: 'transparent', border: 0, fontSize: 20, cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ padding: 16, display: 'grid', gap: 12 }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Title <span style={{ color: '#dc2626' }}>*</span></label>
                        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus style={{ width: '100%', padding: 6, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Version</label>
                            <input
                                type="text"
                                value={version}
                                onChange={(e) => setVersion(e.target.value)}
                                readOnly
                                disabled
                                title="Merged documents are always saved as v1; subsequent edits increment the version automatically."
                                style={{ width: '100%', padding: 6, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box', background: '#f1f5f9', color: '#475569', cursor: 'not-allowed' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Author</label>
                            <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} style={{ width: '100%', padding: 6, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }} />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Category</label>
                            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%', padding: 6, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Status</label>
                            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: '100%', padding: 6, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}>
                                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>
                    {error && (
                        <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>
                    )}
                </div>
                <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e7eb', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: 8, borderRadius: '0 0 8px 8px' }}>
                    <button type="button" onClick={onCancel} style={{ padding: '6px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                    <button type="submit" style={{ padding: '6px 14px', background: '#10b981', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Merge &amp; Save</button>
                </div>
            </form>
        </div>
    );
}

/**
 * Version history dialog. Shows the stored versions of a single item
 * in a table that mirrors the home page's cl-table layout — the
 * "Title" column is replaced with the version number, and per-row
 * actions are Open (loads that version in the editor) and Download
 * (downloads the v{n}.docx file directly).
 */
function VersionHistoryDialog({ item, details, onClose, onOpenVersion }) {
    const versions = details?.versions || [];
    const totalCount = versions.length;
    const currentVer = details?.currentVersion || item?.CurrentVersion;

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(15,23,42,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                style={{
                    background: '#fff', width: 880, maxWidth: '95vw', maxHeight: '85vh',
                    borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    padding: 0, color: '#1f2937',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{
                    padding: '14px 18px', borderBottom: '1px solid #e5e7eb',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div>
                        <strong>Version history · {details?.title || item?.Title}</strong>
                        {fileExt(item?.CurrentFile) && (
                            <span style={{ color: '#94a3b8', fontWeight: 'normal', fontSize: 13, marginLeft: 6 }}>
                                (.{fileExt(item.CurrentFile)})
                            </span>
                        )}
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                            {totalCount} version{totalCount === 1 ? '' : 's'} stored
                            {currentVer ? ` · latest is v${currentVer}` : ''}
                        </div>
                    </div>
                    <button type="button" onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 20, cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ padding: '12px 18px', overflow: 'auto' }}>
                    {totalCount === 0 ? (
                        <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
                            No previous versions are stored for this document yet.
                            Save changes from the editor to create a new version.
                        </div>
                    ) : (
                        <table className="cl-table" style={{ width: '100%' }}>
                            <thead>
                                <tr>
                                    <th style={{ width: 80 }}>Version</th>
                                    <th style={{ width: 120 }}>Category</th>
                                    <th style={{ width: 100 }}>Status</th>
                                    <th style={{ width: 120 }}>Author</th>
                                    <th style={{ width: 180 }}>Modified</th>
                                    <th style={{ width: 200 }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {versions.map(v => {
                                    const isCurrent = v.VersionNumber === currentVer;
                                    // Each version carries the status the
                                    // document had when it was saved. Older
                                    // records (created before the per-version
                                    // status snapshot was added) have no
                                    // Status field; show them as a blank
                                    // rather than falling back to the
                                    // document's *current* status, which
                                    // would otherwise make an old "Review"
                                    // appear as "Approved" after a metadata
                                    // change.
                                    const versionStatus = v.Status || '';
                                    return (
                                        <tr key={v.VersionNumber}>
                                            <td>
                                                v{v.VersionNumber}
                                                {isCurrent && (
                                                    <span style={{
                                                        marginLeft: 6, fontSize: 11,
                                                        background: '#dcfce7', color: '#166534',
                                                        padding: '1px 6px', borderRadius: 10
                                                    }}>
                                                        current
                                                    </span>
                                                )}
                                            </td>
                                            <td>{details?.category || ''}</td>
                                            <td>{versionStatus}</td>
                                            <td>{v.ModifiedUser || ''}</td>
                                            <td>{v.ModifiedDate ? new Date(v.ModifiedDate).toLocaleString() : ''}</td>
                                            <td>
                                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-start' }}>
                                                    <button
                                                        className="cl-btn cl-btn-primary"
                                                        style={{ padding: '4px 10px', fontSize: 12 }}
                                                        onClick={() => onOpenVersion(item, v.FileName)}
                                                    >
                                                        Open
                                                    </button>
                                                    <button
                                                        className="cl-btn"
                                                        style={{ padding: '4px 10px', fontSize: 12 }}
                                                        onClick={() => {
                                                            const a = document.createElement('a');
                                                            a.href = downloadUrl(item.Id, v.VersionNumber);
                                                            a.download = '';
                                                            a.click();
                                                        }}
                                                    >
                                                        Download
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
                <div style={{
                    padding: '12px 18px', borderTop: '1px solid #e5e7eb',
                    background: '#f8fafc', display: 'flex', justifyContent: 'flex-end',
                    borderRadius: '0 0 8px 8px'
                }}>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{ padding: '6px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 4, cursor: 'pointer' }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
