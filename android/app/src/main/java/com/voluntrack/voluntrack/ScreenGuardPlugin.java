package com.voluntrack.voluntrack;

import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Blocks screenshots and screen recording while a document preview is open
 * (src/lib/screenGuard.js). FLAG_SECURE makes captures of this window come
 * out black and hides it in the recent-apps view. Turned on by enable() when
 * the preview opens and off by disable() when it closes, so the rest of the
 * app can still be screenshotted.
 */
@CapacitorPlugin(name = "ScreenGuard")
public class ScreenGuardPlugin extends Plugin {

    @PluginMethod
    public void enable(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve(new JSObject());
        });
    }

    @PluginMethod
    public void disable(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve(new JSObject());
        });
    }

    // iOS-only events; present so the same JS works on both platforms.
    @PluginMethod
    public void isCaptured(PluginCall call) {
        JSObject result = new JSObject();
        result.put("captured", false);
        call.resolve(result);
    }
}
