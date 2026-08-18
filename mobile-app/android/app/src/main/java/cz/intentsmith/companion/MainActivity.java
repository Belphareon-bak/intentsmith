package cz.intentsmith.companion;

import android.os.Bundle;
import android.provider.Settings;
import android.os.SystemClock;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;

import com.getcapacitor.BridgeActivity;

/**
 * The shell — `MR-23`, and the reason `MR-22` can stop saying "pod úložištním
 * limitem PWA".
 *
 * It is deliberately thin.  The application is the client the gateway already
 * serves; this activity adds the four things a browser tab cannot do, and
 * nothing else:
 *
 *   1. **`FLAG_SECURE`** — the app's contents are excluded from screenshots and
 *      from the recents thumbnail.  Without it the operating system takes a
 *      picture of whatever approval was on screen every time the user switches
 *      apps, and stores it where the app has no say.
 *
 *   2. **A lock that is real** (`P-4`).  Locking is decided here, from the
 *      activity lifecycle, and enforced in `VaultPlugin` by refusing to hand
 *      out the credential.  Both halves are necessary: an overlay alone is a
 *      curtain — the WebView behind it still holds a valid token and can still
 *      be driven; a sealed vault alone would leave the last rendered screen
 *      readable on the display.
 *
 *   3. **Locking on the way *out*, not on the way back in.**  `onPause` fires
 *      before the recents thumbnail is taken and before another app can be
 *      brought forward; `onResume` is too late for both.  This is the
 *      difference between a lock and a lock-shaped animation.
 *
 *   4. **A grace period, stated rather than hidden.**  Returning within
 *      {@link #LOCK_GRACE_MS} does not ask again, because a lock that fires
 *      when the user glances at a notification is a lock the user turns off.
 *      The grace is measured on `elapsedRealtime`, which does not move when the
 *      wall clock is changed — a lock that a clock change can skip is not one.
 *
 * ── What it is not ─────────────────────────────────────────────────────────
 *
 * There is no rewrite of the client here, no second implementation of any
 * screen, and no native networking.  The WebView loads
 * `http://127.0.0.1:3336`, which is the gateway's own client over an `adb
 * reverse` tunnel, so the app and the browser are the same application and
 * cannot drift apart.
 */
public class MainActivity extends BridgeActivity {

    /**
     * How long the app may be away before it asks again.  Long enough to answer
     * a call, short enough that a pocketed phone is locked by the time it is
     * out of sight.
     */
    private static final long LOCK_GRACE_MS = 20_000L;

    private FrameLayout lockOverlay;
    private EditText pinField;
    private TextView lockMessage;
    private long leftAt = 0L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VaultPlugin.class);
        super.onCreate(savedInstanceState);

        // Before anything can be drawn, and not per screen: a flag that is only
        // set on the "sensitive" screens leaks through the screen that forgot.
        if (!captureAllowed()) {
            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE
            );
        }

        installLockOverlay();

        // A cold start is a return from the longest possible background.
        if (LockPolicy.pinIsSet(this)) {
            VaultPlugin.LockState.lock();
            showLock(null);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        leftAt = SystemClock.elapsedRealtime();
        if (LockPolicy.pinIsSet(this)) {
            // Locked on the way out.  The overlay goes up now so that the
            // thumbnail the system is about to take shows the lock, not the
            // inbox — `FLAG_SECURE` blanks it anyway, and neither mechanism is
            // trusted to be the only one.
            VaultPlugin.LockState.lock();
            showLock(null);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!LockPolicy.pinIsSet(this)) {
            VaultPlugin.LockState.unlock();
            hideLock();
            return;
        }
        long away = SystemClock.elapsedRealtime() - leftAt;
        if (leftAt != 0L && away < LOCK_GRACE_MS && !VaultPlugin.LockState.isLocked()) {
            hideLock();
        } else {
            VaultPlugin.LockState.lock();
            showLock(null);
        }
    }

    /**
     * The one way `FLAG_SECURE` can be off — **debug builds only**, and only
     * when somebody with a shell asks for it:
     *
     *     adb shell settings put global intentsmith_capture 1
     *
     * It exists because `FLAG_SECURE` blanks `screencap`, so without it a
     * developer cannot photograph a bug and a smoke test cannot show that the
     * app renders at all.  Both halves of the guard matter: `BuildConfig.DEBUG`
     * means a released APK has no such switch compiled into it, and the
     * explicit setting means a debug build is still protected by default.
     */
    private boolean captureAllowed() {
        if (!BuildConfig.DEBUG) return false;
        try {
            return Settings.Global.getInt(getContentResolver(), "intentsmith_capture", 0) == 1;
        } catch (Exception e) {
            return false;
        }
    }

    // ── The overlay ────────────────────────────────────────────────────────

    private void installLockOverlay() {
        FrameLayout root = findViewById(android.R.id.content);
        lockOverlay = (FrameLayout) LayoutInflater.from(this)
            .inflate(R.layout.lock_overlay, root, false);
        // Consumes touches: the WebView behind it must not be reachable, or the
        // overlay would be scenery.
        lockOverlay.setClickable(true);
        lockOverlay.setFocusable(true);
        lockOverlay.setVisibility(View.GONE);

        pinField = lockOverlay.findViewById(R.id.pin_field);
        lockMessage = lockOverlay.findViewById(R.id.lock_message);
        Button unlockButton = lockOverlay.findViewById(R.id.unlock_button);

        unlockButton.setOnClickListener(view -> attemptUnlock());
        pinField.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) {
                lockMessage.setText(R.string.lock_prompt);
            }
        });

        root.addView(lockOverlay);
    }

    private void showLock(String message) {
        if (lockOverlay == null) return;
        runOnUiThread(() -> {
            pinField.setText("");
            lockMessage.setText(message == null ? getString(R.string.lock_prompt) : message);
            lockOverlay.setVisibility(View.VISIBLE);
            lockOverlay.bringToFront();
            // The rendered page goes away with the lock.  `FLAG_SECURE` keeps
            // it out of screenshots; this keeps it off the screen itself.
            View webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView != null) webView.setVisibility(View.INVISIBLE);
        });
    }

    private void hideLock() {
        if (lockOverlay == null) return;
        runOnUiThread(() -> {
            lockOverlay.setVisibility(View.GONE);
            View webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView != null) webView.setVisibility(View.VISIBLE);
            InputMethodManager ime = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (ime != null) ime.hideSoftInputFromWindow(pinField.getWindowToken(), 0);
        });
    }

    private void attemptUnlock() {
        String pin = pinField.getText().toString();
        LockPolicy.Result result = LockPolicy.verify(this, pin);
        switch (result.outcome) {
            case OK:
                VaultPlugin.LockState.unlock();
                hideLock();
                // The page is reloaded so the client re-reads the credential
                // through the vault rather than continuing on whatever it held
                // in memory before the lock.
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().reload();
                }
                break;
            case WIPED:
                // Said plainly.  A device that quietly forgot its pairing would
                // send the user to the pairing screen with no idea why.
                showLock(getString(R.string.lock_wiped));
                break;
            default:
                pinField.setText("");
                showLock(getString(R.string.lock_wrong, result.remaining));
        }
    }

    /**
     * The back button must not be an unlock.  While locked, going back leaves
     * the app rather than revealing what is behind the overlay.
     */
    @Override
    public void onBackPressed() {
        if (lockOverlay != null && lockOverlay.getVisibility() == View.VISIBLE) {
            moveTaskToBack(true);
            return;
        }
        super.onBackPressed();
    }
}
