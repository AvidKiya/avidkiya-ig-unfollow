/**
 * Export / import helpers — pure local files, no network involved.
 */

/** RFC-4180-ish CSV with UTF-8 BOM so Excel renders Persian correctly. */
export function toCSV(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
  return '﻿' + [head, ...body].join('\n');
}

export function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function exportJSON(filename, data) {
  download(filename, JSON.stringify(data, null, 2), 'application/json');
}

/** Open a file picker and parse JSON. Resolves { ok, data?, error? }. */
export function pickJSONFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve({ ok: false, error: 'no-file' });
      try {
        const text = await file.text();
        resolve({ ok: true, data: JSON.parse(text) });
      } catch (e) {
        resolve({ ok: false, error: 'invalid-json' });
      }
    };
    input.click();
  });
}

/**
 * Validate an imported protected-list payload.
 * Accepts: { starred: UserLike[]|{id:user}, never: ... } or a bare array.
 * Returns { starred: {id:user}, never: {id:user}, invalid: any[] }
 */
export function validateProtectedImport(payload) {
  const invalid = [];
  const norm = (entry) => {
    // supports both {id:user} maps and plain arrays
    if (Array.isArray(entry)) return entry;
    if (entry && typeof entry === 'object') return Object.values(entry);
    return null;
  };
  let starredRaw = [];
  let neverRaw = [];
  if (Array.isArray(payload)) {
    neverRaw = payload; // plain array => treat as Never-Unfollow import
  } else if (payload && typeof payload === 'object') {
    starredRaw = norm(payload.starred) || [];
    neverRaw = norm(payload.never) || [];
  } else {
    return { ok: false, invalid: [payload] };
  }

  const clean = (list) => {
    const out = {};
    for (const u of list) {
      if (u && typeof u === 'object' && (u.id || u.pk) && typeof u.username === 'string' && u.username) {
        out[String(u.id ?? u.pk)] = {
          id: String(u.id ?? u.pk),
          username: u.username,
          fullName: u.fullName || u.full_name || '',
          profilePic: u.profilePic || u.profile_pic_url || '',
          isPrivate: !!u.is_private || !!u.isPrivate,
          isVerified: !!u.is_verified || !!u.isVerified,
        };
      } else {
        invalid.push(u);
      }
    }
    return out;
  };

  return { ok: true, starred: clean(starredRaw), never: clean(neverRaw), invalid };
}
