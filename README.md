# SwiftPDF

A private, static Word-to-PDF converter. Drop in a batch of `.docx` files, get PDFs back — and nothing ever leaves the browser.

**[Live demo](https://YOUR-USERNAME.github.io/swiftpdf/)** ← update this link after you deploy

![Screens: select, file queue with options, done](docs/screens.png)

---

## Why it exists

Most online converters upload your document to a server, convert it there, and hand you a download link. That means your contracts, CVs and internal reports pass through somebody else's machine.

SwiftPDF has no server. The conversion runs in the visitor's browser, the file is read from disk into memory, and the finished PDF goes straight to their downloads folder. You can disconnect from the internet after the page loads and it still works.

## Features

- **Batch conversion** — queue any number of files, convert them one after another
- **ZIP download** — the whole batch in one archive, or each PDF on its own
- **Page setup** — A4 / Letter / A3, portrait or landscape, three margin presets, three quality levels
- **Preview before converting** — click the eye icon on any file
- **Per-file error isolation** — one unreadable document does not sink the rest of the batch
- **Drag anywhere** — drop files onto any part of the page
- **Light and dark theme**, keyboard accessible, screen-reader labelled, respects `prefers-reduced-motion`
- Zero build step, zero dependencies to install, zero backend

## How it works

```
.docx  →  mammoth.js  →  HTML  →  html2pdf.js  →  PDF Blob  →  JSZip  →  .zip
```

A Word file is not turned into a PDF directly. `mammoth.js` reads the `.docx` (which is really a ZIP full of XML) and produces clean semantic HTML. That HTML is written into an off-screen render stage sized to the printable width of the chosen page, `html2pdf.js` captures it and emits a PDF blob, and `JSZip` bundles the blobs when there is more than one.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup for all four screens, plus the three CDN `<script>` tags |
| `style.css` | Every style, including the theme tokens |
| `script.js` | Queue management, conversion pipeline, ZIP packaging |

That is the entire project.

## Run it locally

```bash
python -m http.server 8000    # or: npx serve
```

Then open <http://localhost:8000>. In VS Code, the **Live Server** extension works too — right-click `index.html` → *Open with Live Server*.

## Deploy to GitHub Pages

1. Create a repository, e.g. `swiftpdf`.
2. Put `index.html`, `style.css` and `script.js` in the root and push.
3. **Settings → Pages → Build and deployment**: Source `Deploy from a branch`, Branch `main`, folder `/ (root)`.
4. **Save.** A minute later the site is live at `https://YOUR-USERNAME.github.io/swiftpdf/`.

```bash
git init
git add .
git commit -m "SwiftPDF — private Word to PDF converter"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/swiftpdf.git
git push -u origin main
```

The same files deploy unchanged to Netlify (drag the folder onto [app.netlify.com/drop](https://app.netlify.com/drop)), Vercel or Cloudflare Pages.

## Configuration

Conversion settings live in `buildPdfOptions()` and `readOptions()` in `script.js`.

| Where | Setting | Notes |
| --- | --- | --- |
| `MAX_SIZE_MB` | `25` | Per-file upload limit |
| `PAGE_SIZES` | A4 / Letter / A3 | Add more as `[widthMm, heightMm]` |
| `image.type` | `'png'` | PNG is both smaller *and* sharper than JPEG for text-heavy pages — measured 2.4 MB vs 4.9 MB on a 9-page document |
| `html2canvas.scale` | from the Quality select | `1.5` / `2` / `3` |
| `pagebreak.mode` | `['css', 'legacy']` | The `page-break-*` rules in `style.css` keep headings, images and table rows from splitting |

### Two traps worth knowing about

Both of these produce a PDF that *looks* structurally fine but is visibly wrong, so they are easy to ship by accident.

**Never set `html2canvas.windowWidth`** to anything other than the real viewport width. html2canvas lays the cloned document out in a window of that size and then mis-maps the coordinates — headings, list items and the first part of every wrapped line vanish silently. The render stage already has an explicit width, and that is what controls the captured layout.

**Never style `.docview` with padding, shadows, rounded corners or theme colours.** `.docview` is the element that gets captured, so anything on it is baked into the PDF, and its padding stacks on top of the page margin. All the visible "sheet of paper" styling belongs on `.paper`. For the same reason `.docview` pins its own font stack and hard-coded colours, so the PDF looks identical whether the visitor is in light or dark mode.

## Known limitations

Inherent to the browser-only approach, not bugs:

| | |
| --- | --- |
| **Text is not selectable in the PDF** | Each page is rendered as a high-resolution image. For selectable text, use `jsPDF`'s `.html()` method or a server-side converter such as LibreOffice. |
| **Not pixel-identical to Word** | `mammoth.js` maps *structure* — a "Heading 1" becomes `<h1>` — rather than Word's exact visual formatting. Clean output, not a facsimile. |
| **No headers, footers or page numbers** | `mammoth.js` does not extract them. Page numbers can be added afterwards with `jsPDF`. |
| **No old `.doc` files** | Open in Word and *Save As* → `.docx`. |
| **Large batches are slow** | Rendering happens on the main thread, one file at a time to keep memory in check. |

## Customising the converted HTML

`mammoth.js` takes a `styleMap` so your own Word styles become your own tags:

```js
mammoth.convertToHtml({ arrayBuffer: buffer }, {
  styleMap: [
    "p[style-name='Section Title'] => h1:fresh",
    "p[style-name='Intro'] => p.intro:fresh"
  ]
});
```

Style the result under `.docview` in `style.css` and it carries through to the PDF.

## Dependencies

Loaded from jsDelivr at pinned versions — no install step:

- [mammoth.js](https://github.com/mwilliamson/mammoth.js) `1.9.0` — `.docx` → HTML
- [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) `0.10.3` — HTML → PDF (bundles html2canvas + jsPDF)
- [JSZip](https://github.com/Stuk/jszip) `3.10.1` — batch ZIP

To self-host them, download the three files into the project and point the `<script src>` values at the local copies.

## Licence

MIT — see [LICENSE](LICENSE).
