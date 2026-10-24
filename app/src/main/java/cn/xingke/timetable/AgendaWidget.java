package cn.xingke.timetable;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

public final class AgendaWidget extends AppWidgetProvider {
    public static final String ADD="cn.xingke.timetable.WIDGET_ADD_TODO",TODOS="cn.xingke.timetable.WIDGET_TODOS",SCHEDULE="cn.xingke.timetable.WIDGET_SCHEDULE";
    public static final String ALL="cn.xingke.timetable.WIDGET_AGENDA";
    private static final String REFRESH="cn.xingke.timetable.WIDGET_REFRESH";
    public static void refresh(Context context){
        Context app=context.getApplicationContext();AppWidgetManager manager=AppWidgetManager.getInstance(app);
        int[] ids=manager.getAppWidgetIds(new ComponentName(app,AgendaWidget.class));
        if(ids.length==0)return;
        SharedPreferences prefs=app.getSharedPreferences("star_schedule",Context.MODE_PRIVATE);
        boolean signedIn=!"guest".equals(prefs.getString("active-scope","guest"));
        long now=System.currentTimeMillis();List<WidgetAgenda.Entry> entries=WidgetAgenda.read(signedIn?prefs.getString("data","{}"):"{}",now);
        for(int id:ids)draw(app,manager,id,entries,signedIn,now);
        // Inexact boundary refresh, no additional exact-alarm permission or network polling.
        long next=now+30*60*1000L;
        Calendar midnight=Calendar.getInstance();midnight.setTimeInMillis(now);midnight.add(Calendar.DAY_OF_MONTH,1);midnight.set(Calendar.HOUR_OF_DAY,0);midnight.set(Calendar.MINUTE,0);midnight.set(Calendar.SECOND,0);midnight.set(Calendar.MILLISECOND,0);next=Math.min(next,midnight.getTimeInMillis());
        for(WidgetAgenda.Entry e:entries){if(e.start>now)next=Math.min(next,e.start);if(e.course&&e.end>now)next=Math.min(next,e.end);}
        app.getSystemService(AlarmManager.class).set(AlarmManager.RTC,Math.max(now+60000,next),refreshIntent(app));
    }
    private static PendingIntent refreshIntent(Context c){return PendingIntent.getBroadcast(c,907,new Intent(c,AgendaWidget.class).setAction(REFRESH),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private static PendingIntent open(Context c,String action){return PendingIntent.getActivity(c,action.hashCode(),new Intent(c,MainActivity.class).setAction(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private static void draw(Context c,AppWidgetManager manager,int id,List<WidgetAgenda.Entry> entries,boolean signedIn,long now){
        RemoteViews views=new RemoteViews(c.getPackageName(),R.layout.widget_agenda);
        views.setTextViewText(R.id.widget_date,new SimpleDateFormat("M月d日  EEEE",Locale.CHINA).format(now));
        views.setOnClickPendingIntent(R.id.widget_add,open(c,ADD));views.setOnClickPendingIntent(R.id.widget_root,open(c,SCHEDULE));
        views.setOnClickPendingIntent(R.id.widget_all,open(c,ALL));
        Bundle options=manager.getAppWidgetOptions(id);int height=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,350);
        int visible=Math.min(entries.size(),height<260?1:height<330?2:3);
        views.removeAllViews(R.id.widget_rows);
        for(int i=0;i<visible;i++){
            WidgetAgenda.Entry entry=entries.get(i);boolean dark=entry.course&&entry.current;
            RemoteViews row=new RemoteViews(c.getPackageName(),R.layout.widget_agenda_row);
            row.setInt(R.id.widget_row,"setBackgroundResource",dark?R.drawable.widget_row_dark:entry.course?R.drawable.widget_row_blue:R.drawable.widget_row_gold);
            row.setInt(R.id.widget_badge,"setBackgroundResource",dark?R.drawable.widget_badge_dark:entry.course?R.drawable.widget_badge_blue:R.drawable.widget_badge_gold);
            int main=dark?0xffffffff:entry.course?0xff335577:0xff80602c,muted=dark?0xffc0ccdd:entry.course?0xff7c91a7:0xff9d8c70;
            for(int view:new int[]{R.id.widget_time,R.id.widget_title})row.setTextColor(view,main);
            for(int view:new int[]{R.id.widget_secondary,R.id.widget_detail,R.id.widget_badge})row.setTextColor(view,muted);
            row.setInt(R.id.widget_divider,"setBackgroundColor",dark?0xff52617a:entry.course?0xffccd8e6:0xffd9cdae);
            row.setTextViewText(R.id.widget_time,entry.time);row.setTextViewText(R.id.widget_secondary,entry.secondary);row.setTextViewText(R.id.widget_title,entry.title);row.setTextViewText(R.id.widget_detail,entry.detail);row.setTextViewText(R.id.widget_badge,entry.badge);
            row.setOnClickPendingIntent(R.id.widget_row,open(c,entry.course?SCHEDULE:TODOS));views.addView(R.id.widget_rows,row);
        }
        views.setViewVisibility(R.id.widget_empty,visible==0?View.VISIBLE:View.GONE);
        views.setTextViewText(R.id.widget_empty,signedIn?"今天暂无课程和待办\n点右上角 ＋ 添加一项安排":"打开 Star Orbit 登录后查看安排");
        views.setTextViewText(R.id.widget_more,entries.size()>visible?"还有 "+(entries.size()-visible)+" 项安排":visible>0?"今天共 "+entries.size()+" 项安排":"留点时间给想做的事");
        manager.updateAppWidget(id,views);
    }
    @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids){refresh(c);}
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager m,int id,Bundle options){refresh(c);}
    @Override public void onReceive(Context c,Intent intent){super.onReceive(c,intent);String action=intent.getAction();if(REFRESH.equals(action)||Intent.ACTION_BOOT_COMPLETED.equals(action)||Intent.ACTION_TIME_CHANGED.equals(action)||Intent.ACTION_TIMEZONE_CHANGED.equals(action)||Intent.ACTION_MY_PACKAGE_REPLACED.equals(action))refresh(c);}
    @Override public void onDisabled(Context c){c.getSystemService(AlarmManager.class).cancel(refreshIntent(c));}
}
