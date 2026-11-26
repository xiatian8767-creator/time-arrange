package cn.xingke.timetable;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.WebView;

/** Draw behind navigation; send only the control clearance to CSS. */
final class WebEdgeInsets {
    private final WebView web;
    private int bottom;

    WebEdgeInsets(Window window, View frame, WebView web, boolean alarm) {
        this.web=web;
        if(Build.VERSION.SDK_INT>=30) {
            window.setDecorFitsSystemWindows(false);
            android.view.WindowInsetsController controller=window.getInsetsController();
            if(controller!=null){
                int light=android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    |android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(alarm?0:light,light);
            }
        } else {
            int flags=View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
            if(!alarm){
                flags|=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if(Build.VERSION.SDK_INT>=26)flags|=View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if(Build.VERSION.SDK_INT>=29)window.setNavigationBarContrastEnforced(false);

        frame.setOnApplyWindowInsetsListener((view,insets)->{
            int left,top,right,nav,keyboard;
            if(Build.VERSION.SDK_INT>=30){
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
                left=bars.left;top=bars.top;right=bars.right;nav=bars.bottom;
                keyboard=insets.getInsets(WindowInsets.Type.ime()).bottom;
            }else{
                left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();
                nav=insets.getStableInsetBottom();
                keyboard=insets.getSystemWindowInsetBottom();
            }
            boolean editing=keyboard>nav;
            view.setPadding(left,top,right,editing?keyboard:0);
            int clearance=editing?0:(int)Math.ceil(nav/web.getResources().getDisplayMetrics().density);
            if(bottom!=clearance){bottom=clearance;applyToPage();}
            return Build.VERSION.SDK_INT>=30?WindowInsets.CONSUMED:insets.consumeSystemWindowInsets();
        });
        frame.requestApplyInsets();
    }

    void applyToPage(){
        web.evaluateJavascript("document.documentElement&&document.documentElement.style.setProperty('--android-nav-bottom','"+bottom+"px')",null);
    }
}
