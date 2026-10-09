package cn.xingke.timetable;
import android.app.*;
import android.content.*;
import android.media.*;
import android.os.*;
import org.json.JSONArray;

/** Only alive while a user-enabled task alarm is sounding. */
public class AlarmRingService extends Service {
    private MediaPlayer player;private Vibrator vibrator;private PowerManager.WakeLock wake;
    private final Handler handler=new Handler(Looper.getMainLooper());
    static void ring(Context c){try{Intent i=new Intent(c,AlarmRingService.class);if(Build.VERSION.SDK_INT>=26)c.startForegroundService(i);else c.startService(i);}catch(Exception e){TodoAlarms.fallback(c,TodoAlarms.active(c));TodoAlarms.dismiss(c,false);}}
    @Override public IBinder onBind(Intent i){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();
        if("stop".equals(action)||"snooze".equals(action)){TodoAlarms.dismiss(this,"snooze".equals(action));return START_NOT_STICKY;}
        JSONArray items=TodoAlarms.active(this);if(items.length()==0){stopSelf();return START_NOT_STICKY;}
        NotificationManager nm=getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=26){NotificationChannel ch=new NotificationChannel("todo_alarm_v21","待办闹钟",NotificationManager.IMPORTANCE_HIGH);ch.setSound(null,null);ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);nm.createNotificationChannel(ch);}
        PendingIntent open=PendingIntent.getActivity(this,90,new Intent(this,AlarmActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop=PendingIntent.getService(this,91,new Intent(this,AlarmRingService.class).setAction("stop"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent snooze=PendingIntent.getService(this,92,new Intent(this,AlarmRingService.class).setAction("snooze"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,"todo_alarm_v21"):new Notification.Builder(this);
        b.setSmallIcon(getResources().getIdentifier("ic_notification","drawable",getPackageName())).setContentTitle("待办提醒 · "+items.optJSONObject(0).optString("title")).setContentText(items.length()>1?items.length()+" 项待办正在提醒":"到时间了，点击查看").setCategory(Notification.CATEGORY_ALARM).setPriority(Notification.PRIORITY_MAX).setVisibility(Notification.VISIBILITY_PRIVATE).setOngoing(true).setContentIntent(open).addAction(0,"停止",stop).addAction(0,"稍后 5 分钟",snooze);
        if(Build.VERSION.SDK_INT<34||nm.canUseFullScreenIntent())b.setFullScreenIntent(open,true);
        startForeground(810,b.build());
        if(player==null){
            wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"StarOrbit:todo-alarm");wake.acquire(610000);
            try{player=new MediaPlayer();player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());android.net.Uri sound=RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);if(sound==null)sound=RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);player.setDataSource(this,sound);player.setLooping(true);player.prepare();player.start();}catch(Exception e){android.util.Log.w("OrbitAlarm","Sound unavailable");}
            vibrator=(Vibrator)getSystemService(VIBRATOR_SERVICE);if(vibrator!=null){if(Build.VERSION.SDK_INT>=26)vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0,650,650},0));else vibrator.vibrate(new long[]{0,650,650},0);}
        }
        sendBroadcast(new Intent("cn.xingke.timetable.ALARM_UPDATED").setPackage(getPackageName()));
        handler.removeCallbacksAndMessages(null);handler.postDelayed(()->TodoAlarms.dismiss(this,false),600000);
        return START_NOT_STICKY;
    }
    @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);if(player!=null)player.release();if(vibrator!=null)vibrator.cancel();if(wake!=null&&wake.isHeld())wake.release();stopForeground(true);sendBroadcast(new Intent("cn.xingke.timetable.ALARM_STOPPED").setPackage(getPackageName()));super.onDestroy();}
}
