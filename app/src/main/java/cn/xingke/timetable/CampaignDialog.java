package cn.xingke.timetable;

import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Handler;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;

/** Untrusted H5 runs in a separate WebView with no application JavaScript interfaces. */
final class CampaignDialog {
    private final MainActivity activity;
    private final WebView host;
    private Dialog dialog;
    CampaignDialog(MainActivity activity, WebView host){this.activity=activity;this.host=host;}
    private int dp(int value){return Math.round(value*activity.getResources().getDisplayMetrics().density);}
    private boolean safe(String raw){
        try{Uri u=Uri.parse(raw);String h=u.getHost();return ("https".equals(u.getScheme())||"http".equals(u.getScheme()))&&h!=null&&h.contains(".")&&!h.equals("appassets.androidplatform.net")&&!h.equals("localhost")&&!h.endsWith(".local")&&!h.endsWith(".internal")&&!h.matches("^(127|10|0)\\..*")&&!h.startsWith("192.168.")&&!h.startsWith("169.254.")&&!h.matches("^172\\.(1[6-9]|2[0-9]|3[01])\\..*")&&u.getUserInfo()==null&&(u.getPort()==-1||u.getPort()==80||u.getPort()==8080||u.getPort()==443||u.getPort()==8443);}catch(Exception e){return false;}
    }
    private boolean navigate(String raw){
        if(!safe(raw))return true;
        if(Uri.parse(raw).getPath()!=null&&Uri.parse(raw).getPath().endsWith(".apk")){download(raw);return true;}
        return false;
    }
    private void download(String raw){if(safe(raw))try{activity.startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW,Uri.parse(raw)));}catch(Exception e){Toast.makeText(activity,"请使用浏览器打开下载链接",Toast.LENGTH_LONG).show();}}
    void show(String raw){
        if(dialog!=null||activity.isFinishing())return;
        try{
            JSONObject item=new JSONObject(raw);String id=item.getString("id"),url=item.getString("url");
            if(!id.matches("[a-f0-9]{32}")||!safe(url))return;
            Dialog popup=new Dialog(activity);dialog=popup;popup.requestWindowFeature(Window.FEATURE_NO_TITLE);
            LinearLayout shell=new LinearLayout(activity);shell.setOrientation(LinearLayout.VERTICAL);
            GradientDrawable background=new GradientDrawable();background.setColor(Color.rgb(246,245,241));background.setCornerRadius(dp(22));shell.setBackground(background);shell.setClipToOutline(true);
            LinearLayout heading=new LinearLayout(activity);heading.setGravity(Gravity.CENTER_VERTICAL);heading.setPadding(dp(16),dp(4),dp(6),dp(4));
            TextView title=new TextView(activity);title.setText(item.getString("title"));title.setTextColor(Color.rgb(28,41,69));title.setTextSize(15);heading.addView(title,new LinearLayout.LayoutParams(0,dp(48),1));title.setGravity(Gravity.CENTER_VERTICAL);
            Button close=new Button(activity);close.setText("×");close.setTextSize(24);close.setContentDescription("关闭活动");close.setBackgroundColor(Color.TRANSPARENT);heading.addView(close,new LinearLayout.LayoutParams(dp(48),dp(48)));shell.addView(heading);
            TextView status=new TextView(activity);status.setText("正在加载…");status.setTextSize(12);status.setPadding(dp(16),dp(6),dp(16),dp(10));shell.addView(status);
            WebView page=new WebView(activity);page.setBackgroundColor(Color.rgb(246,245,241));page.getSettings().setJavaScriptEnabled(true);
            page.getSettings().setAllowFileAccess(false);page.getSettings().setAllowContentAccess(false);page.getSettings().setDomStorageEnabled(false);page.getSettings().setSupportMultipleWindows(false);page.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(page,false);
            page.setDownloadListener((target,agent,disposition,mime,length)->download(target));
            shell.addView(page,new LinearLayout.LayoutParams(-1,0,1));boolean[] delivered={false},failed={false};
            Handler timer=new Handler(activity.getMainLooper());Runnable timeout=()->{if(!delivered[0]){failed[0]=true;page.stopLoading();status.setText("暂时无法加载，请关闭后稍后再试");}};
            page.setWebViewClient(new WebViewClient(){
                @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return navigate(request.getUrl().toString());}
                @Override public boolean shouldOverrideUrlLoading(WebView view,String target){return navigate(target);}
                @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){if(!safe(request.getUrl().toString()))return new WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));return null;}
                @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame()){failed[0]=true;status.setText("暂时无法加载，请关闭后稍后再试");}}
                @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame()){failed[0]=true;status.setText("暂时无法加载，请关闭后稍后再试");}}
                @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();failed[0]=true;status.setText("页面连接不可用，请关闭后稍后再试");}
                @Override public void onPageFinished(WebView view,String target){if(!failed[0]&&!delivered[0]&&safe(target)){delivered[0]=true;timer.removeCallbacks(timeout);status.setVisibility(android.view.View.GONE);reply(id,true);}}
            });
            popup.setContentView(shell);popup.setCanceledOnTouchOutside(false);close.setOnClickListener(v->popup.dismiss());
            popup.setOnDismissListener(d->{timer.removeCallbacks(timeout);page.stopLoading();page.destroy();dialog=null;if(!delivered[0])reply(id,false);});
            Window window=popup.getWindow();window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.4f);
            popup.show();android.util.DisplayMetrics metrics=activity.getResources().getDisplayMetrics();window.setLayout(metrics.widthPixels*Math.max(60,Math.min(96,item.optInt("width",88)))/100,metrics.heightPixels*Math.max(30,Math.min(90,item.optInt("height",65)))/100);
            timer.postDelayed(timeout,25000);page.loadUrl(url);
        }catch(Exception e){if(dialog!=null)dialog.dismiss();dialog=null;}
    }
    private void reply(String id,boolean loaded){if(!activity.isDestroyed())host.evaluateJavascript("window.campaignResult&&window.campaignResult("+JSONObject.quote(id)+","+loaded+")",null);}
    void destroy(){if(dialog!=null)dialog.dismiss();}
}
