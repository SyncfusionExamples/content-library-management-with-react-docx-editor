import React, { useState, useEffect } from 'react';
import { DialogComponent } from '@syncfusion/ej2-react-popups';
import { TextBoxComponent } from '@syncfusion/ej2-react-inputs';
import { DropDownListComponent } from '@syncfusion/ej2-react-dropdowns';
import { updateMetadata } from '../api';

const STATUSES = ['Draft', 'Review', 'Approved', 'Released'];
const CATEGORIES = ['SOP', 'HR', 'Safety', 'Training', 'Manufacturing', 'Finance', 'Other'];

/**
 * Edit metadata + transition workflow status. Same div-based layout as
 * UploadDialog to avoid the Syncfusion Dialog + nested <table> crash.
 */
export default function MetadataDialog({ open, item, onClose, onSaved }) {
    const [title, setTitle] = useState('');
    const [version, setVersion] = useState('');
    const [category, setCategory] = useState('');
    const [status, setStatus] = useState('Draft');
    const [author, setAuthor] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (item) {
            setTitle(item.title || '');
            setVersion(item.version || '');
            setCategory(item.category || 'SOP');
            setStatus(item.status || 'Draft');
            setAuthor(item.author || '');
            setError('');
        }
    }, [item, open]);

    if (!item) return null;

    const handleSave = async () => {
        setBusy(true); setError('');
        try {
            const updated = await updateMetadata(item.id, { title, version, category, status, author });
            onSaved && onSaved(updated);
        } catch (e) {
            setError(e.message || 'Save failed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <DialogComponent
            width="520px"
            isModal={true}
            visible={open}
            header={`Edit Metadata · ${item.title}`}
            showCloseIcon={true}
            close={onClose}
            buttons={[
                { click: handleSave, buttonModel: { content: busy ? 'Saving...' : 'Save', isPrimary: true, disabled: busy } },
                { click: onClose, buttonModel: { content: 'Cancel' } }
            ]}
        >
            <div className="cl-field">
                <label className="cl-field-label">Title</label>
                <TextBoxComponent value={title} change={(e) => setTitle(e.value)} />
            </div>
            <div className="cl-field">
                <label className="cl-field-label">Version</label>
                <TextBoxComponent value={version} change={(e) => setVersion(e.value)} />
            </div>
            <div className="cl-field">
                <label className="cl-field-label">Category</label>
                <DropDownListComponent dataSource={CATEGORIES} value={category} change={(e) => setCategory(e.value)} />
            </div>
            <div className="cl-field">
                <label className="cl-field-label">Status</label>
                <DropDownListComponent dataSource={STATUSES} value={status} change={(e) => setStatus(e.value)} />
            </div>
            <div className="cl-field">
                <label className="cl-field-label">Author</label>
                <TextBoxComponent value={author} change={(e) => setAuthor(e.value)} />
            </div>
            {error && (
                <div className="cl-error">{error}</div>
            )}
        </DialogComponent>
    );
}