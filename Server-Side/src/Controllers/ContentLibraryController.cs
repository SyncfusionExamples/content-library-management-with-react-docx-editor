using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using Syncfusion.DocIO;
using Syncfusion.DocIO.DLS;
using Syncfusion.Drawing;
using Syncfusion.XlsIO;
using EJ2APIServices.Models;
using EJ2APIServices.Services;

namespace EJ2APIServices.Controllers
{
    /// <summary>
    /// Content Library API for the POC.
    /// Handles upload, list, metadata, version management, native download,
    /// combined DOCX export, and Excel metadata export.
    /// The DocumentEditorController already exposes the import/export
    /// endpoints that the React DOCX editor uses at runtime; this controller
    /// adds the library-specific surfaces on top.
    /// </summary>
    [Route("api/[controller]")]
    [EnableCors("AllowAllOrigins")]
    public class ContentLibraryController : Controller
    {
        private readonly ContentLibraryService _library;
        private readonly IWebHostEnvironment _env;

        public ContentLibraryController(IWebHostEnvironment env)
        {
            _env = env;
            _library = new ContentLibraryService(env);
        }

        // ---------- 1. List all items ----------
        [HttpGet]
        [Route("items")]
        public IActionResult ListItems()
        {
            var items = _library.List();
            return Ok(items);
        }

        // ---------- 2. Get a single item (with version history) ----------
        [HttpGet]
        [Route("items/{id}")]
        public IActionResult GetItem(string id)
        {
            var item = _library.List().FirstOrDefault(i => i.Id == id);
            if (item == null) return NotFound();
            return Ok(item);
        }

        // ---------- 3. Upload a new document ----------
        [HttpPost]
        [Route("upload")]
        public IActionResult Upload(IFormCollection form)
        {
            if (form.Files.Count == 0)
                return BadRequest("No file uploaded.");

            IFormFile file = form.Files[0];
            string ext = Path.GetExtension(file.FileName)?.ToLowerInvariant();
            if (ext != ".docx" && ext != ".xlsx" && ext != ".pptx")
                return BadRequest("Only .docx, .xlsx, .pptx are supported.");

            var item = new ContentItem
            {
                Title = GetForm(form, "title"),
                Version = string.IsNullOrWhiteSpace(GetForm(form, "version")) ? "1.0" : GetForm(form, "version"),
                Category = GetForm(form, "category"),
                Status = string.IsNullOrWhiteSpace(GetForm(form, "status")) ? "Draft" : GetForm(form, "status"),
                Author = GetForm(form, "author")
            };

            if (string.IsNullOrWhiteSpace(item.Title))
                item.Title = Path.GetFileNameWithoutExtension(file.FileName);

            // Always store under the canonical v1.{ext} name and set CurrentFile
            // before persisting so the index record is consistent for both DOCX
            // and non-DOCX uploads.
            string storedFileName = "v1" + ext;

            // Folder name = sanitized title + short random suffix to keep
            // it human-readable while remaining unique. This is also used
            // as the API Id so URLs are easier to read/debug.
            string folderName = _library.BuildUniqueFolderName(item.Title);
            item.Id = folderName;
            item.CreatedDate = DateTime.Now;
            item.ModifiedDate = DateTime.Now;
            item.CurrentVersion = 1;
            item.CurrentFile = storedFileName;
            item.Versions = new List<ContentVersion>
            {
                new ContentVersion
                {
                    VersionNumber = 1,
                    FileName = storedFileName,
                    ModifiedUser = item.Author,
                    ModifiedDate = DateTime.Now,
                    // Seed the v1 status so the history dialog shows the
                    // correct state for the first version of a new upload.
                    Status = item.Status,
                }
            };

            var folder = _library.GetItemFolder(item.Id);
            Directory.CreateDirectory(folder);
            string destPath = Path.Combine(folder, storedFileName);
            using (var fs = new FileStream(destPath, FileMode.Create, FileAccess.Write))
            {
                file.CopyTo(fs);
            }

            var store = _library.Load();
            store.Items.Add(item);
            _library.Save(store);

            return Ok(item);
        }

        // ---------- 4. Save a new version (DOCX editor autosave) ----------
        [HttpPost]
        [Route("items/{id}/versions")]
        public IActionResult SaveNewVersion(string id, [FromBody] SaveVersionRequest body)
        {
            if (body == null || string.IsNullOrEmpty(body.DocumentData))
                return BadRequest("DocumentData (SFDT JSON) is required.");

            // The client posts the Syncfusion SFDT (DocIO JSON) directly.
            // Use the same conversion pattern as the existing
            // DocumentEditorController.Save endpoint:
            //   1. EJ2 WordDocument.Save(sfdt) -> WDocument
            //   2. WDocument.Save(stream, FormatType.Docx) -> DOCX bytes
            Syncfusion.DocIO.DLS.WordDocument document;
            try
            {
                document = Syncfusion.EJ2.DocumentEditor.WordDocument.Save(body.DocumentData);
            }
            catch (Exception ex)
            {
                return BadRequest("Failed to parse SFDT: " + ex.Message);
            }

            using var docxStream = new MemoryStream();
            try
            {
                document.Save(docxStream, Syncfusion.DocIO.FormatType.Docx);
            }
            catch (Exception ex)
            {
                document.Close();
                return BadRequest("Failed to save DOCX: " + ex.Message);
            }
            document.Close();

            docxStream.Position = 0;
            var item = _library.AddVersion(id, docxStream, body.ModifiedUser ?? "Unknown");
            return Ok(item);
        }

        public class SaveVersionRequest
        {
            public string DocumentData { get; set; }
            public string ModifiedUser { get; set; }
        }

        public class MergeRequest
        {
            public List<string> Ids { get; set; }
            public string Title { get; set; }
            public string Category { get; set; }
            public string Status { get; set; }
            public string Author { get; set; }
            public string Version { get; set; }
        }

        // ---------- 5. Download the original (or specific version) ----------
        [HttpGet]
        [Route("items/{id}/download")]
        public IActionResult Download(string id, [FromQuery] int? version = null)
        {
            var item = _library.List().FirstOrDefault(i => i.Id == id);
            if (item == null) return NotFound();

            int v = version ?? item.CurrentVersion;
            var versionInfo = item.Versions.FirstOrDefault(x => x.VersionNumber == v);
            if (versionInfo == null) return NotFound();

            string path = Path.Combine(_library.GetItemFolder(id), versionInfo.FileName);
            if (!System.IO.File.Exists(path)) return NotFound();

            string contentType = versionInfo.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : versionInfo.FileName.EndsWith(".pptx", StringComparison.OrdinalIgnoreCase)
                    ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

            string downloadName = SanitizeFileName(item.Title) + "_v" + v + Path.GetExtension(versionInfo.FileName);
            return PhysicalFile(path, contentType, downloadName);
        }

        // ---------- 6. Delete an item ----------
        [HttpDelete]
        [Route("items/{id}")]
        public IActionResult Delete(string id)
        {
            _library.Delete(id);
            return Ok();
        }

        // ---------- 7. Update status (workflow transition) ----------
        [HttpPost]
        [Route("items/{id}/status")]
        public IActionResult UpdateStatus(string id, [FromBody] StatusUpdate body)
        {
            if (body == null) return BadRequest();
            var item = _library.UpdateStatus(id, body.Status);
            if (item == null) return NotFound();
            return Ok(item);
        }

        public class StatusUpdate
        {
            public string Status { get; set; }
        }

        // ---------- 8. Update editable metadata ----------
        [HttpPost]
        [Route("items/{id}/metadata")]
        public IActionResult UpdateMetadata(string id, [FromBody] MetadataUpdate body)
        {
            if (body == null) return BadRequest();
            var item = _library.UpdateMetadata(id, body.Title, body.Category, body.Status, body.Author, body.Version);
            if (item == null) return NotFound();
            return Ok(item);
        }

        public class MetadataUpdate
        {
            public string Title { get; set; }
            public string Category { get; set; }
            public string Status { get; set; }
            public string Author { get; set; }
            public string Version { get; set; }
        }

        // ---------- 9. Combined DOCX export ----------
        [HttpPost]
        [Route("export/combined-docx")]
        public IActionResult ExportCombinedDocx([FromBody] List<string> ids)
        {
            if (ids == null || ids.Count == 0)
                return BadRequest("Select at least one item.");

            var all = _library.List();
            var selected = ids.Select(id => all.FirstOrDefault(i => i.Id == id))
                              .Where(i => i != null)
                              .ToList();
            if (selected.Count == 0)
                return BadRequest("None of the supplied items were found.");

            using var combined = new MemoryStream();
            using (var doc = new WordDocument())
            {
                IWSection section = doc.AddSection();
                section.PageSetup.Margins.All = 72f;

                for (int idx = 0; idx < selected.Count; idx++)
                {
                    var item = selected[idx];
                    string filePath = Path.Combine(_library.GetItemFolder(item.Id), item.CurrentFile);

                    // Metadata header
                    IWParagraph titlePara = section.AddParagraph();
                    titlePara.ApplyStyle(BuiltinStyle.Heading1);
                    titlePara.AppendText($"Title: {item.Title}");

                    IWParagraph metaPara = section.AddParagraph();
                    metaPara.AppendText(
                        $"Version: {item.Version}    Category: {item.Category}    Status: {item.Status}    Author: {item.Author}    Modified: {item.ModifiedDate:yyyy-MM-dd}");

                    section.AddParagraph(); // blank line

                    // Body — only DOCX items can be merged directly
                    if (item.CurrentFile.EndsWith(".docx", StringComparison.OrdinalIgnoreCase) &&
                        System.IO.File.Exists(filePath))
                    {
                        using var srcStream = new FileStream(filePath, FileMode.Open, FileAccess.Read);
                        using var srcDoc = new WordDocument(srcStream, FormatType.Docx);
                        srcDoc.Sections[0].BreakCode = SectionBreakCode.NoBreak;
                        doc.ImportContent(srcDoc, ImportOptions.UseDestinationStyles);
                    }
                    else
                    {
                        IWParagraph p = section.AddParagraph();
                        p.AppendText("[Non-DOCX content — download the original file to view.]");
                    }

                    // Separator between items
                    if (idx < selected.Count - 1)
                    {
                        IWParagraph sep = doc.LastSection.AddParagraph();
                        IWTextRange dash = sep.AppendText("------------------------------------------------");
                        dash.CharacterFormat.TextColor = Color.Gray;
                        doc.LastSection.AddParagraph();
                    }
                }

                doc.Save(combined, FormatType.Docx);
            }

            combined.Position = 0;
            string outName = "Combined.docx";
            return File(combined.ToArray(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                outName);
        }

        // ---------- 9b. Merge selected DOCX items and save as a new library item ----------
        // Performs the same merge as ExportCombinedDocx but persists the
        // resulting .docx as a new ContentItem in the library (under
        // App_Data/ContentLibrary/<id>/v1.docx) instead of returning a
        // download. The new item shows up in the list immediately and
        // can be opened, edited, downloaded, or merged again.
        //
        // Optional metadata override payload (all fields optional; any
        // missing field falls back to a sensible default):
        //   { "ids": [...], "title": "...", "category": "...", "status": "...",
        //     "author": "...", "version": "1.0" }
        [HttpPost]
        [Route("merge-docx")]
        public IActionResult MergeAndSaveDocx([FromBody] MergeRequest request)
        {
            var ids = request?.Ids;
            if (ids == null || ids.Count < 2)
                return BadRequest("Select at least two items to merge.");

            var all = _library.List();
            var selected = ids.Select(id => all.FirstOrDefault(i => i.Id == id))
                              .Where(i => i != null)
                              .ToList();
            if (selected.Count < 2)
                return BadRequest("None of the supplied items were found.");
            if (selected.Any(i => !(i.CurrentFile ?? string.Empty).EndsWith(".docx", StringComparison.OrdinalIgnoreCase)))
                return BadRequest("Merge only accepts DOCX items. Deselect any XLSX or PPTX files.");

            // Build the combined document using the same layout as the
            // download endpoint, then save the resulting bytes to the
            // library's storage via ContentLibraryService.AddVersion /
            // CreateNew.
            byte[] combinedBytes;
            using (var combined = new MemoryStream())
            using (var doc = new WordDocument())
            {
                IWSection section = doc.AddSection();
                section.PageSetup.Margins.All = 72f;

                for (int idx = 0; idx < selected.Count; idx++)
                {
                    var item = selected[idx];
                    string filePath = Path.Combine(_library.GetItemFolder(item.Id), item.CurrentFile);

                    IWParagraph titlePara = section.AddParagraph();
                    titlePara.ApplyStyle(BuiltinStyle.Heading1);
                    titlePara.AppendText($"Title: {item.Title}");

                    IWParagraph metaPara = section.AddParagraph();
                    metaPara.AppendText(
                        $"Version: {item.Version}    Category: {item.Category}    Status: {item.Status}    Author: {item.Author}    Modified: {item.ModifiedDate:yyyy-MM-dd}");

                    section.AddParagraph();

                    if (item.CurrentFile.EndsWith(".docx", StringComparison.OrdinalIgnoreCase) &&
                        System.IO.File.Exists(filePath))
                    {
                        using var srcStream = new FileStream(filePath, FileMode.Open, FileAccess.Read);
                        using var srcDoc = new WordDocument(srcStream, FormatType.Docx);
                        srcDoc.Sections[0].BreakCode = SectionBreakCode.NoBreak;
                        doc.ImportContent(srcDoc, ImportOptions.UseDestinationStyles);
                    }
                    else
                    {
                        IWParagraph p = section.AddParagraph();
                        p.AppendText("[Non-DOCX content — download the original file to view.]");
                    }

                    if (idx < selected.Count - 1)
                    {
                        IWParagraph sep = doc.LastSection.AddParagraph();
                        IWTextRange dash = sep.AppendText("------------------------------------------------");
                        dash.CharacterFormat.TextColor = Color.Gray;
                        doc.LastSection.AddParagraph();
                    }
                }

                doc.Save(combined, FormatType.Docx);
                combinedBytes = combined.ToArray();
            }

            // Persist as a new library item. Use a human-readable folder
            // name (BuildUniqueFolderName via CreateNew) so the result
            // shows up in the file system like any other document.
            // User-supplied metadata wins; missing fields fall back to
            // the previous defaults so this endpoint is still callable
            // without a payload.
            var newItem = new ContentItem
            {
                Title = string.IsNullOrWhiteSpace(request?.Title)
                    ? $"Combined \u2014 {selected.Count} items \u2014 {DateTime.Now:yyyy-MM-dd HH:mm}"
                    : request.Title.Trim(),
                Version = string.IsNullOrWhiteSpace(request?.Version) ? "1" : request.Version.Trim(),
                Category = string.IsNullOrWhiteSpace(request?.Category) ? "Other" : request.Category.Trim(),
                Status = string.IsNullOrWhiteSpace(request?.Status) ? "Draft" : request.Status.Trim(),
                Author = string.IsNullOrWhiteSpace(request?.Author) ? "Merge" : request.Author.Trim(),
                CurrentFile = "v1.docx",
                CurrentVersion = 1,
                CreatedDate = DateTime.Now,
                ModifiedDate = DateTime.Now,
                Versions = new List<ContentVersion>
                {
                    new ContentVersion
                    {
                        VersionNumber = 1,
                        FileName = "v1.docx",
                        ModifiedUser = string.IsNullOrWhiteSpace(request?.Author) ? "Merge" : request.Author.Trim(),
                        ModifiedDate = DateTime.Now,
                    }
                }
            };

            // Seed the v1 status snapshot for the freshly-merged item now
            // that newItem is fully constructed (can't reference it inside
            // the object initializer above).
            newItem.Versions[0].Status = newItem.Status;

            var store = _library.Load();
            newItem.Id = _library.BuildUniqueFolderName(newItem.Title, store);
            string folder = _library.GetItemFolder(newItem.Id);
            Directory.CreateDirectory(folder);
            string destPath = _library.GetVersionFile(newItem.Id, 1);
            System.IO.File.WriteAllBytes(destPath, combinedBytes);

            store.Items.Add(newItem);
            _library.Save(store);

            return Ok(newItem);
        }

        // ---------- 10. Excel metadata + plain-text export ----------
        [HttpPost]
        [Route("export/excel")]
        public IActionResult ExportExcel([FromBody] List<string> ids)
        {
            if (ids == null || ids.Count == 0)
                return BadRequest("Select at least one item.");

            var all = _library.List();
            var selected = ids.Select(id => all.FirstOrDefault(i => i.Id == id))
                              .Where(i => i != null)
                              .ToList();
            if (selected.Count == 0)
                return BadRequest("None of the supplied items were found.");

            using var engine = new ExcelEngine();
            IApplication app = engine.Excel;
            app.DefaultVersion = ExcelVersion.Xlsx;
            IWorkbook workbook = app.Workbooks.Create(1);
            IWorksheet sheet = workbook.Worksheets[0];
            sheet.Name = "ContentLibrary";

            // Header
            string[] headers = { "Title", "Version", "Category", "Status", "Author", "CreatedDate", "ModifiedDate", "PlainText" };
            for (int c = 0; c < headers.Length; c++)
            {
                sheet[1, c + 1].Text = headers[c];
                sheet[1, c + 1].CellStyle.Font.Bold = true;
                sheet[1, c + 1].CellStyle.Color = Color.LightBlue;
            }

            // Rows
            for (int r = 0; r < selected.Count; r++)
            {
                var item = selected[r];
                int row = r + 2;

                sheet[row, 1].Text = item.Title ?? string.Empty;
                sheet[row, 2].Text = item.Version ?? string.Empty;
                sheet[row, 3].Text = item.Category ?? string.Empty;
                sheet[row, 4].Text = item.Status ?? string.Empty;
                sheet[row, 5].Text = item.Author ?? string.Empty;
                sheet[row, 6].Text = item.CreatedDate.ToString("yyyy-MM-dd");
                sheet[row, 7].Text = item.ModifiedDate.ToString("yyyy-MM-dd");
                sheet[row, 8].Text = ExtractPlainText(item);
            }

            // Auto-fit columns
            sheet.UsedRange.AutofitColumns();

            using var outStream = new MemoryStream();
            workbook.SaveAs(outStream);
            workbook.Close();
            outStream.Position = 0;
            return File(outStream.ToArray(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "ContentExport.xlsx");
        }

        // ---------- Helpers ----------
        private string GetForm(IFormCollection form, string key)
        {
            if (form.TryGetValue(key, out var v) && v.Count > 0) return v[0];
            return null;
        }

        private string SanitizeFileName(string s)
        {
            if (string.IsNullOrEmpty(s)) return "Document";
            foreach (char c in Path.GetInvalidFileNameChars())
                s = s.Replace(c, '_');
            return s;
        }

        /// <summary>
        /// Extract readable plain text only (no formatting, styles, tables, images, colors)
        /// as required by Requirement 6.
        /// </summary>
        private string ExtractPlainText(ContentItem item)
        {
            try
            {
                string filePath = Path.Combine(_library.GetItemFolder(item.Id), item.CurrentFile);
                if (!System.IO.File.Exists(filePath) ||
                    !filePath.EndsWith(".docx", StringComparison.OrdinalIgnoreCase))
                {
                    return string.Empty;
                }

                using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read);
                using var doc = new WordDocument(stream, FormatType.Docx);
                // GetText returns plain text with section/paragraph breaks.
                string text = doc.GetText();
                if (string.IsNullOrEmpty(text)) return string.Empty;
                // Normalize whitespace for Excel readability.
                text = text.Replace("\r", " ").Replace("\n", " ").Replace("\t", " ");
                while (text.Contains("  ")) text = text.Replace("  ", " ");
                return text.Trim();
            }
            catch
            {
                return string.Empty;
            }
        }
    }
}
