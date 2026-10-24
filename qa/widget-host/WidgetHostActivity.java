package cn.xingke.widgetqa;
import android.app.Activity;
import android.appwidget.*;
import android.content.ComponentName;
import android.graphics.Color;
import android.os.Bundle;
import android.widget.FrameLayout;
import android.view.Gravity;

public final class WidgetHostActivity extends Activity {
    private AppWidgetHost host;
    @Override public void onCreate(Bundle saved){super.onCreate(saved);
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(236,233,226));setContentView(root);
        AppWidgetManager manager=AppWidgetManager.getInstance(this);host=new AppWidgetHost(this,471);host.startListening();
        int id=getPreferences(0).getInt("id",0);if(id==0){id=host.allocateAppWidgetId();getPreferences(0).edit().putInt("id",id).commit();}
        ComponentName provider=new ComponentName("cn.xingke.timetable","cn.xingke.timetable.AgendaWidget");
        Bundle options=new Bundle();options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,320);options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,340);options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,350);options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,350);
        if(manager.getAppWidgetInfo(id)==null&&!manager.bindAppWidgetIdIfAllowed(id,provider,options))throw new IllegalStateException("Grant appwidget bind permission to test host first");
        if(getIntent().getBooleanExtra("small",false)){options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,220);options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,220);}
        manager.updateAppWidgetOptions(id,options);AppWidgetHostView view=host.createView(this,id,manager.getAppWidgetInfo(id));
        float density=getResources().getDisplayMetrics().density;FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(getResources().getDisplayMetrics().widthPixels-(int)(24*density),(int)((getIntent().getBooleanExtra("small",false)?220:350)*density),Gravity.CENTER);root.addView(view,lp);
    }
    @Override protected void onDestroy(){if(host!=null)host.stopListening();super.onDestroy();}
}
