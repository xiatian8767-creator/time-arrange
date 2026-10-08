package cn.xingke.timetable;
import android.app.Activity;
import android.os.*;
import android.content.*;
import android.view.*;
import android.widget.*;
public class AlarmActivity extends Activity {
    private final BroadcastReceiver stopped=new BroadcastReceiver(){public void onReceive(Context c,Intent i){finish();}};
    @Override public void onCreate(Bundle state){super.onCreate(state);
        if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true);}else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(Build.VERSION.SDK_INT>=33)registerReceiver(stopped,new IntentFilter("cn.xingke.timetable.ALARM_STOPPED"),Context.RECEIVER_NOT_EXPORTED);else registerReceiver(stopped,new IntentFilter("cn.xingke.timetable.ALARM_STOPPED"));render();}
    private void render(){LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setGravity(Gravity.CENTER);layout.setPadding(48,80,48,80);layout.setBackgroundColor(0xfff7f5ef);
        TextView name=new TextView(this);name.setText("✦ Star Orbit\n\n"+getIntent().getStringExtra("title"));name.setTextSize(28);name.setGravity(Gravity.CENTER);layout.addView(name);
        for(String action:new String[]{"stop","snooze"}){Button button=new Button(this);button.setText(action.equals("stop")?"关闭闹钟":"5 分钟后再提醒");button.setOnClickListener(v->{startService(new Intent(this,AlarmRingService.class).setAction(action));finish();});layout.addView(button,new LinearLayout.LayoutParams(-1,160));}setContentView(layout);}
    @Override protected void onNewIntent(Intent i){super.onNewIntent(i);setIntent(i);render();}
    @Override protected void onDestroy(){unregisterReceiver(stopped);super.onDestroy();}
}
