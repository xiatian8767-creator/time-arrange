package cn.xingke.timetable;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        boolean scheduled="cn.xingke.timetable.REMIND".equals(intent.getAction());
        TodoReminders.reconcile(context,true,scheduled);
        TodoAlarms.reconcile(context,"cn.xingke.timetable.TODO_ALARM".equals(intent.getAction()));
    }
}
