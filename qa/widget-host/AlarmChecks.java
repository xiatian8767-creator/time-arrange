package cn.xingke.widgetqa;

import android.app.*;
import android.content.*;
import android.os.Bundle;
import org.json.*;
import java.lang.reflect.Method;

/** Offline, signed instrumentation only. Never shipped inside the application. */
public final class AlarmChecks extends android.app.Instrumentation {
    private Bundle args;
    private Context c;
    private android.content.SharedPreferences data,state;
    @Override public void onCreate(Bundle b){super.onCreate(b);args=b;start();}
    private Object call(String name,Class<?>[] types,Object... values)throws Exception{
        Method m=Class.forName("cn.xingke.timetable.TodoAlarms").getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(null,values);
    }
    private void reconcile(boolean fire)throws Exception{call("reconcile",new Class[]{Context.class,boolean.class},c,fire);}
    private void dismiss(boolean snooze)throws Exception{call("dismiss",new Class[]{Context.class,boolean.class},c,snooze);}
    private JSONArray active()throws Exception{return (JSONArray)call("active",new Class[]{Context.class},c);}
    private JSONObject task(long at)throws Exception{return new JSONObject().put("id","alarm-qa").put("title","闹钟验证").put("dueAt",at).put("createdAt",at-10000).put("completed",false).put("priority","normal").put("note","").put("remind",false).put("alarmEnabled",true).put("alarmAt",at);}
    private void save(JSONObject t)throws Exception{data.edit().putString("active-scope","alarm-qa-only").remove("vault-cloud").putString("data",new JSONObject().put("version",2).put("courses",new JSONArray()).put("slots",new JSONArray()).put("todos",new JSONArray().put(t)).toString()).commit();}
    private void check(boolean ok,String label){if(!ok)throw new AssertionError(label);}
    @Override public void onStart(){Bundle result=new Bundle();try{
        c=getTargetContext();data=c.getSharedPreferences("star_schedule",0);state=c.getSharedPreferences("todo_alarm_state",0);
        String mode=args.getString("mode","checks");
        if(mode.equals("snooze")||mode.equals("dismiss")){dismiss(mode.equals("snooze"));}
        else if(mode.equals("complete")){JSONObject t=new JSONObject(data.getString("data","{}")).getJSONArray("todos").getJSONObject(0);save(t.put("completed",true));reconcile(false);}
        else if(mode.equals("schedule")){state.edit().clear().commit();save(task(System.currentTimeMillis()+Long.parseLong(args.getString("seconds","15"))*1000));reconcile(false);}
        else {
            state.edit().clear().commit();long now=System.currentTimeMillis();JSONObject t=task(now-5*60000);save(t);reconcile(true);
            check(active().length()==1,"five-minute delayed alarm must not be discarded");
            long until=active().getJSONObject(0).getLong("until");reconcile(false);check(active().getJSONObject(0).getLong("until")==until,"reconcile must preserve ring deadline");
            dismiss(true);check(active().length()==0,"snooze clears current ring");
            check(c.getSystemService(AlarmManager.class).getNextAlarmClock()!=null,"snooze is scheduled");
            boolean snoozed=false;for(Object v:state.getAll().values())if(v instanceof Long&&Math.abs((Long)v-(System.currentTimeMillis()+300000))<5000)snoozed=true;check(snoozed,"snooze is five minutes");
            state.edit().clear().commit();save(t);reconcile(true);save(t.put("completed",true));reconcile(false);check(active().length()==0,"completed task cancels alarm");
            state.edit().clear().commit();save(t.put("completed",false));reconcile(true);
            data.edit().putString("active-scope","other-account").putString("data","{}").commit();reconcile(false);check(active().length()==0,"account switch cancels old alarm");
            state.edit().clear().commit();save(task(now-60000));reconcile(true);
            JSONArray expired=active();expired.getJSONObject(0).put("until",now-1);state.edit().putString("active",expired.toString()).commit();reconcile(true);check(active().length()==0,"expired active alarm must not restart");
            state.edit().clear().commit();save(task(now-31*60000));reconcile(true);check(active().length()==0,"very old alarm uses missed notification only");
            save(task(now+60000));reconcile(false);check(c.getSystemService(AlarmManager.class).getNextAlarmClock()!=null,"future alarm is registered");
            save(task(now+60000).put("completed",true));reconcile(false);check(c.getSystemService(AlarmManager.class).getNextAlarmClock()==null,"completed future alarm is removed");
        }
        result.putString("result","PASS alarm "+mode);finish(-1,result);
    }catch(Throwable e){result.putString("error",e.toString());finish(0,result);}}
}
