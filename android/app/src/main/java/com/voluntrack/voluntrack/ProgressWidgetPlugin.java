package com.voluntrack.voluntrack;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands the student's progress to the home-screen widget (#519). The web app
 * calls update() whenever its hours or goal change; the numbers are kept in
 * this app's private SharedPreferences and every placed widget is redrawn.
 * Nothing leaves the device.
 */
@CapacitorPlugin(name = "ProgressWidget")
public class ProgressWidgetPlugin extends Plugin {
    static final String PREFS = "voluntrack_widget";

    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        Double hours = call.getDouble("hours", 0.0);
        Double goal = call.getDouble("goal", 0.0);
        editor.putFloat("hours", hours == null ? 0f : hours.floatValue());
        editor.putFloat("goal", goal == null ? 0f : goal.floatValue());
        editor.putBoolean("signedIn", Boolean.TRUE.equals(call.getBoolean("signedIn", true)));
        editor.apply();
        HoursWidgetProvider.refreshAll(context);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context context = getContext();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        HoursWidgetProvider.refreshAll(context);
        call.resolve(new JSObject());
    }
}
