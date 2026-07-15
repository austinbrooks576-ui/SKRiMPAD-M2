package com.firstriff.skrimpadm2

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.OpenableColumns
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import android.webkit.WebView
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

class FileHandler(private val activity: AppCompatActivity, private val webView: WebView) {
    private var filePickerCallback: String? = null
    private var fileSaveCallback: String? = null
    private var filePathCallback: String? = null

    private val filePickerLauncher = activity.registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            try {
                val inputStream = activity.contentResolver.openInputStream(uri)
                val bytes = inputStream?.readBytes() ?: byteArrayOf()
                val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                filePickerCallback?.let {
                    val js = "window.$it('$base64')"
                    webView.evaluateJavascript(js) { }
                }
            } catch (e: Exception) {
                Toast.makeText(activity, "Failed to read file", Toast.LENGTH_SHORT).show()
                filePickerCallback?.let {
                    val js = "window.$it(null)"
                    webView.evaluateJavascript(js) { }
                }
            }
        }
    }

    // Streams the picked file to a cache file (constant memory) and hands JS a
    // file:// path + original name. Avoids base64-encoding the whole file and
    // shoving a huge string through evaluateJavascript, which crashed the
    // WebView on large ZIP sample packs.
    private val filePathPickerLauncher = activity.registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        val cb = filePathCallback
        filePathCallback = null
        if (cb == null) return@registerForActivityResult
        if (uri == null) { callbackJson(cb, null); return@registerForActivityResult }
        try {
            var name = "import"
            activity.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0 && c.moveToFirst()) c.getString(idx)?.let { name = it }
            }
            val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
            val cacheFile = File(activity.cacheDir, "import_" + System.currentTimeMillis() + "_" + safe)
            activity.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(cacheFile).use { output -> input.copyTo(output, 128 * 1024) }
            }
            val obj = JSONObject()
            obj.put("path", "file://" + cacheFile.absolutePath)
            obj.put("name", name)
            callbackJson(cb, obj.toString())
        } catch (e: Exception) {
            Toast.makeText(activity, "Failed to read file", Toast.LENGTH_SHORT).show()
            callbackJson(cb, null)
        }
    }

    private fun callbackJson(cb: String, payload: String?) {
        val arg = if (payload == null) "null" else JSONObject.quote(payload)
        webView.post { webView.evaluateJavascript("window.$cb($arg)") { } }
    }

    private val fileSaveLauncher = activity.registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri: Uri? ->
        if (uri != null) {
            try {
                val context = activity.applicationContext
                val outputStream = context.contentResolver.openOutputStream(uri)
                outputStream?.write(currentFileData)
                outputStream?.close()
                Toast.makeText(activity, "File saved", Toast.LENGTH_SHORT).show()
                fileSaveCallback?.let {
                    val js = "window.$it(true)"
                    webView.evaluateJavascript(js) { }
                }
            } catch (e: Exception) {
                Toast.makeText(activity, "Failed to save file", Toast.LENGTH_SHORT).show()
                fileSaveCallback?.let {
                    val js = "window.$it(false)"
                    webView.evaluateJavascript(js) { }
                }
            }
        }
    }

    companion object {
        private var currentFileData = byteArrayOf()
    }

    @JavascriptInterface
    fun pickFile(mimeType: String, callback: String) {
        filePickerCallback = callback
        filePickerLauncher.launch(mimeType)
    }

    // Large-file friendly picker: streams to cache and returns {path,name} JSON.
    @JavascriptInterface
    fun pickFileToPath(mimeType: String, callback: String) {
        filePathCallback = callback
        filePathPickerLauncher.launch(mimeType)
    }

    @JavascriptInterface
    fun saveFile(base64Data: String, fileName: String, callback: String) {
        try {
            currentFileData = android.util.Base64.decode(base64Data, android.util.Base64.NO_WRAP)
            fileSaveCallback = callback
            fileSaveLauncher.launch(fileName)
        } catch (e: Exception) {
            Toast.makeText(activity, "Failed to save file", Toast.LENGTH_SHORT).show()
            callback?.let {
                val js = "window.$it(false)"
                webView.evaluateJavascript(js) { }
            }
        }
    }

    @JavascriptInterface
    fun openDownloadManager(base64Data: String, fileName: String) {
        try {
            val file = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                fileName
            )
            val fos = FileOutputStream(file)
            fos.write(android.util.Base64.decode(base64Data, android.util.Base64.NO_WRAP))
            fos.close()
            Toast.makeText(activity, "Saved to Downloads", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(activity, "Failed to save file", Toast.LENGTH_SHORT).show()
        }
    }
}
