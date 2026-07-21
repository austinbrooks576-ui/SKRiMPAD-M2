package com.firstriff.skrimpadm2

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    lateinit var webView: WebView
    private val AUDIO_PERMISSION_REQUEST = 1001
    private lateinit var fileHandler: FileHandler
    private var speech: SpeechRecognizer? = null

    // Voice bridge — the WebView has no Web Speech API, so the AI console's
    // 🎤 talks to Android's native SpeechRecognizer through this interface.
    inner class VoiceBridge {
        @JavascriptInterface
        fun available(): Boolean = SpeechRecognizer.isRecognitionAvailable(this@MainActivity)

        @JavascriptInterface
        fun startListening() {
            runOnUiThread {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(this@MainActivity,
                        arrayOf(Manifest.permission.RECORD_AUDIO), AUDIO_PERMISSION_REQUEST)
                    webView.evaluateJavascript("window.brainVoiceError && brainVoiceError('permission')", null)
                    return@runOnUiThread
                }
                if (speech == null) {
                    speech = SpeechRecognizer.createSpeechRecognizer(this@MainActivity).apply {
                        setRecognitionListener(object : RecognitionListener {
                            override fun onResults(results: Bundle?) {
                                val txt = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
                                webView.evaluateJavascript(
                                    "window.brainVoiceResult && brainVoiceResult(" + JSONObject.quote(txt) + ")", null)
                            }
                            override fun onError(error: Int) {
                                webView.evaluateJavascript("window.brainVoiceError && brainVoiceError('" + error + "')", null)
                            }
                            override fun onReadyForSpeech(p: Bundle?) {}
                            override fun onBeginningOfSpeech() {}
                            override fun onRmsChanged(v: Float) {}
                            override fun onBufferReceived(b: ByteArray?) {}
                            override fun onEndOfSpeech() {}
                            override fun onPartialResults(p: Bundle?) {}
                            override fun onEvent(t: Int, p: Bundle?) {}
                        })
                    }
                }
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                }
                speech?.startListening(intent)
            }
        }

        @JavascriptInterface
        fun stopListening() { runOnUiThread { speech?.stopListening() } }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen on
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Full immersive mode
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN
        )

        webView = WebView(this)
        setContentView(webView)

        fileHandler = FileHandler(this, webView)
        configureWebView()
        requestAudioPermission()
    }

    private fun configureWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowFileAccessFromFileURLs = true
        settings.allowUniversalAccessFromFileURLs = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        settings.setRenderPriority(WebSettings.RenderPriority.HIGH)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.safeBrowsingEnabled = false
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.setBackgroundColor(0xFF0A0B0F.toInt())

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    request.grant(request.resources)
                }
            }

            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                return true
            }

            // Native dialog fallbacks — the default WebChromeClient silently
            // drops window.prompt/confirm, which broke in-app renaming.
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: android.webkit.JsResult?): Boolean {
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton("OK") { _, _ -> result?.confirm() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }

            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: android.webkit.JsResult?): Boolean {
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton("OK") { _, _ -> result?.confirm() }
                    .setNegativeButton("Cancel") { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }

            override fun onJsPrompt(view: WebView?, url: String?, message: String?, defaultValue: String?, result: android.webkit.JsPromptResult?): Boolean {
                val input = android.widget.EditText(this@MainActivity)
                input.setText(defaultValue ?: "")
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton("OK") { _, _ -> result?.confirm(input.text.toString()) }
                    .setNegativeButton("Cancel") { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }
        }

        webView.addJavascriptInterface(fileHandler, "AndroidFileHandler")
        webView.addJavascriptInterface(VoiceBridge(), "AndroidVoice")
        webView.loadUrl("file:///android_asset/index.html")
    }

    private fun requestAudioPermission() {
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO)
        }
        // Bluetooth LE MIDI controllers need BLUETOOTH_CONNECT on Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), AUDIO_PERMISSION_REQUEST)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == AUDIO_PERMISSION_REQUEST) {
            permissions.forEachIndexed { i, perm ->
                val granted = i < grantResults.size && grantResults[i] == PackageManager.PERMISSION_GRANTED
                if (!granted && perm == Manifest.permission.RECORD_AUDIO) {
                    Toast.makeText(this, "Microphone access denied — some loop features limited", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        // Resume Web Audio when the app returns to the foreground / the screen unlocks.
        webView.evaluateJavascript("window.skrimpadOnResume && window.skrimpadOnResume()", null)
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN
        )
    }

    override fun onPause() {
        super.onPause()
        // Silence Web Audio the instant the app is backgrounded or the screen locks,
        // before the WebView is paused, so nothing keeps droning in the background.
        webView.evaluateJavascript("window.skrimpadOnPause && window.skrimpadOnPause()", null)
        webView.onPause()
    }

    override fun onDestroy() {
        speech?.destroy()
        webView.destroy()
        super.onDestroy()
    }
}
