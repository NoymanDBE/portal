package com.dror.portal

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.bottomnavigation.BottomNavigationView

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    companion object {
        const val URL_PORTAL = "https://claude.ai/code/artifact/38ee750f-739f-42fe-b1a5-1aa3c8b0837c"
        const val URL_EDITION = "https://claude.ai/code/artifact/c91e4d00-f0be-4d93-9184-272c130faad1"
        const val URL_SCAN = "https://claude.ai/code/artifact/708d3036-0442-4aa3-96ab-6462026be21c"
        const val URL_DEALS = "https://claude.ai/code/artifact/83ebd878-bddf-4d84-a261-f8ff3e408f69"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.databaseEnabled = true
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                CookieManager.getInstance().flush() // keep the claude.ai login across restarts
            }
        }

        val nav = findViewById<BottomNavigationView>(R.id.nav)
        nav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.tab_portal -> web.loadUrl(URL_PORTAL)
                R.id.tab_edition -> web.loadUrl(URL_EDITION)
                R.id.tab_scan -> web.loadUrl(URL_SCAN)
                R.id.tab_deals -> web.loadUrl(URL_DEALS)
            }
            true
        }

        val start = intent.getStringExtra("open_url")
        web.loadUrl(start ?: URL_PORTAL)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
