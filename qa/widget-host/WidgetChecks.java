package cn.xingke.widgetqa;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import org.json.*;
import java.util.*;
import java.text.SimpleDateFormat;
import cn.xingke.timetable.WidgetAgenda;
import cn.xingke.timetable.AgendaWidget;

public final class WidgetChecks extends Instrumentation {
    private Bundle arguments;
    @Override public void onCreate(Bundle args){super.onCreate(args);arguments=args;start();}
    private static String hm(long time){return new SimpleDateFormat("HH:mm",Locale.CHINA).format(time);}
    private static JSONObject slot(String id,long start,long end)throws Exception{return new JSONObject().put("id",id).put("start",hm(start)).put("end",hm(end));}
    private static JSONObject todo(String id,String title,long time,boolean done)throws Exception{return new JSONObject().put("id",id).put("title",title).put("dueAt",time).put("createdAt",time-1000).put("note","课程作业").put("completed",done).put("priority","normal").put("remind",false).put("alarmEnabled",false).put("alarmAt",0);}
    private static JSONObject fixture(long now)throws Exception{
        Calendar day=Calendar.getInstance();day.setTimeInMillis(now);int weekday=(day.get(Calendar.DAY_OF_WEEK)+5)%7+1;
        return new JSONObject().put("version",2).put("slots",new JSONArray().put(slot("s1",now-10*60000,now+20*60000)).put(slot("s2",now+40*60000,now+80*60000)))
            .put("courses",new JSONArray().put(new JSONObject().put("id","c1").put("day",weekday).put("start","s1").put("end","s1").put("name","高等数学").put("room","A204").put("color","#ced8ef").put("note",""))
            .put(new JSONObject().put("id","c2").put("day",weekday).put("start","s2").put("end","s2").put("name","大学英语").put("room","B306").put("color","#ced8ef").put("note","")))
            .put("todos",new JSONArray().put(todo("t1","提交实验报告",now+30*60000,false)).put(todo("t2","去图书馆还书",now+90*60000,false)).put(todo("t3","完成练习",now+110*60000,false)).put(todo("done","已完成不显示",now,true)).put(todo("tomorrow","明天不显示",now+86400000,false)));
    }
    @Override public void onStart(){Bundle result=new Bundle();try{
        Calendar fixed=Calendar.getInstance();fixed.set(2026,9,23,8,30,0);fixed.set(Calendar.MILLISECOND,0);long time=fixed.getTimeInMillis();JSONObject document=fixture(time);
        java.util.List<WidgetAgenda.Entry> entries=WidgetAgenda.read(document.toString(),time);
        if(entries.size()!=5||!entries.get(0).current||!entries.get(0).course||entries.get(1).course||!entries.get(1).title.equals("提交实验报告"))throw new AssertionError("Mixed today agenda ordering");
        if(WidgetAgenda.read(document.toString(),time+86400000).size()!=1)throw new AssertionError("Midnight filtering");
        if(!WidgetAgenda.read("malformed",time).isEmpty())throw new AssertionError("Malformed data fallback");
        document.getJSONArray("slots").getJSONObject(0).put("start","99:99");if(WidgetAgenda.read(document.toString(),time).size()!=4)throw new AssertionError("Bad slot ignored");
        Context c=getTargetContext();String mode=arguments==null?"seed":arguments.getString("mode","seed");JSONObject live=fixture(System.currentTimeMillis());
        if("update".equals(mode))live.getJSONArray("todos").getJSONObject(0).put("completed",true);
        c.getSharedPreferences("star_schedule",0).edit().putString("active-scope","guest".equals(mode)?"guest":"widget-qa-only").putString("data",live.toString()).remove("vault-cloud").commit();AgendaWidget.refresh(c);
        result.putString("result","PASS native agenda: mixed ordering, ongoing status, completed/next-day filtering, malformed data; mode="+mode);finish(-1,result);
    }catch(Throwable error){result.putString("error",error.toString());finish(0,result);}}
}
