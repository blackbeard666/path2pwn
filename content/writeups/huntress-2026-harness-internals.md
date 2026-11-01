---
title: "Inside the harness: how an autonomous CTF solver is orchestrated"
date: 2026-10-31
category: "ai"
tags: ["ctf", "ai", "agents", "automation", "huntress", "orchestration"]
summary: "Part 2 of the Huntress CTF 2026 retrospective: every moving part of the harness that cleared the AI Arena, drawn as flowcharts and explained step by step, from the daily loop down to a single tool call, with links to the code."
source: "ctf"
draft: false
---

> **This post was written by AI.** Claude (Opus 5.5, in Claude Code) drafted it from the harness's own repository,
> run logs and the orchestrator's notes; I directed it, chose what to disclose, and reviewed it. Every constant below
> was read from the code, not recalled.
>
> **The code is public:** [blackbeard666/huntress-ctf-2026-ai-harness](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness).
> File names link to it.

**This retrospective comes in three parts:**

- **[Part 1: the story](/writeups/huntress-ctf-2026-ai-arena/)**: the event, how we placed, the bet on a harness, the models, every decision and the war stories. Start here if you want to know what happened and why.
- **[Part 2: inside the harness](/writeups/huntress-2026-harness-internals/)**: if you want to know how the harness actually works. Every moving part drawn as a flowchart and walked step by step, from the daily loop down to a single tool call, with links to the code. *(You are here.)*
- **[The numbers](/writeups/huntress-2026-dashboard/)**: if you just want the data. Placement replayed hour by hour, daily clear times, per-lane speed, spend and tokens, as interactive charts with table views.

This part opens the machine. Most sections start with a flowchart and then
walk through it box by box, in the chart's order: what runs, what decides, the thresholds, the file that implements
it, and usually the incident that made it that way. Every flowchart also has a table view under it that lists each
step with a link to its code.

A reading map, from the outside in:

1. [The whole orchestration](#the-whole-orchestration): one day of the loop, and the two "orchestrators"
2. [Launch and release](#launch-and-release) and [the chain](#the-chain)
3. [Six lanes](#six-lanes-six-solver-shapes) and [the solver contract](#the-solver-contract): what is being solved,
   and the one interface everything shares
4. [A single solve](#a-single-solve), [triage](#triage), [a worker's life](#a-workers-life) and
   [the prompts](#the-prompts)
5. [The reuse race](#the-reuse-race)
6. [A timed attempt](#a-timed-attempt), [when a variant fails](#when-a-variant-fails) and
   [learning the GM's spelling](#learning-the-gms-spelling)
7. [The web lane](#the-web-lane)
8. [Overnight](#overnight-the-post-run-and-the-prebuild), [the operator's toolkit](#the-operators-toolkit) and
   [testing](#how-we-tested-it)

**The words this post leans on:**

| term | meaning |
|---|---|
| drop | the daily release of new challenges, 09:00 ET (21:00 in Manila, where this ran) |
| lane | a challenge category: warmups, metadata forensics, script analysis, binary RE, mobile, web; one challenge per lane per day (web: two or three) |
| mode | one of a challenge's three stages: Single Solve, Time Trial, Mastery |
| field / answer id | one question inside a mode; a mode can ask one field or ten thousand |
| contract | the GM's JSON list of fields for one attempt, with each field's expected format |
| variant | a freshly generated copy of a challenge: new bytes, new answers, same concept |
| set | a Mastery attempt is a bundle of independent sets, each with its own artifacts and fields |
| GM | the Game Master: the organizers' API that hands out attempts and judges answers |
| Homebase | a small VM (2 vCPU) the organizers gave each team inside the CTF network, on 60 credits a day shared between VM time and its built-in AI |
| arena | the organizers' web console endpoints that start, stop or reset a live web target |
| chain | the harness's pipeline for one challenge: its three modes, in order |
| worker | one headless Claude Code process (`claude -p`) doing one job |
| generalize | a worker editing a solver so a failed variant passes; kept only if nothing that passed before breaks |
| duel | extra workers racing the main one on the same job; the first verified result wins |
| ratchet / prebuild | the overnight merge of the day's proven facts into the shared library / speculative library-building for variants not seen yet |

From around day 15 the GM served Time Trial and Mastery without a countdown unless asked. Several repair paths below
work on a still-open attempt for that reason.

## The whole orchestration

{{< hctf2026 "fl-orch" >}}

There are two things that could be called "the orchestrator", and they do very different jobs:

- **The operator** is a long-running Claude Code session that I talk to. It never solves a challenge. It runs the
  warm-up checks, arms the launch, watches the run, steps in when a chain needs help, reads the logs afterwards,
  writes the post-mortem, implements the fixes (often by spawning parallel agents), and keeps notes that the next
  session reads first. It is the only part of the system that changes the system.
- **The harness** (`hctf run`) is plain Python with no model inside it. It detects the drop, starts one chain per
  challenge, launches workers into a fixed number of slots, runs the races, routes every GM call, records every
  attempt and decides every retry. All the reasoning that happens *during* a run happens inside a worker it launched.

Walking the chart from the top:

1. **Warm-up.** Before each drop the operator runs [`bin/preflight.sh`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/bin/preflight.sh):
   about 78 checks in 11 sections. They cover a duplicate VPN client (`--fix` kills it), clock skew over 3 s, free
   memory, the Claude login and token expiry, every lane tool working *inside* the worker sandbox, Homebase's
   toolchain and credits, no other harness busy on the host, solver directories missing `solve.py`, warmups codec
   coverage for every earlier day, and the fault-replay test suite.
2. **Preflight green?** A red check or a red suite is a FAIL. **Fix the cause**, then run it again.
3. **Arm the launch** with `bin/day.sh N --wait` ([launch and release](#launch-and-release) has the details). From
   here on nothing is re-checked: the drop is for launching only. On day 24 a preflight re-run after the drop cost a
   16-minute late start.
4. **Is today listed?** The harness asks the GM every 0.3 s and keeps asking until it is.
5. **One chain per challenge**, each a thread.
6. **Chains run in parallel**: single → Time Trial → Mastery, each mode starting the moment the previous one is
   CORRECT. Most of this post is the inside of this box.
7. **The operator reads the feed**: one line per milestone and a heartbeat ([the operator's
   toolkit](#the-operators-toolkit) lists every event).
8. **Every mode GM-CORRECT?** Asked of the GM, not of local state, because the local view can under-report;
   `hctf reconcile` rewrites local state from the GM's answers. If yes, go to the post-run.
9. **A chain in trouble?** A worker's `HELP.md`, a `!!!` alert, or no progress. If not, keep watching.
10. **Operator steps in**: an arena reset for a stuck web target, a relaunch, a code fix, or an answer to a HELP.
    The chains carry on.
11. **Post-run**, once the whole board is GM-solved: freed capacity goes to stragglers before any learning starts
    ([overnight](#overnight-the-post-run-and-the-prebuild)).
12. **Post-mortem.** The operator reads `hctf timeline` (per chain: when each mode finished, attempts, generalize
    cycles, model time vs harness overhead), the KPI row and the slowest chains' logs, and writes a numbered fix
    plan; [`reference/D28_POSTMORTEM.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/reference/D28_POSTMORTEM.md)
    is a typical one. I approve, reject or reorder.
13. **Fixes, each with a test.** Big plans go to several agents in parallel, one track each on files that don't
    overlap. Every new failure mode becomes a scenario in the fault-replay suite, so the next preflight runs it.
14. **Rehearsal → next warm-up.** Critical-path changes are replayed against an already-solved day on the fake GM
    and compared mode by mode before the next drop.

### Where the state lives

There is no database and no service besides `hctf run` itself. Everything is files, which is what made it possible
to replay, diff and audit any day after the fact:

- **Per challenge**, `challenges/dayNN/<lane>-<slug>/`: `chain.json` (the chain's state), and per mode the GM's
  `contract.json`, `log.jsonl`, `submissions.jsonl`, the worker's `inbox.jsonl`, `triage.md` and the worker logs.
  Next to them, `solver/` holds `solve.py`, `NOTES.md` and `cases/`.
- **Shared knowledge**: [`lib/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/lib) (lane code, [`playbook.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/lib/playbook.py), [`knowledge.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/lib/knowledge.py), [`vocab.json`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/lib/vocab.json)) and one technique log per
  lane in [`reference/techniques/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/reference/techniques).
- **Per run**: the day log the feed follows, the cost ledger (`.run/metrics.tsv`) and the post-run's phase record.
- **The operator's notes**, outside the repository.

So knowledge flows one way each day: a worker's `NOTES.md` and regression cases → the ratchet → `lib/` and the
technique logs → the next day's prompts (label grammar, helper index, technique log) and the next day's race.

## Launch and release

The first second of a drop decides a lot, so the launch path is small and boring on purpose.

- **One harness per host.** [`hctf/hostguard.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/hostguard.py)
  refuses to run a second busy copy of the harness on the same machine. A shared host once invalidated a rehearsal:
  an overnight build in one copy changed timings in another.
- **The launcher.** [`bin/day.sh`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/bin/day.sh)
  skips preflight if a pass from the last 6 hours is stamped, warms the Homebase SSH connection in the background,
  and starts `hctf run --day N --local 5 --wait-release` as a systemd user unit with a memory cap. Day 16's
  out-of-memory crash, which took the whole WSL VM down, is why there is a cap. It always takes the day number
  explicitly: a stale default once pointed it two days back.
- **Release detection.** `wait_for_release` polls the GM's status every 0.3 s and starts each lane's chain the moment
  that lane is listed, rather than waiting for the whole day. By the end, chains started 1-3 s after the release.
- **Slots.** LLM workers share five slots (`--local 5`), a bounded semaphore across all chains, so twenty-one chains
  don't mean twenty-one simultaneous `claude` processes. Background solver runs go through a process governor
  ([`hctf/procgov.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/procgov.py)) that
  caps them at four, nices them, and raises their out-of-memory score so the kernel kills them before anything
  important.

## The chain

{{< hctf2026 "chain" >}}

A chain's state is one JSON file, `chain.json`, written atomically (a temporary file plus `os.replace`) every time
the stage changes. The feed, the dashboard and `hctf why` all read it. The chart's boxes, in order:

1. **queued**: the chain exists the moment its lane is listed.
2. **single**: `single:fetch` while the attempt starts and the bytes download, then `single:reuse-won` if the reuse
   race answered everything, or `single:solving` while a worker works ([a single solve](#a-single-solve)).
3. **help / blocked**: `single:help` when a worker wrote `HELP.md`, `single:blocked` when its launches ran out.
4. **time_trial**: `time_trial:running` and the retry states below ([a timed attempt](#a-timed-attempt)).
5. **generalizing**: shared by both timed modes, entered when a variant fails and left when the edit is accepted or
   restored ([when a variant fails](#when-a-variant-fails)).
6. **mastery**: like the Time Trial. The GM checks a prerequisite: the *latest* Time Trial attempt must be a pass. If
   a later Time Trial attempt was opened (for example to learn label spellings), the chain re-passes the Time Trial
   before Mastery.
7. **done**: all three modes are GM-CORRECT.
8. **crash-retry**: an exception gets one retry after 10 s, skipping modes already solved; a second one is
   `crashed`.

The timed retry states, for completeness: `retrying` (a new attempt), `continuing` (resuming the same attempt),
`rate-limited` and `start-refused` (the GM pushed back; wait and retry without spending an attempt), `untimed` (the
fallback described later), `exhausted` (no attempts left at all), and `blocked`. Web adds `web-slot` while it waits
for a target slot. `fixing` is a legacy state from the early days, when a worker patched the solver inside a live
clock ([`fix.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/fix.md)); by the end it was no longer used.

## Six lanes, six solver shapes

<div class="hc-scroll">

| lane | what arrives | what's asked | tools | a typical `solve.py` |
|---|---|---|---|---|
| warmups | a one-line encoded blob; Mastery day N has 5N−2 sets of N lines, line k in day k's codec | one `word-word-word-NN` slug | `lib.decode` (layered BFS decoder), `lib.ciphers`, a codec registry per day | 382 lines: a few private decoders feeding `answer()` → `fallback()`; 38 cases |
| metadata forensics | `evidence.zip` members of every file format | "`<format>.<field>` for X"; timed modes add earlier days' fields | exiftool, `lib.meta` registry (25k format-field keys) | 257 lines: a cached zip index, then one dispatch into the registry |
| script analysis | zips of PowerShell, JS, VBS, batch, Python and bash droppers | up to 399 fields: decoded values, scenario enums, ATT&CK ids, style labels | node `vm` sandbox, `lib.codec`, sink replacement | 454 lines: per-language planners that decode into a step graph, then read fields off it |
| binary RE | AES-zipped ELF, PE, .NET, JAR and Mach-O sets | hundreds of fields: hashes, symbols, config keys, format labels | readelf, rizin, Ghidra headless, pyelftools, capstone, `lib.binary` | 985 lines: fast AES-zip → per-format facts → `answer()`, one forked process per set |
| mobile | an APK, sometimes with a live backend | one `ANS-` + 16 hex answer | jadx, apktool, androguard, `lib.android` | 152 lines early; 361 by day 29, with native JNI evaluation |
| web | no artifact: a live target the GM provisions | "recover the proof from target N" | `lib.web` dispatcher and plugins | a 19-line stub that calls `lib.web.main()` |

</div>

Web is the odd one out: no artifact, a live target, and a library of exploit plugins keyed on what the target exposes. It has [its own section](#the-web-lane).

## The solver contract

Everything after the single solve rests on one interface. Every challenge's `solve.py` takes
`--contract <json> --artifacts <dir>` and prints `{answer_id: value}` as JSON on its last line. It is seeded from a
107-line skeleton ([`hctf/templates/solve_skeleton.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/templates/solve_skeleton.py)) with three rules baked in: one bad field never sinks the
others, a cheap generic `fallback()` gets a second try at fields the direct parse misses, and a run that hits its
deadline prints what it has instead of being killed with nothing:

```python
def _solve_pairs(job):
    root, contract, pairs = job
    out = {}
    for aid, q in pairs:
        data = artifact_bytes(root, contract, q.get("artifact") or "")
        try:
            v = answer(aid, q, data, contract)
        except Exception as e:  # one bad field must not sink the other answers
            print(f"{aid}: {e!r}", file=sys.stderr)
            v = None
        if v is None and not _past_deadline():  # never let a fallback eat the kill margin
            v = fallback(aid, q, data, contract)
        if v is not None:
            out[aid] = normalize(v, q)
    return out
```

`main()` arms a deadline watchdog ([`lib/solverrt.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/lib/solverrt.py)), runs each Mastery set in its own forked process, and prints
once. Solvers may use only the standard library, [`lib`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/lib), and a short list of pure-Python parsers (pyzipper, pyelftools,
pefile, capstone, pycryptodome, androguard): no subprocess to 7z or jadx, and every Mastery set well under a second.

Next to the solver live its regression cases: `solver/cases/<case>/{contract.json, expected.json, artifacts/}`. The
expected answers only ever come from the GM. By the end there were 3,293 cases, two-thirds of them captured automatically from timed attempts and most of the rest from failed variants.

<details class="hc-tv">
<summary>Where the 3,293 regression cases came from</summary>

<div class="hc-scroll">

| case kind | count | where it comes from |
|---|---|---|
| auto | 2,113 | every timed attempt, holding only the answers the GM verified on it |
| variant | 486 | every *failed* timed variant, with the GM's per-field verdicts |
| compound | 233 | Mastery questions that mix earlier days' concepts |
| single | 184 | the single solve itself |
| mastery / time trial | 110 / 74 | a passed timed mode, recorded at the chain level (also when a live answer, not the solver, passed it) |
| older day-prefixed | 67 | early variant captures, before the naming settled |
| synthetic / mutation | 23 / 3 | probes that mutated a known case before the GM did |

</div>

</details>

## A single solve

{{< hctf2026 "fl-single" >}}

The single solve is where the model does most of its work, so the harness spends its effort making sure the model
starts early, starts informed, and stops the instant it is done.

1. **Challenge listed.** The chain enters `single:fetch`.
2. **Start + download, warm worker and reuse race start together.** The GM attempt starts and the artifacts
   download, and toolchains named in the challenge's text begin installing. A warm worker launches and reads the
   static part of its prompt ([the prompts](#the-prompts) explains the two-message handshake). The reuse race begins
   on whatever bytes are already here.
3. **Triage** runs as soon as the bytes land, with no model ([triage](#triage)).
4. **Did the race answer every field?** In parallel with triage: if the merged answers of yesterday's solvers are all
   confirmed by the GM, and the race's seed solver (the one that reproduces the most of them) reproduces every one,
   the worker is never sent its task: go straight to the snapshot. This is how most mobile and warmups singles
   finished in 15-45 s from day 12 on. If not, the worker gets its task.
5. **GO.** At the download mark, the warm worker gets its second message: the triage, the timed contracts, the
   race's notes. If triage is still running, its result follows through the inbox.
6. **Worker solves.** Inside its sandbox, using command-line tools, it writes `solver/solve.py`
   ([a worker's life](#a-workers-life)).
7. **Answer-first, in parallel.** If the race left only a few fields open (up to 80), a second, medium-effort worker
   answers just those straight from the bytes, split into up to three shards when there are more than 12. Every value
   it gets confirmed is posted to the main worker's inbox so it never recomputes them. It also needs free memory
   (2 GB plus 0.3 GB per running worker beyond two) and a free slot. Whichever worker gets the single to CORRECT first
   wins.
8. **Submit from the solver.** `hctf submit --from-solver` runs `solve.py`, submits every value, and if the bulk is
   judged wrong, bisects down to the fields that are actually wrong. The prompt insists this happens in the same shell
   call that writes the solver: a separate "run it first" turn costs about 5 s.
9. **GM CORRECT, and the solver passes its regression cases?** A watcher checks every 0.25 s.
10. **Snapshot, stop the worker.** On yes, the watcher copies a verified solver, pushes it to Homebase, and stops the
    worker. A day-6 review found that 60% of worker time had been spent *after* the answer was already CORRECT.
11. **Relaunch, or HELP.md.** On no, a worker that tries to stop is refused by the stop hook; a single gets up to
    three launches, and a relaunch reads the previous launch's notes. The way out is `HELP.md`, which turns the chain
    to `single:help` for the operator.
12. **Time Trial** starts from the verified snapshot.

Two background jobs also run during a single. A **dry run of the newest prior solver** on today's contract spots
answer ids it has never seen (up to six background runs, at most 12 s each). Those new id shapes are the ones most
likely to fail a Time Trial, so the watcher holds the handoff up to 45 s to check them. A **prefetch of the timed
contracts** gets the Time Trial's question list early, so the worker writes `solve.py` for the Time Trial's shape and
not only the single's.

## Triage

{{< hctf2026 "fl-triage" >}}

Triage is the harness's own reconnaissance, done in code before the model spends a single turn. Its output,
`triage.md`, is inlined into the worker's prompt.

1. **Prefetch tools.** The challenge's name and description are scanned for toolchain hints (Swift, Go, .NET,
   Flutter, AutoIt and so on), and installs start before the download finishes.
2. **Contract-shape guard.** The contract's `answer_ids` are the authority. A "template" contract, a cross-product of
   names and properties the GM didn't actually ask, is flagged loudly
   ([`hctf/contract.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/contract.py)).
3. **Header and formats.** The prompt, the GM's guidance, a status line (how many fields are already confirmed and
   which remain) and each field's expected format; over 60 fields, a table by field family instead.
4. **Describe each artifact**: type, size, members.
5. **Reconnaissance** extracts and decodes. It moves to the background when a prior solver already covers most
   fields, because then the worker mostly needs the leftovers.
6. **Toolchain check**, in parallel: detect what built each artifact *from the bytes* (cached by content hash). For
   each tool it is present, installing in the background (up to 900 s, file-locked so two chains don't install it
   twice), or missing with no recipe, which is logged as a gap for the post-run report.
7. **Ready within 1 s / 5 s?** Triage waits at most a second for the toolchain section and five for reconnaissance.
8. **Write with placeholders** if not: "still running" markers, rewritten in the background when the slow parts finish
   (and dropped if the single is already CORRECT).
9. **triage.md written**, plus retrieval: the top three similar past solves, by TF-IDF cosine similarity of at least
   0.12 (same-lane solves weigh 1.2×), are added to the prompt.

A worker that needs a tool still installing runs `hctf tool-wait <tool>`, which blocks for up to 600 s.

## A worker's life

{{< hctf2026 "fl-worker" >}}

1. **Take a worker slot.** Five local slots shared by every chain; urgent and warm workers skip the queue.
2. **Usage limit hit?** The subscription's limits are account-wide, so the harness keeps one gate for every worker.
3. **Wait for the reset.** When a worker exits on a limit with a parseable reset time within six hours, the gate
   closes until the reset plus 60 s, a single `!!!` alert goes out, and every waiting stage's deadline is extended by
   the time waited. (Before day 30 a dated reset message didn't parse, the alert never fired, and day 30's drop was
   missed.)
4. **Launch in bwrap** with the role's turn cap (the command and the sandbox are below).
5. **Message 1 → READY → GO**: the static prompt first, the challenge-specific parts once the worker has answered
   READY ([the prompts](#the-prompts)).
6. **Blocking command?** Before every shell command, a PreToolUse hook
   ([`no_block.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/.claude/hooks/no_block.py))
   refuses pagers, REPLs, `tail -f` and listeners unless they are wrapped in `timeout`. One hung shell call can eat a
   whole timed window.
7. **Refused with a reason**: the model rewrites the command with a timeout.
8. **Run the tool call.** Bash calls default to a 25 s timeout.
9. **Inbox → HARNESS UPDATE.** After every tool call, a PostToolUse hook
   ([`nudge.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/.claude/hooks/nudge.py))
   delivers any unread messages: the race's confirmed fields, values the GM rejected, the coordinator's hint. At 10
   and 30 minutes without a solve, it also tells the worker to split into two or three subagents on genuinely
   different directions. Then the next tool call goes through the same loop. The whole hook is short enough to show:

   ```python
   for m in inbox.unread(os.environ["HCTF_CHAL_DIR"], os.environ.get("HCTF_WORKER_START", "0")):
       msgs.append("HARNESS UPDATE (GM facts, authoritative): " + m.get("text", ""))
   ...
   if msgs:
       print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                                "additionalContext": "\n\n".join(msgs)}}))
   ```

10. **Stopped at CORRECT.** If the GM has meanwhile said CORRECT, the watcher stops the worker. This is the usual
    ending.
11. **May it stop?** When the worker itself tries to end its run, a Stop hook
    ([`stop_gate.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/.claude/hooks/stop_gate.py))
    allows it only when the single is CORRECT *and* the solver passes its regression cases (and has no unsafe cache,
    see [testing](#how-we-tested-it)), or `HELP.md` exists.
12. **Blocked (≤10 times).** Otherwise it is told what is missing and keeps working. After ten refusals the hook lets
    go, so a stuck worker escalates instead of grinding.
13. **How did it exit?** `ok`, `max_turns`, `auth`, `limit`, `transient`, `error` or `no_result`.
14. **Auth → `!!!` alert.** A login failure stops the chain loudly, with the instruction to log in again; nothing
    retries silently.
15. **Transient → relaunch.** A transient API error relaunches with a fresh session up to three times, after 20, 60 and
    180 s, as long as at least 90 s of the stage's time remains. Everything else is returned to the chain, which
    decides.

### The launch and the sandbox

Every worker is one headless Claude Code process. The launch looks like this (trimmed):

```bash
bwrap --dev-bind / / --tmpfs <other projects> --tmpfs ~/.claude/projects --tmpfs /mnt/c \
      --ro-bind /dev/null <each masked file> --die-with-parent -- \
  claude -p --model claude-opus-5-5 --effort high --max-turns 80 \
     --output-format stream-json --input-format stream-json --verbose \
     --strict-mcp-config --tools Bash,Read,Write,Edit,Skill,Task \
     --settings '{"autoMemoryEnabled":false,"bashEditDiffEnabled":false}' \
     --dangerously-skip-permissions
```

A few things in that line were decisions. **No MCP servers** (`--strict-mcp-config`): every tool is a command-line
program the worker calls from Bash, so several steps compose into one shell call. **A turn cap per role** (single
80, generalize 50, live answer 60, prebuild 40, the overnight library merge 110), so a stuck agent can't grind on
forever. **Skipping permission prompts** is only safe because the sandbox is the boundary: `bwrap` hides every other
project, every other transcript and the Windows drive. Directories are masked with an empty tmpfs, single files with
`/dev/null` bound over them:

```python
def sandboxed(cmd, stage=None, extra_binds=()):
    hidden = sandbox_hidden_paths(stage)
    # directories -> empty tmpfs; FILES -> /dev/null bound over them
    masks = [a for p in hidden for a in (("--tmpfs", str(p)) if Path(p).is_dir()
                                         else ("--ro-bind", "/dev/null", str(p)))]
    ...
    return ["bwrap", "--dev-bind", "/", "/", *masks, *binds, "--die-with-parent", "--", *cmd]
```

A rehearsal early on showed why: a worker ran `find / -name solve.py` and copied a solver it was never meant to see.
Prompt rules didn't stop that. Only the sandbox did. Workers that write library code overnight get a narrower box
still: no GM token, no secrets, and only their listed paths writable.

## The prompts

{{< hctf2026 "fl-prompt" >}}

A worker's prompt is assembled from a template and slots the harness fills at launch. Following the chart:

1. **Template for the role.** Fifteen plain Markdown templates with `{slot}` placeholders, one per job:

| template | lines | the worker's job |
   |---|---|---|
   | [`single.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/single.md) | 158 | solve the Single Solve and leave a reusable `solve.py` |
   | [`generalize.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/generalize.md) | 90 | a timed variant failed: fix the solver offline without breaking any earlier case |
   | [`answer_first.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/answer_first.md) | 32 | beside the single worker: answer the still-open fields straight from the bytes, nothing else |
   | [`live.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/live.md) | 26 | answer the unresolved fields of a still-open timed attempt by hand while the solver is being fixed |
   | [`fix.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/fix.md) | 14 | "URGENT": patch the solver inside a live clock (unchanged since day 1) |
   | [`codify.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/codify.md) | 42 | web: turn a winning exploit into a reusable plugin |
   | [`ratchet.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/ratchet.md), [`ratchet_log.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/ratchet_log.md) | 48, 39 | overnight: merge the day's proven facts into the library; write the lane's technique log |
   | [`prebuild.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/prebuild.md) + six lane briefs | 45 + 12-47 | overnight: speculatively build decoders for variants we haven't seen yet |

   [`fix.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/fix.md) was the early in-window patcher; once the timed modes lost their clock it stopped being called.
2. **Persona + lane skill.** A one-line persona per lane ("an expert-level CTF player who specializes in…") and the
   lane's skill, *inlined*. On day 7 every worker spent its first turn loading its skill, so the skill text is pasted
   in and the prompt says not to load it again.
3. **Helper index + label grammar.** Every public function in the lane's library, generated from the code with
   Python's `ast` at launch so it never drifts from what's actually there; then the lane's label grammar from
   [`lib/playbook.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/lib/playbook.py)
   ([learning the GM's spelling](#learning-the-gms-spelling)).
4. **Technique log + rules.** Excerpts of the lane's technique log, each capped: a 2,500-character summary, the
   "recognition cues" and codec table at 4,500 characters each, the coverage-atlas cues at 4,500, and the "variant
   axes" seen so far at 2,500. Then the rules, each with the incident that justified it, and a budget: *"aim for
   CORRECT within 60 s on a familiar family and 3 min on a new one."*
5. **Render.** A plain `str.replace` of each `{slot}`; no templating engine, so unknown braces (like JSON examples in
   the text) pass through. A prompt over 100 KB goes in on stdin, after a day-18 overnight worker's prompt hit Linux's
   128 KiB per-argument limit.
6. **Message 1**: the whole rendered prompt with the challenge-specific parts marked "arriving in your next message",
   plus "reply with exactly READY". It is sent at launch, before the bytes have landed.
7. **Triage + contracts**: `triage.md` (capped at 6,000 characters), the timed contracts, and a note about the newest
   prior solver and how far its dry run got.
8. **Message 2: GO**, sent after READY, at the download mark. On day 10 three of five lanes lost this message because
   it was sent before the worker had finished its first turn; the harness now waits for the READY result line.
9. **Inbox during the run**: the only channel after GO, delivered by the PostToolUse hook after every tool call.
10. **Coordinator**, for stalled workers only: a tool-less Sonnet 5.5 call, one turn. A single-solve worker counts as
    stalled when it is at least 7 minutes old and the GM hasn't accepted a new answer from it for 4 minutes; a
    generalize worker, at 3 minutes old with no solver edit for 3 minutes. The coordinator sees the worker's trace and
    replies with exactly `NONE` or one concrete hint of at most 90 words, never an answer value, treating everything
    quoted from artifacts as untrusted. At most two hints per worker, 7 minutes apart; the hint goes through the
    inbox. It ran 9 reviews and sent 3 hints all month, for about $0.35.

**What [`single.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prompts/single.md) tells the worker, section by section:**

1. **One line of identity and economics.** A one-line persona per lane ("an expert-level CTF player who specializes
   in…"), that it is one of several parallel workers, and the cost model: *"Every model turn costs ~5 s and the
   clock is the score."*
2. **Tooling discipline.** Use the CLI for analysis (7z, xxd, strings, readelf, jq) and the specific tool triage
   named; Python only for the solver. Batch independent commands into one message.
3. **The lane skill, inlined.** On day 7 every worker spent its first turn loading its skill, so the skill text is
   pasted in and the prompt says not to load it again.
4. **The lane's helper index**: every public function in the lane's library, generated from the code with Python's
   `ast` at launch, so it never drifts from what's actually there.
5. **The challenge**: paths, the timed contracts, and `triage.md` (inlined, capped at 6,000 characters).
6. **Goals, in order.** This section opens with *"this is a RACE"* and explains that the harness ends the session the
   moment the single is CORRECT. Then four numbered goals: understand the challenge (with the lane's technique log as
   "a REFERENCE, not a recipe"); write `solve.py` to be general, fast (every Mastery set under a second) and safe
   to patch; submit from it; stop.
7. **Rules learned the hard way**, each with the anecdote that produced it (examples below), and a budget: *"aim for
   CORRECT within 60 s on a familiar family and 3 min on a new one."*
8. **Scope**: write only inside your challenge folder; propose library changes in `NOTES.md` instead of making them.
9. **The lane's label grammar** (more on that below).
10. **How to resolve a label you're unsure of**, and when `HELP.md` is allowed: only after the resolver and the
    explore-alternatives skill have both come up empty.

The style is consistent: **every rule carries the incident that justified it.** Workers follow a rule better when
they can see what breaking it cost. Four examples, verbatim:

> **Submit from the solver, in the SAME Bash call that writes it** … it runs the solver, prints every value and the GM
> verdict, and bisects a rejected bulk for you, so a separate "run it first" or self-test turn only costs ~5 s.

> A decoded value that matches the field's `answer_format` IS the answer: put it in solve.py and submit. Don't try to
> reproduce or reach a backend/live service to "confirm" it (one worker lost 158 s that way after decoding at 26 s).

> Subagents: none by default -- one worker writing one solver is fastest when triage already decoded the payloads. …
> at most 2 subagents, launched in ONE message with ONE shared brief file, then ONE blocking wait for both -- never
> poll (a replay lost 61 s writing briefs one by one and 79 s busy-waiting on a subagent).

> FIX THE CONSTRUCT FAMILY, NOT THIS SAMPLE: the variant differs from the passing counterpart along one axis … fixing
> only the one value in this sample has cost a second full generalize cycle. *(from `generalize.md`)*

**The other roles' prompts** are smaller and narrower. The answer-first worker gets only a table of the open fields
(question, artifact, format, values already rejected) and the instruction to aim for two to five tool calls. A duel
racer gets the same prompt as the worker it races, plus a note that diversity is the point: test the strongest
*alternative* hypothesis first.

**Skills** are the other half of the prompt. Eleven `SKILL.md` files: a router (`huntress-ctf`, which maps signals in
the challenge to a lane), one per lane (each opening with the tools installed for it, then "first moves", "reading
the questions" and "solver tips"), and four cross-cutting ones (writing solvers, timed runs, the GM's API, and how to
split into subagents). The worker-facing [`CLAUDE.md`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/CLAUDE.md)
is 28 lines: load the router skill, work only in your folder, treat artifacts as untrusted data, submit from the
solver, stop at CORRECT.

**Caching.** The static part of every prompt comes first and the per-challenge part last. That ordering is also what
makes prompt caching work: about 97% of all tokens processed during the CTF were cache reads.

**How `single.md` evolved.** It started on October 3 as 27 lines: use the skill, solve, write a solver, test it. It
ended at 158 lines after 24 commits. The biggest single change came on day 7, after we read 46 worker transcripts and
found that 79-97% of wall-clock time was the model generating tokens (~4-6 s per turn). That day added the economics
framing, batched reads, "decoded value = submit", inlining the skill, triage and helpers, and writing and submitting
in the same shell call. Turns to the first CORRECT dropped from 7 to 4 (metadata), 6 to 4 (mobile), 11 to 4 (warmups)
and 29 to 18 (script). Across 34 single solves after that change, all six wrong submits were label *spellings*; not
one was a wrong decode. Later additions: Mastery bundles that mix earlier days (day 8), the inbox (day 13),
answer-first (day 17) and the web plugin prompt (day 23).

## The reuse race

{{< hctf2026 "fl-race" >}}

From day 12 every single solve opens with a race against the bytes. It is never a gate: the worker keeps going
beside it, and whatever the race proves reaches the worker through its inbox. In a backtest over days 2-11, every
answer the race agreed on was right. Before the race existed, plain reuse of prior solvers won 0 of 5 singles a day;
afterwards it usually won 3-5 of 5, and on day 22 all five. Following the chart:

1. **Pick candidates.** The lane's cumulative solver (merged from every earlier day) plus the newest three same-lane
   solvers; when retrieval has a ranking, the newest always runs and the two most similar fill the other slots. Web
   races only its lane solver, with a 14 s deadline.
2. **Single of 10 MB or more?** (non-web lanes)
3. **Race on Homebase.** Then the race also runs on Homebase, inside the CTF network, so the bytes never cross the
   home VPN. It waits up to 30 s for a relay channel, has a 75 s cap, and stands down if the local bytes arrive first.
4. **Run them in parallel**, at most six at once and 20 s each.
5. **Merge the answers.** Newest solver first; the first one to produce a field wins it. A value is "high" confidence
   if that field is GM-verified in the producing solver's own regression cases, "speculative" otherwise. The seed
   solver is the one that reproduces the most merged values.
6. **Format / slug gate.** Values that don't match a field's format, or warmups slugs that aren't real words, never
   reach the GM.
7. **Bank the answers**, within 200 probes in total: the complete set first if there is one, then the confident subset
   (bisected, up to 120 probes), then the speculative rest (up to 80). The race is the attempt's only bisector; a
   worker's own submit waits for it rather than competing.
8. **Every field confirmed,** and the seed solver reproduces every confirmed answer?
9. **Race-first handoff.** The timed modes start with the race's seed solver, after the watcher gets up to 12 s to
   verify it. No worker is launched.
10. **Resolve stray labels** otherwise: fields isolated as wrong get the label resolver, in parallel, with the other
    solvers' values as alternatives.
11. **Tell the worker**: HARNESS UPDATE lines saying how many fields are confirmed, so it stops working on them.
12. **Residual → answer-first**: a medium-effort worker takes the fields still open.

## A timed attempt

{{< hctf2026 "fl-timed" >}}

Time Trials started with a few seconds on the clock, so the timed path is a script, not an agent. No model runs
anywhere in this chart.

1. **Attempt already started?** The next mode's attempt is often started at the previous mode's CORRECT, so the
   start round trip is already paid.
2. **Start, hedged.** Every GM call is routed by measurement. Calls that are safe to repeat (`status`, and `start`,
   which resumes an open attempt) go down both paths at once, direct and through a relay on Homebase inside the CTF
   network, and the first judged reply wins. The relay is used for other calls only when its running average is at
   least 20% and 0.1 s faster than going direct; on day 5, submits through it went from 2.76 s to 0.55 s. A submit is
   never sent twice: if the relay fails mid-submit, the harness says so and makes a human check before anything is
   resent. Under all of it, one account-wide governor halves every fan-out in the harness while the GM is answering
   "slow down" (HTTP 429), so a clean run is never slowed.
3. **Download**, in parallel; Mastery bundles of 20 MB or more download set by set so solving can start on the first
   set. Large replies never ride the single SSH channel to Homebase: a 9.5 MB reply once took 59.6 s that way.
4. **Set the solve budget**: the time left minus 1.5 s, passed to the solver as a deadline. For untimed attempts it
   scales with size, from 60 to 300 s.
5. **Fork the warm solver**, one forked process per Mastery set (below).
6. **Submit once**, all answers in one call.
7. **Correct?**
8. **Record a regression case**: on yes, the attempt becomes a case named `auto-<mode>-<attempt>` holding only the
   answers the GM verified.
9. **What went wrong?** Rejected fields, or an incomplete solve.
10. **Localize** rejected fields: bisect set by set and fix labels from the confirmed-label cache, all without a model.
11. **Partial submit** for an incomplete solve: bank what the solver did produce.
12. **Failure path** for anything still wrong ([when a variant fails](#when-a-variant-fails)).

**The warm solver.** The attempt runs on Homebase first, where a long-lived daemon
([`hb_daemon.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/hb_daemon.py)) holds
one SSH stdio channel open and keeps, per solver, a **zygote**: a Python process that has already imported the
solver and its libraries. Each solve forks it, so it starts in 15-51 ms instead of the 150-230 ms of a fresh
interpreter:

```python
pid = os.fork()
if pid == 0:                                   # child
    os.setpgid(0, 0)
    os.dup2(fd_o, 1); os.dup2(fd_e, 2)         # stdout/stderr -> temp files
    code = 0
    sys.argv = [SOLVE, *[str(a) for a in req.get("args") or []]]
    try:
        runpy.run_path(SOLVE, run_name="__main__")
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    finally:
        os._exit(code)
```

The zygote is warmed by running the solver under a different `run_name`, which loads the imports and nothing else,
and is rebuilt whenever the solver directory's signature changes. When Homebase isn't ready, the same attempt code
runs locally against the public GM, with `solve.py` in a fresh interpreter instead of a fork.

## When a variant fails

{{< hctf2026 "fl-fail" >}}

A failed timed variant is the expensive case. Before day 15 it also meant a ticking clock; afterwards it usually
meant an open, untimed attempt that could still be answered. So the harness starts several repairs at once and lets
the first one that passes win. Following the chart:

1. **Capture the variant** as a regression case, with the GM's per-field verdicts. Expected answers only ever come
   from the GM.
2. **Probe the fields**: which are wrong, which are missing.
3. **Snapshot (the "before").** Before any repair touches the solver, the harness copies it, records which cases pass,
   and copies every `expected.json`.
4. **Live answer**, in parallel: a worker answers the still-open attempt's unresolved fields by hand. Untimed attempts
   only; up to 80 fields (600 if they all share one shape); medium effort at five fields or fewer; a 900 s budget.
   When the timed runner comes back, the list is narrowed through the inbox to what is still unresolved.
5. **Library racer**, in parallel (warmups only, no clock): the lane's decoder runs in a subprocess for up to 45 s;
   values the GM already rejected are excluded; it submits in up to two rounds with at most 60 bisection probes.
6. **Generalize (+ duel).** A worker edits the solver to fix the *construct family*, not this one sample. From a
   mode's second generalize on, duel racers join: Opus at medium effort plus a Sonnet 5.5 racer, each on its own copy
   of the solver and its cases. A racer whose copy passes every case has its code copied over the live solver, where
   the same transaction (steps 8-10) judges it. The racers end the moment the chain's own worker wins.
7. **First repair to pass wins.** If the live answer or the library racer gets the attempt CORRECT first, the others
   are stopped; the generalize continues in the background on a copy so the solver still learns the variant.
8. **Restore every `expected.json`**, so a worker can never author the answers it is judged against (below).
9. **Anything broken?** Run every case that passed before.
10. **Restore the snapshot** if so (the edit goes to `.generalize-rejected/` for a human), **keep the edit** if not.
11. **Retries left (≤5)?** Some failures don't use one up: rate limits (up to six, backing off), a refused start (up to
    30), a clock-only expiry (up to 12), a localization cut short (up to two resumes).
12. **Next timed attempt**, which usually passes, because the solver now knows this variant.
13. **Untimed fallback** when the pool of attempts is exhausted or retries run out: three rounds on a fresh untimed
    attempt.
14. **Blocked → a human** if that fails too: the chain is `blocked` and the feed shows `!!!`.

The transaction in step 9-10 is a few lines:

```python
passed = {r.get("case") for r in (res or []) if r.get("ok")}
broken = sorted(getattr(self, "_baseline", set()) - passed)
if res and not broken:
    ...                                   # keep the edit
    return
self._restore_snapshot(f"broke previously-passing cases {broken[:6]}" if res else
                       f"solver no longer runs ...")
```

Expected answers are restored *before* the test runs because once an overnight worker, tuning a solver for speed,
wrote its own solver output into an unverified case's empty `expected.json`. That froze 3,075 unjudged values as
"GM truth". Since then workers can't author expected answers at all.

## Learning the GM's spelling

{{< hctf2026 "fl-labels" >}}

The hardest fields were never the analysis. They were *spelling*. Many script and binary questions are `exact_text`
classifications, like "how is this payload's loop guarded" or "what format is this". The GM wants its own synthetic
label, gives no list, and only says right or wrong. Following the chart, for a rejected field:

1. **Is the field an enum?** If `answer_format.kind` is `enum`, the GM lists the `accepted_values`:
2. **Pick from accepted_values**, and never probe.
3. **Rank candidates** otherwise, in a fixed order: the solver's own value, the playbook's seed values, alternate
   renderings (hex width, GUID braces and so on), labels already confirmed for sibling fields, and finally compositions
   of terms found in the artifact.
4. **Filter**: drop everything the playbook or the GM already rejected; never resubmit a known-bad spelling.
5. **Local guards**, which every submit passes anyway: enum membership, regex patterns, flag shape, slug words, caps
   on wrong answers per attempt, and an ATT&CK guard backed by all 858 MITRE technique ids. That guard checks that a
   technique id is *real*, not that it is *right*; the judgment stays with the worker.
6. **Probe one at a time**: each probe is a real single-field submit, with a budget of 25 per field, through the
   account-wide rate governor.
7. **Accepted?**
8. **Cache in vocab.json**: every confirmed closed-vocabulary label goes into
   [`lib/vocab.json`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/lib/vocab.json) (152 by
   the end), which the timed runner reads *inside* the window to fix a rejected field without a model.
9. **Budget left?** Then rank again with the next candidates.
10. **Depth-3 search, then HELP.** When one- and two-token compounds are exhausted, the resolver composes three-token
    labels before anything new is invented; if nothing fits, the worker writes `HELP.md`.

**The playbook.** [`lib/playbook.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/lib/playbook.py)
holds what was learned about the grammar, one entry per field family. A family is the last token of the answer id, so
all `*-control` fields share a rule:

```python
@dataclass
class PlaybookEntry:
    lanes: tuple           # lanes this applies to
    families: tuple        # field-family endings it covers
    rule: str              # the derivation rule, one or two sentences
    confirmed: tuple = ()  # GM-accepted values seen so far (closed vocab = the whole set)
    rejected: tuple = ()   # GM-rejected spellings: never reprobe these
    examples: tuple = ()   # worked (artifact-feature -> label) notes
    closed: bool = False   # True: confirmed is the COMPLETE allowed set
    derive: object = None  # optional fn(terms, solver_value) -> [candidate, ...]
```

There were 27 entries by the end. On top of them sat a block of **naming laws**, the generator's grammar rather than
a list of answers. I'm keeping the actual labels out of this post, but the shapes were what mattered:

- A label is a short `<keyword>_<suffix>` compound built from a real token in the bytes, never an analyst's synonym.
  The spelled-out form of a statement was always wrong; the short keyword that opens it was right.
- A format is the container alone for native code, and container plus the runtime's own spec token for managed code.
- A classification of *where something is stored* is a two- or three-token compound. When the one- and two-token
  pieces are all rejected, search depth three before inventing new words.
- "The answer appears in the bytes" holds for identifiers (symbols, paths, hashes) only. Concept labels are the GM's
  own words and never occur in the file.

## The web lane

{{< hctf2026 "fl-web" >}}

Web was the odd lane out: no artifact, just a live target the GM provisions on demand, and from day 19 two or three
web challenges a day.

1. **Take a target slot.** Up to five live targets per team (the organizers lifted an earlier one-target limit on
   day 20), enforced with file locks and held for the whole chain. The next mode's target is pre-provisioned.
2. **Target up?** The harness polls every 2 s for up to 480 s.
3. **Revive or kick it.** A target that was `cleaned` or `stopped` is revived from the arena (every 30 s, up to six
   times); one stuck in `preparing` is kicked (every 15 s, up to four times). Mastery targets sometimes took over
   five minutes to come up, which is why web owned the slow second half of the month.
4. **Read the clue keys.** Each target exposes a clue endpoint, and the *keys* of its response decide which handlers
   apply.
5. **One-shot credit kit?** Some targets let you spend a credit only once. A side-effect-free audit request checks
   first.
6. **RUN_ALONE handlers only** if it is: nothing else may touch the target, with a budget of at least 25 s. Day 27's
   target was spent by a helper request before the real exploit ran; this is the fix.
7. **Race the candidates** otherwise: the LFI probe, every handler keyed on the target's clues, a generic ladder, and
   every earlier web day's solver, each in its own thread; the first `proof_…` wins. Budgets: 20 s for a known class,
   12 s for an unknown one.
8. **Proof found?** Up to four retries, 2.5 s apart, then it is submitted like any other answer.
9. **Self-heal, or a worker**: a credit kit gets an arena reset (at most twice per chain); otherwise the LLM worker
   takes over and solves it by hand.
10. **Codify the winner.** After CORRECT, a worker turns the winning exploit into a plugin keyed on the clue, within
    300 s. A verifier runs it against a live target: exit 0 means it produced the proof, 1 no proof within 30 s, 2 an
    invalid plugin, 3 a key map that matches no clue.
11. **Promote atomically** with `os.replace`, keeping a backup of the previous version. The Time Trial waits up to 10 s
    for a fresh plugin, and the next target of that class is solved by the plugin in seconds.

Time Trial and Mastery each get a fresh target. When a mode is done, arena stop frees its slot.

## Overnight: the post-run and the prebuild

{{< hctf2026 "fl-post" >}}

1. **Board GM-solved?**
2. **Held** if any mode is still open: the holdouts are listed in the feed, the operator finishes them, then runs
   `hctf postrun --day N`.
3. **Ratchet.** The only writer to the shared [`lib/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/lib). Its inputs are the "proposed library additions" every worker
   writes in its `NOTES.md` (deduplicated against earlier days) plus a digest of the day. Per-lane technique-log
   workers run alongside it (8 minutes each; the logs reached 1,448 lines by the end), and the ratchet worker itself
   gets 15 minutes.
4. **Suites still pass?** The gate runs the lane suites and the ATT&CK coverage check in parallel. It is
   baseline-aware: a suite that already failed before the ratchet doesn't count against it. Assertions a worker
   edited are restored first; if the merge only passes with the edited ones, it is kept with a `!!!` review alert.
5. **Revert `lib/` + [`tests/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/tests)** if the gate fails, so nothing half-merged survives.
6. **Speed-harden.** For every solver: failing verified cases get a correctness fix first; a slowest case over 2.5 s,
   or Mastery sets solved one after another instead of in parallel, gets a speed generalize.
7. **≥5% faster?** Re-time the slowest case (the minimum of two interleaved runs), or check whether a new case now
   passes.
8. **Keep the faster solver**, or **restore the snapshot**.
9. **Train.** Every earlier day's verified cases are replayed against today's library, plus a mutation probe that
   alters known cases along the axes variants usually vary (encoding, order, wrapper). Hard misses are adopted as
   cases and fixed by a transactional generalize, up to two rounds. Nothing learned on day 20 may break day 8.
10. **Prebuild until the warm-up**: the next chart. It stops 30 minutes before the next drop, which is when the warm-up
    begins.
11. **Coverage + KPI row.** Coverage re-checks that every ATT&CK id in the knowledge layer is a real one and writes a
    toolchain report: tools workers needed that weren't installed. `hctf kpi --record` appends the day's row to the
    KPI table: time to 14/15 and 15/15 modes, release lag, race wins, generalizes on the critical path, and cost.

Each phase is recorded in `.run/dayNN.postrun.json` and can be resumed after a crash; the day-16 out-of-memory crash
in the middle of the post-run is why.

{{< hctf2026 "fl-prebuild" >}}

The prebuild is where most of `lib/` came from.

1. **Pick a target** from a queue: coverage gaps first, then a hand-ranked list, then the rest, skipping targets that
   are done or failed twice.
2. **A worker builds one module** on a private copy of the library, with no GM token and no secrets.
3. **Allowed paths and calls?** An AST allowlist of imports and calls: no subprocess, `eval` or file I/O.
4. **Fixtures pass?** At least two per format including a decoy, each under a second, checked by an oracle that is
   independent of the module.
5. **Suites + replay green?** The lane suites and a replay of every verified case, one module at a time under a lock.
6. **Merge into lib/** if all three pass. Prebuilt modules are race entries only: they can win a field in tomorrow's
   reuse race, but nothing on the critical path waits for them. The metadata registry alone grew 189 such modules
   covering 25,099 format-field keys.
7. **Throw it away** otherwise; a change to the tree outside the gate stops the batch with a `!!!`. Then the next
   target. Each lane is capped at $60 a night.

## The operator's toolkit

What the operator actually has to work with during a run:

- **`hctf feed`**: one line per milestone. A mode solved (and how: in-attempt fix, live answer, reuse race,
  answer-first), blocked, errored or expired; a live answer started; a reconnect; a generalize started, accepted or
  rejected; a duel started or won; a coordinator hint; a request for help; a contract the GM rewrote; any `!!!`
  line; post-run phases; and a heartbeat that warns when a generalize runs past 90 s.
- **`hctf why <chain>`**: per mode, done or pending, how often the stop hook has blocked, the last attempt's window and
  wrong or missing fields, the probe diagnosis, and the last worker result. The verdict is DONE, NOT DONE (run
  reconcile), WORKING (cycling on the same wrong field means converging on a label) or BLOCKED.
- **`hctf reconcile`**: asks the GM which modes are solved and rewrites local state to match.
- **`!!!` alerts**, each one a condition that needs a human: a failed login, a usage limit, a web attempt left open and
  unsolved, a GM attempt context gone invalid, a generalize lock held too long, a lost `solve.py`, a failed
  rehearsal of the Mastery fork pool or of the day's warmups encodings, a pre-start that came back with a clock
  running, a ratchet gate that only passed with edited assertions, a prebuild that touched files outside its gate, and
  a slow network path.
- **`HELP.md`**: written by a worker only when it truly doesn't know the concept (after the label resolver and the
  explore-alternatives skill both failed). A contract-drift check (re-fetching the question and diffing it) may then
  re-run the single, in case the GM rewrote the question.

## How we tested it

A CTF that drops once a day gives you one live test a day. Most of the harness's reliability came from making failure
reproducible at night instead.

- **A fake Game Master.** [`hctf/replay_gm.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/replay_gm.py) (448 lines) serves a solved day's saved contracts and bytes and judges
  single solves locally. Timed modes are proxied to the real GM, which still hands out fresh variants. With the library
  pinned to the commit from before that day, a replay is an honest re-run of the day from scratch. Two catches: each
  replay spends real timed variants, so we ran at most two or three a day, and web can't be replayed at all.
- **Fault injection.** The same fake GM can cut replies short, add latency, return 429s or a 503 on `start`, flap
  Mastery's prerequisite and stall downloads. [`tests/test_fault_replay.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/tests/test_fault_replay.py) runs 26 checks across 11 scenarios, and
  every scenario is a failure that really happened in a live run. It is green in about two minutes, and a red run
  fails the warm-up preflight.
- **Suites named after post-mortems.** The test suites grew from 10 on day 8 to 78 at the end, about 2,700 assertions.
  The largest ones are literally named after the day that asked for them (`test_d22_postmortem` alone has 74
  checks). A static lint refuses `id()`-keyed caches in solvers. On day 25 a binary Mastery got 46 fields wrong
  because a cache was keyed on `id(member_bytes)`: on the 2-vCPU VM one process solved several sets in turn, a freed
  object's address came back as the next set's member, and that set read the previous set's facts. It never showed on
  12 local cores, where every set had its own process.
- **Preflight** ([the whole orchestration](#the-whole-orchestration), step 1) runs the fault suite at every warm-up; a red suite is a FAIL.

The "sub-2-minute" plan written on day 17 found that every day over 2:00 had one of two causes: a generalize on the
critical path, or a harness bug new that day. The fixes always landed a day late. Replays and the fault suite turned
"tomorrow's bug" into last night's red test.

## Appendix: the codebase

The harness is two very different kinds of code. The orchestrator is ordinary software, built in Claude Code sessions
one post-mortem at a time. The library is the part that learned: most of it was written by workers overnight, behind
tests, and none of it existed on day 1.

| part | size | written by |
|---|---|---|
| [`hctf/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/hctf): orchestrator, CLI, timed runner | 52 modules, 32k lines | orchestrator sessions, reviewed every night |
| [`lib/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/lib): shared solving library | 262 files, 195k lines | mostly the nightly ratchet and the off-peak prebuild. Four files (binary, codec, android, warmups codecs) are 116k of it |
| [`lib/meta/prebuilt/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/lib/meta/prebuilt): speculative metadata extractors | 189 modules, 72k lines | prebuild workers, each kept only behind its own fixtures |
| [`tests/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/tests) | 78 suites, 24k lines | most are named after the post-mortem that asked for them |
| [`skills/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/skills) and [`hctf/prompts/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/hctf/prompts) | 11 skills (547 lines), 15 prompt templates | hand-curated |
| `challenges/` | 187 solver directories, 3,293 regression cases | single-solve workers and the harness |

{{< hctf2026 "growth" >}}

A map of every module is folded below.

<details class="hc-tv">
<summary>Module map: every subsystem of the orchestrator</summary>

<div class="hc-scroll">

| subsystem | modules | job |
|---|---|---|
| Launch and chain state | [`orchestrate.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/orchestrate.py) (10k lines), [`cli.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/cli.py), [`paths.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/paths.py), [`hostguard.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/hostguard.py), [`driftwatch.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/driftwatch.py) | `run()`, one `Chain` per challenge, atomic `chain.json` state, every [`hctf`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/hctf) subcommand, one busy harness per host, re-fetch a contract the GM rewrote in place |
| Triage (no LLM) | [`triage.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/triage.py), [`toolchain.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/toolchain.py), [`contract.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/contract.py), [`retrieval.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/retrieval.py) | bytes and description → toolchain → install what's missing → `triage.md`; contract-shape guard; past solves by fingerprint |
| Workers | [`workers.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/workers.py), [`inbox.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/inbox.py), [`coordinator.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/coordinator.py), [`duel.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/duel.py), `prompts/*.md` | `claude -p` in a sandbox, warm `READY`/`GO`, relaunch on limits; mid-run messages; a tool-less reviewer that sends one hint to a stalled worker; best-of-N racers |
| Timed runner | [`timed.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/timed.py), [`hb_timed.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/hb_timed.py), [`hb_daemon.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/hb_daemon.py), [`hb_zygote.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/hb_zygote.py), [`procgov.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/procgov.py) | start → download → solve → submit in one process; a daemon on Homebase over one SSH channel; fork-per-solve; process groups, nice and OOM priorities |
| GM transport | [`gm.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/gm.py), [`gmroute.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/gmroute.py), [`ratebucket.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/ratebucket.py), [`mssproxy.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/mssproxy.py), [`remote.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/remote.py) | stdlib client with keep-alive; measured, hedged routing; an account-wide 429 governor; an MSS-clamping relay |
| Race and labels | [`solvers.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/solvers.py), [`libracer.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/libracer.py), [`labels.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/labels.py), [`grouptest.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/grouptest.py), [`fmtalt.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/fmtalt.py), [`scout.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/scout.py) | reuse race and solver tests; label resolution; parallel bisection of rejected fields; alternate renderings of a value |
| Robustness probes | [`mutate.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/mutate.py), [`compound.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/compound.py), [`family.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/family.py), [`today_probe.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/today_probe.py) | mutate yesterday's cases before the GM does |
| Web | [`webtarget.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/webtarget.py), [`webharden.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/webharden.py), [`lib/web/`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/tree/HEAD/lib/web) | live target lifecycle; clue-keyed exploit handlers |
| Learning | [`postrun.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/postrun.py), [`prebuild.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/prebuild.py), [`train.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/train.py) | resumable post-run phases, off-peak breadth, replaying every earlier day |
| Observability | [`feed.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/feed.py), [`watch.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/watch.py), [`kpi.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/kpi.py), `timeline.py`, [`ressample.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/ressample.py) | one line per milestone, KPI rows, timing marks, a resource sampler |
| Rehearsal | [`replay_gm.py`](https://github.com/blackbeard666/huntress-ctf-2026-ai-harness/blob/HEAD/hctf/replay_gm.py) | a fake GM for replays and fault injection |

</div>

</details>

---

**Keep reading:** [Part 1](/writeups/huntress-ctf-2026-ai-arena/) tells the story this machine was built for, and [the numbers](/writeups/huntress-2026-dashboard/) show what it did over the month.
