(function () {
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
})();
