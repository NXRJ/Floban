(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Markdown = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    function escapeHtml(text) {
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderMarkdownLite(text) {
      var esc = escapeHtml(text);
      esc = esc.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      esc = esc.replace(/`([^`]+)`/g, '<code>$1</code>');
      esc = esc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      esc = esc.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>');
      esc = esc.replace(/\n/g, '<br>');
      return esc;
    }

    return {
      escapeHtml: escapeHtml,
      renderMarkdownLite: renderMarkdownLite
    };
  }
);
