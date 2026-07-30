---
title: "all"
layout: "all"
# A branch bundle (_index.md), NOT a plain page. Hugo's .Paginate only works on
# list-type pages — home, section, taxonomy, term — so as content/search.md this
# failed with "pagination not supported for this page". Renders via
# themes/carlo/layouts/_default/all.html.
#
# This was /search/ until round 7. It is the complete archive of both types with
# an unscoped filter and a sort control — the most useful index on the site — and
# "search" was the one nav word a browsing visitor never clicks. Renaming the
# section renamed the URL with it; nothing external linked to /search/.
#
# Excluded from /index.json and from every archive because those filter on
# `Type in (cves, writeups)`.
---
