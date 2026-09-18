/* Runs on load, and AGAIN when a locked post is unlocked — a locked page ships
   an empty .post-body and an empty .toc, so at parse time there is nothing to
   observe and nothing to highlight. static/js/vault.js fires `vault:unlocked`
   once it has injected the decrypted article and its table of contents.
   Re-running is safe: the previous observer was watching an empty set. */
function tocSpy() {
  var headings = document.querySelectorAll('.post-body h2, .post-body h3, .post-body h4');
  var tocLinks = document.querySelectorAll('.toc nav a');

  if (!headings.length || !tocLinks.length) return;

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var id = entry.target.id;
          tocLinks.forEach(function (link) {
            var isActive = link.getAttribute('href') === '#' + id;
            link.classList.toggle('active', isActive);
          });
        }
      });
    },
    { rootMargin: '0px 0px -60% 0px', threshold: 0 }
  );

  headings.forEach(function (h) {
    observer.observe(h);
  });
}

tocSpy();
document.addEventListener('vault:unlocked', tocSpy);
