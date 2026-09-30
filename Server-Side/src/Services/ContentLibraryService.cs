using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using EJ2APIServices.Models;
using Newtonsoft.Json;

namespace EJ2APIServices.Services
{
    /// <summary>
    /// File-system backed storage for the Content Library POC.
    /// Files are stored in App_Data/ContentLibrary/{id}/v{n}.docx and
    /// metadata is persisted in App_Data/ContentLibrary/library.json.
    /// All public methods are thread-safe (a single lock guards the index).
    /// </summary>
    public class ContentLibraryService
    {
        private static readonly object _lock = new object();

        private readonly string _rootPath;
        private readonly string _indexPath;

        public ContentLibraryService(Microsoft.AspNetCore.Hosting.IWebHostEnvironment env)
        {
            _rootPath = Path.Combine(env.ContentRootPath, "App_Data", "ContentLibrary");
            _indexPath = Path.Combine(_rootPath, "library.json");
            Directory.CreateDirectory(_rootPath);
        }

        public string RootPath => _rootPath;

        public string GetItemFolder(string id) => Path.Combine(_rootPath, id);

        public string GetVersionFile(string id, int version) => Path.Combine(GetItemFolder(id), $"v{version}.docx");

        public ContentLibraryStore Load()
        {
            lock (_lock)
            {
                if (!File.Exists(_indexPath))
                    return new ContentLibraryStore();
                var json = File.ReadAllText(_indexPath, Encoding.UTF8);
                if (string.IsNullOrWhiteSpace(json))
                    return new ContentLibraryStore();
                var store = JsonConvert.DeserializeObject<ContentLibraryStore>(json) ?? new ContentLibraryStore();

                // One-time migration: convert old GUID-based IDs/folders
                // to a human-readable name derived from the document
                // title. Idempotent — re-running on already-renamed data
                // is a no-op because the rename check rejects names
                // that don't look like GUIDs.
                MigrateToHumanReadableIds(store);

                return store;
            }
        }

        /// <summary>
        /// Rename any item whose Id is a 32-character GUID (old format)
        /// to a folder-friendly Id derived from its title. Renames the
        /// on-disk folder too so the file storage matches the index.
        /// </summary>
        private void MigrateToHumanReadableIds(ContentLibraryStore store)
        {
            bool changed = false;
            var existing = new HashSet<string>(
                store.Items.Select(i => i.Id),
                StringComparer.OrdinalIgnoreCase);

            foreach (var item in store.Items)
            {
                if (string.IsNullOrEmpty(item.Id)) continue;
                if (item.Id.Length != 32 || !IsHex(item.Id)) continue; // only migrate GUIDs
                if (!Directory.Exists(GetItemFolder(item.Id))) continue;

                string newId = BuildUniqueFolderName(item.Title, store);
                if (string.Equals(newId, item.Id, StringComparison.OrdinalIgnoreCase))
                    continue;

                string oldFolder = GetItemFolder(item.Id);
                string newFolder = GetItemFolder(newId);
                try
                {
                    Directory.Move(oldFolder, newFolder);
                    item.Id = newId;
                    existing.Add(newId);
                    changed = true;
                }
                catch
                {
                    // If the rename fails, leave the item as-is so the
                    // data is still accessible via the old ID.
                }
            }

            if (changed) Save(store);
        }

        private static bool IsHex(string s)
        {
            foreach (char c in s)
            {
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
                    return false;
            }
            return true;
        }

        public void Save(ContentLibraryStore store)
        {
            lock (_lock)
            {
                var json = JsonConvert.SerializeObject(store, Formatting.Indented);
                File.WriteAllText(_indexPath, json, Encoding.UTF8);
            }
        }

        public ContentItem CreateNew(ContentItem item)
        {
            // CreateNew is unused by the current upload path (the controller
            // assigns a human-readable Id directly), but keep the helper
            // valid for other callers by generating a unique folder name
            // from the title + a short random suffix.
            var store = Load();
            item.Id = BuildUniqueFolderName(item.Title, store);
            item.CreatedDate = DateTime.Now;
            item.ModifiedDate = DateTime.Now;
            item.CurrentVersion = 1;
            item.Versions = new List<ContentVersion>
            {
                new ContentVersion
                {
                    VersionNumber = 1,
                    FileName = "v1.docx",
                    ModifiedUser = item.Author,
                    ModifiedDate = DateTime.Now
                }
            };
            item.CurrentFile = "v1.docx";
            Directory.CreateDirectory(GetItemFolder(item.Id));
            store.Items.Add(item);
            Save(store);
            return item;
        }

        /// <summary>
        /// Adds a new version (v{n+1}.docx) to an existing item using the supplied file stream.
        /// Also updates the user-facing Version string to the new integer (1, 2, 3, ...)
        /// so the table column reflects the save. Status and metadata-only
        /// changes (handled by UpdateStatus / UpdateMetadata) leave the
        /// version untouched, as required.
        /// </summary>
        public ContentItem AddVersion(string id, Stream fileStream, string modifiedUser)
        {
            var store = Load();
            var item = store.Items.FirstOrDefault(i => i.Id == id);
            if (item == null)
                throw new FileNotFoundException($"Content item '{id}' not found.");

            int next = item.CurrentVersion + 1;
            string fileName = $"v{next}.docx";
            string destPath = GetVersionFile(id, next);
            Directory.CreateDirectory(GetItemFolder(id));

            using (var fs = new FileStream(destPath, FileMode.Create, FileAccess.Write))
            {
                fileStream.Position = 0;
                fileStream.CopyTo(fs);
            }

            item.CurrentVersion = next;
            item.CurrentFile = fileName;
            // Sync the displayed Version to the new integer counter so the
            // UI shows 1, 2, 3, ... after each save (not 1.0 / 1.1 / 1.2).
            item.Version = next.ToString();
            item.ModifiedDate = DateTime.Now;
            item.Versions.Add(new ContentVersion
            {
                VersionNumber = next,
                FileName = fileName,
                ModifiedUser = modifiedUser,
                ModifiedDate = DateTime.Now
            });
            Save(store);
            return item;
        }

        public ContentItem UpdateStatus(string id, string status)
        {
            var store = Load();
            var item = store.Items.FirstOrDefault(i => i.Id == id);
            if (item == null) return null;
            item.Status = status;
            item.ModifiedDate = DateTime.Now;
            Save(store);
            return item;
        }

        public ContentItem UpdateMetadata(string id, string title, string category, string status, string author, string version)
        {
            var store = Load();
            var item = store.Items.FirstOrDefault(i => i.Id == id);
            if (item == null) return null;
            if (!string.IsNullOrEmpty(title)) item.Title = title;
            if (!string.IsNullOrEmpty(category)) item.Category = category;
            if (!string.IsNullOrEmpty(status)) item.Status = status;
            if (!string.IsNullOrEmpty(author)) item.Author = author;
            if (!string.IsNullOrEmpty(version)) item.Version = version;
            item.ModifiedDate = DateTime.Now;
            Save(store);
            return item;
        }

        public void Delete(string id)
        {
            var store = Load();
            var item = store.Items.FirstOrDefault(i => i.Id == id);
            if (item == null) return;
            store.Items.Remove(item);
            Save(store);
            try
            {
                var dir = GetItemFolder(id);
                if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
            }
            catch { /* ignore cleanup errors */ }
        }

        public List<ContentItem> List() => Load().Items
            .OrderByDescending(i => i.ModifiedDate)
            .ToList();

        /// <summary>
        /// Build a unique, human-readable folder name (and Id) for a new
        /// content item. The folder name is derived from the document
        /// title with a short random suffix for uniqueness. This makes
        /// App_Data/ContentLibrary/{folder} easy to recognize on disk.
        /// </summary>
        public string BuildUniqueFolderName(string title, ContentLibraryStore existing = null)
        {
            string baseName = SanitizeFolderName(title);
            if (string.IsNullOrEmpty(baseName)) baseName = "Document";
            baseName = baseName.Length > 60 ? baseName.Substring(0, 60) : baseName;

            var store = existing ?? Load();
            var existingNames = new HashSet<string>(
                store.Items.Select(i => i.Id),
                StringComparer.OrdinalIgnoreCase);

            if (!existingNames.Contains(baseName) && !Directory.Exists(GetItemFolder(baseName)))
                return baseName;

            // Append a 4-character suffix to keep it unique.
            var rng = new Random();
            for (int attempt = 0; attempt < 50; attempt++)
            {
                string suffix = rng.Next(0x1000, 0xFFFF).ToString("x4");
                string candidate = baseName + "-" + suffix;
                if (!existingNames.Contains(candidate) && !Directory.Exists(GetItemFolder(candidate)))
                    return candidate;
            }

            // Fallback: title + full GUID.
            return baseName + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
        }

        /// <summary>
        /// Convert a human title into a safe folder name. Replaces invalid
        /// filesystem chars with '-', collapses whitespace, and trims.
        /// </summary>
        public static string SanitizeFolderName(string s)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            var sb = new StringBuilder(s.Length);
            foreach (char c in s)
            {
                if (char.IsLetterOrDigit(c)) sb.Append(c);
                else if (c == ' ' || c == '-' || c == '_' || c == '.') sb.Append('-');
            }
            string result = sb.ToString().Trim('-');
            while (result.Contains("--")) result = result.Replace("--", "-");
            return result;
        }
    }
}
