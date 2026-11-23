package ke.co.houseapprentals;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.regex.Pattern;

@CapacitorPlugin(name = "NativeAppUpdater")
public class NativeAppUpdaterPlugin extends Plugin {
    private static final String MIME_APK = "application/vnd.android.package-archive";
    private static final String PREFS = "ruiru_app_update";
    private static final String DOWNLOAD_ID_KEY = "download_id";
    private static final String DOWNLOAD_FILE_NAME_KEY = "download_file_name";
    private static final Pattern APK_NAME = Pattern.compile(
        "^Ruiru-Rentals-[0-9A-Za-z.+-]+-Android-(?:10-plus|7-to-9)\\.apk$"
    );

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String fileName = call.getString("fileName", "");
        Uri url = Uri.parse(rawUrl);
        if (!"https".equalsIgnoreCase(url.getScheme()) ||
            !"github.com".equalsIgnoreCase(url.getHost()) ||
            !url.getPath().startsWith("/vivianchege/rental-app/releases/download/") ||
            !APK_NAME.matcher(fileName).matches() ||
            !url.getLastPathSegment().equals(fileName)) {
            call.reject("Only a Ruiru Rentals APK from the official GitHub release can be installed.");
            return;
        }

        if (!canInstallUnknownApps()) {
            try {
                openInstallPermissionSettings();
                JSObject result = new JSObject();
                result.put("needsPermission", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not open Android's install permission settings.", error);
            }
            return;
        }

        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Android download service is unavailable.");
            return;
        }

        android.content.SharedPreferences preferences = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long previousId = preferences.getLong(DOWNLOAD_ID_KEY, -1L);
        String previousFileName = preferences.getString(DOWNLOAD_FILE_NAME_KEY, "");
        if (previousId >= 0) {
            int status = getDownloadStatus(manager, previousId);
            if (status == DownloadManager.STATUS_SUCCESSFUL && fileName.equals(previousFileName)) {
                Uri downloadedApk = manager.getUriForDownloadedFile(previousId);
                if (downloadedApk == null) {
                    call.reject("The completed APK could not be opened. Please download it again.");
                    return;
                }
                try {
                    openInstaller(downloadedApk);
                    JSObject result = new JSObject();
                    result.put("openedInstaller", true);
                    call.resolve(result);
                } catch (Exception error) {
                    call.reject("Android could not open the package installer.", error);
                }
                return;
            }
            if (fileName.equals(previousFileName) && (status == DownloadManager.STATUS_PENDING ||
                status == DownloadManager.STATUS_RUNNING ||
                status == DownloadManager.STATUS_PAUSED)) {
                JSObject result = new JSObject();
                result.put("downloadInProgress", true);
                call.resolve(result);
                return;
            }
            manager.remove(previousId);
            preferences.edit().remove(DOWNLOAD_ID_KEY).remove(DOWNLOAD_FILE_NAME_KEY).apply();
        }

        try {
            DownloadManager.Request request = new DownloadManager.Request(url);
            request.setTitle("Ruiru Rentals update");
            request.setDescription("Downloading version " + extractVersion(fileName));
            request.setMimeType(MIME_APK);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, fileName);

            long downloadId = manager.enqueue(request);
            preferences.edit()
                .putLong(DOWNLOAD_ID_KEY, downloadId)
                .putString(DOWNLOAD_FILE_NAME_KEY, fileName)
                .apply();
            JSObject result = new JSObject();
            result.put("downloadStarted", true);
            result.put("downloadId", downloadId);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Android could not start the APK download.", error);
        }
    }

    private boolean canInstallUnknownApps() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return Settings.Secure.getInt(
            getContext().getContentResolver(), Settings.Secure.INSTALL_NON_MARKET_APPS, 0
        ) == 1;
    }

    private void openInstallPermissionSettings() {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
        } else {
            intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        }
        getActivity().startActivity(intent);
    }

    private int getDownloadStatus(DownloadManager manager, long id) {
        Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id));
        if (cursor == null) return -1;
        try {
            return cursor.moveToFirst()
                ? cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                : -1;
        } finally {
            cursor.close();
        }
    }

    private void openInstaller(Uri apkUri) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, MIME_APK);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
    }

    private String extractVersion(String fileName) {
        int start = "Ruiru-Rentals-".length();
        int end = fileName.indexOf("-Android-");
        return end > start ? fileName.substring(start, end) : "new";
    }
}
