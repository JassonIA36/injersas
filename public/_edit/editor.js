/* Modo edicion de INJER S.A.S. - solo se carga en /admin con sesion iniciada.
 * Todo texto se trata como TEXTO PLANO (textContent / contenteditable plaintext).
 * El servidor vuelve a validar todo lo que se guarda. */
(function () {
  'use strict';

  var data = { listas: {} };
  try {
    data = JSON.parse(document.getElementById('edit-data').textContent);
  } catch (e) {}

  var root = document.documentElement;
  root.classList.add('is-editing');

  var dirtyTexts = new Set(); // claves data-edit
  var dirtyImgs = {}; // clave data-edit-img -> id
  var dirtySettings = {}; // ajustes (telefono, SEO...)
  var dirtyLists = new Set(); // nombres de lista
  var textNodes = {}; // clave -> [nodos]
  var saving = false;

  // ---------- utilidades ----------
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function ui(tag, attrs, kids) {
    attrs = attrs || {};
    attrs['data-edit-ui'] = '';
    attrs.contenteditable = 'false';
    return h(tag, attrs, kids);
  }

  // texto plano de un nodo (respeta <br> y bloques, ignora text-transform del CSS)
  function extractText(node) {
    var out = '';
    (function walk(n, top) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeName === 'BR') out += '\n';
        else if (c.nodeType === 1 && !c.hasAttribute('data-edit-ui')) {
          var block = /^(DIV|P|LI)$/.test(c.nodeName);
          if (block && out && out.slice(-1) !== '\n') out += '\n';
          walk(c, false);
        }
      });
    })(node, true);
    return out.replace(/ /g, ' ').replace(/\r/g, '');
  }
  function valueOf(node, multiline) {
    var t = extractText(node);
    return multiline ? t.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : t.replace(/\s*\n\s*/g, ' ').trim();
  }

  var PLAIN = (function () {
    var d = document.createElement('div');
    d.contentEditable = 'plaintext-only';
    return d.contentEditable === 'plaintext-only';
  })();

  function makeEditable(node, multiline, onInput) {
    node.setAttribute('contenteditable', PLAIN ? 'plaintext-only' : 'true');
    node.setAttribute('data-editable', '');
    node.setAttribute('spellcheck', 'true');
    if (multiline) node.style.whiteSpace = 'pre-wrap';
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !multiline) {
        e.preventDefault();
        node.blur();
      }
    });
    node.addEventListener('paste', function (e) {
      e.preventDefault();
      var t = ((e.clipboardData || window.clipboardData).getData('text/plain') || '').replace(/\r/g, '');
      if (!multiline) t = t.replace(/\s*\n\s*/g, ' ');
      document.execCommand('insertText', false, t);
    });
    node.addEventListener('drop', function (e) {
      e.preventDefault();
    });
    node.addEventListener('input', onInput);
  }

  function ensureRelative(n) {
    if (getComputedStyle(n).position === 'static') n.style.position = 'relative';
  }

  // ---------- avisos ----------
  var toastBox = ui('div', { class: 'edit-toast', role: 'status', 'aria-live': 'polite' });
  var toastTimer;
  function toast(msg, kind, ms) {
    toastBox.textContent = msg;
    toastBox.className = 'edit-toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastBox.className = 'edit-toast';
    }, ms || 3500);
  }

  // ---------- estado de cambios ----------
  var statusEl, saveBtn;
  function isDirty() {
    return dirtyTexts.size || Object.keys(dirtyImgs).length || Object.keys(dirtySettings).length || dirtyLists.size;
  }
  function refreshStatus() {
    var d = !!isDirty();
    if (statusEl) statusEl.textContent = d ? 'Hay cambios sin guardar' : 'Todo guardado';
    if (statusEl) statusEl.className = 'edit-status' + (d ? ' dirty' : '');
    if (saveBtn) saveBtn.disabled = saving || !d;
  }
  window.addEventListener('beforeunload', function (e) {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- textos sueltos (data-edit) ----------
  document.querySelectorAll('[data-edit]').forEach(function (node) {
    var key = node.getAttribute('data-edit');
    var multiline = node.hasAttribute('data-multiline');
    if (multiline) node.textContent = valueOf(node, true); // <br> pasa a salto de linea
    (textNodes[key] = textNodes[key] || []).push(node);
    makeEditable(node, multiline, function () {
      var v = valueOf(node, multiline);
      textNodes[key].forEach(function (o) {
        if (o !== node) o.textContent = v; // misma clave en varios sitios (telefono, NIT...)
      });
      dirtyTexts.add(key);
      refreshStatus();
    });
  });

  // ---------- fotos ----------
  var fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  document.body.appendChild(fileInput);

  function toBlob(canvas, type, q) {
    return new Promise(function (res) {
      canvas.toBlob(res, type, q);
    });
  }
  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        res(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        rej(new Error('No se pudo leer esa foto. Prueba con una foto JPG o PNG.'));
      };
      img.src = url;
    });
  }
  // Redimensiona a 1200 px como maximo y comprime a WebP (o JPEG) por debajo de 200 KB
  async function compress(file) {
    if (!/^image\//.test(file.type)) throw new Error('Ese archivo no es una foto.');
    var src;
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      src = await loadImage(file);
    }
    var sw = src.width || src.naturalWidth;
    var sh = src.height || src.naturalHeight;
    var scale = Math.min(1, 1200 / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * scale));
    var hgt = Math.max(1, Math.round(sh * scale));
    var canvas = document.createElement('canvas');
    var webp = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    var type = webp ? 'image/webp' : 'image/jpeg';
    for (var attempt = 0; attempt < 8; attempt++) {
      canvas.width = w;
      canvas.height = hgt;
      var ctx = canvas.getContext('2d');
      if (!webp) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, hgt);
      }
      ctx.drawImage(src, 0, 0, w, hgt);
      var qs = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];
      for (var i = 0; i < qs.length; i++) {
        var blob = await toBlob(canvas, type, qs[i]);
        if (blob && blob.size < 200 * 1024) return blob;
      }
      w = Math.round(w * 0.85);
      hgt = Math.round(hgt * 0.85);
    }
    throw new Error('No se pudo reducir esa foto. Prueba con otra.');
  }
  async function upload(blob) {
    var r = await fetch('/api/img', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, credentials: 'same-origin' });
    var j = await r.json().catch(function () {
      return {};
    });
    if (r.status === 401) throw new Error('Tu sesión expiró. Guarda y vuelve a entrar en /admin.');
    if (!r.ok) throw new Error(j.error || 'No se pudo subir la foto.');
    return j.id;
  }
  // abre el selector, comprime, sube y devuelve el id nuevo (o null si cancelo)
  function pickPhoto() {
    return new Promise(function (resolve) {
      fileInput.value = '';
      fileInput.onchange = async function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return resolve(null);
        try {
          toast('Preparando y subiendo la foto…', 'info', 60000);
          var id = await upload(await compress(f));
          toast('Foto subida. Recuerda pulsar Guardar.', 'ok');
          resolve(id);
        } catch (err) {
          toast(err.message || 'No se pudo subir la foto.', 'error', 6000);
          resolve(null);
        }
      };
      fileInput.click();
    });
  }

  function photoButton(host, onPick, mini) {
    ensureRelative(host);
    var b = ui('button', { type: 'button', class: 'edit-photo-btn' + (mini ? ' mini' : ''), title: 'Cambiar foto' }, [
      ui('span', { class: 'ico', text: '📷' }),
      ui('span', { class: 'lbl', text: ' Cambiar foto' }),
    ]);
    b.addEventListener('click', async function (e) {
      e.preventDefault();
      e.stopPropagation();
      var id = await pickPhoto();
      if (id) onPick(id);
    });
    host.appendChild(b);
    return b;
  }

  // imagenes sueltas (data-edit-img): la misma clave puede estar en varios sitios (logo)
  var imgGroups = {};
  document.querySelectorAll('[data-edit-img]').forEach(function (n) {
    (imgGroups[n.getAttribute('data-edit-img')] = imgGroups[n.getAttribute('data-edit-img')] || []).push(n);
  });
  Object.keys(imgGroups).forEach(function (key) {
    function apply(id) {
      imgGroups[key].forEach(function (n) {
        n.setAttribute(n.tagName === 'LINK' ? 'href' : 'src', '/img/' + id);
      });
      dirtyImgs[key] = id;
      refreshStatus();
    }
    imgGroups[key].forEach(function (n) {
      if (n.tagName !== 'IMG') return;
      var mini = n.getBoundingClientRect().width < 170;
      photoButton(n.parentElement, apply, mini);
    });
  });

  // fondo del hero (data-edit-bg)
  document.querySelectorAll('[data-edit-bg]').forEach(function (sec) {
    var key = sec.getAttribute('data-edit-bg');
    photoButton(sec, function (id) {
      sec.style.setProperty('--hero-bg', "url('/img/" + id + "')");
      dirtyImgs[key] = id;
      refreshStatus();
    }).classList.add('bg');
  });

  // ---------- listas ----------
  function markList(name) {
    dirtyLists.add(name);
    refreshStatus();
  }
  function itemsOf(container) {
    return Array.prototype.filter.call(container.children, function (c) {
      return c.hasAttribute('data-item');
    });
  }

  function setupLines(item, ul, field, name) {
    function sync() {
      item._data[field] = Array.prototype.map
        .call(ul.querySelectorAll('li > [data-pt]'), function (s) {
          return valueOf(s, false);
        })
        .filter(Boolean)
        .join('\n');
      markList(name);
    }
    function decorate(li) {
      var text = '';
      var span = li.querySelector('[data-pt]');
      if (!span) {
        Array.prototype.slice.call(li.childNodes).forEach(function (c) {
          if (c.nodeType === 3) {
            text += c.nodeValue;
            li.removeChild(c);
          }
        });
        span = h('span', { 'data-pt': '' });
        span.textContent = text.trim();
        li.appendChild(document.createTextNode(' '));
        li.appendChild(span);
      }
      var icon = li.querySelector('i');
      if (icon) icon.setAttribute('contenteditable', 'false');
      makeEditable(span, false, sync);
      var x = ui('button', { type: 'button', class: 'edit-x', title: 'Quitar esta viñeta', text: '✕' });
      x.addEventListener('click', function (e) {
        e.preventDefault();
        li.remove();
        sync();
      });
      li.appendChild(x);
    }
    ul.querySelectorAll('li').forEach(decorate);
    var add = ui('button', { type: 'button', class: 'edit-mini-add', text: '+ Agregar viñeta' });
    add.addEventListener('click', function (e) {
      e.preventDefault();
      var li = h('li', {}, [h('i', { class: 'fa-solid fa-check' })]);
      ul.appendChild(li);
      decorate(li);
      li.querySelector('[data-pt]').focus();
      sync();
    });
    ul.insertAdjacentElement('afterend', add);
  }

  function setupItem(container, item, name) {
    ensureRelative(item);
    item.querySelectorAll('[data-field]').forEach(function (n) {
      var f = n.getAttribute('data-field');
      makeEditable(n, false, function () {
        item._data[f] = valueOf(n, false);
        markList(name);
      });
    });
    item.querySelectorAll('[data-field-lines]').forEach(function (ul) {
      setupLines(item, ul, ul.getAttribute('data-field-lines'), name);
    });
    item.querySelectorAll('[data-field-img]').forEach(function (img) {
      var f = img.getAttribute('data-field-img');
      photoButton(img.parentElement, function (id) {
        img.src = '/img/' + id;
        item._data[f] = String(id);
        var altField = img.getAttribute('data-field-alt');
        if (altField) {
          item._data[altField] = item._data.titulo || item._data[altField] || '';
          img.alt = item._data[altField];
        }
        markList(name);
      });
    });

    var up = ui('button', { type: 'button', title: 'Subir', text: '▲' });
    var down = ui('button', { type: 'button', title: 'Bajar', text: '▼' });
    var del = ui('button', { type: 'button', title: 'Borrar', class: 'danger', text: '🗑' });
    var bar = ui('div', { class: 'edit-itembar' }, [up, down, del]);
    item.appendChild(bar);

    up.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var prev = item.previousElementSibling;
      if (prev && prev.hasAttribute('data-item')) {
        container.insertBefore(item, prev);
        flash(item);
        markList(name);
      }
    });
    down.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var next = item.nextElementSibling;
      if (next && next.hasAttribute('data-item')) {
        container.insertBefore(next, item);
        flash(item);
        markList(name);
      }
    });
    del.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (itemsOf(container).length <= 1) return toast('Debe quedar al menos un elemento en esta lista.', 'error');
      if (!confirm('¿Borrar este elemento?')) return;
      item.remove();
      markList(name);
    });
  }
  function flash(n) {
    n.classList.add('edit-flash');
    n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(function () {
      n.classList.remove('edit-flash');
    }, 900);
  }

  document.querySelectorAll('[data-list]').forEach(function (container) {
    var name = container.getAttribute('data-list');
    var rows = data.listas[name];
    if (!rows) {
      container.insertAdjacentElement('beforebegin', ui('div', { class: 'edit-warn', text: 'Esta lista aún no está cargada en la base de datos (falta ejecutar "npm run seed"), por eso no se puede editar.' }));
      return;
    }
    itemsOf(container).forEach(function (item, i) {
      item._data = rows[i] ? JSON.parse(JSON.stringify(rows[i])) : {};
      setupItem(container, item, name);
    });
    var add = ui('button', { type: 'button', class: 'edit-add' }, [ui('span', { text: '＋ Agregar elemento' })]);
    add.addEventListener('click', function (e) {
      e.preventDefault();
      var all = itemsOf(container);
      var last = all[all.length - 1];
      if (!last) return toast('No hay un elemento base para copiar.', 'error');
      var clone = last.cloneNode(true);
      clone.querySelectorAll('[data-edit-ui]').forEach(function (n) {
        n.remove();
      });
      clone.querySelectorAll('[contenteditable]').forEach(function (n) {
        n.removeAttribute('contenteditable');
      });
      clone._data = JSON.parse(JSON.stringify(last._data));
      container.appendChild(clone);
      setupItem(container, clone, name);
      markList(name);
      flash(clone);
      var first = clone.querySelector('[data-field]');
      if (first) first.focus();
    });
    var wrap = ui('div', { class: 'edit-addbar' }, [add]);
    container.insertAdjacentElement('afterend', wrap);
  });

  // ---------- los enlaces no navegan en modo edicion ----------
  document.addEventListener(
    'click',
    function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.target.closest('[data-edit-ui]')) return;
      if (a.getAttribute('href').charAt(0) === '#' && !e.target.closest('[contenteditable]')) return; // menu interno
      e.preventDefault();
    },
    true
  );

  // ---------- ajustes (telefono, WhatsApp, Facebook, Google) ----------
  var digits = function (s) {
    return String(s || '').replace(/\D/g, '');
  };
  var meta = document.querySelector('meta[name="description"]');
  function currentSettings() {
    var tel = document.querySelector('a[data-link="telefono"]');
    var fb = document.querySelector('a[data-link="facebook"]');
    return {
      telefono_numero: tel ? digits(tel.getAttribute('href')) : '',
      whatsapp_numero: document.body.dataset.wa || '',
      facebook_url: fb ? fb.getAttribute('href') : '',
      seo_titulo: document.title,
      seo_descripcion: meta ? meta.getAttribute('content') || '' : '',
    };
  }
  function applySettings(s) {
    document.querySelectorAll('a[data-link="telefono"]').forEach(function (a) {
      a.setAttribute('href', 'tel:+' + s.telefono_numero);
    });
    document.querySelectorAll('a[data-link="whatsapp"]').forEach(function (a) {
      a.setAttribute('href', (a.getAttribute('href') || '').replace(/wa\.me\/\d+/, 'wa.me/' + s.whatsapp_numero));
    });
    document.body.dataset.wa = s.whatsapp_numero;
    document.querySelectorAll('a[data-link="facebook"]').forEach(function (a) {
      a.setAttribute('href', s.facebook_url);
    });
    document.title = s.seo_titulo;
    if (meta) meta.setAttribute('content', s.seo_descripcion);
  }

  function openSettings() {
    toastBox.className = 'edit-toast';
    var cur = currentSettings();
    var fields = [
      ['telefono_numero', 'Teléfono para llamar', 'Solo números, con indicativo del país. Ej: 573205931159', 'tel'],
      ['whatsapp_numero', 'Número de WhatsApp', 'Solo números, con indicativo del país. Ej: 573205931159', 'tel'],
      ['facebook_url', 'Enlace de Facebook', 'Debe empezar por https://', 'url'],
      ['seo_titulo', 'Título en Google', 'Lo que aparece como título en los resultados de búsqueda', 'text'],
      ['seo_descripcion', 'Descripción en Google', 'Resumen que aparece debajo del título en Google', 'textarea'],
    ];
    var inputs = {};
    var form = h('form', { class: 'edit-form' });
    fields.forEach(function (f) {
      var inp = f[3] === 'textarea' ? h('textarea', { rows: '3', maxlength: '400' }) : h('input', { type: f[3] === 'url' ? 'url' : 'text', maxlength: f[0] === 'seo_titulo' ? '400' : '300' });
      if (f[3] === 'tel') inp.setAttribute('inputmode', 'tel');
      inp.value = cur[f[0]] || '';
      inputs[f[0]] = inp;
      form.appendChild(h('label', {}, [h('span', { class: 'l', text: f[1] }), inp, h('small', { text: f[2] })]));
    });
    var err = h('div', { class: 'edit-form-err' });
    var cancel = h('button', { type: 'button', class: 'edit-btn ghost', text: 'Cancelar' });
    var ok = h('button', { type: 'submit', class: 'edit-btn primary', text: 'Aplicar' });
    form.appendChild(err);
    form.appendChild(h('div', { class: 'edit-form-actions' }, [cancel, ok]));
    var box = h('div', { class: 'edit-modal-box', role: 'dialog', 'aria-modal': 'true' }, [h('h2', { text: 'Datos de contacto y Google' }), form]);
    var overlay = ui('div', { class: 'edit-modal' }, [box]);
    function close() {
      overlay.remove();
    }
    cancel.onclick = close;
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });
    form.onsubmit = function (e) {
      e.preventDefault();
      var s = {};
      Object.keys(inputs).forEach(function (k) {
        s[k] = inputs[k].value.trim();
      });
      s.telefono_numero = s.telefono_numero.replace(/[\s+()-]/g, '');
      s.whatsapp_numero = s.whatsapp_numero.replace(/[\s+()-]/g, '');
      if (!/^\d{7,15}$/.test(s.telefono_numero) || !/^\d{7,15}$/.test(s.whatsapp_numero)) return (err.textContent = 'Los teléfonos deben tener solo números (de 7 a 15 dígitos), con el indicativo del país.');
      if (!/^https:\/\/\S{4,}$/.test(s.facebook_url)) return (err.textContent = 'El enlace de Facebook debe empezar por https://');
      if (!s.seo_titulo) return (err.textContent = 'El título para Google no puede estar vacío.');
      Object.keys(s).forEach(function (k) {
        if (s[k] !== cur[k]) dirtySettings[k] = s[k];
      });
      applySettings(s);
      refreshStatus();
      close();
    };
    document.body.appendChild(overlay);
    inputs.telefono_numero.focus();
  }

  // ---------- guardar ----------
  async function save() {
    if (saving || !isDirty()) return;
    saving = true;
    refreshStatus();
    saveBtn.textContent = 'Guardando…';
    var contenido = {};
    dirtyTexts.forEach(function (k) {
      var n = textNodes[k][0];
      contenido[k] = valueOf(n, n.hasAttribute('data-multiline'));
    });
    Object.keys(dirtyImgs).forEach(function (k) {
      contenido['img_' + k] = String(dirtyImgs[k]);
    });
    Object.keys(dirtySettings).forEach(function (k) {
      contenido[k] = dirtySettings[k];
    });
    var listas = {};
    dirtyLists.forEach(function (name) {
      var c = document.querySelector('[data-list="' + name + '"]');
      listas[name] = itemsOf(c).map(function (n) {
        return n._data;
      });
    });
    try {
      var r = await fetch('/api/guardar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ contenido: contenido, listas: listas }),
      });
      var j = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) throw new Error(r.status === 401 ? 'Tu sesión expiró. Copia tus cambios, entra de nuevo en /admin y repítelos.' : j.error || 'No se pudo guardar.');
      dirtyTexts.clear();
      dirtyImgs = {};
      dirtySettings = {};
      dirtyLists.clear();
      toast('✓ Cambios guardados. Ya se ven en tu página.', 'ok', 4000);
    } catch (err) {
      toast('✗ ' + (err.message || 'No se pudo guardar. Revisa tu conexión.'), 'error', 8000);
    }
    saving = false;
    saveBtn.textContent = 'Guardar';
    refreshStatus();
  }

  async function logout() {
    if (isDirty() && !confirm('Tienes cambios sin guardar. ¿Salir de todos modos?')) return;
    dirtyTexts.clear();
    dirtyImgs = {};
    dirtySettings = {};
    dirtyLists.clear();
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) {}
    location.href = '/';
  }

  // ---------- barra inferior ----------
  saveBtn = ui('button', { type: 'button', class: 'edit-btn primary', text: 'Guardar' });
  statusEl = ui('span', { class: 'edit-status', text: 'Todo guardado' });
  var settingsBtn = ui('button', { type: 'button', class: 'edit-btn', text: '⚙ Ajustes' });
  var viewBtn = ui('a', { class: 'edit-btn', href: '/', target: '_blank', rel: 'noopener', text: 'Ver' });
  var outBtn = ui('button', { type: 'button', class: 'edit-btn ghost', text: 'Salir' });
  saveBtn.addEventListener('click', save);
  settingsBtn.addEventListener('click', openSettings);
  outBtn.addEventListener('click', logout);
  viewBtn.addEventListener('click', function (e) {
    e.stopPropagation(); // el bloqueo de enlaces no aplica a la barra (ya la ignora), por si acaso
  });
  var bar = ui('div', { class: 'edit-bar' }, [statusEl, saveBtn, settingsBtn, viewBtn, outBtn]);
  document.body.appendChild(bar);
  document.body.appendChild(toastBox);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });

  refreshStatus();
  toast('Modo edición: toca cualquier texto para escribir. Pulsa Guardar al terminar.', 'info', 6000);
})();
