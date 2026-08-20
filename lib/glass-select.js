/**
 * GlassSelect — replaces native <select class="input"> popups (which are
 * OS-styled and clash with the Liquid Glass design) with a glass dropdown.
 *
 * Non-invasive by design: the real <select> stays in the DOM as the source
 * of truth — existing `select.value = x` assignments and `change` listeners
 * keep working untouched. Full a11y: listbox semantics, arrow/Enter/Esc.
 */

const instances = new Map();

const CHEVRON = `<svg class="icon gs-chev" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>`;

function syncLabel(sel, ui) {
  const opt = sel.options[sel.selectedIndex];
  ui.label.textContent = opt ? opt.textContent : '';
  for (const li of ui.list.querySelectorAll('[role="option"]')) {
    li.setAttribute('aria-selected', String(li.dataset.value === sel.value));
  }
}

export function upgradeGlassSelects(root = document) {
  root.querySelectorAll('select.input').forEach((sel) => {
    if (instances.has(sel) || sel.dataset.glassUpgraded) return;
    sel.dataset.glassUpgraded = '1';

    // wrapper UI
    const wrap = document.createElement('div');
    wrap.className = 'gselect';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gselect-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (sel.id) btn.setAttribute('aria-labelledby', sel.getAttribute('aria-labelledby') || '');
    const label = document.createElement('span');
    label.className = 'gs-label';
    btn.append(label, Object.assign(document.createElement('span'), { innerHTML: CHEVRON }));

    const list = document.createElement('ul');
    list.className = 'gselect-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('tabindex', '-1');
    list.hidden = true;

    for (const opt of sel.options) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.value = opt.value;
      li.setAttribute('aria-selected', String(opt.selected));
      li.textContent = opt.textContent;
      li.addEventListener('click', () => choose(li));
      list.append(li);
    }

    // keep the native select as state owner (screen readers can still find it)
    sel.classList.add('gselect-native');
    sel.setAttribute('aria-hidden', 'false');
    sel.parentNode.insertBefore(wrap, sel);
    wrap.append(sel, btn, list);

    const ui = { btn, list, label };
    instances.set(sel, ui);
    syncLabel(sel, ui);

    // programmatic `sel.value = x` should update the glass label
    const proto = Object.getPrototypeOf(sel).constructor.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) {
        desc.set.call(this, v);
        const u = instances.get(this);
        if (u) syncLabel(this, u);
      },
    });

    function open() {
      ui.list.hidden = false;
      ui.btn.setAttribute('aria-expanded', 'true');
      ui.btn.classList.add('open');
      const cur = ui.list.querySelector('[aria-selected="true"]');
      (cur || ui.list.firstElementChild)?.focus?.();
      ui.scrollIntoViewIfNeeded?.();
      document.addEventListener('pointerdown', onDocDown, { capture: true });
      document.addEventListener('keydown', onKey);
    }
    function close(refocus = true) {
      ui.list.hidden = true;
      ui.btn.setAttribute('aria-expanded', 'false');
      ui.btn.classList.remove('open');
      document.removeEventListener('pointerdown', onDocDown, { capture: true });
      document.removeEventListener('keydown', onKey);
      if (refocus) ui.btn.focus();
    }
    function choose(li) {
      const v = li.dataset.value;
      if (sel.value !== v) {
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close();
    }
    function onDocDown(e) {
      if (!wrap.contains(e.target)) close(false);
    }
    function onKey(e) {
      const items = [...ui.list.querySelectorAll('[role="option"]')];
      const cur = items.findIndex((i) => i === document.activeElement || i.getAttribute('aria-selected') === 'true');
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        items[(cur + dir + items.length) % items.length]?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        const focused = items.find((i) => i === document.activeElement);
        if (focused) { e.preventDefault(); choose(focused); }
      } else if (e.key === 'Tab') {
        close(false);
      }
    }

    ui.btn.addEventListener('click', () => (ui.list.hidden ? open() : close(false)));
    // options are focusable for keyboard support
    for (const li of list.querySelectorAll('[role="option"]')) li.tabIndex = -1;
  });
}

/** Re-sync labels after language change / i18n re-apply. */
export function refreshGlassSelects() {
  for (const [sel, ui] of instances) {
    for (const li of ui.list.querySelectorAll('[role="option"]')) {
      const opt = [...sel.options].find((o) => o.value === li.dataset.value);
      if (opt) li.textContent = opt.textContent;
    }
    syncLabel(sel, ui);
  }
}
