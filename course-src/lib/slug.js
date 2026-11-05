// Heading anchors and card ids share one slug function, used by the build and by the page.
// Plain script: attaches `Slug` to globalThis.
(function (root) {
  'use strict';
  // Lowercase, drop anything tag-like, runs of other characters become '-', at most 48 characters.
  const slug = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  root.Slug = { slug };
})(typeof globalThis !== 'undefined' ? globalThis : window);
