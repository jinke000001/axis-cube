package app.axis.capabilityreceiver;

import android.app.Activity;
import android.os.Bundle;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.provider.MediaStore;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Local test receiver; has no network permission and is never a product dependency. */
public class ReceiverActivity extends Activity {
  @Override public void onCreate(Bundle saved) {
    super.onCreate(saved);
    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setPadding(24, 72, 24, 48);
    TextView status = new TextView(this);
    status.setTextSize(18);
    content.addView(status);
    ScrollView scroll = new ScrollView(this);
    scroll.addView(content);
    setContentView(scroll);
    try {
      Uri uri = getIntent().getParcelableExtra(Intent.EXTRA_STREAM);
      if (uri == null) throw new IllegalArgumentException("No shared content URI");
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try (InputStream stream = getContentResolver().openInputStream(uri)) {
        byte[] block = new byte[4096]; int count;
        while ((count = stream.read(block)) != -1) {
          if (bytes.size() + count > 4 * 1024 * 1024) throw new IllegalArgumentException("Test file too large");
          bytes.write(block, 0, count);
        }
      }
      byte[] data = bytes.toByteArray();
      String json = new String(data, StandardCharsets.UTF_8);
      new org.json.JSONObject(json);
      StringBuilder hash = new StringBuilder();
      for (byte b : MessageDigest.getInstance("SHA-256").digest(data)) hash.append(String.format("%02x", b & 255));
      String summary = "LOCAL TEST RECEIVER\nShared URI read: PASS\nBytes: " + data.length + "\nSHA-256: " + hash + "\n\n" + json.substring(0, Math.min(json.length(), 600));
      status.setText(summary);
      android.util.Log.i("AXISReceiver", "READ_PASS bytes=" + data.length + " sha256=" + hash);
      Button save = new Button(this); save.setText("Save copy to Downloads"); content.addView(save);
      save.setOnClickListener(view -> {
        try {
          ContentValues values = new ContentValues();
          values.put(MediaStore.Downloads.DISPLAY_NAME, "AXIS-native-readback-" + System.currentTimeMillis() + ".json");
          values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
          values.put(MediaStore.Downloads.IS_PENDING, 1);
          Uri output = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
          try (OutputStream stream = getContentResolver().openOutputStream(output)) { stream.write(data); }
          values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0);
          getContentResolver().update(output, values, null, null);
          status.setText(summary + "\n\nSaved to local Downloads. No upload."); save.setEnabled(false);
          android.util.Log.i("AXISReceiver", "SAVE_PASS " + output);
        } catch (Exception error) { status.setText("SAVE FAILED: " + error); }
      });
      Button back = new Button(this); back.setText("Return to AXIS"); content.addView(back); back.setOnClickListener(view -> finish());
    } catch (Exception error) { status.setText("READ FAILED: " + error); }
  }
}
