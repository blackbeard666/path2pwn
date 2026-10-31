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

## Inside the harness

### The codebase at a glance

The harness is two very different kinds of code. The orchestrator is ordinary software, built in Claude Code sessions
one post-mortem at a time. The library is the part that learned: most of it was written by workers overnight, behind
tests, and none of it existed on day 1.

| part | size | written by |
|---|---|---|
| `hctf/`: orchestrator, CLI, timed runner | 52 modules, 32k lines | orchestrator sessions, reviewed every night |
| `lib/`: shared solving library | 262 files, 195k lines | mostly the nightly ratchet and the off-peak prebuild. Four files (binary, codec, android, warmups codecs) are 116k of it |
| `lib/meta/prebuilt/`: speculative metadata extractors | 189 modules, 72k lines | prebuild workers, each kept only behind its own fixtures |
| `tests/` | 78 suites, 24k lines | most are named after the post-mortem that asked for them |
| `skills/` and `hctf/prompts/` | 11 skills (547 lines), 15 prompt templates | hand-curated |
| `challenges/` | 187 solver directories, 3,293 regression cases | single-solve workers and the harness |

{{< hctf2026 "growth" >}}

### Module map

| subsystem | modules | job |
|---|---|---|
| Launch and chain state | `orchestrate.py` (10k lines), `cli.py`, `paths.py`, `hostguard.py`, `driftwatch.py` | `run()`, one `Chain` per challenge, atomic `chain.json` state, every `hctf` subcommand, one busy harness per host, re-fetch a contract the GM rewrote in place |
| Triage (no LLM) | `triage.py`, `toolchain.py`, `contract.py`, `retrieval.py` | bytes and description → toolchain → install what's missing → `triage.md`; contract-shape guard; past solves by fingerprint |
| Workers | `workers.py`, `inbox.py`, `coordinator.py`, `duel.py`, `prompts/*.md` | `claude -p` in a sandbox, warm `READY`/`GO`, relaunch on limits; mid-run messages; a tool-less reviewer that sends one hint to a stalled worker; best-of-N racers |
| Timed runner | `timed.py`, `hb_timed.py`, `hb_daemon.py`, `hb_zygote.py`, `procgov.py` | start → download → solve → submit in one process; a daemon on Homebase over one SSH channel; fork-per-solve; process groups, nice and OOM priorities |
| GM transport | `gm.py`, `gmroute.py`, `ratebucket.py`, `mssproxy.py`, `remote.py` | stdlib client with keep-alive; measured, hedged routing; an account-wide 429 governor; an MSS-clamping relay |
| Race and labels | `solvers.py`, `libracer.py`, `labels.py`, `grouptest.py`, `fmtalt.py`, `scout.py` | reuse race and solver tests; label resolution; parallel bisection of rejected fields; alternate renderings of a value |
| Robustness probes | `mutate.py`, `compound.py`, `family.py`, `today_probe.py` | mutate yesterday's cases before the GM does |
| Web | `webtarget.py`, `webharden.py`, `lib/web/` | live target lifecycle; clue-keyed exploit handlers |
| Learning | `postrun.py`, `prebuild.py`, `train.py` | resumable post-run phases, off-peak breadth, replaying every earlier day |
| Observability | `feed.py`, `watch.py`, `kpi.py`, `timeline.py`, `ressample.py` | one line per milestone, KPI rows, timing marks, a resource sampler |
| Rehearsal | `replay_gm.py` | a fake GM for replays and fault injection |

### Life of one challenge

{{< hctf2026 "chain" >}}

1. **Release.** `bin/day.sh N --wait` launches `hctf run` as a memory-capped systemd user unit (the cap arrived after
   day 16, when ~57 worker processes ran WSL out of memory). `wait_for_release` polls the GM every 0.3 s and starts
   each lane's chain in a thread pool the moment it lists. The median release lag ended up around 1-3 s.
2. **Fetch and warm, in parallel.** `single:fetch` starts the GM attempt and the download in one pool, and a
   **warm worker** in another: a `claude -p` session that has already read the static prompt and replied `READY`.
3. **Race.** A background thread runs the reuse race (below). A full win sets `single:reuse-won`, and the worker is
   never sent its task.
4. **Triage, then GO.** `triage.py` writes `triage.md` with no LLM: what built each artifact, which tools it needs (and
   installs them if missing), the contract's shape. At the download mark the worker gets `GO` plus the triage.
5. **Solve.** The worker writes `solver/solve.py` and runs `hctf submit --from-solver` in the same shell call. That runs
   the solver, submits every value, and bisects a bulk "incorrect" down to the fields that are actually wrong.
6. **Stop at CORRECT.** `_watch_ready` polls every 0.25 s. As soon as the GM says CORRECT and the solver passes its
   cases, it snapshots a verified copy, pushes it to Homebase and kills the worker. A day-6 review found that 60% of
   worker time was being spent *after* the answer was already CORRECT.
7. **Time Trial, then Mastery.** The timed runner replays the snapshot with no model in the loop. If the GM says
   Mastery's prerequisite isn't met, the chain re-passes the Time Trial first.
8. **Fail, learn, retry.** A failed variant becomes a regression case, and four things start at once: per-field
   probing, a no-LLM library racer, a **live-answer** worker on the still-open attempt, and a **transactional
   generalize** on the solver. Up to five timed retries, then the untimed fallback, then `blocked`.

### What a worker sees

A worker's prompt is `hctf/prompts/single.md` (158 lines) with its slots filled from the harness:

- a one-line persona for the lane ("an expert-level CTF player who specializes in…")
- the lane skill, **inlined** so no turn is spent loading it
- an AST-generated index of the lane's `lib` helpers
- the lane's label grammar from `lib/playbook.py` (below)
- the lane's technique log: recognition cues, pitfalls and the variant axes seen so far
- `triage.md`, capped at 6,000 characters, plus the newest prior solver and the timed contracts

Its first paragraph sets the economics: *"Every model turn costs ~5 s and the clock is the score."* The launch itself
looks like this (trimmed):

```bash
bwrap --dev-bind / / --tmpfs <other projects> --tmpfs ~/.claude/projects --tmpfs /mnt/c \
      --ro-bind /dev/null <each masked file> --die-with-parent -- \
  claude -p --model claude-opus-5-5 --effort high --max-turns 80 \
     --output-format stream-json --input-format stream-json --verbose \
     --strict-mcp-config --tools Bash,Read,Write,Edit,Skill,Task \
     --settings '{"autoMemoryEnabled":false,"bashEditDiffEnabled":false}' \
     --dangerously-skip-permissions
```

Turn caps differ by role: single 80, generalize 50, live answer 60, fix 30, prebuild 40, ratchet 110. Skipping
permission prompts is only safe because the sandbox is the boundary. Directories are masked with an empty tmpfs, and
single files with `/dev/null` bound over them:

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
Prompt rules didn't stop that. Only the sandbox did. Prebuild workers get a narrower box still: no GM token, no
secrets, and only their listed paths writable.

Three Claude Code hooks shape the agent loop from outside the prompt:

- **PostToolUse (`nudge.py`)** is how the harness talks to a worker mid-run. After every tool call it drains the
  challenge's inbox into the worker's context. The reuse race uses it to say which fields are already confirmed, so the
  worker stops working on them:

  ```python
  for m in inbox.unread(os.environ["HCTF_CHAL_DIR"], os.environ.get("HCTF_WORKER_START", "0")):
      msgs.append("HARNESS UPDATE (GM facts, authoritative): " + m.get("text", ""))
  ...
  if msgs:
      print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                               "additionalContext": "\n\n".join(msgs)}}))
  ```

  At 10 and 30 minutes without a solve, the same hook tells the worker to split into two or three subagents on
  genuinely different directions.
- **Stop (`stop_gate.py`)** refuses to let a single-solve worker end its run until the GM says CORRECT *and* the
  solver passes its regression cases (or it has written `HELP.md`). After ten refusals it lets go, so a stuck worker
  escalates instead of grinding.
- **PreToolUse on Bash (`no_block.py`)** refuses pagers, REPLs, `tail -f` and listeners unless they are wrapped in
  `timeout`. One hung shell call can cost a whole timed window.

### The solver contract

Everything after the single solve rests on one interface. Every challenge's `solve.py` takes
`--contract <json> --artifacts <dir>` and prints `{answer_id: value}` as JSON on its last line. It is seeded from a
107-line skeleton (`hctf/templates/solve_skeleton.py`) with three rules baked in: one bad field never sinks the
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

`main()` arms a deadline watchdog (`lib/solverrt.py`), runs each Mastery set in its own forked process, and prints
once. Solvers may use only the standard library, `lib`, and a short list of pure-Python parsers (pyzipper, pyelftools,
pefile, capstone, pycryptodome, androguard): no subprocess to 7z or jadx, and every Mastery set well under a second.

Next to the solver live its regression cases: `solver/cases/<case>/{contract.json, expected.json, artifacts/}`. The
expected answers only ever come from the GM. By the end there were 3,293 cases:

| case kind | count | where it comes from |
|---|---|---|
| auto | 2,113 | every timed attempt, holding only the answers the GM verified on it |
| variant | 486 | every *failed* timed variant, with the GM's per-field verdicts |
| compound | 233 | Mastery questions that mix earlier days' concepts |
| single | 184 | the single solve itself |
| mastery / time trial | 110 / 74 | a passed timed mode, recorded at the chain level (also when a live answer, not the solver, passed it) |
| older day-prefixed | 67 | early variant captures, before the naming settled |
| synthetic / mutation | 23 / 3 | probes that mutated a known case before the GM did |

### Learning the GM's spelling

The hardest fields were never the analysis. They were *spelling*. Many script and binary questions are `exact_text`
classifications such as "how is this payload's loop guarded" or "what format is this". The GM wants its own synthetic
label, gives no list, and only says right or wrong. `lib/playbook.py` holds what we learned about that grammar, one
entry per field family. A family is the last token of the answer id, so all `*-control` fields share a rule:

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

When a label is still unknown, `hctf labels` ranks candidates in a fixed order: the enum's own `accepted_values` (if
the GM gave a list, never probe), then the solver's value, the playbook's seeds, alternate renderings (hex width, GUID
braces), labels confirmed for sibling fields, and finally compositions of terms from the artifact. Anything the
playbook or the GM already rejected is filtered out, and each field gets a budget of 25 probes. Every confirmed
closed-vocabulary label lands in `lib/vocab.json` (152 by the end), which the timed runner reads *inside* the window
to fix a rejected field without an LLM.

Every submit also passes local guards first: enum membership, regex patterns, flag shape, slug words, caps on wrong
answers per attempt, and an ATT&CK guard backed by all 858 MITRE technique ids. That guard checks that a technique id
is *real*, not that it is *right*; that judgment stays with the worker.

### Six lanes, six solver shapes

| lane | what arrives | what's asked | tools | a typical `solve.py` |
|---|---|---|---|---|
| warmups | a one-line encoded blob; Mastery day N has 5N−2 sets of N lines, line k in day k's codec | one `word-word-word-NN` slug | `lib.decode` (layered BFS decoder), `lib.ciphers`, a codec registry per day | 382 lines: a few private decoders feeding `answer()` → `fallback()`; 38 cases |
| metadata forensics | `evidence.zip` members of every file format | "`<format>.<field>` for X"; timed modes add earlier days' fields | exiftool, `lib.meta` registry (25k format-field keys) | 257 lines: a cached zip index, then one dispatch into the registry |
| script analysis | zips of PowerShell, JS, VBS, batch, Python and bash droppers | up to 399 fields: decoded values, scenario enums, ATT&CK ids, style labels | node `vm` sandbox, `lib.codec`, sink replacement | 454 lines: per-language planners that decode into a step graph, then read fields off it |
| binary RE | AES-zipped ELF, PE, .NET, JAR and Mach-O sets | hundreds of fields: hashes, symbols, config keys, format labels | readelf, rizin, Ghidra headless, pyelftools, capstone, `lib.binary` | 985 lines: fast AES-zip → per-format facts → `answer()`, one forked process per set |
| mobile | an APK, sometimes with a live backend | one `ANS-` + 16 hex answer | jadx, apktool, androguard, `lib.android` | 152 lines early; 361 by day 29, with native JNI evaluation |
| web | no artifact: a live target the GM provisions | "recover the proof from target N" | `lib.web` dispatcher and plugins | a 19-line stub that calls `lib.web.main()` |

Web ended up the most "library" of the lanes. Each target exposes a clue endpoint, and `lib.web` dispatches on the
*keys* of that response to five built-in exploit classes and 21 per-class plugins, racing them against prior web
solvers and a generic ladder. A worker that meets a new class writes it as a plugin. `lib/web/plugin.py` promotes it
only after it works against a live target.

### The reuse race

From day 12 every single solve opens with a **race**. The newest three same-lane solvers plus a cumulative lane solver
run against today's bytes, and anything they agree on is submitted, banking partial answers in at most seven submits.
The race is never a gate: the worker keeps going beside it, and whatever the race proves reaches the worker through
the inbox hook ("HARNESS UPDATE: 398/406 fields confirmed"). In a backtest over days 2-11, every answer the race
agreed on was right. Before day 12 it won 0 of 5 singles a day. From then on it usually won 3-5 of 5, and on day 22 all five.

For big binaries the race moved **into the network**: from day 26 a single of 10 MB or more races on the
organizer's Homebase VM, next to the GM, so the bytes never cross a home VPN. When the race clears all but a few fields,
an **answer-first** worker at medium effort reads the leftovers straight from the bytes while the main worker keeps
writing the solver.

### The timed path in code

Time Trials gave a few seconds, so the timed path is a script, not an agent. The organizers provided each team a
**Homebase** VM inside the CTF network (2 vCPU, 60 credits a day), and routing to it was measured rather than assumed.
Timed submits through the inside proxy dropped from **2.76 s to 0.55 s** on day 5.

On Homebase a long-lived daemon (`hb_daemon.py`) holds one SSH stdio channel open, and per solver it keeps a
**zygote**: a Python process that has already imported the solver and its libraries. Each attempt forks it, so a
solve starts in 15-51 ms instead of the 150-230 ms of a fresh interpreter:

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
and is rebuilt whenever the solver directory's signature changes.

Every GM call goes through `gmroute`, which keeps running averages per path and uses the in-network relay only when it
is clearly faster (below 0.8× local minus 0.1 s). Idempotent calls are **hedged**: `status`, and `start`, which
resumes the live attempt, go down both paths, and the first judged reply wins. `submit` is never sent twice, and a
relay failure on submit says so loudly instead of retrying:

```python
if _judged(env) and env.get("http") != 404 and "win" not in out:
    out["win"] = env; out["win_path"] = path; done.set()
elif _judged(env) and "win" in out and op == "start":
    a, b = _attempt_of(out["win"]), _attempt_of(env)
    if a and b and a != b:
        _say(f"!!! [gmroute] start {args[1]}: the two paths returned different attempts ...")
```

A 404 never wins alone, because the release probe reads 404 as "not listed yet", and a proxy that lags the drop must
not hide the other path's answer. Under all of it sits one account-wide rate governor: a flock-protected JSON file that
every process shares. A 429 anywhere marks "pressure", and every fan-out in the harness narrows while it's hot:

```python
def wave_width(base, floor=2):
    """Narrow a fan-out width while the account is under throttle pressure; otherwise unchanged
    (so clean runs are never slowed)."""
    if base <= floor or not pressure():
        return base
    return max(floor, base // 2)
```

### Generalize as a transaction

A wrong answer under the clock is the expensive case, so every failure becomes data. The variant is saved as a
regression case with every GM-confirmed answer, and a **generalize** worker edits the solver. The edit is a
transaction. Before the worker starts, the harness snapshots the solver, records which cases pass, and copies every
`expected.json`. After the worker exits, for any reason:

```python
passed = {r.get("case") for r in (res or []) if r.get("ok")}
broken = sorted(getattr(self, "_baseline", set()) - passed)
if res and not broken:
    ...                                   # keep the edit
    return
self._restore_snapshot(f"broke previously-passing cases {broken[:6]}" if res else
                       f"solver no longer runs ...")
```

A rejected edit is kept in `.generalize-rejected/` for a human to read. The expected answers are restored *before*
the test runs, because once, a speed-hardening worker wrote its own solver output into an unverified case's empty
`expected.json`, freezing 3,075 unjudged values as "GM truth". Since then workers can't author expected answers at
all. A **duel** races two or three generalizers (Opus at medium plus a Sonnet racer), and the first verified fix wins.

### Knowledge that grew itself

After each day the **post-run** turned what was proven into tomorrow's head start:

- a test-gated **ratchet**, the only writer to the shared `lib/`, which promotes the day's techniques and
  GM-confirmed labels into `lib/knowledge.py`, `lib/vocab.json` and the lane modules, and rolls back unless every
  suite passes
- per-lane **technique logs** (1,448 lines by the end) that the next day's prompts inline
- **speed-harden**, which re-times every solver and rolls an edit back unless it is at least 5% faster
- **prebuild**: off-peak workers speculatively building decoders and extractors for variants we hadn't seen yet. Each
  one is kept only behind its own fixtures and only as a race entry, never on the critical path. The metadata
  registry alone grew 189 such modules covering 25,099 format-field keys with zero conflicts.
- **train**, which replays every earlier day's cases against today's library, so nothing learned on day 20 silently
  breaks day 8

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

## How we tested it

A CTF that drops once a day gives you one live test a day. Most of the harness's reliability came from making failure
reproducible at night instead.

- **A fake Game Master.** `hctf/replay_gm.py` (448 lines) serves a solved day's saved contracts and bytes and judges
  single solves locally. Timed modes are proxied to the real GM, which still hands out fresh variants. With the library
  pinned to the commit from before that day, a replay is an honest re-run of the day from scratch. Two catches: each
  replay spends real timed variants, so we ran at most two or three a day, and web can't be replayed at all.
- **Fault injection.** The same fake GM can cut replies short, add latency, return 429s or a 503 on `start`, flap
  Mastery's prerequisite and stall downloads. `tests/test_fault_replay.py` runs 26 checks across 11 scenarios, and
  every scenario is a failure that really happened in a live run. It is green in about two minutes, and a red run
  fails the warm-up preflight.
- **Suites named after post-mortems.** The test suites grew from 10 on day 8 to 78 at the end, about 2,700 assertions.
  The largest ones are literally named after the day that asked for them (`test_d22_postmortem` alone has 74
  checks). A static lint refuses `id()`-keyed caches in solvers. On day 25 a binary Mastery got 46 fields wrong
  because a cache was keyed on `id(member_bytes)`: on the 2-vCPU VM one process solved several sets in turn, a freed
  object's address came back as the next set's member, and that set read the previous set's facts. It never showed on
  12 local cores, where every set had its own process.
- **Preflight.** `bin/preflight.sh` runs about 78 checks in 11 sections at the warm-up: a duplicate VPN client, clock
  skew over 3 s, memory, Claude login and token expiry, every lane tool working *inside* the worker sandbox, Homebase
  toolchain and credits, no other harness busy on the host, solver directories missing `solve.py`, and the fault
  suite. After the drop, nothing is checked; the launch just goes.

The "sub-2-minute" plan written on day 17 found that every day over 2:00 had one of two causes: a generalize on the
critical path, or a harness bug new that day. The fixes always landed a day late. Replays and the fault suite turned
"tomorrow's bug" into last night's red test.

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

## Experiments

Everything below was measured, mostly with A/B replays on the fake GM or on the next live day. Roughly half of it
was kept.

| idea | what we tried | measured | kept? |
|---|---|---|---|
| More reasoning effort | `xhigh` on every lane (day 6), then an A/B against `high` (day 15) | turns ~50% slower (script 10.9 s vs 7.2 s); the A/B gap was the environment, not the effort | no: `high` everywhere |
| Medium-effort racers on singles | best-of-N duel workers at medium | won 3 of 3 singles on day 16 | until day 26 (see next row) |
| Model diversity | a Sonnet 5.5 racer in single-solve duels | 0 first-CORRECTs in 41 launches; a third of all claude processes at the drop | no: single duels off (day 26) |
| Subagents for script workers | script worker spawning helpers | 158 s vs 302 s on two replays: too noisy to trust | no |
| Fast mode | A/B on ten singles | 27-35% faster, no correctness loss, but billed as paid usage | no (cost) |
| Hand-built lane parsers | per-lane deterministic parsers in `lib/lanes/` | 100% offline on days 1-6 | no: reverted the same morning (LLM-first) |
| Reuse race | prior solvers race the LLM on every single | backtest days 2-11: no wrong answers. Live days 12-16: mobile 5/5, script 3/5, binary 2/5, warmups 2/5, metadata 0/5 | yes: the core of single-solve speed |
| Warm workers | launch `claude` before the bytes arrive | `READY` in 3 s, but the go-text is only ready at +8-25 s anyway | kept, pre-drop launch not built |
| Fork-per-solve zygotes | warm solver daemon on Homebase | solve 130-180 ms → 20 ms; warmups Time Trial 627 → 411 ms | yes, later used less |
| Bedrock shadow workers | LLM workers on Homebase, next to the GM | the day's credits were gone ~30 minutes after power-on | no: opt-in only |
| Stop at CORRECT | kill the worker at the GM's CORRECT, hand off a snapshot | 60% of worker time had been after CORRECT | yes |
| Codec-family probe | probe a variant's encoding family before the timed attempt | script Time Trial and Mastery passed first try; 14/15 by T+2:19 in rehearsal | yes |
| Answer-first worker | a medium worker answering only the leftover fields from the bytes | CORRECT in 8.0 s with 2 tool calls, vs 74 s plus a 49 s duel | yes |
| Drop the pre-Mastery speed gate on web | race it instead of blocking on it | Time Trial → Mastery per web chain 5:20 → 3:29 | yes |
| Race-first handoff | timed modes start from the race's verified solver | day 24 replays: 2:43 → 2:08 → 1:30; binary Mastery 163 → 90 s | yes |
| MSS-clamping SSH proxy | work around the MTU blackhole without root | cold SSH 3.0 s, vs a failure at 15.9 s | yes |
| In-network GM relay | measured routing per call | status p50 0.42 s vs 1.40 s; but a 9.5 MB start took 59.6 s vs 1.75 s on the GM | yes, small calls only |
| Homebase for big downloads | pull 36 MB on the VM instead of at home | 22.5 s on the VM vs 5.0 s at home, off-peak | no: premise was wrong |
| Parallel HTTP Range downloads | split big artifacts | the GM ignores `Range` | no-op |
| Parallel submits per Mastery set | submit sets concurrently | the GM serializes submits | no |
| Parallel group-test bisection | find wrong fields in waves instead of one by one | 55 sequential probes (~4 min) → waves; 12 judged at once in 3.3 s vs 1.9 s for one | yes |
| Joint decoding in `lib.decode` | search codec layers jointly, not per blob | 751 s → 16.5 s; a 1,139-blob corpus 38 min → 8.5 s, identical output | yes |
| Turn off Bash edit-diff | Claude Code's per-call snapshot on a 3 GB repo | 10-25 s per write-ish shell call → ~0.5 s | yes |
| Narrow live answers to the residual | tell the live worker only the unresolved fields | 57 s vs 47 s: the cost is deriving the set, not the field count | kept, neutral |

What the losses had in common:

- **More of the same lost to variance.** More effort, more parallel subagents and more racers each made the
  median slower or the host busier. None of them made the hard field easier.
- **The host was the bottleneck more often than the model.** Day 16 ran out of memory (~57 processes at ~195 MB);
  day 26 hit a load of 28 on 12 cores during the drop.
- **Measure, then route.** Homebase was a clear win while timed modes had a clock of a few seconds. From mid-month
  the GM ran timed modes untimed by default, and the same VM became a slow path for big replies. Machinery built for
  the clock (speed gates, pre-Mastery hardening) kept firing after the clock was gone.
- **Measure the measurement.** The KPI first counted a solve at our own `result` line instead of the GM's CORRECT,
  which made day 20 look 17 s slower than it was. An "+11 s release lag" was a regex bug; the real lag was 2.6 s.

## How the harness evolved

{{< hctf2026 "commits" >}}

| phase | dates | what landed |
|---|---|---|
| Bootstrap | Oct 3-5 | GM client, timed runner, orchestrator, Homebase timed attempts, transactional generalize, ATT&CK guard |
| Correct and safe | Oct 6-8 | worker sandbox, fake GM, test-gated ratchet, stop at CORRECT, technique logs, variant probes, toolchain detection. 113 commits in one week |
| Speed and determinism | Oct 9-18 | warm Homebase daemon, reuse race, untimed fallback, prebuild, duels and the coordinator, `hctf train`, parallel bisection, the process governor, fault injection, KPIs, answer-first, the drift watcher |
| Web and the whole board | Oct 19-25 | web lane end to end, parallel web targets, host exclusivity, web plugins, the rate governor, the GM relay with measured routing, race-first handoff |
| Killing the tail | Oct 26-31 | the in-network race, the no-LLM library racer, parallel live answers, big-reply routing, final-drop fixes |

| date | `hctf/` lines | `lib/` lines | test suites (lines) |
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
- **Harness:** 339 commits on 20 branches from Oct 3 to Oct 31. About 32k lines of orchestrator (`hctf/`), 195k lines
  of library (`lib/`, much of it generated codecs and decoders), 78 test files and 11 agent skills.
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
