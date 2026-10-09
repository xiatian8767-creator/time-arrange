package cn.xingke.timetable;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;

/** Only the packaged local page can access this bridge. Remote navigation stays blocked. */
public final class OnlineBridge {
    private final MainActivity activity;
    private final WebView web;
    private final SharedPreferences prefs;
    private final ExecutorService network=Executors.newFixedThreadPool(2);
    private final Semaphore requests=new Semaphore(4);
    private static final String ALIAS="xingke-v2-vault";
    // Beta-only private CA. Applied to the single test API host, never AI providers.
    private javax.net.ssl.SSLSocketFactory betaSocketFactory() throws Exception {
        KeyStore store=KeyStore.getInstance(KeyStore.getDefaultType());store.load(null);
        try(InputStream in=activity.getAssets().open("xingke-ip-test-ca.crt")){
            store.setCertificateEntry("xingke-test",java.security.cert.CertificateFactory.getInstance("X.509").generateCertificate(in));
        }
        javax.net.ssl.TrustManagerFactory trust=javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm());
        trust.init(store);
        javax.net.ssl.SSLContext tls=javax.net.ssl.SSLContext.getInstance("TLS");tls.init(null,trust.getTrustManagers(),null);
        return tls.getSocketFactory();
    }
    OnlineBridge(MainActivity a,WebView w,SharedPreferences p){activity=a;web=w;prefs=p;}
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias(ALIAS)){
            KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();
        }
        return (SecretKey)store.getKey(ALIAS,null);
    }
    private String encrypt(String value) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        return Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
    }
    private String decrypt(String value) throws Exception {
        if(value.isEmpty())return "";String[] parts=value.split(":",2);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
    }
    private boolean allowedName(String name){return name.equals("cloud")||name.equals("ai")||name.equals("position")||name.equals("mascot");}
    @JavascriptInterface public synchronized String load(String name){
        if(!allowedName(name))return "";
        try{return decrypt(prefs.getString("vault-"+name,""));}catch(Exception e){return "{\"vaultError\":true}";}
    }
    @JavascriptInterface public synchronized boolean store(String name,String value){
        if(!allowedName(name)||value==null||value.length()>2*1024*1024)return false;
        try{return prefs.edit().putString("vault-"+name,encrypt(value)).commit();}catch(Exception e){return false;}
    }
    @JavascriptInterface public String scope(){return prefs.getString("active-scope","guest");}
    @JavascriptInterface public String accountData(String scope){return prefs.getString("document-"+scope,"");}
    /** Atomic account transition: archive old data, restore selected data and encrypted session. */
    @JavascriptInterface public synchronized boolean activate(String scope,String document,String cloud){
        try{
            if(scope.length()>500||document.getBytes(StandardCharsets.UTF_8).length>1024*1024)return false;
            new JSONObject(document);new JSONObject(cloud);
            String old=scope();
            SharedPreferences.Editor edit=prefs.edit().putString("document-"+old,prefs.getString("data",""))
                .putString("partner-"+old,prefs.getString("partner",""))
                .putString("active-scope",scope).putString("data",document)
                .putString("partner",prefs.getString("partner-"+scope,""))
                .putString("vault-cloud",encrypt(cloud));
            boolean ok=edit.commit();
            if(ok)activity.runOnUiThread(()->{TodoReminders.reconcile(activity,true);TodoAlarms.reconcile(activity,false);});
            return ok;
        }catch(Exception e){return false;}
    }
    private URL https(String raw) throws Exception {
        URL url=new URL(raw);
        if(!url.getProtocol().equals("https")||url.getUserInfo()!=null||url.getRef()!=null)throw new Exception("只允许 HTTPS 地址");
        return url;
    }
    @JavascriptInterface public void request(String id,String raw){
        if(id==null||!id.matches("[a-zA-Z0-9_-]{1,80}"))return;
        if(raw==null||raw.length()>6*1024*1024||!requests.tryAcquire()){reply(id,0,"请求过多或内容过大",false);return;}
        network.execute(()->{
            HttpsURLConnection connection=null;
            try{
                JSONObject req=new JSONObject(raw);boolean ai=req.optString("target").equals("ai");
                String auth,method,endpoint;
                if(ai){
                    JSONObject config=new JSONObject(load("ai"));
                    String provider=config.getString("provider"),base=config.getString("baseUrl");
                    URL parsed=https(base);String host=parsed.getHost();
                    boolean valid=provider.equals("deepseek")?host.equals("api.deepseek.com"):
                        provider.equals("qwen")&&(host.equals("dashscope.aliyuncs.com")||host.equals("dashscope-intl.aliyuncs.com")||host.matches("[a-zA-Z0-9-]+\\.(cn-beijing|ap-southeast-1|us-east-1|eu-central-1|ap-northeast-1|cn-hongkong)\\.maas\\.aliyuncs\\.com"));
                    if(!valid)throw new Exception("模型地址必须是所选服务商的官方域名");
                    endpoint=base.replaceAll("/+$","")+"/chat/completions";method="POST";auth=config.getString("key");
                    if(auth.isEmpty())throw new Exception("请先设置 API Key");
                }else{
                    JSONObject cloud=new JSONObject(load("cloud"));
                    String path=req.getString("path");
                    if(!path.startsWith("/api/v1/")||path.contains("..")||path.contains("#"))throw new Exception("请求路径无效");
                    endpoint=cloud.getString("baseUrl").replaceAll("/+$","")+path;
                    method=req.getString("method");auth=req.optString("token");
                    if(!method.matches("GET|POST|PUT|PATCH|DELETE"))throw new Exception("请求方法无效");
                }
                connection=(HttpsURLConnection)https(endpoint).openConnection();
                if(!ai&&connection.getURL().getHost().equals("8.154.43.154")&&connection.getURL().getPort()==-1){
                    connection.setSSLSocketFactory(betaSocketFactory());
                }
                connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(ai?90000:20000);
                connection.setRequestMethod(method);connection.setRequestProperty("Accept","application/json");
                if(!auth.isEmpty())connection.setRequestProperty("Authorization","Bearer "+auth);
                if(req.has("body")){
                    byte[] data=req.getJSONObject("body").toString().getBytes(StandardCharsets.UTF_8);
                    connection.setRequestProperty("Content-Type","application/json; charset=utf-8");connection.setDoOutput(true);connection.setFixedLengthStreamingMode(data.length);
                    try(OutputStream out=connection.getOutputStream()){out.write(data);}
                }
                int status=connection.getResponseCode();
                if(status>=300&&status<400)throw new Exception("服务器地址发生重定向，请检查配置");
                InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();
                String body="{}";
                if(input!=null)try(InputStream in=input;ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){bytes.write(buffer,0,n);if(bytes.size()>2*1024*1024)throw new Exception("响应过大");}
                    body=new String(bytes.toByteArray(),StandardCharsets.UTF_8);
                }
                reply(id,status,body,true);
            }catch(Exception e){
                if((activity.getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)android.util.Log.w("OnlineBridge","Request failure type: "+e.getClass().getName());
                reply(id,0,e instanceof java.net.ProtocolException?"当前请求方法不受支持":e instanceof java.net.UnknownHostException?"无法解析服务器地址":e instanceof javax.net.ssl.SSLException?"HTTPS 证书或安全连接验证失败":"网络请求失败，请检查地址、网络和 HTTPS 证书",false);
            }
            finally{if(connection!=null)connection.disconnect();requests.release();}
        });
    }
    private void reply(String id,int status,String body,boolean json){
        activity.runOnUiThread(()->{if(!activity.isDestroyed())web.evaluateJavascript("window.onlineResult&&window.onlineResult("+JSONObject.quote(id)+","+status+","+JSONObject.quote(body)+","+json+")",null);});
    }
    @JavascriptInterface public void pickPhoto(boolean camera){activity.runOnUiThread(()->activity.pickPhoto(camera));}
    void destroy(){network.shutdownNow();}
}
