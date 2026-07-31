package com.firstriff.skrimpadm2

import android.Manifest
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.midi.MidiDevice
import android.media.midi.MidiDeviceInfo
import android.media.midi.MidiManager
import android.media.midi.MidiReceiver
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import java.util.UUID
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
    private var midiManager: MidiManager? = null
    private val openMidiDevices = mutableListOf<MidiDevice>()
    private var midiCallback: MidiManager.DeviceCallback? = null
    private var bleScanner: BluetoothLeScanner? = null
    private var bleScanCb: ScanCallback? = null
    private val BLE_PERMISSION_REQUEST = 1002
    private val BLE_MIDI_UUID = UUID.fromString("03b80e5a-ede8-4b33-a751-6ce34ec4c700")

    // MIDI bridge — the WebView has no Web MIDI API, so USB / BLE controllers
    // are opened natively through android.media.midi and their raw bytes are
    // forwarded to the same onMIDI() path the desktop build uses.
    inner class MidiBridge {
        @JavascriptInterface
        fun enable() { runOnUiThread { setupMidi() } }
        @JavascriptInterface
        fun scanBluetooth() { runOnUiThread { startBleMidiScan() } }
    }

    private fun jsMidiStatus(txt: String) {
        val safe = txt.replace("'", "").replace("\\", "")
        webView.evaluateJavascript("window.onNativeMIDIStatus && onNativeMIDIStatus('$safe')", null)
    }

    private fun setupMidi() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) { jsMidiStatus("MIDI needs Android 6+"); return }
        if (midiManager == null) midiManager = getSystemService(Context.MIDI_SERVICE) as? MidiManager
        val mm = midiManager
        if (mm == null) { jsMidiStatus("MIDI unavailable on this device"); return }
        for (info in mm.devices) openMidiInput(mm, info)
        if (midiCallback == null) {
            midiCallback = object : MidiManager.DeviceCallback() {
                override fun onDeviceAdded(info: MidiDeviceInfo) { openMidiInput(mm, info) }
                override fun onDeviceRemoved(info: MidiDeviceInfo) {}
            }
            mm.registerDeviceCallback(midiCallback!!, Handler(Looper.getMainLooper()))
        }
        val n = mm.devices.count { it.outputPortCount > 0 }
        jsMidiStatus(if (n > 0) "🟢 $n MIDI device(s) connected" else "🎹 Native MIDI on — connect a USB / BT controller")
    }

    // Open the device's OUTPUT port (data flowing FROM the controller to us) and
    // stream its bytes to the WebView as a JSON int array.
    private fun openMidiInput(mm: MidiManager, info: MidiDeviceInfo) {
        if (info.outputPortCount <= 0) return
        val name = info.properties.getString(MidiDeviceInfo.PROPERTY_NAME) ?: "MIDI device"
        mm.openDevice(info, { device -> attachMidiDevice(device, name) }, Handler(Looper.getMainLooper()))
    }

    // MIDI → WebView pump. Messages are buffered and flushed at most once per
    // frame in ONE evaluateJavascript call, with a hard cap so a stuck or chatty
    // controller can never queue without bound. Previously every packet became its
    // own UI-thread JS evaluation, which is what made the app lock up.
    private val midiQueue = ArrayDeque<String>()
    private var midiFlushScheduled = false
    private val midiHandler = Handler(Looper.getMainLooper())

    private fun queueMidiToJs(arrayLiteral: String) {
        synchronized(midiQueue) {
            if (midiQueue.size > 256) midiQueue.removeFirst()   // shed load, never grow forever
            midiQueue.addLast(arrayLiteral)
            if (midiFlushScheduled) return
            midiFlushScheduled = true
        }
        midiHandler.postDelayed({
            val batch: List<String>
            synchronized(midiQueue) {
                midiFlushScheduled = false
                if (midiQueue.isEmpty()) return@postDelayed
                batch = midiQueue.toList(); midiQueue.clear()
            }
            val js = "window.onNativeMIDIBatch && onNativeMIDIBatch([" + batch.joinToString(",") + "])"
            try { webView.evaluateJavascript(js, null) } catch (e: Exception) {}
        }, 16)
    }

    // Shared for USB + BLE — connect a MidiReceiver to the device's output port.
    private fun attachMidiDevice(device: MidiDevice?, name: String) {
        if (device == null) return                       // not a MIDI device (e.g. a bonded headset) — stay quiet
        val port = device.openOutputPort(0) ?: run { try { device.close() } catch (e: Exception) {}; return } // no MIDI-out port
        openMidiDevices.add(device)
        port.connect(object : MidiReceiver() {
            override fun onSend(msg: ByteArray, offset: Int, count: Int, timestamp: Long) {
                if (count <= 0) return
                // Drop System Real-Time / System Common (0xF8 clock, 0xFE active
                // sensing, …). Controllers emit active sensing several times a
                // second and clock 24x a beat; forwarding that torrent one
                // evaluateJavascript at a time pinned the UI thread and froze the
                // app within seconds of connecting. None of it is playable input.
                var i = offset
                val end = offset + count
                val sb = StringBuilder()
                while (i < end) {
                    val b = msg[i].toInt() and 0xFF
                    // keep SysEx (F0-F7: MMC transport) and Start/Stop/Continue;
                    // drop only the flood — clock F8, undefined F9/FD, sensing FE, reset FF
                    if (b != 0xF8 && b != 0xF9 && b != 0xFD && b != 0xFE && b != 0xFF) {
                        if (sb.isNotEmpty()) sb.append(','); sb.append(b)
                    }
                    i++
                }
                if (sb.isEmpty()) return
                queueMidiToJs("[$sb]")
            }
        })
        jsMidiStatus("🟢 $name")
    }

    // BLE MIDI (Korg microKEY Air / nanoKEY Studio / nanoKONTROL Studio, etc.).
    // Two gotchas make the naive approach fail: (1) most BLE MIDI controllers do
    // NOT advertise the MIDI service UUID in their scan packet, so a service
    // ScanFilter finds nothing; (2) pre-Android-12 BLE scanning needs location
    // permission. So we scan UNFILTERED, match by name or advertised service, and
    // also try every already-paired (bonded) device — the reliable path.
    private val bleTried = mutableSetOf<String>()
    private val MIDI_NAME_RE = Regex("midi|korg|nanokey|microkey|nanokontrol|nanopad|keystage|keystation|mpk|mpd|launchkey|minilab|keylab|seaboard|roli|yamaha|casio|akai|arturia|novation|xkey|cme|widi|jamjum|jam jum|jp mini|jp-mini|jp1|jp-1|smk|m-vave|mvave|worlde", RegexOption.IGNORE_CASE)

    private fun startBleMidiScan() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) { jsMidiStatus("BLE MIDI needs Android 6+"); return }
        if (midiManager == null) midiManager = getSystemService(Context.MIDI_SERVICE) as? MidiManager
        val mm = midiManager ?: run { jsMidiStatus("MIDI unavailable on this device"); return }
        val adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        if (adapter == null || !adapter.isEnabled) { jsMidiStatus("Turn Bluetooth ON, then tap 📶 again"); return }
        // permissions: SCAN/CONNECT on 12+, FINE_LOCATION on 6–11
        val need = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.BLUETOOTH_SCAN)
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.BLUETOOTH_CONNECT)
        } else if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        if (need.isNotEmpty()) { ActivityCompat.requestPermissions(this, need.toTypedArray(), BLE_PERMISSION_REQUEST); jsMidiStatus("Grant Bluetooth permission, then tap 📶 again"); return }

        bleTried.clear()
        // 1) already-paired devices are the most reliable — but ONLY ones that look
        //    like MIDI gear. Blindly calling openBluetoothDevice() on every bonded
        //    device forced a GATT connection to headphones, watches, car stereos and
        //    anything else the phone had ever paired with; hammering the Bluetooth
        //    stack that way is what made handsets lock up and reboot.
        var bonded = 0
        try {
            adapter.bondedDevices?.forEach { dev ->
                if (looksLikeMidiDevice(dev)) { bonded++; tryOpenBle(mm, dev, "BLE MIDI") }
            }
        } catch (e: Exception) {}

        // 2) scan UNFILTERED for unpaired controllers.
        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) { if (bonded == 0) jsMidiStatus("No paired MIDI device — pair it in Bluetooth settings first"); return }
        bleScanCb?.let { try { scanner.stopScan(it) } catch (e: Exception) {} }
        bleScanner = scanner
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        bleScanCb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val dev = result.device ?: return
                val advertisesMidi = result.scanRecord?.serviceUuids?.any { it.uuid == BLE_MIDI_UUID } == true
                val nm = try { dev.name } catch (e: SecurityException) { null }
                val looksMidi = nm != null && MIDI_NAME_RE.containsMatchIn(nm)
                if (advertisesMidi || looksMidi) tryOpenBle(mm, dev, nm ?: "BLE MIDI")
            }
            override fun onScanFailed(errorCode: Int) { jsMidiStatus("BLE scan failed ($errorCode) — pair the controller in Bluetooth settings") }
        }
        jsMidiStatus("📶 Scanning for Korg / BLE MIDI — make sure it's paired + in range…")
        try { scanner.startScan(emptyList(), settings, bleScanCb) } catch (e: Exception) { jsMidiStatus("BLE scan error: ${e.message}"); return }
        Handler(Looper.getMainLooper()).postDelayed({
            try { bleScanCb?.let { scanner.stopScan(it) } } catch (e: Exception) {}
            if (bleTried.isEmpty()) jsMidiStatus("No BLE MIDI found — pair it in Android Bluetooth settings, then tap 📶")
        }, 15000)
    }

    // Only ever touch devices that plausibly ARE MIDI controllers. Opening a GATT
    // link to a paired headset / watch / car stereo is both useless and dangerous:
    // it hammers the Bluetooth stack and was destabilising the whole phone.
    private fun looksLikeMidiDevice(dev: android.bluetooth.BluetoothDevice): Boolean {
        return try {
            val type = dev.type
            val isLe = type == android.bluetooth.BluetoothDevice.DEVICE_TYPE_LE ||
                       type == android.bluetooth.BluetoothDevice.DEVICE_TYPE_DUAL
            if (!isLe) return false                                  // classic-only: never a BLE MIDI port
            val nm = dev.name ?: return false
            if (MIDI_NAME_RE.containsMatchIn(nm)) return true
            // an explicitly advertised MIDI service also qualifies
            dev.uuids?.any { it.uuid == BLE_MIDI_UUID } == true
        } catch (e: SecurityException) { false } catch (e: Exception) { false }
    }

    private fun tryOpenBle(mm: MidiManager, dev: android.bluetooth.BluetoothDevice, label: String) {
        val addr = try { dev.address } catch (e: Exception) { return }
        if (!bleTried.add(addr)) return // only attempt each address once per scan
        val nm = try { dev.name } catch (e: SecurityException) { null } ?: label
        try { mm.openBluetoothDevice(dev, { device -> attachMidiDevice(device, nm) }, Handler(Looper.getMainLooper())) } catch (e: Exception) {}
    }

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
        // ALWAYS expose the MIDI bridge. Gating it behind FEATURE_MIDI meant any
        // phone that does not advertise that feature — common, and unrelated to
        // whether android.media.midi actually works, especially for BLE — never
        // received the interface at all, so the app had no MIDI path whatsoever
        // and could never see a controller. setupMidi() reports the real state.
        webView.addJavascriptInterface(MidiBridge(), "AndroidMidi")
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
        } else if (requestCode == BLE_PERMISSION_REQUEST) {
            if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                startBleMidiScan() // permission just granted — start the BLE MIDI scan now
            } else {
                jsMidiStatus("Bluetooth permission denied — can’t scan for BLE MIDI")
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
        midiCallback?.let { midiManager?.unregisterDeviceCallback(it) }
        bleScanCb?.let { cb -> try { bleScanner?.stopScan(cb) } catch (e: Exception) {} }
        openMidiDevices.forEach { try { it.close() } catch (e: Exception) {} }
        openMidiDevices.clear()
        webView.destroy()
        super.onDestroy()
    }
}
