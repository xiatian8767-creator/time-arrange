package cn.xingke.timetable;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private WebView web;
    private SharedPreferences prefs;
    private OnlineBridge online;
    private String pendingExport;
    private boolean openTodos;
    private boolean importingPartner;
    private static final int EXPORT=101, IMPORT=102;
    private static final String HOME="https://appassets.androidplatform.net/assets/index.html";

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs=getSharedPreferences("star_schedule", MODE_PRIVATE);
        openTodos="cn.xingke.timetable.OPEN_TODOS".equals(getIntent().getAction());
        TodoReminders.channel(this);
        if(saved!=null){pendingExport=saved.getString("pendingExport");importingPartner=saved.getBoolean("importingPartner");}
        FrameLayout frame=new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(247,245,239));
        web=new WebView(this);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        frame.addView(web,new FrameLayout.LayoutParams(-1,-1));
        setContentView(frame);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | (Build.VERSION.SDK_INT>=26?View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR:0));
        if(Build.VERSION.SDK_INT>=35){frame.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});}
        web.setBackgroundColor(Color.rgb(247,245,239));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(false);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setBlockNetworkLoads(true);
        web.getSettings().setSupportMultipleWindows(false);
        web.addJavascriptInterface(new LocalBridge(),"Android");
        online=new OnlineBridge(this,web,prefs);
        web.addJavascriptInterface(online,"Online");
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String url){if(openTodos){openTodos=false;view.evaluateJavascript("window.showPage && window.showPage('todos')",null);}}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !HOME.equals(request.getUrl().toString());}
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return !HOME.equals(url);}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if("https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())) {
                    String path=uri.getPath();
                    if(path!=null && path.startsWith("/assets/") && !path.contains("..")){
                        try{String file=path.substring(8);String mime=file.endsWith(".html")?"text/html":file.endsWith(".css")?"text/css":file.endsWith(".js")?"application/javascript":"application/octet-stream";return new WebResourceResponse(mime,"UTF-8",getAssets().open(file));}catch(Exception ignored){}
                    }
                }
                return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
            }
        });
        web.loadUrl(HOME);
    }
    public class LocalBridge {
        @JavascriptInterface public String loadBackground(){return prefs.getString("schedule-background","");}
        @JavascriptInterface public boolean saveBackground(String raw){
            if(raw==null||raw.length()>3*1024*1024)return false;
            try{JSONObject value=new JSONObject(raw);String image=value.getString("image");double transparency=value.getDouble("transparency");
                if((!image.isEmpty()&&!image.matches("^data:image/jpeg;base64,[A-Za-z0-9+/=]+$"))||Double.isNaN(transparency)||transparency<0||transparency>100)return false;
                return prefs.edit().putString("schedule-background",raw).commit();
            }catch(Exception e){return false;}
        }
        @JavascriptInterface public void pickBackground(){runOnUiThread(()->{try{startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*"),106);}catch(Exception e){notice("无法打开图片选择器");}});}
        @JavascriptInterface public String loadPartner(){return prefs.getString("partner","");}
        @JavascriptInterface public boolean savePartner(String json){
            if(json==null||json.getBytes(StandardCharsets.UTF_8).length>1024*1024)return false;
            try{if(!json.isEmpty())new JSONObject(json);}catch(Exception error){return false;}
            return prefs.edit().putString("partner",json).commit();
        }
        @JavascriptInterface public void openPartnerBackup(){runOnUiThread(()->{importingPartner=true;pickBackup();});}
        @JavascriptInterface public String loadData(){return prefs.getString("data","");}
        @JavascriptInterface public boolean saveData(String json){
            if(json==null || json.getBytes(StandardCharsets.UTF_8).length>1024*1024)return false;
            try{new JSONObject(json);}catch(Exception error){return false;}
            boolean saved=prefs.edit().putString("data",json).commit();
            if(saved)runOnUiThread(()->TodoReminders.reconcile(MainActivity.this,true));
            return saved;
        }
        @JavascriptInterface public boolean notificationsEnabled(){return TodoReminders.enabled(MainActivity.this);}
        @JavascriptInterface public boolean exactRemindersEnabled(){return TodoReminders.exact(MainActivity.this);}
        @JavascriptInterface public void requestNotificationPermission(){runOnUiThread(()->{
            if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},103);
        });}
        @JavascriptInterface public void openNotificationSettings(){runOnUiThread(()->{
            Intent intent=Build.VERSION.SDK_INT>=26?new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName()):new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()));
            try{startActivity(intent);}catch(Exception error){notice("请在手机设置中开启星课表通知");}
        });}
        @JavascriptInterface public void requestExactReminders(){runOnUiThread(()->{
            if(Build.VERSION.SDK_INT>=31&&!TodoReminders.exact(MainActivity.this))try{startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));}catch(Exception error){notice("请在手机设置中允许星课表设置闹钟和提醒");}
        });}
        @JavascriptInterface public void exportBackup(String json){runOnUiThread(()->{pendingExport=json;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("application/json");intent.putExtra(Intent.EXTRA_TITLE,"星课表备份.json");try{startActivityForResult(intent,EXPORT);}catch(Exception e){notice("无法打开文件选择器");}});}
        @JavascriptInterface public void openBackup(){runOnUiThread(()->{importingPartner=false;pickBackup();});}
        private void pickBackup(){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");try{startActivityForResult(intent,IMPORT);}catch(Exception e){notice("无法打开文件选择器");}}
    }
    private void notice(String message){web.evaluateJavascript("window.nativeNotice("+JSONObject.quote(message)+")",null);}
    public void pickPhoto(boolean camera){
        try{
            Intent intent;
            if(camera){
                Uri uri=Uri.parse("content://"+getPackageName()+".photo/capture.jpg");
                intent=new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).putExtra(android.provider.MediaStore.EXTRA_OUTPUT,uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                intent.setClipData(android.content.ClipData.newRawUri("课表照片",uri));
            }else{intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");}
            startActivityForResult(intent,camera?105:104);
        }catch(Exception e){notice("无法打开相机或照片选择器");}
    }
    private void readPhoto(Uri uri){readPhoto(uri,false);}
    private void readPhoto(Uri uri,boolean background){
        try{
            android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inJustDecodeBounds=true;
            try(InputStream in=getContentResolver().openInputStream(uri)){android.graphics.BitmapFactory.decodeStream(in,null,options);}
            if(options.outWidth<=0||options.outHeight<=0)throw new Exception();
            options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>2048)options.inSampleSize*=2;
            options.inJustDecodeBounds=false;
            android.graphics.Bitmap bitmap;
            try(InputStream in=getContentResolver().openInputStream(uri)){bitmap=android.graphics.BitmapFactory.decodeStream(in,null,options);}
            if(bitmap==null)throw new Exception();
            ByteArrayOutputStream out=new ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,85,out);bitmap.recycle();
            if(out.size()>2*1024*1024)throw new Exception();
            String image="data:image/jpeg;base64,"+android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP);
            String callback=background?"receiveBackgroundPhoto":"receiveAIPhoto";
            web.evaluateJavascript("window."+callback+"&&window."+callback+"("+JSONObject.quote(image)+")",null);
        }catch(Exception e){notice("无法读取图片，请选择清晰、较小的课表照片");}
    }
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);out.putString("pendingExport",pendingExport);out.putBoolean("importingPartner",importingPartner);}
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==106){if(result==RESULT_OK&&data!=null&&data.getData()!=null)readPhoto(data.getData(),true);return;}
        if(request==104||request==105){
            Uri cameraUri=Uri.parse("content://"+getPackageName()+".photo/capture.jpg");
            if(result==RESULT_OK){if(request==105)readPhoto(cameraUri);else if(data!=null&&data.getData()!=null)readPhoto(data.getData());}
            if(request==105){revokeUriPermission(cameraUri,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);new java.io.File(getCacheDir(),"capture.jpg").delete();}
            return;
        }
        if(result!=RESULT_OK || data==null || data.getData()==null)return;
        Uri uri=data.getData();
        try{
            if(request==EXPORT && pendingExport!=null){try(OutputStream stream=getContentResolver().openOutputStream(uri,"wt")){if(stream==null)throw new Exception();stream.write(pendingExport.getBytes(StandardCharsets.UTF_8));}pendingExport=null;notice("备份已保存到所选位置");}
            if(request==IMPORT){try(InputStream input=getContentResolver().openInputStream(uri);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){if(input==null)throw new Exception();byte[] buffer=new byte[4096];int n;while((n=input.read(buffer))!=-1){bytes.write(buffer,0,n);if(bytes.size()>1024*1024)throw new Exception("文件不能超过 1 MB");}String raw=new String(bytes.toByteArray(),StandardCharsets.UTF_8);web.evaluateJavascript((importingPartner?"window.importPartner(":"window.importBackup(")+JSONObject.quote(raw)+")",null);}}
        }catch(Exception e){notice("文件操作失败，请检查文件和存储位置");}
    }
    @Override public void onBackPressed(){web.evaluateJavascript("window.handleBack && window.handleBack()",value->{if(!"true".equals(value))super.onBackPressed();});}
    @Override protected void onPause(){super.onPause();web.onPause();}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==103){TodoReminders.reconcile(this,true);web.evaluateJavascript("typeof renderTodos === 'function' && renderTodos()",null);}}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if("cn.xingke.timetable.OPEN_TODOS".equals(intent.getAction()))web.evaluateJavascript("window.showPage && window.showPage('todos')",null);}
    @Override protected void onResume(){super.onResume();TodoReminders.reconcile(this,true);if(web!=null){web.onResume();web.evaluateJavascript("if(typeof tick === 'function')tick();if(typeof renderTodos === 'function')renderTodos();",null);}}
    @Override protected void onDestroy(){if(online!=null)online.destroy();if(web!=null){web.removeJavascriptInterface("Android");web.removeJavascriptInterface("Online");web.destroy();}super.onDestroy();}
}
