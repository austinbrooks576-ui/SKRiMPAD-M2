package com.firstriff.skrimpadm2

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

class FileHandler(private val activity: AppCompatActivity) {
    private var filePickerCallback: String? = null
    private var fileSaveCallback: String? = null

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
                    activity.webView?.evaluateJavascript(js) { }
                }
            } catch (e: Exception) {
                Toast.makeText(activity, "Failed to read file", Toast.LENGTH_SHORT).show()
                filePickerCallback?.let {
                    val js = "window.$it(null)"
                    activity.webView?.evaluateJavascript(js) { }
                }
            }
        }
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
                    activity.webView?.evaluateJavascript(js) { }
                }
            } catch (e: Exception) {
                Toast.makeText(activity, "Failed to save file", Toast.LENGTH_SHORT).show()
                fileSaveCallback?.let {
                    val js = "window.$it(false)"
                    activity.webView?.evaluateJavascript(js) { }
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
                activity.webView?.evaluateJavascript(js) { }
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
