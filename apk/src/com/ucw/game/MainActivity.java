package com.ucw.game;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.*;
import android.Manifest;
import android.content.pm.PackageManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends Activity {
    WebView web;
    private static final int MIC_REQ = 1001;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle b){
        super.onCreate(b);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        View decor = getWindow().getDecorView();
        int opts = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        decor.setSystemUiVisibility(opts);

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
        if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1){
            s.setMediaPlaybackRequiresUserGesture(false);
        }
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setWebChromeClient(new WebChromeClient(){
            @Override
            public void onPermissionRequest(final PermissionRequest request){
                runOnUiThread(()->{
                    String[] RES = {PermissionRequest.RESOURCE_AUDIO_CAPTURE};
                    request.grant(RES);
                });
            }
        });
        web.setWebViewClient(new WebViewClient(){
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r){
                String u = r.getUrl().toString();
                if(u.startsWith("file:///android_asset/") || u.startsWith("http://10.0.2.2") || u.startsWith("http://localhost")){
                    return false;
                }
                if(u.matches("https?://.*")) return false;
                return true;
            }
        });
        if(ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED){
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQ);
        }
        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public boolean onKeyDown(int code, KeyEvent ev){
        if(code == KeyEvent.KEYCODE_BACK && web.canGoBack()){ web.goBack(); return true; }
        return super.onKeyDown(code, ev);
    }

    @Override
    protected void onPause(){ super.onPause(); web.onPause(); }
    @Override
    protected void onResume(){ super.onResume(); web.onResume(); }
    @Override
    protected void onDestroy(){ web.destroy(); super.onDestroy(); }
}
