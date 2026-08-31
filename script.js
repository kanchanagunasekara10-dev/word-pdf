/* ==========================================================================
   SwiftPDF — batch Word to PDF converter
   --------------------------------------------------------------------------
   Per file:   .docx -> mammoth.js -> HTML -> html2pdf.js -> PDF Blob
   Many files: the blobs are bundled into a ZIP with JSZip.

   Everything runs in the browser. No file is ever uploaded.
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- config */

  var MAX_SIZE_MB = 25;
  var PAGE_SIZES = {                 // width x height in mm, portrait
    a4:     [210, 297],
    letter: [215.9, 279.4],
    a3:     [297, 420]
  };
  var PX_PER_MM = 96 / 25.4;         // CSS reference pixels per millimetre

  /* -------------------------------------------------------------- elements */

  var el = {
    fileInput:    byId('fileInput'),
    selectBtn:    byId('selectBtn'),

    screenSelect: byId('screenSelect'),
    screenFiles:  byId('screenFiles'),
    screenProg:   byId('screenProgress'),
    screenDone:   byId('screenDone'),
    infoSections: byId('infoSections'),

    fileGrid:     byId('fileGrid'),
    filesTitle:   byId('filesTitle'),
    clearAllBtn:  byId('clearAllBtn'),
    convertBtn:   byId('convertBtn'),
    panelNote:    byId('panelNote'),

    pageSize:     byId('pageSize'),
    quality:      byId('quality'),

    progressTitle: byId('progressTitle'),
    progressFile:  byId('progressFile'),
    progressFill:  byId('progressFill'),
    progressCount: byId('progressCount'),

    doneTitle:    byId('doneTitle'),
    doneSub:      byId('doneSub'),
    downloadAll:  byId('downloadAllBtn'),
    downloadAllLabel: byId('downloadAllLabel'),
    resultList:   byId('resultList'),
    restartBtn:   byId('restartBtn'),

    dropVeil:     byId('dropVeil'),
    stage:        byId('stage'),
    stagePaper:   byId('stagePaper'),

    modal:        byId('previewModal'),
    modalTitle:   byId('modalTitle'),
    modalBody:    byId('modalBody'),
    modalClose:   byId('modalClose'),

    srStatus:     byId('srStatus')
  };

  /* ----------------------------------------------------------------- state */

  var queue    = [];      // { id, file, name, size, error }
  var results  = [];      // { name, blob, url, error }
  var nextId   = 1;
  var busy     = false;
  var dragDepth = 0;
  var lastFocus = null;

  /* --------------------------------------------------------------- startup */

  var missing = ['mammoth', 'html2pdf', 'JSZip'].filter(function (n) {
    return typeof window[n] === 'undefined';
  });
  if (missing.length) {
    fail('SwiftPDF could not load (' + missing.join(', ') + '). Check your connection and reload the page.');
    return;
  }

  el.selectBtn.addEventListener('click', openPicker);
  el.clearAllBtn.addEventListener('click', clearAll);
  el.convertBtn.addEventListener('click', runBatch);
  el.restartBtn.addEventListener('click', restart);
  el.downloadAll.addEventListener('click', downloadEverything);
  el.modalClose.addEventListener('click', closeModal);
  el.modal.addEventListener('click', function (e) { if (e.target === el.modal) closeModal(); });

  el.fileInput.addEventListener('change', function () {
    addFiles(el.fileInput.files);
    el.fileInput.value = '';         // so the same file can be picked again
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.modal.hidden) closeModal();
  });

  window.addEventListener('beforeunload', function (e) {
    if (busy) { e.preventDefault(); e.returnValue = ''; }
  });

  setupDragAndDrop();

  /* ============================================================ file intake */

  function openPicker() { el.fileInput.click(); }

  function addFiles(fileList) {
    if (busy) return;

    var incoming = Array.prototype.slice.call(fileList || []);
    if (!incoming.length) return;

    var rejected = [];

    incoming.forEach(function (file) {
      var problem = validate(file);
      if (problem) { rejected.push(file.name + ' — ' + problem); return; }
      if (isDuplicate(file)) return;

      queue.push({
        id:   nextId++,
        file: file,
        name: file.name,
        size: file.size
      });
    });

    if (!queue.length && rejected.length) {
      showScreen('select');
      announce(rejected[0]);
      alertList(rejected);
      return;
    }

    renderQueue();
    showScreen('files');
    if (rejected.length) alertList(rejected);
  }

  function validate(file) {
    if (!file || !file.name) return 'not a readable file';
    if (!/\.docx$/i.test(file.name)) {
      return /\.doc$/i.test(file.name)
        ? 'old .doc files are not supported, save it as .docx first'
        : 'only .docx files can be converted';
    }
    if (file.size === 0) return 'the file is empty';
    if (file.size > MAX_SIZE_MB * 1024 * 1024) return 'larger than ' + MAX_SIZE_MB + ' MB';
    return null;
  }

  function isDuplicate(file) {
    return queue.some(function (item) {
      return item.name === file.name && item.size === file.size;
    });
  }

  function alertList(messages) {
    var note = messages.length === 1
      ? messages[0]
      : messages.length + ' files were skipped:\n\n' + messages.join('\n');
    window.setTimeout(function () { window.alert('Skipped:\n\n' + note); }, 60);
  }

  function removeFile(id) {
    if (busy) return;
    queue = queue.filter(function (item) { return item.id !== id; });
    if (!queue.length) { restart(); return; }
    renderQueue();
  }

  function clearAll() {
    if (busy) return;
    queue = [];
    restart();
  }

  /* ========================================================= queue rendering */

  function renderQueue() {
    el.fileGrid.innerHTML = '';

    queue.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'filecard';

      var tools = document.createElement('div');
      tools.className = 'filecard-tools';
      tools.appendChild(iconButton('Preview ' + item.name, 'eye', function () { openPreview(item); }));
      tools.appendChild(iconButton('Remove ' + item.name, 'x', function () { removeFile(item.id); }));
      li.appendChild(tools);

      li.appendChild(docIcon());

      var name = document.createElement('span');
      name.className = 'filecard-name';
      name.textContent = item.name;
      name.title = item.name;
      li.appendChild(name);

      var size = document.createElement('span');
      size.className = 'filecard-size';
      size.textContent = formatSize(item.size);
      li.appendChild(size);

      el.fileGrid.appendChild(li);
    });

    var add = document.createElement('li');
    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'addcard';
    addBtn.innerHTML = svg('plus') + '<span>Add more files</span>';
    addBtn.addEventListener('click', openPicker);
    add.appendChild(addBtn);
    el.fileGrid.appendChild(add);

    el.filesTitle.textContent = queue.length + (queue.length === 1 ? ' file selected' : ' files selected');
    el.convertBtn.textContent = '';
    el.convertBtn.appendChild(document.createTextNode(
      queue.length > 1 ? 'Convert ' + queue.length + ' files' : 'Convert to PDF'
    ));
    el.convertBtn.insertAdjacentHTML('beforeend', svg('arrow'));
  }

  /* ============================================================== preview */

  function openPreview(item) {
    lastFocus = document.activeElement;
    el.modalTitle.textContent = item.name;
    el.modalBody.innerHTML = '<p style="color:#666">Rendering preview…</p>';
    el.modal.hidden = false;
    el.modalClose.focus();

    toHtml(item.file)
      .then(function (res) { el.modalBody.innerHTML = res.html; })
      .catch(function (err) {
        el.modalBody.innerHTML = '';
        var p = document.createElement('p');
        p.style.color = '#c0392b';
        p.textContent = 'Could not render this document: ' + err.message;
        el.modalBody.appendChild(p);
      });
  }

  function closeModal() {
    el.modal.hidden = true;
    el.modalBody.innerHTML = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ========================================================= the conversion */

  function runBatch() {
    if (busy || !queue.length) return;

    busy = true;
    revokeResults();
    results = [];
    showScreen('progress');

    var total = queue.length;
    var options = readOptions();
    sizeStage(options);
    setProgress(0, total, '');

    // Convert strictly one at a time: html2pdf is memory hungry and this
    // keeps the browser responsive on large batches.
    var chain = Promise.resolve();

    queue.forEach(function (item, index) {
      chain = chain.then(function () {
        setProgress(index, total, item.name);
        return convertOne(item, options)
          .then(function (blob) {
            results.push({
              name: item.name.replace(/\.docx$/i, '') + '.pdf',
              blob: blob,
              url:  URL.createObjectURL(blob),
              size: blob.size
            });
          })
          .catch(function (err) {
            console.error('Failed on ' + item.name, err);
            results.push({
              name:  item.name,
              error: err && err.message ? err.message : 'conversion failed'
            });
          });
      });
    });

    chain.then(function () {
      setProgress(total, total, '');
      el.stagePaper.innerHTML = '';
      busy = false;
      showDone();
    });
  }

  function convertOne(item, options) {
    return toHtml(item.file)
      .then(function (res) {
        el.stagePaper.innerHTML = res.html;
        return waitForImages(el.stagePaper);
      })
      .then(function () {
        return window.html2pdf().set(pdfConfig(options)).from(el.stagePaper).output('blob');
      })
      .then(function (blob) {
        el.stagePaper.innerHTML = '';
        if (!blob || !blob.size) throw new Error('the PDF came back empty');
        return blob;
      });
  }

  /* .docx -> HTML */
  function toHtml(file) {
    return readArrayBuffer(file).then(function (buffer) {
      return window.mammoth.convertToHtml({ arrayBuffer: buffer }).then(function (result) {
        if (!result.value || !result.value.trim()) {
          throw new Error('the document has no readable content');
        }
        return { html: result.value, messages: result.messages };
      });
    });
  }

  function readArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload  = function (e) { resolve(e.target.result); };
      reader.onerror = function () { reject(new Error('the file could not be read from disk')); };
      reader.readAsArrayBuffer(file);
    });
  }

  /* Images arrive from mammoth as base64. html2canvas will happily capture
     them before they have decoded, so wait for them first. */
  function waitForImages(root) {
    var images = Array.prototype.slice.call(root.querySelectorAll('img'));
    if (!images.length) return Promise.resolve();

    return Promise.all(images.map(function (img) {
      if (img.complete && img.naturalWidth) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener('load',  resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });   // never block on a broken image
        window.setTimeout(resolve, 10000);
      });
    }));
  }

  /* ------------------------------------------------------- page geometry */

  function readOptions() {
    var size   = PAGE_SIZES[el.pageSize.value] || PAGE_SIZES.a4;
    var margin = parseFloat(checkedValue('margin')) || 15;
    var landscape = checkedValue('orientation') === 'landscape';

    var widthMm = landscape ? size[1] : size[0];

    return {
      format:      el.pageSize.value,
      orientation: landscape ? 'landscape' : 'portrait',
      margin:      margin,
      scale:       parseFloat(el.quality.value) || 2,
      contentWidthMm: widthMm - margin * 2
    };
  }

  /* The stage is sized to the PRINTABLE width of the page. html2pdf maps the
     captured width onto that printable width, so matching them means 1 CSS
     pixel = 1 pixel at 96dpi, and text comes out at its intended size. */
  function sizeStage(options) {
    el.stage.style.width = Math.round(options.contentWidthMm * PX_PER_MM) + 'px';
  }

  function pdfConfig(options) {
    return {
      margin:   [options.margin, options.margin, options.margin, options.margin],
      filename: 'document.pdf',
      // PNG beats JPEG for documents: flat-colour text compresses better and
      // there are no JPEG ringing artefacts around the glyphs.
      image:    { type: 'png', quality: 1 },
      html2canvas: {
        scale: options.scale,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        // Without these the capture is offset by the page's scroll position:
        // blank space at the top of the PDF and the bottom cut off.
        //
        // Do NOT add `windowWidth` here. Setting it to anything other than the
        // real viewport width makes html2canvas lay the clone out in a window
        // of that size and then mis-map the coordinates, which silently drops
        // headings, list items and the first part of every wrapped line.
        // The stage already has an explicit width, which is what controls
        // the layout we capture.
        scrollX: 0,
        scrollY: 0
      },
      jsPDF: {
        unit: 'mm',
        format: options.format,
        orientation: options.orientation,
        compress: true
      },
      pagebreak: { mode: ['css', 'legacy'] }
    };
  }

  /* ============================================================== progress */

  function setProgress(done, total, currentName) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    el.progressFill.style.width = pct + '%';
    el.progressCount.textContent = done + ' of ' + total;
    el.progressFile.textContent = currentName || ' ';
    el.progressTitle.textContent = total > 1 ? 'Converting your files…' : 'Converting your file…';
    announce('Converted ' + done + ' of ' + total);
  }

  /* ================================================================== done */

  function showDone() {
    var good = results.filter(function (r) { return !r.error; });
    var bad  = results.filter(function (r) { return r.error; });

    el.resultList.innerHTML = '';

    results.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'result' + (r.error ? ' is-error' : '');

      li.insertAdjacentHTML('beforeend', svg(r.error ? 'warn' : 'check', 'result-icon'));

      var text = document.createElement('div');
      text.className = 'result-text';

      var name = document.createElement('div');
      name.className = 'result-name';
      name.textContent = r.name;
      name.title = r.name;
      text.appendChild(name);

      var meta = document.createElement('div');
      meta.className = 'result-meta';
      meta.textContent = r.error ? r.error : formatSize(r.size);
      text.appendChild(meta);

      li.appendChild(text);

      if (!r.error) {
        var dl = document.createElement('button');
        dl.type = 'button';
        dl.className = 'result-dl';
        dl.textContent = 'Download';
        dl.addEventListener('click', function () { saveBlob(r.blob, r.name); });
        li.appendChild(dl);
      }

      el.resultList.appendChild(li);
    });

    if (!good.length) {
      el.doneTitle.textContent = 'Nothing could be converted';
      el.doneSub.textContent = 'None of the selected files could be read. See the details below.';
      el.downloadAll.hidden = true;
    } else {
      el.downloadAll.hidden = false;
      el.doneTitle.textContent = good.length > 1 ? 'Your PDFs are ready' : 'Your PDF is ready';
      el.doneSub.textContent = bad.length
        ? good.length + ' of ' + results.length + ' files converted. Everything ran on your device.'
        : 'Converted entirely on your device — nothing was uploaded.';
      el.downloadAllLabel.textContent = good.length > 1
        ? 'Download all (' + good.length + ' PDFs, ZIP)'
        : 'Download PDF';
    }

    el.resultList.hidden = results.length < 2 && !bad.length;
    showScreen('done');
    if (good.length) el.downloadAll.focus();
  }

  function downloadEverything() {
    var good = results.filter(function (r) { return !r.error; });
    if (!good.length) return;

    if (good.length === 1) { saveBlob(good[0].blob, good[0].name); return; }

    el.downloadAllLabel.textContent = 'Building ZIP…';
    el.downloadAll.disabled = true;

    var zip = new window.JSZip();
    var used = {};

    good.forEach(function (r) {
      var name = r.name;
      if (used[name]) { name = name.replace(/\.pdf$/i, '') + ' (' + used[r.name] + ').pdf'; }
      used[r.name] = (used[r.name] || 1) + 1;
      zip.file(name, r.blob);
    });

    zip.generateAsync({ type: 'blob', compression: 'STORE' })
      .then(function (blob) { saveBlob(blob, 'SwiftPDF-' + good.length + '-files.zip'); })
      .catch(function (err) {
        console.error(err);
        window.alert('The ZIP could not be built: ' + err.message +
                     '\n\nYou can still download each PDF individually below.');
      })
      .then(function () {
        el.downloadAll.disabled = false;
        el.downloadAllLabel.textContent = 'Download all (' + good.length + ' PDFs, ZIP)';
      });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function restart() {
    if (busy) return;
    revokeResults();
    results = [];
    queue = [];
    el.fileGrid.innerHTML = '';
    el.resultList.innerHTML = '';
    el.stagePaper.innerHTML = '';
    showScreen('select');
    el.selectBtn.focus();
  }

  function revokeResults() {
    results.forEach(function (r) { if (r.url) URL.revokeObjectURL(r.url); });
  }

  /* ======================================================= drag and drop */

  function setupDragAndDrop() {
    // Anything dropped outside the veil should not navigate the browser away.
    ['dragover', 'drop'].forEach(function (ev) {
      window.addEventListener(ev, function (e) { e.preventDefault(); });
    });

    window.addEventListener('dragenter', function (e) {
      if (busy || !hasFiles(e)) return;
      dragDepth++;
      el.dropVeil.hidden = false;
    });

    window.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) el.dropVeil.hidden = true;
    });

    window.addEventListener('drop', function (e) {
      dragDepth = 0;
      el.dropVeil.hidden = true;
      if (busy) return;
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) addFiles(files);
    });
  }

  function hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    return Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  /* ================================================================ helpers */

  function showScreen(which) {
    el.screenSelect.hidden = which !== 'select';
    el.screenFiles.hidden  = which !== 'files';
    el.screenProg.hidden   = which !== 'progress';
    el.screenDone.hidden   = which !== 'done';
    el.infoSections.hidden = which !== 'select';
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function checkedValue(name) {
    var input = document.querySelector('input[name="' + name + '"]:checked');
    return input ? input.value : null;
  }

  function formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function announce(message) { el.srStatus.textContent = message; }

  function byId(id) { return document.getElementById(id); }

  function iconButton(label, icon, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.setAttribute('aria-label', label);
    b.title = label.split(' ')[0];
    b.innerHTML = svg(icon);
    b.addEventListener('click', onClick);
    return b;
  }

  function docIcon() {
    var span = document.createElement('span');
    span.innerHTML =
      '<svg class="doc-icon" viewBox="0 0 40 50" fill="none" aria-hidden="true">' +
      '<path d="M4 3a2 2 0 0 1 2-2h18l12 12v34a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" ' +
      'fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M24 1v12h12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M11 26h18M11 32h18M11 38h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>';
    return span.firstChild;
  }

  function svg(name, cls) {
    var open = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
               'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
               (cls ? ' class="' + cls + '"' : '') + '>';
    var paths = {
      x:     '<path d="M18 6 6 18M6 6l12 12"/>',
      eye:   '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
      plus:  '<path d="M12 5v14M5 12h14"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      warn:  '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
      arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'
    };
    return open + (paths[name] || '') + '</svg>';
  }

  function fail(message) {
    var box = document.createElement('p');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'max-width:640px;margin:40px auto;padding:16px 20px;border-radius:12px;' +
                        'background:#fcecea;color:#8c2d20;font:15px/1.6 system-ui,sans-serif;text-align:center';
    box.textContent = message;
    var host = byId('screenSelect') || document.body;
    host.appendChild(box);
  }
})();
