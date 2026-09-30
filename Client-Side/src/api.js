// Centralized API client for the Content Library POC.
// Uses a relative base URL so the Vite dev server can proxy /api to
// the backend on :62870 (see vite.config.js). This avoids CORS issues
// entirely because the browser sees a same-origin request.
export const API_BASE = '/api';
export const EDITOR_SERVICE_URL = '/api/documenteditor/';

const CONTENT_BASE = `${API_BASE}/contentlibrary`;

async function handle(response) {
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`);
    }
    // Some endpoints (delete) return 204; the rest return JSON.
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) return response.json();
    return response.text();
}

export async function listItems() {
    return handle(await fetch(`${CONTENT_BASE}/items`));
}

export async function getItem(id) {
    return handle(await fetch(`${CONTENT_BASE}/items/${id}`));
}

// Returns the Versions array (and minimal metadata) for a single item.
// Used by the version-history dialog.
export async function getItemVersions(id) {
    const item = await getItem(id);
    return {
        id: item.Id,
        title: item.Title,
        category: item.Category,
        status: item.Status,
        author: item.Author,
        currentFile: item.CurrentFile,
        currentVersion: item.CurrentVersion,
        versions: (item.Versions || []).slice().sort((a, b) => b.VersionNumber - a.VersionNumber),
    };
}

export async function uploadDocument(file, metadata) {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(metadata || {})) {
        if (v != null) form.append(k, v);
    }
    return handle(await fetch(`${CONTENT_BASE}/upload`, { method: 'POST', body: form }));
}

export async function loadSfdt(documentName) {
    const form = new FormData();
    form.append('DocumentName', documentName);
    const response = await fetch(`${EDITOR_SERVICE_URL}LoadDocument`, {
        method: 'POST',
        body: form,
    });
    if (!response.ok) {
        throw new Error(`LoadDocument failed: HTTP ${response.status}`);
    }
    return response.text();
}

export async function saveNewVersion(id, base64Data, modifiedUser) {
    return handle(await fetch(`${CONTENT_BASE}/items/${id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentData: base64Data, modifiedUser })
    }));
}

export async function updateStatus(id, status) {
    return handle(await fetch(`${CONTENT_BASE}/items/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    }));
}

export async function updateMetadata(id, payload) {
    return handle(await fetch(`${CONTENT_BASE}/items/${id}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }));
}

export async function deleteItem(id) {
    return handle(await fetch(`${CONTENT_BASE}/items/${id}`, { method: 'DELETE' }));
}

export function downloadUrl(id, version) {
    const v = version ? `?version=${version}` : '';
    return `${CONTENT_BASE}/items/${id}/download${v}`;
}

export async function exportCombinedDocx(ids) {
    const response = await fetch(`${CONTENT_BASE}/export/combined-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids)
    });
    if (!response.ok) throw new Error('Combined DOCX export failed.');
    return response.blob();
}

// Merge selected DOCX items on the server and persist the result as a
// new ContentItem in the library. Returns the new item (same shape as
// listItems entries) so the UI can refresh + select it.
//
// `metadata` is optional: { title, category, status, author, version }.
// When omitted the server uses sensible defaults.
export async function mergeAndSaveDocx(ids, metadata) {
    const payload = { ids, ...(metadata || {}) };
    const response = await fetch(`${CONTENT_BASE}/merge-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Merge failed: HTTP ${response.status} ${text}`);
    }
    return response.json();
}

export async function exportExcel(ids) {
    const response = await fetch(`${CONTENT_BASE}/export/excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids)
    });
    if (!response.ok) throw new Error('Excel export failed.');
    return response.blob();
}

export function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
