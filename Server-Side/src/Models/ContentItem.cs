using System;
using System.Collections.Generic;

namespace EJ2APIServices.Models
{
    /// <summary>
    /// A reusable content item stored in the Content Library.
    /// Files are kept on disk under App_Data/ContentLibrary/{id}/
    /// with one folder per version (v1.docx, v2.docx, ...).
    /// </summary>
    public class ContentItem
    {
        public string Id { get; set; } = Guid.NewGuid().ToString("N");

        public string Title { get; set; }

        public string Version { get; set; }

        public string Category { get; set; }

        public string Status { get; set; }

        public string Author { get; set; }

        public DateTime CreatedDate { get; set; } = DateTime.Now;

        public DateTime ModifiedDate { get; set; } = DateTime.Now;

        public string CurrentFile { get; set; }

        public int CurrentVersion { get; set; } = 1;

        public List<ContentVersion> Versions { get; set; } = new List<ContentVersion>();
    }

    public class ContentVersion
    {
        public int VersionNumber { get; set; }

        public string FileName { get; set; }

        public string ModifiedUser { get; set; }

        public DateTime ModifiedDate { get; set; } = DateTime.Now;
    }

    /// <summary>
    /// Root JSON document stored in App_Data/ContentLibrary/library.json.
    /// </summary>
    public class ContentLibraryStore
    {
        public List<ContentItem> Items { get; set; } = new List<ContentItem>();
    }
}
