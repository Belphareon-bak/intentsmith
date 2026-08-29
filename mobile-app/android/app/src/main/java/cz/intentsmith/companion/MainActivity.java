package cz.intentsmith.companion;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
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

import androidx.activity.OnBackPressedCallback;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.BridgeActivity;

/**
 * The shell — `MR-23`, and the reason `MR-22` can stop saying "pod úložištním
 * limitem PWA".
 *
 * It is deliberately thin. The reviewed client is bundled into the APK; this
 * activity adds the four things a browser tab cannot do, and nothing else:
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
 *   4. **No hidden grace period.**  Once the activity leaves the foreground,
 *      the vault and page are locked. A recents switch therefore cannot retain
 *      a usable session for convenience.
 *
 * ── What it is not ─────────────────────────────────────────────────────────
 *
 * There is no rewrite of the client here and no second implementation of any
 * screen. The WebView loads the assets bundled from `src/mobile/client`; the
 * Capacitor HTTP bridge sends API traffic to the explicitly built gateway
 * origin. The remote server therefore never supplies code that can call this
 * vault bridge.
 */
public class MainActivity extends BridgeActivity {

    private static String pendingPairingCode;

    private FrameLayout lockOverlay;
    private EditText pinField;
    private TextView lockMessage;
    private Button unlockButton;
    private boolean promptShowing = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        capturePairingIntent(getIntent());
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
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (lockOverlay != null && lockOverlay.getVisibility() == View.VISIBLE) {
                    moveTaskToBack(true);
                    return;
                }
                // Let Capacitor/the activity handle an ordinary back after our
                // lock-specific guard. Temporarily disabling this callback
                // avoids dispatching straight back into itself.
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });

        // A cold start is a return from the longest possible background.
        if (LockPolicy.lockEngaged(this)) {
            engageLock();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        capturePairingIntent(intent);
        if (getBridge() != null) {
            getBridge().triggerWindowJSEvent("intentsmithPairingLink");
        }
    }

    private static synchronized void capturePairingIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"intentsmith".equals(data.getScheme())
            || !"pair".equals(data.getHost())) return;
        String code = data.getQueryParameter("code");
        if (code != null && code.matches("[A-Za-z0-9_-]{16,512}")) {
            pendingPairingCode = code;
        }
    }

    static synchronized String consumePairingCode() {
        String code = pendingPairingCode;
        pendingPairingCode = null;
        return code;
    }

    @Override
    public void onPause() {
        super.onPause();
        if (LockPolicy.lockEngaged(this)) {
            // Locked on the way out.  The overlay goes up now so that the
            // thumbnail the system is about to take shows the lock, not the
            // inbox — `FLAG_SECURE` blanks it anyway, and neither mechanism is
            // trusted to be the only one.
            engageLock();
        }
    }

    /**
     * Lock all three layers, in the order that matters.
     *
     * The vault is sealed first, because that is the one an attacker with the
     * running process can reach; the page is told next, so it drops the
     * credential it hydrated and aborts anything in flight; the overlay goes up
     * last, because it is only what a person sees.  Doing the visible part
     * first and the real parts afterwards is how a lock ends up being a
     * screenshot of a lock.
     */
    private void engageLock() {
        VaultPlugin.LockState.lock();
        if (getBridge() != null) {
            // MR-23: the WebView keeps its own copy of the credential after
            // boot.  Hiding it does not drop that copy — this does.
            getBridge().triggerWindowJSEvent("intentsmithLock");
        }
        showLock(null);
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!LockPolicy.lockEngaged(this)) {
            VaultPlugin.LockState.unlock();
            hideLock();
            return;
        }
        engageLock();
        // The system lock asks by itself: a phone that already has a screen
        // lock should not make its owner tap a second button to be asked for
        // the same fingerprint.
        if (LockPolicy.lockKind(this) == LockPolicy.LockKind.SYSTEM) {
            promptSystemUnlock();
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
        unlockButton = lockOverlay.findViewById(R.id.unlock_button);

        // One overlay, two doors.  Which one is shown is not a preference: it
        // is whichever lock this device can actually enforce (`LockPolicy`).
        unlockButton.setOnClickListener(view -> {
            if (LockPolicy.lockKind(this) == LockPolicy.LockKind.SYSTEM) {
                promptSystemUnlock();
            } else {
                attemptUnlock();
            }
        });
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
            LockPolicy.LockKind kind = LockPolicy.lockKind(this);
            boolean system = kind == LockPolicy.LockKind.SYSTEM;
            boolean unavailable = kind == LockPolicy.LockKind.NONE;
            pinField.setText("");
            pinField.setVisibility(system || unavailable ? View.GONE : View.VISIBLE);
            unlockButton.setEnabled(!unavailable);
            unlockButton.setText(system ? R.string.lock_unlock_system : R.string.lock_unlock);
            lockMessage.setText(message != null
                ? message
                : getString(
                    unavailable ? R.string.lock_system_unavailable
                        : system ? R.string.lock_prompt_system : R.string.lock_prompt));
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

    /**
     * Ask the system, not the app.
     *
     * `BiometricPrompt` with `DEVICE_CREDENTIAL` accepts the fingerprint, the
     * face or the phone's own PIN/pattern — whichever the owner already set up.
     * That is strictly better than the app PIN below: nothing new to remember,
     * nothing new stored here, and the rate limiting and lockout are the
     * platform's, which are harder than anything this app would write.
     *
     * A cancelled prompt does **not** unlock and does not fall back to the app
     * PIN.  Falling back would make the weaker secret sufficient, which is the
     * classic way a second factor becomes a first one.
     */
    private void promptSystemUnlock() {
        if (promptShowing) return;
        promptShowing = true;
        try {
            BiometricPrompt prompt = new BiometricPrompt(
                (FragmentActivity) this,
                ContextCompat.getMainExecutor(this),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        promptShowing = false;
                        releaseLock();
                    }

                    @Override
                    public void onAuthenticationError(int code, CharSequence message) {
                        promptShowing = false;
                        // Stays locked, and says what happened.  A silent
                        // dismissal would leave a blank overlay with no way
                        // back in and no explanation.
                        showLock(getString(R.string.lock_system_retry));
                    }
                });

            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(getString(R.string.app_name))
                .setSubtitle(getString(R.string.lock_system_subtitle))
                .setAllowedAuthenticators(LockPolicy.SYSTEM_AUTHENTICATORS)
                .build();
            prompt.authenticate(info);
        } catch (Exception e) {
            promptShowing = false;
            showLock(getString(R.string.lock_system_unavailable));
        }
    }

    /** One way out of the lock, whichever door was used to get through it. */
    private void releaseLock() {
        VaultPlugin.LockState.unlock();
        hideLock();
        if (getBridge() != null && getBridge().getWebView() != null) {
            // The page is reloaded so the client re-reads the credential
            // through the vault rather than continuing on whatever it held in
            // memory before the lock — which, since `intentsmithLock`, is
            // nothing.
            getBridge().getWebView().reload();
        }
    }

    private void attemptUnlock() {
        String pin = pinField.getText().toString();
        LockPolicy.Result result = LockPolicy.verify(this, pin);
        switch (result.outcome) {
            case OK:
                releaseLock();
                break;
            case WIPED:
                // Said plainly.  A device that quietly forgot its pairing would
                // send the user to the pairing screen with no idea why.
                showLock(getString(R.string.lock_wiped));
                break;
            case UNAVAILABLE:
                showLock(getString(R.string.lock_system_unavailable));
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
}
