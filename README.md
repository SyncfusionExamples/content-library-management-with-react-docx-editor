# Content Library Management

## Introduction

Content Library Management is a React + ASP.NET Core sample that provides a
centralized workspace for uploading, editing, versioning, and exporting
reusable DOCX content items using the Syncfusion<sup style="font-size:70%">&reg;</sup>
[React DOCX Editor](https://www.syncfusion.com/docx-editor-sdk/react-docx-editor?utm_source=github&utm_medium=listing&utm_campaign=github-github-documenteditor-examples) (Document Editor).

The sample is designed for organizations that need a reusable content
repository — for example, SOPs, HR policies, training material, safety
procedures, and finance templates — that multiple business documents
draw from over time.

Users can:

-   View all content items from a single dashboard table.
-   Upload new DOCX files with metadata (title, version, category, status, author).
-   Open a DOCX in the Syncfusion Word-like Document Editor with full ribbon toolbar, track changes, and comments.
-   Edit metadata for any item from a dialog (no need to open the editor).
-   Edit status of a document directly from the editor toolbar.
-   See the full version history of a DOCX item and open any previous version in the editor.
-   Merge multiple DOCX items into a single new document stored in the library, with custom title, category, status, and author supplied via a dialog.
-   Export selected items to a single combined DOCX or to an Excel workbook of metadata + plain text.
-   Download the original (or a specific historical version) of any file.
-   Delete content items.

## Key Features

### Upload and Metadata

Uploading accepts `.docx`. Each item carries:

-   Title, Version, Category (SOP / HR / Safety / Training / Manufacturing / Finance / Other)
-   Status (Draft / Review / Approved)
-   Author, Created Date, Modified Date
-   List of stored versions (one file per save)

The metadata dialog lets users edit any of these fields for an existing
item without re-uploading.

### DOCX Editing with Syncfusion Document Editor

Selecting a DOCX row and clicking **Edit** opens the Syncfusion
Word-like Document Editor inside a modal dialog. The editor ships with
the full Ribbon toolbar (File / Home / Insert / Review / View …),
comments, and track changes support.

Track changes are driven by status:

-   **Draft** — track changes is off. Free editing.
-   **Review** or **Approved** — track changes is on. Every edit is recorded as a revision.
-   **Old version opened via History** — track changes is locked off (the version is a frozen snapshot).

The status dropdown in the editor footer saves the change to the
backend immediately, and the change is reflected in the home page row
without needing to save the document.

### Version History

Each save creates a new `v{n}.docx` on disk and adds a record to the
item's `Versions[]` array. The home-page toolbar exposes a **History**
button (enabled when exactly one DOCX is selected). It opens a dialog
that lists every stored version with its frozen status, author, and
modified timestamp, and lets the user open any historical version in
the editor or download it.

Versions are status-aware: a change to status is recorded against the
*current* version. Older versions keep the status they were saved with,
so the history view shows what state each version was in when it was
authored.

### Merge Selected DOCX Items

Users can select two or more DOCX items and click **Merge documents**.
A dialog asks for the new combined document's title, category, status,
author, and version. The server then concatenates the selected DOCX
content (separated by a metadata header per source) and persists the
result as a new library item. Once the merge completes, the editor
auto-opens the new document for review.

### Export to Combined DOCX or Excel

-   **Merge documents** (DOCX-only, ≥2 items) — saves a new library item (see above).
-   **Export Excel** (DOCX-only) — produces a single `.xlsx` whose rows are the selected DOCX items, with columns for Title, Version, Category, Status, Author, Created/Modified dates, and a plain-text extract of the document body.

## Architecture

The sample consists of two applications:

- **ASP.NET Core Web API** (`Server-Side/`) — exposes the Content Library REST endpoints and the Document Editor service endpoints.
- **React application** (`Client-Side/`) — Vite + React 19 UI with the Syncfusion Document Editor for in-browser DOCX editing.

The Vite dev server proxies `/api/*` to the backend so the browser sees same-origin requests (no CORS). Files are stored on disk under `App_Data/ContentLibrary/{id}/v{n}.docx`; the metadata index lives in `App_Data/ContentLibrary/library.json`.

## Prerequisites

### Client

-   Node.js (LTS recommended)
-   npm

### Server

-   .NET 10 SDK
-   ASP.NET Core runtime
-   Syncfusion ASP.NET Core and DocIO packages referenced by the project

## How to Run

Start the ASP.NET Core Web API server first because the React application
uses the server for DOCX import, save, status, merge, and export
operations.

### 1. Start the ASP.NET Core Server

Open a terminal in:

``` text
serverside/src/
```

Build and run:

``` bash
dotnet restore
dotnet build
dotnet run
```

The configured development URL is:

``` text
http://localhost:62870
```

Keep this terminal running while using the React application.

### 2. Start the React Application

Open another terminal in:

``` text
clientside/
```

Install dependencies:

``` bash
npm install
```

Start the development server:

``` bash
npm run dev
```

Open the URL shown by Vite in the terminal, normally:

``` text
http://localhost:5173/content-library-management-with-react-docx-editor/
```

The React app's Vite config proxies all `/api/*` requests to the backend
on port `62870`. If you change the backend port, update
`vite.config.js` accordingly.

## Server API

The Content Library controller exposes the following endpoints. The
Document Editor endpoints listed at the bottom are used by the Syncfusion
Document Editor at runtime.

### Content Library endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/contentlibrary/items` | List all content items (newest modified first). |
| `GET /api/contentlibrary/items/{id}` | Get a single item, including its `Versions[]` array. |
| `POST /api/contentlibrary/upload` | Upload a new DOCX with metadata. |
| `POST /api/contentlibrary/items/{id}/versions` | Save a new DOCX version (SFDT → DOCX). |
| `GET /api/contentlibrary/items/{id}/download` | Download the original or a specific version (`?version=N`). |
| `DELETE /api/contentlibrary/items/{id}` | Delete the item and its folder. |
| `POST /api/contentlibrary/items/{id}/status` | Update workflow status (Draft / Review / Approved). |
| `POST /api/contentlibrary/items/{id}/metadata` | Update editable metadata. |
| `POST /api/contentlibrary/export/combined-docx` | Return a single combined DOCX for the given ids (download). |
| `POST /api/contentlibrary/merge-docx` | Merge selected DOCX items and persist the result as a new library item. |
| `POST /api/contentlibrary/export/excel` | Return a single XLSX with metadata + plain-text for the given ids. |

### Document Editor service endpoints (used by the Syncfusion editor)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/documenteditor/Import` | Imports a DOCX and converts it to SFDT. |
| `POST /api/documenteditor/Save` | Saves the edited SFDT content as a DOCX. |
| `POST /api/documenteditor/LoadDocument` | Loads an existing SFDT by document name. |

## Storage Layout

```text
serverside/src/
  App_Data/
    ContentLibrary/
      library.json                          # metadata index (all items + versions)
      {human-readable-title}/              # one folder per item
        v1.docx                             # one file per save
        v2.docx
        v3.docx
```

Folder names are derived from each item's title (sanitized + a short
random suffix) so `App_Data/ContentLibrary` is easy to read on disk.

## Resources

- **Product page:** [Syncfusion React DOCX Editor](https://www.syncfusion.com/docx-editor-sdk/react-docx-editor?utm_source=github&utm_medium=listing&utm_campaign=github-github-documenteditor-examples)
- **Documentation:** [Syncfusion React DOCX Editor - Documentation](https://help.syncfusion.com/document-processing/word/word-processor/react/overview?utm_source=github&utm_medium=listing&utm_campaign=github-github-documenteditor-examples)
- **Online demo:** [Syncfusion React DOCX Editor - Online demo](https://document.syncfusion.com/demos/docx-editor/react/#/tailwind3/document-editor/default?utm_source=github&utm_medium=listing&utm_campaign=github-github-documenteditor-examples)

## Support and feedback

For any other queries, reach our [Syncfusion support team](https://support.syncfusion.com/?utm_source=github&utm_medium=listing&utm_campaign=github-github-documenteditor-examples) or post the queries through the [community forums](https://www.syncfusion.com/forums?utm_source=github&utm_medium=listing&utm_campaign=github-github-documenteditor-examples). 

Request new feature through [Syncfusion feedback portal](https://www.syncfusion.com/feedback?utm_source=github&utm_medium=listing&utm_campaign=github-github-documenteditor-examples). 

## License

This is a commercial product and requires a paid license for possession or use. Syncfusion's licensed software, including this component, is subject to the terms and conditions of [Syncfusion's EULA](https://www.syncfusion.com/license/studio/35.1.37/syncfusion_essential_studio_eula.pdf?utm_source=github&utm_medium=listing&utm_campaign=github-github-documenteditor-examples). You can purchase a license [here](https://www.syncfusion.com/sales/products?utm_source=github&utm_medium=listing&utm_campaign=github-github-documenteditor-examples) or start a free 30-day trial [here](https://www.syncfusion.com/account/manage-trials/start-trials?utm_source=github&utm_medium=listing&utm_campaign=github-github-documenteditor-examples).
