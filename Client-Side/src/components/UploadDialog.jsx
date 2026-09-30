import React, { useEffect, useRef, useState } from 'react';
import { uploadDocument } from '../api';

const STATUSES = ['Draft', 'Review', 'Approved', 'Released'];
const CATEGORIES = ['SOP', 'HR', 'Safety', 'Training', 'Manufacturing', 'Finance', 'Other'];

/**
 * Plain HTML upload modal — NO Syncfusion Dialog, NO portal, NO nested table.
 * A single div overlay with a native <form>. Save calls uploadDocument()
 * directly. This exists because the Syncfusion Dialog had multiple
 * intermittent issues (portal mount crashes, label[for] not opening the
 * input inside the portal) that prevented the file selection from being
 * captured in React state.
 */
export default function UploadDialog({ open, onClose, onUploaded }) {
    const fileInputRef = useRef(null);
    const [file, setFile] = useState(null);
    const [title, setTitle] = useState('');
    const [version, setVersion] = useState('1.0');
    const [category, setCategory] = useState('SOP');
    const [status, setStatus] = useState('Draft');
    const [author, setAuthor] = useState('Admin');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    // Reset whenever the dialog opens so each open is a fresh form.
    useEffect(() => {
        if (open) {
            setFile(null);
            setTitle('');
            setVersion('1.0');
            setCategory('SOP');
            setStatus('Draft');
            setAuthor('Admin');
            setBusy(false);
            setError('');
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [open]);

    if (!open) return null;

    const handleFileChange = (e) => {
        const picked = e.target.files && e.target.files[0];
        if (!picked) return;
        setFile(picked);
        if (!title) setTitle(picked.name.replace(/\.(docx|xlsx|pptx)$/i, ''));
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (busy) return;
        if (!file) { setError('Please choose a file.'); return; }
        if (!title.trim()) { setError('Please enter a Title.'); return; }
        setBusy(true);
        setError('');
        try {
            const item = await uploadDocument(file, { title, version, category, status, author });
            onUploaded(item);
        } catch (err) {
            setError(err.message || 'Upload failed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(15,23,42,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
        >
            <form
                onSubmit={handleSubmit}
                style={{
                    background: '#fff', width: 520, maxWidth: '95vw',
                    borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    padding: 0, fontFamily: 'Segoe UI, system-ui, sans-serif',
                    color: '#1f2937'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 18px', borderBottom: '1px solid #e5e7eb'
                }}>
                    <strong style={{ fontSize: 16 }}>Upload Document</strong>
                    <button
                        type="button"
                        onClick={() => !busy && onClose()}
                        style={{
                            background: 'transparent', border: 0, fontSize: 20,
                            cursor: 'pointer', color: '#6b7280', lineHeight: 1
                        }}
                        aria-label="Close"
                    >×</button>
                </div>

                <div style={{ padding: '16px 18px', display: 'grid', gap: 12 }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4 }}>
                            File (.docx, .xlsx, .pptx)
                        </label>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".docx,.xlsx,.pptx"
                            onChange={handleFileChange}
                            disabled={busy}
                            style={{ width: '100%', fontSize: 13 }}
                        />
                        {file && (
                            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                                {(file.size / 1024).toFixed(1)} KB · {file.name}
                            </div>
                        )}
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4 }}>Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            disabled={busy}
                            placeholder="e.g. Safety Procedure"
                            style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4 }}>Version</label>
                            <input
                                type="text"
                                value={version}
                                onChange={(e) => setVersion(e.target.value)}
                                disabled={busy}
                                style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4 }}>Author</label>
                            <input
                                type="text"
                                value={author}
                                onChange={(e) => setAuthor(e.target.value)}
                                disabled={busy}
                                style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4 }}>Category</label>
                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                disabled={busy}
                                style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}
                            >
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4 }}>Status</label>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                                disabled={busy}
                                style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}
                            >
                                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>

                    {error && (
                        <div style={{ color: '#b91c1c', background: '#fef2f2', padding: '6px 8px', borderRadius: 4, fontSize: 13 }}>
                            {error}
                        </div>
                    )}
                </div>

                <div style={{
                    display: 'flex', justifyContent: 'flex-end', gap: 8,
                    padding: '12px 18px', borderTop: '1px solid #e5e7eb', background: '#f8fafc',
                    borderRadius: '0 0 8px 8px'
                }}>
                    <button
                        type="button"
                        onClick={() => !busy && onClose()}
                        disabled={busy}
                        style={{ padding: '6px 14px', background: '#fff', color: '#1f2937', border: '1px solid #cbd5e1', borderRadius: 4, cursor: busy ? 'not-allowed' : 'pointer' }}
                    >Cancel</button>
                    <button
                        type="submit"
                        disabled={busy}
                        style={{ padding: '6px 14px', background: busy ? '#94a3b8' : '#6366f1', color: '#fff', border: 0, borderRadius: 4, cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 600 }}
                    >{busy ? 'Saving…' : 'Save'}</button>
                </div>
            </form>
        </div>
    );
}
