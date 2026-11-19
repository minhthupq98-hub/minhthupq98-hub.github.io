// THE KHE Cozy motion for the owner screen: count-up on KPI numbers and a soft morph when the view changes.
// The final text is always the app's own value; a re-render mid-animation wins.
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const seen = new WeakMap();
  const NUM = /-?\d[\d.,]*/;
  function countUp(el) {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.nodeValue));
    if (!node || seen.get(el) === node.nodeValue) return;
    const finalText = node.nodeValue;
    seen.set(el, finalText);
    const m = finalText.match(NUM);
    if (!m) return;
    const target = Number(m[0].replace(/[.,]/g, ''));
    if (!Number.isFinite(target) || target === 0) return;
    const fmt = (v) => finalText.replace(m[0], Math.round(v).toLocaleString('vi-VN'));
    const start = performance.now();
    let last = fmt(0);
    node.nodeValue = last;
    seen.set(el, last);
    const step = (now) => {
      if (node.nodeValue !== last) return;
      const t = Math.min(1, (now - start) / 800);
      last = t >= 1 ? finalText : fmt(target * (1 - Math.pow(1 - t, 3)));
      node.nodeValue = last;
      seen.set(el, last);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const scan = () => document.querySelectorAll('.kpi .v').forEach(countUp);
  let lastView = null;
  const morph = () => {
    const v = document.querySelector('.view:not([hidden])');
    if (!v || v === lastView) return;
    lastView = v;
    v.classList.remove('tk-morph'); void v.offsetWidth; v.classList.add('tk-morph');
  };
  new MutationObserver(() => { scan(); morph(); }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  scan(); morph();
})();
