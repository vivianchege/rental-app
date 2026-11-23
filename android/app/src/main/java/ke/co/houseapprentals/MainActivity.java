package ke.co.houseapprentals;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeAppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
