---
title: "Own2Pwn: keep going"
date: 2026-11-26
layout: "own2pwn"
draft: false
build:
  list: never   # reachable by URL (the talk QR), but kept out of the RSS feed and every listing
description: "Talks and write-ups to watch and read after the TCON9 talk Own2Pwn: Can AI Pwn2Own the Old Phones in My Drawer?, plus a short guide to hunting your own phones."
event: "TCON9 · Baguio City · Nov 27–28, 2026"
talk: "Own2Pwn: Can AI Pwn2Own the Old Phones in My Drawer?"
watch:
  - title: "Chainspotting: Building Exploit Chains with Logic Bugs"
    url: "https://www.youtube.com/watch?v=OF8Igzw4VBU"
    who: "Georgi Geshev & Rob Miller (MWR Labs) · TenSec 2018"
    why: "The original: 11 logic bugs across 6 apps, chained from one link to an installed app on a Galaxy S8. The chain this talk walks through."
    first: true
  - title: "Chainspotting 2: The Unofficial Sequel to the 2018 Talk \"Chainspotting\""
    url: "https://www.youtube.com/watch?v=LAIr2laU-So"
    who: "Ken Gannon · OffensiveCon 2025"
    why: "Five bugs on a Galaxy S24, from one link to any app installed. The same moves, seven years later."
  - title: "Xiaomi The Money: Our Toronto Pwn2Own Exploit & BTS Story"
    url: "https://www.youtube.com/watch?v=B0A8F_Izmj0"
    who: "Ken Gannon & Ilyes Beghdadi · DEF CON 32"
    why: "A Pwn2Own phone entry against a Xiaomi device, and the story behind building it."
  - title: "Promp2Pwn: LLMs Winning at Pwn2Own"
    url: "https://www.youtube.com/watch?v=c5XAvRbma6Y"
    who: "Georgi Geshev & Ben R · Interrupt Labs · [un]prompted 2026"
    why: "An agent pipeline that hunts phone bugs with LLMs. Ideas from it went straight into this project's harness."
read:
  - title: "Pwn2Own 2025, Part 1: Samsung Members WebView Takeover & Intent Redirection"
    url: "https://djini.ai/posts/pwn2own-2025-samsung-members-webview-takeover-and-intent-redirection/"
    who: "Ken Gannon · Djini"
    why: "The first hops of the Galaxy S25 chain from the talk, in full technical detail."
  - title: "Pwn2Own Ireland 2026: Two Phones, Two Successful Exploits, and Third Place"
    url: "https://djini.ai/posts/pwn2own-ireland-2026-two-phones-two-successful-exploits-and-third-place/"
    who: "Ken Gannon · Djini"
    why: "This year's phone entries, including the one-bug Galaxy S26 win, and why none of the bugs were memory corruption."
  - title: "Hacking Optimus Prime: One Click to RCE on the TECNO Spark 30 Pro"
    url: "https://djini.ai/posts/tecno-spark-30-pro-one-click-rcetechnical-advisory/"
    who: "Ken Gannon · Djini · Aug 2026"
    why: "A budget phone falls to one click: a WebView takeover and intent redirection, then an automatic install from the phone's own app store."
classes:
  - name: "Deeplink with attacker extras."
    what: "A link from any web page opens an app and hands it values you chose."
  - name: "WebView that loads any URL."
    what: "The app shows your page inside itself, with no host allowlist or a weak one."
  - name: "JavaScript bridge."
    what: "Your page can call the app's own methods."
  - name: "Intent redirection."
    what: "A WebView or router turns a URL into \"open any screen\"."
  - name: "Open redirect or XSS on a trusted site."
    what: "Gets you past the allowlist."
  - name: "Confused deputy."
    what: "A privileged app does the dangerous thing for whoever asks."
tips:
  - lead: "Only phones you own."
    text: "Keep anything you capture on your own laptop: `adb reverse` and a local listener are enough."
  - lead: "It only counts once it works on the phone."
    text: "Static analysis finds candidates; the phone tells you the truth."
  - lead: "Test the way victims click."
    text: "Chrome won't let a page you typed into the address bar open an app on its own. A tapped link can."
  - lead: "Quote your adb URLs."
    text: "An unquoted `&` cuts the link short, and \"can't launch\" turns out to be your bug."
  - lead: "Re-test on the shipping build before you report."
    text: "Phones and apps update themselves, sometimes days before you hit send."
---

Thanks for coming to **"Own2Pwn: Can AI Pwn2Own the Old Phones in My Drawer?"** The bugs from the talk are still with the vendors, so the slides aren't public yet. In the meantime, these are the talks and write-ups that shaped the work, and a short guide to trying it on your own phones.
