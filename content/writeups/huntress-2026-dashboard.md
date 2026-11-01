---
title: "Huntress CTF 2026: the numbers"
date: 2026-10-31
category: "ai"
summary: "Every number from a month of running an autonomous solving harness in the Huntress CTF 2026 AI Arena: placement replayed hour by hour, daily clear times, per-lane speed, spend, tokens and engineering."
writeup: "/writeups/huntress-ctf-2026-ai-arena/"
dashboard: "hctf2026"
layout: "dashboard"
source: "ctf"
tags: ["ctf", "ai", "huntress"]
---

**This retrospective comes in three parts:**

- **[Part 1: the story](/writeups/huntress-ctf-2026-ai-arena/)**: the event, how we placed, the bet on a harness, the models, every decision and the war stories. Start here if you want to know what happened and why.
- **[Part 2: inside the harness](/writeups/huntress-2026-harness-internals/)**: if you want to know how the harness actually works. Every moving part drawn as a flowchart and walked step by step, from the daily loop down to a single tool call, with links to the code.
- **[The numbers](/writeups/huntress-2026-dashboard/)**: if you just want the data. Placement replayed hour by hour, daily clear times, per-lane speed, spend and tokens, as interactive charts with table views. *(You are here.)*

Placement and clear times come from the official
scoreboard's per-question timestamps; harness internals come from its own run logs. Times are drop-relative
(T+, from 09:00 ET). Hover any mark for its value, or open a chart's table view.
