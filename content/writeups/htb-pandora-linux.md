---
title: "HackTheBox — Pandora (Linux, Easy)"
date: 2022-03-22
category: "linux"
tags: ["htb", "snmp", "cms", "sqli", "privesc", "suid"]
summary: "HackTheBox Pandora: SNMP credential leak → PandoraFMS unauthenticated SQLi to RCE → SUID binary path hijacking for root."
source: "research"
draft: false
---

Pandora was an easy-rated Linux machine on HackTheBox which highlights the importance of proper enumeration, exploitation of PandoraFMS, and some straightforward privesc techniques. 

## Reconnaissance

Performing the routine nmap TCP scan didn't reveal much information about the target box aside from the usual ssh and http ports:

![](https://i.imgur.com/t42LuST.png)

The web page contains a working `Send us a Message` form but doesn't really do anything. We see the `panda.htb` domain on the support emails provided, so we added its entry in `/etc/hosts`.

![](https://i.imgur.com/kTR7RVF.png)

I then proceeded to fuzz the web server for additional files and directories + tried to find valid vhosts and subdomains but got nothing in the end. So I decided to perform another round of nmap, but this time focusing on UDP:

![](https://i.imgur.com/L1gtMNb.png)

## Enumerating SNMP

Interestingly enough, the SNMP port seems to be open. Simple Network Management Protocol (SNMP) is a protocol used to monitor different devices in a given network.

In order to enumerate the SNMP port, I used the following `snmpwalk` command (results truncated for readability of the important information only):

```shell
┌──(ctfvm㉿ctfvm)-[~/Desktop/htb-machines/linux-easy-pandora]
└─$ snmpwalk -v 1 -c public panda.htb                               
iso.3.6.1.2.1.1.1.0 = STRING: "Linux pandora 5.4.0-91-generic #102-Ubuntu SMP Fri Nov 5 16:31:28 UTC 2021 x86_64"
iso.3.6.1.2.1.1.2.0 = OID: iso.3.6.1.4.1.8072.3.2.10
iso.3.6.1.2.1.1.3.0 = Timeticks: (774064) 2:09:00.64
iso.3.6.1.2.1.1.4.0 = STRING: "Daniel"
iso.3.6.1.2.1.1.5.0 = STRING: "pandora"
iso.3.6.1.2.1.1.6.0 = STRING: "Mississippi"
iso.3.6.1.2.1.1.7.0 = INTEGER: 72
[...]
iso.3.6.1.2.1.25.4.2.1.5.822 = STRING: "-c sleep 30; /bin/bash -c '/usr/bin/host_check -u daniel -p HotelBabylon23'"
iso.3.6.1.2.1.25.4.2.1.5.825 = STRING: "/usr/bin/networkd-dispatcher --run-startup-triggers"
iso.3.6.1.2.1.25.4.2.1.5.826 = STRING: "-n -iNONE"
iso.3.6.1.2.1.25.4.2.1.5.829 = ""
iso.3.6.1.2.1.25.4.2.1.5.833 = ""
iso.3.6.1.2.1.25.4.2.1.5.834 = STRING: "-f"
iso.3.6.1.2.1.25.4.2.1.5.838 = STRING: "-LOw -u Debian-snmp -g Debian-snmp -I -smux mteTrigger mteTriggerConf -f -p /run/snmpd.pid"
iso.3.6.1.2.1.25.4.2.1.5.849 = STRING: "-k start"
iso.3.6.1.2.1.25.4.2.1.5.925 = ""
iso.3.6.1.2.1.25.4.2.1.5.940 = STRING: "--no-debug"
iso.3.6.1.2.1.25.4.2.1.5.946 = ""
iso.3.6.1.2.1.25.4.2.1.5.962 = STRING: "-o -p -- \\u --noclear tty1 linux"
iso.3.6.1.2.1.25.4.2.1.5.1040 = STRING: "-k start"
iso.3.6.1.2.1.25.4.2.1.5.1115 = STRING: "-u daniel -p HotelBabylon23"
```

## Initial foothold: uid=1001(daniel) 

![](https://i.imgur.com/idHOi4E.png)

Using the credentials retrieved from the `snmpwalk` results, we are able to ssh into the `daniel` account. Unfortunately, this is a low-privileged user so we conducted additional recon upon foothold. 

Doing a manual exploration of the filesystem, we were able to find some interesting stuff in the `/var/www/` directory:

![](https://i.imgur.com/nXLVfvl.png)

Reviewing the provided Dockerfile, we were able to retrieve the github link of the PandoraFMS which is being served. 

![](https://i.imgur.com/TZrkWUt.png)

We then continued to read some other files, such as `audit.log` which we learn that there may be 3 users 
Since we already have ssh access + knowledge of the pandora site being hosted locally through Docker, the approach that I thought of was port forwarding in order to access the site from my attacker machine. 

```shell
┌──(ctfvm㉿ctfvm)-[~/Desktop/htb-machines/linux-easy-pandora]
└─$ ssh -L 80:localhost:80 daniel@pandora.htb
```

## PandoraFMS Exploitation

Navigating to `http://localhost` now leads us to the pandora console. 

![](https://i.imgur.com/kDEKwmF.png)

After researching for existing exploits, I was able to find the following advisory/writeup + poc:

> https://blog.sonarsource.com/pandora-fms-742-critical-code-vulnerabilities-explained
> https://github.com/ibnuuby/CVE-2021-32099

The exploitation path which leads to RCE is quite simple: using the unauthenticated SQL injection we can retrieve admin session ids from the tsessions_php table so that we can access the console as an admin user -> we can then proceed to upload an evil extension which contains a php reverse shell for profit. 

![](https://i.imgur.com/HgQYFk0.gif)


## PrivEsc, part 1: Restricted?

After upgrading to a more stable shell, the first thing I usually do after getting user privs + user.txt is to check whether we can sudo execute something as some other user:

![](https://i.imgur.com/bOk0tpH.png)

But something seems off with the error message -> at this point, I'm assuming that we're under a restricted environment so we fire up LinPeas.

![](https://i.imgur.com/nqgPaeJ.png)

^ says that the machine is vulnerable to PwnKit, but we don't have gcc so that's a no go. We have the following SUID binaries:

![](https://i.imgur.com/CpWd6Ip.png)

We're mostly interested in two of them:
- `/usr/bin/at`: the gtfobins entry of the binary states that we can use it to break out from restricted environments;
- `pandora_backup`: maybe a custom binary, needs to be analyzed

By simply entering the following command, we can escape the restricted environment and continue the privesc process:

```shell
echo "/bin/sh <$(tty) >$(tty) 2>$(tty)" | at now; tail -f /dev/null
```

![](https://i.imgur.com/pBuT3Hq.png)


## PrivEsc, part 2: Path Hijacking

Here, we continue to analyze the `pandora_backup` SUID binary. Loading it in ghidra reveals the decompiled source which is quite straightforward:

![](https://i.imgur.com/JkB2KBk.png)

Initially, we become interested with line 14 since it calls `tar` without specifying the full path of the binary -> thus we can try to perform a path hijacking attack. 

Further analyzing the earlier lines (8-11) we see that the call to `setreuid` is dangerous. Even though we execute `pandora_backup` as matt, the effective user id is that of the file owner root (because the setuid bit is set). Then, geteuid() will return 0, which is the user ID of root. Calling `setreuid` with this argument will give the program root privileges.

![](https://i.imgur.com/hFJvN38.png)

## References used:
> https://onestepcode.com/command-injection-example/?utm_source=rss&utm_medium=rss&utm_campaign=command-injection-example
> 
> https://www.hackingarticles.in/linux-privilege-escalation-using-path-variable/
