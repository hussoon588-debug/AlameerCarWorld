#!/bin/bash
set -e
export ANDROID_HOME=/home/user/Android/Sdk
for v in 35.0.0-2 35.0.0 34.0.0; do
  if [ -x "$ANDROID_HOME/build-tools/$v/aapt" ]; then BTVER=$v; break; fi
done
export BUILD_TOOLS=$ANDROID_HOME/build-tools/$BTVER
if [ -f "$ANDROID_HOME/platforms/android-34-2/android.jar" ]; then
  export PLATFORM=$ANDROID_HOME/platforms/android-34-2/android.jar
else
  export PLATFORM=$ANDROID_HOME/platforms/android-34/android.jar
fi
export D8=$BUILD_TOOLS/d8
export ZIPALIGN=$BUILD_TOOLS/zipalign
export APKSIGNER=$BUILD_TOOLS/apksigner
export JAVAC=javac
export AAPT=$BUILD_TOOLS/aapt
echo "Using build-tools: $BTVER"
PROJ=/home/user/UltimateCarWorld/apk
BUILD=/tmp/ucw-build
rm -rf $BUILD && mkdir -p $BUILD/classes $BUILD/dex $BUILD/apk
cd $PROJ

# Write MainActivity.java directly (no androidx)
mkdir -p $BUILD/src/com/ucw/game
cat > $BUILD/src/com/ucw/game/MainActivity.java <<'JAVAEOF'
package com.ucw.game;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.*;
import android.Manifest;
import android.content.pm.PackageManager;
public class MainActivity extends Activity {
    WebView web;
    private static final int MIC_REQ = 1001;
    @Override
    protected void onCreate(Bundle b){
        super.onCreate(b);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setLoadsImagesAutomatically(true);
        s.setSupportZoom(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(false);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setWebChromeClient(new WebChromeClient(){
            @Override
            public void onPermissionRequest(final PermissionRequest request){
                runOnUiThread(()->{ try{ request.grant(request.getResources()); }catch(Exception e){} });
            }
        });
        web.setWebViewClient(new WebViewClient(){
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url){
                if(url.startsWith("file:///android_asset/"))return false;
                if(url.startsWith("http://")||url.startsWith("https://"))return false;
                return true;
            }
        });
        if(Build.VERSION.SDK_INT >= 23){
            if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},MIC_REQ);
            }
        }
        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");
    }
    @Override public boolean onKeyDown(int code,KeyEvent ev){ if(code==KeyEvent.KEYCODE_BACK&&web.canGoBack()){web.goBack();return true;} return super.onKeyDown(code,ev); }
    @Override protected void onPause(){super.onPause();web.onPause();}
    @Override protected void onResume(){super.onResume();web.onResume();}
    @Override protected void onDestroy(){web.destroy();super.onDestroy();}
}
JAVAEOF

echo "== aapt package (generating R.java) =="
mkdir -p $BUILD/gen
$AAPT package -f -m -J $BUILD/gen -S $PROJ/res -M $PROJ/AndroidManifest.xml -I $PLATFORM

echo "== Compiling Java =="
# Find all java files (our code + R.java)
find $BUILD/src $BUILD/gen -name '*.java' > $BUILD/sources.txt
$JAVAC --release 11 -classpath $PLATFORM -d $BUILD/classes @$BUILD/sources.txt 2>&1

echo "== d8 =="
find $BUILD/classes -name '*.class' > $BUILD/classes.txt
$D8 --output $BUILD/dex --lib $PLATFORM @$BUILD/classes.txt 2>&1

echo "== Build APK base with aapt =="
cd $BUILD
$AAPT package -f -M $PROJ/AndroidManifest.xml -S $PROJ/res -I $PLATFORM -F UCW-base.apk
# Sync www folder from client
rm -rf $PROJ/assets/www && mkdir -p $PROJ/assets/www
cp -r /home/user/UltimateCarWorld/client/* $PROJ/assets/www/
# Add assets recursively
cd $PROJ
find assets -type f | while read f; do
  $AAPT add $BUILD/UCW-base.apk "$f" >/dev/null 2>&1 || true
done

echo "== Add classes.dex =="
cp $BUILD/UCW-base.apk $BUILD/UCW-with-dex.apk
cd $BUILD/dex
zip -q -r $BUILD/UCW-with-dex.apk classes.dex

echo "== Align =="
$ZIPALIGN -f 4 $BUILD/UCW-with-dex.apk $BUILD/UCW-aligned.apk

echo "== Sign =="
KS=/home/user/UltimateCarWorld/apk/debug.keystore
if [ ! -f $KS ]; then
  keytool -genkeypair -v -keystore $KS -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=UCW Debug,O=UCW,C=YE"
fi
$APKSIGNER sign --ks $KS --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out /home/user/UltimateCarWorld/UCW-v1.2.0.apk $BUILD/UCW-aligned.apk
echo "== DONE =="
ls -la /home/user/UltimateCarWorld/UCW-v1.2.0.apk
# verify
$APKSIGNER verify --print-certs /home/user/UltimateCarWorld/UCW-v1.2.0.apk
