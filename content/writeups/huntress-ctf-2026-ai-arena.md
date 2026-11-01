---
title: "Building an AI harness that placed 3rd at Huntress CTF 2026"
date: 2026-10-31
category: "ai"
tags: ["ctf", "ai", "agents", "automation", "huntress", "re", "mobile", "web", "forensics"]
summary: "A month of not solving challenges: how a parallel orchestrator of Claude Code workers, prior-solver races and a learning loop cleared every mode of the Huntress CTF 2026 AI Arena and finished 3rd of 1,589 teams. The prompts, the models, the experiments, every decision, and every number we kept."
source: "ctf"
draft: false
---

> **This post was written by AI.** Claude (Opus 5.5, in Claude Code) drafted it from the harness's own repository,
> run logs, cost ledger and the orchestrator's day-by-day notes; I directed it, chose what to disclose, and reviewed
> it. The numbers were measured from that data rather than recalled. That fits: the harness it describes was built
> the same way.
>
> **The code is public:** [blackbeard666/huntress-ctf-2026-ai-harness](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness). File names below link to it.

**This retrospective comes in three parts:**

- **[Part 1: the story](/writeups/huntress-ctf-2026-ai-arena/)**: the event, how we placed, the bet on a harness, the models, every decision and the war stories. Start here if you want to know what happened and why. *(You are here.)*
- **[Part 2: inside the harness](/writeups/huntress-2026-harness-internals/)**: if you want to know how the harness actually works. Every moving part drawn as a flowchart and walked step by step, from the daily loop down to a single tool call, with links to the code.
- **[The numbers](/writeups/huntress-2026-dashboard/)**: if you just want the data. Placement replayed hour by hour, daily clear times, per-lane speed, spend and tokens, as interactive charts with table views.

{{< hctf2026 "tiles" >}}

## The event

Huntress CTF 2026 ran every day of October as an **AI Arena**: challenges built to be solved by automation. Each day at
09:00 ET (21:00 in Manila, where all of this ran) a new batch dropped across five lanes (warmups, metadata
forensics, script analysis, binary reverse engineering, mobile Android), with a sixth lane, web exploitation, joining
on day 19. Every challenge had three modes:

- **Single Solve**: one artifact, untimed. Get the answer right, collect the flag.
- **Time Trial**: a freshly generated variant behind a server-enforced countdown of a few seconds.
- **Mastery**: a bundle of variants (sometimes thousands of answers) under one clock.

Answers were not flags you find in the bytes. A Game Master (GM) service handed out artifacts and judged answers, often
against *synthetic labels*: its own snake_case spelling for a concept, which you only learn by submitting it. Later
Mastery modes also mixed earlier days' techniques into today's bundle.

That was the rulebook. In practice the clock changed mid-month. From around day 15 the GM allowed only one timed
attempt per mode, and would serve an *untimed* attempt on request; from day 15 we chose untimed by default. "Timed"
modes became untimed races against the other teams' finish times. Several mechanisms below, like answering a
still-open attempt by hand or falling back to a fresh untimed attempt, only make sense because of that change.

A normal day was five challenges, so 15 modes (day 1 had two extra orientation questions; day 30 a bonus); from day
19 web added two or three challenges a day, so a day had 21 to 24 modes. Thirty-one days, 189 challenges, 561 modes and 1,885 points. 37 teams finished with every point, so
**placement among them came down to one thing: how fast you cleared the last day.** Ours cleared day 31 at
**T+4:15** (4 minutes 15 seconds after the drop), which put us **3rd of 1,589 teams**. From day 17 our internal
target was to clear the *whole* board in under two minutes.

**The words this post leans on:**

| term | meaning |
|---|---|
| lane | a challenge category (warmups, metadata, script, binary, mobile, web) |
| mode | one of a challenge's three stages: Single Solve, Time Trial, Mastery |
| field / answer id | one question inside a mode; a mode can ask one field or ten thousand |
| contract | the GM's JSON list of fields for one attempt, with each field's expected format |
| variant | a freshly generated copy of a challenge: new bytes, new answers, same concept |
| attempt | one start → download → submit cycle on a mode |
| set | one sub-bundle of a Mastery; a Mastery is many sets, each its own mini-contract |
| board | all of a day's modes; "regular board" means the 15 non-web modes |
| T+m:ss | time since that day's drop |
| chain | our pipeline for one challenge: its three modes, run in order |
| reuse race | yesterday's solvers run on today's bytes the moment they land, beside the LLM |
| answer-first | a second, quick worker that only answers the fields still open, straight from the bytes |
| generalize | when a timed variant fails: a worker fixes the solver, kept only if nothing that passed before breaks |
| duel | two or three generalize (or solve) workers racing; the first verified fix wins |
| post-run | the overnight work after a day is fully solved: the **ratchet** merges what was proven into the shared library, and the **prebuild** speculatively builds decoders for variants not seen yet |
| warm-up | the half hour before a drop, when every check runs; after the drop, nothing but the launch |
| arena | the organizers' web console, where a stuck web target can be reset |
| Homebase | a small VM the organizers gave each team inside the CTF network, on a daily budget of 60 credits shared between VM time and its built-in AI |

## Before the harness: days 1 and 2

The first two days were played by hand, before any of the code below existed. I opened one chat thread per
challenge in the organizers' Homebase AI chat interface (T3 Code, driving Codex on GPT-6 Luna) and pasted the same prompt
into every thread, changing only the task name:

> pull up the challenge for the "Power Play" task, read it's description, analyze the content (and any hints from
> the description and title) and try to solve the static challenge first.
>
> Once you have a confirmed solution, given your previous analysis of the challenge task and files -- plan a way to
> automate any activities related to autonomously solving the challenge. Do this to take on the timed and mastery
> challenges, automate submission as well to the game master. Take note that you might be given a task that diverges
> from the common challenge file, but should still be the same concept -- make a plan against this as well,
> especially for the mastery level task. When ready, start the timed and mastery tasks.

That worked: day 1's first score landed at T+14:40, the day was cleared at T+38:18, and we ended it 5th overall; day 2 cleared at T+25:55, 7th of
the 263 teams that cleared it. But each thread was a one-off. Nothing carried from one challenge to the next, and a
human was the scheduler.

Read that prompt again and the whole harness is in it: solve the static challenge, turn the solution into
automation, expect variants that diverge from the sample, then run the timed modes. On October 3 I stopped pasting
it and started building the thing that does it for every challenge at once, every day, and remembers what it learned.

## The bet: build the harness, not the solves

From October 3 the rule was that a human does not solve challenges. A human builds and fixes the thing that solves
them, and the thing gets better every night. Concretely, "the human" was me directing Claude Code sessions (the
**orchestrator**) that wrote and ran the harness; "we" in this post means me plus those agents. Everything ran on one
12-core Windows workstation under WSL in Manila, with a VPN into the CTF network, and Claude Code on a subscription
with 5-hour and weekly usage limits. Dollar figures below are API list-price equivalents computed from token counts,
not invoices.

Four choices followed:

1. **Everything in parallel.** One chain per challenge, all chains at once, each running single → Time Trial →
   Mastery as soon as the previous mode is correct.
2. **The LLM solves; code makes it fast.** Workers are `claude -p` sessions (Claude Code running headless, one per
   task) with real tools (readelf, Ghidra, jadx, exiftool, apktool, ilspy). Early on we built hand-written
   deterministic parsers per lane and reverted them the same morning. The challenges are unknown, and a parser for
   yesterday's format is a liability today. What *is* allowed to be deterministic is anything the LLM already
   proved: a solver it wrote, a label the GM confirmed.
3. **The clock never waits on an LLM.** The single-solve worker must leave behind a `solve.py` that reproduces its
   answer from the bytes. Timed modes run that solver with no model in the loop.
4. **Race before you reason.** From day 12, yesterday's solvers run against today's bytes the moment they arrive,
   beside the worker. Whatever they get right is submitted at once; the LLM only has to handle what they miss.

{{< hctf2026 "arch" >}}

## How it all fits together

The diagram above is one challenge. The whole system is a loop that runs once a day, and it has two "orchestrators"
that are easy to confuse:

- **The operator** is a long-running Claude Code session (Opus 5.5) that I talk to. It never solves a challenge. It
  arms the day, watches the run, steps in when a chain asks for help, reads the logs afterwards, writes the
  post-mortem and the fixes, and keeps notes the next session reads when it starts.
- **The harness** (`hctf run`) is plain Python with no model inside. It detects the drop, starts one chain per
  challenge, launches workers into a fixed number of slots, runs the races, routes GM calls and records everything.
  Every bit of LLM reasoning during a run happens inside a worker the harness launched.

{{< hctf2026 "system" >}}

The full loop, with a flowchart of every decision in it, is in [part 2](/writeups/huntress-2026-harness-internals/#the-whole-orchestration).

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

The feed times the GM's own CORRECT. The official scoreboard stamped our last answer a few seconds later, at T+4:15, and that is the number the final ranking used. Elsewhere in this post, harness timings use the GM's clock and placement uses the scoreboard's.

## Placement over the month

The official scoreboard publishes every team's scored questions with timestamps. That means the board can be
**replayed**: for any instant in October you can recompute every team's points and the tie-break (who reached that
total first). This is our rank, hour by hour:

{{< hctf2026 "rank" >}}

Three things stand out:

- **Days we launched late hurt the most.** Day 3 was the harness's first live day and took 18 hours. On days 10-12 the workstation
  was asleep at the drop, and on day 30 the weekly usage limit had stopped every worker the night before. On those
  days we dropped as low as 30th-100th, and climbed back once the day was cleared.
- **On our good days we were top 10.** By overall rank at the end of each day, we were in the top 10 on 14 of the 31
  days and the top 5 on eight.
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

## Inside the harness

The inside of the machine has its own post: **[Inside the harness](/writeups/huntress-2026-harness-internals/)**, part 2 of this retrospective. It
walks through twelve flowcharts box by box: the whole daily orchestration, launch and release detection, the chain
state machine, a single solve, triage, a worker's life and its hooks, how the prompts are built, the reuse race, the
solver contract, a timed attempt, what happens when a variant fails, how the harness learned the GM's label
spellings, the six lanes and the web lane, the overnight post-run and prebuild gates, the operator's toolkit, and
how all of it was tested. Every step links to its code.

In one paragraph: one thread per challenge runs single → Time Trial → Mastery. The single starts a warm `claude -p`
worker, races yesterday's solvers against today's bytes and triages the artifacts in parallel; the worker writes a
`solve.py`, submits from it, and is stopped the moment the GM says CORRECT. The timed modes replay that solver with
no model in the loop, on a forked warm process inside the CTF network. A failed variant becomes a regression case
and starts several repairs at once, and an edit to the solver is kept only if nothing that passed before breaks.
Overnight, what was proven is merged into a shared library behind tests, and off-peak workers build decoders for
variants nobody has seen yet.

## The models

### Who ran what

| role | model and effort | why |
|---|---|---|
| Days 1-2, by hand | Codex (GPT-6 Luna) in the Homebase chat UI | what the organizers' VM offered before the harness existed |
| Every harness worker: single, generalize, live answer, overnight library work | Claude Opus 5.5, **high** | the default from day 3 to day 31; never changed |
| Answer-first workers, live answers on five fields or fewer | Opus 5.5, **medium** | short, focused jobs where a faster turn mattered more than depth |
| Duel racer 1 | Opus 5.5, medium | a medium racer won three of three singles on day 16 |
| Duel racer 2 (from day 18) | Claude Sonnet 5.5, high | model diversity: a different model fails differently |
| Coordinator | Sonnet 5.5, one turn, no tools | a cheap second opinion on a stalled worker |
| Orchestrator (the sessions that built and ran the harness) | mostly Opus 5.5; some sessions on Opus 4.8 (see downgrades) | |
| Homebase's own AI (Bedrock: Claude Opus 4.7; Codex) | built as an option, never used in production | its credits ran out about 30 minutes after power-on |

### Usage and results

From the worker ledger, which starts on day 9 (1,842 worker launches through day 31):

| model | launches | turns | output tokens | list-price $ | how they ended |
|---|---|---|---|---|---|
| Opus 5.5 | 1,544 | 27,679 | 26.5M | $2,003.60 | 1,014 finished, 446 stopped by the harness at CORRECT, 31 timed out, 26 hit a usage limit, 24 hit the turn cap, 3 ended without a result |
| Sonnet 5.5 | 62 | 623 | 0.2M | $24.67 | 37 single-solve duels and 25 generalize duels |
| Opus 4.8 (safety fallback) | 2 | 24 | 5.6k | $1.02 | two web live answers that Claude Code moved to Opus 4.8 mid-run |
| none: refused by a usage limit before its first real turn | 177 | 177 | | $0 | |
| none recorded: stopped before reporting a model | 57 | 0 | | $0 | live answers and duel racers stopped early (a sibling won first), and some overnight workers |

What the comparisons showed:

- **Effort: high beat xhigh.** On day 6 every lane ran at `xhigh`. Worker time went *up* on every lane (mobile from
  111-179 s to 324 s, binary from 140 to 387 s) because each turn was about 50% slower (10.9 s vs 7.2 s). The one
  upside: the script worker got all 399 fields right on its first submit, where `high` had needed 9-14 submits. Its
  time to CORRECT was the same either way (219 s vs 217 s). A cleaner A/B on day 15 found no benefit either. `high`
  stayed the floor for every lane all month.
- **Medium for narrow jobs.** An answer-first worker at medium reached CORRECT in 8.0 s with two tool calls on a
  metadata single that took the regular worker 74 s. Live answers on one to five fields took 53-71 s at high, so
  they moved to medium too.
- **Model diversity didn't pay.** Across days 21-26, single-solve duel racers (both models) launched 41 times and produced zero real
  first-CORRECTs. Their apparent wins were a copied prior solver re-verifying. The logs stop both racers at the same
  instant, so we can't credit a single win to Sonnet. Single duels were switched off on day 26; generalize duels
  stayed.
- **Fast mode** made singles 27-35% faster with identical correctness in a ten-worker A/B, but it bills as paid usage,
  so it stayed off.

**The most valuable AI, by a wide margin, was Opus 5.5 at high effort:** 97% of all worker turns, every first
CORRECT we can attribute, and the orchestrator that wrote the harness.

### Model downgrades and provider trouble

Model downgrades did happen, and the most interesting one is specific to security work:

- **Safety fallback to Opus 4.8.** Analysing malware-like scripts, crackmes and exploits trips Claude's cyber
  safeguards from time to time. When that happens Claude Code switches the session to Opus 4.8 and carries on. It
  happened to workers on the day-1 practice re-run and on days 4 and 6 (mobile singles, all recovered) and to two web live answers. It also happened
  to the orchestrator: whole sessions on days 3-6, 17, 21-23 and 27-28 ran on Opus 4.8, and an analysis session on
  day 17 running Fable 5.1 (another Claude model) was flagged mid-way and switched. The harness takes no action; the switch is transparent, and
  the work still got done.
- **An expired login.** During the first practice run on October 3, six workers died within 50 s with "OAuth session
  expired" and nothing flagged it. Since day 9 an auth failure stops the chain with a loud alert, preflight runs a
  live `claude -p` login check, and transient API errors relaunch the worker with a fresh session (three tries at
  20, 60 and 180 s).
- **Usage limits.** The subscription's 5-hour limit hit overnight library workers several times; since day 24 a
  usage-limit gate waits for the stated reset time instead of failing, and that wait doesn't count against a stage's
  timeout. The weekly limit hit on day 29 at 21:09 and is why day 30 was missed (see war stories).
- **A Claude Code behaviour change.** A CLI update started snapshotting the repository around shell calls, costing
  10-25 s each on our 3 GB repo (see [what moved the clock](#what-moved-the-clock-and-what-didnt)). Turned off for
  workers on day 13.
- **A context overflow.** On day 23 a generalize worker died with `prompt_too_long` at about 1.39M tokens of diffs.
  The fix summarises diffs before they reach the prompt.
- **What we never saw:** a silent change of the worker model. Opus 5.5 was the worker from the first commit to the
  last drop.

## What moved the clock, and what didn't

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

Most of these were measured with the fake GM and the fault-injection suite described in [part 2](/writeups/huntress-2026-harness-internals/#how-we-tested-it).

### The ledger

Everything below was measured, mostly with A/B replays on the fake GM or on the next live day. Roughly half of it
was kept.

<div class="hc-scroll">

| idea | what we tried | measured | kept? |
|---|---|---|---|
| More reasoning effort | `xhigh` on every lane (day 6), then an A/B against `high` (day 15) | turns ~50% slower (script 10.9 s vs 7.2 s); the A/B gap was the environment, not the effort | no: `high` everywhere |
| Medium-effort racers on singles | best-of-N duel workers at medium | won 3 of 3 singles on day 16 | until day 26 (see next row) |
| Model diversity | a Sonnet 5.5 racer in single-solve duels | 0 first-CORRECTs in 41 launches; a third of all claude processes at the drop | no: single duels off (day 26) |
| Subagents for script workers | script worker spawning helpers | 158 s vs 302 s on two replays: too noisy to trust | no |
| Fast mode | A/B on ten singles | 27-35% faster, no correctness loss, but billed as paid usage | no (cost) |
| Hand-built lane parsers | per-lane deterministic parsers in `lib/lanes/` | 100% offline on days 1-6 | no: reverted the same morning (LLM-first) |
| Reuse race | prior solvers race the LLM on every single | backtest days 2-11: no wrong answers. Live days 12-16: mobile 5/5, script 3/5, binary 2/5, warmups 2/5, metadata 0/5 | yes: the core of single-solve speed |
| Warm workers | launch `claude` before the bytes arrive | `READY` in 3 s, but the task text is only ready at +8-25 s anyway | kept, pre-drop launch not built |
| Fork-per-solve zygotes | warm solver daemon on Homebase | solver start 150-230 ms → 15-51 ms; a warmups Time Trial attempt 627 → 411 ms | yes, later used less |
| Bedrock shadow workers | LLM workers on Homebase, next to the GM | the day's credits were gone ~30 minutes after power-on | no: opt-in only |
| Encoding-family probe | probe a variant's encoding family before the timed attempt | script Time Trial and Mastery passed first try; 14/15 by T+2:19 in a rehearsal | yes |
| Answer-first worker | a medium worker answering only the leftover fields from the bytes | CORRECT in 8.0 s with 2 tool calls, vs 74 s plus a 49 s duel | yes |
| Drop the pre-Mastery speed gate on web | race it instead of blocking on it | Time Trial → Mastery per web chain 5:20 → 3:29 | yes |
| Race-first handoff | timed modes start from the race's verified solver | replays of day 24's board: 2:43 baseline → 2:08 with the plan's fixes → 1:30 with race-first | yes |
| MSS-clamping SSH proxy | work around the MTU blackhole without root | cold SSH 3.0 s, vs a failure at 15.9 s | yes |
| In-network GM relay | measured routing per call | a status call: median 0.42 s via the relay vs 1.40 s direct; but a 9.5 MB reply took 59.6 s through it | yes, small calls only |
| Homebase for big downloads | pull 36 MB on the VM instead of at home | 22.5 s on the VM vs 5.0 s at home, off-peak | no: premise was wrong |
| Parallel HTTP Range downloads | split big artifacts | the GM ignores `Range` | no-op |
| Parallel submits per Mastery set | submit sets concurrently | the GM serializes submits | no |
| Parallel group-test bisection | find wrong fields in waves instead of one by one | 55 one-at-a-time probes (~4 min) → waves of 12, each judged in 3.3 s vs 1.9 s for a single probe (≈7× the throughput) | yes |
| Narrow live answers to the residual | tell the live worker only the unresolved fields | 57 s narrowed vs 47 s without: the cost is deriving the set, not the field count | kept, neutral |

</div>

What the losses had in common:

- **More of the same lost to variance.** More effort, more parallel subagents and more racers each made the
  median slower or the host busier. None of them made the hard field easier.
- **The workstation was the bottleneck more often than the model.** Day 16 ran out of memory (~57 processes at ~195 MB);
  day 26 hit a load of 28 on 12 cores during the drop.
- **Measure, then route.** Homebase was a clear win while timed modes had a clock of a few seconds. From mid-month
  the GM ran timed modes untimed by default (see the event section), and the same VM became a slow path for big replies. Machinery built for
  the clock (speed gates, pre-Mastery hardening) kept firing after the clock was gone.
- **Measure the measurement.** The KPI first counted a solve at our own `result` line instead of the GM's CORRECT,
  which made day 20 look 17 s slower than it was. An "+11 s release lag" was a regex bug; the real lag was 2.6 s.

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

The slowest day after the web lane arrived: T+27:34. A script Mastery carried 10,465 fields. A generalize worker died with `prompt_too_long` at
~1.39M tokens of diffs, and ten minutes went to probing labels on a composite field. The fixes (diff summarisation,
composite-field splitting, parallel group-test bisection in waves of 12) landed overnight. Day 24's regular board then
cleared 2:09 after launch, though we launched 16 minutes late.

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

## How the harness evolved

{{< hctf2026 "commits" >}}

| phase | dates | what landed |
|---|---|---|
| Bootstrap | Oct 3-5 | GM client, timed runner, orchestrator, Homebase timed attempts, transactional generalize, ATT&CK guard |
| Correct and safe | Oct 6-8 | worker sandbox, fake GM, test-gated ratchet, stop at CORRECT, technique logs, variant probes, toolchain detection. 113 commits in one week |
| Speed and determinism | Oct 9-18 | warm Homebase daemon, reuse race, untimed fallback, prebuild, duels and the coordinator, `hctf train`, parallel bisection, the process governor, fault injection, KPIs, answer-first, the drift watcher |
| Web and the whole board | Oct 19-25 | web lane end to end, parallel web targets, host exclusivity, web plugins, the rate governor, the GM relay with measured routing, race-first handoff |
| Killing the tail | Oct 26-31 | the in-network race, the no-LLM library racer, parallel live answers, big-reply routing, final-drop fixes |

| date | [`hctf/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/hctf) lines | [`lib/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/lib) lines | test suites (lines) |
|---|---|---|---|
| Oct 3 | 1,638 | 0 | 0 |
| Oct 5 | 4,331 | 2,132 | 1 (127) |
| Oct 8 | 9,113 | 3,058 | 9 (2,283) |
| Oct 12 | 12,244 | 3,217 | 18 (4,173) |
| Oct 15 | 17,684 | 9,148 | 31 (8,102) |
| Oct 19 | 22,637 | 64,727 | 40 (10,820) |
| Oct 23 | 25,417 | 117,613 | 50 (13,236) |
| Oct 26 | 29,801 | 162,850 | 66 (19,197) |
| Oct 31 | 32,424 | 195,231 | 78 (24,037) |

The orchestrator grew roughly linearly: about a thousand lines a day of fixes and features. The library stayed small
for two weeks and then exploded once the overnight prebuild started on day 13. That is the shape the bet predicted:
humans build the machine, and the machine builds its own knowledge.

## Decision log

Every day followed the same rhythm: launch at the drop, watch the feed, read the logs of whatever was slow, write a
post-mortem, fix it overnight, rehearse, launch again. Decisions came from two places. **My rules** were the ones I
set and the orchestrator had to follow from then on (effort floor, no hand-built parsers, nothing but the launch
after the drop). **The orchestrator's proposals** came out of its own measurements and post-mortems, and I approved
or rejected them. The yardstick for both was a list of goals written on day 6: full autonomy, robustness to unseen
variants, machine speed, near-instant reuse of anything learned, and the hard one: what would let it meet a
completely unfamiliar challenge?

The full log is below, folded so the post stays readable. "Me" is a rule or call I made; "Orch." is a proposal from
the orchestrator; "Org." is something the organizers said.

<details class="hc-tv">
<summary>Every significant decision, October 3-31 (56 rows)</summary>

<div class="hc-scroll">

| date | decision | who | why | outcome |
|---|---|---|---|---|
| Oct 3 | Build the harness: orchestrator, `claude -p` lane workers, GM client, Homebase bridge | Orch. | the Arena's premise is a solver on autopilot | a practice re-run of day 1 went 17/17 on Oct 4 |
| Oct 3 | Reach Homebase over `ssh` commands, not port forwarding | Orch. | the rules prohibit SSH port forwarding | the bridge design |
| Oct 4 | Talk to the GM directly with a pairing token; Homebase optional | Orch. | the public GM works and the VM was often off | default for the rest of the month |
| Oct 4 | Learn label spellings by probing, and cache every confirmed one | Orch. | day 3 lost ~1.5 h guessing synonyms | [`labels.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/labels.py), [`vocab.json`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/lib/vocab.json) |
| Oct 5 | Target: clear a day in under 4 minutes | Me | day 5 took over 8 minutes, bound by one script single | the first speed plan |
| Oct 5 | Send timed submits through Homebase's in-network proxy | Orch. | public submits took 5-8 s | 2.76 s → 0.55 s |
| Oct 5 | Run everything natively in WSL; VPN as a systemd unit; one-command preflight | Orch. | the Windows-side setup kept breaking | [`preflight.sh`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/bin/preflight.sh), [`day.sh`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/bin/day.sh) |
| Oct 5 | An ATT&CK reference layer, separate from GM-verified knowledge, plus a pre-submit guard | Orch. | about a third of script fields are ATT&CK ids | correct first try from then on |
| Oct 6 | Write down the north-star goals | Me | a yardstick for every later choice | the list above |
| Oct 6 | Effort floor `high` on every lane; `xhigh` reverted | Me | xhigh turns ~50% slower, no wall-clock gain | standing rule |
| Oct 6 | VPN only from the command line; remove the Windows client | Me | a second client on the same profile evicted ours every ~4 min | flaps gone |
| Oct 6 | Drop time is retrieve and launch only; all checks at warm-up | Me | day 6 lost ~75 s re-running preflight after the drop | standing rule |
| Oct 6 | Stop workers at CORRECT and hand off early | Orch. | 60% of worker time came after CORRECT | day 7 changes |
| Oct 6 | Sandbox every worker with `bwrap` | Orch. | a worker copied a solver it was never meant to see | OS-level isolation |
| Oct 6 | Build a fake GM for rehearsals; at most ~2 replays a day | Orch. | replays spend real variant pools | rehearsal tooling |
| Oct 7 | **Revert the hand-built lane parsers: LLM-first with standard tools** | Me | "don't reinvent the wheel; tomorrow is unknown" | the defining rule |
| Oct 7 | Exception: a shared codec helper for the script lane | Me | 97% of script time was token generation | lane 403 → 247 s |
| Oct 7 | Subagents for the script lane: on, then off | Orch. | 158 s vs 302 s between runs: too much variance | serial stays |
| Oct 7 | Install a standard tool for every lane; preflight checks them | Me | skills pointed at tools that weren't installed | [`install_tools.sh`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/setup/install_tools.sh) |
| Oct 8 | Never call an incomplete run "best"; report N/15 first | Me | a 14/15 run had been ranked best | standing rule |
| Oct 8 | Probe mutated variants before the GM serves them; partial submits | Orch. | the organizers said timed modes serve unseen mutations | mutation probe |
| Oct 8 | Plan for Mastery bundles mixing earlier days | Me | an organizer hint | compounding probe |
| Oct 8 | Detect each artifact's toolchain and install what's missing, even mid-run | Me | a Swift demangler gap went unnoticed | [`toolchain.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/toolchain.py) |
| Oct 9 | Homebase AI workers: built, then opt-in, then off | Me | the credits were gone in ~30 minutes | Homebase for timed attempts only |
| Oct 12 | Hold the missed days 10-11 until the day-9 speed work lands | Me | the host had been asleep since Oct 9 | ran late, cleared in 97 s and 69 s from launch |
| Oct 12 | Warm solver daemon on Homebase (fork per solve) | Orch. | per-attempt overhead dominated | 150-230 ms → 15-51 ms |
| Oct 12 | **Race prior solvers on every single, in parallel with the worker** | Me | the leaders cleared in seconds; we were re-deriving yesterday | the reuse race |
| Oct 12 | Fall back to an untimed attempt when the timed pool runs dry | Me | an exhausted pool stalled warmups Mastery | saved day 12 |
| Oct 12 | Prepare the web lane before its release | Me | the GM's lane list already named `web` | ready on day 19 |
| Oct 13 | Speed across all lanes over the public speed board | Me | the board ranked single attempts, not the day | never optimised for it again |
| Oct 13 | Overnight prebuild: speculative decoders, kept only as race entries behind fixtures | Me | 58% of the critical path was one Mastery | 15 modules the first night |
| Oct 13 | Turn off Claude Code's per-call repo snapshot for workers | Orch. | 10-25 s per shell call | shipped |
| Oct 14 | Fast mode off; never test paid features without asking | Me | an A/B was billed as paid usage | off to the end |
| Oct 15 | Run Time Trial and Mastery untimed by default | Me | the GM gives one timed attempt per mode | `RUN_FOR_TIME=auto` |
| Oct 15 | Never edit code while the overnight prebuild runs | Orch. | its rollback wiped other edits | use a separate worktree |
| Oct 15 | Duels, a coordinator, retrieval of similar past solves | Orch. | ideas from published CTF agents | on by default |
| Oct 16 | Cancel the `xhigh` week after the first A/B | Me | no detectable benefit | `high` stays |
| Oct 16 | Duel racers at medium effort | Me | medium won 3/3 singles | exception to the floor |
| Oct 16 | Parallel bisection, process governor, memory-capped launcher | Me | WSL ran out of memory; 55 sequential probes | shipped |
| Oct 17 | **The sub-2-minute plan**: fault replay in preflight, KPIs, answer-first | Me | every slow day was one generalize or one new bug | [`PLAN_SUB2MIN.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/reference/PLAN_SUB2MIN.md) |
| Oct 18 | Depth-3 label search, contract-drift watcher | Orch. | the day-17 GM-side bug | shipped |
| Oct 18 | Best-of-3 duels with a Sonnet racer | Me | cold singles have high variance | single duels off on day 26 |
| Oct 19 | Web runs one target at a time; a stuck attempt is revived from the arena | Me / Org. | one live target per team | 9/9 by hand on day 19 |
| Oct 20 | Parallel web, five targets at once | Orch. | the organizers raised the limit | shipped |
| Oct 20 | Delete files only from an explicit manifest | Me | the C: drive was nearly full | cleanup scripts |
| Oct 21 | **Sub-2-minute means the whole board, web included; no accepted risk** | Me | "it falls back to the LLM" is not a plan | standing rule |
| Oct 22 | Web: race optional checks instead of blocking on them | Orch. | a 4.5-minute check sat ahead of a 14 s solve | shipped |
| Oct 23 | One harness busy per host; validate only on a fresh day | Orch. | a shared host invalidated a validation run | `hostguard` |
| Oct 23 | "Fix everything" from the day-23 post-mortem | Me | script tail of 28:55 | shipped overnight |
| Oct 25 | All 15 sub-2-minute items in four parallel tracks, plus race-first handoff | Me | the plan's remaining items, built at once | replay 2:43 → 1:30 |
| Oct 25 | Stop sending the GM credential to the VM | Orch. | the rules say no credentials on Homebase | the new relay doesn't |
| Oct 27 | Single duels off | Me | 0 real wins in 41 launches; CPU saturation | generalize duels kept |
| Oct 27 | Live answers on five fields or fewer at medium | Me | one-field answers took 53-71 s | exception |
| Oct 27 | **Solve everything before any post-run** | Me | a post-run started at 21/24 | post-run gate |
| Oct 27 | Arena reset is the sanctioned recovery for a burned web target | Org. | a one-shot target was spent | self-heal + `RUN_ALONE` |
| Oct 31 | Final drop: no post-run, overnight work stopped early | Me | protect the drop from the 5-hour limit | 21/21 at T+4:10 |

</div>

</details>

The **lines of questioning** mattered as much as the decisions. Most of the month's real progress came from asking
a narrow question and measuring it rather than arguing about it:

<details class="hc-tv">
<summary>Questions we asked and how we answered them (20 rows)</summary>

<div class="hc-scroll">

| question | how we checked | answer |
|---|---|---|
| Is Homebase faster? | submit timing, a VM CPU benchmark, download throughput, relay calibration | for small GM calls, yes (0.55 s submits, 0.42 s status); for compute and big downloads, no: the VM's CPU was 9-20× slower and downloads 1.6 vs 7.3 MB/s |
| Does `xhigh` help? | day 6 run, then a two-arm A/B | no: slower turns; the A/B gap was the environment |
| Why did day 6 take 12 minutes when the leaders took under 2? | four reviewer agents over the transcripts | work after CORRECT, all-or-nothing reuse, a serial handoff, VPN flaps |
| Why does the VPN drop every 4 minutes? | `journalctl` cycle times, a hash of the profile | a second client on the same profile |
| Are pre-launched workers useful? | replays and timing marks | no: ready in 3 s, but the task text is only ready at +8-25 s |
| Do subagents or fast mode help? | replays, an A/B | subagents: noise; fast mode: yes but billed |
| Why does SSH to Homebase hang? | ping with don't-fragment, key-exchange isolation | a path-MTU blackhole; fixed with an MSS-clamping proxy |
| Does the GM honour HTTP Range? | direct tests | no |
| Is a stuck field our bug or the GM's? | ~11k probes, then re-fetching the question | the GM's: fixed in place into an enum |
| Are the timed modes actually timed? | contract fields across days, the GM's own guidance | one timed attempt from ~day 15; untimed unless requested later |
| Does an HTTP 429 mean "incorrect"? | auditing the GM's semantics | no: unjudged; resend, and resume the same attempt |
| Can we have more than one web target? | a probe with ten live targets | yes, the limit had been lifted |
| Is resetting a web target allowed? | asked the organizers | yes, it's the intended path |
| Was the day-22 web miss the GM's provisioning? | the run log | no: our own blocking check (first reading was wrong) |
| Was the race-first change a wash? | per-phase re-scoring | a win; the first comparison mixed different host loads |
| Is the GM's rate limit binding? | 429 reports, cap sweeps | no (~1-1.4 requests/s); our governor had an import bug |
| Why were days 16, 23 and 26 slow? | logs, client time vs the GM's own elapsed time | sequential probes and memory; label probes and a context overflow; big replies on one SSH channel |
| Do Mastery bundles really mix earlier days? | an audit of days 1-8 | only warmups at first; the first real case was day 13 |
| How do we compare to published CTF agents? | reading their code | a superset; three gaps closed |
| How did placement actually work? | replaying the scoreboard's timestamps | 37 teams at max points, ranked by day-31 finish |

</div>

</details>

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

## The organizers' questions

The organizers asked every team the same set of questions. Our answers:

**Did you actually get to "build a bot" all month long?** Yes. From October 3 no human solved a challenge;
the bot was built in 339 commits over 29 days. Two exceptions: on day 19, the first web day, the orchestrator drove
the web chains one at a time by hand while workers still did the solving (that night it became automatic), and day
30's hardened bonus crackme beat four autonomous attempts and needed a human.

**Is it something you'd keep around and use elsewhere?** Parts of it, yes. The parts that aren't about this GM
carry over: a parallel orchestrator that runs many agents with stop conditions, sandboxed headless workers, hooks
that let the harness talk to a running agent, and the loop where every failure becomes a regression case before the
next run. The GM-specific parts don't: the label grammar, the timed runner, the Homebase plumbing.

**Could it really help with tier-1 SOC triage?** Yes, with caveats. What the warmups, script, metadata, mobile and
binary lanes exercised is most of a tier-1 analyst's mechanical work: peeling layered encodings off a dropper,
pulling forensic metadata out of every file format in an archive, mapping a script's behaviour to ATT&CK, extracting
facts from an APK or a binary at machine speed. The caveats are real, though. The GM answered "correct" or "wrong"
within seconds, and that instant ground truth is what made the learning loop work; a real alert queue doesn't grade
you. Day 30's hardened crackme, with environment-keyed decryption and decoys, still needed a human.

**With web, could it help with web app analysis, or speed through pentests and vulnerability assessments?** Yes,
with caveats. By the end, each known vulnerability class was a plugin keyed on what the target exposed, and those
solved live targets in seconds. That is exactly the "known classes, fast and exhaustively" part of an assessment. A
real engagement adds what the CTF took away: scope and authorization, novel bug classes, and side effects. Day 27's
one-shot web target, spent by a helper request before the real exploit ran, is a small preview of why an agent on a
live client system needs hard guardrails.

**Is "endless optimisation" plus a deterministic approach something you'd apply to real work?** Yes. The idea we'd
keep is narrow and portable: *let the LLM prove something once, then make code replay it*. Pair that with "every
failure becomes a test before the next run" and you get a system that is measurably better every day, and an LLM bill
that shrinks as it learns.

**What models did you play with, and what AI was most valuable?** Codex (GPT-6 Luna) by hand on days 1-2; Claude Opus
5.5 for everything after; Sonnet 5.5 as a duel racer and coordinator; Opus 4.8 when the safety fallback kicked in;
Homebase's Bedrock models tried and dropped. Most valuable: Opus 5.5 at high effort, by a wide margin (see
[the models](#the-models)).

**Did you use Jev, GLM 5.3, Daybreak Blue, Claude CVP, herdr, T3 Code, Hermes Agent, DeepSeek, REA, a Ghidra MCP or
Binja?** Honestly, almost none of them. T3 Code was the Homebase chat interface we used on days 1-2. The rest we never
tried. The only "Hermes" in the repository is a decompiler for React Native's Hermes bytecode, which the mobile lane
needed. No MCP servers at all, including for Ghidra: workers ran with `--strict-mcp-config` and drove Ghidra
headless, jadx, apktool, rizin, radare2, ilspycmd, GoReSym, pycdc and well over a hundred other command-line tools straight
from Bash. That was deliberate. A CLI call composes with others in one shell command, costs no extra protocol turn,
and behaves the same inside the sandbox and on the VM.

## The numbers

- **Placement:** 3rd of 1,589 registered teams (861 scored at least one point); 1,885 of 1,885 points; 561 of the scoreboard's 562 questions (the 562nd is a zero-point "sanity check"
  poll on day 1 that no team answered).
- **Challenges:** 189 challenges and 561 modes over 31 days and six lanes. Web added 31 challenges from day 19.
- **Fastest on-time clear:** day 18, T+1:43. Day 31: T+4:15. Median of the 24 days the harness ran at the drop: 9:12.
- **Daily race:** by finishing position among teams that cleared the whole day (not overall rank), top 5 on 7 and
  top 10 on 12 of those 24 days.
- **Workers:** 1,842 `claude -p` launches, 28,503 turns and ~198 worker-hours since day 9. Opus 5.5 did nearly all of
  it, with Sonnet 5.5 as a duel racer.
- **Tokens:** ~7.5B processed, ~40M of them output.
- **Harness:** 339 commits on 20 branches from Oct 3 to Oct 31. About 32k lines of orchestrator ([`hctf/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/hctf)), 195k lines
  of library ([`lib/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/lib), much of it generated codecs and decoders), 78 test files and 11 agent skills.
- **Homebase:** ~39 VM hours logged across 22 boots.
- **Hall of Fame (the public speed board):** our timed entries, all from days 7-13, sat mid-pack: a median rank in the
  20s, best 9th. That board ranked raw milliseconds per attempt, and from mid-month the GM ran timed modes untimed by
  default. We optimised wall clock for the whole board, not single-attempt milliseconds.

The full set, with every chart's table, is on the [stats dashboard](/writeups/huntress-2026-dashboard/).

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

---

**Keep reading:** [Part 2: inside the harness](/writeups/huntress-2026-harness-internals/) opens the machine, every flowchart with links to the code. Or go straight to [the numbers](/writeups/huntress-2026-dashboard/).
