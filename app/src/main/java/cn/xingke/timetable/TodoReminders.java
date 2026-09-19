package cn.xingke.timetable;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.Map;

/** One persistent alarm wakes the receiver for the next pending reminder. */
public final class TodoReminders {
    private static final String CHANNEL="todo_reminders";
    private static final String TAG="TodoReminders";
    private TodoReminders() {}

    static void channel(Context context) {
        if(Build.VERSION.SDK_INT>=26){
            NotificationChannel channel=new NotificationChannel(CHANNEL,"事务待办提醒",NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("在待办时间提醒你完成事项");
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    static boolean enabled(Context context) {
        if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return false;
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=24&&!manager.areNotificationsEnabled())return false;
        if(Build.VERSION.SDK_INT>=26){NotificationChannel ch=manager.getNotificationChannel(CHANNEL);if(ch!=null&&ch.getImportance()==NotificationManager.IMPORTANCE_NONE)return false;}
        return true;
    }

    static boolean exact(Context context) {
        return Build.VERSION.SDK_INT<31||context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    private static PendingIntent alarmIntent(Context context) {
        return PendingIntent.getBroadcast(context,0,new Intent(context,ReminderReceiver.class).setAction("cn.xingke.timetable.REMIND"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }

    /** Reconcile from saved data, so a killed WebView is never needed for reminders. */
    static synchronized void reconcile(Context context, boolean deliver) {
        channel(context);
        AlarmManager alarm=context.getSystemService(AlarmManager.class);
        NotificationManager notifications=context.getSystemService(NotificationManager.class);
        PendingIntent pending=alarmIntent(context);
        alarm.cancel(pending);
        SharedPreferences data=context.getSharedPreferences("star_schedule",Context.MODE_PRIVATE);
        SharedPreferences fired=context.getSharedPreferences("todo_delivered",Context.MODE_PRIVATE);
        Map<String,JSONObject> active=new HashMap<>();
        try {
            JSONArray todos=new JSONObject(data.getString("data","{}")).optJSONArray("todos");
            if(todos!=null)for(int i=0;i<todos.length();i++){
                JSONObject todo=todos.getJSONObject(i);
                if(todo.optBoolean("remind")&&!todo.optBoolean("completed")&&todo.optLong("dueAt")>0)active.put(todo.getString("id"),todo);
            }
        } catch(Exception error){Log.w(TAG,"Cannot read reminder data",error);return;}
        // Completed, deleted, disabled or rescheduled tasks must not leave old notifications.
        SharedPreferences.Editor edits=fired.edit();
        for(String id:fired.getAll().keySet()){
            JSONObject todo=active.get(id);
            if(todo==null||todo.optLong("dueAt")!=fired.getLong(id,-1)){
                notifications.cancel(id,1);edits.remove(id);
            }
        }
        edits.commit();
        if(!enabled(context))return;
        long now=System.currentTimeMillis(),next=Long.MAX_VALUE;
        for(Map.Entry<String,JSONObject> entry:active.entrySet()){
            String id=entry.getKey();JSONObject todo=entry.getValue();long due=todo.optLong("dueAt");
            if(fired.getLong(id,-1)==due)continue;
            if(due<=now&&deliver){
                // Recover missed reminders after reboot or a permission change, up to 24 hours late.
                if(now-due<=86400000L){
                    Intent open=new Intent(context,MainActivity.class).setAction("cn.xingke.timetable.OPEN_TODOS").setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    PendingIntent content=PendingIntent.getActivity(context,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                    Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(context,CHANNEL):new Notification.Builder(context);
                    String note=todo.optString("note","");
                    builder.setSmallIcon(context.getResources().getIdentifier("ic_notification","drawable",context.getPackageName()))
                        .setContentTitle(todo.optString("title","待办提醒"))
                        .setContentText(note.isEmpty()?"到时间了，记得完成这项待办。":note)
                        .setStyle(new Notification.BigTextStyle().bigText(note.isEmpty()?"到时间了，记得完成这项待办。":note))
                        .setContentIntent(content).setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER)
                        .setVisibility(Notification.VISIBILITY_PRIVATE).setPriority(Notification.PRIORITY_HIGH)
                        .setDefaults(Notification.DEFAULT_ALL).setWhen(due);
                    notifications.notify(id,1,builder.build());
                }
                fired.edit().putLong(id,due).commit();
            } else next=Math.min(next,Math.max(now+1000,due));
        }
        if(next!=Long.MAX_VALUE){
            try {
                if(exact(context))alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next,pending);
                else alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next,pending);
            } catch(SecurityException denied){alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next,pending);}
        }
    }
}
