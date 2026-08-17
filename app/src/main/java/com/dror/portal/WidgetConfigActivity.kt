package com.dror.portal

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import androidx.appcompat.app.AppCompatActivity

/** Asked once when the widget is added: the base URL of the JSON feeds. */
class WidgetConfigActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_config)
        setResult(RESULT_CANCELED)

        val widgetId = intent.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        val input = findViewById<EditText>(R.id.feed_url)
        FeedStore.baseUrl(this)?.let { input.setText(it) }

        findViewById<Button>(R.id.save).setOnClickListener {
            val url = input.text.toString().trim()
            if (url.isNotEmpty()) FeedStore.setBaseUrl(this, url)
            PortalWidget.render(
                this, AppWidgetManager.getInstance(this), widgetId, FeedStore.cached(this)
            )
            FeedWorker.refreshNow(this)
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
            finish()
        }
        findViewById<Button>(R.id.skip).setOnClickListener {
            PortalWidget.render(
                this, AppWidgetManager.getInstance(this), widgetId, FeedStore.unconfigured()
            )
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
            finish()
        }
    }
}
