package cn.xingke.timetable;
import android.app.*;
import android.content.*;
import android.media.*;
import android.os.*;
import org.json.JSONArray;

/** Only alive while a user-enabled task alarm is sounding. */
public class AlarmRingService extends Service {
    static volatile boolean running;
    private MediaPlayer player;private Vibrator vibrator;private PowerManager.WakeLock wake;
    private ToneGenerator backupTone;
    private final Handler handler=new Handler(Looper.getMainLooper());
    // Ask the service to re-read the persisted state instead of cancelling a queued FGS start.
    static void stop(Context c){if(running)try{c.startService(new Intent(c,AlarmRingService.class).setAction("reconcile"));}catch(IllegalStateException ignored){}}
    private final Runnable beep=new Runnable(){public void run(){if(backupTone!=null){backupTone.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD,700);handler.postDelayed(this,1300);}}};
    static void ring(Context c){try{Intent i=new Intent(c,AlarmRingService.class);if(Build.VERSION.SDK_INT>=26&&!running)c.startForegroundService(i);else c.startService(i);}catch(Exception e){TodoAlarms.fallback(c,TodoAlarms.active(c));android.util.Log.w("OrbitAlarm","Alarm service start deferred: "+e.getClass().getSimpleName());}}
    @Override public IBinder onBind(Intent i){return null;}
    private void promote(){
        NotificationManager nm=getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=26){NotificationChannel ch=new NotificationChannel("todo_alarm_v21","待办闹钟",NotificationManager.IMPORTANCE_HIGH);ch.setSound(null,null);ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);nm.createNotificationChannel(ch);}
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,"todo_alarm_v21"):new Notification.Builder(this);
        b.setSmallIcon(getResources().getIdentifier("ic_notification","drawable",getPackageName())).setContentTitle("待办闹钟").setContentText("正在准备提醒").setCategory(Notification.CATEGORY_ALARM).setOngoing(true);
        // Promote before reading mutable task state. Cancelling while startup is queued is legal.
        startForeground(810,b.build());running=true;
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        // Each queued start is acknowledged before stopSelfResult decides whether it is the last.
        promote();
        String action=intent==null?null:intent.getAction();
        if("stop".equals(action)||"snooze".equals(action)){TodoAlarms.dismiss(this,"snooze".equals(action));return START_NOT_STICKY;}
        JSONArray items=TodoAlarms.active(this);if(items.length()==0){stopSelfResult(startId);return START_NOT_STICKY;}
        long until=0;for(int n=0;n<items.length();n++)until=Math.max(until,items.optJSONObject(n).optLong("until",System.currentTimeMillis()+TodoAlarms.RING_MS));
        if(until<=System.currentTimeMillis()){TodoAlarms.dismiss(this,false);return START_NOT_STICKY;}
        NotificationManager nm=getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=26){NotificationChannel ch=new NotificationChannel("todo_alarm_v21","待办闹钟",NotificationManager.IMPORTANCE_HIGH);ch.setSound(null,null);ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);nm.createNotificationChannel(ch);}
        PendingIntent open=PendingIntent.getActivity(this,90,new Intent(this,AlarmActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop=PendingIntent.getService(this,91,new Intent(this,AlarmRingService.class).setAction("stop"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent snooze=PendingIntent.getService(this,92,new Intent(this,AlarmRingService.class).setAction("snooze"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,"todo_alarm_v21"):new Notification.Builder(this);
        b.setSmallIcon(getResources().getIdentifier("ic_notification","drawable",getPackageName())).setContentTitle("待办提醒 · "+items.optJSONObject(0).optString("title")).setContentText(items.length()>1?items.length()+" 项待办正在提醒":"到时间了，点击查看").setCategory(Notification.CATEGORY_ALARM).setPriority(Notification.PRIORITY_MAX).setVisibility(Notification.VISIBILITY_PRIVATE).setOngoing(true).setContentIntent(open).addAction(0,"停止",stop).addAction(0,"稍后 5 分钟",snooze);
        if(Build.VERSION.SDK_INT<34||nm.canUseFullScreenIntent())b.setFullScreenIntent(open,true);
        try{startForeground(810,b.build());}catch(Exception e){TodoAlarms.fallback(this,items);stopSelfResult(startId);return START_NOT_STICKY;}
        running=true;nm.cancel(811);
        if(wake==null){
            wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"StarOrbit:todo-alarm");wake.setReferenceCounted(false);wake.acquire(610000);
            startSound();
            vibrator=(Vibrator)getSystemService(VIBRATOR_SERVICE);if(vibrator!=null){if(Build.VERSION.SDK_INT>=26)vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0,650,650},0));else vibrator.vibrate(new long[]{0,650,650},0);}
        }
        wake.acquire(Math.max(1000,until-System.currentTimeMillis()+10000));
        sendBroadcast(new Intent("cn.xingke.timetable.ALARM_UPDATED").setPackage(getPackageName()));
        handler.removeCallbacks(expire);handler.postDelayed(expire,Math.max(1,until-System.currentTimeMillis()));
        return START_REDELIVER_INTENT;
    }
    private final Runnable expire=()->TodoAlarms.dismiss(this,false);
    private void startSound(){
        try{
            player=new MediaPlayer();player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            player.setOnErrorListener((mp,what,extra)->{backupSound();return true;});
            player.setDataSource(this,RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));player.setLooping(true);player.prepare();player.start();
        }catch(Exception e){backupSound();}
    }
    private void backupSound(){
        if(player!=null){player.release();player=null;}
        if(backupTone!=null)return;
        try{backupTone=new ToneGenerator(AudioManager.STREAM_ALARM,100);handler.post(beep);android.util.Log.i("OrbitAlarm","Using offline backup alarm sound");}
        catch(Exception e){android.util.Log.w("OrbitAlarm","Alarm audio unavailable");TodoAlarms.fallback(this,TodoAlarms.active(this),"闹钟正在振动，声音无法播放，请检查闹钟音量");}
    }
    @Override public void onDestroy(){running=false;handler.removeCallbacksAndMessages(null);if(player!=null)player.release();if(backupTone!=null)backupTone.release();if(vibrator!=null)vibrator.cancel();if(wake!=null&&wake.isHeld())wake.release();stopForeground(true);sendBroadcast(new Intent("cn.xingke.timetable.ALARM_STOPPED").setPackage(getPackageName()));super.onDestroy();}
}
