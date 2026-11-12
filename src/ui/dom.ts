/** 极简 DOM 构建辅助 */

type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

const EVENT_KEYS = new Set(['onclick', 'onchange', 'oninput', 'onsubmit', 'onpointerdown']);

export function h(tag: string, attrs: Attrs = {}, ...children: Array<Node | string | null | undefined>): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (EVENT_KEYS.has(k) && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'html') {
      el.innerHTML = String(v);
    } else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function mount(el: HTMLElement, child: Node): void {
  el.replaceChildren(child);
}

let toastTimer: number | undefined;
export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info', duration = 2600): void {
  let wrap = document.querySelector<HTMLDivElement>('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind === 'info' ? '' : kind}`;
  t.textContent = message;
  wrap.appendChild(t);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), duration);
}

export function confirmModal(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const mask = h('div', { class: 'modal-mask' });
    const okBtn = h('button', { class: 'btn danger' }, '确认删除');
    const cancelBtn = h('button', { class: 'btn ghost' }, '取消');
    const modal = h(
      'div',
      { class: 'modal' },
      h('h3', {}, title),
      h('p', { style: 'color:var(--text-dim);line-height:1.7' }, message),
      h('div', { class: 'actions' }, cancelBtn, okBtn),
    );
    mask.appendChild(modal);
    document.body.appendChild(mask);
    const close = (v: boolean) => {
      mask.remove();
      resolve(v);
    };
    okBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    mask.addEventListener('click', (e) => {
      if (e.target === mask) close(false);
    });
  });
}
