package com.dror.portal

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import androidx.appcompat.app.AppCompatActivity

/** Asked once when the widget is added: the private repo and its read token. */
class WidgetConfigActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_config)
        setResult(RESULT_CANCELED)

        val widgetId = intent.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        val repoInput = findViewById<EditText>(R.id.feed_repo)
        val tokenInput = findViewById<EditText>(R.id.feed_token)
        FeedStore.repoSpec(this)?.let { repoInput.setText(it) }
        FeedStore.token(this)?.let { tokenInput.setText(it) }

        findViewById<Button>(R.id.save).setOnClickListener {
            val repo = repoInput.text.toString().trim()
            val token = tokenInput.text.toString().trim()
            if (repo.isNotEmpty()) FeedStore.setConfig(this, repo, token)
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
