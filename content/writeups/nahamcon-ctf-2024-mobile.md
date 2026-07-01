---
title: "Nahamcon CTF 2024 — Mobile Writeups"
date: 2024-05-24
category: "mobile"
tags: ["ctf", "android", "frida", "flutter", "godot", "re"]
description: "Speedrun of the mobile track at Nahamcon CTF 2024: logcat, strings, Godot script extraction, Flutter instrumentation, and Frida hooking."
draft: false
---
## Nahamcon CTF 2024 - Mobile Challenge Writeups
Helped clear the mobile board for ARESx, also blooded flyaway1 (the flutter pentests are paying off lmao). The mobile challs this year were pretty much simple reverse engineering tasks, here's how I speedran them:

### Kitty kitty bang bang, Easy - 50 (303 solves)
Someone else got to this earlier, but pretty much you just need to run the app on your device then watch the device logs -- you can do this by using logcat which is built-in with the Android Studio IDE or you can monitor them on the commandline via `adb logcat | grep <your-search-string`:
![image](/images/writeups/S1fK-zl4R.png)

### Guitar, Easy - 50 (335 solves)
Wouldn't be a nahamcon mobile challenge without the usual flag in strings challenge. When reversing an apk, or pretty much anything, always check the `strings.xml` resource file:
![image](/images/writeups/B1FwGzxVR.png)

### Buggy Jumper 1, Easy - 412 (134 solves)
Throw the apk into jadx, then review the AndroidManifest file (this should be the first file you check for when reversing android apps). We can see on the activity declarations that there are references to the [Godot game engine](https://godotengine.org/). Then next, review the other asset files -- this time we see an interesting flag.gdc file which seems to be obfuscated?
![image](/images/writeups/H1qy4fxER.png)

Since we have identified the framework used for the app and an initial point of interest, we can pass the apk into [gdsdecomp](https://github.com/bruvzg/gdsdecomp) in order to attempt getting back the decompiled gds scripts:
![image](/images/writeups/SkAlrfxEA.png)

### Buggy Jumper 2, Medium - 442 (109 solves)
We continue with the buggy jumper series, but this time we are tasked to buy the `drippy buggy` item from the shop. There are actually two ways to solve this. 

#### cheese
The results of the gdsdecomp tool we used earlier should produce a `global.gd` file which shows the logic on how the points are being stored. Specifically, we see in the following methods that the app performs read and write operations to save our points on `saved_value.dat`:
![image](/images/writeups/B154dzlEC.png)

It's always a good idea to perform static analysis properly on the source code you are able to obtain/decompile. Or you can just do dynamic analysis immediately > notice that your points are reflected on the mentioned file > since you have root access on the device (preferrably you should be using rooted devices/emulators) you can just edit the value to match the required points > restart the app and buy > flag. 
![image](/images/writeups/rJlCBtfgVA.png)

#### the slightly complicated way if you are bored
Going back to the `global.gd` file, we can see that the app communicates with a remote server
![image](/images/writeups/ByfnhfgVR.png)

First we need to call the register endpoint in order to have a valid authorization_token that we can use for the next requests. Interesting to note that the remote server checks for the user-agent:
![image](/images/writeups/BJcMaMlE0.png)

I'm too lazy to read docs, so gpt it is:
![image](/images/writeups/Hy8BTzx4R.png)

Seems like the server only checks for the presence of the godot engine header but does not really validate it:
![image](/images/writeups/HyXdaMe4R.png)

Now that we have an auth token, we can call the save endpoint to directly manipulate our score:
![image](/images/writeups/SJXs6GxNR.png)

```bash=
$ curl -X POST "http://209.38.153.254:8888/save" -A "MyGame/1.0 (Godot Engine 3.2.3) Android/Pixel3" -H "Content-Type: application/json" -H "Authorization: 31592d1d-19ee-4b44-88d7-891d84980c07" -d '{"value":73317331}'
{"message":"Value saved successfully."}
```

Then we check the `_on_Buy_Pressed` logic from the `shop.gd` file:
![image](/images/writeups/Syo8AzxVA.png)

And now we try to get the flag via:
```bash=
$ curl "http://209.38.153.254:8888/verify?value=73317331" -A "MyGame/1.0 (Godot Engine 3.2.3) Android/Pixel3" -H "Authorization: 31592d1d-19ee-4b44-88d7-891d84980c07"
{"message":"flag{a31e44ba4df9789ed5491dc43fa22de3}"}
```

### Fly Away! 1, Medium - 476 (71 solves)
The first part of this chall is straightforward. Some JADX work shows that the app is built with flutter as we can see it being referenced here on the AndroidManifest:
![image](/images/writeups/SkbwyXlNA.png)

And we can also confirm that flutter libraries are present on the resources. These are important to take note of, `libapp.so` usually contains the main logic of the app while `libflutter.so` is the flutter engine itself:
![image](/images/writeups/ry5OkQx40.png)

Flutter apps can be a pain to analyze, there's nothing much to statically review here since nothing is being hardcoded on the strings resource or anywhere else. So what I usually do is immediately patch the app using [`reFlutter`](https://github.com/Impact-I/reFlutter). Since we want to investigate if the app communicates with a backend server and to inspect the requests that it makes, we can choose the `Traffic monitoring and interception` option then resign the apk using [`uber-apk-signer`
](https://github.com/patrickfav/uber-apk-signer)

Setup burp proxy to intercept requests on port 8083 with invisible proxy settings enabled:
![image](/images/writeups/B1T6WQlVA.png)

Change the proxy settings of your device, install the app, then watch the flag on the responses:
![image](/images/writeups/HkbXGmxV0.png)

Submit the flag real quick:
![image](/images/writeups/SJ8DMXeNC.png)

### Fly Away! 2, Medium - 
For this challenge, we are instructed to review how the `integrity_check` values we received are being validated. We will need to repatch the flutter apk with the `Display absolute code offset for functions` so that we can retrieve specific function offsets from `libapp.so` which we can use for dynamic analysis with [`Frida`](https://frida.re/).

Once we patch and resign the new apk, running the app will generate a `dump.dart` file on the app's internal directory:
![image](/images/writeups/rJhwmQeVR.png)

The dump file contains method names and offsets which you might want to beautify first before reviewing, but I just directly searched for references to `integrity` and we have 2 methods of interest: `verifyDecryptedIntegrityCheck` and `decryptIntegrityCheck`
![image](/images/writeups/SyI077xNR.png)

I'm immediately interested in the decryptIntegrityCheck method since this might be responsible for decrypting the integrity value we received on the request. To view the method arguments and return values, we need to edit some values on the [`reflutter frida script`](https://github.com/Impact-I/reFlutter/blob/main/frida.js). 

Specifically since we already have the offset for `decryptIntegrityCheck` at `0x0000000000083228`, we only need the `_kDartIsolateSnapshotInstructions` address which we can retrieve via objdump (note that for this to work, you need to perform the command on the library which is used for your device's specific architecture, in this case I'm have an arm arch so the operation is performed on /lib/armeabi-v7a/libapp.so):
![image](/images/writeups/SkALHXeVR.png)

Now this is what our frida script should look like:
```javascript=
function hookFunc() {

    var _kDartIsolateSnapshotInstructions = 0x001aacc0;
    var verifyOffset = 0x00000000000831d8;
    var decryptOffset = 0x0000000000083228;
    var dumpOffset = _kDartIsolateSnapshotInstructions + decryptOffset; // _kDartIsolateSnapshotInstructions + code offset
    console.log(`dumpOffset: ${dumpOffset}`);

    var argBufferSize = 150

    var address = Module.findBaseAddress('libapp.so') // libapp.so (Android) or App (IOS) 
    console.log('\n\nbaseAddress: ' + address.toString())

    var codeOffset = address.add(dumpOffset)
    console.log('codeOffset: ' + codeOffset.toString())
    console.log('')
    console.log('Wait..... ')

    Interceptor.attach(codeOffset, {
        onEnter: function(args) {

            console.log('')
            console.log('--------------------------------------------|')
            console.log('\n    Hook Function: ' + dumpOffset);
            console.log('')
            console.log('--------------------------------------------|')
            console.log('')

            for (var argStep = 0; argStep < 50; argStep++) {
                try {
                    dumpArgs(argStep, args[argStep], argBufferSize);
                } catch (e) {

                    break;
                }

            }

        },
        onLeave: function(retval) {
            console.log('RETURN : ' + retval)
            dumpArgs(0, retval, 150);
        }
    });

}

function dumpArgs(step, address, bufSize) {

    var buf = Memory.readByteArray(address, bufSize)

    console.log('Argument ' + step + ' address ' + address.toString() + ' ' + 'buffer: ' + bufSize.toString() + '\n\n Value:\n' +hexdump(buf, {
        offset: 0,
        length: bufSize,
        header: false,
        ansi: false
    }));

    console.log('')
    console.log('----------------------------------------------------')
    console.log('')
}

setTimeout(hookFunc, 1000)
```

Run `frida -Uf com.nahamcon2024.flyaway -l ./hook.js`, trigger the network request by clicking the random lyric button, and wait for the decrypted result to be dumped on the command line:
![image](/images/writeups/HygxLmgNC.png)

### Closing Statement
I might need to do a more detailed (and cleaner) version of this writeup soon, but if you have questions feel free to hit me up on Discord or on my socials. Thanks!