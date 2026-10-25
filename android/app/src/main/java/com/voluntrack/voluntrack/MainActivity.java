package com.voluntrack.voluntrack;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that live in this app (not an npm package) are registered
        // by hand, before the bridge starts.
        registerPlugin(ProgressWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
