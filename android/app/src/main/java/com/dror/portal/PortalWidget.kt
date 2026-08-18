package com.dror.portal

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Home-screen widget: one card with three lines — today's headline (The Edition),
 * the market line (Breakthrough Scan) and new finds (Deal Hunter).
 * Data comes from three small JSON feeds at the base URL set in the widget config
 * (the daily routines push them to GitHub on every run).
 */
class PortalWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) render(context, manager, id, FeedStore.cached(context))
        FeedWorker.refreshNow(context)
        schedule(context)
    }

    override fun onEnabled(context: Context) = schedule(context)

    private fun schedule(context: Context) {
        val req = PeriodicWorkRequestBuilder<FeedWorker>(30, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork("portal-feeds", ExistingPeriodicWorkPolicy.KEEP, req)
    }

    companion object {
        fun renderAll(context: Context, data: FeedStore.Snapshot) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, PortalWidget::class.java))
            for (id in ids) render(context, manager, id, data)
        }

        fun render(context: Context, manager: AppWidgetManager, id: Int, data: FeedStore.Snapshot) {
            val views = RemoteViews(context.packageName, R.layout.widget_portal)
            views.setTextViewText(R.id.w_news, data.newsLine)
            views.setTextViewText(R.id.w_stocks, data.stocksLine)
            views.setTextViewText(R.id.w_deals, data.dealsLine)
            views.setTextViewText(R.id.w_updated, data.updated)

            fun open(reqCode: Int, url: String): PendingIntent {
                val i = Intent(context, MainActivity::class.java).putExtra("open_url", url)
                return PendingIntent.getActivity(
                    context, reqCode, i,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            }
            views.setOnClickPendingIntent(R.id.w_news, open(1, MainActivity.URL_EDITION))
            views.setOnClickPendingIntent(R.id.w_stocks, open(2, MainActivity.URL_SCAN))
            views.setOnClickPendingIntent(R.id.w_deals, open(3, MainActivity.URL_DEALS))
            views.setOnClickPendingIntent(R.id.w_root, open(0, MainActivity.URL_PORTAL))
            manager.updateAppWidget(id, views)
        }
    }
}
