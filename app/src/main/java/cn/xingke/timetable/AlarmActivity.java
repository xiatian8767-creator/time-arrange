package cn.xingke.timetable;
import android.app.Activity;
import android.os.*;
import android.content.*;
import android.graphics.Color;
import android.view.*;
import android.webkit.*;
import java.io.ByteArrayInputStream;

/** Offline alarm surface: only the triggered task titles and alarm times are exposed. */
public class AlarmActivity extends Activity {
    private WebView web;
    private final BroadcastReceiver events=new BroadcastReceiver(){public void onReceive(Context c,Intent i){if(i.getAction().endsWith("STOPPED"))finish();else refresh();}};
    @Override public void onCreate(Bundle state){super.onCreate(state);
        if(TodoAlarms.active(this).length()==0){finish();return;}
        if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true);}else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.TRANSPARENT);getWindow().setNavigationBarColor(Color.TRANSPARENT);
        web=new WebView(this);web.setBackgroundColor(Color.TRANSPARENT);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setBlockNetworkLoads(true);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        web.addJavascriptInterface(new Object(){@JavascriptInterface public void dismiss(boolean snooze){runOnUiThread(()->{TodoAlarms.dismiss(AlarmActivity.this,snooze);finish();});}},"Alarm");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}
            @Override public boolean shouldOverrideUrlLoading(WebView v,String u){return true;}
            @Override public void onPageFinished(WebView v,String u){refresh();}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){android.net.Uri u=r.getUrl();String p=u.getPath();if("https".equals(u.getScheme())&&"appassets.androidplatform.net".equals(u.getHost())&&p!=null&&p.startsWith("/assets/")&&!p.contains(".."))try{String f=p.substring(8),mime=f.endsWith(".html")?"text/html":f.endsWith(".css")?"text/css":f.endsWith(".js")?"application/javascript":f.endsWith(".png")?"image/png":"application/octet-stream";return new WebResourceResponse(mime,"UTF-8",getAssets().open(f));}catch(Exception ignored){}return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
        });
        android.widget.FrameLayout frame=new android.widget.FrameLayout(this);frame.addView(web);setContentView(frame);
        if(Build.VERSION.SDK_INT>=31)try{getWindow().setBackgroundBlurRadius(45);}catch(RuntimeException ignored){}
        if(Build.VERSION.SDK_INT>=35)frame.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets b=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());v.setPadding(b.left,b.top,b.right,b.bottom);return insets;});
        IntentFilter f=new IntentFilter("cn.xingke.timetable.ALARM_STOPPED");f.addAction("cn.xingke.timetable.ALARM_UPDATED");
        if(Build.VERSION.SDK_INT>=33)registerReceiver(events,f,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(events,f);
        web.loadUrl("https://appassets.androidplatform.net/assets/alarm.html");
    }
    private void refresh(){if(web==null)return;org.json.JSONArray items=TodoAlarms.active(this);if(items.length()==0){finish();return;}web.evaluateJavascript("window.renderAlarm&&renderAlarm("+items.toString()+")",null);}
    @Override protected void onNewIntent(Intent i){super.onNewIntent(i);refresh();}
    @Override protected void onDestroy(){if(web!=null){unregisterReceiver(events);web.removeJavascriptInterface("Alarm");web.destroy();}super.onDestroy();}
}
