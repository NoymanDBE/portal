package com.dror.portal

import android.content.Context
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Pulls the three feed JSONs and re-renders every widget. */
class FeedWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val base = FeedStore.baseUrl(applicationContext) ?: run {
            PortalWidget.renderAll(applicationContext, FeedStore.unconfigured())
            return Result.success()
        }
        val news = fetch("$base/news.json")
        val stocks = fetch("$base/stocks.json")
        val deals = fetch("$base/shopping.json")
        val snap = FeedStore.build(applicationContext, news, stocks, deals)
        FeedStore.save(applicationContext, snap)
        PortalWidget.renderAll(applicationContext, snap)
        return Result.success()
    }

    private fun fetch(url: String): JSONObject? = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 10000
        conn.setRequestProperty("Cache-Control", "no-cache")
        val text = conn.inputStream.bufferedReader().readText()
        JSONObject(text)
    } catch (e: Exception) {
        null
    }

    companion object {
        fun refreshNow(context: Context) {
            WorkManager.getInstance(context)
                .enqueue(OneTimeWorkRequestBuilder<FeedWorker>().build())
        }
    }
}
