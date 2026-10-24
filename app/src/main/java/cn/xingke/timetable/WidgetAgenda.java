package cn.xingke.timetable;

import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Read-only projection of the active local document; never writes app data. */
public final class WidgetAgenda {
    public static final class Entry {
        public String title,time,secondary,detail,badge;
        public boolean course,current;
        public long start,end;
    }
    public static List<Entry> read(String raw,long now) {
        List<Entry> entries=new ArrayList<>();
        try {
            JSONObject doc=new JSONObject(raw);
            Calendar day=Calendar.getInstance();day.setTimeInMillis(now);
            int weekday=(day.get(Calendar.DAY_OF_WEEK)+5)%7+1;
            day.set(Calendar.HOUR_OF_DAY,0);day.set(Calendar.MINUTE,0);day.set(Calendar.SECOND,0);day.set(Calendar.MILLISECOND,0);
            long start=day.getTimeInMillis();day.add(Calendar.DAY_OF_MONTH,1);long end=day.getTimeInMillis();
            Map<String,JSONObject> slots=new HashMap<>();JSONArray times=doc.optJSONArray("slots");
            if(times!=null)for(int i=0;i<times.length();i++){JSONObject slot=times.optJSONObject(i);if(slot!=null)slots.put(slot.optString("id"),slot);}
            JSONArray courses=doc.optJSONArray("courses");
            if(courses!=null)for(int i=0;i<courses.length();i++){
                JSONObject course=courses.optJSONObject(i);if(course==null||course.optInt("day")!=weekday)continue;
                JSONObject from=slots.get(course.optString("start")),to=slots.get(course.optString("end"));if(from==null||to==null)continue;
                long begins=at(start,from.optString("start")),ends=at(start,to.optString("end"));if(begins<start||ends<=begins||ends<=now)continue;
                Entry e=new Entry();e.course=true;e.current=begins<=now;e.start=begins;e.end=ends;e.title=course.optString("name","");
                e.time=format(begins);e.secondary=format(ends);e.badge="课程";
                String room=course.optString("room","").trim();e.detail=(room.isEmpty()?"":room+" · ")+(e.current?"正在上课":"即将开始");entries.add(e);
            }
            JSONArray todos=doc.optJSONArray("todos");
            if(todos!=null)for(int i=0;i<todos.length();i++){
                JSONObject todo=todos.optJSONObject(i);if(todo==null||todo.optBoolean("completed"))continue;
                long due=todo.optLong("dueAt",0);if(due<start||due>=end)continue;
                Entry e=new Entry();e.start=due;e.end=due;e.title=todo.optString("title","");e.time=format(due);e.secondary="截止";e.badge="待办";
                String note=todo.optString("note","").trim().replace('\n',' ');e.detail=(note.isEmpty()?"":note+" · ")+(due<now?"已逾期":"待完成");entries.add(e);
            }
        } catch(Exception ignored) { }
        Collections.sort(entries,(a,b)->Long.compare(a.start,b.start));return entries;
    }
    private static String format(long time){return new SimpleDateFormat("HH:mm",Locale.CHINA).format(time);}
    private static long at(long day,String hm){
        if(!hm.matches("(?:[01]\\d|2[0-3]):[0-5]\\d"))return -1;
        Calendar value=Calendar.getInstance();value.setTimeInMillis(day);value.set(Calendar.HOUR_OF_DAY,Integer.parseInt(hm.substring(0,2)));value.set(Calendar.MINUTE,Integer.parseInt(hm.substring(3)));return value.getTimeInMillis();
    }
}
