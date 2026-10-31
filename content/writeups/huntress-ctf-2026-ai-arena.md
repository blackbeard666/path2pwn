---
title: "Building an AI harness that placed 3rd at Huntress CTF 2026"
date: 2026-10-31
category: "ai"
tags: ["ctf", "ai", "agents", "automation", "huntress", "re", "mobile", "web", "forensics"]
summary: "A month of not solving challenges: how a parallel orchestrator of Claude Code workers, prior-solver races and a learning loop cleared all 561 modes of the Huntress CTF 2026 AI Arena and finished 3rd of 1,589 teams, with every number we kept."
source: "ctf"
draft: false
---

{{< hctf2026 "tiles" >}}

## The event

Huntress CTF 2026 ran every day of October as an **AI Arena**: challenges built to be solved by automation. Each day at
09:00 ET a new batch dropped across five lanes (warmups, metadata forensics, script analysis, binary reverse
engineering, mobile Android), with a sixth lane, web exploitation, joining on day 19. Every challenge had three modes:

- **Single Solve**: one artifact, untimed. Get the answer right, collect the flag.
- **Time Trial**: a fresh variant behind a server-enforced countdown of a few seconds.
- **Mastery**: a bundle of variants (sometimes thousands of answers) under one clock.

Answers were not flags you find in the bytes. A Game Master (GM) service handed out artifacts and judged answers, often
against *synthetic labels*: its own snake_case spelling for a concept, which you only learn by submitting it. Later Mastery modes also mixed earlier days' techniques into today's bundle.

Thirty-one days, 189 challenges, 561 modes and 1,885 points. 37 teams finished with every point, so **placement among
them came down to one thing: how fast you cleared the last day.** Ours cleared day 31 at **T+4:15**, which put us
**3rd of 1,589 teams**.

## The bet: build the harness, not the solves

The harness started on October 3 (days 1-2 were played before it existed), and from then on the rule was that a
human does not solve challenges. A human builds and fixes the thing that
solves them, and the thing gets better every night. Three choices followed from that:

1. **Everything in parallel.** One chain per challenge, all chains at once, each running single → Time Trial →
   Mastery as soon as the previous mode is correct.
2. **The LLM solves; code makes it fast.** Workers are `claude -p` sessions with real tools (readelf, Ghidra, jadx,
   exiftool, apktool, ilspy). Early on I tried hand-built deterministic parsers per lane and reverted them the same
   morning. The challenges are unknown, and a parser for yesterday's format is a liability today. What *is* allowed
   to be deterministic is anything the LLM already proved: a solver it wrote, a label the GM confirmed.
3. **The clock never waits on an LLM.** The single-solve worker must leave behind a `solve.py` that reproduces its
   answer from the bytes. Timed modes run that solver with no model in the loop.

{{< hctf2026 "arch" >}}

### One chain per challenge

The day launcher (`hctf run`, a memory-capped systemd unit) arms before the drop and polls the GM's status endpoint
every 0.3 s. The median release lag ended up around 1-3 s. The moment a lane lists, its chain starts:

- **Triage** (no LLM) downloads the artifact, detects the toolchain from the bytes and the description, installs
  anything missing, and writes a `triage.md` the worker reads first.
- A **warm worker** is already running when the bytes land. It was launched at chain start, answered `READY`, and gets
  `GO` plus the triage the moment it exists.
- The worker runs in a **bubblewrap sandbox** that hides other projects, transcripts and the Windows filesystem. A
  rehearsal early on showed a worker will happily `find / -name solve.py` and copy whatever it finds, and prompt
  rules didn't stop that. Only the sandbox did.

### The reuse race

From day 12 every single solve opens with a **race**. The newest three same-lane solvers plus a cumulative lane solver
run against today's bytes, and anything they agree on is submitted. The race is never a gate: the worker keeps going
beside it, and whatever the race proves is pushed into the worker through a hook ("HARNESS UPDATE: 398/406 fields
confirmed"). Before day 12 the race won 0 of 5 singles a day. From then on it usually won 3-5 of 5, and on day 22 all
five.

For big binaries the race moved **into the network**: from day 26 a single of 10 MB or more races on the
organizer's Homebase VM, next to the GM, so the bytes never cross a home VPN. When the race clears all but a few fields,
an **answer-first** worker at medium effort reads the leftovers straight from the bytes while the main worker keeps
writing the solver.

### The timed runner and Homebase

Time Trials gave a few seconds, so the timed path is a script, not an agent:
start → download → `solve.py` → submit. The organizers provided each team a **Homebase** VM inside the CTF
network (2 vCPU, 60 credits a day), and routing to it was measured rather than assumed:

- Timed submits through the inside proxy dropped from **2.76 s to 0.55 s** on day 5.
- A **warm solver daemon** keeps one persistent SSH channel and a pre-loaded "zygote" per solver. Each attempt forks
  it, so solver start went from ~190 ms to 15-51 ms.
- `gmroute` sends every GM call down whichever path is fastest right now, hedges slow calls, and screams `!!! slow
  transport` when the client time drifts far from the GM's own elapsed time.

### When a timed variant fails

A wrong answer under the clock is the expensive case, so every failure becomes data:

- The variant is saved as a **regression case** with every GM-confirmed answer.
- A **transactional generalize** worker edits the solver. The edit is kept only if every previously passing case
  still passes; otherwise it goes to `.generalize-rejected/`. Workers can never write the expected answers.
- A **duel** races two or three generalizers (Opus at medium plus a Sonnet racer), and the first verified fix wins.
- A **live-answer** worker meanwhile answers only the still-unresolved fields inside the open attempt.

### Learning overnight

After each day the **post-run** turned what was proven into tomorrow's head start:

- a test-gated **ratchet**, the only writer to the shared `lib/`, which promotes techniques and GM-confirmed labels
  (`lib/knowledge.py`, `lib/vocab.json`)
- per-lane **technique logs**
- **speed-harden**, which re-times every solver and rolls back unless it is at least 5% faster
- **prebuild**: off-peak workers speculatively building decoders for tomorrow's *unknown* variants, kept only as race
  entries and only behind fixtures

The GM label grammar (`lib/playbook.py`) grew into naming laws per field family. An ATT&CK reference with 858
technique ids guarded every submit that looked like one.

## One drop, minute by minute

Day 31, the final drop, straight off the live feed:

| T+ | event |
|---|---|
| 0:00 | Day 31 listed; 7 chains / 21 modes start |
| 0:16 | mobile and warmups singles won by the reuse race |
| 0:35 | mobile done (all three modes) |
| 0:44 | metadata single, answer-first |
| 0:51 | warmups done |
| 1:26 | script done |
| 2:02 | web "Full Stack Incident" done |
| 2:34 | web "Framework Roulette" done |
| 2:38 | metadata Mastery blocked on one list field in 11/15 sets → generalize + duel |
| 3:34 | binary single: a 36 MB, 434-field "Final Boss"; all three race solvers errored, so the LLM solved it |
| 3:44 | duel generalize accepted (62 s) |
| 3:50 | metadata Mastery done |
| 4:10 | binary Mastery done: **21/21** |

## Placement over the month

The official scoreboard publishes every team's scored questions with timestamps. That means the board can be
**replayed**: for any instant in October you can recompute every team's points and the tie-break (who reached that
total first). This is our rank, hour by hour:

{{< hctf2026 "rank" >}}

Three things stand out:

- **The late days hurt the most.** Day 3 was the harness's first live day and took 18 hours. On days 10-12 the host
  was asleep at the drop, and on day 30 the weekly usage limit had stopped every worker the night before. On those
  days we dropped as low as 30th-100th, and climbed back once the day was cleared.
- **On days we ran at the drop, we were usually top 10.** We finished 14 of the 31 days in the overall top 10 and
  eight in the top 5.
- **The final rank was a speed race.** By the end 37 teams held every point, so the order among them is simply who
  finished day 31 first. 4:15 was good for 3rd.

## How fast we cleared each day

{{< hctf2026 "finish" >}}

Measured the same way for every team (drop to last scored question), our best day was **day 18 at T+1:43**, the only
on-time day under the 2:00 target. The median over the 24 days the harness ran at the drop was **9:12**. The second
half was slower than the first (11:28 vs 8:36 median) for one reason: **web**. Each web mode needed a live target the GM
provisioned on demand, and Mastery targets took up to ten minutes to come up. The fastest teams' clears also crept
down all month; by the end the leader routinely finished within 1-4 minutes.

{{< hctf2026 "lanes" >}}

Mobile and warmups were almost always fast. Script and binary were the long poles in the first half (thousands-of-field
Masteries, unknown label spellings). Web owned the second half until late October, when provisioning and our handling
of one-shot targets improved.

## The month, day by day

{{< hctf2026 "days" >}}

"Cleared" is drop to the day's last scored question, from the official scoreboard. `*` marks days the harness did not
run at the drop; `†` marks days 1-2, played before the harness existed.
"Day rank" is our position among teams that cleared that whole day, ordered by finish time. "Overall" is our overall
rank at the end of that day. "Worker $" is all worker spend on that day's challenges: solving, generalizing, duels
and any re-runs (instrumented from day 9).

## What moved the clock

{{< hctf2026 "wins" >}}

The biggest single lever was not a model change. It was **making the work disappear from the critical path**:

- **Race before you reason.** The reuse race and answer-first workers turned most singles from a 2-4 minute agent run
  into a 15-45 second confirmation.
- **Fix the environment the agent runs in.** On a 3 GB repo, Claude Code's per-call edit-diff snapshot cost 10-25 s on
  *every* write-ish shell call. Turning it off for workers took a worker's first shell call from 24.6 s to about 1 s.
  Copying prior regression cases (654 MB) into each worker stalled every tool call; hardlinks fixed it.
- **Move bytes, not agents.** Big timed starts came back as 9.5 MB replies on a single SSH channel (59.6 s of client
  time for 1.75 s of GM time). Routing big replies to the public path and keeping the Homebase channel for small calls
  took a script Mastery start from 60 s to 6.3 s.
- **Make the decoder fast enough to be boring.** Joint decoding in `lib.decode` took an 83-blob warmups Mastery from
  751 s to 16.5 s (45x), and a 1,139-blob corpus from 38 minutes to 8.5 s.
- **Rehearse against a fake GM.** `hctf/replay_gm.py` replays a solved day locally (singles judged offline, timed
  modes against the real GM's fresh variants). A fault-injection mode backs a test suite that runs in every warm-up
  preflight. Replays took day 7 from T+6:16 to T+2:07 and a day 24 A/B from 2:43 to 1:30.

## War stories

### The VPN that flapped every four minutes (day 6)

Homebase sat behind an OpenVPN profile, and the server allows one session per profile. A Windows OpenVPN GUI left
connected since day 3 kept evicting the Linux tunnel, so roughly every four minutes there were ~60 s with no Homebase.
Timed attempts that landed in a gap fell back to local and expired. The fix: the VPN runs as a CLI systemd unit only,
and preflight fails if the Windows client is up.

### The silent GM change (day 8)

Overnight the GM split its variant pools without notice. The same night a stale keep-alive socket made submits die with
`RemoteDisconnected`, a 157 MB evidence pull crawled over a ~140 KB/s tunnel, and a one-flag regression in our `7z`
wrapper broke every pre-extraction. The board took T+20:22. Every one of those became a preflight check or a test.

### The field nobody could answer (day 17)

Two binary fields resisted about 11,000 label probes. They were open-vocabulary and genuinely unanswerable: a GM-side
bug. Roughly four hours later the organizers rewrote them in place into an enum, and the harness solved them first
try. The lesson went into the harness as a **contract-drift watcher**: when a field resists probes, re-fetch the
question contract and diff it.

### The 10,465-field Mastery (day 23)

The worst day: T+28:55. A script Mastery carried 10,465 fields. A generalize worker died with `prompt_too_long` at
~1.39M tokens of diffs, and ten minutes went to probing labels on a composite field. The fixes (diff summarisation,
composite-field splitting, parallel group-test bisection in waves of 12) landed overnight, and day 24 ran clean at
T+2:09 for the regular board.

### The MTU blackhole (day 21)

Homebase SSH hung at key exchange. The post-quantum KEX packet was larger than the ~1,200-byte path MTU, and the
ICMP "fragmentation needed" was filtered inside the VPN, so large packets vanished. The fix went from `ip link set tun0
mtu 1200` (needs root, not persistent) to an MSS-clamping SSH `ProxyCommand`, then into the VPN unit itself.

### The one-shot credit (day 27)

A web challenge handed out a one-shot credit, and concurrent helper requests spent it before the real exploit ran. The
worker read "reset the target" as forbidden and escalated. The fix was a `RUN_ALONE` flag for one-shot handlers, a
burn probe before the run, and a self-heal that resets through the arena, which the organizers confirmed is the
intended path.

### The weekly limit (day 30)

At 21:09 on day 29 every worker started failing with `usage_limit_reached`. The post-run and the overnight prebuild
died, but the feed only said "worker exit 1", so nobody noticed, and day 30 never launched at the drop. It was caught
up the next morning. Day 30's bonus binary, a hardened Rust crackme whose keys were derived from an environment
fingerprint, beat four autonomous worker launches and needed manual intervention. That same day the limit handling
learned to parse the dated reset and raise a loud `!!!` alert. It fired correctly hours later.

## What didn't work

- **Higher reasoning effort.** `xhigh` was tried twice with A/B replays and bought nothing measurable. High stayed the
  floor for every lane; duels and answer-first run at medium.
- **Single-solve duels.** Six racers per single saturated the CPU (load 28, 12 claude processes) and won 0 of 41
  launches. They were switched off on day 26; generalize duels stayed.
- **Hand-built lane parsers.** They were reverted on day 7, for the reason above.
- **Blocking quality gates on the critical path.** A pre-Mastery speed-harden on web cost ~4.5 minutes ahead of a
  14 s solve. Anything optional now *races* the critical path instead of gating it.

## Cost and tokens

{{< hctf2026 "cost-live" >}}

{{< hctf2026 "cost-night" >}}

Most of the money went to learning, not racing. **About $273 of the ~$2,030 went to the day's challenges
themselves** (solving $150, generalizing $58, duels $65). The bulk was the overnight prebuild ($1,503) and post-run ($254), which
bought determinism for the next day. These are list-price equivalents computed from token counts, not invoices, and
instrumentation started on day 9, so days 1-8 are missing.

{{< hctf2026 "stages" >}}

Tokens, from the per-worker ledger plus every orchestrator session transcript on disk (deduplicated by message id):

{{< hctf2026 "tokens" >}}

Prompt caching did the heavy lifting: about **97% of all tokens were cache reads**. A day's run re-reads the same
skills, playbooks and triage for every worker, and the orchestrator's long sessions re-read their own context every
turn.

## The numbers

- **Placement:** 3rd of 1,589 registered teams (861 scored at least one point); 1,885 of 1,885 points; every scorable
  question.
- **Challenges:** 189 challenges and 561 modes over 31 days and six lanes. Web added 31 challenges from day 19.
- **Fastest on-time clear:** day 18, T+1:43. Day 31: T+4:15. Median of the 24 days the harness ran at the drop: 9:12.
- **Daily race:** top 5 on 7 days and top 10 on 12 of those 24 days, among teams that cleared the whole day.
- **Workers:** 1,842 `claude -p` launches, 28,503 turns and ~198 worker-hours since day 9. Opus 5.5 did nearly all of
  it, with Sonnet 5.5 as a duel racer.
- **Tokens:** ~7.5B processed, ~40M of them output.
- **Harness:** 339 commits on 20 branches from Oct 3 to Oct 31. About 33k lines of orchestrator (`hctf/`), 195k lines
  of library (`lib/`, much of it generated codecs and decoders), 78 test files and 11 agent skills.
- **Homebase:** ~39 VM hours logged across 22 boots.
- **Hall of Fame (the public speed board):** our timed entries, all from days 7-13, sat mid-pack: a median rank in the
  20s, best 9th. That board ranked raw milliseconds per attempt, and from mid-month the GM ran timed modes untimed by
  default. We optimised wall clock for the whole board, not single-attempt milliseconds.

The full set, with every chart's table, is on the [stats dashboard](/ctf/huntress-2026/).

## Rules we ran by

- **Drop time is retrieve and launch only.** Every check happens at warm-up, never between the drop and the launch.
- **Never call an incomplete run your best.** Report N/N first, then compare per mode.
- **Solve everything before any post-run.** Freed capacity goes to stragglers, not to learning.
- **Only GM-confirmed knowledge is knowledge.** Internet references live in a separate layer, and workers can never
  write expected answers.
- **Every risk becomes a guarantee or a test.** "It falls back to the LLM" is not an accepted risk.

## What I'd keep

The thing that mattered most wasn't any single trick. It was the loop: every failure in a live run became a
regression case, a preflight check or a test before the next drop, and the harness was measurably faster the next
day. The best days weren't the ones where the model was clever. They were the ones where the model barely had to run.
