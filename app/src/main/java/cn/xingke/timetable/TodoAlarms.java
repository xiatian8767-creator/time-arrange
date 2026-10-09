package cn.xingke.timetable;

import android.app.*;
import android.content.*;
import org.json.*;
import java.util.*;

/** Alarm state is derived from the active account's tasks, never a second task store. */
public final class TodoAlarms {
    private static SharedPreferences prefs(Context c){return c.getSharedPreferences("todo_alarm_state",0);}
    static String scope(Context c){return c.getSharedPreferences("star_schedule",0).getString("active-scope","guest");}
    private static String key(String scope,String id){try{byte[] b=java.security.MessageDigest.getInstance("SHA-256").digest((scope+"\n"+id).getBytes("UTF-8"));return android.util.Base64.encodeToString(b,10);}catch(Exception e){throw new IllegalStateException(e);}}
    private static Map<String,JSONObject> tasks(Context c){Map<String,JSONObject> tasks=new LinkedHashMap<>();try{JSONArray list=new JSONObject(c.getSharedPreferences("star_schedule",0).getString("data","{}")).optJSONArray("todos");if(list!=null)for(int i=0;i<list.length();i++){JSONObject t=list.getJSONObject(i);if(t.optBoolean("alarmEnabled",false)&&!t.optBoolean("completed")&&t.optLong("alarmAt")>0)tasks.put(t.getString("id"),t);}}catch(Exception ignored){}return tasks;}
    private static PendingIntent pending(Context c){return PendingIntent.getBroadcast(c,181,new Intent(c,ReminderReceiver.class).setAction("cn.xingke.timetable.TODO_ALARM"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static JSONArray active(Context c){try{return new JSONArray(prefs(c).getString("active","[]"));}catch(Exception e){return new JSONArray();}}
    private static JSONObject display(JSONObject task,long at)throws JSONException{return new JSONObject().put("id",task.getString("id")).put("title",task.getString("title")).put("at",at).put("signature",task.getLong("alarmAt"));}
    static synchronized void reconcile(Context c,boolean fire){
        AlarmManager manager=c.getSystemService(AlarmManager.class);
        manager.cancel(pending(c));
        // Retire beta.4's independent clocks without deleting its stored data.
        manager.cancel(PendingIntent.getBroadcast(c,81,new Intent(c,ReminderReceiver.class).setAction("cn.xingke.timetable.CLOCK"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
        SharedPreferences p=prefs(c);String current=scope(c);Map<String,JSONObject> tasks=tasks(c);
        boolean sameScope=current.equals(p.getString("scope",current));
        JSONArray old=active(c),active=new JSONArray();Set<String> activeIds=new HashSet<>();
        for(int i=0;sameScope&&i<old.length();i++)try{JSONObject item=old.getJSONObject(i),task=tasks.get(item.getString("id"));if(task!=null&&task.getLong("alarmAt")==item.getLong("signature")){active.put(display(task,item.getLong("at")));activeIds.add(task.getString("id"));}}catch(Exception ignored){}
        long now=System.currentTimeMillis(),next=Long.MAX_VALUE;boolean added=false;
        SharedPreferences.Editor edit=p.edit().putString("scope",current);
        Set<String> validKeys=new HashSet<>();
        for(JSONObject task:tasks.values())try{
            String id=task.getString("id"),k=key(current,id);validKeys.add(k);long signature=task.getLong("alarmAt");
            long snoozeSig=p.getLong("sig:"+k,0),snooze=p.getLong("snooze:"+k,0);
            if(snoozeSig!=signature){snooze=0;edit.remove("sig:"+k).remove("snooze:"+k);}
            if(activeIds.contains(id))continue;
            if(snooze==0&&p.getLong("fired:"+k,0)==signature)continue;
            long at=snooze>0?snooze:signature;
            if(at<=now&&fire){
                edit.putLong("fired:"+k,signature).remove("sig:"+k).remove("snooze:"+k);
                if(now-at<120000){active.put(display(task,at));added=true;}
            }else if(at>now)next=Math.min(next,at);
            else if(now-at<120000)next=Math.min(next,now+1500);
            else edit.putLong("fired:"+k,signature).remove("sig:"+k).remove("snooze:"+k);
        }catch(Exception ignored){}
        // Only retain delivery metadata for current active tasks; no hidden task copies.
        for(String name:p.getAll().keySet())if(name.contains(":")){String hash=name.substring(name.indexOf(':')+1);if(!validKeys.contains(hash))edit.remove(name);}
        edit.putString("active",active.toString()).commit();
        if(active.length()==0)c.stopService(new Intent(c,AlarmRingService.class));
        else if(added){if(TodoReminders.exact(c))AlarmRingService.ring(c);else{fallback(c,active);dismiss(c,false);}}
        else if(!active.toString().equals(old.toString()))c.sendBroadcast(new Intent("cn.xingke.timetable.ALARM_UPDATED").setPackage(c.getPackageName()));
        if(next<Long.MAX_VALUE)try{
            PendingIntent show=PendingIntent.getActivity(c,182,new Intent(c,MainActivity.class).setAction("cn.xingke.timetable.OPEN_TODOS"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            if(TodoReminders.exact(c))manager.setAlarmClock(new AlarmManager.AlarmClockInfo(next,show),pending(c));
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next,pending(c));
        }catch(SecurityException e){manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next,pending(c));}
    }
    static synchronized void dismiss(Context c,boolean snooze){
        SharedPreferences p=prefs(c);SharedPreferences.Editor e=p.edit();String current=scope(c);Map<String,JSONObject> tasks=tasks(c);JSONArray active=active(c);
        if(current.equals(p.getString("scope",current)))for(int i=0;i<active.length();i++)try{JSONObject item=active.getJSONObject(i),task=tasks.get(item.getString("id"));if(task==null||task.getLong("alarmAt")!=item.getLong("signature"))continue;String k=key(current,task.getString("id"));e.putLong("fired:"+k,task.getLong("alarmAt"));if(snooze)e.putLong("sig:"+k,task.getLong("alarmAt")).putLong("snooze:"+k,System.currentTimeMillis()+300000);}catch(Exception ignored){}
        e.putString("active","[]").commit();c.stopService(new Intent(c,AlarmRingService.class));reconcile(c,false);
    }
    static void fallback(Context c,JSONArray items){
        if(!TodoReminders.enabled(c))return;
        Notification.Builder b=android.os.Build.VERSION.SDK_INT>=26?new Notification.Builder(c,"todo_reminders"):new Notification.Builder(c);
        String title=items.optJSONObject(0).optString("title","待办提醒");
        PendingIntent open=PendingIntent.getActivity(c,183,new Intent(c,MainActivity.class).setAction("cn.xingke.timetable.OPEN_TODOS"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        b.setSmallIcon(c.getResources().getIdentifier("ic_notification","drawable",c.getPackageName())).setContentTitle(title).setContentText("待办到时间了").setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).setDefaults(Notification.DEFAULT_ALL);
        c.getSystemService(NotificationManager.class).notify(811,b.build());
    }
}
