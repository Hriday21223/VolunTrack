package com.voluntrack.voluntrack;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import java.util.Locale;

/**
 * Home-screen widget (#519): hours so far against the goal, and a button that
 * opens Log Hours. Reads only what ProgressWidgetPlugin saved on this device.
 */
public class HoursWidgetProvider extends AppWidgetProvider {
    // Opened in the app through the Capacitor App plugin's appUrlOpen event.
    static final String LOG_URL = "voluntrack://app/log";
    static final String HOME_URL = "voluntrack://app/";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, HoursWidgetProvider.class));
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    private static PendingIntent open(Context context, String url, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String fmt(float n) {
        if (n == Math.rint(n)) return String.format(Locale.US, "%d", (long) n);
        return String.format(Locale.US, "%.1f", n);
    }

    static RemoteViews build(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(ProgressWidgetPlugin.PREFS, Context.MODE_PRIVATE);
        boolean signedIn = prefs.getBoolean("signedIn", false);
        float hours = prefs.getFloat("hours", 0f);
        float goal = prefs.getFloat("goal", 0f);

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_hours);
        if (!signedIn) {
            views.setTextViewText(R.id.widget_hours, context.getString(R.string.widget_open_app));
            views.setTextViewText(R.id.widget_goal, "");
            views.setProgressBar(R.id.widget_progress, 100, 0, false);
        } else if (goal > 0) {
            int pct = (int) Math.min(100, Math.floor(hours / goal * 100));
            views.setTextViewText(R.id.widget_hours, context.getString(R.string.widget_hours_of_goal, fmt(hours), fmt(goal)));
            views.setTextViewText(R.id.widget_goal, hours >= goal
                    ? context.getString(R.string.widget_goal_reached)
                    : context.getString(R.string.widget_to_go, fmt(goal - hours)));
            views.setProgressBar(R.id.widget_progress, 100, pct, false);
        } else {
            views.setTextViewText(R.id.widget_hours, context.getString(R.string.widget_hours, fmt(hours)));
            views.setTextViewText(R.id.widget_goal, context.getString(R.string.widget_set_goal));
            views.setProgressBar(R.id.widget_progress, 100, 0, false);
        }
        views.setOnClickPendingIntent(R.id.widget_root, open(context, HOME_URL, 1));
        views.setOnClickPendingIntent(R.id.widget_log, open(context, LOG_URL, 2));
        return views;
    }
}
