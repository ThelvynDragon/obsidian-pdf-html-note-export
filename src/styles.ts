/**
 * Custom theme for exported documents.
 * Clean, professional styling independent of Obsidian theme.
 */
export const EXPORT_CSS = `
/* ============================================
   Note Export — Custom Document Theme
   ============================================ */

:root {
  --ne-font-text: "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif;
  --ne-font-mono: "Fira Code", "Consolas", "Monaco", "Courier New", monospace;
  --ne-color-text: #1a1a2e;
  --ne-color-text-muted: #555770;
  --ne-color-heading: #0f0f23;
  --ne-color-link: #2563eb;
  --ne-color-bg: #ffffff;
  --ne-color-bg-code: #f4f4f8;
  --ne-color-bg-blockquote: #f8f8fc;
  --ne-color-border: #d1d5db;
  --ne-color-border-light: #e5e7eb;
  --ne-color-accent: #2563eb;
  --ne-color-tag-bg: #e0e7ff;
  --ne-color-tag-text: #3730a3;
  --ne-line-height: 1.7;
  --ne-max-width: 800px;
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--ne-color-bg);
  color: var(--ne-color-text);
  font-family: var(--ne-font-text);
  font-size: 16px;
  line-height: var(--ne-line-height);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.ne-container {
  max-width: var(--ne-max-width);
  margin: 0 auto;
  padding: 40px 32px;
}

/* --- Headings --- */
h1, h2, h3, h4, h5, h6 {
  color: var(--ne-color-heading);
  font-weight: 700;
  line-height: 1.3;
  margin-top: 1.8em;
  margin-bottom: 0.6em;
}

h1 {
  font-size: 2em;
  padding-bottom: 0.3em;
  border-bottom: 2px solid var(--ne-color-accent);
}

h2 {
  font-size: 1.5em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid var(--ne-color-border-light);
}

h3 { font-size: 1.25em; }
h4 { font-size: 1.1em; }
h5 { font-size: 1em; color: var(--ne-color-text-muted); }
h6 { font-size: 0.95em; color: var(--ne-color-text-muted); }

/* --- Paragraphs & Text --- */
p {
  margin: 0.8em 0;
}

strong { font-weight: 700; }
em { font-style: italic; }
mark {
  background: #fef08a;
  padding: 0.1em 0.3em;
  border-radius: 3px;
}

/* --- Links --- */
a {
  color: var(--ne-color-link);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s;
}
a:hover {
  border-bottom-color: var(--ne-color-link);
}

/* --- Lists --- */
ul, ol {
  padding-left: 1.8em;
  margin: 0.6em 0;
}
li {
  margin: 0.3em 0;
}
li > ul, li > ol {
  margin: 0.2em 0;
}

/* Task lists */
ul.contains-task-list,
ul.task-list {
  list-style: none;
  padding-left: 0.5em;
}
.task-list-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
}
input[type="checkbox"] {
  margin-top: 0.35em;
  accent-color: var(--ne-color-accent);
}

/* --- Code --- */
code {
  font-family: var(--ne-font-mono);
  font-size: 0.88em;
  background: var(--ne-color-bg-code);
  padding: 0.15em 0.4em;
  border-radius: 4px;
  color: #c7254e;
}

pre {
  background: var(--ne-color-bg-code);
  border: 1px solid var(--ne-color-border-light);
  border-radius: 8px;
  padding: 16px 20px;
  overflow-x: auto;
  margin: 1em 0;
  line-height: 1.5;
}
pre code {
  background: none;
  padding: 0;
  color: var(--ne-color-text);
  font-size: 0.85em;
}

/* --- Blockquotes --- */
blockquote {
  margin: 1em 0;
  padding: 12px 20px;
  border-left: 4px solid var(--ne-color-accent);
  background: var(--ne-color-bg-blockquote);
  border-radius: 0 8px 8px 0;
  color: var(--ne-color-text-muted);
}
blockquote p {
  margin: 0.4em 0;
}

/* --- Callouts (Obsidian) --- */
.callout {
  margin: 1em 0;
  padding: 16px 20px;
  border-radius: 8px;
  border: 1px solid var(--ne-color-border-light);
  background: var(--ne-color-bg-blockquote);
}
.callout-title {
  font-weight: 700;
  margin-bottom: 0.4em;
  display: flex;
  align-items: center;
  gap: 0.4em;
}

/* --- Tables --- */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.95em;
}
th, td {
  border: 1px solid var(--ne-color-border);
  padding: 10px 14px;
  text-align: left;
}
th {
  background: var(--ne-color-bg-code);
  font-weight: 700;
  color: var(--ne-color-heading);
}
tr:nth-child(even) {
  background: #fafafa;
}

/* --- Horizontal Rules --- */
hr {
  border: none;
  height: 1px;
  background: var(--ne-color-border);
  margin: 2em 0;
}

/* --- Images --- */
img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 1em 0;
}

/* --- Tags --- */
.tag, a.tag {
  display: inline-block;
  background: var(--ne-color-tag-bg);
  color: var(--ne-color-tag-text);
  padding: 0.1em 0.6em;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
  text-decoration: none;
  border: none;
}

/* --- Footnotes --- */
.footnotes {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid var(--ne-color-border-light);
  font-size: 0.9em;
  color: var(--ne-color-text-muted);
}

/* --- Metadata header --- */
.ne-metadata {
  margin-bottom: 2em;
  padding-bottom: 1em;
  border-bottom: 1px solid var(--ne-color-border-light);
  color: var(--ne-color-text-muted);
  font-size: 0.9em;
}
.ne-metadata .ne-title {
  font-size: 2.2em;
  font-weight: 800;
  color: var(--ne-color-heading);
  margin: 0 0 0.3em 0;
  line-height: 1.2;
}
.ne-metadata .ne-tags {
  margin-top: 0.5em;
}
.ne-metadata .ne-date {
  font-size: 0.85em;
}

/* --- Print-specific styles --- */
@media print {
  html, body {
    font-size: 12pt;
    color: #000;
    background: #fff;
  }
  .ne-container {
    max-width: 100%;
    padding: 0;
    margin: 0;
  }
  a { color: #000; text-decoration: underline; }
  pre {
    white-space: pre-wrap;
    word-wrap: break-word;
    border: 1px solid #ccc;
  }
  img { max-width: 100%; }
  h1, h2, h3, h4 { page-break-after: avoid; }
  pre, blockquote, table { page-break-inside: avoid; }
  .ne-no-print { display: none; }
}
`;
