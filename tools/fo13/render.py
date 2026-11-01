"""Render the FLARE-On 13 retrospective's charts, tiles, tables and flowcharts as Hugo partials.

Writes themes/carlo/layouts/partials/fo13/<name>.html, one per figure. The post embeds them with {{< fo13 "name" >}}. Re-run after editing the data below:

    python3 tools/fo13/render.py [path/to/flareon-13-2026-ai-writeups checkout]

Every number below comes from the public run report (README.md + writeups/session_stats.json) of
https://github.com/blackbeard666/flareon-13-2026-ai-writeups at the commit in SRC_COMMIT. When a checkout is given,
every file the flowcharts link to is checked against `git ls-files` so a renamed file fails the render.

Styling reuses the theme's hc-* chart classes: red = what we did, green = the
platform, neutral ramp for everything else. No inline styles (the site's CSP forbids them).
"""
import datetime as dt
import html
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BLOG = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(BLOG, "themes", "carlo", "layouts", "partials", "fo13")
REPO = "https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/"
SRC_COMMIT = "03173b5"
E = html.escape
UTC = dt.timezone.utc


def T(s):
    return dt.datetime.strptime("2026-" + s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)


# ---------------------------------------------------------------- data (run report, per attempt)
# key, challenge, label, start, end, cost $, tool calls, models, result, turns, input, cache write, cache read, output,
# estimated window?
A = [
    ("1", "flarecaptcha", "1 flarecaptcha", "09-27 13:12:43", "09-27 13:13:07", 0.38, 4, "Opus 5.5", "ok", 8, 16, 31.8e3, 324.2e3, 3.1e3, False),
    ("2", "GhostStream", "2 GhostStream", "09-27 13:15:03", "09-27 13:23:19", 6.66, 43, "Opus 5.5", "ok", 99, 198, 293.8e3, 10.77e6, 108.0e3, False),
    ("3", "flareon13.doc", "3 flareon13.doc", "09-27 13:24:16", "09-27 13:38:49", 10.51, 55, "Opus 5.5", "ok", 134, 268, 340.0e3, 28.13e6, 108.1e3, False),
    ("4", "ToxicMiner", "4 ToxicMiner", "09-27 13:41:18", "09-27 14:59:52", 31.68, 47, "Opus 5.5 → 4.8", "ok", 130, 264, 1.10e6, 39.02e6, 203.8e3, False),
    ("5", "catthief", "5 catthief", "09-27 15:00:17", "09-27 23:57:54", 272, 268, "Opus 4.8", "ok", 708, 1416, 3.18e6, 379.10e6, 2.03e6, False),
    ("6", "ThreatInvaders", "6 ThreatInvaders", "09-27 23:57:54", "09-28 06:00:57", 145, 422, "Opus 4.8", "ok", 436, 872, 1.53e6, 203.29e6, 1.15e6, True),
    ("7", "FlareCalc", "7 FlareCalc", "09-28 06:00:57", "09-28 10:10:04", 112, 441, "Opus 4.8", "ok", 437, 874, 1.51e6, 155.71e6, 875.4e3, True),
    ("8a", "crux", "8 crux, attempt 1", "09-28 10:10:09", "09-29 09:59:39", 483, 1590, "Opus 4.8 + Fable 5", "abandoned", 1587, 3174, 15.36e6, 464.35e6, 4.32e6, False),
    ("8b", "crux", "8 crux, attempt 2", "09-29 10:05:13", "09-29 10:23:57", 3.26, 68, "Opus 5.5", "ok", 68, 136, 134.1e3, 6.26e6, 46.6e3, False),
    ("9a", "NeonOutRun", "9 NeonOutRun, attempt 1", "09-29 10:28:42", "09-29 23:23:08", 110, 496, "Opus 5.5 → 4.8", "rejected", 473, 948, 1.74e6, 150.01e6, 1.02e6, False),
    ("9b", "NeonOutRun", "9 NeonOutRun, attempt 2", "09-29 23:25:14", "09-30 00:15:11", 4.17, 79, "Opus 5.5", "ok", 78, 156, 172.9e3, 8.81e6, 51.1e3, False),
]
ATT = [dict(zip(("k", "ch", "lab", "t0", "t1", "cost", "tools", "model", "res", "turns", "inp", "cw", "cr", "out", "est"), r))
       for r in A]
for a in ATT:
    a["t0"], a["t1"] = T(a["t0"]), T(a["t1"])
    a["secs"] = (a["t1"] - a["t0"]).total_seconds()

FLAGS = {
    "1": "triskaidekaphobia@flare-on.com",
    "2": "y0u_kn0w_n07h1n6_j0n_5n0w@flare-on.com",
    "3": "Ju$7_4_l177l3_7r34$ur3_HUN7@flare-on.com",
    "4": "cpu_m3lt3d_4nd_all_i_g0t_w4s_th1s_fl4g@flare-on.com",
    "5": "th3r3_b3_tr34sure_1n_th4t_pc4p@flare-on.com",
    "6": "wh4t_4_l0ng_str4ng3_tr1p_1ts_b33n@flare-on.com",
    "7": "t3mplat3s_asn_and_j1t_0h_my@flare-on.com",
    "8b": "Pr4tt_Pr1M4lItY_C3rt5_4nd_Wa4aA4aAA4aAA4a4a5M@flare-on.com",
    "9a": "decode_this_system_to_win_it@flare-on.com",
    "9b": "R3_ag3nt_4b0ut_t0_f33l_d1zzy@flare-on.com",
}
WHAT = {
    "1": "JS deobfuscation", "2": "WIM + ADS, named pipe, modified RC4",
    "3": "polyglot: COM, CD/UDF, ZIP-Reduce, PDF, Mach-O", "4": "cpuminer trojan, SHA-256d + RC4 brute force",
    "5": "Rust implant, custom Huffman + RC4 over a pcap", "6": ".NET 10 modified runtime, detours, PCG-XOR exfil",
    "7": "cert-embedded x64 implant, packer VM, XTEA labyrinth",
    "8a": "non-canonical certificate leaf → SHA-256 preimage dead end",
    "8b": "garble Go WASM, AES-CBC, Pratt primality certificate",
    "9a": "submitted the victory-screen decoy", "9b": "Rust Tauri + V8, hooked builtins, lap-time sine gate",
}

# Shell commands that mention each tool, per attempt (keyword match, so one command can count twice).
TOOLS = ["python", "grep/rg", "sed/awk", "ghidra", "capstone", "unicorn", "frida", "dotnet/ilspy", "node", "wasm tools",
         "wsl", "gdb", "gcc/cc", "7z", "tshark/pcap", "objdump/readelf", "strings"]
TOOLROWS = {
    "1": [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0],
    "2": [29, 10, 6, 3, 7, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1],
    "3": [34, 14, 6, 4, 3, 2, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0],
    "4": [24, 8, 2, 4, 7, 3, 0, 0, 0, 0, 0, 0, 5, 1, 0, 0, 0],
    "5": [196, 69, 21, 12, 12, 2, 82, 0, 0, 0, 0, 0, 7, 48, 33, 0, 1],
    "6": [239, 142, 61, 4, 11, 0, 22, 86, 1, 0, 0, 0, 14, 4, 54, 16, 5],
    "7": [199, 103, 49, 31, 54, 14, 6, 0, 1, 0, 0, 0, 12, 1, 0, 3, 12],
    "8a": [597, 335, 183, 0, 0, 1, 0, 0, 611, 17, 11, 0, 23, 5, 2, 36, 31],
    "8b": [38, 29, 26, 0, 0, 0, 0, 0, 15, 5, 0, 0, 0, 1, 0, 8, 1],
    "9a": [351, 169, 100, 20, 19, 9, 0, 1, 9, 2, 123, 51, 7, 4, 0, 6, 9],
    "9b": [33, 25, 11, 6, 5, 3, 0, 0, 1, 0, 18, 6, 3, 3, 0, 0, 1],
}
PRICES = [("Opus 5.5", 4.00, 20.00, 5.00, 8.00, 0.20), ("Opus 4.8", 5.00, 25.00, 6.25, 10.00, 0.50),
          ("Fable 5", 10.00, 50.00, 12.50, 20.00, 1.00)]
COST_SPLIT = [("cache reads", 698, 1.45e9), ("output", 246, 9.92e6), ("cache writes", 236, 25.39e6), ("uncached input", 0.03, 8322)]


# ---------------------------------------------------------------- formatting
def dur(s):
    if s < 120:
        return f"{s:.0f} s"
    if s < 3600 * 2:
        return f"{s / 60:.1f} min" if s < 600 else f"{s / 60:.0f} min"
    return f"{s / 3600:.1f} h"


def money(v):
    return f"${v:,.2f}" if v < 100 else f"${v:,.0f}"


def compact(n):
    for d, s in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= d:
            v = n / d
            return f"{v:.2f}{s}" if v < 10 else (f"{v:.1f}{s}" if v < 100 else f"{v:.0f}{s}")
    return f"{n:,.0f}"


def write(name, body):
    with open(os.path.join(OUT, f"{name}.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(body.strip() + "\n")


def figure(cid, title, desc, w, h, body, caption, tbl):
    return f"""
<figure class="hc-fig" id="fig-{cid}">
<p class="hc-fig-title">{E(title)}</p>
<svg class="hc-svg" viewBox="0 0 {w} {h:.0f}" role="img" aria-labelledby="{cid}-t {cid}-d" preserveAspectRatio="xMidYMid meet">
<title id="{cid}-t">{E(title)}</title><desc id="{cid}-d">{E(desc)}</desc>
{body}
</svg>
<figcaption>{caption}</figcaption>
{tbl}
</figure>"""


def table(head, rows, cls="", summary="table view"):
    th = "".join(f"<th>{E(h)}</th>" for h in head)
    tr = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    t = f'<div class="hc-tablewrap"><table class="hc-table {cls}"><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div>'
    return f'<details class="hc-tv"><summary>{E(summary)}</summary>{t}</details>' if summary else t


def tiles(items, cls=""):
    cells = "".join(f'<div class="hc-tile"><p class="hc-tile-l">{E(l_)}</p><p class="hc-tile-v">{E(v)}</p>'
                    f'{f"<p class=hc-tile-n>{E(n)}</p>" if n else ""}</div>' for l_, v, n in items)
    return f'<div class="hc-tiles {cls}">{cells}</div>'


def barcls(a):
    if a["res"] != "ok":
        return "hc-bar hc-fail"
    return "hc-bar hc-est" if a["est"] else "hc-bar"


def status(a):
    return {"ok": "solved", "abandoned": "abandoned", "rejected": "decoy rejected"}[a["res"]]


# ---------------------------------------------------------------- charts
def headline_tiles():
    tok = sum(a["inp"] + a["cw"] + a["cr"] + a["out"] for a in ATT)
    cr = sum(a["cr"] for a in ATT)
    span = (ATT[-1]["t1"] - ATT[0]["t0"]).total_seconds()
    return tiles([
        ("flags accepted", "9 / 9", "every one recovered offline from the shipped files"),
        ("attempts", f"{len(ATT)}", "2 challenges restarted in a fresh session"),
        ("first prompt to last flag", f"~{span / 3600:.0f} h", "Sep 27 13:12 → Sep 30 00:15 UTC"),
        ("API list-price equivalent", f"${sum(a['cost'] for a in ATT):,.0f}", "relative spend, not what was billed"),
        ("tokens processed", compact(tok), f"{compact(sum(a['out'] for a in ATT))} output, {cr / tok:.0%} cache reads"),
        ("model turns", f"{sum(a['turns'] for a in ATT):,}", f"{sum(a['tools'] for a in ATT):,} tool calls, 2,955 of them shell"),
        ("messages I typed", "42", "kickoffs, nudges, hints, and write-up requests"),
        ("the two restarts", "0.7% · 3.8%", "of the failed first attempt's cost"),
    ])


def timeline():
    w, rh, l, t = 960, 30, 196, 30
    h = t + rh * len(ATT) + 30
    lo, hi = T("09-27 12:00:00"), T("09-30 03:00:00")
    x1 = w - 20
    fx = lambda d: l + (d - lo).total_seconds() / (hi - lo).total_seconds() * (x1 - l)
    body = []
    tick = lo
    while tick <= hi:
        x = fx(tick)
        body.append(f'<line class="hc-grid" x1="{x:.1f}" x2="{x:.1f}" y1="{t - 6}" y2="{t + rh * len(ATT)}"/>')
        lab = tick.strftime("%m/%d") if tick.hour == 0 else tick.strftime("%H:%M")
        body.append(f'<text class="hc-tick" x="{x:.1f}" y="{t - 12}" text-anchor="middle">{lab}</text>')
        tick += dt.timedelta(hours=6)
    rows = []
    for i, a in enumerate(ATT):
        y = t + i * rh
        body.append(f'<text class="hc-tick" x="{l - 10}" y="{y + rh / 2 + 4:.1f}" text-anchor="end">{E(a["lab"])}</text>')
        xa, xb = fx(a["t0"]), max(fx(a["t1"]), fx(a["t0"]) + 3)
        tip = (f'{a["lab"]}: {a["t0"]:%m/%d %H:%M} → {a["t1"]:%m/%d %H:%M} UTC, {dur(a["secs"])}'
               f'{" (window estimated from commit times)" if a["est"] else ""}, {money(a["cost"])}, {status(a)}')
        body.append(f'<g class="hc-hit"><rect class="{barcls(a)}" x="{xa:.1f}" y="{y + 7}" width="{xb - xa:.1f}" '
                    f'height="{rh - 14}"/><rect class="hc-hitarea" x="{l}" y="{y}" width="{x1 - l}" height="{rh}"/>'
                    f'<title>{E(tip)}</title></g>')
        if a["res"] == "ok":
            body.append(f'<line class="hc-target hc-flag" x1="{xb + 2:.1f}" x2="{xb + 2:.1f}" y1="{y + 4}" y2="{y + rh - 4}"/>')
        txt = f'{dur(a["secs"])} · {money(a["cost"])}'
        if xb + 8 + 7 * len(txt) < x1:
            body.append(f'<text class="hc-tick" x="{xb + 8:.1f}" y="{y + rh / 2 + 4:.1f}">{E(txt)}</text>')
        else:
            body.append(f'<text class="hc-tick" x="{xa - 6:.1f}" y="{y + rh / 2 + 4:.1f}" text-anchor="end">{E(txt)}</text>')
        rows.append([E(a["lab"]), f'{a["t0"]:%m/%d %H:%M}', f'{a["t1"]:%m/%d %H:%M}',
                     E(dur(a["secs"]) + (" (est.)" if a["est"] else "")), E(money(a["cost"])), E(status(a))])
    ly = t + rh * len(ATT) + 16
    body.append(f'<rect class="hc-bar" x="{l}" y="{ly - 9}" width="18" height="10"/><text class="hc-tick" x="{l + 24}" y="{ly}">solved</text>'
                f'<rect class="hc-bar hc-est" x="{l + 90}" y="{ly - 9}" width="18" height="10"/><text class="hc-tick" x="{l + 114}" y="{ly}">solved, window estimated</text>'
                f'<rect class="hc-bar hc-fail" x="{l + 300}" y="{ly - 9}" width="18" height="10"/><text class="hc-tick" x="{l + 324}" y="{ly}">abandoned or wrong flag</text>'
                f'<line class="hc-target hc-flag" x1="{l + 500}" x2="{l + 500}" y1="{ly - 11}" y2="{ly + 2}"/><text class="hc-tick" x="{l + 508}" y="{ly}">flag accepted</text>')
    return figure("timeline", "Every attempt, in UTC", "Eleven attempts on a shared clock from September 27 to 30. "
                  "Challenges 1 to 4 fit in the first two hours; the two failed first attempts take up most of the "
                  "elapsed time, and each fresh retry starts right after and finishes within an hour.",
                  w, h, "".join(body),
                  "One bar per attempt. Challenges 1–4 took the first two hours. The two hollow bars are the "
                  "first attempts that failed (crux, abandoned after ~24 h; NeonOutRun, a decoy flag), and the short "
                  "bar right after each is the fresh session that solved it. Challenges 6 and 7 weren't metered live; "
                  "their windows come from commit times.",
                  table(("attempt", "start (UTC)", "end (UTC)", "wall clock", "cost", "result"), rows))


def cost_chart():
    w, rh, l, t = 960, 28, 196, 26
    h = t + rh * len(ATT) + 24
    lo, hi = 0.1, 1000
    x1 = w - 90
    fx = lambda v: l + (math.log10(v) - math.log10(lo)) / (math.log10(hi) - math.log10(lo)) * (x1 - l)
    body = []
    for v in (0.1, 1, 10, 100, 1000):
        x = fx(v)
        body.append(f'<line class="hc-grid" x1="{x:.1f}" x2="{x:.1f}" y1="{t - 6}" y2="{t + rh * len(ATT)}"/>'
                    f'<text class="hc-tick" x="{x:.1f}" y="{t - 12}" text-anchor="middle">{E(money(v) if v >= 1 else "$0.10")}</text>')
    rows = []
    for i, a in enumerate(ATT):
        y = t + i * rh
        body.append(f'<text class="hc-tick" x="{l - 10}" y="{y + rh / 2 + 4:.1f}" text-anchor="end">{E(a["lab"])}</text>')
        xb = fx(a["cost"])
        tip = f'{a["lab"]}: {money(a["cost"])}, {a["turns"]:,} turns, {a["tools"]:,} tool calls, {a["model"]}, {status(a)}'
        body.append(f'<g class="hc-hit"><rect class="{barcls(a)}" x="{l}" y="{y + 6}" width="{xb - l:.1f}" height="{rh - 12}"/>'
                    f'<rect class="hc-hitarea" x="{l}" y="{y}" width="{x1 - l}" height="{rh}"/><title>{E(tip)}</title></g>'
                    f'<text class="hc-label" x="{xb + 8:.1f}" y="{y + rh / 2 + 4:.1f}">{E(money(a["cost"]))}</text>')
        rows.append([E(a["lab"]), E(a["model"]), f'{a["turns"]:,}', f'{a["tools"]:,}', E(money(a["cost"])),
                     E(money(a["cost"] / a["tools"])), E(status(a))])
    return figure("cost", "What each attempt cost (log scale)", "API list-price equivalent per attempt on a log scale, "
                  "from 38 cents for challenge 1 to 483 dollars for the abandoned first crux attempt.", w, h, "".join(body),
                  "API list-price equivalent per attempt, log scale. Every attempt that ran entirely on Opus 5.5 cost "
                  "under $11; the four long Opus 4.8 sessions (catthief, ThreatInvaders, FlareCalc, crux attempt 1) "
                  "are 86% of the total. Hollow bars are the failed first attempts.",
                  table(("attempt", "model", "turns", "tool calls", "cost", "$ / tool call", "result"), rows))


def tokens_table():
    rows = []
    for a in ATT:
        rows.append([E(a["lab"]), f'{a["turns"]:,}', f'{a["inp"]:,}', compact(a["cw"]), compact(a["cr"]), compact(a["out"]),
                     f'<strong>{E(money(a["cost"]))}</strong>', E(money(a["cost"] / a["tools"]))])
    s = lambda k: sum(a[k] for a in ATT)
    rows.append(["<strong>all 11 attempts</strong>", f'<strong>{s("turns"):,}</strong>', f'<strong>{s("inp"):,}</strong>',
                 f'<strong>{compact(s("cw"))}</strong>', f'<strong>{compact(s("cr"))}</strong>',
                 f'<strong>{compact(s("out"))}</strong>', f'<strong>{money(s("cost"))}</strong>',
                 f'<strong>{money(s("cost") / s("tools"))}</strong>'])
    return table(("attempt", "turns", "input", "cache write", "cache read", "output", "cost", "$ / tool call"), rows,
                 summary="tokens and cost per attempt")


def split_table():
    tot = sum(c for _, c, _ in COST_SPLIT)
    rows = [[E(n), E(money(c) if c >= 1 else f"${c:.2f}"), compact(tk), f"{c / tot:.1%}"] for n, c, tk in COST_SPLIT]
    rows.insert(0, ["<strong>total</strong>", "<strong>$1,180</strong>", "<strong>1.48B</strong>", "<strong>100%</strong>"])
    return '<p class="hc-fig-title">Where the money went, by token type</p>' + table(("", "cost", "tokens", "share"), rows, summary="")


def price_table():
    rows = [[E(m)] + [f"{v:.2f}" for v in p] for m, *p in PRICES]
    return table(("model", "input", "output", "cache write 5 m", "cache write 1 h", "cache read"), rows,
                 summary="pricing used ($ per million tokens)")


def tool_heat():
    cw, ch, l, t = 44, 24, 186, 96
    w, h = l + cw * len(TOOLS) + 12, t + ch * len(ATT) + 40
    bins = [(0, None), (4, 5), (19, 4), (49, 3), (149, 2), (399, 1), (1e9, 0)]
    labs = ["1–4", "5–19", "20–49", "50–149", "150–399", "400+"]
    body = []
    for j, tl in enumerate(TOOLS):
        x = l + j * cw + cw / 2
        body.append(f'<text class="hc-tick" x="{x:.1f}" y="{t - 8}" transform="rotate(-50 {x:.1f} {t - 8})">{E(tl)}</text>')
    rows = []
    for i, a in enumerate(ATT):
        y = t + i * ch
        body.append(f'<text class="hc-tick" x="{l - 8}" y="{y + ch / 2 + 4:.1f}" text-anchor="end">{E(a["lab"])}</text>')
        vals = TOOLROWS[a["k"]]
        top = max(vals)
        for j, v in enumerate(vals):
            if not v:
                continue
            b = next(bb for lim, bb in bins if v <= lim)
            body.append(f'<rect class="hc-cell hc-b{b}{" hc-top" if v == top else ""}" x="{l + j * cw + 1}" y="{y + 1}" '
                        f'width="{cw - 2}" height="{ch - 2}"><title>{E(a["lab"])}: {E(TOOLS[j])} in {v} commands</title></rect>')
        rows.append([E(a["lab"])] + [(f"<strong>{v}</strong>" if v == top else str(v)) if v else "" for v in vals])
    ly = t + ch * len(ATT) + 18
    for k, lab in enumerate(labs):
        x = l + k * 84
        body.append(f'<rect class="hc-cell hc-b{5 - k}" x="{x}" y="{ly}" width="14" height="14"/>'
                    f'<text class="hc-tick" x="{x + 20}" y="{ly + 11}">{E(lab)}</text>')
    return figure("tools", "Which tools each attempt leaned on",
                  "A grid of eleven attempts by seventeen tools; darker cells mean more shell commands used that tool.",
                  w, h, "".join(body),
                  "Shell commands that mention each tool, per attempt (keyword match, so one command can count toward "
                  "several tools). 2,955 of the 3,513 tool calls were Bash. Each challenge's specialist stands out: "
                  "Frida for catthief, ILSpy for ThreatInvaders, Node for crux's WASM harness, WSL and gdb for "
                  "NeonOutRun.",
                  table(["attempt"] + TOOLS, rows, cls="hc-wide"))


def results_table():
    rows = []
    for a in ATT:
        flag = FLAGS.get(a["k"])
        if a["res"] == "rejected":
            fl = f"<s><code>{E(flag)}</code></s>"
        elif flag and a["res"] == "ok":
            fl = f"<code>{E(flag)}</code>"
        else:
            fl = "no flag"
        rows.append([f'<strong>{E(a["lab"])}</strong>', E(WHAT[a["k"]]), fl, E(a["model"]),
                     E(dur(a["secs"]) + (" (est.)" if a["est"] else "")), E(money(a["cost"])), f'{a["tools"]:,}'])
    return ('<p class="hc-fig-title">Per-challenge results</p>' +
            table(("attempt", "what it was", "flag", "model", "wall clock", "cost", "tool calls"), rows, cls="fo-results",
                  summary=""))


def retry_table():
    pairs = [("8a", "8b"), ("9a", "9b")]
    rows = []
    for x, y in pairs:
        a, b = next(q for q in ATT if q["k"] == x), next(q for q in ATT if q["k"] == y)
        rows.append([f'<strong>{E(a["ch"])}</strong>',
                     f'{E(status(a))} · {E(money(a["cost"]))} · {E(dur(a["secs"]))} · {a["tools"]:,} tool calls · {E(a["model"])}',
                     f'{E(status(b))} · {E(money(b["cost"]))} · {E(dur(b["secs"]))} · {b["tools"]:,} tool calls · {E(b["model"])}',
                     f'<strong>{b["cost"] / a["cost"]:.1%}</strong>'])
    return '<p class="hc-fig-title">The two restarts</p>' + table(("", "attempt 1", "attempt 2", "attempt 2 as a share of attempt 1"),
                                                                 rows, summary="")


# ---------------------------------------------------------------- flowcharts (grid layout, orthogonal edges)
PAD, GAP, RH, BH = 64, 44, 96, 62
FILES = None


def N(c, r, t, s=(), k="box", cls="", f=None, d=None, span=1):
    return dict(c=c, r=r, t=t, s=list(s) if not isinstance(s, str) else [s], k=k, cls=cls, f=f, d=d, span=span)


def flow(cid, title, desc, cols, nodes, edges, caption, width=960):
    W = width
    cw = (W - 2 * PAD) / cols
    rows = max(n["r"] for n in nodes.values()) + 1
    h = PAD + 10 + rows * RH - (RH - BH) + 14

    def box(n):
        return PAD + n["c"] * cw + GAP / 2, 12 + n["r"] * RH, cw * n.get("span", 1) - GAP, BH

    geo = {k: box(n) for k, n in nodes.items()}
    out = [f'<defs><marker id="ar-{cid}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" '
           'orient="auto-start-reverse"><path class="hc-arrowhead" d="M0,0L8,4L0,8z"/></marker></defs>']

    def lab(x, y, t, anchor="start"):
        return f'<text class="hc-rowlab" x="{x:.0f}" y="{y:.0f}" text-anchor="{anchor}">{E(t)}</text>'

    for e in edges:
        src, dst, label, route = e[:4]
        gut = e[4] if len(e) > 4 else 18
        ax, ay, aw, ah = geo[src]
        bx, by, bw, bh = geo[dst]
        acx, acy, bcx, bcy = ax + aw / 2, ay + ah / 2, bx + bw / 2, by + bh / 2
        if route in ("right", "left"):
            side = 1 if route == "right" else -1
            sx = ax + aw if side > 0 else ax
            tx = bx + bw if side > 0 else bx
            gx = (max(sx, tx) + gut) if side > 0 else (min(sx, tx) - gut)
            d = f"M{sx:.0f},{acy:.0f} H{gx:.0f} V{bcy:.0f} H{tx + 2 * side:.0f}"
            lx, ly, anc = gx + 5 * side, (acy + bcy) / 2, "start" if side > 0 else "end"
        elif route == "vh":
            down = bcy > acy
            y0 = ay + ah if down else ay
            tx = bx + bw + 2 if bcx < acx else bx - 2
            d = f"M{acx:.0f},{y0:.0f} V{bcy:.0f} H{tx:.0f}"
            lx, ly, anc = acx + 6, y0 + (16 if down else -8), "start"
        elif route == "hv":
            right = bcx > acx
            sx = ax + aw if right else ax
            ty = by - 2 if bcy > acy else by + bh + 2
            d = f"M{sx:.0f},{acy:.0f} H{bcx:.0f} V{ty:.0f}"
            lx, ly, anc = sx + (6 if right else -6), acy - 7, "start" if right else "end"
        elif abs(acy - bcy) < 1:
            if bx > ax:
                d, lx = f"M{ax + aw:.0f},{acy:.0f} H{bx - 2:.0f}", (ax + aw + bx) / 2
            else:
                d, lx = f"M{ax:.0f},{acy:.0f} H{bx + bw + 2:.0f}", (ax + bx + bw) / 2
            ly, anc = acy - 7, "middle"
        elif bcy > acy:
            if abs(acx - bcx) < 1:
                d = f"M{acx:.0f},{ay + ah:.0f} V{by - 2:.0f}"
            else:
                ym = ay + ah + (by - ay - ah) / 2
                d = f"M{acx:.0f},{ay + ah:.0f} V{ym:.0f} H{bcx:.0f} V{by - 2:.0f}"
            lx, ly, anc = acx + 7, ay + ah + 16, "start"
        else:
            if abs(acx - bcx) < 1:
                d = f"M{acx:.0f},{ay:.0f} V{by + bh + 2:.0f}"
            else:
                ym = by + bh + (ay - by - bh) / 2
                d = f"M{acx:.0f},{ay:.0f} V{ym:.0f} H{bcx:.0f} V{by + bh + 2:.0f}"
            lx, ly, anc = acx + 7, ay - 8, "start"
        out.append(f'<path class="hc-edge" fill="none" d="{d}" marker-end="url(#ar-{cid})"/>')
        if label:
            out.append(lab(lx, ly, label, anc))

    for k, n in nodes.items():
        x, y, w, hh = geo[k]
        cls = f"hc-node hc-node-{n['cls']}" if n.get("cls") else "hc-node"
        kind = n.get("k", "box")
        if kind == "dec":
            shape = (f'<polygon points="{x + 14:.0f},{y:.0f} {x + w - 14:.0f},{y:.0f} {x + w:.0f},{y + hh / 2:.0f} '
                     f'{x + w - 14:.0f},{y + hh:.0f} {x + 14:.0f},{y + hh:.0f} {x:.0f},{y + hh / 2:.0f}"/>')
            tx = x + 24
        elif kind == "end":
            shape = f'<rect x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{hh}" rx="{hh / 2:.0f}"/>'
            tx = x + 26
        else:
            shape = f'<rect x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{hh}"/>'
            tx = x + 14
        subs = n.get("s") or []
        ty = y + (23 if subs else hh / 2 + 5)
        txt = f'<text class="hc-node-t" x="{tx:.0f}" y="{ty:.0f}">{E(n["t"])}</text>'
        for i, line in enumerate(subs[:2]):
            txt += f'<text class="hc-node-s" x="{tx:.0f}" y="{y + 41 + i * 14:.0f}">{E(line)}</text>'
        out.append(f'<g class="{cls}"><title>{E(n["t"])}: {E(" ".join(subs))}</title>{shape}{txt}</g>')

    def code(n):
        f = n.get("f")
        if not f:
            return "-"
        paths = [p.strip() for p in f.split(",")]
        if FILES is not None:
            missing = [p for p in paths if p not in FILES]
            if missing:
                sys.exit(f"{cid}: linked file(s) not in the repo: {missing}")
        return ", ".join(f'<a href="{REPO}{p}"><code>{E(p.rsplit("/", 1)[-1])}</code></a>' for p in paths)

    order = sorted(nodes.values(), key=lambda n: (n["r"], n["c"]))
    rows_t = [(E(n["t"]), E(n.get("d") or " ".join(n.get("s") or [])), code(n)) for n in order]
    return figure(cid, title, desc, W, h, "".join(out), caption,
                  table(("step", "what happens", "files"), rows_t, summary="steps and files"))


def flows():
    o = {}
    o["fl-loop"] = flow(
        "fl-loop", "How one challenge ran", "A kickoff prompt starts a Claude Code session; it triages, reverses and "
        "writes solver scripts; I steer it when it stalls, submit the flag it prints, and start a fresh session when "
        "a flag is rejected or the session is stuck.", 3,
        dict(
            k=N(0, 0, "Kickoff prompt", ["archive path, tools folder,", "the challenge text"], cls="ours",
                d="I paste the challenge text, the archive path and where the tools live (Ghidra, Frida, Python, Node, WSL)."),
            s=N(1, 0, "Claude Code session", ["Windows 11, one long session", "Opus 5.5, later Opus 4.8"],
                d="One interactive session; challenges 1-7 and crux attempt 1 all ran in the same session, across compactions."),
            w=N(2, 0, "Triage, reverse, script", ["Ghidra headless, unicorn,", "Frida, one script per idea"],
                d="The model extracts, decompiles, emulates and writes a solver script for every hypothesis."),
            d1=N(2, 1, "Stuck?", ["no new verified fact"], k="dec",
                 d="The only stop signal was me reading the session; nothing in the setup measured progress."),
            n=N(1, 1, "I steer", ["'continue', an offline hint,", "/model, 'spin up subagents'"], cls="ours",
                d="Nudges, corrections (no live server, the brute force is unnecessary), model switches."),
            c=N(2, 2, "Flag candidate", ["printed by a solver script"],
                d="Every flag came out of a script that can be re-run; the repo keeps them."),
            sub=N(1, 2, "I submit it", ["on the FLARE-On scoreboard"], cls="ours"),
            d2=N(1, 3, "Accepted?", k="dec"),
            ok=N(2, 3, "Write-up and commit", ["markdown, a diagram, stats"], k="end", cls="plat",
                 d="Each solve ends with a write-up, the solver files and a commit."),
            fresh=N(0, 3, "Fresh session", ["one structured /goal prompt"], cls="ours",
                    d="Used twice (crux, NeonOutRun); both solved within an hour."),
        ),
        [("k", "s", "", None), ("s", "w", "", None), ("w", "d1", "", None), ("d1", "n", "yes", None),
         ("n", "s", "", None), ("d1", "c", "no", None), ("c", "sub", "", None), ("sub", "d2", "", None),
         ("d2", "ok", "yes", None), ("d2", "fresh", "no", None), ("fresh", "k", "retry", None)],
        "One person, one Claude Code window, and a folder of tools. Red boxes are "
        "what I did; the rest is the model. A fresh session was the escape hatch, used twice.")

    o["fl-c2"] = flow(
        "fl-c2", "GhostStream: the key travels through a pipe", "Extract the WIM with its alternate data streams; the "
        "parent drops a child and sends it a key over a named pipe; sniffing the pipe gives HarryPotter, which keys a "
        "modified RC4 in the child.", 3,
        dict(
            wim=N(0, 0, "GhostStream.wim", ["7z x -sns keeps the ADS"], cls="plat"),
            par=N(1, 0, "parent exe", ["reads an ADS on", "PolyjuicePotion.txt"]),
            ch=N(2, 0, "child exe", ["dropped into %TEMP%"], f="2-ghoststream/carve_child.py"),
            pipe=N(1, 1, "named pipe", ["\\\\.\\pipe\\FlareChallenge"]),
            dec=N(2, 1, "string decryptor", ["op picked by byte-sum"], f="2-ghoststream/dec.py"),
            gue=N(0, 2, "static key guesses", ["potion text, AlbusDumbledore", "variants: none hit"]),
            sn=N(1, 2, "sniff the pipe", ["patched parent, own %TEMP%", "→ 'HarryPotter'"], cls="ours",
                 f="2-ghoststream/patch_parent.py,2-ghoststream/sniff.py"),
            rc4=N(2, 2, "modified RC4", ["PRGA step i += 18,", "extra XOR mask"], f="2-ghoststream/flag.py"),
            fl=N(2, 3, "flag", ["y0u_kn0w_n07h1n6_j0n_5n0w"], k="end", cls="plat"),
        ),
        [("wim", "par", "", None), ("par", "ch", "drops", None), ("par", "pipe", "", None), ("pipe", "sn", "", None),
         ("gue", "sn", "", None), ("sn", "rc4", "key", None), ("ch", "dec", "", None), ("dec", "rc4", "", None),
         ("rc4", "fl", "", None)],
        "8.3 minutes on Opus 5.5. Guessing the key from the static strings failed; watching the real pipe message "
        "settled it.")

    o["fl-c3"] = flow(
        "fl-c3", "flareon13.doc: one file, six formats", "The .doc is a raw CD image; its UDF holds a fat Mach-O "
        "whose six fragments, each checked by an MD5, hash into an RC4 key. The COM, ZIP and PDF layers are side "
        "trails.", 3,
        dict(
            doc=N(1, 0, "flareon13.doc", ["COM, CD, UDF, ZIP, PDF, Mach-O"], cls="plat"),
            com=N(0, 1, "DOS COM stage", ["unicorn 16-bit, int 21h", "a side trail"], f="3-doc/com_emu.py,3-doc/small_emu.py"),
            cd=N(1, 1, "raw CD image", ["2352-byte sectors → cd.iso"], f="3-doc/carve.py"),
            zp=N(2, 1, "ZIP (Reduce) and PDF", ["hand-written unreduce.py", "a side trail"], f="3-doc/unreduce.py,3-doc/pdfdec.py"),
            udf=N(1, 2, "UDF → click_me", ["fat Mach-O, arm64 slices"], cls="ours",
                  d="7-Zip run straight on the .doc yields a different, decoy Mach-O; the real one is inside the UDF."),
            fr=N(1, 3, "six fragments", ["each checked by an MD5"]),
            key=N(1, 4, "key = XOR of SHA-256s", ["then standard RC4"], f="3-doc/final.py"),
            fl=N(1, 5, "flag", ["Ju$7_4_l177l3_7r34$ur3_HUN7"], k="end", cls="plat"),
        ),
        [("doc", "com", "", None), ("doc", "cd", "", None), ("doc", "zp", "", None), ("cd", "udf", "", None),
         ("udf", "fr", "", None), ("fr", "key", "", None), ("key", "fl", "", None)],
        "14.5 minutes on Opus 5.5. The model chased every layer; only the CD → UDF → Mach-O path carries the flag.")

    o["fl-c4"] = flow(
        "fl-c4", "ToxicMiner: brute-force the volume serial", "A trojanized cpuminer derives an RC4 key from the C: "
        "volume serial with a modified SHA-256d. Re-implementing the hash failed; mapping the PE and calling its own "
        "functions made a 2^32 sweep exact.", 3,
        dict(
            exe=N(0, 0, "ToxicMiner.exe", ["trojanized cpuminer-multi"], cls="plat"),
            rt=N(1, 0, "hidden routine", ["reads the C: volume serial"]),
            sha=N(2, 0, "SHA-256d on u32 words", ["seed word 0x0b501e7e"]),
            rc4=N(2, 1, "RC4, 16-byte key", ["decrypts a 0x33-byte blob"]),
            rec=N(1, 1, "pure-C rewrite", ["recover.c: no hit,", "the SHA is modified"], f="4-toxicminer/recover.c"),
            har=N(1, 2, "image-mapping harness", ["map PE at 0x140000000,", "call its own functions"], cls="ours",
                  f="4-toxicminer/make_image.py,4-toxicminer/harness.c"),
            sw=N(1, 3, "2^32 serial sweep", ["sharded, find flare-on.com"]),
            fl=N(2, 3, "flag", ["serial 0x01CEC01D"], k="end", cls="plat"),
        ),
        [("exe", "rt", "", None), ("rt", "sha", "", None), ("sha", "rc4", "", None), ("rc4", "rec", "", None),
         ("rec", "har", "", None), ("har", "sw", "", None), ("sw", "fl", "", None)],
        "78.6 minutes, Opus 5.5 then Opus 4.8. Calling the sample's own code removed the risk of a subtly wrong hash.")

    o["fl-c5"] = flow(
        "fl-c5", "catthief: turn the implant into an oracle", "RC4 with a fixed key comes off quickly; the implant's "
        "own Huffman format took hours until Frida fed it known inputs and read back the codes.", 3,
        dict(
            inp=N(0, 0, "implant + pcap", ["Rust exe, 6 POST /exfil"], cls="plat"),
            rc4=N(1, 0, "RC4, key XOR 0x33", ["i11_b3_p1und3r1n_y3r_d474"]),
            rsp=N(2, 0, "responses decrypt", ["to Windows file paths"]),
            cmp=N(1, 1, "own compress.rs", ["not flate2: custom Huffman"]),
            sa=N(0, 1, "subagent killed", ["cyber safeguard;", "the work continued inline"]),
            fr=N(1, 2, "Frida oracle", ["redirect connect, CreateFileW;", "feed known byte counts"], cls="ours"),
            fmt=N(1, 3, "format pinned", ["lengths = int(pt[1:262]) >> 5", "data at bit 2091"]),
            dec=N(1, 4, "canonical Huffman", ["5 JPEGs, Kraft sum = 1"], f="5-catthief/extract_bodies.py,5-catthief/decoder.py,5-catthief/solve5.py"),
            fl=N(2, 4, "flag", ["painted on a scroll"], k="end", cls="plat"),
        ),
        [("inp", "rc4", "", None), ("rc4", "rsp", "", None), ("rc4", "cmp", "", None), ("cmp", "sa", "", None),
         ("cmp", "fr", "", None), ("fr", "fmt", "", None), ("fmt", "dec", "", None), ("dec", "fl", "", None)],
        "8.9 hours (first session) on Opus 4.8, $272. The table's >>5 scaling and the unaligned bit-2091 start were the "
        "blockers; the oracle answered both.")

    o["fl-c6"] = flow(
        "fl-c6", "ThreatInvaders: the runtime is the malware", "The managed game code is clean; a custom CoreCLR "
        "detours a telemetry method and XOR-encrypts an updater's output with a keystream seeded by the MachineGuid, "
        "which a header beacon leaks.", 3,
        dict(
            inp=N(0, 0, "exe + pcap", ["116 MB .NET 10 single-file"], cls="plat"),
            il=N(1, 0, "managed IL", ["a faithful game: the decoy"]),
            pc=N(2, 0, "pcap disagrees", ["feedback_length 8208, 16914"]),
            st=N(0, 1, "my steer", ["no live server;", "the pcap is enough"], cls="ours"),
            ep=N(1, 1, "EventPipe + Frida", ["JIT'd code → detour", "at RVA 0xC6BA0"], cls="ours",
                 f="6-threatinvaders/ThreatInvaders/csharp/eptrace/Program.cs,6-threatinvaders/ThreatInvaders/exp/hook_trace.js"),
            clr=N(2, 1, "custom static CoreCLR", ["fake version 42.42.42.42424"]),
            pcg=N(1, 2, "PCG/LCG XOR stream", ["seed = splitmix64(MachineGuid)"]),
            t3=N(1, 3, "TEL#3 leaks the seed", ["MachineGuid = TEL#3 XOR", "reverse(session_id)"], cls="ours"),
            dec=N(1, 4, "decrypt TEL#4, TEL#5", ["a dir listing, then flag.txt"], f="6-threatinvaders/ThreatInvaders/solve.py"),
            fl=N(2, 4, "flag", ["wh4t_4_l0ng_str4ng3_tr1p"], k="end", cls="plat"),
        ),
        [("inp", "il", "", None), ("il", "pc", "", None), ("pc", "clr", "", None), ("clr", "ep", "", None),
         ("st", "ep", "", None), ("ep", "pcg", "", None), ("pcg", "t3", "", None), ("t3", "dec", "", None),
         ("dec", "fl", "", None)],
        "About 6 hours on Opus 4.8. I had to say twice that there was no server to talk to; once the model accepted "
        "the pcap as the ground truth, the solve needs only the capture.")

    o["fl-c7"] = flow(
        "fl-c7", "FlareCalc: an implant inside the signature", "The calculator maps its own Authenticode certificate "
        "and runs a packer VM stored in a custom OID; a 2^32 seed brute force, per-blob XOR folds and a 32-step "
        "labyrinth lead to an XTEA decryptor run under unicorn.", 3,
        dict(
            exe=N(0, 0, "FlareCalc.exe", ["obfuscated GUI calculator"], cls="plat"),
            egg=N(1, 0, "easter eggs (decoys)", ["FLAG{NICE_TRY}, a rickroll"]),
            ld=N(0, 1, "hidden self-loader", ["maps its own cert RWX"]),
            oid=N(1, 1, "OID 1.3.6.1.4.1.1337.1", ["1,035 {key, blob} records"]),
            vm=N(2, 1, "VM unpack per blob", ["XOR fold, then deinterleave"], f="7-flarecalc/unpack.py"),
            sd=N(2, 2, "2^32 seed brute force", ["oracle: blob disassembles", "with no invalid opcodes"], cls="ours",
                 f="7-flarecalc/seedscan.c"),
            fo=N(1, 2, "fold by byte frequency", ["256 options, ~10 sigma"]),
            bd=N(0, 2, "bind-shell backdoor", ["anti-VM gates, two XTEAs"]),
            lb=N(0, 3, "labyrinth DFS", ["32 input bytes, one path"], cls="ours", f="7-flarecalc/chain_dfs.py"),
            uc=N(1, 3, "unicorn runs blob 4485", ["XTEA on blob 9990"], f="7-flarecalc/solve7.py"),
            fl=N(2, 3, "flag", ["t3mplat3s_asn_and_j1t_0h_my"], k="end", cls="plat"),
        ),
        [("exe", "egg", "", None), ("exe", "ld", "", None), ("ld", "oid", "", None), ("oid", "vm", "", None),
         ("vm", "sd", "", None), ("sd", "fo", "", None), ("fo", "bd", "", None), ("bd", "lb", "", None),
         ("lb", "uc", "", None), ("uc", "fl", "", None)],
        "About 4.2 hours on Opus 4.8, after I asked it to emulate first and use subagents to plan. Everything is "
        "recovered statically; no network, no live C2.")

    o["fl-c8"] = flow(
        "fl-c8", "crux: two attempts at the same certificate", "Both attempts built custom WASM tooling. Attempt 1 "
        "chased wrong models, then encoded one leaf non-canonically and hunted a SHA-256 preimage for a day; attempt "
        "2 traced concrete values, built the certificate for 3, saw the target prime and factored it.", 3,
        dict(
            ext=N(1, 0, "extension.zip", ["MV3 popup, 5.8 MB Go WASM"], cls="plat"),
            tl=N(1, 1, "own WASM tooling", ["wabt output hit 1.8 GB;", "flat decompiler, hook rewriter"],
                 f="8-crux-attempt-2/work/pcln.py,8-crux-attempt-2/work/dec.py,8-crux-attempt-2/work/instr.py,8-crux-attempt-2/work/trace.js"),
            a1=N(0, 2, "A1: wrong models", ["32-47-byte message,", "an 'S-expression evaluator'"]),
            a1b=N(0, 3, "A1: 14-byte leaf for 2", ["passes the verifier,", "hashes to the wrong key"]),
            a1c=N(0, 4, "A1: SHA-256 preimage", ["~24 h, $483, abandoned"], k="end"),
            a2=N(2, 2, "A2: trace values", ["args and bigints per call"]),
            a2b=N(2, 3, "certificate for 3", ["20 bytes; check exposes N"], cls="ours"),
            a2c=N(2, 4, "sympy factors N-1", ["50 primes, 3,891-byte cert"], f="8-crux-attempt-2/solve8.py"),
            fl=N(2, 5, "flag", ["19 minutes, $3.26"], k="end", cls="plat", f="8-crux-attempt-2/ext/run.js"),
        ),
        [("ext", "tl", "", None), ("tl", "a1", "", None), ("tl", "a2", "", None),
         ("a1", "a1b", "", None), ("a1b", "a1c", "", None), ("a2", "a2b", "", None), ("a2b", "a2c", "", None),
         ("a2c", "fl", "", None)],
        "The left column cost $483 over about 24 hours; the right one $3.26 in 19 minutes. The difference was one "
        "byte of grammar: the prime 2 is the single byte 0x00.")

    o["fl-c9"] = flow(
        "fl-c9", "NeonOutRun: the victory screen is the decoy", "The game script shows a decoy flag; Rust hooks on "
        "three V8 builtins record each lap time as a flag byte and only swap the real bytes in when a sine gate holds "
        "for all 28 laps.", 3,
        dict(
            elf=N(1, 0, "neon_outrun", ["Rust Tauri v2 + V8 9.5"], cls="plat"),
            gj=N(0, 1, "game.js from a core", ["WSLg, gcore, grep carRatio"], f="9-neonoutrun-attempt-2/dump.sh"),
            hk=N(2, 1, "hooks on V8 builtins", ["sort, Math.min, replaceAll"], f="9-neonoutrun-attempt-2/cdis.py,9-neonoutrun-attempt-2/xref.py"),
            vs=N(0, 2, "victory-screen string", ["decode_this_system_to_win_it"], f="9-neonoutrun-attempt-2/solve.py"),
            a1=N(0, 3, "A1 submits it", ["gate called unsatisfiable;", "rejected"], k="end"),
            mm=N(2, 2, "Math.min: lap secs", ["= flag byte; G1 += dq", "x sin((K +/- t) deg)"]),
            gt=N(2, 3, "gate G1 == G2", ["so sin = 1 on every lap"], cls="ours"),
            uc=N(2, 4, "unicorn: K, sign per lap", ["28 congruences, one t each"], f="9-neonoutrun-attempt-2/emu.py"),
            fl=N(2, 5, "flag", ["R3_ag3nt_4b0ut_t0_f33l_d1zzy"], k="end", cls="plat", f="9-neonoutrun-attempt-2/solve2.py"),
        ),
        [("elf", "gj", "", None), ("elf", "hk", "", None), ("gj", "vs", "", None), ("vs", "a1", "", None),
         ("hk", "mm", "", None), ("mm", "gt", "", None), ("gt", "uc", "", None), ("uc", "fl", "", None)],
        "Attempt 1 found all three hooks but assumed the angle didn't depend on the lap time. Attempt 2 checked what "
        "each operand depends on and solved it in 50 minutes.")
    return o


# ---------------------------------------------------------------- main
def main():
    global FILES
    os.makedirs(OUT, exist_ok=True)
    if len(sys.argv) > 1:
        FILES = set(subprocess.run(["git", "-C", sys.argv[1], "ls-files"], capture_output=True, text=True,
                                   check=True).stdout.split("\n"))
    assert abs(sum(a["cost"] for a in ATT) - 1178.66) < 0.01
    assert sum(a["tools"] for a in ATT) == 3513
    parts = {"tiles": headline_tiles(), "timeline": timeline(), "cost": cost_chart(), "tokens": tokens_table(),
             "split": split_table(), "prices": price_table(), "tools": tool_heat(), "results": results_table(),
             "retries": retry_table()}
    parts.update(flows())
    for k, v in parts.items():
        write(k, v)
    print(f"wrote {len(parts)} partials to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
