package cn.xingke.timetable;
import android.app.*;
import android.content.*;
import android.media.*;
import android.os.*;

/** Runs only while sounding. Scheduled alarms wake this service without a WebView. */
public class AlarmRingService extends Service {
    private MediaPlayer player;private Vibrator vibrator;private PowerManager.WakeLock wake;
    private final Handler handler=new Handler(Looper.getMainLooper());private String title="Star Orbit 闹钟",scope=null;
    static final String CHANNEL="orbit_alarm";
    static void ring(Context c,String title){ring(c,title,null);}
    static void ring(Context c,String title,String scope){try{Intent i=new Intent(c,AlarmRingService.class).putExtra("title",title).putExtra("scope",scope);if(Build.VERSION.SDK_INT>=26)c.startForegroundService(i);else c.startService(i);}catch(Exception e){android.util.Log.w("OrbitAlarm","Alarm start failed: "+e.getClass().getSimpleName());}}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();if("stop".equals(action)||"snooze".equals(action)){if("snooze".equals(action))OrbitAlarms.snooze(this,title,scope);stopSelf();return START_NOT_STICKY;}
        if(intent.getStringExtra("scope")!=null)scope=intent.getStringExtra("scope");
        String added=intent.getStringExtra("title");if(added!=null)title=player==null?added:title+" / "+added;
        NotificationManager nm=getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=26){NotificationChannel ch=new NotificationChannel(CHANNEL,"闹钟响铃",NotificationManager.IMPORTANCE_HIGH);ch.setSound(null,null);ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);nm.createNotificationChannel(ch);}
        Intent screen=new Intent(this,AlarmActivity.class).putExtra("title",title).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open=PendingIntent.getActivity(this,90,screen,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop=PendingIntent.getService(this,91,new Intent(this,AlarmRingService.class).setAction("stop"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent snooze=PendingIntent.getService(this,92,new Intent(this,AlarmRingService.class).setAction("snooze"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
        b.setSmallIcon(getResources().getIdentifier("ic_notification","drawable",getPackageName())).setContentTitle(title).setContentText("闹钟正在响铃 · 点击关闭或稍后提醒").setCategory(Notification.CATEGORY_ALARM).setPriority(Notification.PRIORITY_MAX).setVisibility(Notification.VISIBILITY_PRIVATE).setOngoing(true).setContentIntent(open).addAction(0,"关闭",stop).addAction(0,"5 分钟后",snooze);
        if(Build.VERSION.SDK_INT<34||nm.canUseFullScreenIntent())b.setFullScreenIntent(open,true);
        startForeground(810,b.build());
        if(player==null){
            wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"StarOrbit:alarm");wake.acquire(610000);
            try{player=new MediaPlayer();player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());android.net.Uri sound=RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);if(sound==null)sound=RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);player.setDataSource(this,sound);player.setLooping(true);player.prepare();player.start();}catch(Exception e){android.util.Log.w("OrbitAlarm","Sound unavailable");}
            vibrator=(Vibrator)getSystemService(VIBRATOR_SERVICE);if(vibrator!=null){if(Build.VERSION.SDK_INT>=26)vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0,700,500},0));else vibrator.vibrate(new long[]{0,700,500},0);}
        }
        handler.removeCallbacksAndMessages(null);handler.postDelayed(()->stopSelf(),600000);
        return START_NOT_STICKY;
    }
    @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);if(player!=null){player.release();player=null;}if(vibrator!=null)vibrator.cancel();if(wake!=null&&wake.isHeld())wake.release();stopForeground(true);sendBroadcast(new Intent("cn.xingke.timetable.ALARM_STOPPED").setPackage(getPackageName()));super.onDestroy();}
}
