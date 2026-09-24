









export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}

export function parseChangelog(markdown) {
  const entries = [];
  let entry = null;
  let section = null;

  for (const raw of String(markdown).split("\n")) {
    const heading = raw.match(/^##\s+\[([^\]]+)\]\s*(?:-\s*(.*))?$/);
    if (heading) {
      entry = {
        version: heading[1].trim(),
        date: (heading[2] || "").trim(),
        sections: [],
      };
      section = null;
      entries.push(entry);
      continue;
    }
    if (!entry) continue;

    const sectionHeading = raw.match(/^###\s+(.+)$/);
    if (sectionHeading) {
      section = { name: sectionHeading[1].trim(), items: [] };
      entry.sections.push(section);
      continue;
    }

    const item = raw.match(/^\s*[-*]\s+(.+)$/);
    if (item && section) {
      section.items.push(item[1].trim());
      continue;
    }

    
    const continuation = raw.match(/^\s+(.+)$/);
    if (continuation && section && section.items.length > 0) {
      section.items[section.items.length - 1] += " " + continuation[1].trim();
    }
  }

  return entries;
}


export function latestReleaseEntry(markdown) {
  const entries = parseChangelog(markdown);
  const released = entries.filter((e) => !/^unreleased$/i.test(e.version));
  return released[0] || null;
}