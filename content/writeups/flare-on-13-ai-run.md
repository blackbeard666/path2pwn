---
title: "Driving Claude Code through FLARE-On 13: nine flags, two restarts"
date: 2026-11-01
category: "ai"
tags: ["ctf", "ai", "agents", "flare-on", "re", "malware", "wasm", "dotnet"]
summary: "One person, one Claude Code window and a folder of tools against the nine FLARE-On 13 reversing challenges. All nine flags, about 59 hours from the first prompt to the last flag, and two first attempts that failed for hours before a fresh session solved each in under an hour. The prompts, the models, the cost, what went wrong, what I'd change, and how each of the nine challenges works, with a flowchart per solve."
source: "ctf"
draft: false
---

> **This post was written by AI.** Claude (Opus 5.5, in Claude Code) drafted it from the run report, write-ups,
> solver scripts and session metrics in the public repo; I directed it, chose what to disclose and reviewed it. The
> numbers come from that data, not memory. The solves were done the same way: I prompted, Claude reversed.
>
> **The repo is public:** [blackbeard666/flareon-13-2026-ai-writeups](https://github.com/blackbeard666/flareon-13-2026-ai-writeups).
> It has every solver script, the per-challenge write-ups and the raw session metrics. File names below link to it.

{{< fo13 "tiles" >}}

## The event

[FLARE-On](https://flare-on.com) is the FLARE team's yearly reverse-engineering challenge. The 13th edition had
nine challenges, unlocked one at a time: solving one opens the next. Each ships as a 7-Zip archive with the password
`flare`, and every flag is an email address ending in `@flare-on.com`. The scoreboard records when each player
solves each challenge, which turned out to matter (see [the crux restart](#the-two-restarts)).

This year's set, in order:

| # | challenge | what it turned out to be |
|---|---|---|
| 1 | flarecaptcha | an HTML CAPTCHA whose answer is the fear of the number 13 |
| 2 | GhostStream | a WIM with alternate data streams, a parent and child talking over a named pipe, a modified RC4 |
| 3 | flareon13.doc | one file that is six formats; the flag is at the end of a CD image → UDF → Mach-O trail |
| 4 | ToxicMiner | a trojanized CPU miner that keys RC4 off the volume serial |
| 5 | catthief | a Rust implant that exfiltrates files with its own Huffman coder, plus the pcap of it doing so |
| 6 | ThreatInvaders | a .NET 10 Space Invaders whose *runtime* is modified to leak data through telemetry |
| 7 | FlareCalc | a calculator with an implant hidden inside its own code-signing certificate |
| 8 | crux | a browser extension running a garbled Go WASM that checks a primality certificate |
| 9 | NeonOutRun | a Rust/Tauri racing game whose V8 builtins are hooked; the flag is 28 lap times |

My run started on **September 27 at 13:12 UTC** (21:12 in Manila) and the last flag was accepted on **September 30
at 00:15 UTC**.

## How I played it

The setup was deliberately simple: **one person, one Claude Code window on Windows 11, and a folder of tools**: Ghidra 12.1.2, Frida 16.5.9, Python with capstone, unicorn, pefile, z3 and pycryptodome, Node 24, and WSL
Ubuntu with WSLg for the one Linux binary. The model installed or built anything else it needed.

{{< fo13 "fl-loop" >}}

The loop was simple:

1. **I pasted a kickoff prompt**: the archive's path, where the tools were, and the challenge text.
2. **Claude worked.** It extracted the archive, ran Ghidra headless, wrote a Python or C script for each idea,
   emulated pieces of the sample, hooked it with Frida, and so on. A typical solve left dozens of scripts behind;
   crux's first attempt left 458 files.
3. **I watched and steered.** Most of my messages were short: "continue", "proceed with the challenge", "go ahead".
   The important ones were corrections: there is no live server, the brute force isn't the intended path, the victory
   screen is a dummy.
4. **I submitted the flag it printed.** The scoreboard was the only judge. One flag was rejected.
5. **When a session went wrong for long enough, I started a fresh one.** That happened twice, and both fresh
   sessions solved their challenge within an hour.

Challenges 1 to 7 and the first crux attempt all ran in **one long session**, across several automatic context
compactions. After each solve I asked for a write-up and a commit, so the repo is a step-by-step record.

## The run, start to finish

{{< fo13 "timeline" >}}

**The first two hours: four flags.** Challenges 1 to 4 took 24 seconds, 8 minutes, 15 minutes and 79 minutes. The
first was a pun: the CAPTCHA wants *triskaidekaphobia*. GhostStream and the polyglot .doc each needed a few dozen
tool calls. ToxicMiner was the first real brute force (a 2³² sweep of volume serials). It was also where I switched
the session from Opus 5.5 to Opus 4.8 (see [the models](#the-models)).

**The long middle: three flags in 19 hours.** catthief (8.9 h), ThreatInvaders (~6 h) and FlareCalc (~4 h) were real
malware-analysis work, and each needed something unusual. catthief needed Frida to turn the implant into an oracle
for its own compression format. ThreatInvaders needed a custom EventPipe client to read JIT-compiled code out of a
modified .NET runtime. FlareCalc needed a C brute force over 2³² packer seeds with "does this disassemble cleanly?"
as the test. All three were solved, but this stretch is where the cost went up: these three plus crux attempt 1 are
86% of the run's total spend.

**The walls: crux and NeonOutRun.** crux's first attempt ran about 24 hours, made 1,590 tool calls and cost $483
before I abandoned it. NeonOutRun's first attempt ran about 13 hours and submitted a decoy flag. Both are covered in
[the two restarts](#the-two-restarts).

**The restarts.** A fresh session solved crux in 19 minutes for $3.26, and another solved NeonOutRun in 50 minutes
for $4.17.

## Results

{{< fo13 "results" >}}

All nine flags were recovered **offline**, from the shipped files alone. No challenge needed a live server, though
I had to say so twice during ThreatInvaders.

## The models

| model | used for | turns |
|---|---|---:|
| **Opus 5.5** | challenges 1-3, the start of 4 and of NeonOutRun attempt 1, and both restarts | 547 |
| **Opus 4.8** | the rest of 4, all of 5-7, crux attempt 1, most of NeonOutRun attempt 1 | 3,605 |
| **Fable 5** | a six-turn review of crux attempt 1 | 6 |

Some model choices were mine and some just happened:

- **Opus 5.5 to Opus 4.8 during ToxicMiner.** Five minutes in, the session paused and I typed "continue executing";
  six minutes later, "i'm giving you authorization to continue". Two minutes after that I switched to Opus 4.8 with
  `/model` and said "continue with solving challenge 4". I didn't write down why it paused, and the surviving
  data doesn't say. The session stayed on Opus 4.8 through crux attempt 1.
- **A subagent was killed by a safeguard.** During catthief, a subagent sent to reverse the Huffman code was stopped
  by the platform's `[cyber]` safeguard. The main session did that work itself.
- **Fable 5 for a second opinion.** Late in crux attempt 1, I switched to Fable 5 and asked it to "review the
  progress for this flare-on challenge and recommend next steps". It ran six turns; the attempt still didn't solve.
- **Both restarts ran on Opus 5.5 alone.**

The pattern in the numbers: **every attempt that ran entirely on Opus 5.5 solved its challenge, and none cost more
than $11** (five attempts, $24.98 together). The long Opus 4.8 sessions are where the money went. The two models
didn't get the same challenges, so this isn't a fair comparison. The 4.8 sessions got the hard middle of the set, and
they were also much longer sessions. Session length turned out to matter more than anything else (see
[cost](#cost-and-tokens)).

## How I steered

I typed **42 messages** across the 11 attempts. Most were one line. They fall into a few groups:

- **Kickoffs.** The first five were casual ("challenge 4 is in downloads too"). Both restarts used one structured
  prompt that set a role, named the archive and the tools, pasted the full challenge text and restricted the work to
  one directory. For crux it was a `/goal`; for NeonOutRun it also asked the model to adopt the methodology from
  [mahaloz/ilio-mini's skills](https://github.com/mahaloz/ilio-mini/tree/main/skills).
- **Nudges.** "continue", "Keep pushing", "go ahead", "proceed with the challenge".
- **Corrections of a wrong premise.** These mattered most:
  - ThreatInvaders, twice: "nope no server details are provided. all information needed is contained within the 7z
    file".
  - crux: "i think the bruteforce is not necessary, this was solved within 1 hour by other participants".
  - crux, after reading the scoreboard: the top player solved FlareCalc at 8:54:19 and crux at 9:04:11. "so there
    must be something here that has been missed -- i mean it only took 10 minutes".
  - NeonOutRun, after the rejected flag: "the victory screen should start another level, not display the flag", and
    later "reanalyze the note on the challenge description".
- **Method.** "try emulating first", "spin up sub-agents for analysis help where needed … avoid rabbit holes like
  last time", "go ahead with the static disassembly", "proceed in parallel for the full state tracer".
- **Housekeeping.** Write-ups, stats, commits, and the request that produced the run report this post is built on.

Every message is below, verbatim, in time order (UTC). Session events like compactions and model switches are in
italics.

<details class="hc-tv">
<summary>Every prompt I typed, by attempt (42 messages)</summary>

**1 flarecaptcha** (09/27 13:12)

```text
hey, let's start solving some flareon 13 challs. all related files are located in this directory. tools can be found in @~/Desktop/tools/ . here's the prompt for this first challenge:

Hello and welcome to the FLARE-On 13. This first stage challenge is designed to be easy to solve by a human or a robot, assuming the robot is as smart as a human. Are you as smart as a human? How many AI tokens are you going to burn to find out the answer to that question?

This challenge is distributed as a password protected 7-zip file. The password for the archive is "flare" without the quotes. That is a five digit password and the number of digits required to open the archive is five. Enter these five digits into your 7-zip extractor program, not as the flag to this challenge. You need to extract this archive, solve the challenge, and then enter that email-address formatted flag into the flag field below. All FLARE-On flags end with @flare-on.com.
```

**2 GhostStream** (09/27 13:15)

```text
nice. the second challenge is already at @~/Downloads/2-GhostStream.7z . make a directory outside of our current one so that we keep each challenge seperate. here's the prompt:

Passing the baseline test was clearly a statistical fluke, so we've locked you in with a haunted executable and a botched vial of PolyjuicePotion.txt. It refuses to talk to the naked eye, and you aren't getting your nutrient paste until your debugger forces a confession out of it.

7-zip Password: flare
```

**3 flareon13.doc** (09/27 13:24)

```text
challenge 3 is in downloads is in @~/Downloads/3-flareon13_doc.7z . here's the prompt:

As part of our testing protocols, we need to assess your level of stress when examining a simple document file. We can then contrast these results with how well you did with executables to determine your coefficient of incompetence.

7-zip password: flare
```

**4 ToxicMiner**

- 09/27 13:41

  ```text
  challenge 4 is in downloads too ( @~/Downloads/4-ToxicMiner.7z ) . prompt is: You may have noticed the ambient temperature in your room rising rapidly, which is entirely intentional and definitely not a life-support failure of the reality simulator. We've chained your terminal to a rogue CPU miner that has zero interest in the blockchain and every interest in turning your processor into weapons-grade slag. Dissect the binary before you bake alive, or at least generate enough hash rate to pay off the electricity bill for your captivity.

  7-zip password: flare
  ```
- 09/27 13:46: `continue executing`
- 09/27 13:52: `i'm giving you authorization to continue.`
- *09/27 13:54: /model (switched to Opus 4.8)*
- 09/27 13:54: `continue with solving challenge 4`

**5 catthief**

- 09/27 15:00

  ```text
  challenge 5 is in downloads too ( @~/Downloads/5-catthief.7z ). challenge prompt is:

  One of our stray laboratory felines just pilfered classified contraband from the server room, and since you're already strapped to the examination chair, we're pinning it on you. We've tossed the culprit's executable and a network packet capture into your enclosure so you can reconstruct the heist for the warden. Recover what the cat dragged out, and we might consider upgrading your daily nutrient paste from "industrial gray" to "slightly less gray."

  7-zip password: flare
  ```
- *09/27 15:16: /model (model switched)*
- 09/27 15:16: `proceed with the challenge`
- 09/27 16:15: `Continue with solving the Flareon ctf challenge`
- *09/27 18:11: context compacted*
- 09/27 23:55 (after the flag; also the kickoff for challenge 6)

  ```text
  spin up subagents to create writeups/documentations of the previous challenges we have solved. and if possible, include a breakdown of how much tokens were spent on each challenge, what models/prompts were used, how much time it has taken, etc. additional instructions: also install the following if needed, prefer using these tools: capstone   unicorn   pefile   z3-solver   pycryptodome   numpy. download and review the documentation for new tools if needed. if possible, don't detonate samples but if it's really needed to solve the challenge then go ahead. when done solving the challenges, do a writeup, include diagrams, do a commit, prepare all the files needed to replicate the solution, etc.

  challenge 6 is at: @~/Downloads/6-ThreatInvaders.7z . challenge prompt is: You have been working very hard at this challenge, its time for a little break. How about a nice retro space-shooter to blow off some steam. Don't ask why it is over a hundred megabytes, there are sophisticated score-keeping algorithms that need to communicate with our official record keeping servers. Its all very legit. We have provided a pcap file with some communication to the high-score server so you can see what a real gamer looks like.

  7-zip password: flare
  ```

**6 ThreatInvaders**

- 09/28 00:54: `nope no server details are provided. all information needed is contained within the 7z file for the challenge.`
- 09/28 02:07: `nope the flag should be recoverable offline, there are no live servers to interact with. all information are already within the binary files and the pcap from a successful run of that binary (which includes the traffic it sent to the servers).`
- *09/28 02:40: context compacted*
- 09/28 03:37: `go ahead with the static disassembly`
- 09/28 04:29: `you don't need to produce the pcap, you just need to be able to analyze how the binary sent that traffic and how we can use that traffic to retrieve the data given our knowledge of how it was sent. proceed with the deep manual native RE via ghidra (located in @~/Desktop/tools/ )`
- 09/28 05:58: `yep go ahead`

**7 FlareCalc**

- 09/28 06:19: `push straight into challenge 7, spin up sub-agents for analysis help where needed and orchestrate accordingly in order to get a clearer plan to reverse engineer/solve the challenge and avoid rabbit holes like last time.`
- 09/28 06:56: `try emulating first, if we get no good progress proceed with A.`
- *09/28 07:01: context compacted*

**8 crux, attempt 1**

- 09/28 10:11

  ```text
  8th challenge is at @~/Downloads/8-crux.7z , make sure to reverse it properly -- no misses or chasing rabbit holes. here's the prompt:

  Since you haven't seen natural sunlight in weeks, we ask that you would install a shiny new browser extension on your terminal to keep your remaining few synapses firing. It only asks for one little input string to verify your worth, though our lab notes suggest the underlying code was compiled by someone who genuinely despises humanity. Satisfy its inscrutable standards to dispense your next ration pellet, or stare into the decompiler until the abyss stares back.

  7-zip password: flare
  ```
- 09/28 14:56: `continue`
- *09/28 15:02: context compacted*
- 09/28 22:05: `Keep pushing`
- 09/29 01:34: `i think the bruteforce is not necessary, this was solved within 1 hour by other participants so I think that isn't the solution (and it isn't feasible as well to wait for 3 hours)`
- *09/29 01:59: context compacted*
- 09/29 06:12: `we have 2 agents that have stopped can you check their status?`
- *09/29 07:28: /model (switched to Fable 5)*
- 09/29 07:28: `review the progress for this flare-on challenge and recommend next steps to solve it.`
- 09/29 07:35

  ```text
  there is no authoritative answer yet. i only based my observation from the scoreboard. the challenges are staggered -- meaning that the next challenge unlocks after you solved the previous level. looking at the top scorer, 7 - FlareCalc was solved at September 26th, 8:54:19 AM then it unlocks the 8th challenge which was then solved at September 26th, 9:04:11 AM . so there must be something here that has been missed -- i mean it only took 10 minutes for the challenge to be solved.
  ```
- 09/29 07:53: `question, is everything done statically? no need to actually run the extension?`
- 09/29 07:55: `core logic? are we sure that everything in the code is being executed dynamically and not just a specific subset?`
- 09/29 08:05: `proceed in parallel for the full state tracer`
- 09/29 08:35: the challenge prompt, pasted again

**8 crux, attempt 2**

- *09/29 10:02: /model (switched to Opus 5.5)*
- 09/29 10:05

  ```text
  /goal You will now be taking the role of an expert reverse-engineer participating in the Flare-On 13 2026 competition. Your goal is to solve the challenge ( @8-crux.7z ) and get the flag. Only work within this directory, but there are also some tools you can use at @~/Desktop/tools/ if needed. The challenge description given is as follows:

  Since you haven't seen natural sunlight in weeks, we ask that you would install a shiny new browser extension on your terminal to keep your remaining few synapses firing. It only asks for one little input string to verify your worth, though our lab notes suggest the underlying code was compiled by someone who genuinely despises humanity. Satisfy its inscrutable standards to dispense your next ration pellet, or stare into the decompiler until the abyss stares back.

  7-zip password: flare
  ```
- 09/29 10:26: `create a writeup for this challenge and also track our statistics, read the other writeups/files from the other directories in @~/Desktop/ctf/flareon13-2026/ to get an idea of what you should create`
- 09/29 10:30: `write up the solved mechanism and also include/update stats we have for this challenge`
- 09/29 10:32: `commit it, excluding the wasm and node_modules`
- 09/29 10:43: `what was the difference between both attempts, and why did attempt 2 get it way faster than attempt 1`

**9 NeonOutRun, attempt 1**

- *09/29 10:28: /model (model switched)*
- 09/29 10:30

  ```text
  /goal You will now be taking the role of an expert reverse-engineer participating in the Flare-On 13 2026 competition. Your goal is to solve the challenge (@~/Downloads/9-NeonOutRun.7z) and get the flag. Only work within this directory, but there are also some tools you can use at @~/Desktop/tools/ if needed. The challenge description given is as follows:

  Congratulations on surviving to the final phase of the experiment, where we've wired your central nervous system directly into a 28-lap synthwave racing simulator. You are welcome to drive to the finish line like an obedient little test monkey, though we both know the freedom promised at the end of the highway is a cruel statistical mirage. Rip apart the engine and bend the simulation's physics to your will, or spend the rest of your natural life doing laps in our neon hamster wheel.

  7-zip password: flare

  *note: upon completing this challenge, the "victory" screen will unlock as a hidden next stage dummy challenge.
  ```
- 09/29 12:18: `i want to see the victory screen`
- 09/29 12:40: `the flag is incorrect, meaning this is not the correct approach. the victory screen should start another level, not display the flag.`
- *09/29 16:17: context compacted*

**9 NeonOutRun, attempt 2**

- 09/29 23:25

  ```text
  try to analyze the methodology under the skills on this repo: https://github.com/mahaloz/ilio-mini/tree/main/skills . don't pull or make a local copy, just analyze the methodology for flare-on. then let's try to solve it against the challenge at @~/Downloads/9-NeonOutRun.7z . Tools can be located at @~/Desktop/tools/ . The challenge description is as follows:

  Congratulations on surviving to the final phase of the experiment, where we've wired your central nervous system directly into a 28-lap synthwave racing simulator. You are welcome to drive to the finish line like an obedient little test monkey, though we both know the freedom promised at the end of the highway is a cruel statistical mirage. Rip apart the engine and bend the simulation's physics to your will, or spend the rest of your natural life doing laps in our neon hamster wheel.

  7-zip password: flare

  *note: upon completing this challenge, the "victory" screen will unlock as a hidden next stage dummy challenge.
  ```
- 09/29 23:51: `that's not the correct flag. I submitted it to the ctf platform and it wasn't accepted. reanalyze the note on the challenge description.`
- 09/30 00:06: `go ahead`
- 09/30 00:12: `the new candidate flag is correct.`
- 09/30 00:14: `make a writeup and update stats, refer to the other documents in @~/Desktop/ctf/flareon13-2026/ to get an idea what is needed`

</details>

## The two restarts

{{< fo13 "retries" >}}

Both failures followed the same pattern. **The first attempt did most of the engineering, then committed to a wrong
model of one detail, and carried that model through compaction after compaction as if it were a fact.** The fresh
session didn't know the wrong model, traced concrete values instead, and was done within an hour.

### crux: one byte of grammar, one day

crux is a browser extension that runs a garbled Go WASM. Your input is base64, then AES-256-CBC, and the plaintext
must be a [Pratt primality certificate](#8-crux) for a hidden 256-bit prime. The
SHA-256 of the certificate bytes decrypts the flag.

Attempt 1 first went after two wrong models: it assumed the message had to be 32-47 bytes, and it treated the
verifier as an "S-expression arithmetic evaluator". Hours later it had the right model, but it had **encoded the
leaf for the prime 2 as a 14-byte node instead of the single byte `0x00`**. The verifier accepts both forms, so the
certificate passed and reached the final decryption, but its hash was different, so the key was wrong. The extra
form has a value field the verifier ignores, so the session concluded there were "216 free bytes" and went looking
for a SHA-256 preimage. That meant a brute force over the whole 4-byte space, about 50 hand-made value conventions,
and full state-coverage instrumentation. I pushed back twice: the brute force was unnecessary, and the top player
had solved crux 10 minutes after FlareCalc. It didn't help. Nineteen subagents and a Fable 5 review didn't get the
session out of its wrong model either.

Attempt 2 started cold on Opus 5.5 with a structured `/goal` prompt. It traced arguments and bigint values at every
call, built **the smallest valid input it could, the certificate for 3**, and watched the checker accept it and
compare it against the target prime. That gave it the prime and the canonical `0x00` leaf at once. sympy factored
the tree in about 7 seconds, and the unmodified WASM printed the flag. **$3.26, 19 minutes, 0.7% of attempt 1.**

### NeonOutRun: the gate that looked impossible

NeonOutRun is a Rust/Tauri game with an embedded V8. The game script's victory screen shows
`decode_this_system_to_win_it@f1are-on.com`. The challenge text has a note: *"upon completing this challenge, the
'victory' screen will unlock as a hidden next stage dummy challenge."*

Attempt 1 did the hard parts. It ran the game under WSLg, dumped its memory with gcore, recovered the packed game
script, and found all three Rust hooks on V8 builtins plus a byte patch that turns `f1are` into `flare`. Then it
read the `Math.min` hook's angle as independent of the lap time, so the gate (G1 = G2) looked unsatisfiable. It
called the gate the "statistical mirage" from the prompt and submitted the victory-screen string. **It was
rejected.** I told it the victory screen should start another level, not show the flag. The session went on for
another ten hours without finding the real check.

Attempt 2 began with the ilio-mini methodology (recon → find the check → cheapest solve → verify). It first trusted
attempt 1's memory note and **submitted the same decoy again**. After the second rejection I said "reanalyze the
note on the challenge description", and it traced the gate's data flow instead: who writes G1 and G2, and what each
operand depends on. The angle is K ± t, where t is the lap time, so sin = 1 fixes each lap time exactly. The 28 lap
times are the flag. **$4.17, 50 minutes, 3.8% of attempt 1.**

## The nine solves

How each challenge actually works and how the flag came out. In the flowcharts, **green** boxes are the challenge
(the files you're given, and the flag), **red** boxes are the steps that cracked it, and grey boxes are everything
else. Open "steps and files" under a chart for each step with a link to the script that does it. The flags are in
the clear; the event is over and the repo already publishes them. Every challenge reproduces offline from its
original archive (password `flare`);
[REPLICATION.md](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/writeups/REPLICATION.md)
has the commands, the toolchain versions and a sanity check for each.

### 1. flarecaptcha

**Flag** `triskaidekaphobia@flare-on.com` · **24 seconds**, Opus 5.5, $0.38, 4 tool calls

A single HTML file with an inline script: a "prove you're human" CAPTCHA that reveals the flag on the right answer.
The gate is themed on the event's number. The answer is the word for fear of the number 13, *triskaidekaphobia*,
and the success branch assembles it into the flag. Four tool calls, two of them 7-Zip.

### 2. GhostStream

**Flag** `y0u_kn0w_n07h1n6_j0n_5n0w@flare-on.com` · **8.3 minutes**, Opus 5.5, $6.66, 43 tool calls

{{< fo13 "fl-c2" >}}

**What it is.** A Windows Imaging (WIM) archive holding a parent executable and a `PolyjuicePotion.txt` whose
interesting part lives in an NTFS alternate data stream (`:LordVoldemort`). A plain extraction drops the stream;
`7z x -sns` keeps it. The parent drops a child, `Partner_CTF.exe`, into `%TEMP%`, and sends it a key over the named
pipe `\\.\pipe\FlareChallenge`.

**The obfuscation.** Strings are encrypted with a multi-mode scheme: the byte-sum of each blob picks the operation
(`-k`, `(+1)^k`, `-2+k`, …) and a key byte comes from the module name.
[dec.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/2-ghoststream/dec.py) reproduces the
table.

**The cipher.** The child emits the flag through a modified RC4: a standard key schedule, but the PRGA steps
`i += 18` instead of `i += 1`, and each keystream byte is XORed again with a transformed string and a fixed 38-byte
table.

**The key.** The parent reads `AlbusDumbledore` from the stream and transforms it before sending it. The model's
first move was to guess the transformed key from static strings (the potion text, window message variants, the name
with and without a trailing space). None worked. So it patched the parent's two checks, launched it with a
redirected `%TEMP%`, and read the pipe itself:
[sniff.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/2-ghoststream/sniff.py) prints
`PIPE: b'HarryPotter'`. Keying the modified RC4 with it gives the flag.

### 3. flareon13.doc

**Flag** `Ju$7_4_l177l3_7r34$ur3_HUN7@flare-on.com` · **14.5 minutes**, Opus 5.5, $10.51, 55 tool calls

{{< fo13 "fl-c3" >}}

**What it is.** A file that is several formats at once: a DOS COM program, a raw-mode CD image, a ZIP using the
obsolete *Reduce* compression, a PDF, and a carrier for a Mach-O. The flag ("Just a little treasure hunt") is the
punchline.

**The path that matters.** The `.doc` is a raw CD image with 2,352-byte sectors. Joining each sector's 2,048-byte
data block gives an ISO whose UDF file system holds `click_me`, a fat Mach-O with arm64 slices
([carve.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/3-doc/carve.py)). Run 7-Zip
straight on the `.doc` and you get a *different* Mach-O, a decoy.

**The final crypto.** The Mach-O holds six themed fragments, each checked against an MD5 stored as nibbles in the
binary: an EICAR-style test string, `mainframe_ebcdic_ghost`, `jbig2_fax_geometry`, `udf_tagged_descriptor`,
`reduce_not_deflate` and `Ød1n_373rn4l_fl4r3`. The RC4 key is the XOR of the six SHA-256 digests, and a standard
RC4 decrypts the embedded ciphertext
([final.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/3-doc/final.py)).

**The side trails.** The model chased every layer: a unicorn emulation of the 16-bit COM stage hooking `int 21h`,
a hand-written PKWARE Reduce decompressor (Python's zlib can't do Reduce), and a PDF object decoder. None of them are
needed for the flag, but their fragment names (`reduce_not_deflate`, `udf_tagged_descriptor`) are the key material,
so the trail wasn't wasted: it explains where each fragment comes from.

### 4. ToxicMiner

**Flag** `cpu_m3lt3d_4nd_all_i_g0t_w4s_th1s_fl4g@flare-on.com` · **78.6 minutes**, Opus 5.5 → Opus 4.8, $31.68,
47 tool calls

{{< fo13 "fl-c4" >}}

**What it is.** A trojanized build of `cpuminer-multi`. Almost all of it is a real miner; one hidden routine reads
the C: volume serial and prints `Accepted: <flag>` only on the intended machine.

**The key derivation.** A double SHA-256 over 32-bit word arrays, with no input byte-swap, seeded by the serial and
the constant `0x0b501e7e`:

```text
round 1: W = { serial, 0x0b501e7e, 0x80000000, 0 …, 0x40 }   → H1
round 2: W = { H1[0..7], 0x80000000, 0 …, 0x100 }           → H2
key     = little-endian bytes of H2[0..3]                    (16-byte RC4 key)
```

RC4 then decrypts a 0x33-byte blob.

**Why the clean rewrite failed.** A volume serial is 32 bits, so the whole space can be swept. The first solver,
[recover.c](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/4-toxicminer/recover.c), is a
from-scratch SHA-256d + RC4 in C, and it never finds the flag, because the sample's SHA-256 is modified. The fix was
to stop re-implementing it. [make_image.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/4-toxicminer/make_image.py)
maps the PE into a flat image (straight from the archive, so the sample never touches disk), and
[harness.c](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/4-toxicminer/harness.c) loads it at
its preferred base `0x140000000` and calls the binary's own key and RC4 functions as function pointers. The sweep,
sharded across ranges, finds one serial: **`0x01CEC01D`** ("ICE COLD").

This is also where the session moved from Opus 5.5 to Opus 4.8 (see [the models](#the-models)).

### 5. catthief

**Flag** `th3r3_b3_tr34sure_1n_th4t_pc4p@flare-on.com` · **8.9 hours** (first session), Opus 4.8, $272, 268 tool
calls

{{< fo13 "fl-c5" >}}

**What it is.** A Rust implant (`ureq`, `rustls`, `ring`, `flate2` in its dependencies) and a capture of it sending
six `POST /exfil` requests. The implant reads a file, compresses it, encrypts it and posts it; each response carries
the next file to steal.

**The easy layer.** Standard RC4 with a 25-byte key decoded in the binary with `^0x33`:
`i11_b3_p1und3r1n_y3r_d474` ("I'll be plunderin' yer data"). The keystream restarts at 0 for every message, and
decrypting the *responses* gives clean Windows paths, which confirms the key.

**The hard layer.** The compression isn't `flate2`: the implant ships its own `compress.rs`. After RC4 each message
is:

| bytes | meaning |
|---|---|
| `0` | magic `0x20` |
| `1..262` | one big-endian integer; shifted right by 5, its base-256 digits are the 256 code lengths |
| from bit 2,091 | the Huffman bitstream, read MSB-first, with standard canonical codes |

The `>> 5` scaling and the bitstream starting at a bit offset that isn't byte-aligned were the two blockers, and
reading the decompiled code didn't settle either. What settled them was **turning the implant into an oracle**:
under Frida, `connect` was redirected to a local server and `CreateFileW` to probe files with known byte counts (for
example, eight byte values in equal numbers, which must all get 3-bit codes). Reading back the output showed the
codes are plain canonical and pinned the data start. The Kraft sum of every real table comes out to exactly 1, a
good check that the length table is parsed right.

Along the way a subagent sent to reverse the Huffman code was stopped by the platform's cyber safeguard, and the main
session finished the work inline. To avoid Defender, samples were extracted to memory (`7z e -so`) and a DOS-stub
byte was patched before any detonation.

**The loot.** Five JPEGs of pirate cats, 2816×1536. The flag is painted on a scroll on the treasure chest in
`catcatcat.jpg`. [solve5.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/5-catthief/solve5.py)
rebuilds them from the pcap alone.

### 6. ThreatInvaders

**Flag** `wh4t_4_l0ng_str4ng3_tr1p_1ts_b33n@flare-on.com` · **~6.1 hours** (estimated), Opus 4.8, $145, 422 tool
calls

{{< fo13 "fl-c6" >}}

**What it is.** A 116 MB .NET 10 self-contained Space Invaders, plus a pcap of it talking to a "high-score server".
The telemetry the managed code builds is `{request_id, session_id, games_played, client_version, feedback_b64,
feedback_length}`, and the IL caps `feedback_length` at 4,096.

**The contradiction.** The pcap shows `feedback_length` values of 0, 0, 8208, 16914 and 16430, with high-entropy
feedback. That's impossible under the IL. (Also, the telemetry POSTs are captured as large-send-offload frames whose
IP length field is 0, so reassembly has to read to the end of each frame.)

**Proving it's native.** Every managed assembly in the bundle is byte-identical to stock .NET 10.0.11. The native
CoreCLR is a custom static build that reports the fake version `42.42.42.42424`, and only about 8% of its code
matches stock. Static diffing was hopeless, so the model went dynamic: a custom EventPipe client
([eptrace](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/6-threatinvaders/ThreatInvaders/csharp/eptrace/Program.cs))
got the native addresses of JIT-compiled methods without a working DAC. Following `BuildDocument`'s call to
`EncodeFeedbackBuffer` lands not on the real method but on **injected code at RVA `0xC6BA0`**, one of several
detours a hook installer sets up at startup. Frida hooks confirmed the data flow live.

**What the detour does.** It runs a local `updater.exe`, XOR-encrypts its stdout with a keystream (an LCG with
multiplier `0x5851f42d4c957f2d`, top byte of the state), seeded by a splitmix64 variant of the machine's
**MachineGuid**, and streams it out through `feedback_b64`. The first beacon writes a 16-byte header:
`reverse(session_id bytes) XOR MachineGuid bytes`.

**Why the pcap is enough.** The session id is in the pcap in the clear, so the header gives the MachineGuid, the
MachineGuid gives the seed, and the seed gives the keystream. TEL#4 decrypts to the author's `dir` listing (with a
46-byte `flag.txt`) and TEL#5 to the flag.
[solve.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/6-threatinvaders/ThreatInvaders/solve.py)
needs only `challenge.pcapng`.

This is the challenge where I had to say twice that there was no live server, and once that it didn't need to
reproduce the pcap, only to understand how the binary produced it.

### 7. FlareCalc

**Flag** `t3mplat3s_asn_and_j1t_0h_my@flare-on.com` · **~4.2 hours** (estimated), Opus 4.8, $112, 441 tool calls

{{< fo13 "fl-c7" >}}

**What it is.** An obfuscated Windows calculator, 99% decoy. It has four easter-egg expressions: `525+193` gives
`FLAG{NICE_TRY}`, and `843*952` gives a rickroll sent to itself over `WM_COPYDATA`. The rickroll is useful anyway,
because it shows the primitives the real loader uses (APIs resolved by hash, threads, `WM_COPYDATA`).

**The hidden loader.** A function resolved entirely by API hash opens the calculator's own file, seeks to its
Authenticode signature, `VirtualAlloc`s it read-write-execute, reads the certificate in, and calls into it at offset
`0x6d3a`. The argument comes from three numbers on the calculator's stack.

**The implant in the certificate.** The certificate is a real PKCS#7 signature and an x64 module. A custom extension,
OID `1.3.6.1.4.1.1337.1`, holds a 1,035-entry map of `{key, blob}` records. Most blobs are decoys. The real stages
are packed by a small VM: `deinterleave(xor(blob, MD5-derived fold), PRNG(input))`, where the input string comes
from those three calculator numbers.

**Cracking it without the input:**

1. **The deinterleave seed** is a 32-bit hash of the input, so all 2³² seeds can be tried. The test: does the largest
   code blob linear-disassemble as valid x64? It was calibrated on the one plaintext blob (the loader), which
   decodes with zero invalid opcodes.
   [seedscan.c](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/7-flarecalc/seedscan.c) finds
   `1116755918`.
2. **Each blob's XOR fold** is a single byte. Real x64 code has a strong excess of bytes like `0x48` and `0x8b`, so
   the right fold stands out at about 10 sigma.
3. **The unpacked stages** are a bind-shell backdoor: socket handling, a sysinfo beacon, an OS-name lookup, cpuid
   and timing anti-VM gates, and two XTEA decryptors.
4. **The labyrinth.** The backdoor's `'3'` command reads bytes one at a time; each runs the current handler blob,
   which mutates a 32-byte key buffer and names the next blob. Only one byte per step keeps the chain on valid blob
   keys, so a depth-first search
   ([chain_dfs.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/7-flarecalc/chain_dfs.py))
   finds the unique 32-byte path, `FLAREON_ASN1_Labyrinth_Key_2026!`, ending at the XTEA blob.
5. **The flag.** [solve7.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/7-flarecalc/solve7.py)
   runs the sample's own XTEA blob under unicorn on the 40-byte ciphertext blob with the labyrinth's key buffer.

My two messages here were "spin up sub-agents … avoid rabbit holes like last time" and "try emulating first".

### 8. crux

**Flag** `Pr4tt_Pr1M4lItY_C3rt5_4nd_Wa4aA4aAA4aAA4a4a5M@flare-on.com` · attempt 1 abandoned after **~23.8 hours**
($483); attempt 2 solved in **18.7 minutes**, Opus 5.5, $3.26, 68 tool calls

{{< fo13 "fl-c8" >}}

**What it is.** A Chrome MV3 popup that loads a 5.8 MB Go WASM and calls `window.check(input)`. The WASM is
[garble](https://github.com/burrowers/garble)-obfuscated: names stripped, the pclntab magic randomized, string
literals garbled, control flow flattened. Go's stock `wasm_exec.js` runs it under Node with
`globalThis.window = globalThis`, which gives a local harness
([run.js](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/8-crux-attempt-2/ext/run.js)).

**Getting a foothold.** Standard tools choke on Go WASM's huge `br_table` state machines: `wasm2wat` wrote 1.8 GB,
`wasm-objdump -d` 1.9 GB, and `wasm-decompile` crashed. So the session built its own:

- [pcln.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/8-crux-attempt-2/work/pcln.py)
  finds the disguised pclntab (magic `0xa3c41c63` instead of `0xfffffff1`) and recovers the function names
  (garbled, but they survive: `main.Kd5oA2q`, an AES `Decrypt`, a CBC `CryptBlocks`, a base64 `DecodeString`, a
  SHA-256).
- [dec.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/8-crux-attempt-2/work/dec.py) is a
  flat Go-WASM decompiler that labels each state.
- [instr.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/8-crux-attempt-2/work/instr.py)
  splices entry and exit hooks into chosen functions. Adding an import would shift every function index, so the hook
  calls an import that already exists, `runtime.getRandomData`, with a tag and then `SP|1`. Real Go stack pointers
  are 8-aligned, so the JS side
  ([trace.js](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/8-crux-attempt-2/work/trace.js))
  can tell hook calls apart and log arguments, strings and bigints.

**What `check()` does.** Base64-decode, AES-256-CBC decrypt with a hardcoded key and IV, strip PKCS#7, hash the
plaintext with SHA-256, parse it as a tree, verify the tree as a **Pratt primality certificate**, require its root to
equal a hidden 256-bit prime N, and decrypt the flag with key material from the hash. The tree grammar:

```text
cert := 0x00                                  -- leaf: the prime 2, exactly one byte
      | 0x01 u32(n) n × (u32(len) cert)       -- certificates of the prime factors of A−1
             u32(len) A                       -- the prime, minimal little-endian bigint
             u32(len) B                       -- the witness (a primitive root)
```

The verifier requires children in non-decreasing order with multiplicity, their product to equal A−1, B to pass the
Lucas test, and, as I read a second loop, B to be the *smallest* primitive root. Bigints reject leading zero bytes.
Together that makes the certificate for a given prime **unique**, which is the point: the flag key is the hash of
those exact bytes.

**The shortcut.** A 20-byte certificate for 3 passes the verifier and reaches the comparison against N, which gives
N away:

```text
N   = 0xd389dfbb379a02ccda7a4ab0b327e8e3655a3c96447c1b5578bee179c930e261
N−1 = 2^5 · 1777 · 117013415621 · 14379885447462257985539844615548173977763374139182362877999463
```

From there [solve8.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/8-crux-attempt-2/solve8.py)
factors down the tree with sympy (50 primes, about 7 seconds), emits the canonical 3,891-byte certificate, wraps it
in AES and base64 (5,208 characters), and feeds it to the unmodified WASM, which takes 15-30 seconds of bigint math
and returns the flag.

**What went wrong the first time** is told in [the two restarts](#crux-one-byte-of-grammar-one-day): attempt 1's
leaf for 2 was a 14-byte `0x01` node instead of `0x00`, so its certificate was 6,699 bytes instead of 3,891 and
hashed to the wrong key. The lesson the session wrote for itself: **"passes the checker" isn't "canonical"**. When a
later step hashes the raw input, find the minimal encoding of every terminal, not just *an* accepted one. (Once
shown the `0x00` leaf, a continuation of attempt 1 reproduced the flag byte for byte.)

### 9. NeonOutRun

**Flag** `R3_ag3nt_4b0ut_t0_f33l_d1zzy@flare-on.com` · attempt 1 submitted a decoy after **~12.9 hours** ($110);
attempt 2 solved in **50 minutes**, Opus 5.5, $4.17, 79 tool calls

{{< fo13 "fl-c9" >}}

**What it is.** A stripped 21 MB x86-64 ELF: a Rust Tauri v2 racing game (webkitgtk front end) with an embedded V8
9.5 via `rusty_v8`. Twenty-eight laps. The challenge note says the "victory" screen is a dummy next stage.

**The game script.** The front end only draws. Each frame it calls `plugin:neon|e`, which runs a hidden 4 KB game
script inside the embedded V8. The script is packed (XOR, LZSS, zstd and raw deflate), so the quickest way to get it
was to run the game under WSLg, `gcore` it after about 12 seconds (a 15 GB core, thanks to V8's reservation) and grep
the heap for `carRatio` ([dump.sh](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/9-neonoutrun-attempt-2/dump.sh)).
The script's finish screen builds `decode_this_system_to_win_it@f1are-on.com` (with a digit one). It also calls
`Math.min(bestLapSeconds, lapSecs)` once per lap and otherwise ignores lap times, which is the hint that the host is
watching `Math.min`.

**The hooks.** The first lead was a unique `add byte ptr [rcx+0x1e], 0x3b` instruction: offset 0x1e is the `1` in
`f1are`, and `'1' + 0x3b = 'l'`. Its function reads two global doubles, G1 and G2, and their cross-references lead to
the other hooks. All three are control-flow-flattened, with constants built from bswap/rol/add chains.

| hook | what it does |
|---|---|
| `Array.sort` | scales the 28 lap splits by a random k, queues them (dqᵢ), sets G2 = Σdqᵢ, resets G1 |
| `Math.min` | takes the lap time in whole seconds as a **flag byte** t, then G1 += dqᵢ·sin((Kᵢ + sᵢ·t)°) |
| `String.replaceAll` | if G1 ≈ G2, copies the flag bytes over the decoy string, then fixes `f1are` to `flare` |

**Why the gate pins every lap.** G1 − G2 = Σ dqᵢ·(sin θᵢ − 1). Every term is ≤ 0 and the dqᵢ are random, so the
only way to get |G1 − G2| below 1e-6 is sin θᵢ = 1 on every lap:

```text
Kᵢ + sᵢ·tᵢ ≡ 90 (mod 360),   tᵢ ∈ [0, 255]
```

[emu.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/9-neonoutrun-attempt-2/emu.py) maps
the ELF into unicorn, applies relocations, and runs the obfuscated helpers to get 90, the degree constant 180, and
each lap's (Kᵢ, sᵢ). [solve2.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/9-neonoutrun-attempt-2/solve2.py)
solves the 28 congruences. Each has exactly one solution, all printable:

```text
82 51 95 97 103 51 110 116 95 52 98 48 117 116 95 116 48 95 102 51 51 108 95 100 49 122 122 121
R  3  _  a  g   3  n   t   _  4  b  0  u   t   _  t   0  _  f   3  3  l   _  d   1  z   z   y
```

So the "statistical mirage" is real but reachable: the winning run is 28 laps of 82 s, 51 s, 95 s and so on, each to
the second.

**What went wrong the first time** is told in [the two restarts](#neonoutrun-the-gate-that-looked-impossible):
attempt 1 got everything above except one dependency, the angle's dependence on the lap time. The note attempt 2 left
in its write-up: "when a gate looks impossible, check which inputs you assumed were constant."

Ghidra was started on this binary and abandoned; auto-analysis of a 21 MB Rust binary ran past 30 minutes, while
`.eh_frame` plus capstone gave function bounds immediately
([cdis.py](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/9-neonoutrun-attempt-2/cdis.py)).

## Where the AI went wrong

Apart from the two big failures, the write-ups record smaller ones, and they rhyme:

- **Believing what it could see.** FLARE-On 13 was full of decoys: the victory screen (9), `FLAG{NICE_TRY}` and a
  rickroll (7), a faithful managed game hiding a modified native runtime (6), a whole working CPU miner around one
  routine (4), and a decoy Mach-O you get by running 7-Zip straight on the .doc (3).
- **Assuming a live server.** In ThreatInvaders it kept looking for the high-score server until I said twice that
  the pcap was all there was.
- **Re-implementing instead of reusing.** ToxicMiner's SHA-256 is modified, so a clean C rewrite never found the
  serial. Calling the sample's own functions from a mapped image fixed it. FlareCalc ended the same way, running
  the sample's own XTEA under unicorn.
- **Declaring things impossible on one unchecked assumption.** NeonOutRun's "unsatisfiable" gate and crux's "free
  bytes" both rested on one assumption nobody re-checked.
- **Guessing instead of observing.** GhostStream's key guesses from static strings all missed; reading the real pipe
  message gave `HarryPotter` straight away. catthief's Huffman table layout was pinned down by feeding the implant
  known inputs, not by reasoning about the decompiled code.

None of these are reversing skill failures. Every one was fixed by observing a concrete value: a real pipe
message, a real certificate, a real operand.

## Cost and tokens

The cost figures are what the tokens would cost at Anthropic API list prices, per model and token type. They show
relative spend; they are not what was billed, since the run used a Claude subscription.

{{< fo13 "cost" >}}

{{< fo13 "split" >}}

**Cache reads are 59% of the bill.** Every turn re-reads the whole conversation from the prompt cache, so a long
session costs more per turn the longer it runs. crux attempt 1 made 1,587 model calls, and late in the session each
one re-read several hundred thousand tokens. That's the real argument for restarting: a fresh session is cheaper
per turn as well as free of the old session's wrong ideas.

{{< fo13 "tokens" >}}

{{< fo13 "prices" >}}

Two caveats. catthief's figures cover its first session only, because the solve finished in a follow-up session.
ThreatInvaders and FlareCalc weren't metered at the time, so their numbers come from the transcript window between
git commits, which also includes catthief's wrap-up and the first six write-ups.

## The tools it reached for

{{< fo13 "tools" >}}

Python was the main tool everywhere. Ghidra ran headless through small `DecompAll` / `DecompOne` scripts, and the
model grepped the C output. Beyond that, each challenge had its own specialist: Frida for catthief, ILSpy and a
custom EventPipe client for ThreatInvaders, Node (611 commands) for crux's WASM tracing, and WSL with gdb for
NeonOutRun. A lot of the run went into **building tools on the spot**: an image-mapping harness, Frida redirect
hooks, a flat Go-WASM decompiler (because `wasm2wat` wrote 1.8 GB), and a WSLg setup for a Linux GUI binary.

## Techniques that recurred

| technique | where | notes |
|---|---|---|
| **Ghidra headless** | 2, 3, 4, 5, 7, 9 | batch decompilation through small scripts, then grep over the C output |
| **Run the sample's own code** | 3, 4, 7, 9 | unicorn for a 16-bit COM stage, an XTEA blob and V8 helpers; a PE-mapping harness for a modified SHA |
| **RC4 variants and custom codecs** | 2, 3, 5, 7 | standard, `i += 18`-step, and reused-keystream RC4; a canonical Huffman, PKWARE Reduce, a deinterleaving packer |
| **The sample as an oracle** | 2, 5, 6 | read the real pipe message; feed catthief known inputs; Frida hooks on ThreatInvaders' cipher |
| **Hooked runtimes** | 6, 9 | a modified CoreCLR and Rust hooks on V8 builtins; in both, the visible IL or JS was the decoy |
| **2³² brute force in C** | 4, 7 | volume serials with the sample's own hash; packer seeds with a "disassembles cleanly" test |
| **WASM rewriting** | 8 | hooks spliced through an existing import, because adding one shifts every function index |
| **Memory dumps** | 9 | gcore a running WSLg process, grep the V8 heap for the decrypted script |
| **Smallest valid input** | 8 | the certificate for 3 gave away the target prime |

## Lessons for next year

What the data and the two failed attempts say to do differently. Each ends with one concrete change.

1. **Restart fresh instead of pushing a stuck session.** Both failed attempts ran for many hours through several
   compactions, and the summaries carried the wrong hypothesis forward as fact. Both restarts solved in under an
   hour, for 0.7% and 3.8% of the cost.
   **Adopt:** a stop-loss, for example 2 hours or $50 with no new verified fact. When it trips, write a handoff note
   that separates verified facts from open hypotheses, and start a new session from it.
2. **Build the smallest valid input before theorising.** crux attempt 2 made a certificate for 3 and watched the
   checker accept it. Attempt 1 had spent a day reasoning about the format in the abstract.
   **Adopt:** for any checker or crackme, get one known-good input through the real code early and trace actual
   values. When an input feeds a hash, make sure it is canonical.
3. **Treat the prompt text as a spec and expect decoys.** The NeonOutRun note said in plain words that the victory
   screen was a dummy.
   **Adopt:** before submitting, check the candidate against every line of the prompt. A flag shown on screen or
   sitting in plaintext is suspect until the real check is understood.
4. **Prove it before calling something impossible.** "Unsatisfiable" and "free bytes" each rested on one unchecked
   assumption.
   **Adopt:** before calling a check unsatisfiable or starting a brute force of 2³² or more, write down what each
   operand depends on, and have a subagent argue against the claim.
5. **Use outside signals as a sanity check.** The scoreboard said crux took the top player 10 minutes. A plan
   needing a day of work, or a 3-hour brute force, was probably on the wrong path.
   **Adopt:** look at the scoreboard's solve gaps first. If the plan needs far more work than the leaders' pace
   suggests, look for the shortcut.
6. **Assume the flag can be recovered offline.** Every flag this year came from the shipped files.
   **Adopt:** say "no live infrastructure; everything needed is in the archive" in the kickoff prompt. When there's
   a pcap, it's the ground truth to decrypt.
7. **Start every challenge with a structured prompt.** Both successful restarts began with one.
   **Adopt:** a reusable `/goal` template with the role, paths, full challenge text, the offline assumption, a
   detonation policy, the stop-loss, and a verify-before-submit step.
8. **Have the tooling ready before the event.** Too much of the run was spent building tools.
   **Adopt:** a tested kit: Ghidra batch decompile, unicorn and PE-mapping harness templates, Frida file and socket
   redirection, WASM instrumentation, a WSL/gdb/gcore profile, and a Defender-safe in-memory extraction step.
9. **Pick the model per phase and watch cache cost.** Opus 5.5-only attempts cost under $11 each; the long Opus 4.8
   sessions are 86% of the spend.
   **Adopt:** default to Opus 5.5 with short sessions, and give subagents narrow yes/no questions ("is operand X
   independent of the input?") instead of open-ended re-analysis.

## What I'd keep

The things that worked:

- **Write-up and commit after every solve.** It cost little, and it's the reason this post can quote exact prompts,
  times and tokens.
- **Solver scripts, not answers.** Every flag came out of a script that can be re-run from the original archive;
  [REPLICATION.md](https://github.com/blackbeard666/flareon-13-2026-ai-writeups/blob/HEAD/writeups/REPLICATION.md)
  walks through all nine.
- **Making the sample do the work.** Calling ToxicMiner's own hash, running FlareCalc's own XTEA, turning catthief
  into its own compression oracle: each removed a class of reimplementation bugs.
- **The fresh session.** Twice it turned a day of failure into under an hour of work.

The one thing I'd change is the thing the data shouts: **don't let a session run for a day.** Both restarts were
cheaper than the last hour of the attempt they replaced.

