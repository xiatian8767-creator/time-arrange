package cn.xingke.timetable;
import android.app.*;
import android.content.*;
import android.os.Build;
import org.json.*;

/** Device-local standalone clocks. No account or network is required. */
public final class OrbitAlarms {
    static SharedPreferences prefs(Context c){return c.getSharedPreferences("orbit_alarms",0);}
    static JSONArray list(Context c){try{return new JSONArray(prefs(c).getString("items","[]"));}catch(Exception e){return new JSONArray();}}
    static synchronized boolean save(Context c,String raw){
        try{JSONArray items=new JSONArray(raw);if(items.length()>100)return false;java.util.HashSet<String> ids=new java.util.HashSet<>();
            for(int i=0;i<items.length();i++){JSONObject a=items.getJSONObject(i);String id=a.getString("id"),title=a.getString("title");long due=a.getLong("dueAt");
                if(id.isEmpty()||id.length()>80||!ids.add(id)||title.trim().isEmpty()||title.length()>80||due<=0||due>8640000000000000L)return false;a.getBoolean("enabled");}
            if(!prefs(c).edit().putString("items",items.toString()).commit())return false;
            reconcile(c,false);return true;
        }catch(Exception e){return false;}
    }
    static PendingIntent pending(Context c){return PendingIntent.getBroadcast(c,81,new Intent(c,ReminderReceiver.class).setAction("cn.xingke.timetable.CLOCK"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static synchronized void reconcile(Context c,boolean fire){
        AlarmManager manager=c.getSystemService(AlarmManager.class);manager.cancel(pending(c));
        long now=System.currentTimeMillis(),next=Long.MAX_VALUE;JSONArray items=list(c);boolean changed=false;StringBuilder titles=new StringBuilder();
        String current=c.getSharedPreferences("star_schedule",0).getString("active-scope","guest");
        for(int i=0;i<items.length();i++)try{JSONObject a=items.getJSONObject(i);if(!a.optBoolean("enabled"))continue;
            if(a.has("scope")&&!current.equals(a.optString("scope"))){a.put("enabled",false);changed=true;continue;}long due=a.getLong("dueAt");
            if(due<=now&&fire){a.put("enabled",false);changed=true;if(now-due<120000){if(titles.length()>0)titles.append(" / ");titles.append(a.getString("title"));}}
            else if(due>now)next=Math.min(next,due);
            else if(now-due<120000)next=Math.min(next,now+2000);
            else {a.put("enabled",false);changed=true;}
        }catch(Exception ignored){}
        if(changed)prefs(c).edit().putString("items",items.toString()).commit();
        if(titles.length()>0)AlarmRingService.ring(c,titles.toString());
        if(next<Long.MAX_VALUE&&TodoReminders.exact(c))try{PendingIntent show=PendingIntent.getActivity(c,82,new Intent(c,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);manager.setAlarmClock(new AlarmManager.AlarmClockInfo(next,show),pending(c));}catch(SecurityException ignored){}
    }
    static synchronized void snooze(Context c,String title,String scope){
        try{JSONArray items=list(c),next=new JSONArray();for(int i=0;i<items.length();i++){JSONObject a=items.getJSONObject(i);if(a.optBoolean("enabled"))next.put(a);}next.put(new JSONObject().put("id","snooze_"+System.currentTimeMillis()).put("title",title.substring(0,Math.min(80,title.length()))).put("dueAt",System.currentTimeMillis()+300000).put("enabled",true).put("scope",scope));save(c,next.toString());}catch(Exception ignored){}
    }
}
