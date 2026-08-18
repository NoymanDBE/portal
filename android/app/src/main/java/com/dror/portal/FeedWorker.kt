package com.dror.portal

import android.content.Context
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Pulls the three feed JSONs through the GitHub contents API (works for a
 * PRIVATE repo when a read-only token is configured) and re-renders widgets.
 */
class FeedWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val repo = FeedStore.repoSpec(applicationContext) ?: run {
            PortalWidget.renderAll(applicationContext, FeedStore.unconfigured())
            return Result.success()
        }
        val token = FeedStore.token(applicationContext)
        val news = fetch(repo, "news.json", token)
        val stocks = fetch(repo, "stocks.json", token)
        val deals = fetch(repo, "shopping.json", token)
        val snap = FeedStore.build(news, stocks, deals)
        FeedStore.save(applicationContext, snap)
        PortalWidget.renderAll(applicationContext, snap)
        return Result.success()
    }

    private fun fetch(repo: String, name: String, token: String?): JSONObject? = try {
        val url = "https://api.github.com/repos/$repo/contents/feeds/$name"
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 10000
        conn.setRequestProperty("Accept", "application/vnd.github.raw+json")
        conn.setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
        if (!token.isNullOrEmpty()) conn.setRequestProperty("Authorization", "Bearer $token")
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
