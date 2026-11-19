// THE KHE Cozy motion: count-up for headline numbers and a soft morph when the page changes.
// Only touches text the first time a number appears; the final text is always the app's own value.
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const seen = new WeakSet();
  const NUM = /^([^\d-]*)(-?[\d.,]+)(.*)$/;

  function countUp(el) {
    if (seen.has(el)) return;
    seen.add(el);
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.nodeValue));
    if (!node) return;
    const finalText = node.nodeValue;
    const m = finalText.trim().match(NUM);
    if (!m) return;
    const digits = m[2].replace(/[.,]/g, '');
    const target = Number(digits);
    if (!Number.isFinite(target) || target === 0) return;
    const fmt = (v) => finalText.replace(m[2], Math.round(v).toLocaleString('vi-VN'));
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const start = performance.now();
    const dur = 900;
    let last = fmt(0);
    node.nodeValue = last;
    function step(now) {
      if (node.nodeValue !== last) return; // React re-rendered: keep its value
      const t = Math.min(1, (now - start) / dur);
      if (t >= 1) { node.nodeValue = finalText; return; }
      last = fmt(target * ease(t));
      node.nodeValue = last;
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function scan(root) {
    root.querySelectorAll?.('.metric-grid strong, .queue-summary strong').forEach(countUp);
  }

  let lastPage = '';
  function morph() {
    const main = document.querySelector('.app-shell > :not(.topbar)');
    const key = location.hash + '|' + (document.querySelector('.main-nav button.active')?.textContent || '');
    if (!main || key === lastPage) return;
    lastPage = key;
    main.classList.remove('tk-morph');
    void main.offsetWidth;
    main.classList.add('tk-morph');
  }

  const obs = new MutationObserver(() => { scan(document); morph(); });
  const boot = () => {
    const root = document.getElementById('root');
    if (!root) return setTimeout(boot, 100);
    obs.observe(root, { childList: true, subtree: true });
    scan(document);
  };
  boot();
})();
